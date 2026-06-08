/**
 * screenCaptureEngine — 双引擎截图
 *
 * 主引擎：DWM Thumbnail + BitBlt（排除自身窗口，低延迟）
 * 降级引擎：desktopCapturer 全屏截图（稳定兜底）
 *
 * 每次 captureFrame 先尝试 DWM，校验像素后若有效则返回，
 * 否则自动降级到 desktopCapturer。
 */
// @ts-nocheck
import { desktopCapturer, nativeImage } from 'electron'
import { loggerService } from '@logger'
import { captureWindowDwm } from './dwmCapture'

const logger = loggerService.withContext('CaptureEngine')

let lastFrame = { dataUrl: '', source: '', ts: 0 }

export interface CaptureResult {
  dataUrl: string
  source: 'dwm' | 'screen' | 'stale' | 'lost'
  width?: number
  height?: number
  timestamp: number
}

/**
 * 校验 RGBA Buffer 是否有效（非全黑/全透明）
 */
function isValidBuffer(buf: Buffer, w: number, h: number): boolean {
  if (!buf || buf.length < 100) return false
  // 采样 100 个像素，有非零即有效
  const step = Math.max(1, Math.floor((w * h) / 100))
  for (let i = 0; i < buf.length; i += step * 4) {
    if (buf[i] > 8 || buf[i + 1] > 8 || buf[i + 2] > 8) return true
  }
  return false
}

/**
 * 单帧捕获 — 先 DWM 再降级
 *
 * @param dwmHwnd - DWM 目标窗口句柄 Buffer（null/undefined=直接用截屏）
 * @returns CaptureResult
 */
export async function captureFrame(dwmHwnd?: Buffer | null): Promise<CaptureResult> {
  const ts = Date.now()

  // ── DWM 模式 ────────────────────────────────
  if (dwmHwnd) {
    try {
      const result = await captureWindowDwm(dwmHwnd)
      if (result && result.rawBuffer && result.width > 50 && result.height > 50) {
        if (isValidBuffer(result.rawBuffer, result.width, result.height)) {
          // rawBuffer 为 BGRA 格式，nativeImage.createFromBitmap 需要 BGRA
          const img = nativeImage.createFromBitmap(result.rawBuffer, {
            width: result.width,
            height: result.height,
          })
          const dataUrl = img.toDataURL()
          lastFrame = { dataUrl, source: 'dwm', ts }
          return { dataUrl, source: 'dwm', width: result.width, height: result.height, timestamp: ts }
        }
        logger.warn('DWM frame invalid (blank), falling back to screen')
      }
    } catch (err) {
      logger.warn('DWM capture failed, falling back to screen', err?.message)
    }
  }

  // ── 降级：desktopCapturer ─────────────────────
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false,
    })
    if (sources.length > 0) {
      const dataUrl = sources[0].thumbnail.toDataURL()
      lastFrame = { dataUrl, source: 'screen', ts }
      return { dataUrl, source: 'screen', timestamp: ts }
    }
  } catch (err) {
    logger.error('desktopCapturer also failed', err)
  }

  // ── 全部失败：返回上一有效帧 ──────────────────
  if (lastFrame.dataUrl) {
    return { dataUrl: lastFrame.dataUrl, source: 'stale', timestamp: ts }
  }

  return { dataUrl: '', source: 'lost', timestamp: ts }
}

/**
 * 获取目标窗口是否已最小化（用于外部判断）
 */
export function isIconic(hwnd: Buffer): boolean {
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const fn = user32.func('IsIconic', 'int32', ['pointer'])
    return fn(hwnd) !== 0
  } catch { return false }
}
