/**
 * 桌面实时截屏模块
 *
 * 直接捕获全屏（含 CherryStudio 自身窗口），不做透明处理。
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

async function captureAndPush(): Promise<void> {
  if (!state.win || state.win.isDestroyed() || !state.running || !state.hasListener || state.capturing) return

  state.capturing = true
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false,
    })

    if (sources.length === 0 || !state.running) return

    const dataUrl = sources[0].thumbnail.toDataURL()

    if (state.win && !state.win.isDestroyed() && state.running) {
      state.win.webContents.send('screen-monitor:frame', { dataUrl, timestamp: Date.now() })
    }
  } catch (err) {
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
  logger.info('Screen capture started (direct screen, no transparency)')
  scheduleNext()
}

function stopCapture(): void {
  state.running = false
  state.capturing = false
  if (state.timer) { clearTimeout(state.timer); state.timer = null }
}

function registerIpc(): void {
  const safeOn = (channel: string, handler: (...args: any[]) => void) => {
    try { ipcMain.on(channel, handler) } catch { /* 已注册，跳过 */ }
  }

  safeOn('screen-monitor:start', () => { state.hasListener = true; startCapture() })
  safeOn('screen-monitor:stop', () => { state.hasListener = false; stopCapture() })
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
    logger.info('ScreenMonitor initialized')
  } catch (err) {
    logger.error('Failed to init ScreenMonitor', err as Error)
  }
}
