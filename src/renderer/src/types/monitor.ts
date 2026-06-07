/** 监控室 — 日志与操作类型定义 */

/** 单条操作日志 */
export interface MonitorLogEntry {
  id: string
  /** 发生时间 ISO */
  time: string
  /** 操作描述（如 "读取 C:\xxx"） */
  action: string
  /** 状态 */
  status: MonitorLogStatus
  /** 来源工具（filesystem / terminal / browser 等） */
  source?: string
  /** 关联文件路径（如有） */
  filePath?: string
  /** 回溯时携带的原始数据 */
  retroData?: unknown
}

export type MonitorLogStatus = 'ok' | 'blocked' | 'retro'

/** 日志通道标识 */
export const MONITOR_EVENTS = {
  /** 新增一条操作日志 */
  LOG_ADDED: 'monitor:log-added',
  /** 回溯单条操作 */
  LOG_RETRO: 'monitor:log-retro',
  /** 回溯到最初（全部撤销） */
  LOG_RETRO_ALL: 'monitor:log-retro-all',
  /** 停止当前操作 */
  LOG_STOP: 'monitor:log-stop',
} as const
