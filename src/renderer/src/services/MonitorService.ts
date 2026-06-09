/**
 * 监控室服务 — 记录 AI 所有操作日志 + 实时屏幕内容
 *
 * 通过 EventEmitter 发布日志事件和屏幕更新事件。
 * 日志 = 历史记录；屏幕 = 当前正在发生的实时画面。
 *
 * 增强功能：
 * - retroLog() 真正从 UndoVault 回溯恢复被删除/覆写的文件
 * - 2 分钟无操作自动清理：清空日志 + 丢弃过期 vault 备份
 * - stopCurrent() 中止正在执行的 MCP 工具
 */
import { loggerService } from '@logger'
import type { MonitorLogEntry, MonitorLogStatus, ScreenContent } from '@renderer/types/monitor'
import { abortAllCompletions } from '@renderer/utils/abortController'

import { EVENT_NAMES, EventEmitter } from './EventService'

const logger = loggerService.withContext('MonitorService')

/** 20 秒无操作超时（毫秒） */
const IDLE_TIMEOUT_MS = 20 * 1000

class MonitorService {
  private static instance: MonitorService
  private logs: MonitorLogEntry[] = []
  private _screen: ScreenContent = { type: 'idle' }
  private initialized = false
  /** 当前正在执行的 toolCallId（用于停止按钮中止 MCP 工具） */
  private currentToolCallId: string | null = null
  /** 20 秒空闲定时器 */
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  static getInstance(): MonitorService {
    if (!MonitorService.instance) {
      MonitorService.instance = new MonitorService()
      MonitorService.instance.init()
    }
    return MonitorService.instance
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true
    EventEmitter.on(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)

    // 监听主进程推送的实时终端输出
    try {
      window.electron?.ipcRenderer?.on(
        'monitor:terminal-output',
        (
          _event: any,
          data: {
            command: string
            text: string
            stream: 'stdout' | 'stderr'
            sessionId: string
          }
        ) => {
          // 首次收到输出 → 启动终端会话
          if (this._screen.type !== 'terminal' || this._screen.command !== data.command) {
            this._screen = { type: 'terminal', command: data.command, output: [] }
          }
          // 非空行才追加
          if (data.text) {
            ;(this._screen as any).output.push({ text: data.text, stream: data.stream })
          }
          EventEmitter.emit(MONITOR_EVENTS.SCREEN_UPDATE as any, this._screen)
        }
      )
    } catch {
      /* 兼容无 IPC 环境 */
    }

    logger.info('MonitorService initialized')
  }

  destroy(): void {
    EventEmitter.off(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)
    this.clearIdleTimer()
    this.initialized = false
  }

  /** 设置当前正在执行的 toolCallId */
  setCurrentToolCallId(toolCallId: string | null): void {
    this.currentToolCallId = toolCallId
    if (toolCallId) {
      this.clearIdleTimer()
      // 有 AI 操作 → 启动桌面截屏
      this.startCapture()
    }
  }

  /** ── 桌面截屏控制 ─────────────────────────────── */

  /** 启动桌面实时截屏（PrintWindow） */
  startCapture(): void {
    try {
      const sm = (window as any).screenMonitor
      if (sm && typeof sm.start === 'function') {
        sm.start()
        logger.debug('Screen capture started')
      }
    } catch {
      /* 兼容无 screenMonitor 环境 */
    }
  }

