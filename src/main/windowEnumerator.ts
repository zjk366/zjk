/**
 * windowEnumerator — koffi 窗口枚举
 *
 * 通过 EnumWindows + GetWindowTextW + GetWindowThreadProcessId
 * 枚举所有可见顶层窗口，过滤掉自身进程和不可见窗口。
 */

import { loggerService } from '@logger'

const logger = loggerService.withContext('WinEnum')

export interface WindowInfo {
  hwnd: string    // 窗口句柄（十进制字符串，用于 IPC 传参）
  title: string   // 窗口标题
  pid: number     // 进程 ID
  width: number   // 窗口宽度
  height: number  // 窗口高度
  isMinimized: boolean
}

export interface EnumerateOptions {
  excludePid?: number
  minWidth?: number
  minHeight?: number
}

export function enumerateWindows(options: EnumerateOptions = {}): WindowInfo[] {
  const { excludePid = 0, minWidth = 100, minHeight = 50 } = options
  const results: WindowInfo[] = []

  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')

    const RECT = koffi.struct('R3', {
      left: 'int32',
      top: 'int32',
      right: 'int32',
      bottom: 'int32',
    })

    // ── API 函数绑定（全部使用字符串类型名，避免 koffi 3.x 对象类型冲突） ──
    // koffi 3.x 中 koffi.types.func() 不存在，改用 koffi.func()
    const EnumWindowsProcType = koffi.func('EnumWindowsProc', 'int32', ['void*', 'void*'])
    const EnumWindows = user32.func('EnumWindows', 'int32', [
      koffi.pointer(EnumWindowsProcType),
      'void*',
    ])
    const IsWindowVisible = user32.func('IsWindowVisible', 'int32', ['void*'])
    const GetWindowTextW = user32.func('GetWindowTextW', 'int32', [
      'void*', koffi.out(koffi.array('uint16', 512)), 'int32',
    ])
    const GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32', [
      'void*', koffi.out('uint32'),
    ])
    const GetWindowRect = user32.func('GetWindowRect', 'int32', ['void*', koffi.out(RECT)])
    const IsIconic = user32.func('IsIconic', 'int32', ['void*'])
    const GetDesktopWindow = user32.func('GetDesktopWindow', 'void*', [])

    // ── 回调收集 ──────────────────────────────
    const desktopHwnd = GetDesktopWindow()

    const callback = koffi.register(
      (hwnd: any, _lParam: any): number => {
        try {
          // 跳过桌面窗口
          if (hwnd === desktopHwnd) return 1

          // 仅可见窗口
          if (!IsWindowVisible(hwnd)) return 1

          // 窗口标题
          const titleBuf = new Uint16Array(512)
          const titleLen = GetWindowTextW(hwnd, titleBuf, 512)
          if (titleLen <= 0) return 1 // 无标题窗口跳过

          const title = Buffer.from(titleBuf.slice(0, titleLen)).toString('ucs2')

          // PID
          const pidPtr = koffi.alloc('uint32')
          GetWindowThreadProcessId(hwnd, pidPtr)
          const pid = koffi.get(pidPtr, 'uint32')

          // 排除自身进程
          if (excludePid > 0 && pid === excludePid) return 1

          // 窗口尺寸
          const r = koffi.new(RECT)
          if (!GetWindowRect(hwnd, r)) return 1
          const w = r.right - r.left
          const h = r.bottom - r.top
          if (w < minWidth || h < minHeight) return 1

          const minimized = IsIconic(hwnd) !== 0

          // koffi.address() 返回 BigInt 形式的句柄值
          const hwndVal = koffi.address(hwnd)
          const hwndStr = String(hwndVal)

          results.push({
            hwnd: hwndStr,
            title,
            pid,
            width: w,
            height: h,
            isMinimized: minimized,
          })
        } catch {
          // 忽略单个窗口错误
        }
        return 1
      },
      EnumWindowsProcType,
    )

    EnumWindows(callback, koffi.null)

    // 解绑回调
    try { koffi.unregister(callback) } catch {}

    return results
  } catch (err) {
    logger.error('enumerateWindows failed', err as Error)
    return []
  }
}
