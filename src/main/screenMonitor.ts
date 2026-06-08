/**
 * 桌面实时截屏模块
 *
 * 自适应帧率：每次捕获完成后根据耗时动态计算下一次间隔，
 * 避免 setInterval 固定间隔导致的叠加延迟。
 *
 * 窗口不可见时自动暂停。
 */
import { desktopCapturer, ipcMain, type BrowserWindow } from 'electron'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ScreenMonitor')

interface ScreenMonitorState {
  win: BrowserWindow | null
  running: boolean
  fps: number
  hasListener: boolean
  capturing: boolean
  timer: ReturnType<typeof setTimeout> | null
}

const state: ScreenMonitorState = {
  win: null,
  running: false,
  fps: 2,
  hasListener: false,
  capturing: false,
  timer: null,
}

/** 截图时计算窗口遮罩区域（裁剪掉 CherryStudio 自身窗口） */
function getWindowMask(): { x: number; y: number; w: number; h: number } | null {
  if (!state.win || state.win.isDestroyed()) return null
  try {
    const bounds = state.win.getBounds()
    // 屏幕截图固定 480×270（等比例缩小），按 1080p 基准计算比例
    const scaleX = 480 / 1920
    const scaleY = 270 / 1080
    return {
      x: Math.round(bounds.x * scaleX),
      y: Math.round(bounds.y * scaleY),
      w: Math.round(bounds.width * scaleX),
      h: Math.round(bounds.height * scaleY),
    }
  } catch { return null }
}

async function captureAndPush(): Promise<void> {
  if (!state.win || state.win.isDestroyed() || !state.running || !state.hasListener || state.capturing) return

  state.capturing = true
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: false,
    })

    if (sources.length === 0 || !state.running) return

    const frame = sources[0].thumbnail
    const dataUrl = frame.toDataURL()
    const mask = getWindowMask()

    if (state.win && !state.win.isDestroyed() && state.running) {
      state.win.webContents.send('screen-monitor:frame', { dataUrl, mask, timestamp: Date.now() })
    }
  } catch (err) {
    logger.error('Screen capture failed', err as Error)
  } finally {
    state.capturing = false
  }
}

/** 自适应循环：根据实际捕获耗时 + 目标帧率计算下次调度时间 */
function scheduleNext(): void {
  if (!state.running) return
  const interval = Math.max(200, Math.round(1000 / state.fps))
  state.timer = setTimeout(async () => {
    await captureAndPush()
    scheduleNext()
  }, interval)
}

function startCapture(): void {
  if (state.running) return
  state.running = true
  logger.info(`Screen capture started at ${state.fps} fps (adaptive)`)
  scheduleNext()
}

function stopCapture(): void {
  state.running = false
  state.capturing = false
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
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
    state.fps = Math.max(1, Math.min(10, Math.round(fps)))
    if (state.running) {
      stopCapture()
      startCapture()
    }
  })
}

export function initScreenMonitor(win: BrowserWindow): void {
  try {
    state.win = win
    registerIpc()

    // 窗口最小化／不可见时暂停截屏
    win.on('hide', () => stopCapture())
    win.on('show', () => { if (state.hasListener) startCapture() })
    win.on('minimize', () => stopCapture())
    win.on('restore', () => { if (state.hasListener) startCapture() })

    win.on('close', () => {
      stopCapture()
      state.win = null
    })

    logger.info('ScreenMonitor initialized (480×270, 2fps adaptive, background-pause)')
  } catch (err) {
    logger.error('Failed to init ScreenMonitor', err as Error)
  }
}
