/**
 * 桌面实时截屏模块
 *
 * 使用 Electron desktopCapturer API 捕获整个桌面，
 * 以固定帧率通过 IPC 推送给渲染进程。
 *
 * 安全约束：
 * - 仅主进程调用 desktopCapturer
 * - IPC 通道加 screen-monitor: 前缀
 * - thumbnailSize 限制内存
 * - 无渲染层监听时跳过推送
 */
import { desktopCapturer, ipcMain, type BrowserWindow } from 'electron'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ScreenMonitor')

interface ScreenMonitorState {
  win: BrowserWindow | null
  timer: ReturnType<typeof setInterval> | null
  fps: number
  hasListener: boolean
}

const state: ScreenMonitorState = {
  win: null,
  timer: null,
  fps: 1,
  hasListener: false,
}

/** 捕获一帧桌面截图并推送 */
async function captureAndPush(): Promise<void> {
  if (!state.win || state.win.isDestroyed() || !state.hasListener) return

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
      fetchWindowIcons: false,
    })

    if (sources.length === 0) return

    // 取第一个屏幕（主屏）的缩略图
    const frame = sources[0].thumbnail
    const dataUrl = frame.toDataURL()
    const timestamp = Date.now()

    if (state.win && !state.win.isDestroyed()) {
      state.win.webContents.send('screen-monitor:frame', { dataUrl, timestamp })
    }
  } catch (err) {
    logger.error('Screen capture failed', err as Error)
  }
}

/** 启动桌面截屏 */
function startCapture(): void {
  if (state.timer) return
  logger.info(`Screen capture started at ${state.fps} fps`)
  state.timer = setInterval(captureAndPush, Math.round(1000 / state.fps))
  // 立即推一帧
  void captureAndPush()
}

/** 停止桌面截屏 */
function stopCapture(): void {
  if (!state.timer) return
  clearInterval(state.timer)
  state.timer = null
  logger.info('Screen capture stopped')
}

/** 注册 IPC 处理器 */
function registerIpc(): void {
  const safeOn = (channel: string, handler: (...args: any[]) => void) => {
    try { ipcMain.on(channel, handler) } catch { /* 已注册，跳过 */ }
  }

  safeOn('screen-monitor:start', () => {
    state.hasListener = true
    startCapture()
  })

  safeOn('screen-monitor:stop', () => {
    state.hasListener = false
    stopCapture()
  })

  safeOn('screen-monitor:set-fps', (_event: any, fps: number) => {
    const clamped = Math.max(1, Math.min(10, Math.round(fps)))
    state.fps = clamped
    logger.info(`Screen capture FPS set to ${clamped}`)
    if (state.timer) {
      stopCapture()
      startCapture()
    }
  })

  // 渲染进程通知：监听器就绪
  safeOn('screen-monitor:listener-ready', () => {
    state.hasListener = true
  })
}

/**
 * 初始化桌面截屏模块
 * 在 main.ts 末尾调用：initScreenMonitor(mainWindow)
 */
export function initScreenMonitor(win: BrowserWindow): void {
  try {
    state.win = win
    registerIpc()

    // 窗口关闭时清理
    win.on('close', () => {
      stopCapture()
      state.win = null
    })

    logger.info('ScreenMonitor initialized')
  } catch (err) {
    logger.error('Failed to init ScreenMonitor', err as Error)
  }
}
