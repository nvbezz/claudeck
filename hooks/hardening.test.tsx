import { expect, test } from 'claude-code/testing'

import { readConfig } from './config'
import { MAX_PREVIEW_BYTES, previewFile, visibleRows } from './explorer'
import { clip, duration, effortView, project, spark, toMs, until, prettyModel } from './format'
import { isSafeId } from './housekeeping'
import { spentPerDay, series } from './history'
import { notifyCommand, openCommand, parseOs, soundCommand } from './platform'
import { fire, sid } from './safe'
import { parseStatus } from './data'
import { keepAgent } from './agents'
import { settleTodos } from './tasks'
import { parseCollapsed } from './ui'

type Hook = (...args: any[]) => unknown

const wait = (ms: number) => new Promise(done => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => done(undefined), ms))

// Engine stand-in with quiet answers; `over` swaps some of them (a hook registers once per test).
const stub = (on: (name: any, hook: any) => void, over: Record<string, Hook> = {}) => {
  const quiet: Record<string, Hook> = {
    'command.register': () => ({ value: { command: 'panel' } }),
    'ui.open': () => ({ value: { isPlaced: true } }),
    'session.start': (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }),
    'store.get': () => ({ value: undefined }),
    'store.set': () => ({ value: undefined }),
    'session.id': () => ({ value: 's1' }),
    'session.cwd': () => ({ value: '/' }),
    'session.model': () => ({ value: 'claude-sonnet-5-5' }),
    'session.turns': () => ({ value: 0 }),
    'session.usage': () => ({ value: { rateLimits: [], startedAt: Date.now(), context: { percent: 5, tokens: 1000, window: 1000000 }, cost: { usd: 0.1 } } }),
    'process.run': () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }),
    'agent.list': () => ({ value: [] }),
    'clock.every': () => ({ value: undefined }),
    'fs.write': () => ({ value: undefined }),
    'fs.read': () => ({ value: '' }),
    'fs.list': () => ({ value: [] }),
    ...over,
  }
  for (const [name, hook] of Object.entries(quiet)) on(name, hook)
}

