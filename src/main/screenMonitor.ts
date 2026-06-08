/**
 * 桌面实时截屏模块 — desktopCapturer 全屏截图（稳定可靠）
 */
import { desktopCapturer, ipcMain, type BrowserWindow } from 'electron'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ScreenMonitor')

interface State { win: BrowserWindow | null; running: boolean; fps: number; hasListener: boolean; capturing: boolean; timer: ReturnType<typeof setTimeout> | null }
const st: State = { win: null, running: false, fps: 2, hasListener: false, capturing: false, timer: null }

async function captureAndPush(): Promise<void> {
  if (!st.win || st.win.isDestroyed() || !st.running || !st.hasListener || st.capturing) return
  st.capturing = true
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false })
    if (sources.length === 0 || !st.running) return
    if (st.win && !st.win.isDestroyed() && st.running) {
      st.win.webContents.send('screen-monitor:frame', { dataUrl: sources[0].thumbnail.toDataURL(), timestamp: Date.now() })
    }
  } catch (err) { logger.error('Screen capture failed', err as Error) }
  finally { st.capturing = false }
}

function schedule(): void {
  if (!st.running) return
  st.timer = setTimeout(async () => { await captureAndPush(); schedule() }, Math.max(200, Math.round(1000 / st.fps)))
}
function start(): void { if (!st.running) { st.running = true; schedule() } }
function stop(): void { st.running = false; st.capturing = false; if (st.timer) { clearTimeout(st.timer); st.timer = null } }

function regIpc(): void {
  const on = (c: string, h: (...a: any[]) => void) => { try { ipcMain.on(c, h) } catch {} }
  on('screen-monitor:start', () => { st.hasListener = true; start() })
  on('screen-monitor:stop', () => { st.hasListener = false; stop() })
  on('screen-monitor:set-fps', (_e: any, fps: number) => { st.fps = Math.max(1, Math.min(10, Math.round(fps))); if (st.running) { stop(); start() } })
}

export function initScreenMonitor(win: BrowserWindow): void {
  try { st.win = win; regIpc(); win.on('hide', () => stop()); win.on('show', () => { if (st.hasListener) start() }); win.on('minimize', () => stop()); win.on('restore', () => { if (st.hasListener) start() }); win.on('close', () => { stop(); st.win = null }); logger.info('ScreenMonitor initialized') }
  catch (err) { logger.error('Failed to init ScreenMonitor', err as Error) }
}
