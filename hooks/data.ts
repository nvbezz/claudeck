import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { checkAlerts, ping } from './alerts'
import type { Config } from './config'
import { isFiveHour } from './format'
import { INITIAL } from './state'
import type { Panel } from '../types'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

export const PANE = 'claudeck'
export const FILES = 'panel-files'

// The width saved with /panel-ancho wins over the configured one.
async function width($: Dollar, cfg: Config): Promise<number> {
  const saved = await $.store.get('width')
  return typeof saved === 'number' && saved >= 30 ? saved : cfg.width
}

export async function openPane($: Dollar, cfg: Config): Promise<void> {
  const columns = await width($, cfg)
  await $.ui.open({ id: FILES, title: cfg.isIcons ? '\u{f0645} Archivos' : 'Archivos', columns })
  await $.ui.open({ id: PANE, title: cfg.isIcons ? '\u{f056e} Panel' : 'Panel', columns })
}

export async function openFiles($: Dollar, cfg: Config): Promise<void> {
  await $.ui.open({ id: FILES, title: cfg.isIcons ? '\u{f0645} Archivos' : 'Archivos', columns: await width($, cfg), focus: true })
}

export async function refresh($: Dollar, cfg: Config): Promise<void> {
  const [model, turns, cwd, usage, id] = await Promise.all([
    $.session.model(),
    $.session.turns(),
    $.session.cwd(),
    $.session.usage(),
    $.session.id(),
  ])
  const five = usage.rateLimits.find(r => isFiveHour(r.kind))
  const now = Date.now()
  await update($, panel, p => {
    const pct = usage.context.percent
    const lastCtx = p.ctxHist[p.ctxHist.length - 1]
    const ctxHist =
      pct !== undefined && (lastCtx === undefined || Math.round(lastCtx) !== Math.round(pct))
        ? [...p.ctxHist, pct].slice(-16)
        : p.ctxHist
    const lastSample = p.limitSamples[p.limitSamples.length - 1]
    // A drop means the 5h window reset: older samples belong to the previous window.
    const limitSamples =
      five === undefined || (lastSample !== undefined && lastSample.p === five.percentUsed)
        ? p.limitSamples
        : lastSample !== undefined && five.percentUsed < lastSample.p
          ? [{ t: now, p: five.percentUsed }]
          : [...p.limitSamples, { t: now, p: five.percentUsed }].slice(-40)
    return {
      ...p,
      model,
      turns,
      cwd,
      sessionId: id,
      startedAt: usage.startedAt,
      ctxPercent: pct,
      ctxTokens: usage.context.tokens,
      ctxWindow: usage.context.window,
      ctxHist,
      costUsd: usage.cost?.usd,
      limits: usage.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
      limitSamples,
    }
  })
  await checkAlerts($, cfg)
}

const NO_GIT = {
  branch: '',
  dirty: 0,
  gitRoot: '',
  gitMap: {},
  ahead: 0,
  behind: 0,
  upstream: '',
  staged: 0,
  unstaged: 0,
  untracked: 0,
  commits: [],
  changes: [],
}

const gitCode = (xy: string): string => {
  if (xy === '??') return 'U'
  if (xy.includes('D')) return 'D'
  if (xy.includes('A')) return 'A'
  if (xy.includes('R')) return 'R'
  return 'M'
}

