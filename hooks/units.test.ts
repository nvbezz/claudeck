import { expect, test } from 'claude-code/testing'

import { readConfig } from './config'
import { EFFORTS } from './controls'
import { clip, duration, effortView, fitCommit, lineDiff, modifiedFiles, prettyModel, project, spark, until } from './format'
import { dayKey, series, spentPerDay } from './history'
import { isSafeId } from './housekeeping'
import { notifyCommand, openCommand, parseOs, soundCommand } from './platform'
import { FILES, MAX_HEAL_TRIES, PANE, healPanes, parseStatus } from './data'
import { INITIAL } from './state'
import { keepAgent } from './agents'
import { isAllDone, settleTodos } from './tasks'
import { isGone, visibleRows } from './explorer'
import { parseCollapsed } from './ui'

test('effortView lights the dots up to the active level', () => {
  expect(effortView('high', EFFORTS)).toEqual({ index: 2, label: 'alto', dots: '●●●○○' })
  expect(effortView('low', EFFORTS).dots).toBe('●○○○○')
  expect(effortView('max', EFFORTS).dots).toBe('●●●●●')
})

test('effortView never lies about an unknown or missing level', () => {
  expect(effortView('', EFFORTS)).toEqual({ index: -1, label: 'auto', dots: '○○○○○' })
  expect(effortView('ultra', EFFORTS)).toEqual({ index: -1, label: 'ultra', dots: '○○○○○' })
})

test('lineDiff counts only real changes', () => {
  expect(lineDiff('a\nb', 'a\nb')).toEqual({ added: 0, removed: 0 })
  expect(lineDiff('', 'a\nb')).toEqual({ added: 2, removed: 0 })
  expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual({ added: 1, removed: 1 })
  expect(lineDiff('a\na', 'a')).toEqual({ added: 0, removed: 1 })
})

test('duration, clip and spark format edge values', () => {
  expect(duration(-5)).toBe('0s')
  expect(duration(65000)).toBe('1m 5s')
  expect(duration(3660000)).toBe('1h 1m')
  expect(clip('abcdef', 4)).toBe('abc…')
  expect(clip('abc', 4)).toBe('abc')
  expect(spark([])).toBe('')
  expect(spark([0, 0])).toBe('▁▁')
  expect(spark([1, 2]).length).toBe(2)
})

test('until handles missing, past and future resets', () => {
  const now = Date.UTC(2026, 0, 1)
  expect(until(undefined, now)).toBe('')
  expect(until('garbage', now)).toBe('')
  expect(until(new Date(now - 1000).toISOString(), now)).toBe('')
  expect(until(new Date(now + 90 * 60000).toISOString(), now)).toBe('1h30m')
  expect(until(new Date(now + 26 * 3600000).toISOString(), now)).toBe('1d2h')
})

test('project stays calm without enough samples and warns when the limit will fill', () => {
  const now = 10 * 3600000
  expect(project([], undefined, now).text).toBe('estable')
  expect(project([{ t: 0, p: 10 }, { t: 60000, p: 20 }], undefined, now).text).toBe('estable')
  const fast = project([{ t: 0, p: 10 }, { t: 600000, p: 60 }], new Date(now + 99 * 3600000).toISOString(), now)
  expect(fast.tone).toBe('error')
  const slow = project([{ t: 0, p: 10 }, { t: 3600000, p: 12 }], new Date(now + 3600000).toISOString(), now)
  expect(slow.text).toBe('aguanta')
})

