/**
 * PrintWindow 窗口级截图 — PowerShell 调用 Win32 API
 *
 * 用 PowerShell Add-Type 编译 C# 代码，调用 PrintWindow 捕获每个窗口，
 * 排除自身后返回各窗口 PNG。
 *
 * 优点：不闪烁、不修改窗口、像素级精确、自身不可见。
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loggerService } from '@logger'
import { type BrowserWindow,ipcMain } from 'electron'

const logger = loggerService.withContext('PWCapture')

interface CapturedWin {
  pngBuffer: Buffer
  left: number
  top: number
  width: number
  height: number
}

interface State {
  win: BrowserWindow | null
  running: boolean
  capturing: boolean
  timer: ReturnType<typeof setTimeout> | null
}
const st: State = { win: null, running: false, capturing: false, timer: null }

function getSelfTitle(): string {
  try {
    return st.win && !st.win.isDestroyed() ? st.win.getTitle() : ''
  } catch {
    return ''
  }
}

// ─── PowerShell 单行脚本：枚举所有可见窗口 + PrintWindow ──
const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
public class PW {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdc, int x, int y, int cx, int cy, IntPtr hdcSrc, int x1, int y1, uint rop);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static string Capture(IntPtr hWnd, int w, int h, string path) {
    IntPtr hdcWin = GetDC(hWnd);
    if (hdcWin == IntPtr.Zero) return "ERR:GetDC";
    IntPtr hdcMem = CreateCompatibleDC(hdcWin);
    if (hdcMem == IntPtr.Zero) { ReleaseDC(hWnd, hdcWin); return "ERR:CreateDC"; }
    IntPtr hBmp = CreateCompatibleBitmap(hdcWin, w, h);
    if (hBmp == IntPtr.Zero) { DeleteDC(hdcMem); ReleaseDC(hWnd, hdcWin); return "ERR:CreateBmp"; }
    SelectObject(hdcMem, hBmp);
    bool ok = PrintWindow(hWnd, hdcMem, 0);
    if (!ok) { DeleteObject(hBmp); DeleteDC(hdcMem); ReleaseDC(hWnd, hdcWin); return "ERR:PrintWindow"; }
    using (Bitmap bmp = new Bitmap(w, h, (System.Drawing.Imaging.PixelFormat)0xE200b)) {
      var bd = bmp.LockBits(new Rectangle(0,0,w,h), ImageLockMode.WriteOnly, (System.Drawing.Imaging.PixelFormat)0xE200b);
      BitBlt(bd.Scan0, 0, 0, w, h, hdcMem, 0, 0, 0xCC0020);
      bmp.UnlockBits(bd);
      bmp.Save(path, ImageFormat.Png);
    }
    DeleteObject(hBmp); DeleteDC(hdcMem); ReleaseDC(hWnd, hdcWin);
    return "OK";
  }
  public static string EnumAll() {
    var list = new System.Text.StringBuilder();
    EnumWindows((hWnd, lp) => {
      if (!IsWindowVisible(hWnd)) return true;
      var sb = new System.Text.StringBuilder(512);
      int len = GetWindowTextW(hWnd, sb, 256);
      if (len <= 0) return true;
      string t = sb.ToString().Trim();
      if (t == "") return true;
      RECT r; GetWindowRect(hWnd, out r);
      int w = r.Right - r.Left; int h = r.Bottom - r.Top;
      if (w < 60 || h < 60) return true;
      list.AppendLine($"{hWnd.ToInt64()}|{t}|{r.Left},{r.Top},{r.Right},{r.Bottom}");
      return true;
    }, IntPtr.Zero);
    return list.ToString();
  }
}
"@
if ($args[0] -eq "enum") { [PW]::EnumAll() }
if ($args[0] -eq "capture") { [PW]::Capture([IntPtr]::new($args[1]), [int]$args[2], [int]$args[3], $args[4]) }
`

/** 枚举所有窗口 */
function enumAllWindows(): {
  hwnd: string
  title: string
  l: number
  t: number
  r: number
  b: number
  w: number
  h: number
}[] {
  try {
    const out = execSync(`powershell -NoProfile -Command "${PS_SCRIPT}" enum`, { timeout: 5000, encoding: 'utf-8' })
    const lines = out.trim().split('\n').filter(Boolean)
    const selfTitle = getSelfTitle()
    return lines
      .map((line) => {
        const parts = line.split('|')
        if (parts.length < 3) return null
        const coords = parts[2].split(',').map(Number)
        if (coords.length < 4) return null
        const w = coords[2] - coords[0]
        const h = coords[3] - coords[1]
        if (w < 60 || h < 60 || w > 4000 || h > 3000) return null
        if (selfTitle && parts[1].includes(selfTitle)) return null
        return { hwnd: parts[0], title: parts[1], l: coords[0], t: coords[1], r: coords[2], b: coords[3], w, h }
      })
      .filter(Boolean) as any[]
  } catch {
    return []
  }
}

/** 捕获单个窗口 */
function captureOne(hwnd: string, w: number, h: number): Buffer | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'pw_'))
    const path = join(dir, 'cap.png')
    execSync(`powershell -NoProfile -Command "${PS_SCRIPT}" capture ${hwnd} ${w} ${h} "${path}"`, { timeout: 8000 })
    const buf = readFileSync(path)
    rmSync(dir, { recursive: true, force: true })
    return buf.length > 200 ? buf : null
  } catch {
    return null
  }
}

async function captureAndPush(): Promise<void> {
  if (!st.win || st.win.isDestroyed() || !st.running || st.capturing) return
  st.capturing = true
  try {
    const wins = enumAllWindows().slice(0, 6)
    const captured: CapturedWin[] = []
    for (const w of wins) {
      const png = captureOne(w.hwnd, w.w, w.h)
      if (png) captured.push({ pngBuffer: png, left: w.l, top: w.t, width: w.w, height: w.h })
    }
    if (st.win && !st.win.isDestroyed() && st.running) {
      st.win.webContents.send('printwindow:frame', {
        windows: captured.map((c) => ({
          pngBuffer: c.pngBuffer,
          left: c.left,
          top: c.top,
          width: c.width,
          height: c.height
        })),
        timestamp: Date.now()
      })
    }
  } catch (err) {
    logger.error('PWCapture failed', err as Error)
  } finally {
    st.capturing = false
  }
}

function schedule(): void {
  if (!st.running) return
  const t = 600 + Math.random() * 200
  st.timer = setTimeout(async () => {
    await captureAndPush()
    schedule()
  }, t)
}
function start(): void {
  if (!st.running) {
    st.running = true
    schedule()
    logger.info('PWCapture started')
  }
}
function stop(): void {
  st.running = false
  st.capturing = false
  if (st.timer) {
    clearTimeout(st.timer)
    st.timer = null
  }
}

function registerIpc(): void {
  const on = (c: string, h: (...a: any[]) => void) => {
    try {
      ipcMain.on(c, h)
    } catch {}
  }
  on('printwindow:start', () => start())
  on('printwindow:stop', () => stop())
}

export function initPrintWindowCapture(win: BrowserWindow): void {
  try {
    st.win = win
    registerIpc()
    win.on('hide', () => stop())
    win.on('show', () => start())
    win.on('minimize', () => stop())
    win.on('restore', () => start())
    win.on('close', () => {
      stop()
      st.win = null
    })
    logger.info('PrintWindow capture initialized')
  } catch (err) {
    logger.error('Failed to init PWCapture', err as Error)
  }
}
