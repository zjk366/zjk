/**
 * 监控室服务 — 记录 AI 所有操作日志
 *
 * 通过 EventEmitter 发布日志事件，监控室页面订阅后实时更新。
 * 与具体工具解耦：工具执行后只需调用 addLog 即可。
 */
import { loggerService } from '@logger'
import type { MonitorLogEntry, MonitorLogStatus } from '@renderer/types/monitor'
import { EventEmitter, EVENT_NAMES } from './EventService'

const logger = loggerService.withContext('MonitorService')

class MonitorService {
  private static instance: MonitorService
  private logs: MonitorLogEntry[] = []
  private initialized = false

  static getInstance(): MonitorService {
    if (!MonitorService.instance) {
      MonitorService.instance = new MonitorService()
    }
    return MonitorService.instance
  }

  /** 初始化：挂载到现有工具事件 */
  init(): void {
    if (this.initialized) return
    this.initialized = true

    // 监听 MESSAGE_COMPLETE 捕捉 AI 操作（包含工具调用信息）
    EventEmitter.on(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)

    logger.info('MonitorService initialized')
  }

  destroy(): void {
    EventEmitter.off(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)
    this.initialized = false
  }

  /** ── 公开方法 ─────────────────────────────────── */

  /** 获取所有日志 */
  getAll(): MonitorLogEntry[] {
    return [...this.logs]
  }

  /** 添加一条操作日志（工具调用处调用此方法） */
  addLog(action: string, status: MonitorLogStatus, meta?: { source?: string; filePath?: string; retroData?: unknown }): void {
    const entry: MonitorLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      action,
      status,
      ...meta,
    }
    this.logs.push(entry)
    EventEmitter.emit(MONITOR_EVENTS.LOG_ADDED as any, entry)
    logger.debug(`[Monitor] ${status}: ${action}`)
  }

  /** 回溯单条操作 */
  retroLog(logId: string): boolean {
    const idx = this.logs.findIndex((l) => l.id === logId)
    if (idx === -1) return false
    this.logs[idx] = { ...this.logs[idx], status: 'retro' }
    EventEmitter.emit(MONITOR_EVENTS.LOG_RETRO as any, this.logs[idx])
    return true
  }

  /** 回溯到最初（全部撤销） */
  retroAll(): number {
    let count = 0
    this.logs = this.logs.map((l) => {
      if (l.status === 'ok') { count++; return { ...l, status: 'retro' } }
      return l
    })
    EventEmitter.emit(MONITOR_EVENTS.LOG_RETRO_ALL as any, count)
    return count
  }

  /** 停止当前操作（占位，后续接入真实 abort） */
  stopCurrent(): boolean {
    EventEmitter.emit(MONITOR_EVENTS.LOG_STOP as any)
    return true
  }

  /** ── 内部事件监听 ─────────────────────────────── */

  private onMessageComplete = (_data: { status: string }) => {
    // MESSAGE_COMPLETE 本身不包含具体工具操作
    // 工具操作由 mcp.ts / mcp-bridge.ts 调用 addLog 记录
  }
}

/** 事件名称（供外部引用） */
export const MONITOR_EVENTS = {
  LOG_ADDED: 'monitor:log-added',
  LOG_RETRO: 'monitor:log-retro',
  LOG_RETRO_ALL: 'monitor:log-retro-all',
  LOG_STOP: 'monitor:log-stop',
} as const

export default MonitorService
