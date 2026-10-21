import type { EngineInterface } from 'claude-code'

type Dollar = EngineInterface

export type Os = 'linux' | 'mac' | 'other'
export type Kind = 'done' | 'warn' | 'error'

let cached: Os | undefined

export const parseOs = (uname: string): Os => {
  const name = uname.trim().toLowerCase()
  return name === 'linux' ? 'linux' : name === 'darwin' ? 'mac' : 'other'
}

// `uname` once per process: the answer never changes while the session lives.
export async function detectOs($: Dollar): Promise<Os> {
  if (cached !== undefined) return cached
  const out = await $.process.run(['uname', '-s'], { timeoutMs: 3000 }).catch(() => undefined)
  // A failed `uname` is not cached: the next alert asks again instead of staying silent for the whole session.
  if (out === undefined || out.exitCode !== 0) return 'other'
  cached = parseOs(out.stdout)

  return cached
}

const LINUX_SOUNDS = '/usr/share/sounds/freedesktop/stereo'
const LINUX_SOUND: Record<Kind, string> = { done: 'complete', warn: 'dialog-warning', error: 'dialog-error' }
const MAC_SOUND: Record<Kind, string> = { done: 'Glass', warn: 'Funk', error: 'Basso' }

// Every command takes its values as arguments, never spliced into a script, so titles and paths cannot inject anything.
export const soundCommand = (os: Os, kind: Kind): string[] | undefined => {
  if (os === 'linux') {
    return ['sh', '-c', 'command -v pw-play >/dev/null 2>&1 && exec pw-play "$1"; command -v paplay >/dev/null 2>&1 && exec paplay "$1"', 'sh', `${LINUX_SOUNDS}/${LINUX_SOUND[kind]}.oga`]
  }
  if (os === 'mac') return ['afplay', `/System/Library/Sounds/${MAC_SOUND[kind]}.aiff`]

  return undefined
}

export const notifyCommand = (os: Os, title: string, body: string): string[] | undefined => {
  if (os === 'linux') return ['notify-send', '-a', 'Claude Code', title, body]
  if (os === 'mac') {
    return ['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body]
  }

  return undefined
}

export const openCommand = (os: Os, path: string): string[] | undefined => {
  if (os === 'linux') return ['sh', '-c', 'nohup xdg-open "$1" >/dev/null 2>&1 &', 'sh', path]
  if (os === 'mac') return ['open', path]

  return undefined
}
