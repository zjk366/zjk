/**
 * windowCaptureNative — PrintWindow 原生模块集成
 *
 * 使用 native/window_capture.node 捕获其他窗口，排除自身。
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
    logger.info('Loading native module from: ' + modPath)
    nativeMod = require(modPath)
    logger.info('Native window_capture module loaded OK')
  } catch (e) {
    logger.warn('Native window_capture module NOT available (screen fallback will be used)')
  }
  return nativeMod
}

interface State {
  win: BrowserWindow | null; running: boolean; timer: ReturnType<typeof setTimeout> | null; capturing: boolean
}
const st: State = { win: null, running: false, timer: null, capturing: false }

function captureAndPush(): void {
  const nm = getNative()
  if (!nm || !st.win || st.win.isDestroyed() || !st.running || st.capturing) return
  st.capturing = true

  try {
    // 获取所有窗口（不排除 PID 了，用标题过滤）
    const allWins: any[] = nm.listWindows() || []
    const selfTitle = st.win && !st.win.isDestroyed() ? st.win.getTitle() : ''
    logger.info(`Native: listed ${allWins.length} windows, selfTitle="${selfTitle}"`)
    if (allWins.length > 0) {
      logger.info(`Native: first window: "${allWins[0].title}" pid=${allWins[0].pid}`)
    }

    // 排除系统透明覆盖层窗口（如 Windows Input Experience、Overlay 等）
    const excludeKeywords = ['input', '体验', 'overlay', 'nahimic', 'program manager']
    const targets = allWins.filter((w: any) => {
      if (!w.title || !w.title.trim()) return false
      if (w.width < 200 || w.height < 150) return false
      const t = w.title.toLowerCase()
      if (excludeKeywords.some((k) => t.includes(k))) return false
      if (selfTitle && t.includes(selfTitle.toLowerCase())) return false
      return true
    }).slice(0, 3)
    logger.info(`Native: ${targets.length} target windows to capture`)

    const captured: { pngBuffer: Buffer; left: number; top: number; width: number; height: number }[] = []
    for (const w of targets) {
      try {
        const buf = nm.captureWindow(w.hwnd, w.width, w.height, 1280, 960)
        if (buf && buf.length > 200) {
          captured.push({ pngBuffer: buf, left: w.left || 0, top: w.top || 0, width: w.width, height: w.height })
        }
      } catch { /* skip failed captures */ }
    }

    logger.info(`Native: captured ${captured.length} windows successfully`)
    if (st.win && !st.win.isDestroyed() && st.running) {
      if (captured.length > 0) {
        st.win.webContents.send('printwindow:frame', {
          windows: captured.map((c) => ({
            pngBuffer: c.pngBuffer, left: c.left, top: c.top, width: c.width, height: c.height,
          })),
          timestamp: Date.now(),
        })
      }
    }
  } catch (err) {
    logger.error('Native capture failed', err as Error)
  }
  st.capturing = false
}

function schedule(): void {
  if (!st.running) return
  st.timer = setTimeout(() => { captureAndPush(); schedule() }, 800)
}
function start(): void { if (!st.running && getNative()) { st.running = true; schedule(); logger.info('Native PW capture started') } }
function stop(): void { st.running = false; st.capturing = false; if (st.timer) { clearTimeout(st.timer); st.timer = null } }

function registerIpc(): void {
  const on = (c: string, h: (...a: any[]) => void) => { try { ipcMain.on(c, h) } catch {} }
  on('printwindow:start', () => start()); on('printwindow:stop', () => stop())
}

export function initWindowCaptureNative(win: BrowserWindow): void {
  try {
    if (!getNative()) { logger.warn('Native module not available, PrintWindow disabled'); return }
    st.win = win; registerIpc()
    win.on('hide', () => stop()); win.on('show', () => start())
    win.on('minimize', () => stop()); win.on('restore', () => start())
    win.on('close', () => { stop(); st.win = null })
    logger.info('Native WindowCapture initialized')
  } catch (err) { logger.error('Failed to init native capture', err as Error) }
}
