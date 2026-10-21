import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInputOf, RenderSurface } from 'claude-code'

import { ping } from './alerts'
import { fire, sid } from './safe'
import { readConfig } from './config'
import { noteActivity, syncAgents } from './agents'
import { loadEffort } from './controls'
import { FILES, PANE, healPanes, openFiles, openPane, pruneFiles, refresh, refreshGit, refreshMcp, refreshSkills } from './data'
import { initExplorer, refreshExplorer, setQuery, wheel } from './explorer'
import { renderFiles } from './filesView'
import { base, clip, duration, lineDiff, money, spark } from './format'
import { pruneStale, removeOwn } from './housekeeping'
import { loadHistory, recordCost } from './history'
import { INITIAL } from './state'
import { settleTodos } from './tasks'
import { parseCollapsed } from './ui'
import { renderPanel } from './view'
import type { Panel } from '../types'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

const MARKS = {
  start: 'mkdir -p ~/.claude/state && echo "start $(date +%s)" > ~/.claude/state/working-"$1"',
  tick: 'mkdir -p ~/.claude/state && f=~/.claude/state/working-"$1"; if grep -q "^start" "$f" 2>/dev/null; then touch "$f"; else echo "start $(date +%s)" > "$f"; fi',
  done: 'mkdir -p ~/.claude/state && echo "done $(date +%s)" > ~/.claude/state/working-"$1"',
  clear: 'rm -f ~/.claude/state/working-"$1"',
}

function mark($: Dollar, sessionId: string, kind: keyof typeof MARKS): void {
  if (sessionId === '') return
  void $.process.run(['sh', '-c', MARKS[kind], 'sh', sessionId], { timeoutMs: 3000 }).catch(() => {})
}

const TEST_RE =
  /(?:^|&&|;|\|\|)\s*((?:npm|pnpm|yarn)(?: run)? (?:test|build|lint)|npx (?:tsc|vitest|jest)|tsc|pytest|vitest|jest|cargo (?:test|build|check)|go (?:test|build)|make)\b/

// Tools that can change files or git state: the explorer and the git card catch up right after them.
const CHANGES_DISK = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// One sync at a time; calls arriving meanwhile collapse into a single rerun, so the last change is never missed.
const sync = { isRunning: false, isQueued: false }

async function syncDisk($: Dollar): Promise<void> {
  if (sync.isRunning) {
    sync.isQueued = true
    return
  }
  sync.isRunning = true
  try {
    await Promise.all([refreshGit($), refreshExplorer($), pruneFiles($)])
  } catch {
    // The next poll retries.
  } finally {
    sync.isRunning = false
    if (sync.isQueued) {
      sync.isQueued = false
      void syncDisk($)
    }
  }
}

