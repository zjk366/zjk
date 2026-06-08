/**
 * 桌面实时截屏模块 — PrintWindow 原生捕获（主）+ desktopCapturer 降级
 *
 * 安全策略：
 *   - 绝不捕获 Cherry Studio 自身窗口
 *   - PrintWindow 失败时不降级到全屏截图（避免暴露自身）
 *   - 捕获前 HWND 自检 + 标题校验双重防护
 */
import { desktopCapturer, BrowserWindow, ipcMain } from 'electron'
import { loggerService } from '@logger'
import { enumerateWindows as enumerateWindowsKoffi } from './windowEnumerator'

const logger = loggerService.withContext('ScreenMonitor')

const pathMod = require('path')
let nativeMod: any = null
function getNative(): any {
  if (nativeMod) return nativeMod
  try {
    const modPath = pathMod.join(__dirname, '..', '..', 'native', 'build', 'Release', 'window_capture.node')
    nativeMod = require(modPath)
    logger.info('Native window_capture module loaded OK')
  } catch (e) {
    logger.warn('Native window_capture module NOT available, will use desktopCapturer fallback')
  }
  return nativeMod
}

interface TargetInfo {
  hwndStr: string
  title: string
  width: number
  height: number
}

interface State {
  win: BrowserWindow | null
  running: boolean
  fps: number
  hasListener: boolean
  capturing: boolean
  timer: ReturnType<typeof setTimeout> | null
  target: TargetInfo | null
}
const st: State = {
  win: null, running: false, fps: 2, hasListener: false,
  capturing: false, timer: null, target: null,
}

/** 简单判断窗口标题是否属于 Cherry Studio 自身 */
function isCherryStudioTitle(title: string): boolean {
  const t = (title || '').toLowerCase()
  return t.includes('cherry studio') || t.includes('cherrystudio') || t === '监控室'
}

