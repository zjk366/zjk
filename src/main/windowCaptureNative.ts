/**
 * windowCaptureNative — PrintWindow 原生模块集成
 *
 * C++ 层已过滤：系统覆盖层、透明窗口、DWM Cloak、进程黑名单
 * TS 层处理：空白帧计数降级、自身窗口排除
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { loggerService } from '@logger'

const logger = loggerService.withContext('NativeWindowCap')

const pathMod = require('path')
let nativeMod: any = null
function getNative(): any {
  if (nativeMod) return nativeMod
  try {
    const modPath = pathMod.join(__dirname, '..', '..', 'native', 'build', 'Release', 'window_capture.node')
    nativeMod = require(modPath)
    logger.info('Native window_capture module loaded OK')
  } catch (e) {
    logger.warn('Native window_capture module NOT available')
  }
  return nativeMod
}

interface State {
  win: BrowserWindow | null; running: boolean; timer: ReturnType<typeof setTimeout> | null; capturing: boolean
}
const st: State = { win: null, running: false, timer: null, capturing: false }

let blankFrameCount = 0
const MAX_BLANK_RETRY = 3

function captureAndPush(): void {
  const nm = getNative()
  if (!nm || !st.win || st.win.isDestroyed() || !st.running || st.capturing) return
  st.capturing = true

  try {
    // C++ 层已经过滤了系统覆盖层、透明窗口、自身进程
    // 此处只需按尺寸二次过滤
    const allWins: any[] = nm.listWindows(process.pid) || []
    const targets = allWins.filter((w: any) => {
      if (!w.title || !w.title.trim()) return false
      if (w.width < 200 || w.height < 150) return false
      return true
    }).slice(0, 3)

    const captured: { pngBuffer: Buffer; left: number; top: number; width: number; height: number }[] = []
    for (const w of targets) {
      try {
        const buf = nm.captureWindow(w.hwnd, w.width, w.height, 1280, 960)
        if (buf && buf.length > 200) {
          captured.push({ pngBuffer: buf, left: w.left || 0, top: w.top || 0, width: w.width, height: w.height })
          blankFrameCount = 0
        }
      } catch (e: any) {
        if (e?.message === 'BLANK_FRAME') {
          blankFrameCount++
          logger.warn(`Blank frame #${blankFrameCount} for "${w.title}"`)
          if (blankFrameCount >= MAX_BLANK_RETRY) {
            logger.warn(`Window "${w.title}" unavailable after ${MAX_BLANK_RETRY} blanks, skipping`)
          }
        }
      }
    }

    if (captured.length > 0 && st.win && !st.win.isDestroyed() && st.running) {
      st.win.webContents.send('printwindow:frame', {
        windows: captured.map((c) => ({
          pngBuffer: c.pngBuffer, left: c.left, top: c.top, width: c.width, height: c.height,
        })),
        timestamp: Date.now(),
      })
    }
    blankFrameCount = 0
  } catch (err) {
    logger.error('Native capture failed', err as Error)
  }
  st.capturing = false
}

function schedule(): void {
  if (!st.running) return
  st.timer = setTimeout(() => { captureAndPush(); schedule() }, 1000)
}
function start(): void { if (!st.running && getNative()) { st.running = true; schedule(); logger.info('Native PW capture started') } }
function stop(): void { st.running = false; st.capturing = false; if (st.timer) { clearTimeout(st.timer); st.timer = null } }

function registerIpc(): void {
  const on = (c: string, h: (...a: any[]) => void) => { try { ipcMain.on(c, h) } catch {} }
  on('printwindow:start', () => start()); on('printwindow:stop', () => stop())
}

export function initWindowCaptureNative(win: BrowserWindow): void {
  try {
    if (!getNative()) { logger.warn('Native module not available'); return }
    st.win = win; registerIpc()
    win.on('hide', () => stop()); win.on('show', () => start())
    win.on('minimize', () => stop()); win.on('restore', () => start())
    win.on('close', () => { stop(); st.win = null })
    logger.info('Native WindowCapture initialized')
  } catch (err) { logger.error('Failed to init native capture', err as Error) }
}
