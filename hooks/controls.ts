import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL } from './state'
import type { Panel } from '../types'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

export const MODELS: { id: string; label: string; color: string; note: string }[] = [
  { id: 'fable', label: 'Fable', color: '#fab387', note: 'creativo y rápido de ideas' },
  { id: 'opus', label: 'Opus', color: '#cba6f7', note: 'profundo, para lo difícil' },
  { id: 'sonnet', label: 'Sonnet', color: '#89b4fa', note: 'equilibrado, el de diario' },
  { id: 'haiku', label: 'Haiku', color: '#a6e3a1', note: 'ligero y veloz' },
]

export const EFFORTS: { id: string; label: string; note: string }[] = [
  { id: 'low', label: 'bajo', note: 'respuestas al vuelo' },
  { id: 'medium', label: 'medio', note: 'equilibrado' },
  { id: 'high', label: 'alto', note: 'piensa a fondo' },
  { id: 'xhigh', label: 'muy alto', note: 'intenso, tareas largas' },
  { id: 'max', label: 'máximo', note: 'sin límites, el más lento' },
]

export async function togglePick($: Dollar, which: Exclude<Panel['pick'], ''>): Promise<void> {
  await update($, panel, p => {
    const pick: Panel['pick'] = p.pick === which ? '' : which
    return { ...p, pick }
  })
}

export async function setModel($: Dollar, id: string): Promise<void> {
  await update($, panel, p => ({ ...p, pick: '' as const }))
  const out = await $.command.run({ command: 'model', args: id }).catch(() => undefined)
  const model = await $.session.model().catch(() => id)
  await update($, panel, p => ({ ...p, model }))
  $.ui.toast(out?.text !== undefined && out.text !== '' ? out.text.slice(0, 80) : `modelo: ${model}`)
}

export async function setEffort($: Dollar, level: string): Promise<void> {
  await update($, panel, p => ({ ...p, pick: '' as const }))
  const out = await $.command.run({ command: 'effort', args: level }).catch(() => undefined)
  await update($, panel, p => ({ ...p, effort: level }))
  $.ui.toast(out?.text !== undefined && out.text !== '' ? out.text.slice(0, 80) : `esfuerzo: ${level}`)
}

export async function loadEffort($: Dollar): Promise<void> {
  const out = await $.process
    .run(['sh', '-c', 'cat "$HOME/.claude/settings.json" 2>/dev/null'], { timeoutMs: 3000 })
    .catch(() => undefined)
  const level = out === undefined ? undefined : /"effortLevel"\s*:\s*"(\w+)"/.exec(out.stdout)?.[1]
  if (level !== undefined && (await read($, panel)).effort === '') await update($, panel, p => ({ ...p, effort: level }))
}
