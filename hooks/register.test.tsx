import { expect, test } from 'claude-code/testing'

type Hook = (...args: any[]) => unknown

// Stands for the engine beneath the mod: every call the background refreshes make gets a quiet answer.
// A test swaps one answer through `over`: a hook can only be registered once per test.
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

// Lets the session's background refreshes finish before the test environment goes away.
const wait = (ms: number) => new Promise(done => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => done(undefined), ms))
const settle = () => wait(150)

const pane = (surface: 'terminal' | 'desktop', requestId = 'claudeck') =>
  ({
    plugin: 'claudeck',
    component: 'Pane',
    requestId,
    surface,
    props: { title: 'Panel', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

test('empty session draws both placeholders and the actions line', async ($, on) => {
  stub(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: /el equipo duerme/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /todo intacto/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /aún sin acciones/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /TRABAJO/ })).toBeFalsy()
    await ui.unmount()
  }
})

test('a tool call shows up in the actions line', async ($, on) => {
  stub(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /Bash×1/ })).toBeTruthy()
  await ui.unmount()
})

test('/panel-compact no longer exists', async ($, on) => {
  const registered: string[] = []
  stub(on, {
    'command.register': (_: unknown, e: { name: string }) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(registered.includes('panel')).toBe(true)
  expect(registered.includes('panel-compact')).toBe(false)
  await settle()
})

test('a folded section survives a restart, and an old stored compact flag is ignored', async ($, on) => {
  stub(on, { 'store.get': (_: unknown, e: { key: string }) => ({ value: e.key === 'ui' ? { isCompact: true, collapsed: ['git', 'bogus'] } : undefined }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /GIT/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /sin repositorio aquí/ })).toBeFalsy()
  await ui.unmount()
  await settle()
})

test('toggling a section writes the store after the update, once', async ($, on) => {
  const writes: unknown[] = []
  stub(on, {
    'store.set': (_: unknown, e: { key: string; value: unknown }) => {
      if (e.key === 'ui') writes.push(e.value)
      return { value: undefined }
    },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'head-git' })
  await ui.unmount()

  expect(writes.length).toBe(1)
  expect(writes[0]).toEqual({ collapsed: ['git'] })
  await settle()
})

test('an unknown effort level is shown by name, not as "bajo"', async ($, on) => {
  stub(on, { 'tool.call': () => ({ result: {} }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls', effort: { level: 'ultra' } } as never)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /ultra/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /bajo/ })).toBeFalsy()
  await ui.unmount()
  await settle()
})

test('a repository without commits still shows its branch', async ($, on) => {
  stub(on, {
    'session.cwd': () => ({ value: '/p' }),
    'process.run': (_: unknown, e: { argv: string[] }) => {
      const cmd = e.argv.join(' ')
      if (cmd.startsWith('git rev-parse --abbrev-ref HEAD')) return { value: { exitCode: 128, stdout: '', stderr: 'unknown revision' } }
      if (cmd.startsWith('git symbolic-ref')) return { value: { exitCode: 0, stdout: 'main\n', stderr: '' } }
      if (cmd.startsWith('git rev-parse --show-toplevel')) return { value: { exitCode: 0, stdout: '/p\n', stderr: '' } }
      if (cmd.startsWith('git status')) return { value: { exitCode: 0, stdout: '?? a.txt\n', stderr: '' } }
      return { value: { exitCode: 1, stdout: '', stderr: '' } }
    },
  })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await wait(50)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /main/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /sin repositorio aquí/ })).toBeFalsy()
  await ui.unmount()
  await settle()
})

test('session start prunes stale state files and session end removes its own', async ($, on) => {
  const ran: string[] = []
  stub(on, {
    'process.run': (_: unknown, e: { argv: string[] }) => {
      ran.push(e.argv.join(' '))
      return { value: { exitCode: 1, stdout: '', stderr: '' } }
    },
    'session.end': () => ({ sessionId: 's1' }),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(ran.some(c => c.includes('-delete') && c.includes('agents-*.tsv') && c.includes('working-*'))).toBe(true)

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: undefined } as never)
  expect(ran.some(c => c.includes('rm -f') && c.endsWith('sh s1'))).toBe(true)
  await settle()
})
