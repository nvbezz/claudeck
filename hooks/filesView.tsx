import { atom, read } from 'claude-code'
import type { EngineInterface, RenderInputOf, RenderSurface } from 'claude-code'

import type { Config } from './config'
import {
  closePreview,
  goDown,
  goHome,
  goUp,
  imageBox,
  openFile,
  pickFile,
  previewFile,
  refreshExplorer,
  scrollPreview,
  scrollTree,
  searchPrompt,
  selectFile,
  setQuery,
  shiftPreview,
  toggleDir,
  toggleHidden,
  treeHeight,
  visibleRows,
} from './explorer'
import { base, shortPath } from './format'
import { EXT_COLOR, fileGlyph, folderGlyph, glyph } from './icons'
import { INITIAL } from './state'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

const HOVER = { inverse: false, underline: true, bold: true } as const
const GIT_COLOR: Record<string, string> = { M: 'warning', A: 'success', U: 'success', D: 'error', R: 'suggestion', '●': 'warning' }

export async function renderFiles($: Dollar, e: RenderInputOf<'Pane', RenderSurface>, cfg: Config) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button, Code } = ui
  // Only the terminal surface draws pictures; any other shows the caption.
  const Image = 'Image' in ui ? ui.Image : undefined
  const p = { ...INITIAL, ...(await read($, panel)) }
  const ex = { ...INITIAL.explorer, ...p.explorer }
  const rows = visibleRows(ex, p.gitMap)
  const selected = ex.selected
  const selName = base(selected)
  const selExt = selName.includes('.') ? selName.split('.').pop()!.toLowerCase() : ''
  const isWeb = selExt === 'html' || selExt === 'htm' || selExt === 'svg'
  const crumbs = shortPath(ex.root).split('/').filter(c => c !== '')
  const dirs = rows.filter(r => r.kind === 'dir').length
  const counts: Record<string, number> = {}
  for (const one of ex.listing[ex.root] ?? []) {
    if (one.kind !== 'file' || (!ex.isHidden && one.name.startsWith('.'))) continue
    const ext = one.name.includes('.') ? one.name.split('.').pop()!.toLowerCase() : ''
    counts[ext] = (counts[ext] ?? 0) + 1
  }
  const mix = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const fileCount = mix.reduce((n, [, c]) => n + c, 0)
  const width = Math.max(10, (e.props.bodyColumns ?? cfg.width) - 2)

  // The tree owns a fixed window: it never moves when the parts above change, and pages instead of growing.
  const treeH = treeHeight(e.props.scroll.bodyRows)
  const pv = ex.preview
  const total = pv !== undefined ? pv.lines.length : rows.length
  const top = Math.max(0, Math.min(pv !== undefined ? pv.top ?? 0 : ex.offset ?? 0, Math.max(0, total - treeH)))
  const shown = rows.slice(top, top + treeH)
  const page = (dir: number) => () =>
    void (pv !== undefined ? scrollPreview($, dir * (treeH - 2), treeH) : scrollTree($, dir * (treeH - 2), rows.length, treeH))
  const thumb = total <= treeH ? treeH : Math.max(1, Math.round((treeH * treeH) / total))
  const thumbAt = total <= treeH ? 0 : Math.round((top / Math.max(1, total - treeH)) * (treeH - thumb))
  const codeW = Math.max(10, (e.props.bodyColumns ?? cfg.width) - 10)
  const canRight = pv !== undefined && pv.lines.some(l => l.length - (pv.left ?? 0) > codeW)
  const canDescend = (ex.trail ?? []).length > 0
  const canUp = top > 0
  const canDown = top + treeH < total

  return (
    <Box flexDirection="column" height={e.props.scroll.bodyRows} backgroundColor={cfg.bgColor}>
      <Box flexDirection="column" paddingX={1} marginBottom={1} flexShrink={0}>
        <Text wrap="truncate">
          <Text bold color="claude">{glyph(cfg.isIcons, 'files')} EXPLORADOR </Text>
          <Text color="subtle">{'─'.repeat(40)}</Text>
        </Text>
        <Text wrap="truncate-start">
          {crumbs.map((c, i) => (
            <Text>
              {i > 0 && <Text color="subtle"> › </Text>}
              <Text bold={i === crumbs.length - 1} color={i === crumbs.length - 1 ? 'claude' : undefined} dimColor={i < crumbs.length - 1}>{c}</Text>
            </Text>
          ))}
        </Text>
        <Text wrap="truncate">
          {mix.length === 0 && <Text color="subtle">{'━'.repeat(width)}</Text>}
          {mix.map(([ext, n]) => (
            <Text color={EXT_COLOR[ext] ?? 'inactive'}>{'━'.repeat(Math.max(1, Math.round((n / fileCount) * width)))}</Text>
          ))}
        </Text>
        <Text wrap="truncate" dimColor>
          {mix.length === 0 ? 'sin archivos sueltos aquí' : mix.slice(0, 4).map(([ext, n]) => `${ext === '' ? 'otros' : ext} ${n}`).join(' · ')}
        </Text>
        <Box flexDirection="row" gap={2}>
          <Box key="b-up"><Button key="up" plain hover={HOVER} onPress={() => void goUp($)}><Text bold color="claude">{glyph(cfg.isIcons, 'up')} subir</Text></Button></Box>
          <Box key="b-down">
            <Button key="down" plain hover={HOVER} onPress={() => void goDown($)}>
              <Text bold color={canDescend ? 'claude' : 'subtle'}>{glyph(cfg.isIcons, 'down')} bajar</Text>
            </Button>
          </Box>
          <Box key="b-home"><Button key="home" plain hover={HOVER} onPress={() => void goHome($)}><Text bold color="claude">{glyph(cfg.isIcons, 'home')} inicio</Text></Button></Box>
          <Box key="b-hid">
            <Button key="hid" plain hover={HOVER} onPress={() => void toggleHidden($)}>
              <Text bold color={ex.isHidden ? 'warning' : 'inactive'}>{glyph(cfg.isIcons, ex.isHidden ? 'eye' : 'eyeOff')}</Text>
            </Button>
          </Box>
          <Box key="b-ref"><Button key="ref" plain hover={HOVER} onPress={() => void refreshExplorer($)}><Text bold color="claude">{glyph(cfg.isIcons, 'refresh')}</Text></Button></Box>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box key="b-search">
            <Button key="search" plain hover={HOVER} onPress={() => void searchPrompt($)}>
              <Text wrap="truncate">
                <Text bold color="claude">{glyph(cfg.isIcons, 'search')} </Text>
                <Text dimColor={ex.query === ''}>{ex.query === '' ? 'buscar archivos…' : ex.query}</Text>
              </Text>
            </Button>
          </Box>
          {ex.query !== '' && (
            <Box key="b-clear"><Button key="clear" plain hover={HOVER} onPress={() => void setQuery($, '')}><Text bold color="error">✕</Text></Button></Box>
          )}
        </Box>
      </Box>

      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        {selected === '' ? (
          <Text wrap="truncate" dimColor>{glyph(cfg.isIcons, 'file')} ningún archivo seleccionado</Text>
        ) : (
          <Text wrap="truncate">
            <Text color={EXT_COLOR[selExt] ?? 'inactive'}>{fileGlyph(cfg.isIcons, selName, selExt)} </Text>
            <Text bold>{selName}</Text>
          </Text>
        )}
        {selected === '' ? (
          <Text dimColor>abrir   ver   @ mencionar</Text>
        ) : (
          <Box flexDirection="row" gap={2}>
            <Box key="b-open">
              <Button key="open" plain hover={HOVER} onPress={() => void openFile($, selected)}>
                <Text bold color="success" wrap="truncate">{isWeb ? 'navegador' : 'abrir'}</Text>
              </Button>
            </Box>
            <Box key="b-view">
              <Button key="view" plain hover={HOVER} onPress={() => void (pv === undefined ? previewFile($, selected) : closePreview($))}>
                <Text bold color="claude" wrap="truncate">{pv === undefined ? 'ver' : 'cerrar'}</Text>
              </Button>
            </Box>
            <Box key="b-mention">
              <Button key="mention" plain hover={HOVER} onPress={() => void pickFile($, selected)}>
                <Text bold color="suggestion" wrap="truncate">@ mencionar</Text>
              </Button>
            </Box>
          </Box>
        )}
      </Box>

      <Box flexDirection="row" borderStyle="round" borderColor="subtle" paddingLeft={1} height={treeH + 2} flexShrink={0} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {pv?.image !== undefined ? (
          <Box flexDirection="column">
            {(() => {
              const img = pv.image
              const box = imageBox(Math.max(4, (e.props.bodyColumns ?? cfg.width) - 6), treeH, img.width, img.height)
              const alt = `${selName} · ${img.width}×${img.height}`

              return Image === undefined ? (
                <Text dimColor wrap="truncate">{alt}</Text>
              ) : (
                <Image key="preview-image" source={{ file: img.file, format: 'png' }} columns={box.columns} rows={box.rows} alt={alt} />
              )
            })()}
          </Box>
        ) : pv !== undefined ? (
          <Code source={pv.lines.slice(top, top + treeH).map(l => l.slice(pv.left ?? 0)).join('\n')} path={pv.path} startLine={top + 1} wrap="truncate-end" />
        ) : (
          <Box flexDirection="column">
            {rows.length === 0 && <Text dimColor>{ex.query.trim().length >= 2 ? 'sin resultados' : 'carpeta vacía'}</Text>}
            {shown.map(row => {
              const ext = row.name.includes('.') ? row.name.split('.').pop()!.toLowerCase() : ''
              const isDir = row.kind === 'dir'
              const isOpen = isDir && ex.open.includes(row.path)
              const isPicked = row.path === selected
              return (
                <Box key={`row-${row.path}`}>
                  <Button key={row.path} plain hover={HOVER} onPress={() => void (isDir ? toggleDir($, row.path) : selectFile($, row.path))}>
                    <Text wrap="truncate">
                      <Text color="claude">{isPicked ? '▍' : ' '}</Text>
                      <Text color="subtle">{'│ '.repeat(row.depth)}</Text>
                      <Text color={isDir ? 'suggestion' : EXT_COLOR[ext] ?? 'inactive'}>
                        {isDir ? folderGlyph(cfg.isIcons, row.name, isOpen) : fileGlyph(cfg.isIcons, row.name, ext)}{' '}
                      </Text>
                      <Text bold={isDir || isPicked} underline={isPicked} color={row.git === undefined || row.git === '●' ? undefined : GIT_COLOR[row.git]}>{row.name}</Text>
                      {row.git !== undefined && <Text color={GIT_COLOR[row.git]}> {row.git}</Text>}
                    </Text>
                  </Button>
                </Box>
              )
            })}
          </Box>
        )}
        </Box>
        <Box flexDirection="column" width={1} flexShrink={0}>
          {Array.from({ length: treeH }, (_, i) => (
            <Text color={i >= thumbAt && i < thumbAt + thumb ? 'claude' : 'subtle'}>{total <= treeH ? ' ' : i >= thumbAt && i < thumbAt + thumb ? '┃' : '│'}</Text>
          ))}
        </Box>
      </Box>

      <Box flexDirection="row" paddingX={1} gap={1} flexShrink={0}>
        {pv?.image === undefined && (
          <Box key="b-pgup">
            <Button key="pgup" plain hover={HOVER} onPress={page(-1)}><Text bold color={canUp ? 'claude' : 'subtle'}>▲</Text></Button>
          </Box>
        )}
        {pv?.image === undefined && (
          <Box key="b-pgdn">
            <Button key="pgdn" plain hover={HOVER} onPress={page(1)}><Text bold color={canDown ? 'claude' : 'subtle'}>▼</Text></Button>
          </Box>
        )}
        {pv !== undefined && pv.image === undefined && (
          <Box key="b-left">
            <Button key="left" plain hover={HOVER} onPress={() => void shiftPreview($, -12)}>
              <Text bold color={(pv.left ?? 0) > 0 ? 'claude' : 'subtle'}>◀</Text>
            </Button>
          </Box>
        )}
        {pv !== undefined && pv.image === undefined && (
          <Box key="b-right">
            <Button key="right" plain hover={HOVER} onPress={() => void shiftPreview($, 12)}>
              <Text bold color={canRight ? 'claude' : 'subtle'}>▶</Text>
            </Button>
          </Box>
        )}
        <Text dimColor wrap="truncate">
          {pv?.image !== undefined ? `imagen${pv.image.width > 0 ? ` ${pv.image.width}×${pv.image.height}` : ''}` : total === 0 ? '' : `${top + 1}–${Math.min(total, top + treeH)} de ${total}`}
          {pv?.image !== undefined ? '' : pv !== undefined ? ` líneas${(pv.left ?? 0) > 0 ? ` · col ${(pv.left ?? 0) + 1}` : ''}` : ` · ${dirs} carpetas · ${rows.length - dirs} archivos`}
        </Text>
      </Box>
    </Box>
  )
}