async function captureAndPush(): Promise<void> {
  if (!st.win || st.win.isDestroyed() || !st.running || !st.hasListener || st.capturing) return
  st.capturing = true
  const ts = Date.now()
  let dataUrl = ''
  let source: string = 'lost'
  let rawBuffer: Buffer | undefined
  let width: number | undefined
  let height: number | undefined
  let contentOffsetX: number | undefined
  let contentOffsetY: number | undefined
  let contentWidth: number | undefined
  let contentHeight: number | undefined
  let isValid: boolean | undefined
  let captured = false

  try {
    // ── 1️⃣ PrintWindow 原生捕获 ──────────────────────
    const nm = getNative()
    if (nm && st.target) {
      if (isCherryStudioTitle(st.target.title)) {
        logger.warn(`Target "${st.target.title}" looks like Cherry Studio, SKIP`)
      } else {
        logger.info(`PW capture: hwnd=${st.target.hwndStr} title="${st.target.title}"`)
        try {
          const result: Record<string, any> = nm.captureWindow(st.target.hwndStr)
          if (result && result.rawBuffer && result.width > 0 && result.height > 0) {
            logger.info(`PW OK: ${result.width}x${result.height} isValid=${result.isValid} bufLen=${result.rawBuffer.length}`)
            rawBuffer = result.rawBuffer
            width = result.width
            height = result.height
            contentOffsetX = result.contentOffsetX
            contentOffsetY = result.contentOffsetY
            contentWidth = result.contentWidth
            contentHeight = result.contentHeight
            isValid = result.isValid

            if (result.isValid) {
              source = 'printwindow'
              captured = true
            } else {
              logger.warn(`PW blank frame for "${st.target.title}"`)
            }
          } else {
            logger.warn(`PW returned empty result for "${st.target.title}"`)
          }
        } catch (e: any) {
          logger.warn(`PW failed for "${st.target.title}":`, e?.message || String(e))
        }
      }
    }

    // ── 2️⃣ 降级：desktopCapturer ──────────────────────
    if (!captured) {
      logger.info('PW fallback: trying desktopCapturer')
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false,
      })
      if (sources.length > 0) {
        dataUrl = sources[0].thumbnail.toDataURL()
        source = 'screen'
        logger.info(`DC OK: dataUrlLen=${dataUrl.length}`)
      } else {
        logger.warn('DC returned 0 sources')
      }
    }

    // ── 发送帧 ──────────────────────────────────────
    if (st.win && !st.win.isDestroyed() && st.running) {
      const pwStatus = captured ? 'ok' : (st.target ? 'fail' : 'no_target')
      const frame = {
        dataUrl,
        source: captured ? source : (dataUrl ? 'screen' : 'lost'),
        width,
        height,
        rawBuffer,
        contentOffsetX,
        contentOffsetY,
        contentWidth,
        contentHeight,
        isValid,
        timestamp: ts,
        pwStatus,
      }
      st.win.webContents.send('screen-monitor:frame', frame)
    }
  } catch (err) {
    logger.error('Screen capture failed', err as Error)
  } finally {
    st.capturing = false
  }
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
  on('screen-monitor:set-fps', (_e: any, fps: number) => {
    st.fps = Math.max(1, Math.min(10, Math.round(fps)))
    if (st.running) { stop(); start() }
  })

  on('screen-monitor:set-target', (_e: any, payload: { hwnd: string; title: string; width: number; height: number }) => {
    if (!payload?.hwnd) { logger.warn('set-target: missing hwnd'); return }
    // 标题自检：阻止 Cherry Studio 窗口被设为目标
    if (isCherryStudioTitle(payload.title || '')) {
      logger.warn(`Rejected set-target: "${payload.title}" is Cherry Studio`)
      return
    }
    st.target = {
      hwndStr: payload.hwnd,
      title: payload.title || '',
      width: payload.width || 0,
      height: payload.height || 0,
    }
    logger.info(`PrintWindow target set: "${st.target.title}" (${st.target.hwndStr})`)
  })
  on('screen-monitor:clear-target', () => {
    st.target = null
    logger.info('PrintWindow target cleared')
  })

  on('screen-monitor:list-windows', (event: any) => {
    try {
      // ── 收集自窗口信息 ────────────────────────────
      const ourHwnds = new Set<string>()
      const ourPids = new Set<number>([process.pid])
      let bwReady = false

      try {
        if (typeof BrowserWindow !== 'undefined') {
          const wins = BrowserWindow.getAllWindows()
          bwReady = wins.length > 0
          for (const bw of wins) {
            try {
              if (bw.isDestroyed()) continue
              // HWND
              const buf: Buffer = bw.getNativeWindowHandle()
              if (buf && buf.byteLength >= 4) {
                const val = buf.byteLength >= 8
                  ? String(buf.readBigUInt64LE(0))
                  : String(buf.readUInt32LE(0))
                ourHwnds.add(val)
              }
              // PID
              const rPid = bw.webContents.getOSProcessId()
              if (rPid > 0) ourPids.add(rPid)
            } catch { /* skip broken window */ }
          }
        }
      } catch { /* ok */ }
      if (!bwReady) {
        // BrowserWindow 不可用时：只用标题过滤 + PID 过滤
        logger.warn('BrowserWindow unavailable, using title-only self-window filtering')
      }

      // ── C++ + koffi 双路枚举，取并集 ─────────────
      const seen = new Set<string>()
      const results: any[] = []

      const addWindow = (w: any) => {
        const key = `${w.hwnd}|${w.title}|${w.pid}`
        if (seen.has(key)) return
        seen.add(key)
        // 排除自窗口：HWND + PID + 标题 三重判断
        if (ourHwnds.has(String(w.hwnd))) return
        if (bwReady && ourPids.has(w.pid)) return
        if (isCherryStudioTitle(w.title || '')) return
        results.push({
          hwnd: String(w.hwnd),
          title: w.title || '',
          pid: w.pid || 0,
          width: w.width || 0,
          height: w.height || 0,
          left: w.left || 0,
          top: w.top || 0,
          isMinimized: false,
        })
      }

      // 1. C++ 原生枚举
      const nm = getNative()
      if (nm) {
        try { (nm.listWindows(process.pid) || []).forEach(addWindow) }
        catch { /* fallthrough */ }
      }

      // 2. koffi 枚举（兜底）
      try {
        enumerateWindowsKoffi({ excludePid: 0, minWidth: 50, minHeight: 30 }).forEach(addWindow)
      } catch { /* fallthrough */ }

      event.returnValue = results
    } catch (err) {
      logger.error('list-windows failed', err as Error)
      event.returnValue = []
    }
  })
}

export function initScreenMonitor(win: BrowserWindow): void {
  try {
    st.win = win
    regIpc()
    win.on('hide', () => stop())
    win.on('show', () => { if (st.hasListener) start() })
    win.on('minimize', () => stop())
    win.on('restore', () => { if (st.hasListener) start() })
    win.on('close', () => { stop(); st.win = null })
    logger.info('ScreenMonitor initialized (self-HWND protection active)')
  } catch (err) {
    logger.error('Failed to init ScreenMonitor', err as Error)
  }
}

export function setTarget(info: TargetInfo | null): void { st.target = info }
export function getTarget(): TargetInfo | null { return st.target }
