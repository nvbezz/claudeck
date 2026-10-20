import { atom, read } from 'claude-code'
import type { EngineInterface, RenderChildren, RenderInputOf, RenderSurface } from 'claude-code'

import type { Config } from './config'
import {
  base,
  clip,
  compact,
  duration,
  effortView,
  isFiveHour,
  level,
  money,
  prettyModel,
  project,
  shortPath,
  until,
} from './format'
import { EFFORTS, MODELS, setEffort, setModel, togglePick } from './controls'
import { EXT_COLOR, fileGlyph, glyph } from './icons'
import type { GlyphName } from './icons'
import { INITIAL } from './state'
import { toggleSection } from './ui'
import type { Section } from '../types'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

const ago = (ms: number): string => {
  const m = Math.floor(Math.max(0, ms) / 60000)
  return m < 1 ? 'ahora' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

const SLOTS = 4
const HOVER = { inverse: false, underline: true, bold: true } as const
const CHIPS = {
  orange: ['#fab387', '#43322b'],
  blue: ['#89b4fa', '#27324a'],
  mauve: ['#cba6f7', '#352c4a'],
  green: ['#a6e3a1', '#26382e'],
} as const
const STOPS = [[166, 227, 161], [249, 226, 175], [250, 179, 135], [243, 139, 168]] as const
const gradient = (t: number): string => {
  const x = Math.min(0.999, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = STOPS[i] ?? STOPS[0]
  const b = STOPS[i + 1] ?? a
  const hex = [0, 1, 2].map(k => Math.round((a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * f).toString(16).padStart(2, '0'))
  return `#${hex.join('')}`
}
const NO_REPO = [
  { art: '○──○──┬──◉ ', note: ' sin repositorio aquí' },
  { art: '      │    ', note: ' git init y empiezo' },
  { art: '      ╰──○ ', note: ' a seguirte la pista' },
]
const SOURCES: Record<string, string> = {
  userSettings: 'tuyas',
  projectSettings: 'proyecto',
  plugin: 'plugin',
  'built-in': 'base',
  mcp: 'mcp',
  policySettings: 'política',
  syncedSkills: 'sync',
}
const note = (n: number, text: string) => ({ pad: '│ ', mark: '○', rule: ` ${'─'.repeat(n)}${' '.repeat(8 - n)} │`, note: `  ${text}` })
const ZZZ = ['z', 'zZ', 'zZZ', 'zZ']
const noAgents = (tick: number) => [
  { art: '   ╷   ', note: ` ${ZZZ[tick % ZZZ.length]}`, isHot: true },
  { art: '╭──┴──╮', note: ' el equipo duerme', isHot: false },
  { art: '│ ◡ ◡ │', note: ' lanza un agente y', isHot: false },
  { art: '╰─┬─┬─╯', note: ' despierta solo', isHot: false },
]
const noFiles = (tick: number) => [
  { art: '╭╌╌╌╌╌╌╮', note: ' nada tocado todavía' },
  { art: tick % 2 === 0 ? '┊ ✦  ✧ ┊' : '┊ ✧  ✦ ┊', note: ' ni un byte movido,' },
  { art: '┊  ‿‿  ┊', note: ' todo intacto' },
  { art: '╰╌╌╌╌╌╌╯', note: '' },
]
const NOTEPAD = [
  { pad: '', mark: '', rule: `╭${'─'.repeat(12)}╮`, note: '' },
  note(8, 'sin plan aún'),
  note(5, 'pídeme algo grande'),
  note(7, 'y lo divido'),
  { pad: '', mark: '', rule: `╰${'─'.repeat(12)}╯`, note: '' },
]

const braille = (values: number[]): string => {
  const top = Math.max(...values, 1e-9)
  const lvl = (v: number) => Math.min(3, Math.round((v / top) * 3))
  const left = [0x40, 0x04, 0x02, 0x01]
  const right = [0x80, 0x20, 0x10, 0x08]
  let out = ''
  for (let i = 0; i < values.length; i += 2) {
    const a = left[lvl(values[i] ?? 0)] ?? 0
    const b = i + 1 < values.length ? right[lvl(values[i + 1] ?? 0)] ?? 0 : 0
    out += String.fromCharCode(0x2800 + a + b)
  }
  return out
}

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

export async function renderPanel($: Dollar, e: RenderInputOf<'Pane', RenderSurface>, cfg: Config) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const p = { ...INITIAL, ...(await read($, panel)) }
  const inner = Math.max(20, (e.props.bodyColumns ?? cfg.width) - 4)
  const barWidth = Math.max(6, Math.min(10, inner - 26))
  const isOpen = (s: Section) => !p.collapsed.includes(s)
  const toggle = (s: Section) => () => void toggleSection($, s)
  const files = Object.entries(p.files)
  const added = files.reduce((n, [, f]) => n + f.added, 0)
  const removed = files.reduce((n, [, f]) => n + f.removed, 0)
  const doneTodos = p.todos.filter(t => t.status === 'completed').length
  const activeAgents = p.agents.filter(a => !a.isDone)
  const downMcp = p.mcp.filter(m => !m.isUp)
  const tick = Math.floor(p.now / 1000)
  const frame = FRAMES[Math.floor(p.now / 1000) % FRAMES.length]
  const five = p.limits.find(l => isFiveHour(l.kind))
  const pace = project(p.limitSamples, five?.resetsAt, p.now)
  const hours = Math.max((p.now - p.startedAt) / 3600000, 1 / 60)
  const busy = [
    ...p.running.map(r => ({ kind: 'tool' as const, label: r.label, since: r.since })),
    ...activeAgents.map(a => ({ kind: 'agent' as const, label: a.name, since: a.since })),
  ].slice(-3)
  const model = MODELS.find(m => p.model.toLowerCase().includes(m.id))
  const { index: effortIdx, label: effortLabel } = effortView(p.effort, EFFORTS)
  const order = { in_progress: 0, pending: 1, completed: 2 }
  const todoSlots = Array.from({ length: SLOTS }, (_, i) => [...p.todos].sort((a, b) => order[a.status] - order[b.status])[i])
  const fileSlots = Array.from({ length: SLOTS }, (_, i) => files.slice(-SLOTS).reverse()[i])
  const extOf = (path: string) => (base(path).includes('.') ? base(path).split('.').pop()!.toLowerCase() : '')
  const diffCells = (f: { added: number; removed: number }) => {
    const total = f.added + f.removed
    if (total === 0) return { a: 0, r: 0 }
    const a = Math.round((f.added / total) * 5)
    return { a, r: 5 - a }
  }
  const listedSkills = Object.values(p.skills.bySource).reduce((n, c) => n + c, 0)
  const skillGroups: [string, number][] = [
    ...Object.entries(p.skills.bySource)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]): [string, number] => [SOURCES[key] ?? key, n]),
    ...(p.skills.total > listedSkills ? [['sin listar', p.skills.total - listedSkills] as [string, number]] : []),
  ]
  const agentRows = [...activeAgents, ...p.agents.filter(a => a.isDone).reverse()].slice(0, 4)
  const skeleton = (_i: number) => ' '
  const tools = Object.entries(p.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  const pct = (percent: number | undefined) => (percent === undefined ? '—' : `${Math.round(percent)}%`).padStart(4)

  const ic = (name: GlyphName) => glyph(cfg.isIcons, name)

  const Meter = ({ label, percent, tail, isProgress }: { label: string; percent: number | undefined; tail: string; isProgress?: boolean }) => {
    const filled = Math.round((Math.min(100, Math.max(0, percent ?? 0)) / 100) * barWidth)
    return (
      <Line>
        <Text dimColor>{label.padEnd(10)}</Text>
        {Array.from({ length: filled }, (_, i) => (
          <Text color={isProgress === true ? 'success' : gradient((i + 1) / barWidth)}>▰</Text>
        ))}
        <Text dimColor>{'▱'.repeat(barWidth - filled)}</Text>
        <Text bold color={isProgress === true ? 'success' : level(percent, cfg)}> {pct(percent)}</Text>
        <Text dimColor> {tail}</Text>
      </Line>
    )
  }

  const Chip = ({ text, tone }: { text: string; tone: keyof typeof CHIPS }) => {
    const [fg, bg] = CHIPS[tone]
    return (
      <Text>
        {cfg.isIcons && <Text color={bg}>{'\u{e0b6}'}</Text>}
        <Text bold color={fg} backgroundColor={bg}>{cfg.isIcons ? ` ${text} ` : ` ${text} `}</Text>
        {cfg.isIcons && <Text color={bg}>{'\u{e0b4}'}</Text>}
      </Text>
    )
  }

  const Line = ({ children, ...style }: { children: RenderChildren; color?: string; dimColor?: boolean; bold?: boolean; strikethrough?: boolean }) => (
    <Text wrap="truncate">
      <Text color="subtle">▏ </Text>
      <Text {...style}>{children}</Text>
    </Text>
  )

  const Card = ({ id, title, accent, hint, children }: { id: Section; title: string; accent: string; hint?: string; children: RenderChildren }) => {
    const tail = `${hint === undefined ? '' : `${hint} `}${isOpen(id) ? '▾' : '▸'}`
    const rule = Math.max(1, inner + 2 - title.length - tail.length - 5)
    return (
      <Box key={`card-${id}`} flexDirection="column" paddingX={1} marginBottom={1}>
        <Button key={`head-${id}`} plain onPress={toggle(id)}>
          <Text wrap="truncate">
            <Text bold color={accent}>{ic(id === 'status' ? 'mcp' : id === 'system' ? 'work' : id === 'files' ? 'modified' : id)} {title} </Text>
            <Text color="subtle" hover={{ color: accent }}>{'─'.repeat(rule)} </Text>
            <Text dimColor>{tail}</Text>
          </Text>
        </Button>
        {isOpen(id) && <Box flexDirection="column" paddingLeft={1}>{children}</Box>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" minHeight={e.props.scroll.bodyRows} backgroundColor={cfg.bgColor}>
      <Card id="session" title="SESIÓN" accent="claude" hint={`${duration(p.now - p.startedAt)} · ${p.turns} turnos`}>
        <Line>
          <Text bold>{base(p.cwd) === '' ? 'sesión' : base(p.cwd)}</Text>
          <Text color={busy.length > 0 ? 'claude' : 'success'}>  {busy.length > 0 ? frame : '●'} </Text>
          <Text dimColor>{busy.length > 0 ? 'trabajando' : 'listo'}</Text>
        </Line>
        <Box key="deck-model" flexDirection="row">
          <Text color="subtle">▏ </Text>
          <Text dimColor>modelo    </Text>
          <Button key="model" plain hover={HOVER} onPress={() => void togglePick($, 'model')}>
            <Text>
              <Text color={model?.color ?? 'inactive'}>{ic('brain')} </Text>
              <Text bold>{prettyModel(p.model)}</Text>
              <Text dimColor> {model?.note.split(',')[0] ?? ''} ▾</Text>
            </Text>
          </Button>
        </Box>
        {p.pick === 'model' &&
          MODELS.map(m => {
            const isOn = m === model
            return (
              <Box key={`pm-${m.id}`} flexDirection="row">
                <Text color="subtle">▏ </Text>
                <Button key={`pmb-${m.id}`} plain hover={HOVER} onPress={() => void setModel($, m.id)}>
                  <Text wrap="truncate">
                    <Text color={m.color}>{isOn ? '◉ ' : '○ '}</Text>
                    <Text bold={isOn} color={isOn ? m.color : undefined}>{m.label.padEnd(7)}</Text>
                    <Text dimColor>{m.note}</Text>
                  </Text>
                </Button>
              </Box>
            )
          })}
        <Box key="deck-effort" flexDirection="row">
          <Text color="subtle">▏ </Text>
          <Text dimColor>esfuerzo  </Text>
          <Button key="effort" plain hover={HOVER} onPress={() => void togglePick($, 'effort')}>
            <Text>
              {EFFORTS.map((f, i) => (
                <Text color={i <= effortIdx ? gradient(i / (EFFORTS.length - 1)) : 'subtle'}>━━</Text>
              ))}
              <Text bold> {effortLabel}</Text>
              <Text dimColor> ▾</Text>
            </Text>
          </Button>
        </Box>
        {p.pick === 'effort' &&
          EFFORTS.map((f, i) => {
            const isOn = f.id === p.effort
            return (
              <Box key={`pe-${f.id}`} flexDirection="row">
                <Text color="subtle">▏ </Text>
                <Button key={`peb-${f.id}`} plain hover={HOVER} onPress={() => void setEffort($, f.id)}>
                  <Text wrap="truncate">
                    <Text color={gradient(i / (EFFORTS.length - 1))}>{isOn ? '◉ ' : '○ '}</Text>
                    <Text bold={isOn}>{f.label.padEnd(9)}</Text>
                    <Text dimColor>{f.note}</Text>
                  </Text>
                </Button>
              </Box>
            )
          })}
        <Meter label="contexto" percent={p.ctxPercent} tail={p.ctxTokens === undefined ? '' : `${compact(p.ctxTokens)}/${compact(p.ctxWindow)}`} />
        <Line>
          <Text dimColor>{'ritmo'.padEnd(10)}</Text>
          <Text bold>{money(p.costUsd === undefined ? 0 : p.costUsd / hours)}</Text>
          <Text dimColor>/h · </Text>
          <Text color={pace.tone === 'inactive' ? undefined : pace.tone} dimColor={pace.tone === 'inactive'}>5h {pace.text}</Text>
          {five !== undefined && <Text dimColor> ↻{until(five.resetsAt, p.now)}</Text>}
        </Line>
        <Line>
          <Text dimColor>{'turnos'.padEnd(10)}</Text>
          {p.turnCosts.length > 0 && <Text color="claude">{braille(p.turnCosts.slice(-16))}</Text>}
          <Text dimColor>{p.turnCosts.length === 0 ? 'aún sin medir' : ` último ${money(p.turnCosts[p.turnCosts.length - 1] ?? 0)}`}</Text>
        </Line>
        <Line>
          <Text dimColor>{'acciones'.padEnd(10)}</Text>
          {tools.length === 0 && <Text dimColor>aún sin acciones</Text>}
          {tools.length > 0 && <Text>{tools.map(([name, n]) => `${name}×${n}`).join('  ')}</Text>}
          {busy.length > 1 && <Text color="claude">  +{busy.length - 1} en paralelo</Text>}
        </Line>
      </Card>

      <Card id="agents" title="AGENTES" accent="warning" hint={activeAgents.length > 0 ? `${activeAgents.length} activo${activeAgents.length > 1 ? 's' : ''}` : p.agents.length > 0 ? 'en reposo' : undefined}>
        {agentRows.length === 0 &&
          noAgents(tick).map(row => (
            <Line>
              <Text color="warning">{row.art}</Text>
              <Text dimColor={!row.isHot} color={row.isHot ? 'warning' : undefined}>{row.note}</Text>
            </Line>
          ))}
        {agentRows.map(a => (
          <Line dimColor={a.isDone}>
            <Text color={!a.isDone ? 'claude' : a.end === 'stopped' ? 'warning' : a.end === 'failed' ? 'error' : 'success'}>
              {!a.isDone ? '◆' : a.end === 'stopped' ? '■' : a.end === 'failed' ? '✘' : '✔'}{' '}
            </Text>
            <Text bold={!a.isDone}>{clip(a.name, Math.max(8, inner - 14))}</Text>
            <Text dimColor>  {!a.isDone ? duration(p.now - a.since) : a.end === 'stopped' ? 'detenido' : a.end === 'failed' ? 'falló' : 'listo'}</Text>
          </Line>
        ))}
        {p.agents.length > agentRows.length && <Line dimColor>  … y {p.agents.length - agentRows.length} más</Line>}
      </Card>

      <Card id="tasks" title="TAREAS" accent="success" hint={p.todos.length > 0 ? `${doneTodos}/${p.todos.length}` : undefined}>
        {p.todos.length === 0 ? (
          NOTEPAD.map((row, i) => (
            <Line>
              <Text color="subtle">{row.pad}</Text>
              <Text color="success">{row.mark}</Text>
              <Text color="subtle">{row.rule}</Text>
              <Text dimColor>{row.note}</Text>
            </Line>
          ))
        ) : (
          <Meter label="avance" percent={(doneTodos / p.todos.length) * 100} tail="" isProgress />
        )}
        {p.todos.length > 0 &&
          todoSlots.map(t =>
            t === undefined ? (
              <Line>{' '}</Line>
            ) : (
              <Line
                color={t.status === 'in_progress' ? 'claude' : undefined}
                dimColor={t.status === 'completed'}
                strikethrough={t.status === 'completed'}
                bold={t.status === 'in_progress'}
              >
                {t.status === 'completed' ? '●' : t.status === 'in_progress' ? '◐' : '○'} {t.content}
              </Line>
            ),
          )}
      </Card>

      <Card
        id="files"
        title="ARCHIVOS MODIFICADOS"
        accent="warning"
        hint={files.length > 0 ? `${files.length} · +${added} −${removed}` : undefined}
      >
        {files.length === 0 &&
          noFiles(tick).map(row => (
            <Line>
              <Text color="warning">{row.art}</Text>
              <Text dimColor>{row.note}</Text>
            </Line>
          ))}
        {files.length > 0 && fileSlots.map((one, i) =>
          one === undefined ? (
            <Line dimColor>{skeleton(i + 1)}</Line>
          ) : (
            <Line>
              <Text color={EXT_COLOR[extOf(one[0])] ?? 'inactive'}>{fileGlyph(cfg.isIcons, base(one[0]), extOf(one[0]))} </Text>
              <Text>{clip(base(one[0]), Math.max(8, inner - 24)).padEnd(Math.max(8, inner - 24))}</Text>
              <Text color="diffAdded">{'━'.repeat(diffCells(one[1]).a)}</Text>
              <Text color="diffRemoved">{'━'.repeat(diffCells(one[1]).r)}</Text>
              <Text color="subtle">{'━'.repeat(5 - diffCells(one[1]).a - diffCells(one[1]).r)}</Text>
              <Text dimColor> +{one[1].added} −{one[1].removed}</Text>
            </Line>
          ),
        )}
      </Card>

      <Card
        id="git"
        title="GIT"
        accent="suggestion"
        hint={p.branch === '' ? undefined : p.dirty > 0 ? `${p.dirty} cambios` : 'limpio'}
      >
        {p.branch === '' &&
          NO_REPO.map(row => (
            <Line>
              <Text color="suggestion">{row.art}</Text>
              <Text dimColor>{row.note}</Text>
            </Line>
          ))}
        {p.branch !== '' && (
          <Line>
            <Text dimColor>{'rama'.padEnd(10)}</Text>
            <Chip text={`${ic('branch')} ${p.branch}`} tone="blue" />
            {p.upstream !== '' && <Text dimColor>  → {p.upstream}</Text>}
          </Line>
        )}
        {p.branch !== '' && (
          <Line>
            <Text dimColor>{'sync'.padEnd(10)}</Text>
            <Text color={p.ahead > 0 ? 'success' : 'inactive'}>{ic('ahead')}{p.ahead} </Text>
            <Text color={p.behind > 0 ? 'warning' : 'inactive'}>{ic('behind')}{p.behind}</Text>
            <Text dimColor>  │  </Text>
            <Text color={p.staged > 0 ? 'success' : 'inactive'}>{ic('staged')}{p.staged} </Text>
            <Text color={p.unstaged > 0 ? 'warning' : 'inactive'}>{ic('edited')}{p.unstaged} </Text>
            <Text color={p.untracked > 0 ? 'suggestion' : 'inactive'}>{ic('untracked')}{p.untracked}</Text>
          </Line>
        )}
        {p.branch !== '' &&
          [0, 1, 2].map(i => {
            const c = p.changes[i]
            return c === undefined ? (
              <Line dimColor>{i === 0 && p.changes.length === 0 ? '· árbol limpio, nada por commitear' : skeleton(i + 1)}</Line>
            ) : (
              <Line>
                <Text color={c.code === 'D' ? 'error' : c.code === 'A' || c.code === 'U' ? 'success' : 'warning'}>{c.code} </Text>
                {c.code === 'U' ? (
                  <Text color="success">{'nuevo'.padEnd(9)}</Text>
                ) : (
                  <Text>
                    <Text color="diffAdded">+{String(c.added).padEnd(3)}</Text>
                    <Text color="diffRemoved">−{String(c.removed).padEnd(4)}</Text>
                  </Text>
                )}
                <Text>{base(c.path)}</Text>
                {i === 2 && p.changes.length > 3 && <Text dimColor> +{p.changes.length - 3}</Text>}
              </Line>
            )
          })}
        {p.branch !== '' &&
          Array.from({ length: SLOTS }, (_, i) => p.commits[i]).map((c, i) =>
            c === undefined ? (
              <Line dimColor>{skeleton(i % 3 + 1)}</Line>
            ) : (
              <Line>
                <Text color={i === 0 ? 'claude' : 'subtle'}>{i === 0 ? '◉' : i === SLOTS - 1 || p.commits[i + 1] === undefined ? '╰' : '├'}─ </Text>
                <Text color="suggestion">{c.hash} </Text>
                <Text>{c.subject}</Text>
                <Text dimColor> {ago(p.now - c.at)}</Text>
              </Line>
            ),
          )}
      </Card>

      <Card
        id="status"
        title="MCP Y TESTS"
        accent={downMcp.length > 0 ? 'error' : 'permission'}
        hint={p.mcp.length === 0 ? undefined : downMcp.length === 0 ? '✔ todo en línea' : `✘ ${downMcp.length} caído`}
      >
        {p.mcp.length === 0 && <Line dimColor>· consultando…</Line>}
        {p.mcp.map(m => (
          <Line>
            <Text color={m.isUp ? 'success' : 'error'}>● </Text>
            <Text>{clip(m.name.replace(/^claude\.ai\s+/, ''), inner - 16)}</Text>
            <Text color={m.isUp ? 'success' : 'error'} dimColor={m.isUp}>  {m.isUp ? 'conectado' : 'caído'}</Text>
          </Line>
        ))}
        <Line>
          <Text dimColor>{'tests'.padEnd(10)}</Text>
          {p.check === undefined ? (
            <Text dimColor>—</Text>
          ) : (
            <Text color={p.check.isOk ? 'success' : 'error'}>
              {p.check.isOk ? '✔' : '✘'} {p.check.label} <Text dimColor>{duration(p.now - p.check.at)}</Text>
            </Text>
          )}
        </Line>
      </Card>

      <Card
        id="skills"
        title="SKILLS Y PLUGINS"
        accent="remember"
        hint={p.skills.total > 0 ? `${p.skills.total} skills` : undefined}
      >
        <Line>
          {skillGroups.length === 0 && <Text dimColor>consultando…</Text>}
          {skillGroups.map(([label, n]) => (
            <Text>
              <Text bold>{n}</Text>
              <Text dimColor> {label}  </Text>
            </Text>
          ))}
        </Line>
        {[0, 1, 2].map(i => {
          const one = p.plugins[i]
          return one === undefined ? (
            <Line dimColor>{i === 0 && p.plugins.length === 0 ? '· sin plugins instalados' : ' '}</Line>
          ) : (
            <Line>
              <Text color={one.isOn ? 'success' : 'inactive'}>{one.isOn ? '●' : '○'} </Text>
              <Text dimColor={!one.isOn}>{one.name}</Text>
              <Text dimColor>  {one.isOn ? 'activo' : 'apagado'}</Text>
            </Line>
          )
        })}
        {p.plugins.length > 3 && <Line dimColor>  … y {p.plugins.length - 3} más</Line>}
      </Card>
    </Box>
  )
}
