import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { detectOs, openCommand } from './platform'
import { INITIAL } from './state'
import type { Entry, Explorer } from '../types'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface
export type Row = { path: string; name: string; depth: number; kind: Entry['kind']; git: string | undefined }

const IGNORED = new Set(['node_modules', '.git', '__pycache__', '.next', 'dist', 'build', 'target', '.venv', '.cache'])
const MAX_ROWS = 400
// Rows the Archivos tab's fixed parts take: header (6 + margin), selection (2), tree frame (2), footer (1).
export const TREE_FIXED_ROWS = 12
export const treeHeight = (bodyRows: number): number => Math.max(6, bodyRows - TREE_FIXED_ROWS)

const join = (dir: string, name: string): string => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

const parent = (path: string): string => {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

async function listDir($: Dollar, dir: string): Promise<Entry[]> {
  const raw = await $.fs.list(dir).catch(() => [])
  return raw
    .map(one => ({ name: one.name, kind: one.kind }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
}

export async function loadDir($: Dollar, dir: string): Promise<void> {
  const entries = await listDir($, dir)
  await update($, panel, p => ({
    ...p,
    explorer: { ...p.explorer, listing: { ...p.explorer.listing, [dir]: entries } },
  }))
}

export async function setRoot($: Dollar, root: string): Promise<void> {
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, root, open: [], listing: {}, offset: 0 } }))
  await loadDir($, root)
}

export async function initExplorer($: Dollar): Promise<void> {
  const cwd = await $.session.cwd()
  await setRoot($, cwd)
}

export async function refreshExplorer($: Dollar): Promise<void> {
  const ex = (await read($, panel)).explorer
  if (ex.root === '') return
  for (const dir of [ex.root, ...ex.open]) await loadDir($, dir)
}

export async function toggleDir($: Dollar, dir: string): Promise<void> {
  const ex = (await read($, panel)).explorer
  if (ex.open.includes(dir)) {
    await update($, panel, p => ({ ...p, explorer: { ...p.explorer, open: p.explorer.open.filter(d => d !== dir) } }))
    return
  }
  await loadDir($, dir)
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, open: [...p.explorer.open, dir] } }))
}

export async function goUp($: Dollar): Promise<void> {
  const ex = (await read($, panel)).explorer
  if (ex.root === '/') return
  await setRoot($, parent(ex.root))
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, trail: [...(ex.trail ?? []), ex.root].slice(-30) } }))
}

// Goes back down into the folder the last "subir" came from.
export async function goDown($: Dollar): Promise<void> {
  const trail = (await read($, panel)).explorer.trail ?? []
  const last = trail[trail.length - 1]
  if (last === undefined) return
  await setRoot($, last)
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, trail: trail.slice(0, -1) } }))
}

export async function goHome($: Dollar): Promise<void> {
  await initExplorer($)
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, trail: [] } }))
}

export async function toggleHidden($: Dollar): Promise<void> {
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, isHidden: !p.explorer.isHidden } }))
}

export async function selectFile($: Dollar, path: string): Promise<void> {
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, selected: path, preview: undefined } }))
}

export async function openFile($: Dollar, path: string): Promise<void> {
  const command = openCommand(await detectOs($), path)
  const out = command === undefined ? undefined : await $.process.run(command, { timeoutMs: 5000 }).catch(() => undefined)
  $.ui.toast(out !== undefined && out.exitCode === 0 ? `abriendo ${path.split('/').pop() ?? path}` : 'no se pudo abrir el archivo')
}

export async function previewFile($: Dollar, path: string): Promise<void> {
  const text = await $.fs.read(path).catch(() => undefined)
  if (typeof text !== 'string' || text.includes('\u0000')) {
    $.ui.toast('no se puede previsualizar este archivo')
    return
  }
  const lines = text.split('\n').slice(0, 200).map(l => l.replace(/\t/g, '    ').slice(0, 400))
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, preview: { path, lines } } }))
}

export async function scrollTree($: Dollar, delta: number, total: number, page: number): Promise<void> {
  await update($, panel, p => ({
    ...p,
    explorer: { ...p.explorer, offset: Math.max(0, Math.min(Math.max(0, total - page), (p.explorer.offset ?? 0) + delta)) },
  }))
}

