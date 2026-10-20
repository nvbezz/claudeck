import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL } from './state'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

const LIVE = new Set(['pending', 'running', 'waiting'])

// What each subagent is doing now, by agent id: its latest tool call (kept in module memory).
const activity = new Map<string, { label: string; since: number }>()
const firstSeen = new Map<string, number>()
let home: string | undefined
let lastWritten: string | undefined
let lastWriteAt = 0

export function noteActivity(agentId: string, label: string): void {
  activity.set(agentId, { label, since: Date.now() })
}

const clean = (text: string): string => text.replace(/[\t\n\r]+/g, ' ').trim()

// Syncs the panel's agent list with the engine's and writes the live ones for the status line:
// ~/.claude/state/agents-<session>.tsv, one "type<TAB>description<TAB>activity<TAB>since" row each.
export async function syncAgents($: Dollar): Promise<void> {
  const list = await $.agent.list().catch(() => [])
  const now = Date.now()
  for (const one of list) if (!firstSeen.has(one.id)) firstSeen.set(one.id, now)
  const live = list.filter(one => LIVE.has(one.status) && one.teammateId === undefined)

  await update($, panel, p => ({
    ...p,
    // Same set the status line counts: teammates are not subagents.
    agents: list.filter(one => one.teammateId === undefined).slice(-20).map(one => ({
      id: one.id,
      name: one.description || one.type,
      since: firstSeen.get(one.id) ?? now,
      isDone: !LIVE.has(one.status),
      end: one.status === 'killed' ? ('stopped' as const) : one.status === 'failed' ? ('failed' as const) : ('ok' as const),
    })),
  })).catch(() => {})

  if (home === undefined) {
    const out = await $.process.run(['sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 3000 }).catch(() => undefined)
    home = out?.stdout.trim() || undefined
    if (home === undefined) return
  }
  const sessionId = (await read($, panel)).sessionId || (await $.session.id())
  const rows = live.map(one => {
    const act = activity.get(one.id)
    const since = Math.floor((act?.since ?? firstSeen.get(one.id) ?? now) / 1000)
    return [clean(one.type), clean(one.description), clean(act?.label ?? 'pensando'), String(since)].join('\t')
  })
  const body = rows.length === 0 ? '' : `${rows.join('\n')}\n`
  // The status line treats a file older than 30 s as "no agents": rewrite unchanged rows only to keep it fresh.
  if (body === lastWritten && Date.now() - lastWriteAt < 15000) return
  lastWritten = body
  lastWriteAt = Date.now()
  await $.fs.write(`${home}/.claude/state/agents-${sessionId}.tsv`, body).catch(() => {})
}
