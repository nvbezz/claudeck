// Material Design icons from Nerd Fonts (Ghostty bundles Symbols Nerd Font); plain unicode fallback when icons are off.
type Glyph = { icon: string; plain: string }

const G = {
  folder: { icon: '\u{f024b}', plain: '▸' },
  folderOpen: { icon: '\u{f0770}', plain: '▾' },
  file: { icon: '\u{f0214}', plain: '·' },
  branch: { icon: '\u{f062c}', plain: '⎇' },
  commit: { icon: '\u{f0718}', plain: '●' },
  up: { icon: '\u{f005d}', plain: '↑' },
  down: { icon: '\u{f0045}', plain: '↓' },
  home: { icon: '\u{f02dc}', plain: '⌂' },
  refresh: { icon: '\u{f0450}', plain: '⟳' },
  eye: { icon: '\u{f0208}', plain: '◉' },
  eyeOff: { icon: '\u{f0209}', plain: '○' },
  ahead: { icon: '\u{f0167}', plain: '↑' },
  behind: { icon: '\u{f0162}', plain: '↓' },
  staged: { icon: '\u{f012c}', plain: '✔' },
  edited: { icon: '\u{f03eb}', plain: '✎' },
  untracked: { icon: '\u{f0415}', plain: '+' },
  session: { icon: '\u{f07b7}', plain: '▪' },
  work: { icon: '\u{f0241}', plain: '▪' },
  agents: { icon: '\u{f06a9}', plain: '▪' },
  tasks: { icon: '\u{f0756}', plain: '▪' },
  mcp: { icon: '\u{f06a5}', plain: '▪' },
  git: { icon: '\u{f02a2}', plain: '▪' },
  files: { icon: '\u{f024b}', plain: '▪' },
  modified: { icon: '\u{f03eb}', plain: '✎' },
  brain: { icon: '\u{f09d1}', plain: '●' },
  explorer: { icon: '\u{f0770}', plain: '▪' },
  search: { icon: '\u{f0349}', plain: '⌕' },
  skills: { icon: '\u{f0431}', plain: '▪' },
  clean: { icon: '\u{f012c}', plain: '✔' },
} satisfies Record<string, Glyph>

const BY_EXT: Record<string, string> = {
  ts: '\u{f06e6}', tsx: '\u{f0708}', js: '\u{f031e}', jsx: '\u{f0708}', mjs: '\u{f031e}', json: '\u{f0626}',
  md: '\u{f0354}', py: '\u{f0320}', html: '\u{f031d}', css: '\u{f031c}', scss: '\u{f031c}', sh: '\u{f1183}',
  rs: '\u{f1617}', go: '\u{f07d3}', java: '\u{f0b37}', kt: '\u{f1219}', lua: '\u{f08b1}', vue: '\u{f0844}',
  yml: '\u{f107b}', yaml: '\u{f107b}', toml: '\u{f107b}', lock: '\u{f033e}', png: '\u{f02e9}',
  jpg: '\u{f02e9}', svg: '\u{f02e9}', mp4: '\u{f0567}', wav: '\u{f075a}', mp3: '\u{f075a}',
  txt: '\u{f0219}', tsv: '\u{f04eb}', csv: '\u{f04eb}', pdf: '\u{f0226}', sql: '\u{f01bc}',
}

const BY_NAME: Record<string, string> = {
  'package.json': '\u{f0399}', dockerfile: '\u{f0868}', '.gitignore': '\u{f02a2}', '.env': '\u{f0493}',
}

const FOLDER_BY_NAME: Record<string, string> = {
  '.git': '\u{f02a2}', node_modules: '\u{f0399}', '.claude': '\u{f107f}', src: '\u{f069d}', config: '\u{f107f}',
}

export type GlyphName = keyof typeof G

export const glyph = (isIcons: boolean, name: GlyphName): string => (isIcons ? G[name].icon : G[name].plain)

export const fileGlyph = (isIcons: boolean, name: string, ext: string): string =>
  isIcons ? BY_NAME[name.toLowerCase()] ?? BY_EXT[ext] ?? G.file.icon : G.file.plain

export const folderGlyph = (isIcons: boolean, name: string, isOpen: boolean): string =>
  isIcons ? FOLDER_BY_NAME[name] ?? (isOpen ? G.folderOpen.icon : G.folder.icon) : isOpen ? G.folderOpen.plain : G.folder.plain

export const EXT_COLOR: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f1e05a', jsx: '#f1e05a', mjs: '#f1e05a', json: '#cbcb41',
  md: '#519aba', py: '#4b8bbe', html: '#e34c26', css: '#a074c4', scss: '#c6538c', sh: '#89e051',
  rs: '#dea584', go: '#00add8', java: '#b07219', kt: '#a97bff', dart: '#00b4ab', yml: '#cb171e',
  yaml: '#cb171e', toml: '#9c4221', lock: '#6b6b6b', png: '#a074c4', jpg: '#a074c4', svg: '#ffb13b',
  mp4: '#fd971f', wav: '#fd971f', mp3: '#fd971f',
}
