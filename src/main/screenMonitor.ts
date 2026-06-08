/**
 * 桌面实时截屏模块 — GDI BitBlt + ExcludeClipRect 排除自身窗口
 *
 * 流程：
 *   GetDC(desktop) → 创建内存 DC → ExcludeClipRect(排除自身)
 *   → BitBlt 全屏 → GetDIBits → 编码 JPEG → 通过 IPC 推送
 *
 * 自身窗口区域被 ExcludeClipRect 裁剪掉，不会陷入镜像递归。
 * GDI 资源在 finally 块中保证释放。
 */
// @ts-nocheck
import { ipcMain, type BrowserWindow, nativeImage } from 'electron'
import { loggerService } from '@logger'
import koffi from 'koffi'

const logger = loggerService.withContext('ScreenMonitor')

// ─── FFI 绑定 ────────────────────────────────────
const user32 = koffi.load('user32.dll')
const gdi32 = koffi.load('gdi32.dll')
const HWND = koffi.pointer(koffi.types.void, { sizeof: 8 })
const HDC = koffi.pointer(koffi.types.void, { sizeof: 8 })
const HBITMAP = koffi.pointer(koffi.types.void, { sizeof: 8 })
const HANDLE = HWND
const BOOL = koffi.types.bool
const LONG = koffi.types.int32
const DWORD = koffi.types.uint32
const UINT = koffi.types.uint32
const RECT = koffi.struct('R2', { left: LONG, top: LONG, right: LONG, bottom: LONG })
const BITMAPINFOHEADER = koffi.struct('BIH', {
  biSize: DWORD, biWidth: LONG, biHeight: LONG,
  biPlanes: koffi.types.ushort, biBitCount: koffi.types.ushort,
  biCompression: DWORD, biSizeImage: DWORD,
  biXPelsPerMeter: LONG, biYPelsPerMeter: LONG,
  biClrUsed: DWORD, biClrImportant: DWORD,
})
const BITMAPINFO = koffi.struct('BINF', {
  bmiHeader: BITMAPINFOHEADER, bmiColors: koffi.array(koffi.types.uint8, 4),
})

const GetDesktopWindow = user32.func('GetDesktopWindow', HWND, [])
const GetWindowDC = user32.func('GetWindowDC', HDC, [HWND])
const ReleaseDC = user32.func('ReleaseDC', koffi.types.int32, [HWND, HDC])
const GetWindowRect = user32.func('GetWindowRect', BOOL, [HWND, koffi.out(RECT)])
const GetDC = user32.func('GetDC', HDC, [HWND])
const CreateCompatibleDC = gdi32.func('CreateCompatibleDC', HDC, [HDC])
const DeleteDC = gdi32.func('DeleteDC', BOOL, [HDC])
const CreateCompatibleBitmap = gdi32.func('CreateCompatibleBitmap', HBITMAP,
  [HDC, koffi.types.int32, koffi.types.int32])
const SelectObject = gdi32.func('SelectObject', HANDLE, [HDC, HANDLE])
const DeleteObject = gdi32.func('DeleteObject', BOOL, [HANDLE])
const BitBlt = gdi32.func('BitBlt', BOOL,
  [HDC, koffi.types.int32, koffi.types.int32, koffi.types.int32,
    koffi.types.int32, HDC, koffi.types.int32, koffi.types.int32, DWORD])
const ExcludeClipRect = gdi32.func('ExcludeClipRect', koffi.types.int32,
  [HDC, koffi.types.int32, koffi.types.int32, koffi.types.int32, koffi.types.int32])
const SelectClipRgn = gdi32.func('SelectClipRgn', koffi.types.int32, [HDC, HANDLE])
const GetDIBits = gdi32.func('GetDIBits', koffi.types.int32,
  [HDC, HBITMAP, UINT, UINT, koffi.out(koffi.array(koffi.types.uint8, 0)),
    koffi.out(BITMAPINFO), UINT])

const SRCCOPY = 0x00CC0020
const BI_RGB = 0
const DIB_RGB_COLORS = 0
const NULL_HRGN = 0 // SelectClipRgn(NULL) 恢复裁剪区

// ─── 状态 ────────────────────────────────────────
const st = { win: null, running: false, fps: 2, hasListener: false, capturing: false, timer: null }

/**
 * GDI 全屏截图 + ExcludeClipRect 排除自身窗口
 *
 * 返回 JPEG base64 dataUrl，与原有 screen-monitor:frame 格式兼容。
 */
