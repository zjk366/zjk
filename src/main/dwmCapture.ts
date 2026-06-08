/**
 * DWM Capture — 隐藏窗口中转 + BitBlt 像素读取
 *
 * 源窗口 → DWM 缩略图 → 隐藏窗口 → BitBlt → 内存 DC → GetDIBits → RGBA
 *
 * GDI 资源在 finally 块中确保释放，防止句柄泄漏。
 */
// @ts-nocheck
import { loggerService } from '@logger'
import koffi from 'koffi'

const logger = loggerService.withContext('DwmCapture')

// ─── 加载 DLL ────────────────────────────────────
const dwmapi = koffi.load('dwmapi.dll')
const user32 = koffi.load('user32.dll')
const gdi32 = koffi.load('gdi32.dll')

// ─── 类型别名（koffi 类型）────────────────────────
const HWND = koffi.pointer(koffi.types.void, { sizeof: 8 })
const HDC = koffi.pointer(koffi.types.void, { sizeof: 8 })
const HBITMAP = koffi.pointer(koffi.types.void, { sizeof: 8 })
const HANDLE = koffi.pointer(koffi.types.void, { sizeof: 8 })
const BOOL = koffi.types.bool
const UINT = koffi.types.uint32
const LONG = koffi.types.int32
const DWORD = koffi.types.uint32
const LPCWSTR = koffi.pointer(koffi.types.void, { sizeof: 8 })

// ─── 结构体 ───────────────────────────────────────
const RECT = koffi.struct('R2', { left: LONG, top: LONG, right: LONG, bottom: LONG })
const POINT = koffi.struct('P2', { x: LONG, y: LONG })
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
const DWM_TP = koffi.struct('DWMTP', {
  dwFlags: DWORD, opacity: koffi.types.uchar, fVisible: BOOL,
  fSourceClientAreaOnly: BOOL, rcDestination: RECT, rcSource: RECT,
})
const MSG = koffi.struct('MSG2', {
  hwnd: HWND, message: UINT, wParam: koffi.pointer(koffi.types.void),
  lParam: koffi.pointer(koffi.types.void), time: DWORD, pt: POINT,
})

// ─── DWM API ────────────────────────────────────
const DwmRegisterThumbnail = dwmapi.func('DwmRegisterThumbnail', koffi.types.int32,
  [HWND, HWND, koffi.out(HANDLE)])
const DwmUpdateThumbnailProperties = dwmapi.func('DwmUpdateThumbnailProperties', koffi.types.int32,
  [HANDLE, koffi.inout(DWM_TP)])
const DwmUnregisterThumbnail = dwmapi.func('DwmUnregisterThumbnail', koffi.types.int32, [HANDLE])

// ─── user32 API ─────────────────────────────────
const CreateWindowExW = user32.func('CreateWindowExW', HWND,
  [DWORD, LPCWSTR, LPCWSTR, DWORD, koffi.types.int32, koffi.types.int32,
    koffi.types.int32, koffi.types.int32, HWND, HANDLE, HANDLE, koffi.pointer(koffi.types.void)])
const DestroyWindow = user32.func('DestroyWindow', BOOL, [HWND])
const ShowWindow = user32.func('ShowWindow', BOOL, [HWND, koffi.types.int32])
const IsWindow = user32.func('IsWindow', BOOL, [HWND])
const GetWindowDC = user32.func('GetWindowDC', HDC, [HWND])
const ReleaseDC = user32.func('ReleaseDC', koffi.types.int32, [HWND, HDC])
const GetWindowRect = user32.func('GetWindowRect', BOOL, [HWND, koffi.out(RECT)])
const GetSystemMetrics = user32.func('GetSystemMetrics', koffi.types.int32, [koffi.types.int32])
const UpdateWindow = user32.func('UpdateWindow', BOOL, [HWND])
const PeekMessageW = user32.func('PeekMessageW', BOOL,
  [koffi.out(MSG), HWND, UINT, UINT, UINT])
const SetWindowPos = user32.func('SetWindowPos', BOOL,
  [HWND, HWND, koffi.types.int32, koffi.types.int32,
    koffi.types.int32, koffi.types.int32, UINT])
const GetClientRect = user32.func('GetClientRect', BOOL, [HWND, koffi.out(RECT)])
const GetDesktopWindow = user32.func('GetDesktopWindow', HWND, [])