  /** 停止桌面实时截屏 */
  stopCapture(): void {
    try {
      const sm = (window as any).screenMonitor
      if (sm && typeof sm.stop === 'function') {
        sm.stop()
        logger.debug('Screen capture stopped')
      }
    } catch {
      /* 兼容无 screenMonitor 环境 */
    }
    this.setIdle()
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
        output: [{ text: line, stream }]
      }
    }
    EventEmitter.emit(MONITOR_EVENTS.SCREEN_UPDATE as any, this._screen)
  }

  /** 开始新的终端会话 */
  startTerminalSession(command: string): void {
    this._screen = {
      type: 'terminal',
      command,
      output: [{ text: `$ ${command}`, stream: 'stdout' }]
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

  addLog(
    action: string,
    status: MonitorLogStatus,
    meta?: { source?: string; filePath?: string; retroData?: unknown }
  ): void {
    const entry: MonitorLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      action,
      status,
      ...meta
    }
    this.logs.push(entry)
    EventEmitter.emit(MONITOR_EVENTS.LOG_ADDED as any, entry)

    // 操作完成 → 重置 toolCallId + 启动 20 秒空闲计时器
    this.currentToolCallId = null
    this.scheduleIdleCleanup()
  }

  /** 从 UndoVault 恢复被操作的文件（真正撤销） */
  async retroLog(logId: string): Promise<boolean> {
    const idx = this.logs.findIndex((l) => l.id === logId)
    if (idx === -1) return false

    const log = this.logs[idx]
    const vaultEntryId = (log as any).retroData?.vaultEntryId as string | undefined

    if (vaultEntryId) {
      try {
        const restored = await (window as any).api?.undoVault?.restore(vaultEntryId)
        if (restored && restored > 0) {
          logger.info(`UndoVault restore success: ${vaultEntryId} (${restored} files)`)
          window.toast?.success?.(`已恢复 ${restored} 个文件`)
        } else {
          logger.warn(`UndoVault restore returned 0 files: ${vaultEntryId}`)
          window.toast?.info?.('未找到可恢复的文件（可能备份已过期）')
        }
      } catch (err) {
        logger.error('Failed to restore from UndoVault:', err as Error)
        window.toast?.error?.('回溯恢复失败')
      }
      // 无论成功与否，都丢弃该备份（避免残留）
      try {
        await (window as any).api?.undoVault?.discard(vaultEntryId)
      } catch {
        /* ok */
      }
    } else {
      window.toast?.info?.('该操作无可回溯的备份数据')
    }

    this.logs[idx] = { ...log, status: 'retro' }
    EventEmitter.emit(MONITOR_EVENTS.LOG_RETRO as any, this.logs[idx])

    // 回溯完成后重置监控室
    this.resetRoomAfterRetro()
    return true
  }

  /** 批量回溯所有可回溯的操作 */
  async retroAll(): Promise<number> {
    let count = 0
    for (let i = this.logs.length - 1; i >= 0; i--) {
      if (this.logs[i].status === 'ok') {
        const vaultEntryId = (this.logs[i] as any).retroData?.vaultEntryId as string | undefined
        if (vaultEntryId) {
          try {
            await (window as any).api?.undoVault?.restore(vaultEntryId)
            await (window as any).api?.undoVault?.discard(vaultEntryId)
          } catch {
            /* ok */
          }
        }
        this.logs[i] = { ...this.logs[i], status: 'retro' }
        count++
      }
    }
    EventEmitter.emit(MONITOR_EVENTS.LOG_RETRO_ALL as any, count)

    // 回溯完成后重置监控室
    if (count > 0) this.resetRoomAfterRetro()
    return count
  }

  /** 回溯完成后重置监控室：清空日志 + 停止截屏 + 回到空闲 */
  private resetRoomAfterRetro(): void {
    // 丢弃所有 vault 备份
    for (const log of this.logs) {
      const vaultEntryId = (log as any).retroData?.vaultEntryId as string | undefined
      if (vaultEntryId) {
        try {
          void (window as any).api?.undoVault?.discard(vaultEntryId)
        } catch {
          /* ok */
        }
      }
    }
    // 清空日志
    this.logs = []
    EventEmitter.emit(MONITOR_EVENTS.LOG_RETRO_ALL as any, 0)
    // 停止截屏 + 回到空闲
    this.stopCapture()
    // 清除空闲计时器（不需要再触发清理了）
    this.clearIdleTimer()
  }

  /** 一键完全停止：中止当前 MCP 工具 + 全局中止所有 AI 操作 */
  stopCurrent(): boolean {
    // 1) 中止当前正在执行的 MCP 工具
    if (this.currentToolCallId) {
      try {
        void (window as any).api?.mcp?.abortTool(this.currentToolCallId)
        logger.info(`Aborted tool: ${this.currentToolCallId}`)
      } catch (err) {
        logger.error('Failed to abort tool:', err as Error)
      }
    }

    // 2) 全局中止所有 AI 消息生成（流式请求、翻译、Agent 会话等）
    try {
      abortAllCompletions()
      logger.info('Aborted all AI completions')
    } catch (err) {
      logger.error('Failed to abort all completions:', err as Error)
    }

    EventEmitter.emit(MONITOR_EVENTS.LOG_STOP as any)
    return true
  }

  /** ── 2 分钟空闲清理 ───────────────────────────── */

  private scheduleIdleCleanup(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      void this.performIdleCleanup()
    }, IDLE_TIMEOUT_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  /** 执行空闲清理：清空日志 + 丢弃过期 vault 备份 + 回到空闲 */
  private async performIdleCleanup(): Promise<void> {
    logger.info('Idle timeout: cleaning up monitor room')

    // 丢弃所有 vault 备份
    for (const log of this.logs) {
      const vaultEntryId = (log as any).retroData?.vaultEntryId as string | undefined
      if (vaultEntryId) {
        try {
          await (window as any).api?.undoVault?.discard(vaultEntryId)
        } catch {
          /* ok */
        }
      }
    }

    // 清空日志
    this.logs = []
    EventEmitter.emit(MONITOR_EVENTS.LOG_RETRO_ALL as any, 0)

    // 回到空闲并停止截屏
    this.stopCapture()

    // 也触发服务端清理，清除过期条目
    try {
      await (window as any).api?.undoVault?.cleanup()
    } catch {
      /* ok */
    }

    logger.info('Monitor room cleaned up after idle timeout')
  }

  private onMessageComplete = (_data: { status: string }) => {
    // 对话结束 → 停止截屏，回到空闲
    this.stopCapture()
  }
}

export const MONITOR_EVENTS = {
  LOG_ADDED: 'monitor:log-added',
  LOG_RETRO: 'monitor:log-retro',
  LOG_RETRO_ALL: 'monitor:log-retro-all',
  LOG_STOP: 'monitor:log-stop',
  SCREEN_UPDATE: 'monitor:screen-update'
} as const

export default MonitorService
