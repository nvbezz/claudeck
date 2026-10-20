import { expect, test } from 'claude-code/testing'

import { readConfig } from './config'
import { EFFORTS } from './controls'
import { clip, duration, effortView, lineDiff, prettyModel, project, spark, until } from './format'
import { dayKey, series, spentPerDay } from './history'
import { isSafeId } from './housekeeping'
import { notifyCommand, openCommand, parseOs, soundCommand } from './platform'
import { INITIAL } from './state'
import { visibleRows } from './explorer'
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
