import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL } from './state'
import type { Section } from '../types'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

const SECTIONS: readonly Section[] = ['session', 'git', 'skills', 'work', 'tasks', 'files', 'status', 'system', 'agents']

export const parseCollapsed = (value: unknown): Section[] => {
  const saved = typeof value === 'object' && value !== null ? (value as { collapsed?: unknown }).collapsed : undefined

  return Array.isArray(saved) ? saved.filter((s): s is Section => SECTIONS.includes(s as Section)) : []
}

// The store write happens after the state update, never inside the reducer: a reducer may run more than once.
export async function toggleSection($: Dollar, section: Section): Promise<void> {
  await update($, panel, p => ({
    ...p,
    collapsed: p.collapsed.includes(section) ? p.collapsed.filter(s => s !== section) : [...p.collapsed, section],
  }))
  const { collapsed } = await read($, panel)
  await $.store.set('ui', { collapsed })
}
