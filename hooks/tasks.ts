import type { Panel } from '../types'

type Todos = Panel['todos']

export const isAllDone = (todos: Todos): boolean => todos.length > 0 && todos.every(t => t.status === 'completed')

// Notes when the whole list became completed and, once it has stayed so for `hideMs`, drops it.
// A later TaskCreate then starts a fresh list; 0 keeps a finished list on screen for good.
export const settleTodos = (
  todos: Todos,
  doneAt: number | undefined,
  now: number,
  hideMs: number,
): { todos: Todos; doneAt: number | undefined } => {
  if (!isAllDone(todos)) return { todos, doneAt: undefined }
  const since = doneAt ?? now
  if (hideMs > 0 && now - since >= hideMs) return { todos: [], doneAt: undefined }

  return { todos, doneAt: since }
}
