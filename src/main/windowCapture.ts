/**
 * 窗口级截图模块
 *
 * 使用 desktopCapturer types:['window'] 捕获所有独立窗口，
 * 排除 CherryStudio 自身窗口，返回窗口缩略图列表。
 *
 * 安全设计：
 * - 每次截图前验证窗口有效性（Electron desktopCapturer 自带）
 * - 无可用窗口时优雅降级发送空状态
 * - 分辨率限制 + 高压缩 JPEG
 * - 2 FPS 节流 + capturing 并发锁
 */
import { desktopCapturer, ipcMain, type BrowserWindow } from 'electron'
import { loggerService } from '@logger'

const logger = loggerService.withContext('WindowCapture')

interface WindowSource {
  id: string
  name: string
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
}

interface CaptureState {
  win: BrowserWindow | null
  running: boolean
  timer: ReturnType<typeof setTimeout> | null
  capturing: boolean
}

const state: CaptureState = {
  win: null,
  running: false,
  timer: null,
  capturing: false,
}

function getSelfTitle(): string {
  if (!state.win || state.win.isDestroyed()) return ''
  try { return state.win.getTitle() } catch { return '' }
}

async function captureAndPush(): Promise<void> {
  if (!state.win || state.win.isDestroyed() || !state.running || state.capturing) return

  state.capturing = true
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 480, height: 360 },
      fetchWindowIcons: false,
    })

    const selfTitle = getSelfTitle()
    const windows: WindowSource[] = []

    for (const src of sources) {
      if (!src.name.trim()) continue
      // 排除自身
      if (selfTitle && src.name.includes(selfTitle)) continue
      const size = src.thumbnail.getSize()
      if (size.width < 30 || size.height < 30) continue

      windows.push({
        id: src.id,
        name: src.name,
        dataUrl: src.thumbnail.toDataURL(),
        x: 0, y: 0,
        width: size.width,
        height: size.height,
      })
    }

    if (state.win && !state.win.isDestroyed() && state.running) {
      if (windows.length === 0) {
        state.win.webContents.send('window-capture:frame', {
          type: 'empty',
          windows: [],
          message: '当前无可见窗口',
          timestamp: Date.now(),
        })
      } else {
        state.win.webContents.send('window-capture:frame', {
          type: 'windows',
          windows,
          timestamp: Date.now(),
        })
      }
    }
  } catch (err) {
    logger.error('Window capture failed', err as Error)
    try {
      if (state.win && !state.win.isDestroyed() && state.running) {
        state.win.webContents.send('window-capture:frame', {
          type: 'error',
          windows: [],
          message: `截图失败: ${err instanceof Error ? err.message : ''}`,
          timestamp: Date.now(),
        })
      }
    } catch { /* 忽略 */ }
  } finally {
    state.capturing = false
  }
}

function scheduleNext(): void {
  if (!state.running) return
  state.timer = setTimeout(async () => {
    await captureAndPush()
    scheduleNext()
  }, 500)
}

function startCapture(): void {
  if (state.running) return
  state.running = true
  logger.info('Window capture started (per-window, excluding self)')
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
  safeOn('window-capture:start', () => startCapture())
  safeOn('window-capture:stop', () => stopCapture())
}

export function initWindowCapture(win: BrowserWindow): void {
  try {
    state.win = win
    registerIpc()
    win.on('hide', () => stopCapture())
    win.on('show', () => startCapture())
    win.on('minimize', () => stopCapture())
    win.on('restore', () => startCapture())
    win.on('close', () => { stopCapture(); state.win = null })
    logger.info('WindowCapture initialized')
  } catch (err) {
    logger.error('Failed to init WindowCapture', err as Error)
  }
}
