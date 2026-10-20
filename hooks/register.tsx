import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { ping } from './alerts'
import { readConfig } from './config'
import { noteActivity, syncAgents } from './agents'
import { loadEffort } from './controls'
import { FILES, PANE, openFiles, openPane, refresh, refreshGit, refreshMcp, refreshSkills } from './data'
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

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'panel', description: 'Show or hide the dashboard pane' })
    await $.command.register({ name: 'archivos', description: 'Open the file explorer tab' })
    await $.command.register({ name: 'buscar', description: 'Search files by name in the explorer (empty clears)' })
    await $.command.register({ name: 'panel-ancho', description: 'Set the panel width in columns (30-120); empty resets it', argumentHint: '[columns]' })
    await $.command.register({ name: 'gasto', description: 'Show the cost of today, this week and the last 14 days' })

    await update($, panel, p => ({ ...INITIAL, ...p, explorer: { ...INITIAL.explorer, ...p.explorer }, check: undefined, running: [], pick: '' as const, agents: (p?.agents ?? []).map(a => ({ ...a, isDone: true })) }))
    const collapsed = parseCollapsed(await $.store.get('ui'))
    await update($, panel, p => ({ ...p, collapsed }))

    mark($, await $.session.id(), 'clear')
    void pruneStale($)
    void initExplorer($).then(() => openPane($, cfg))
    void loadHistory($)
    void refresh($, cfg)
    void refreshGit($)
    void refreshMcp($, cfg)
    void refreshSkills($)
    void loadEffort($)
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
    $.clock.every(3000, () => void syncAgents($))
    poll('explorer', 8000, 30000, () => refreshExplorer($))
    $.clock.every(cfg.mcpSeconds * 1000, () => void refreshMcp($, cfg))
    $.clock.every(cfg.mcpSeconds * 3000, () => void refreshSkills($))

    return next(e)
  })

  on('command.run', { command: 'panel' }, async $ => {
    await openPane($, cfg)

    return { text: 'Panel opened. Close it with its close mark.' }
  })

  on('command.run', { command: 'archivos' }, async $ => {
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
    if (e.args.trim() === '') await $.store.set('width', null)
    else if (!Number.isInteger(n) || n < 30 || n > 120) return { text: 'Usage: /panel-ancho <30-120>' }
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
    await removeOwn($, await $.session.id().catch(() => ''))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    void refresh($, cfg)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      void refresh($, cfg)
      await update($, panel, p => ({ ...p, turnStartCost: p.costUsd ?? 0 }))
      mark($, await $.session.id(), 'start')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      mark($, await $.session.id(), 'done')
      const out = e.usage?.output_tokens ?? 0
      await update($, panel, p => ({ ...p, tokensOut: p.tokensOut + out }))
      await refresh($, cfg)
      void refreshGit($)
      const p = await read($, panel)
      const spent = (p.costUsd ?? 0) - p.turnStartCost
      if (spent > 0) await update($, panel, q => ({ ...q, turnCosts: [...q.turnCosts, spent].slice(-20) }))
      void recordCost($, p.costUsd, p.sessionId)
      if (e.reason === 'answer' && e.durationMs >= cfg.notifyMinSeconds * 1000) {
        void ping($, cfg, 'done', 'Claude terminó', duration(e.durationMs))
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
    if (e.agentId === undefined) mark($, await $.session.id(), 'tick')
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
      void syncAgents($)
    }
    await update($, panel, p => ({
      ...p,
      running: [...p.running, run],
      toolCounts: { ...p.toolCounts, [e.tool]: (p.toolCounts[e.tool] ?? 0) + 1 },
    })).catch(() => {})

    if (e.tool === 'TodoWrite') {
      const todos = (input.todos as Panel['todos'] | undefined) ?? []
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
      void syncAgents($)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => renderPanel($, e, cfg))

  on('ui.scroll', { component: 'Pane', requestId: FILES }, async ($, e) => {
    await wheel($, e.by, e.bodyRows)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: FILES }, async ($, e) => renderFiles($, e, cfg))
}
