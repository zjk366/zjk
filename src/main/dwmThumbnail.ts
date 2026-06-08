/**
 * DWM Thumbnail 核心模块 — FFI 绑定 + 注册/更新/注销
 *
 * 使用 koffi 调用 dwmapi.dll 中的 DWM 缩略图 API，
 * 将目标窗口内容实时投影到当前 Electron 窗口上。
 *
 * 无需编码、无损、GPU 合成、零 CPU 开销。
 *
 * 安全设计：
 * - 每次操作前验证 IsWindow
 * - 窗口丢失时优雅降级清空投影
 * - 所有 FFI 调用包裹在 try-catch 中
 */
import { loggerService } from '@logger'
import koffi from 'koffi'

const logger = loggerService.withContext('DwmThumb')

// ─── koffi 类型定义 ──────────────────────────────
const HANDLE = koffi.pointer(koffi.types.void, { sizeof: 8 })
const BOOL = koffi.int32
const HRESULT = koffi.int32
const RECT = koffi.struct('RECT', {
  left: 'long', top: 'long', right: 'long', bottom: 'long',
})
const DWM_THUMBNAIL_PROPERTIES = koffi.struct('DWM_THUMBNAIL_PROPERTIES', {
  dwFlags: 'uint32',        // DWM_TNP_* 标志位组合
  opacity: 'unsigned char', // 透明度 0-255
  fVisible: BOOL,           // 是否可见
  fSourceClientAreaOnly: BOOL, // 仅客户区
  rcDestination: RECT,      // 目标区域（像素）
  rcSource: RECT,           // 源区域（像素）
})

// DWM_TNP_* 标志位
const DWM_TNP_OPACITY = 1 << 1
const DWM_TNP_VISIBLE = 1 << 2
const DWM_TNP_RECTDESTINATION = 1 << 4
const DWM_TNP_SOURCECLIENTAREAONLY = 1 << 5

// ─── 加载 dwmapi.dll ─────────────────────────────
const dwmapi = koffi.load('dwmapi.dll')

// DwmRegisterThumbnail(HWND dest, HWND src, out HTHUMBNAIL) → HRESULT
const DwmRegisterThumbnail = dwmapi.func('DwmRegisterThumbnail',
  HRESULT, [HANDLE, HANDLE, koffi.out(koffi.pointer(koffi.types.void, { sizeof: 8 }))])

// DwmUpdateThumbnailProperties(HTHUMBNAIL, DWM_THUMBNAIL_PROPERTIES) → HRESULT
const DwmUpdateThumbnailProperties = dwmapi.func('DwmUpdateThumbnailProperties',
  HRESULT, [HANDLE, koffi.inout(DWM_THUMBNAIL_PROPERTIES)])

// DwmUnregisterThumbnail(HTHUMBNAIL) → HRESULT
const DwmUnregisterThumbnail = dwmapi.func('DwmUnregisterThumbnail',
  HRESULT, [HANDLE])

// user32.dll — IsWindow
const user32 = koffi.load('user32.dll')
const IsWindow = user32.func('IsWindow', BOOL, [HANDLE])

// ─── 导出函数 ────────────────────────────────────

/** 验证窗口句柄是否仍然有效 */
export function isWindowValid(hwnd: Buffer): boolean {
  try {
    return IsWindow(hwnd) !== 0
  } catch {
    return false
  }
}

/**
 * 注册 DWM 缩略图
 *
 * @param destHwnd - 目标窗口（Cherry Studio 主窗口）句柄 Buffer
 * @param srcHwnd  - 源窗口（要预览的窗口）句柄 Buffer
 * @returns 缩略图句柄 Buffer，失败返回 null
 */
export function registerThumbnail(destHwnd: Buffer, srcHwnd: Buffer): Buffer | null {
  try {
    if (!isWindowValid(srcHwnd)) {
      logger.warn('registerThumbnail: source window invalid')
      return null
    }
    const thumbPtr = koffi.alloc(koffi.pointer(koffi.types.void, { sizeof: 8 }))
    const hr = DwmRegisterThumbnail(destHwnd, srcHwnd, thumbPtr)
    if (hr < 0) {
      logger.error(`DwmRegisterThumbnail failed: HRESULT=${hr.toString(16)}`)
      return null
    }
    const thumb = koffi.get(thumbPtr, koffi.pointer(koffi.types.void, { sizeof: 8 }))
    logger.info('DwmThumb: registered')
    return thumb as Buffer
  } catch (err) {
    logger.error('DwmRegisterThumbnail exception', err as Error)
    return null
  }
}

/**
 * 更新 DWM 缩略图属性（位置、大小、透明度）
 *
 * @param thumb     - 缩略图句柄
 * @param destRect  - 目标区域 { left, top, right, bottom }
 * @param opts      - 可选参数（透明度、是否仅客户区）
 * @returns true 成功 / false 失败
 */
export function updateThumbnail(
  thumb: Buffer,
  destRect: { left: number; top: number; right: number; bottom: number },
  opts?: { opacity?: number; clientAreaOnly?: boolean },
): boolean {
  try {
    const props = koffi.new(DWM_THUMBNAIL_PROPERTIES)
    let flags = 0

    props.rcDestination = destRect
    flags |= DWM_TNP_RECTDESTINATION

    props.fSourceClientAreaOnly = opts?.clientAreaOnly !== false ? 1 : 0
    flags |= DWM_TNP_SOURCECLIENTAREAONLY

    if (opts?.opacity !== undefined) {
      props.opacity = Math.max(0, Math.min(255, opts.opacity))
      flags |= DWM_TNP_OPACITY
    }

    props.fVisible = 1
    flags |= DWM_TNP_VISIBLE
    props.dwFlags = flags

    const hr = DwmUpdateThumbnailProperties(thumb, props)
    return hr >= 0
  } catch (err) {
    logger.error('DwmUpdateThumbnailProperties exception', err as Error)
    return false
  }
}

/**
 * 注销 DWM 缩略图
 */
export function unregisterThumbnail(thumb: Buffer | null): void {
  if (!thumb) return
  try {
    DwmUnregisterThumbnail(thumb)
    logger.info('DwmThumb: unregistered')
  } catch (err) {
    logger.error('DwmUnregisterThumbnail exception', err as Error)
  }
}

/**
 * 设置缩略图可见性
 */
export function setThumbnailVisible(thumb: Buffer, visible: boolean): boolean {
  try {
    const props = koffi.new(DWM_THUMBNAIL_PROPERTIES)
    props.fVisible = visible ? 1 : 0
    props.dwFlags = DWM_TNP_VISIBLE
    return DwmUpdateThumbnailProperties(thumb, props) >= 0
  } catch {
    return false
  }
}
