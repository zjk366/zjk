/** 监控室 — 日志、屏幕、操作类型定义 */

/** 单条操作日志 */
export interface MonitorLogEntry {
  id: string
  time: string
  action: string
  status: MonitorLogStatus
  source?: string
  filePath?: string
  retroData?: unknown
}

export type MonitorLogStatus = 'ok' | 'blocked' | 'retro'

/** 实时屏幕内容 */
export type ScreenContent =
  | { type: 'idle' }                                          // 空闲壁纸
  | { type: 'terminal'; command: string; output: TermLine[] }  // 终端执行
  | { type: 'browser'; image: string; url: string }            // 浏览器截图(base64)
  | { type: 'message'; text: string }                          // 纯文本消息

export interface TermLine {
  text: string
  stream: 'stdout' | 'stderr'
}
