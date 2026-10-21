export type FileStat = { added: number; removed: number }
export type Todo = { id?: string; content: string; status: 'pending' | 'in_progress' | 'completed' }
export type Running = { id: string; label: string; since: number }
export type Agent = { id: string; name: string; since: number; isDone: boolean; end?: 'ok' | 'failed' | 'stopped' }
export type Mcp = { name: string; isUp: boolean }
export type PluginInfo = { name: string; isOn: boolean }
export type Skills = { total: number; bySource: Record<string, number> }
export type Check = { label: string; isOk: boolean; at: number }
export type Limit = { kind: string; percent: number; resetsAt: string | undefined }
export type Sample = { t: number; p: number }
export type Entry = { name: string; kind: 'file' | 'dir' | 'other' }
// `file` is the PNG the terminal draws; `width` and `height` are the original's pixels (0 when unknown).
export type PreviewImage = { file: string; width: number; height: number }
export type Preview = { path: string; lines: string[]; top?: number; left?: number; image?: PreviewImage }
export type Change = { path: string; code: string; added: number; removed: number }
export type Explorer = {
  offset: number
  trail: string[]
  selected: string
  query: string
  hits: string[]
  preview: Preview | undefined
  root: string
  open: string[]
  listing: Record<string, Entry[]>
  isHidden: boolean
}
export type Commit = { hash: string; subject: string; at: number; author: string }
export type Section = 'session' | 'git' | 'skills' | 'work' | 'tasks' | 'files' | 'status' | 'system' | 'agents'

export type Panel = {
  now: number
  startedAt: number
  sessionId: string
  model: string
  cwd: string
  branch: string
  dirty: number
  gitRoot: string
  ahead: number
  behind: number
  upstream: string
  staged: number
  unstaged: number
  untracked: number
  commits: Commit[]
  changes: Change[]
  turnCosts: number[]
  turnStartCost: number
  gitMap: Record<string, string>
  explorer: Explorer
  ctxPercent: number | undefined
  ctxTokens: number | undefined
  ctxWindow: number
  ctxHist: number[]
  costUsd: number | undefined
  limits: Limit[]
  limitSamples: Sample[]
  tokensOut: number
  turns: number
  todos: Todo[]
  running: Running[]
  files: Record<string, FileStat>
  agents: Agent[]
  toolCounts: Record<string, number>
  mcp: Mcp[]
  pick: '' | 'model' | 'effort'
  effort: string
  plugins: PluginInfo[]
  skills: Skills
  check: Check | undefined
  days: number[]
  today: number
  week: number
  alerted: string[]
  collapsed: Section[]
  todosDoneAt: number | undefined
}

declare module 'claude-code' {
  interface PluginState {
    'claudeck': { panel: Panel }
  }
}
