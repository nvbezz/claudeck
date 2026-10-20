import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL } from './state'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

const LIVE = new Set(['pending', 'running', 'waiting'])

// What each subagent is doing now, by agent id: its latest tool call (kept in module memory).
const activity = new Map<string, { label: string; since: number }>()
const firstSeen = new Map<string, number>()
const endedAt = new Map<string, number>()
let home: string | undefined
let lastWritten: string | undefined
let lastWriteAt = 0

// A finished agent stays listed for `hideMs`, then goes; 0 keeps it. A running one is always listed.
export const keepAgent = (isDone: boolean, ended: number | undefined, now: number, hideMs: number): boolean =>
  !isDone || hideMs <= 0 || ended === undefined || now - ended < hideMs

export function noteActivity(agentId: string, label: string): void {
  activity.set(agentId, { label, since: Date.now() })
}

const clean = (text: string): string => text.replace(/[\t\n\r]+/g, ' ').trim()

// Syncs the panel's agent list with the engine's and writes the live ones for the status line:
// ~/.claude/state/agents-<session>.tsv, one "type<TAB>description<TAB>activity<TAB>since" row each.
export async function syncAgents($: Dollar, hideMs: number): Promise<void> {
  // A failed listing says nothing about the agents: keep what the panel shows instead of emptying it.
  const list = await $.agent.list().catch(() => undefined)
  if (list === undefined) return
  const now = Date.now()
  // Forget agents the engine no longer lists, so these maps cannot grow for the whole session.
  const known = new Set(list.map(one => one.id))
  for (const id of [...firstSeen.keys()]) if (!known.has(id)) firstSeen.delete(id)
  for (const id of [...endedAt.keys()]) if (!known.has(id)) endedAt.delete(id)
  for (const id of [...activity.keys()]) if (!known.has(id)) activity.delete(id)
  for (const one of list) {
    if (!firstSeen.has(one.id)) firstSeen.set(one.id, now)
    if (LIVE.has(one.status)) endedAt.delete(one.id)
    else if (!endedAt.has(one.id)) endedAt.set(one.id, now)
  }
  const live = list.filter(one => LIVE.has(one.status) && one.teammateId === undefined)

  await update($, panel, p => ({
    ...p,
    // Same set the status line counts: teammates are not subagents.
    agents: list.filter(one => one.teammateId === undefined && keepAgent(!LIVE.has(one.status), endedAt.get(one.id), now, hideMs)).slice(-20).map(one => ({
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
