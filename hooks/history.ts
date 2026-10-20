import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL } from './state'
import type { Panel } from '../types'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface
type Days = Record<string, Record<string, number>>

const KEY = 'cost-days'
const DAY = 86400000

const pad = (n: number): string => String(n).padStart(2, '0')

export const dayKey = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const isDays = (value: unknown): value is Days => typeof value === 'object' && value !== null && !Array.isArray(value)

// Each entry is a session's running total on that day; a session that spans midnight
// only adds to a day what it spent beyond its total on earlier days.
export const spentPerDay = (days: Days): Record<string, number> => {
  const seen: Record<string, number> = {}
  const out: Record<string, number> = {}
  for (const day of Object.keys(days).sort()) {
    for (const [session, usd] of Object.entries(days[day] ?? {})) {
      out[day] = (out[day] ?? 0) + Math.max(0, usd - (seen[session] ?? 0))
      seen[session] = Math.max(seen[session] ?? 0, usd)
    }
  }
  return out
}

export const series = (days: Days, now: number): number[] => {
  const spent = spentPerDay(days)
  return Array.from({ length: 14 }, (_, i) => spent[dayKey(now - (13 - i) * DAY)] ?? 0)
}

async function apply($: Dollar, days: Days): Promise<void> {
  const now = Date.now()
  const values = series(days, now)
  await update($, panel, p => ({
    ...p,
    days: values,
    today: values[13] ?? 0,
    week: values.slice(7).reduce((sum, usd) => sum + usd, 0),
  }))
}

export async function loadHistory($: Dollar): Promise<void> {
  const raw = await $.store.get(KEY)
  await apply($, isDays(raw) ? raw : {})
}

export async function recordCost($: Dollar, usd: number | undefined, sessionId: string): Promise<void> {
  if (usd === undefined || sessionId === '') return
  const raw = await $.store.get(KEY)
  const days: Days = isDays(raw) ? raw : {}
  const today = dayKey(Date.now())
  const kept = Object.keys(days).sort().slice(-44)
  const next: Days = Object.fromEntries(kept.map(k => [k, days[k]!]))
  next[today] = { ...(next[today] ?? {}), [sessionId]: usd }
  await $.store.set(KEY, next)
  await apply($, next)
}