// A drawing that throws makes the engine draw its own pane in the panel's place: keep the pane, say what failed.
async function safeRender<T>($: Dollar, e: RenderInputOf<'Pane', RenderSurface>, title: string, draw: () => Promise<T>): Promise<T> {
  try {
    return await draw()
  } catch (error) {
    const { Box, Text } = $.ui.resolve(e)
    const reason = String(error instanceof Error ? error.message : error).slice(0, 200)
    $.ui.log(`claudeck: ${title} could not be drawn: ${reason}`)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="warning">{title}: no se pudo dibujar</Text>
        <Text dimColor wrap="wrap">{reason}</Text>
      </Box>
    ) as unknown as T
  }
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)
  // Panes the person closed by hand: they stay closed until asked for again.
  const closed = new Set<string>()
  const heal = { tries: 0 }

  on('session.start', async ($, e, next) => {
    // The panel is for the terminal only: the VS Code extension runs with another entrypoint.
    const entry = await $.process.run(['sh', '-c', 'printf %s "$CLAUDE_CODE_ENTRYPOINT"'], { timeoutMs: 3000 }).catch(() => undefined)
    if (entry !== undefined && entry.stdout.trim() !== '' && entry.stdout.trim() !== 'cli') return next(e)

    await $.command.register({ name: 'panel', description: 'Show or hide the dashboard pane' })
    await $.command.register({ name: 'archivos', description: 'Open the file explorer tab' })
    await $.command.register({ name: 'buscar', description: 'Search files by name in the explorer (empty clears)' })
    await $.command.register({ name: 'panel-ancho', description: 'Set the panel width in columns (30-120); empty resets it', argumentHint: '[columns]' })
    await $.command.register({ name: 'gasto', description: 'Show the cost of today, this week and the last 14 days' })

    await update($, panel, p => ({ ...INITIAL, ...p, explorer: { ...INITIAL.explorer, ...p.explorer }, check: undefined, running: [], pick: '' as const, agents: (p?.agents ?? []).map(a => ({ ...a, isDone: true })) }))
    const collapsed = parseCollapsed(await $.store.get('ui'))
    await update($, panel, p => ({ ...p, collapsed }))

    closed.clear()
    heal.tries = 0
    mark($, await sid($), 'clear')
    fire(() => pruneStale($))
    void initExplorer($)
      .then(() => openPane($, cfg))
      .then(opened => {
        if (!opened.isPlaced) $.ui.toast('claudeck: la terminal es muy estrecha para el panel; ensánchala o escribe /panel')
      })
      .catch(() => {})
    fire(() => loadHistory($))
    fire(() => refresh($, cfg))
    fire(() => refreshGit($))
    fire(() => refreshMcp($, cfg))
    fire(() => refreshSkills($))
    fire(() => loadEffort($))
    // Polling slows down while nothing runs: a redraw or a git/ls process per tick is wasted on an idle session.
    const isBusy = async (): Promise<boolean> => {
      const p = await read($, panel).catch(() => undefined)
      return p === undefined || p.running.length > 0 || p.agents.some(a => !a.isDone)
    }
    const lastRun: Record<string, number> = {}
    const poll = (key: string, busyMs: number, idleMs: number, work: () => unknown) =>
      $.clock.every(Math.min(busyMs, 1000), () => {
        void (async () => {
          const now = Date.now()
          const gap = now - (lastRun[key] ?? 0)
          if (gap < busyMs - 100) return
          if (gap < idleMs - 100 && !(await isBusy())) return
          lastRun[key] = now
          await work()
        })().catch(() => {})
      })
    poll('tick', 1000, 2000, () =>
      update($, panel, p => {
        const now = Date.now()
        const settled = settleTodos(p.todos, p.todosDoneAt, now, cfg.taskHideSeconds * 1000)

        return { ...p, now, todos: settled.todos, todosDoneAt: settled.doneAt }
      }),
    )
    poll('git', 5000, 20000, () => refreshGit($))
    $.clock.every(3000, () => fire(() => syncAgents($, cfg.agentHideSeconds * 1000)))
    $.clock.every(3000, () => void healPanes($, cfg, closed, heal).catch(() => {}))
    poll('explorer', 8000, 30000, () => refreshExplorer($))
    $.clock.every(cfg.mcpSeconds * 1000, () => fire(() => refreshMcp($, cfg)))
    $.clock.every(cfg.mcpSeconds * 3000, () => fire(() => refreshSkills($)))

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.origin.kind === 'person') closed.add(e.id)

    return next(e)
  })

  on('command.run', { command: 'panel' }, async $ => {
    closed.clear()
    heal.tries = 0
    const opened = await openPane($, cfg).catch(() => ({ isPlaced: false, reason: 'the engine refused to open it' }))

    return {
      text: opened.isPlaced
        ? 'Panel opened. Close it with its close mark.'
        : `Panel not drawn yet: ${opened.reason ?? 'the terminal is too narrow'}. Widen the terminal; it appears by itself.`,
    }
  })

  on('command.run', { command: 'archivos' }, async $ => {
    closed.delete(FILES)
    await openFiles($, cfg)

    return { text: 'File explorer opened.' }
  })

  on('command.run', { command: 'buscar' }, async ($, e) => {
    await openFiles($, cfg)
    await setQuery($, e.args.trim())

    return { text: e.args.trim() === '' ? 'Search cleared.' : `Searching “${e.args.trim()}” in the Archivos tab.` }
  })

  on('command.run', { command: 'panel-ancho' }, async ($, e) => {
    const n = Number(e.args.trim())
    // Plain digits only: Number() would also take 0x30, 1e2 or Infinity.
    if (e.args.trim() === '') await $.store.set('width', null)
    else if (!/^\d{2,3}$/.test(e.args.trim()) || n < 30 || n > 120) return { text: 'Usage: /panel-ancho <30-120>' }
    else await $.store.set('width', n)
    await openPane($, cfg)

    return { text: e.args.trim() === '' ? `Panel width reset to ${cfg.width}.` : `Panel width set to ${n} columns.` }
  })

  on('command.run', { command: 'gasto' }, async $ => {
    const p = await read($, panel)

    return {
      text: `Gasto: hoy ${money(p.today)} · 7 días ${money(p.week)} · sesión ${p.costUsd === undefined ? '—' : money(p.costUsd)}\n14 días ${spark(p.days)}`,
    }
  })

  on('session.end', async ($, e, next) => {
    await removeOwn($, await sid($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    fire(() => refresh($, cfg))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      fire(() => refresh($, cfg))
      await update($, panel, p => ({ ...p, turnStartCost: p.costUsd ?? 0 })).catch(() => {})
      mark($, await sid($), 'start')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      mark($, await sid($), 'done')
      // The turn is over whatever happens to the panel's own bookkeeping: none of it may stop next(e).
      try {
        const out = e.usage?.output_tokens ?? 0
        await update($, panel, p => ({ ...p, tokensOut: p.tokensOut + out }))
        await refresh($, cfg)
        void syncDisk($)
        const p = await read($, panel)
        const spent = (p.costUsd ?? 0) - p.turnStartCost
        if (spent > 0) await update($, panel, q => ({ ...q, turnCosts: [...q.turnCosts, spent].slice(-20) }))
        fire(() => recordCost($, p.costUsd, p.sessionId))
        if (e.reason === 'answer' && e.durationMs >= cfg.notifyMinSeconds * 1000) {
          fire(() => ping($, cfg, 'done', 'Claude terminó', duration(e.durationMs)))
        }
      } catch {
        // The next turn or poll catches the panel up.
      }
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      const level = String(e.effort)
      void update($, panel, p => (p.effort === level ? p : { ...p, effort: level })).catch(() => {})
    }

    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    if (e.agentId === undefined) mark($, await sid($), 'tick')
    // The turn's real effort (what the status line shows), so a /effort typed in the prompt shows here too.
    const turnEffort = (e as { effort?: { level?: string } }).effort?.level
    if (e.agentId === undefined && typeof turnEffort === 'string' && turnEffort !== '') {
      void update($, panel, p => (p.effort === turnEffort ? p : { ...p, effort: turnEffort })).catch(() => {})
    }
    const path = typeof input.file_path === 'string' ? input.file_path : undefined
    const label =
      e.tool === 'Bash'
        ? `Bash ${clip(String(input.command ?? ''), 40)}`
        : path !== undefined
          ? `${e.tool} ${base(path)}`
          : e.tool
    const run = { id: e.tool_use_id, label, since: Date.now() }
    if (e.agentId !== undefined) {
      noteActivity(e.agentId, label)
      fire(() => syncAgents($, cfg.agentHideSeconds * 1000))
    }
    await update($, panel, p => ({
      ...p,
      running: [...p.running, run],
      toolCounts: { ...p.toolCounts, [e.tool]: (p.toolCounts[e.tool] ?? 0) + 1 },
    })).catch(() => {})

    if (e.tool === 'TodoWrite') {
      const todos = Array.isArray(input.todos) ? (input.todos as Panel['todos']) : []
      await update($, panel, p => ({
        ...p,
        todos: todos.map(t => ({ content: t.content, status: t.status })),
      })).catch(() => {})
    }

    // Write replaces the whole file: read what was there to count real line changes.
    const before = e.tool === 'Write' && path !== undefined ? await $.fs.read(path).catch(() => '') : ''

    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      ran = await next(e)
      return ran
    } finally {
      const isOk = ran !== undefined && ran.deny === undefined && ran.isError !== true
      const diff =
        !isOk || path === undefined
          ? { added: 0, removed: 0 }
          : e.tool === 'Write'
            ? lineDiff(typeof before === 'string' ? before : '', String(input.content ?? ''))
            : e.tool === 'Edit'
              ? lineDiff(String(input.old_string ?? ''), String(input.new_string ?? ''))
              : { added: 0, removed: 0 }
      const checked = e.tool === 'Bash' ? TEST_RE.exec(String(input.command ?? '')) : null
      const result = (isOk ? ran?.result : undefined) as { task?: { id?: string; subject?: string } } | undefined

      if (CHANGES_DISK.has(e.tool)) void syncDisk($)
      await update($, panel, p => ({
        ...p,
        running: p.running.filter(one => one.id !== run.id),
        todos:
          !isOk
            ? p.todos
            : e.tool === 'TaskCreate' && result?.task?.id !== undefined
              ? [...p.todos, { id: result.task.id, content: String(input.subject ?? result.task.subject ?? ''), status: 'pending' as const }]
              : e.tool === 'TaskUpdate'
                ? input.status === 'deleted'
                  ? p.todos.filter(t => t.id !== input.taskId)
                  : p.todos.map(t =>
                      t.id === input.taskId
                        ? {
                            ...t,
                            content: typeof input.subject === 'string' ? input.subject : t.content,
                            status: (input.status as Panel['todos'][number]['status'] | undefined) ?? t.status,
                          }
                        : t,
                    )
                : p.todos,
        files:
          path !== undefined && (diff.added > 0 || diff.removed > 0)
            ? {
                ...p.files,
                [path]: {
                  added: (p.files[path]?.added ?? 0) + diff.added,
                  removed: (p.files[path]?.removed ?? 0) + diff.removed,
                },
              }
            : p.files,
        check:
          checked !== null && ran !== undefined
            ? { label: clip(checked[1] ?? '', 24), isOk, at: Date.now() }
            : p.check,
      })).catch(() => {})
    }
  })

  on('agent.spawn', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      fire(() => syncAgents($, cfg.agentHideSeconds * 1000))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => safeRender($, e, 'Panel', () => renderPanel($, e, cfg)))

  on('ui.scroll', { component: 'Pane', requestId: FILES }, async ($, e) => {
    await wheel($, e.by, e.bodyRows)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: FILES }, async ($, e) => safeRender($, e, 'Archivos', () => renderFiles($, e, cfg)))
}
