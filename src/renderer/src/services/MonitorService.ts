/**
 * 监控室服务 — 记录 AI 所有操作日志 + 实时屏幕内容
 *
 * 通过 EventEmitter 发布日志事件和屏幕更新事件。
 * 日志 = 历史记录；屏幕 = 当前正在发生的实时画面。
 */
import { loggerService } from '@logger'
import type { MonitorLogEntry, MonitorLogStatus, ScreenContent } from '@renderer/types/monitor'
import { EventEmitter, EVENT_NAMES } from './EventService'

const logger = loggerService.withContext('MonitorService')

class MonitorService {
  private static instance: MonitorService
  private logs: MonitorLogEntry[] = []
  private _screen: ScreenContent = { type: 'idle' }
  private initialized = false

  static getInstance(): MonitorService {
    if (!MonitorService.instance) {
      MonitorService.instance = new MonitorService()
    }
    return MonitorService.instance
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true
    EventEmitter.on(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)
    logger.info('MonitorService initialized')
  }

  destroy(): void {
    EventEmitter.off(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)
    this.initialized = false
  }

  /** ── 屏幕内容 ─────────────────────────────────── */

  /** 获取当前屏幕内容 */
  get screen(): ScreenContent {
    return this._screen
  }

  /** 设置屏幕内容（终端输出/浏览器截图/空闲壁纸） */
  setScreen(content: ScreenContent): void {
    this._screen = content
    EventEmitter.emit(MONITOR_EVENTS.SCREEN_UPDATE as any, content)
  }

  /** 添加终端输出行（追加模式） */
  appendTerminalLine(line: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    if (this._screen.type === 'terminal') {
      this._screen.output.push({ text: line, stream })
    } else {
      this._screen = {
        type: 'terminal',
        command: '',
        output: [{ text: line, stream }],
      }
    }
    EventEmitter.emit(MONITOR_EVENTS.SCREEN_UPDATE as any, this._screen)
  }

  /** 开始新的终端会话 */
  startTerminalSession(command: string): void {
    this._screen = {
      type: 'terminal',
      command,
      output: [{ text: `$ ${command}`, stream: 'stdout' }],
    }
    EventEmitter.emit(MONITOR_EVENTS.SCREEN_UPDATE as any, this._screen)
  }

  /** 设置浏览器截图 */
  setBrowserImage(base64: string, url: string): void {
    this._screen = { type: 'browser', image: base64, url }
    EventEmitter.emit(MONITOR_EVENTS.SCREEN_UPDATE as any, this._screen)
  }

  /** 回到空闲壁纸状态 */
  setIdle(): void {
    this._screen = { type: 'idle' }
    EventEmitter.emit(MONITOR_EVENTS.SCREEN_UPDATE as any, this._screen)
  }

  /** ── 日志 ─────────────────────────────────────── */

  getAll(): MonitorLogEntry[] {
    return [...this.logs]
  }

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
  }

  retroLog(logId: string): boolean {
    const idx = this.logs.findIndex((l) => l.id === logId)
    if (idx === -1) return false
    this.logs[idx] = { ...this.logs[idx], status: 'retro' }
    EventEmitter.emit(MONITOR_EVENTS.LOG_RETRO as any, this.logs[idx])
    return true
  }

  retroAll(): number {
    let count = 0
    this.logs = this.logs.map((l) => {
      if (l.status === 'ok') { count++; return { ...l, status: 'retro' } }
      return l
    })
    EventEmitter.emit(MONITOR_EVENTS.LOG_RETRO_ALL as any, count)
    return count
  }

  stopCurrent(): boolean {
    EventEmitter.emit(MONITOR_EVENTS.LOG_STOP as any)
    return true
  }

  private onMessageComplete = (_data: { status: string }) => {
    // 对话结束时回到空闲状态
    this.setIdle()
  }
}

export const MONITOR_EVENTS = {
  LOG_ADDED: 'monitor:log-added',
  LOG_RETRO: 'monitor:log-retro',
  LOG_RETRO_ALL: 'monitor:log-retro-all',
  LOG_STOP: 'monitor:log-stop',
  SCREEN_UPDATE: 'monitor:screen-update',
} as const

export default MonitorService