export async function scrollPreview($: Dollar, delta: number, page: number): Promise<void> {
  await update($, panel, p => {
    const pv = p.explorer.preview
    if (pv === undefined) return p
    const top = Math.max(0, Math.min(Math.max(0, pv.lines.length - page), (pv.top ?? 0) + delta))
    return { ...p, explorer: { ...p.explorer, preview: { ...pv, top } } }
  })
}

export async function shiftPreview($: Dollar, delta: number): Promise<void> {
  await update($, panel, p => {
    const pv = p.explorer.preview
    if (pv === undefined) return p
    const widest = Math.max(0, ...pv.lines.map(l => l.length))
    const left = Math.max(0, Math.min(Math.max(0, widest - 10), (pv.left ?? 0) + delta))
    return { ...p, explorer: { ...p.explorer, preview: { ...pv, left } } }
  })
}

export async function closePreview($: Dollar): Promise<void> {
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, preview: undefined } }))
}

export async function setQuery($: Dollar, query: string): Promise<void> {
  await update($, panel, p => ({ ...p, explorer: { ...p.explorer, query, offset: 0 } }))
  const q = query.trim()
  if (q.length < 2) {
    await update($, panel, p => ({ ...p, explorer: { ...p.explorer, hits: [] } }))
    return
  }
  const root = (await read($, panel)).explorer.root
  const out = await $.process
    .run(
      ['sh', '-c', 'find "$1" -mindepth 1 -maxdepth 6 \\( -name .git -o -name node_modules -o -name "\\.*" \\) -prune -o -iname "*$2*" -printf "%y %p\\n" 2>/dev/null | head -60', 'sh', root, q],
      { timeoutMs: 4000 },
    )
    .catch(() => undefined)
  const hits = out === undefined ? [] : out.stdout.split('\n').filter(l => /^[a-z] /.test(l))
  await update($, panel, p => (p.explorer.query.trim() === q ? { ...p, explorer: { ...p.explorer, hits } } : p))
}

export async function searchPrompt($: Dollar): Promise<void> {
  const filled = await $.prompt.fill({ text: '/buscar ', mode: 'insert' })
  $.ui.toast(filled.isFilled ? 'escribe qué buscar y Enter' : 'escribe /buscar en el prompt')
}

export async function pickFile($: Dollar, path: string): Promise<void> {
  const cwd = await $.session.cwd()
  const rel = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
  const filled = await $.prompt.fill({ text: `@${rel} `, mode: 'insert' })
  $.ui.toast(filled.isFilled ? `añadido @${rel}` : `no se pudo añadir @${rel}`)
}

export const visibleRows = (ex: Explorer, gitMap: Record<string, string>): Row[] => {
  const dirtyDirs = new Set<string>()
  for (const file of Object.keys(gitMap)) {
    let dir = parent(file)
    while (dir.length > 1 && !dirtyDirs.has(dir)) {
      dirtyDirs.add(dir)
      dir = parent(dir)
    }
  }
  const rows: Row[] = []
  if (ex.query.trim().length >= 2) {
    return ex.hits.filter(hit => /^[a-z] /.test(hit)).map(hit => {
      const path = hit.slice(2)
      return {
        path,
        name: path.startsWith(`${ex.root}/`) ? path.slice(ex.root.length + 1) : path,
        depth: 0,
        kind: hit[0] === 'd' ? 'dir' : hit[0] === 'f' ? 'file' : 'other',
        git: gitMap[path],
      }
    })
  }
  const walk = (dir: string, depth: number): void => {
    for (const one of ex.listing[dir] ?? []) {
      if (rows.length >= MAX_ROWS) return
      if (!ex.isHidden && (one.name.startsWith('.') || IGNORED.has(one.name))) continue
      const path = join(dir, one.name)
      rows.push({
        path,
        name: one.name,
        depth,
        kind: one.kind,
        git: one.kind === 'dir' ? (dirtyDirs.has(path) ? '●' : undefined) : gitMap[path],
      })
      if (one.kind === 'dir' && ex.open.includes(path)) walk(path, depth + 1)
    }
  }
  walk(ex.root, 0)
  return rows
}

// The mouse wheel over the Archivos tab scrolls its own window: the tree, or the open preview.
export async function wheel($: Dollar, by: number, bodyRows: number): Promise<void> {
  const p = await read($, panel)
  const page = treeHeight(bodyRows)
  const step = Math.sign(by) * Math.max(3, Math.abs(by))
  if (p.explorer.preview !== undefined) await scrollPreview($, step, page)
  else await scrollTree($, step, visibleRows(p.explorer, p.gitMap).length, page)
}