export async function refreshGit($: Dollar): Promise<void> {
  const cwd = await $.session.cwd()
  let head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 3000 })
  // A repository with no commits yet has no HEAD to resolve, but it still has a branch name.
  if (head.exitCode !== 0) head = await $.process.run(['git', 'symbolic-ref', '--short', '-q', 'HEAD'], { cwd, timeoutMs: 3000 })
  if (head.exitCode !== 0) {
    await update($, panel, p => ({ ...p, ...NO_GIT }))
    return
  }
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 3000 })
  const status = await $.process.run(['git', 'status', '--porcelain'], { cwd, timeoutMs: 3000 })
  const [log, counts, upstream, numstat] = await Promise.all([
    $.process.run(['git', 'log', '-n', '8', '--pretty=format:%h%x1f%s%x1f%ct%x1f%an'], { cwd, timeoutMs: 3000 }),
    $.process.run(['git', 'rev-list', '--left-right', '--count', '@{u}...HEAD'], { cwd, timeoutMs: 3000 }),
    $.process.run(['git', 'rev-parse', '--abbrev-ref', '@{u}'], { cwd, timeoutMs: 3000 }),
    $.process.run(['git', 'diff', 'HEAD', '--numstat'], { cwd, timeoutMs: 3000 }),
  ])
  const stats: Record<string, { added: number; removed: number }> = {}
  for (const line of numstat.exitCode === 0 ? numstat.stdout.split('\n') : []) {
    const [a = '0', r = '0', ...rest] = line.split('\t')
    if (rest.length > 0) stats[rest.join('\t')] = { added: Number(a) || 0, removed: Number(r) || 0 }
  }
  const commits = log.exitCode !== 0 ? [] : log.stdout.split('\n').filter(l => l !== '').map(l => {
    const [hash = '', subject = '', ct = '0', author = ''] = l.split('\x1f')
    return { hash, subject, at: Number(ct) * 1000, author }
  })
  const [behind = 0, ahead = 0] = counts.exitCode !== 0 ? [] : counts.stdout.trim().split(/\s+/).map(Number)
  const gitRoot = top.stdout.trim()
  const changed = status.stdout.split('\n').filter(line => line.trim() !== '')
  const gitMap: Record<string, string> = {}
  const lead = (xy: string) => xy[0] !== undefined && xy[0] !== ' ' && xy[0] !== '?'
  const staged = changed.filter(l => lead(l.slice(0, 2))).length
  const untracked = changed.filter(l => l.startsWith('??')).length
  const unstaged = changed.filter(l => !l.startsWith('??') && l[1] !== ' ').length
  for (const line of changed.slice(0, 500)) {
    const raw = line.slice(3).split(' -> ').pop() ?? ''
    const path = raw.replace(/^"|"$/g, '').replace(/\/$/, '')
    gitMap[`${gitRoot}/${path}`] = gitCode(line.slice(0, 2))
  }
  const changes = changed.slice(0, 40).map(line => {
    const path = (line.slice(3).split(' -> ').pop() ?? '').replace(/^"|"$/g, '')
    return { path, code: gitCode(line.slice(0, 2)), added: stats[path]?.added ?? 0, removed: stats[path]?.removed ?? 0 }
  })
  await update($, panel, p => ({
    ...p,
    branch: head.stdout.trim(),
    dirty: changed.length,
    gitRoot,
    gitMap,
    ahead,
    behind,
    upstream: upstream.exitCode === 0 ? upstream.stdout.trim() : '',
    staged,
    unstaged,
    untracked,
    commits,
    changes,
  }))
}

export async function refreshMcp($: Dollar, cfg: Config): Promise<void> {
  const out = await $.process.run(['claude', 'mcp', 'list'], { cwd: await $.session.cwd(), timeoutMs: 30000 })
  if (out.exitCode !== 0) return
  const mcp = out.stdout
    .split('\n')
    .filter(line => /Connected|Failed|authentication/i.test(line) && line.includes(': '))
    .map(line => ({
      name: line.slice(0, line.indexOf(': ')).trim(),
      isUp: /Connected/.test(line) && !/Failed/.test(line),
    }))
  const before = (await read($, panel)).mcp
  await update($, panel, p => ({ ...p, mcp }))
  for (const one of mcp) {
    if (!one.isUp && before.some(b => b.name === one.name && b.isUp)) {
      await ping($, cfg, 'error', 'MCP caído', one.name)
    }
  }
}

export async function refreshSkills($: Dollar): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  const listed = usage?.context.breakdown?.skills
  if (listed !== undefined) {
    const bySource: Record<string, number> = {}
    for (const one of listed.skillFrontmatter) bySource[one.source] = (bySource[one.source] ?? 0) + 1
    await update($, panel, p => ({ ...p, skills: { total: listed.totalSkills, bySource } }))
  }
  const out = await $.process.run(['claude', 'plugin', 'list'], { cwd: await $.session.cwd(), timeoutMs: 20000 }).catch(() => undefined)
  if (out === undefined || out.exitCode !== 0) return
  const plugins: { name: string; isOn: boolean }[] = []
  for (const line of out.stdout.split('\n')) {
    const name = /^\s*❯\s+(\S+?)(?:@\S+)?\s*$/.exec(line)?.[1]
    if (name !== undefined) plugins.push({ name, isOn: true })
    else if (/Status:/.test(line) && plugins.length > 0) {
      const last = plugins[plugins.length - 1]
      if (last !== undefined) last.isOn = /enabled|loaded/.test(line) && !/disabled/.test(line)
    }
  }
  await update($, panel, p => ({ ...p, plugins }))
}
