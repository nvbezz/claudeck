import type { Config } from './config'
import type { Sample } from '../types'

const BLOCKS = '▁▂▃▄▅▆▇█'

export const base = (path: string): string => path.split('/').pop() ?? path

export const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text

export const lines = (text: unknown): number =>
  typeof text === 'string' && text !== '' ? text.split('\n').length : 0

// Line changes between two texts, counted as a multiset: lines kept in both are not changes.
export const lineDiff = (before: string, after: string): { added: number; removed: number } => {
  const left = new Map<string, number>()
  for (const line of before === '' ? [] : before.split('\n')) left.set(line, (left.get(line) ?? 0) + 1)
  let added = 0
  for (const line of after === '' ? [] : after.split('\n')) {
    const n = left.get(line) ?? 0
    if (n > 0) left.set(line, n - 1)
    else added++
  }
  const removed = [...left.values()].reduce((sum, n) => sum + n, 0)
  return { added, removed }
}

export const duration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

export const compact = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

export const money = (usd: number): string => `$${usd.toFixed(2)}`

export const shortPath = (path: string): string => {
  const tail = path.split('/').filter(Boolean).pop()
  return tail === undefined ? '/' : tail
}

export const prettyModel = (id: string): string => {
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id)
  if (m === null) return id || '—'
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  return m[3] === undefined ? `${name} ${m[2]}` : `${name} ${m[2]}.${m[3]}`
}

export const isFiveHour = (kind: string): boolean => /five|5/.test(kind)

export const limitLabel = (kind: string): string =>
  isFiveHour(kind) ? '5h' : /seven|week|7/.test(kind) ? 'sem' : kind.slice(0, 4)

export const toMs = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  if (/^\d+$/.test(value)) {
    const n = Number(value)
    return n < 1e11 ? n * 1000 : n
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const until = (value: string | undefined, now: number): string => {
  const at = toMs(value)
  if (at === undefined || at <= now) return ''
  const m = Math.floor((at - now) / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export const level = (percent: number | undefined, cfg: Config): 'inactive' | 'success' | 'warning' | 'error' =>
  percent === undefined ? 'inactive' : percent >= cfg.ctxCrit ? 'error' : percent >= cfg.ctxWarn ? 'warning' : 'success'

export const spark = (values: number[], max?: number): string => {
  if (values.length === 0) return ''
  const top = max ?? Math.max(...values, 1)
  return values
    .map(v => BLOCKS[Math.min(7, Math.max(0, Math.round((v / top) * 7)))])
    .join('')
}

export const project = (
  samples: Sample[],
  resetsAt: string | undefined,
  now: number,
): { text: string; tone: 'success' | 'warning' | 'error' | 'inactive' } => {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (first === undefined || last === undefined || last.t - first.t < 300000 || last.p <= first.p) {
    return { text: 'estable', tone: 'inactive' }
  }
  const rate = (last.p - first.p) / (last.t - first.t)
  const fillMs = (100 - last.p) / rate
  const reset = (toMs(resetsAt) ?? Infinity) - now
  return fillMs > reset
    ? { text: 'aguanta', tone: 'success' }
    : { text: `llena en ${duration(fillMs)}`, tone: fillMs < 3600000 ? 'error' : 'warning' }
}

// Which of the known effort levels is active; an unknown one (a new level, or none yet) lights no dot and keeps its own name.
export const effortView = (
  effort: string,
  known: readonly { id: string; label: string }[],
): { index: number; label: string; dots: string } => {
  const index = known.findIndex(one => one.id === effort)
  if (index < 0) return { index: -1, label: effort === '' ? 'auto' : effort, dots: '○'.repeat(known.length) }

  return { index, label: known[index]?.label ?? effort, dots: '●'.repeat(index + 1) + '○'.repeat(known.length - index - 1) }
}

// A commit row is "├─ hash subject age": the subject gives way so the age never falls off the panel's edge.
export const fitCommit = (subject: string, inner: number, age: string): string =>
  clip(subject, Math.max(8, inner - 3 - 3 - 8 - 1 - age.length))
