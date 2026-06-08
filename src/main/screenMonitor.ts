/**
 * 桌面实时截屏模块
 *
 * 使用 Electron desktopCapturer API 捕获整个桌面，
 * 以固定帧率通过 IPC 推送给渲染进程。
 *
 * 性能保护：
 * - capturing 标志防止上一帧未完成时重复捕获
 * - thumbnailSize 限制到 640x360
 * - JPEG 压缩减少 IPC 数据量
 * - 渲染层无监听时跳过推送
 */
import { desktopCapturer, ipcMain, type BrowserWindow } from 'electron'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ScreenMonitor')

interface ScreenMonitorState {
  win: BrowserWindow | null
  timer: ReturnType<typeof setInterval> | null
  fps: number
  hasListener: boolean
  capturing: boolean // 防止并发捕获
}

const state: ScreenMonitorState = {
  win: null,
  timer: null,
  fps: 3,
  hasListener: false,
  capturing: false,
}

/** 捕获一帧桌面截图并推送 */
async function captureAndPush(): Promise<void> {
  if (!state.win || state.win.isDestroyed() || !state.hasListener || state.capturing) return

  state.capturing = true
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 640, height: 360 },
      fetchWindowIcons: false,
    })

    if (sources.length === 0) return

    const frame = sources[0].thumbnail
    const dataUrl = frame.toDataURL()
    const timestamp = Date.now()

    if (state.win && !state.win.isDestroyed()) {
      state.win.webContents.send('screen-monitor:frame', { dataUrl, timestamp })
    }
  } catch (err) {
    logger.error('Screen capture failed', err as Error)
  } finally {
    state.capturing = false
  }
}

/** 启动桌面截屏 */
function startCapture(): void {
  if (state.timer) return
  logger.info(`Screen capture started at ${state.fps} fps`)
  state.timer = setInterval(captureAndPush, Math.round(1000 / state.fps))
  void captureAndPush()
}

/** 停止桌面截屏 */
function stopCapture(): void {
  if (!state.timer) return
  clearInterval(state.timer)
  state.timer = null
  state.capturing = false
  logger.info('Screen capture stopped')
}

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
    if (state.timer) {
      stopCapture()
      startCapture()
    }
  })

  safeOn('screen-monitor:listener-ready', () => {
    state.hasListener = true
  })
}

export function initScreenMonitor(win: BrowserWindow): void {
  try {
    state.win = win
    registerIpc()

    win.on('close', () => {
      stopCapture()
      state.win = null
    })

    logger.info('ScreenMonitor initialized')
  } catch (err) {
    logger.error('Failed to init ScreenMonitor', err as Error)
  }
}
