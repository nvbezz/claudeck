import type { PluginOptions } from 'claude-code'

export type Config = {
  width: number
  ctxWarn: number
  ctxCrit: number
  limitWarn: number
  isSound: boolean
  isDesktop: boolean
  notifyMinSeconds: number
  mcpSeconds: number
  taskHideSeconds: number
  agentHideSeconds: number
  isIcons: boolean
  bgColor: string | undefined
}

const num = (value: unknown, fallback: number): number => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback
}

// Like num, but 0 is a real answer ("never").
const secs = (value: unknown, fallback: number): number => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback
}

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : fallback

export const readConfig = (options: PluginOptions): Config => ({
  width: num(options.width, 46),
  ctxWarn: num(options.ctxWarn, 60),
  ctxCrit: num(options.ctxCrit, 85),
  limitWarn: num(options.limitWarn, 80),
  isSound: flag(options.isSound, true),
  isDesktop: flag(options.isDesktop, true),
  notifyMinSeconds: num(options.notifyMinSeconds, 30),
  mcpSeconds: num(options.mcpSeconds, 180),
  taskHideSeconds: secs(options.taskHideSeconds, 90),
  agentHideSeconds: secs(options.agentHideSeconds, 90),
  isIcons: flag(options.isIcons, true),
  bgColor: typeof options.bgColor === 'string' && options.bgColor.trim() !== '' ? options.bgColor.trim() : '#1e1e2e',
})
