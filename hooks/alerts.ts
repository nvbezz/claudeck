import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Config } from './config'
import { isFiveHour } from './format'
import { INITIAL } from './state'
import { detectOs, notifyCommand, soundCommand } from './platform'
import type { Kind } from './platform'
import type { Panel } from '../types'

const panel = atom({ plugin: 'claudeck', key: 'panel' } as const, INITIAL)

type Dollar = EngineInterface

export async function ping($: Dollar, cfg: Config, kind: Kind, title: string, body: string): Promise<void> {
  $.ui.toast(`${title} · ${body}`)
  const os = await detectOs($)
  const sound = cfg.isSound ? soundCommand(os, kind) : undefined
  if (sound !== undefined) void $.process.run(sound, { timeoutMs: 5000 }).catch(() => {})
  const notice = cfg.isDesktop ? notifyCommand(os, title, body) : undefined
  if (notice !== undefined) void $.process.run(notice, { timeoutMs: 3000 }).catch(() => {})
}

export async function checkAlerts($: Dollar, cfg: Config): Promise<void> {
  const p = await read($, panel)
  const ctx = p.ctxPercent ?? 0
  const five = p.limits.find(l => isFiveHour(l.kind))?.percent ?? 0
  const checks = [
    {
      key: 'ctx',
      isOn: ctx >= cfg.ctxCrit,
      isOff: ctx < cfg.ctxCrit - 5,
      title: 'Contexto casi lleno',
      body: `${Math.round(ctx)}%: considera /compact`,
    },
    {
      key: 'limit',
      isOn: five >= cfg.limitWarn,
      isOff: five < cfg.limitWarn - 5,
      title: 'Límite de 5h alto',
      body: `${Math.round(five)}% usado`,
    },
  ]
  for (const check of checks) {
    const isSet = p.alerted.includes(check.key)
    if (check.isOn && !isSet) {
      await update($, panel, q => ({ ...q, alerted: [...q.alerted, check.key] }))
      await ping($, cfg, 'warn', check.title, check.body)
    } else if (check.isOff && isSet) {
      await update($, panel, q => ({ ...q, alerted: q.alerted.filter(k => k !== check.key) }))
    }
  }
}