// ─── GDI API ────────────────────────────────────
const CreateCompatibleDC = gdi32.func('CreateCompatibleDC', HDC, [HDC])
const DeleteDC = gdi32.func('DeleteDC', BOOL, [HDC])
const CreateCompatibleBitmap = gdi32.func('CreateCompatibleBitmap', HBITMAP,
  [HDC, koffi.types.int32, koffi.types.int32])
const SelectObject = gdi32.func('SelectObject', HANDLE, [HDC, HANDLE])
const DeleteObject = gdi32.func('DeleteObject', BOOL, [HANDLE])
const BitBlt = gdi32.func('BitBlt', BOOL,
  [HDC, koffi.types.int32, koffi.types.int32, koffi.types.int32,
    koffi.types.int32, HDC, koffi.types.int32, koffi.types.int32, DWORD])
const GetDIBits = gdi32.func('GetDIBits', koffi.types.int32,
  [HDC, HBITMAP, UINT, UINT, koffi.out(koffi.array(koffi.types.uint8, 0)),
    koffi.out(BITMAPINFO), UINT])
const GdiFlush = gdi32.func('GdiFlush', BOOL, [])

// ─── 常量 ────────────────────────────────────────
const SW_SHOW = 5, SW_HIDE = 0
const WS_EX_TOOLWINDOW = 0x00000080, WS_EX_NOACTIVATE = 0x08000000, WS_EX_LAYERED = 0x00080000
const WS_POPUP = 0x80000000, WS_CLIPCHILDREN = 0x02000000
const DIB_RGB_COLORS = 0, BI_RGB = 0, SRCCOPY = 0x00CC0020
const SM_CXVIRTUALSCREEN = 78
const PM_REMOVE = 1
const SWP_NOACTIVATE = 0x0010, SWP_NOMOVE = 0x0002, SWP_HIDEWINDOW = 0x0080, HWND_BOTTOM = 1
const DWM_TNP_VISIBLE = 1 << 2
const DWM_TNP_RECTDESTINATION = 1 << 4
const DWM_TNP_SOURCECLIENTAREAONLY = 1 << 5

// ─── 状态 ────────────────────────────────────────
let hiddenWnd = null
let thumb = null
let lastW = 0, lastH = 0
let frameCount = 0

function pumpMessages(hWnd) {
  try { const msg = koffi.new(MSG); while (PeekMessageW(msg, hWnd, 0, 0, PM_REMOVE)) {} }
  catch { /* ok */ }
}

function getOrCreateHiddenWindow(): any {
  if (hiddenWnd && IsWindow(hiddenWnd)) return hiddenWnd
  try {
    const screenX = GetSystemMetrics(SM_CXVIRTUALSCREEN)
    const hWnd = CreateWindowExW(
      WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED,
      'Static', '',
      WS_POPUP | WS_CLIPCHILDREN,
      screenX + 200, -2000, 1, 1,
      0, 0, 0, 0
    )
    if (!hWnd || !IsWindow(hWnd)) { logger.error('CreateWindowExW failed'); return null }
    ShowWindow(hWnd, SW_SHOW)
    UpdateWindow(hWnd)
    pumpMessages(hWnd)
    hiddenWnd = hWnd
    return hWnd
  } catch (e) { logger.error('createWindow error', e); return null }
}

function cleanup() {
  try { if (thumb) { DwmUnregisterThumbnail(thumb); thumb = null } } catch { /* ok */ }
  try { if (hiddenWnd && IsWindow(hiddenWnd)) { ShowWindow(hiddenWnd, SW_HIDE); DestroyWindow(hiddenWnd) } } catch { /* ok */ }
  hiddenWnd = null; lastW = 0; lastH = 0
}

/**
 * DWM 缩略图 + BitBlt 捕获窗口像素。
 *
 * @param srcHwnd - 源窗口句柄 Buffer
 * @param maxWidth - 最大输出宽度
 * @returns { rawBuffer: Buffer, width, height, timestamp } | null
 */
