import type { EngineInterface } from 'claude-code'

// Fire-and-forget work: a rejection or a synchronous throw must never become an unhandled rejection.
export function fire(work: () => Promise<unknown>): void {
  void (async () => work())().catch(() => {})
}

// The session id, or '' when the engine cannot answer: a hook must not fail (or block a tool call) over a bookkeeping value.
export async function sid($: EngineInterface): Promise<string> {
  try {
    const id = await $.session.id()
    return typeof id === 'string' ? id : ''
  } catch {
    return ''
  }
}