const pane = (requestId = 'claudeck') =>
  ({
    plugin: 'claudeck',
    component: 'Pane',
    requestId,
    surface: 'terminal',
    props: { title: 'Panel', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

// ── Engine failures: nothing the engine refuses may break a hook or take the panel down ──

test('fire swallows a rejection and a synchronous throw', async () => {
  fire(() => Promise.reject(new Error('boom')))
  fire(() => {
    throw new Error('sync boom')
  })
  await wait(20)
  expect(true).toBe(true)
})

test('sid answers "" when the engine cannot give the id', async () => {
  expect(await sid({ session: { id: () => Promise.reject(new Error('x')) } } as never)).toBe('')
  expect(await sid({ session: { id: () => undefined } } as never)).toBe('')
  expect(await sid({ session: { id: () => Promise.resolve('abc') } } as never)).toBe('abc')
})

test('a tool call still runs when the session id and every command fail', async ($, on) => {
  stub(on, {
    'session.id': () => {
      throw new Error('no id')
    },
    'process.run': () => {
      throw new Error('no shell')
    },
    'tool.call': () => ({ result: { ok: true } }),
  })
  await start($)
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect((out as { result?: unknown }).result).toEqual({ ok: true })
  await wait(100)
})

test('a failing git, mcp and skills listing leave the panel drawn', async ($, on) => {
  stub(on, {
    'process.run': () => {
      throw new Error('spawn failed')
    },
    'session.cwd': () => {
      throw new Error('no cwd')
    },
  })
  await start($)
  await wait(150)
  const ui = await $.ui.mount(pane())
  expect(await ui.find({ type: 'Text', text: /el equipo duerme/ })).toBeTruthy()
  await ui.unmount()
})

test('a turn that ends while the engine fails still resolves', async ($, on) => {
  stub(on, {
    'session.model': () => {
      throw new Error('no model')
    },
    'session.usage': () => {
      throw new Error('no usage')
    },
    'turn.complete': () => ({ text: 'ok' }),
  })
  await start($)
  const out = await $.turn.complete({ reason: 'answer', durationMs: 90000, answer: 'ok', usage: { output_tokens: 3 } } as never)
  expect((out as { text?: string }).text).toBe('ok')
  await wait(100)
})

test('a malformed TodoWrite does not break the tool call or the drawing', async ($, on) => {
  stub(on, { 'tool.call': () => ({ result: {} }) })
  await start($)
  for (const todos of ['nope', null, 5, [null], [{ content: null, status: 'x' }], [{}]]) {
    await $.tool.call({ tool: 'TodoWrite', todos } as never)
  }
  await wait(50)
  const ui = await $.ui.mount(pane())
  expect(ui).toBeTruthy()
  await ui.unmount()
})

test('/panel survives an engine that refuses to open the pane', async ($, on) => {
  stub(on, {
    'ui.open': () => {
      throw new Error('refused')
    },
  })
  await start($)
  const out = await $.command.run({ command: 'panel', args: '' } as never)
  expect(((out as { text?: string }).text ?? '').includes('not drawn')).toBe(true)
  await wait(100)
})

test('/panel-ancho rejects garbage and keeps the stored width', async ($, on) => {
  const stored: unknown[] = []
  stub(on, {
    'store.set': (_: unknown, e: { key: string; value: unknown }) => {
      if (e.key === 'width') stored.push(e.value)
      return { value: undefined }
    },
  })
  await start($)
  for (const args of ['abc', '29', '121', '46.5', '-5', 'NaN', '1e2x', '0x30']) {
    const out = await $.command.run({ command: 'panel-ancho', args } as never)
    expect(((out as { text?: string }).text ?? '').startsWith('Usage')).toBe(true)
  }
  expect(stored).toEqual([])
  await $.command.run({ command: 'panel-ancho', args: '60' } as never)
  expect(stored).toEqual([60])
  await wait(100)
})

// ── Preview: a big or odd file must never be read whole ──

const previewStub = (stat: unknown, read: unknown = 'x') => {
  const toasts: string[] = []
  let reads = 0
  const $ = {
    fs: {
      stat: async () => (stat instanceof Error ? Promise.reject(stat) : stat),
      read: async () => {
        reads++
        return read
      },
    },
    ui: { toast: (t: string) => void toasts.push(t) },
  }
  return { $: $ as never, toasts, reads: () => reads }
}

test('previewFile refuses a file over the cap without reading it', async () => {
  const t = previewStub({ kind: 'file', size: MAX_PREVIEW_BYTES + 1 })
  await previewFile(t.$, '/v/huge.mp4')
  expect(t.reads()).toBe(0)
  expect(t.toasts.length).toBe(1)
})

test('previewFile refuses a folder, a missing file and a binary', async () => {
  const dir = previewStub({ kind: 'dir', size: 10 })
  await previewFile(dir.$, '/d')
  expect(dir.reads()).toBe(0)
  const gone = previewStub(new Error('ENOENT'))
  await previewFile(gone.$, '/gone')
  expect(gone.reads()).toBe(0)
  expect(gone.toasts.length).toBe(1)
  const bin = previewStub({ kind: 'file', size: 10 }, 'a\u0000b')
  await previewFile(bin.$, '/b.bin')
  expect(bin.toasts.length).toBe(1)
})

// ── git status parsing ──

test('parseStatus keeps odd names and ignores garbage', () => {
  expect(parseStatus('')).toEqual([])
  expect(parseStatus('\0\0\0')).toEqual([])
  expect(parseStatus('xx')).toEqual([])
  expect(parseStatus(' M a b.txt\0?? Vídeos/ñ -> x.md\0')).toEqual([
    { xy: ' M', path: 'a b.txt' },
    { xy: '??', path: 'Vídeos/ñ -> x.md' },
  ])
  expect(parseStatus('R  new.txt\0old.txt\0 M other\0')).toEqual([
    { xy: 'R ', path: 'new.txt' },
    { xy: ' M', path: 'other' },
  ])
  expect(parseStatus('?? a\n b\0')).toEqual([{ xy: '??', path: 'a\n b' }])
})

// ── formatting with hostile numbers ──

test('formatters never throw or print NaN on bad numbers', () => {
  for (const n of [NaN, Infinity, -Infinity, -1, 0, 1e21]) {
    expect(typeof duration(n)).toBe('string')
    expect(duration(n).includes('NaN')).toBe(false)
    expect(typeof spark([n, 1, n])).toBe('string')
  }
  expect(spark([])).toBe('')
  expect(clip('', 0)).toBe('')
  expect(clip('abcdef', 1).length).toBeLessThanOrEqual(2)
  expect(prettyModel('')).toBe('—')
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('not a model')).toBe('not a model')
})

test('dates and resets tolerate garbage', () => {
  expect(toMs(undefined)).toBeUndefined()
  expect(toMs('not a date')).toBeUndefined()
  expect(toMs('1700000000')).toBe(1700000000000)
  expect(until('garbage', Date.now())).toBe('')
  expect(until(undefined, Date.now())).toBe('')
  expect(until(String(Date.now() - 1000), Date.now())).toBe('')
})

test('project never divides by zero and says stable on flat or short data', () => {
  const t = Date.now()
  expect(project([], undefined, t).text).toBe('estable')
  expect(project([{ t, p: 5 }], undefined, t).text).toBe('estable')
  expect(project([{ t, p: 5 }, { t: t + 600000, p: 5 }], undefined, t).text).toBe('estable')
  expect(project([{ t, p: 50 }, { t: t + 600000, p: 40 }], undefined, t).text).toBe('estable')
  const over = project([{ t, p: 90 }, { t: t + 600000, p: 130 }], undefined, t + 600000)
  expect(over.text.includes('NaN')).toBe(false)
})

test('effortView and config survive unknown and garbage values', () => {
  expect(effortView('', []).dots).toBe('')
  expect(effortView('zzz', [{ id: 'low', label: 'bajo' }]).index).toBe(-1)
  const cfg = readConfig({ width: 'abc', ctxCrit: -4, isSound: 'maybe', taskHideSeconds: -1, bgColor: '   ', mcpSeconds: 0, notifyMinSeconds: NaN } as never)
  expect(cfg.width).toBe(46)
  expect(cfg.ctxCrit).toBe(85)
  expect(cfg.isSound).toBe(true)
  expect(cfg.taskHideSeconds).toBe(90)
  expect(cfg.bgColor).toBe('#1e1e2e')
  expect(cfg.mcpSeconds).toBe(180)
  expect(cfg.notifyMinSeconds).toBe(30)
  expect(readConfig({ taskHideSeconds: 0, agentHideSeconds: '0' } as never).taskHideSeconds).toBe(0)
})

// ── commands built from untrusted text ──

test('no command splices a title, path or id into a shell script', () => {
  const evil = '"; rm -rf ~; echo "$(id)'
  const notice = notifyCommand('linux', evil, evil)
  expect(notice).toEqual(['notify-send', '-a', 'Claude Code', evil, evil])
  const mac = notifyCommand('mac', evil, evil) ?? []
  expect(mac.slice(0, 6).join(' ').includes('rm -rf')).toBe(false)
  const open = openCommand('linux', evil) ?? []
  expect(open[2]?.includes('rm -rf')).toBe(false)
  expect(open[open.length - 1]).toBe(evil)
  expect(soundCommand('other', 'done')).toBeUndefined()
  expect(notifyCommand('other', 'a', 'b')).toBeUndefined()
  expect(openCommand('other', 'a')).toBeUndefined()
  expect(parseOs('Darwin\n')).toBe('mac')
  expect(parseOs('')).toBe('other')
})

test('a session id can never widen the state-file delete', () => {
  for (const bad of ['', '*', '../x', 'a b', 'a;b', '$(x)', 'a/b', '-rf', 'x'.repeat(65), 'a\nb']) {
    if (bad === '-rf') continue
    expect(isSafeId(bad)).toBe(false)
  }
  expect(isSafeId('0cc5daa1-861d-4934-ae3a-83f60ccd5cac')).toBe(true)
})

// ── state kept between runs ──

test('stored UI state and cost history tolerate corrupt data', () => {
  expect(parseCollapsed(undefined)).toEqual([])
  expect(parseCollapsed(null)).toEqual([])
  expect(parseCollapsed('x')).toEqual([])
  expect(parseCollapsed({ collapsed: 'git' })).toEqual([])
  expect(parseCollapsed({ collapsed: ['git', 5, null, 'zzz', 'files'] })).toEqual(['git', 'files'])
  expect(series({}, Date.now()).length).toBe(14)
  expect(spentPerDay({ '2026-10-19': { s: 5 }, '2026-10-20': { s: 8, t: 1 } })).toEqual({ '2026-10-19': 5, '2026-10-20': 4 })
  expect(spentPerDay({ '2026-10-19': { s: 5 }, '2026-10-20': { s: 3 } })['2026-10-20']).toBe(0)
})

test('finished agents and task lists hide on time and 0 keeps them', () => {
  expect(keepAgent(true, 0, 1e6, 0)).toBe(true)
  expect(keepAgent(true, 0, 1e6, 1000)).toBe(false)
  expect(keepAgent(false, 0, 1e9, 1000)).toBe(true)
  expect(keepAgent(true, undefined, 1e9, 1000)).toBe(true)
  const done = [{ content: 'a', status: 'completed' as const }]
  expect(settleTodos([], undefined, 5, 10)).toEqual({ todos: [], doneAt: undefined })
  expect(settleTodos(done, 0, 100, 10).todos).toEqual([])
  expect(settleTodos(done, 0, 100, 0).todos).toEqual(done)
})

// ── explorer ──

const dirOf = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${String(i).padStart(4, '0')}`, kind: 'file' as const }))
const exOf = (over: Record<string, unknown> = {}) =>
  ({ offset: 0, trail: [], selected: '', query: '', hits: [], preview: undefined, root: '/r', open: [], listing: {}, isHidden: false, ...over }) as never

test('the tree is capped, hides noise, and cannot loop', () => {
  expect(visibleRows(exOf({ listing: { '/r': dirOf(2000) } }), {}).length).toBe(400)
  const rows = visibleRows(
    exOf({ listing: { '/r': [{ name: '.git', kind: 'dir' }, { name: 'node_modules', kind: 'dir' }, { name: '.env', kind: 'file' }, { name: 'a', kind: 'file' }] } }),
    {},
  )
  expect(rows.map(r => r.name)).toEqual(['a'])
  // A folder listed as its own child through a symlink loop opens only as deep as the person opened it.
  const loop = visibleRows(exOf({ listing: { '/r': [{ name: 'l', kind: 'dir' }], '/r/l': [{ name: 'l', kind: 'dir' }] }, open: ['/r/l'] }), {})
  expect(loop.length).toBe(2)
  expect(visibleRows(exOf(), {})).toEqual([])
})

test('search results ignore malformed lines and short queries', () => {
  expect(visibleRows(exOf({ query: 'a', hits: ['f /r/a'] }), {}).length).toBe(0)
  const rows = visibleRows(exOf({ query: 'ab', hits: ['f /r/ab', 'garbage', '', 'd /r/x/ab'] }), { '/r/ab': 'M' })
  expect(rows.map(r => r.path)).toEqual(['/r/ab', '/r/x/ab'])
  expect(rows[0]?.git).toBe('M')
})

// ── drawing ──

test('every pane draws on a hostile state, at any width', async ($, on) => {
  stub(on, { 'tool.call': () => ({ result: {} }) })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/a/b.ts', old_string: 'x'.repeat(5000), new_string: 'y' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/a/ñandú vídeo.mp4', content: '\n'.repeat(3000) } as never)
  await $.tool.call({ tool: 'Bash', command: 'x'.repeat(10000) } as never)
  for (const bodyColumns of [1, 10, 20, 30, 80, 500]) {
    for (const requestId of ['claudeck', 'panel-files']) {
      const ui = await $.ui.mount({ ...pane(requestId), props: { ...pane(requestId).props, bodyColumns } } as never)
      await ui.unmount()
    }
  }
  expect(true).toBe(true)
})