export async function captureWindowDwm(srcHwnd: Buffer, maxWidth = 0): Promise<Record<string, any> | null> {
  if (!srcHwnd || !IsWindow(srcHwnd)) { logger.warn('Source window invalid'); return null }

  const srcRect = koffi.new(RECT)
  if (!GetWindowRect(srcHwnd, srcRect)) return null
  const sw = srcRect.right - srcRect.left
  const sh = srcRect.bottom - srcRect.top
  if (sw < 10 || sh < 10) return null

  frameCount++

  // GDI 资源 —— finally 中释放
  let hdcWin = null, hdcMem = null, hBmp = null, oldSel = null

  try {
    const hWnd = getOrCreateHiddenWindow()
    if (!hWnd) return null

    // 调整隐藏窗口大小
    SetWindowPos(hWnd, HWND_BOTTOM, 0, 0, sw, sh, SWP_NOACTIVATE | SWP_NOMOVE | SWP_HIDEWINDOW)
    ShowWindow(hWnd, SW_SHOW)
    UpdateWindow(hWnd)
    pumpMessages(hWnd)

    // DWM 缩略图
    if (thumb && (lastW !== sw || lastH !== sh)) {
      DwmUnregisterThumbnail(thumb); thumb = null
    }
    if (!thumb) {
      const ptr = koffi.alloc(HANDLE)
      if (DwmRegisterThumbnail(hWnd, srcHwnd, ptr) < 0) return null
      thumb = koffi.get(ptr, HANDLE)
      lastW = sw; lastH = sh
    }
    const tp = koffi.new(DWM_TP)
    tp.dwFlags = DWM_TNP_VISIBLE | DWM_TNP_RECTDESTINATION | DWM_TNP_SOURCECLIENTAREAONLY
    tp.fVisible = 1; tp.fSourceClientAreaOnly = 1
    tp.rcDestination = { left: 0, top: 0, right: sw, bottom: sh }
    DwmUpdateThumbnailProperties(thumb, tp)
    pumpMessages(hWnd); GdiFlush()

    // BitBlt 读取
    hdcWin = GetWindowDC(hWnd)
    if (!hdcWin) return null
    hdcMem = CreateCompatibleDC(hdcWin)
    if (!hdcMem) return null
    hBmp = CreateCompatibleBitmap(hdcWin, sw, sh)
    if (!hBmp) return null
    oldSel = SelectObject(hdcMem, hBmp)
    if (!BitBlt(hdcMem, 0, 0, sw, sh, hdcWin, 0, 0, SRCCOPY)) return null

    // GetDIBits
    const bmi = koffi.new(BITMAPINFO)
    bmi.bmiHeader.biSize = koffi.sizeof(BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth = sw
    bmi.bmiHeader.biHeight = -sw  // top-down
    bmi.bmiHeader.biPlanes = 1
    bmi.bmiHeader.biBitCount = 32
    bmi.bmiHeader.biCompression = BI_RGB
    bmi.bmiHeader.biSizeImage = sw * sh * 4

    if (!GetDIBits(hdcMem, hBmp, 0, sh, null, bmi, DIB_RGB_COLORS)) return null

    const pixelSize = sw * sh * 4
    const pixels = Buffer.alloc(pixelSize)
    bmi.bmiHeader.biHeight = -sw
    bmi.bmiHeader.biSizeImage = pixelSize
    if (!GetDIBits(hdcMem, hBmp, 0, sh, pixels, bmi, DIB_RGB_COLORS)) return null

    // BGRA → RGBA
    for (let i = 0; i < pixelSize; i += 4) {
      const r = pixels[i + 2]; const b = pixels[i]
      pixels[i] = r; pixels[i + 2] = b
    }

    // 返回 RAW RGBA Buffer（前端 Canvas putImageData 直接渲染，零编解码开销）
    // 如需缩放，由前端 Canvas 统一处理
    return {
      rawBuffer: pixels,
      width: sw,
      height: sh,
      timestamp: Date.now(),
    }
  } catch (e) {
    logger.error('captureDwm error', e)
    return null
  } finally {
    // ── 释放 GDI 资源 ─────────────────────────
    try { if (oldSel) SelectObject(hdcMem, oldSel) } catch {}
    try { if (hBmp) DeleteObject(hBmp) } catch {}
    try { if (hdcMem) DeleteDC(hdcMem) } catch {}
    try { if (hdcWin && hiddenWnd) ReleaseDC(hiddenWnd, hdcWin) } catch {}
  }
}

export function cleanupDwmCapture() { cleanup() }
export function getDwmStatus() {
  return { hiddenWindow: !!hiddenWnd && !!IsWindow(hiddenWnd), thumbActive: !!thumb, frames: frameCount }
}
