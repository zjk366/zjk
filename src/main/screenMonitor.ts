/**
 * 桌面实时截屏模块
 *
 * 捕获前短暂透明化自身窗口，使截图不包含 CherryStudio 窗口，
 * 实现"看到窗口背后内容"的效果。
 *
 * 自适应帧率、窗口不可见时自动暂停。
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

/** 捕获前短暂隐藏窗口，抓取背后桌面，再恢复 */
async function captureAndPush(): Promise<void> {
  if (!state.win || state.win.isDestroyed() || !state.running || !state.hasListener || state.capturing) return

  state.capturing = true
  try {
    // 1. 窗口透明化
    state.win.setOpacity(0)

    // 2. 等待一帧让系统重绘（15ms ≈ 60fps 一帧）
    await new Promise((r) => setTimeout(r, 15))

    // 3. 截屏（此时窗口已透明，不会被拍到）
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: false,
    })

    // 4. 恢复窗口不透明度
    if (state.win && !state.win.isDestroyed()) {
      state.win.setOpacity(1)
    }

    if (sources.length === 0 || !state.running) return

    const frame = sources[0].thumbnail
    const dataUrl = frame.toDataURL()

    if (state.win && !state.win.isDestroyed() && state.running) {
      state.win.webContents.send('screen-monitor:frame', { dataUrl, timestamp: Date.now() })
    }

    // 恢复不透明度（兜底，防止上面 setOpacity(1) 因异常没执行到）
    try {
      if (state.win && !state.win.isDestroyed()) state.win.setOpacity(1)
    } catch { /* ok */ }
  } catch (err) {
    // 无论什么异常都要恢复窗口不透明度
    try { if (state.win && !state.win.isDestroyed()) state.win.setOpacity(1) } catch { /* ok */ }
    logger.error('Screen capture failed', err as Error)
  } finally {
    state.capturing = false
  }
}

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
  logger.info('Screen capture started at 2fps (transparent-window mode)')
  scheduleNext()
}

function stopCapture(): void {
  state.running = false
  state.capturing = false
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  // 确保窗口可见
  try { if (state.win && !state.win.isDestroyed()) state.win.setOpacity(1) } catch { /* ok */ }
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
    if (state.running) { stopCapture(); startCapture() }
  })
}

export function initScreenMonitor(win: BrowserWindow): void {
  try {
    state.win = win
    registerIpc()

    win.on('hide', () => stopCapture())
    win.on('show', () => { if (state.hasListener) startCapture() })
    win.on('minimize', () => stopCapture())
    win.on('restore', () => { if (state.hasListener) startCapture() })
    win.on('close', () => { stopCapture(); state.win = null })

    logger.info('ScreenMonitor initialized (transparent-window capture)')
  } catch (err) {
    logger.error('Failed to init ScreenMonitor', err as Error)
  }
}
