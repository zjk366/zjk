/**
 * PrintWindow 窗口级截图 — 单次 PowerShell 批量捕获
 *
 * 一次 PowerShell 调用完成：枚举 + 排除自身 + PrintWindow + 保存到临时文件。
 * 消除多次 PowerShell 冷启动开销。
 *
 * 优点：不闪烁、不修改窗口、像素级精确、自身不可见。
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain, type BrowserWindow } from 'electron'
import { loggerService } from '@logger'

const logger = loggerService.withContext('PWCapture')

interface State {
  win: BrowserWindow | null; running: boolean; capturing: boolean
  timer: ReturnType<typeof setTimeout> | null; imgDir: string
}
const st: State = { win: null, running: false, capturing: false, timer: null, imgDir: '' }

function getSelfTitle(): string {
  try { return st.win && !st.win.isDestroyed() ? st.win.getTitle() : '' } catch { return '' }
}

/** 一次性 PowerShell 脚本：枚举 → 排除自身 → 捕获 → 写文件 */
function buildScript(selfTitle: string, outDir: string): string {
  const escapedTitle = selfTitle.replace(/["\\]/g, '\\$&')
  // 使用 try-catch 包裹 Add-Type 和类型检测
  return `
$outDir = "${outDir.replace(/\\/g, '\\\\')}"
try { $null = [W.PW]::Test() } catch { Add-Type @"
using System; using System.Runtime.InteropServices; using System.Drawing; using System.Drawing.Imaging;
public class PW {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lp, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder t, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, int n);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr o);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ReleaseDC(IntPtr h, IntPtr d);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr d, int x,int y,int cx,int cy,IntPtr s,int x1,int y1,uint r);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  public struct RECT { public int l; public int t; public int r; public int b; }
  public static bool Test() { return true; }
  public static string CaptureAll(string selfTitle, string outDir) {
    var sb = new System.Text.StringBuilder();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var t = new System.Text.StringBuilder(512);
      int len = GetWindowTextW(h, t, 256);
      if (len <= 0) return true;
      string title = t.ToString().Trim();
      if (string.IsNullOrEmpty(title)) return true;
      if (!string.IsNullOrEmpty(selfTitle) && title.IndexOf(selfTitle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
      RECT r; GetWindowRect(h, out r);
      int w = r.r - r.l; int hh = r.b - r.t;
      if (w < 60 || hh < 60 || w > 4000 || hh > 3000) return true;
      string id = h.ToInt64().ToString();
      string path = System.IO.Path.Combine(outDir, id + ".png");
      bool ok = PrintOne(h, w, hh, path);
      sb.AppendLine(ok ? $"OK|{id}|{r.l},{r.t},{r.r},{r.b}|{path}" : $"FAIL|{id}");
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  static bool PrintOne(IntPtr h, int w, int hh, string path) {
    IntPtr dc = GetDC(h); if (dc == IntPtr.Zero) return false;
    IntPtr mem = CreateCompatibleDC(dc); if (mem == IntPtr.Zero) { ReleaseDC(h, dc); return false; }
    IntPtr bmp = CreateCompatibleBitmap(dc, w, hh); if (bmp == IntPtr.Zero) { DeleteDC(mem); ReleaseDC(h, dc); return false; }
    SelectObject(mem, bmp);
    bool ok = PrintWindow(h, mem, 0);
    if (!ok) { DeleteObject(bmp); DeleteDC(mem); ReleaseDC(h, dc); return false; }
    // Copy GDI bitmap to managed bitmap via BitBlt from memory DC
    using (Bitmap b = new Bitmap(w, hh)) {
      using (Graphics g = Graphics.FromImage(b)) { g.FillRectangle(Brushes.Black, 0, 0, w, hh); }
      var bd = b.LockBits(new Rectangle(0,0,w,hh), ImageLockMode.WriteOnly, System.Drawing.Imaging.PixelFormat.Format32bppRgb);
      BitBlt(bd.Scan0, 0, 0, w, hh, mem, 0, 0, 0xCC0020);
      b.UnlockBits(bd);
      b.Save(path, ImageFormat.Png);
    }
    DeleteObject(bmp); DeleteDC(mem); ReleaseDC(h, dc);
    return true;
  }
}
"@ }
$result = [W.PW]::CaptureAll("${escapedTitle}", "$outDir")
Write-Output $result
`
}

function captureAndPush(): Promise<void> {
  return new Promise((resolve) => {
    if (!st.win || st.win.isDestroyed() || !st.running || st.capturing) { resolve(); return; }
    st.capturing = true

    try {
      const selfTitle = getSelfTitle()
      if (!selfTitle) { st.capturing = false; resolve(); return }

      const outDir = mkdtempSync(join(tmpdir(), 'pw_'))
      const script = buildScript(selfTitle, outDir)
      const scriptPath = join(outDir, 'run.ps1')
      writeFileSync(scriptPath, script, 'utf-8')

      // 执行 PowerShell（单次调用完成所有工作）
      const stdout = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
        { timeout: 20000, encoding: 'utf-8', maxBuffer: 1024 * 1024 },
      )

      // 解析输出
      const captured: { pngBuffer: Buffer; left: number; top: number; width: number; height: number }[] = []
      for (const line of stdout.split('\n').filter(Boolean)) {
        const parts = line.split('|')
        if (parts[0] !== 'OK' || parts.length < 4) continue
        const coords = parts[2].split(',').map(Number)
        if (coords.length < 4) continue
        const path = parts[3].trim()
        try {
          const buf = readFileSync(path)
          if (buf.length > 200) {
            captured.push({
              pngBuffer: buf,
              left: coords[0], top: coords[1],
              width: coords[2] - coords[0], height: coords[3] - coords[1],
            })
          }
        } catch { /* skip */ }
      }

      // 清理临时文件
      try { rmSync(outDir, { recursive: true, force: true }) } catch { /* ok */ }

      if (st.win && !st.win.isDestroyed() && st.running) {
        st.win.webContents.send('printwindow:frame', {
          windows: captured.map((c) => ({
            pngBuffer: c.pngBuffer,
            left: c.left, top: c.top, width: Math.min(c.width, 1920), height: Math.min(c.height, 1080),
          })),
          timestamp: Date.now(),
        })
        logger.info(`PW captured ${captured.length} windows`)
      }
    } catch (err) {
      logger.error('PWCapture failed', err as Error)
    }
    st.capturing = false
    resolve()
  })
}

function schedule(): void {
  if (!st.running) return
  st.timer = setTimeout(async () => {
    await captureAndPush()
    schedule()
  }, 1000) // 1 FPS（PowerShell 批量捕获约需 0.5-2s）
}

function start(): void {
  if (!st.running) { st.running = true; schedule(); logger.info('PWCapture started') }
}
function stop(): void {
  st.running = false; st.capturing = false
  if (st.timer) { clearTimeout(st.timer); st.timer = null }
}

function registerIpc(): void {
  const on = (c: string, h: (...a: any[]) => void) => { try { ipcMain.on(c, h) } catch {} }
  on('printwindow:start', () => { logger.info('PW IPC: start received'); start() })
  on('printwindow:stop', () => { logger.info('PW IPC: stop received'); stop() })
}

export function initPrintWindowCapture(win: BrowserWindow): void {
  try {
    st.win = win; registerIpc()
    win.on('hide', () => stop()); win.on('show', () => start())
    win.on('minimize', () => stop()); win.on('restore', () => start())
    win.on('close', () => { stop(); st.win = null })
    logger.info('PrintWindow capture initialized')
  } catch (err) { logger.error('Failed to init PWCapture', err as Error) }
}
