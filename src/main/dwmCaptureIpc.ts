/**
 * dwmCaptureIpc — DWM 捕获 IPC 桥接
 *
 * IPC 通道：
 *   dwm:start(hwndStr) — 开始对指定窗口推流
 *   dwm:stop           — 停止推流
 *   dwm:frame          — (推送) 原始 RGBA Buffer
 *
 * 性能优化：
 * - 原生 RGBA Buffer 直传 (putImageData)
 * - 捕获间隔自适应 (capturing 锁)
 * - 窗口丢失自动降级
 */
// @ts-nocheck
import { ipcMain, type BrowserWindow } from 'electron'
import { loggerService } from '@logger'
import { captureWindowDwm, cleanupDwmCapture } from './dwmCapture'

const logger = loggerService.withContext('DwmCaptureIpc')

let captureTimer = null
let running = false
let capturing = false
let currentHwnd = null
let currentWin = null

/** 推流循环 */
async function captureLoop() {
  if (!running || !currentHwnd || !currentWin || currentWin.isDestroyed()) {
    stopCapture()
    return
  }
  if (capturing) {
    // 上一帧尚未完成，跳过本帧（自动丢帧）
    scheduleNext()
    return
  }
  capturing = true
  try {
    const result = await captureWindowDwm(currentHwnd, 0)
    if (!result) {
      // 捕获失败，可能是窗口已关闭
      if (currentWin && !currentWin.isDestroyed()) {
        currentWin.webContents.send('dwm:frame', {
          type: 'lost',
          message: '目标窗口已丢失',
          timestamp: Date.now(),
        })
      }
      stopCapture()
      return
    }
    if (currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('dwm:frame', {
        type: 'frame',
        rawBuffer: result.rawBuffer,
        width: result.width,
        height: result.height,
        timestamp: result.timestamp,
      })
    }
  } catch (err) {
    logger.error('DWM capture loop error', err)
    if (currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('dwm:frame', { type: 'error', message: String(err) })
    }
    stopCapture()
  } finally {
    capturing = false
    scheduleNext()
  }
}

function scheduleNext() {
  if (!running) return
  captureTimer = setTimeout(captureLoop, 200) // 5 FPS max，capturing 锁自动降到实际可用帧率
}

function startCapture(win, hwndStr) {
  if (running) stopCapture()
  // 解析 hwnd 字符串 → Buffer
  const hwndVal = BigInt(hwndStr)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(hwndVal, 0)
  currentHwnd = buf
  currentWin = win
  running = true
  logger.info('DWM capture started for hwnd=' + hwndStr)
  captureLoop()
}

function stopCapture() {
  running = false
  capturing = false
  currentHwnd = null
  if (captureTimer) { clearTimeout(captureTimer); captureTimer = null }
  cleanupDwmCapture()
}

export function initDwmCaptureIpc(win: BrowserWindow) {
  try {
    ipcMain.on('dwm:start', (_event, hwndStr: string) => {
      if (!hwndStr) { logger.warn('dwm:start missing hwnd'); return }
      startCapture(win, hwndStr)
    })
    ipcMain.on('dwm:stop', () => stopCapture())
    logger.info('DwmCaptureIpc initialized')
  } catch (err) {
    logger.error('DwmCaptureIpc init failed', err)
  }
}
