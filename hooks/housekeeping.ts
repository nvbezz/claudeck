import type { EngineInterface } from 'claude-code'

type Dollar = EngineInterface

// Files the mod leaves under ~/.claude/state for the status line: one per session, so they must not pile up.
export const STATE_PATTERNS = ['working-*', 'agents-*.tsv'] as const
const STALE_DAYS = 1

// A session id is a uuid; anything else is refused so it can never widen the glob of the delete below.
export const isSafeId = (id: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(id)

// Deletes the leftovers of sessions that died without a clean exit (crash, kill, closed terminal).
export async function pruneStale($: Dollar): Promise<void> {
  const script =
    'dir="$HOME/.claude/state"; [ -d "$dir" ] && ' +
    `find "$dir" -maxdepth 1 -type f \\( -name '${STATE_PATTERNS[0]}' -o -name '${STATE_PATTERNS[1]}' \\) -mtime +${STALE_DAYS - 1} -delete; ` +
    // Converted picture previews: only this user's own private folder, and only what is a day old.
    'pics="/tmp/claudeck-$(id -u)"; [ -d "$pics" ] && [ -O "$pics" ] && [ ! -L "$pics" ] && find "$pics" -maxdepth 1 -type f -name "*.png" -mtime +0 -delete; true'
  await $.process.run(['sh', '-c', script], { timeoutMs: 5000 }).catch(() => undefined)
}

// Deletes this session's own files when it ends cleanly.
export async function removeOwn($: Dollar, sessionId: string): Promise<void> {
  if (!isSafeId(sessionId)) return
  const script = 'rm -f "$HOME/.claude/state/working-$1" "$HOME/.claude/state/agents-$1.tsv"'
  await $.process.run(['sh', '-c', script, 'sh', sessionId], { timeoutMs: 3000 }).catch(() => undefined)
}