test('prettyModel names known models and passes unknown ones through', () => {
  expect(prettyModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(prettyModel('claude-opus-4')).toBe('Opus 4')
  expect(prettyModel('')).toBe('—')
  expect(prettyModel('gpt-x')).toBe('gpt-x')
})

test('cost history does not double count a session that spans midnight', () => {
  const days = { '2026-01-01': { s1: 5 }, '2026-01-02': { s1: 8, s2: 1 } }
  expect(spentPerDay(days)).toEqual({ '2026-01-01': 5, '2026-01-02': 4 })
  const now = new Date(2026, 0, 2, 12).getTime()
  const values = series(days, now)
  expect(values.length).toBe(14)
  expect(values[13]).toBe(4)
  expect(values[12]).toBe(5)
  expect(dayKey(now)).toBe('2026-01-02')
})

test('readConfig falls back on bad values', () => {
  const cfg = readConfig({ width: 'abc', ctxCrit: -3, isSound: 'false', bgColor: '  ', mcpSeconds: '60' } as never)
  expect(cfg.width).toBe(46)
  expect(cfg.ctxCrit).toBe(85)
  expect(cfg.isSound).toBe(false)
  expect(cfg.isDesktop).toBe(true)
  expect(cfg.bgColor).toBe('#1e1e2e')
  expect(cfg.mcpSeconds).toBe(60)
})

test('parseCollapsed keeps only known sections', () => {
  expect(parseCollapsed(undefined)).toEqual([])
  expect(parseCollapsed({ collapsed: 'git' })).toEqual([])
  expect(parseCollapsed({ collapsed: ['git', 'nope', 7, 'agents'] })).toEqual(['git', 'agents'])
  expect(parseCollapsed({ isCompact: true })).toEqual([])
})

test('platform commands are portable and never splice values into a script', () => {
  expect(parseOs('Linux\n')).toBe('linux')
  expect(parseOs('Darwin')).toBe('mac')
  expect(parseOs('MINGW64_NT')).toBe('other')
  const evil = `x"; rm -rf ~; "`
  for (const os of ['linux', 'mac'] as const) {
    const cmds = [notifyCommand(os, evil, evil), openCommand(os, evil), soundCommand(os, 'done')]
    for (const argv of cmds) {
      expect(argv).toBeTruthy()
      for (const part of (argv ?? []).slice(0, -2)) expect(part.includes('rm -rf')).toBe(false)
    }
  }
  expect(notifyCommand('other', 'a', 'b')).toBeUndefined()
  expect(openCommand('other', '/x')).toBeUndefined()
  expect(soundCommand('other', 'warn')).toBeUndefined()
  expect(openCommand('mac', '/a b/c')).toEqual(['open', '/a b/c'])
})

test('isSafeId refuses anything that could widen a glob', () => {
  expect(isSafeId('812e0796-6f85-4286-830f-f8a6a4743ca0')).toBe(true)
  for (const bad of ['', '*', '../x', 'a b', 'a;b', 'x'.repeat(65)]) expect(isSafeId(bad)).toBe(false)
})

test('visibleRows hides dotfiles and ignored folders, marks dirty folders, and caps the list', () => {
  const ex = {
    ...INITIAL.explorer,
    root: '/p',
    open: ['/p/src'],
    listing: {
      '/p': [{ name: 'src', kind: 'dir' as const }, { name: '.env', kind: 'file' as const }, { name: 'node_modules', kind: 'dir' as const }, { name: 'a.ts', kind: 'file' as const }],
      '/p/src': [{ name: 'b.ts', kind: 'file' as const }],
    },
  }
  const rows = visibleRows(ex, { '/p/src/b.ts': 'M' })
  expect(rows.map(r => r.name)).toEqual(['src', 'b.ts', 'a.ts'])
  expect(rows[0]?.git).toBe('●')
  expect(rows[1]?.git).toBe('M')
  expect(visibleRows({ ...ex, isHidden: true }, {}).length).toBe(5)
  const many = { ...ex, open: [], listing: { '/p': Array.from({ length: 900 }, (_, i) => ({ name: `f${i}`, kind: 'file' as const })) } }
  expect(visibleRows(many, {}).length).toBe(400)
})

test('fitCommit shortens the subject so the age always fits', () => {
  expect(fitCommit('fix: short', 42, '5m')).toBe('fix: short')
  const long = fitCommit('docs: add screenshots and capture guide for the readme', 42, 'ahora')
  expect(long.endsWith('…')).toBe(true)
  expect(3 + 8 + long.length + 1 + 'ahora'.length <= 39).toBe(true)
  expect(fitCommit('x'.repeat(100), 10, '3d').length).toBe(8)
})

const done = (id: string) => ({ id, content: id, status: 'completed' as const })
const open = (id: string) => ({ id, content: id, status: 'pending' as const })

test('settleTodos waits for the whole list, then hides it after the delay', () => {
  expect(isAllDone([])).toBe(false)
  expect(settleTodos([], undefined, 1000, 90000)).toEqual({ todos: [], doneAt: undefined })
  const mixed = [done('a'), open('b')]
  expect(settleTodos(mixed, 500, 1000, 90000)).toEqual({ todos: mixed, doneAt: undefined })
  const all = [done('a'), done('b')]
  expect(settleTodos(all, undefined, 1000, 90000)).toEqual({ todos: all, doneAt: 1000 })
  expect(settleTodos(all, 1000, 90999, 90000)).toEqual({ todos: all, doneAt: 1000 })
  expect(settleTodos(all, 1000, 91000, 90000)).toEqual({ todos: [], doneAt: undefined })
})

test('settleTodos restarts the clock when a finished list gets a new task, and 0 keeps it forever', () => {
  const all = [done('a')]
  const reopened = [done('a'), open('b')]
  expect(settleTodos(reopened, 1000, 200000, 90000).doneAt).toBeUndefined()
  expect(settleTodos(all, 1000, 999999999, 0)).toEqual({ todos: all, doneAt: 1000 })
})

test('taskHideSeconds accepts 0 and rejects garbage', () => {
  expect(readConfig({} as never).taskHideSeconds).toBe(90)
  expect(readConfig({ taskHideSeconds: 0 } as never).taskHideSeconds).toBe(0)
  expect(readConfig({ taskHideSeconds: '30' } as never).taskHideSeconds).toBe(30)
  expect(readConfig({ taskHideSeconds: -5 } as never).taskHideSeconds).toBe(90)
  expect(readConfig({ taskHideSeconds: 'abc' } as never).taskHideSeconds).toBe(90)
})

test('keepAgent always shows a running agent and hides a finished one after the delay', () => {
  expect(keepAgent(false, undefined, 5000, 90000)).toBe(true)
  expect(keepAgent(false, 1000, 999999, 90000)).toBe(true)
  expect(keepAgent(true, 1000, 90999, 90000)).toBe(true)
  expect(keepAgent(true, 1000, 91000, 90000)).toBe(false)
  expect(keepAgent(true, 1000, 999999999, 0)).toBe(true)
  expect(keepAgent(true, undefined, 999999, 90000)).toBe(true)
})

test('agentHideSeconds accepts 0 and rejects garbage', () => {
  expect(readConfig({} as never).agentHideSeconds).toBe(90)
  expect(readConfig({ agentHideSeconds: 0 } as never).agentHideSeconds).toBe(0)
  expect(readConfig({ agentHideSeconds: '15' } as never).agentHideSeconds).toBe(15)
  expect(readConfig({ agentHideSeconds: -1 } as never).agentHideSeconds).toBe(90)
})

// A stand-in for `$` with just what healPanes touches.
const fakeUi = (panes: { id: string; isPlaced: boolean }[] | 'fail') => {
  const opened: string[] = []
  const $ = {
    store: { get: async () => undefined },
    ui: {
      panes: async () => (panes === 'fail' ? Promise.reject(new Error('gone')) : panes),
      open: async (args: { id: string }) => {
        opened.push(args.id)
        return { isPlaced: true }
      },
    },
  }

  return { $: $ as never, opened }
}
const cfgOf = readConfig({} as never)

test('healPanes leaves alone panes that are drawn', async () => {
  const { $, opened } = fakeUi([{ id: FILES, isPlaced: true }, { id: PANE, isPlaced: true }])
  const state = { tries: 5 }
  expect(await healPanes($, cfgOf, new Set(), state)).toEqual([])
  expect(opened).toEqual([])
  expect(state.tries).toBe(0)
})

test('healPanes reopens a pane that is gone or undrawn, files first', async () => {
  const gone = fakeUi([{ id: FILES, isPlaced: true }])
  expect(await healPanes(gone.$, cfgOf, new Set(), { tries: 0 })).toEqual([PANE])
  expect(gone.opened).toEqual([PANE])
  const undrawn = fakeUi([{ id: FILES, isPlaced: false }, { id: PANE, isPlaced: false }])
  await healPanes(undrawn.$, cfgOf, new Set(), { tries: 0 })
  expect(undrawn.opened).toEqual([FILES, PANE])
  const none = fakeUi([])
  await healPanes(none.$, cfgOf, new Set(), { tries: 0 })
  expect(none.opened).toEqual([FILES, PANE])
})

test('healPanes respects a pane the person closed', async () => {
  const { $, opened } = fakeUi([])
  await healPanes($, cfgOf, new Set([PANE]), { tries: 0 })
  expect(opened).toEqual([FILES])
  const both = fakeUi([])
  expect(await healPanes(both.$, cfgOf, new Set([PANE, FILES]), { tries: 0 })).toEqual([])
  expect(both.opened).toEqual([])
})

test('healPanes survives a failing listing and stops after too many tries', async () => {
  const broken = fakeUi('fail')
  expect(await healPanes(broken.$, cfgOf, new Set(), { tries: 0 })).toEqual([])
  expect(broken.opened).toEqual([])
  const stuck = fakeUi([])
  const state = { tries: 0 }
  for (let i = 0; i < MAX_HEAL_TRIES + 5; i++) await healPanes(stuck.$, cfgOf, new Set(), state)
  expect(stuck.opened.length).toBe(MAX_HEAL_TRIES * 2)
  expect(state.tries).toBe(MAX_HEAL_TRIES)
})

test('parseStatus reads NUL-separated entries, keeps odd names whole and skips a rename\'s old path', () => {
  expect(parseStatus('')).toEqual([])
  expect(parseStatus(' M a.txt\0?? with space/ñ.js\0D  gone.md\0')).toEqual([
    { xy: ' M', path: 'a.txt' },
    { xy: '??', path: 'with space/ñ.js' },
    { xy: 'D ', path: 'gone.md' },
  ])
  expect(parseStatus('R  new.txt\0old.txt\0 M b.txt\0')).toEqual([
    { xy: 'R ', path: 'new.txt' },
    { xy: ' M', path: 'b.txt' },
  ])
})

test('isGone flags only what a loaded listing no longer has', () => {
  const listing = { '/p': [{ name: 'a.txt', kind: 'file' as const }] }
  expect(isGone(listing, '/p/a.txt')).toBe(false)
  expect(isGone(listing, '/p/b.txt')).toBe(true)
  expect(isGone(listing, '/p/sub/c.txt')).toBe(false)
  expect(isGone(listing, '')).toBe(false)
})

test('modifiedFiles adds git changes to tracked edits and leaves deleted files out', () => {
  const tracked = { '/p/a.js': { added: 3, removed: 1 } }
  const changes = [
    { path: 'a.js', code: 'M', added: 9, removed: 9 },
    { path: 'b.css', code: 'U', added: 0, removed: 0 },
    { path: 'gone.md', code: 'D', added: 0, removed: 4 },
  ]
  expect(modifiedFiles(tracked, changes, '/p')).toEqual([
    ['/p/a.js', { added: 3, removed: 1 }],
    ['/p/b.css', { added: 0, removed: 0 }],
  ])
  expect(modifiedFiles(tracked, changes, '')).toEqual([['/p/a.js', { added: 3, removed: 1 }]])
})