async function captureAndPush(): Promise<void> {
  if (!st.win || st.win.isDestroyed() || !st.running || !st.hasListener || st.capturing) return
  st.capturing = true

  let hdcScreen = null, hdcMem = null, hBmp = null, oldSel = null

  try {
    const desktopHwnd = GetDesktopWindow()
    if (!desktopHwnd) { st.capturing = false; return }

    // 获取屏幕尺寸：取桌面窗口客户区
    const scrRect = koffi.new(RECT)
    GetWindowRect(desktopHwnd, scrRect)
    const sw = scrRect.right - scrRect.left
    const sh = scrRect.bottom - scrRect.top
    if (sw < 100 || sh < 100) { st.capturing = false; return }

    // 分配 GDI 资源
    hdcScreen = GetDC(desktopHwnd)
    if (!hdcScreen) { st.capturing = false; return }

    hdcMem = CreateCompatibleDC(hdcScreen)
    if (!hdcMem) { st.capturing = false; return }

    hBmp = CreateCompatibleBitmap(hdcScreen, sw, sh)
    if (!hBmp) { st.capturing = false; return }

    oldSel = SelectObject(hdcMem, hBmp)

    // ── 排除自身窗口区域 ──────────────────────────
    // 获取监控室窗口坐标（物理像素）
    if (st.win && !st.win.isDestroyed()) {
      const selfRect = koffi.new(RECT)
      if (GetWindowRect(st.win.getNativeWindowHandle(), selfRect)) {
        // 裁剪掉自身窗口区域 —— 镜像递归消失！
        ExcludeClipRect(hdcMem,
          selfRect.left, selfRect.top,
          selfRect.right, selfRect.bottom)
      }
    }
    // ─────────────────────────────────────────────

    // BitBlt 全屏（自身窗口区域已被裁剪，不会出现在结果中）
    const ok = BitBlt(hdcMem, 0, 0, sw, sh, hdcScreen, 0, 0, SRCCOPY)
    if (!ok) { st.capturing = false; return }

    // 恢复裁剪区（重要！避免影响后续操作）
    SelectClipRgn(hdcMem, NULL_HRGN)

    // GetDIBits 读取像素
    const bmi = koffi.new(BITMAPINFO)
    bmi.bmiHeader.biSize = koffi.sizeof(BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth = sw
    bmi.bmiHeader.biHeight = -sh // top-down
    bmi.bmiHeader.biPlanes = 1
    bmi.bmiHeader.biBitCount = 32
    bmi.bmiHeader.biCompression = BI_RGB
    bmi.bmiHeader.biSizeImage = sw * sh * 4
    if (!GetDIBits(hdcMem, hBmp, 0, sh, null, bmi, DIB_RGB_COLORS)) { st.capturing = false; return }

    const pixelSize = sw * sh * 4
    const pixels = Buffer.alloc(pixelSize)
    bmi.bmiHeader.biHeight = -sh
    bmi.bmiHeader.biSizeImage = pixelSize
    if (!GetDIBits(hdcMem, hBmp, 0, sh, pixels, bmi, DIB_RGB_COLORS)) { st.capturing = false; return }

    // BGRA → RGBA
    for (let i = 0; i < pixelSize; i += 4) {
      const r = pixels[i + 2]; const b = pixels[i]
      pixels[i] = r; pixels[i + 2] = b
    }

    // 编码为 JPEG base64（兼容现有 screen-monitor:frame 格式）
    const img = nativeImage.createFromBitmap(pixels, { width: sw, height: sh })
    const dataUrl = img.toDataURL()

    if (st.win && !st.win.isDestroyed() && st.running) {
      st.win.webContents.send('screen-monitor:frame', { dataUrl, timestamp: Date.now() })
    }
  } catch (err) {
    logger.error('Screen capture failed', err)
  } finally {
    // ── 释放 GDI 资源 ─────────────────────────
    try { if (oldSel) SelectObject(hdcMem, oldSel) } catch {}
    try { if (hBmp) DeleteObject(hBmp) } catch {}
    try { if (hdcMem) DeleteDC(hdcMem) } catch {}
    try { if (hdcScreen) ReleaseDC(GetDesktopWindow(), hdcScreen) } catch {}
    st.capturing = false
  }
}

function scheduleNext(): void {
  if (!st.running) return
  const interval = Math.max(200, Math.round(1000 / st.fps))
  st.timer = setTimeout(async () => { await captureAndPush(); scheduleNext() }, interval)
}

function startCapture(): void {
  if (st.running) return; st.running = true
  logger.info('Screen capture started (GDI BitBlt + ExcludeClipRect)')
  scheduleNext()
}

function stopCapture(): void {
  st.running = false; st.capturing = false
  if (st.timer) { clearTimeout(st.timer); st.timer = null }
}

function registerIpc(): void {
  const safeOn = (c: string, h: (...a: any[]) => void) => { try { ipcMain.on(c, h) } catch {} }
  safeOn('screen-monitor:start', () => { st.hasListener = true; startCapture() })
  safeOn('screen-monitor:stop', () => { st.hasListener = false; stopCapture() })
  safeOn('screen-monitor:set-fps', (_e: any, fps: number) => {
    st.fps = Math.max(1, Math.min(10, Math.round(fps)))
    if (st.running) { stopCapture(); startCapture() }
  })
}

export function initScreenMonitor(win: BrowserWindow): void {
  try {
    st.win = win; registerIpc()
    win.on('hide', () => stopCapture())
    win.on('show', () => { if (st.hasListener) startCapture() })
    win.on('minimize', () => stopCapture())
    win.on('restore', () => { if (st.hasListener) startCapture() })
    win.on('close', () => { stopCapture(); st.win = null })
    logger.info('ScreenMonitor initialized (self-excluding)')
  } catch (err) { logger.error('Failed to init ScreenMonitor', err) }
}
