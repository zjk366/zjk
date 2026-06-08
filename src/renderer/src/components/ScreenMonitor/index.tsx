/**
 * ScreenMonitor — PrintWindow 自适应缩放 + DWM/全屏截屏双模
 *
 * 渲染策略：
 *   1. PrintWindow 原生 BGRA → OffscreenCanvas → drawImage 裁切+缩放
 *   2. DWM 原始 Buffer → OffscreenCanvas → drawImage 缩放
 *   3. 全屏截图 dataUrl → Image → drawImage 缩放（兜底）
 *
 * 自适应缩放：始终根据容器尺寸等比居中显示，保持完整可见。
 */
import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  terminalLines?: string[]
  defaultFps?: number
  /** DWM 捕获目标窗口句柄（可选，保留旧链路） */
  dwmHwnd?: string
}

const MAX_TERM_LINES = 500

/** 将 BGRA Buffer 转为 RGBA Uint8ClampedArray（GDI 位图 alpha=0，强制设为 255） */
function bgraToRgba(src: Uint8Array | ArrayBuffer): Uint8ClampedArray {
  const pixels = src instanceof Uint8Array
    ? new Uint8ClampedArray(src.buffer, src.byteOffset, src.byteLength)
    : new Uint8ClampedArray(src)
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]; const b = pixels[i + 2]
    pixels[i] = b;  // B → R
    pixels[i + 2] = r  // R → B
    pixels[i + 3] = 255  // ★ GDI 位图 alpha=0，强制不透明
  }
  return pixels
}

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 2, dwmHwnd }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)
  const dwmActiveRef = useRef(false)
  const animFrameRef = useRef<number>(0)
  const pendingFrameRef = useRef<any>(null)
  const renderGenRef = useRef(0)       // 帧代数，防止异步 stale 帧覆盖

  // ── 统一渲染循环（requestAnimationFrame 节流） ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const tempCanvas = document.createElement('canvas')
    const tempCtx = tempCanvas.getContext('2d')!

    function render() {
      const data = pendingFrameRef.current
      if (!data) return
      pendingFrameRef.current = null

      if (data.source === 'stale') return

      const container = containerRef.current
      if (!container) return
      const dstW = container.clientWidth
      const dstH = container.clientHeight
      if (dstW <= 0 || dstH <= 0) return

      // ── PrintWindow 原生 BGRA 路径（带等比缩放） ─
      if (data.rawBuffer && data.source === 'printwindow' && data.width > 0) {
        const pixels = bgraToRgba(data.rawBuffer)
        const fullW = data.width
        const fullH = data.height

        // tempCanvas 写全尺寸像素
        tempCanvas.width = fullW
        tempCanvas.height = fullH
        tempCtx.putImageData(new ImageData(pixels, fullW, fullH), 0, 0)

        // 等比缩放居中绘制
        const scale = Math.min(dstW / fullW, dstH / fullH)
        const dw = Math.floor(fullW * scale)
        const dh = Math.floor(fullH * scale)
        const dx = Math.floor((dstW - dw) / 2)
        const dy = Math.floor((dstH - dh) / 2)
        canvas.width = dstW
        canvas.height = dstH
        ctx.drawImage(tempCanvas, 0, 0, fullW, fullH, dx, dy, dw, dh)
        return
      }

      // ── DWM 原始 Buffer 路径 ────────────────────
      if (data.type === 'frame' && data.rawBuffer) {
        const pixels = bgraToRgba(data.rawBuffer)
        const fw = data.width
        const fh = data.height
        if (fw > 0 && fh > 0) {
          tempCanvas.width = fw
          tempCanvas.height = fh
          tempCtx.putImageData(new ImageData(pixels, fw, fh), 0, 0)
          const scale = Math.min(dstW / fw, dstH / fh)
          canvas.width = dstW
          canvas.height = dstH
          ctx.drawImage(tempCanvas, 0, 0, fw, fh,
            Math.floor((dstW - fw * scale) / 2),
            Math.floor((dstH - fh * scale) / 2),
            Math.floor(fw * scale),
            Math.floor(fh * scale))
        }
        return
      }

      // ── dataUrl 路径（desktopCapturer 降级） ──
      //    ★ resize + clear 放在 onload 里，避免异步间隙导致闪烁
      if (data.dataUrl) {
        const img = new Image()
        img.onload = () => {
          canvas.width = dstW
          canvas.height = dstH
          const scale = Math.min(dstW / img.naturalWidth, dstH / img.naturalHeight)
          ctx.drawImage(img,
            Math.floor((dstW - img.naturalWidth * scale) / 2),
            Math.floor((dstH - img.naturalHeight * scale) / 2),
            Math.floor(img.naturalWidth * scale),
            Math.floor(img.naturalHeight * scale))
        }
        img.src = data.dataUrl
      }
    }

    function scheduleRender() {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = requestAnimationFrame(render)
    }

    ;(window as any).__smRender = scheduleRender

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      delete (window as any).__smRender
    }
  }, [])

  // ── DWM 帧接收（保留旧链路） ──────────────────
  useEffect(() => {
    if (!dwmHwnd) return
    window.electron?.ipcRenderer?.send('dwm:start', dwmHwnd)

    const handler = (_event: any, data: any) => {
      if (data.type === 'frame' && data.rawBuffer) {
        dwmActiveRef.current = true
        pendingFrameRef.current = data
        ;(window as any).__smRender?.()
      } else if (data.type === 'lost' || data.type === 'error') {
        dwmActiveRef.current = false
      }
    }
    window.electron?.ipcRenderer?.on('dwm:frame', handler)
    return () => {
      window.electron?.ipcRenderer?.send('dwm:stop')
      window.electron?.ipcRenderer?.removeAllListeners('dwm:frame')
    }
  }, [dwmHwnd])

  // ── PrintWindow / 全屏截图帧接收 ──────────────
  useEffect(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return

    sm.setFps(defaultFps)
    sm.start()

    const handler = (data: any) => {
      pendingFrameRef.current = data
      console.log(`[SM] Frame src=${data.source} pwStatus=${data.pwStatus} rawBuf=${data.rawBuffer ? data.rawBuffer.byteLength : 'none'} dataUrl=${data.dataUrl ? data.dataUrl.slice(0, 30) + '...' : 'none'} ${data.width}x${data.height}`)
      if (data.source === 'printwindow') {
        dwmActiveRef.current = true
      } else if (data.source === 'screen') {
        dwmActiveRef.current = false
      }
      ;(window as any).__smRender?.()
    }
    sm.onFrame(handler)
    return () => { sm.offFrame(handler); sm.stop() }
  }, [defaultFps])

  // ── 终端滚底 ──────────────────────────────────
  useEffect(() => {
    if (terminalLines.length > prevLenRef.current && termEndRef.current) {
      termEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
    prevLenRef.current = terminalLines.length
  }, [terminalLines.length])

  const displayLines = terminalLines.slice(-MAX_TERM_LINES)

  return (
    <div className="screen-monitor">
      <div className="sm-screen" ref={containerRef} style={{ position: 'relative', overflow: 'hidden' }}>
        {/* 统一 Canvas：自适应缩放所有帧类型 */}
        <canvas ref={canvasRef} className="sm-canvas"
          style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>
      {displayLines.length > 0 && (
        <div className="sm-terminal">
          <div className="sm-terminal-header">AI 终端输出</div>
          <div className="sm-terminal-body">
            {displayLines.map((line, i) => <div key={i} className="sm-term-line">{line}</div>)}
            <div ref={termEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}

export default ScreenMonitor
