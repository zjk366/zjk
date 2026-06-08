/**
 * ScreenMonitor — DWM 捕获 + 全屏截图双模显示
 *
 * 优先 DWM 缩略图（低延迟、完整窗口内容），
 * 回退到全屏截图兜底。
 */
import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  terminalLines?: string[]
  defaultFps?: number
  /** DWM 捕获目标窗口句柄（可选） */
  dwmHwnd?: string
}

const MAX_TERM_LINES = 500

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 2, dwmHwnd }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)
  const dwmActiveRef = useRef(false)
  const backingImgRef = useRef<HTMLImageElement>(null)

  // ── DWM 帧渲染（putImageData 零拷贝） ─────────
  useEffect(() => {
    if (!dwmHwnd) return

    // 启动 DWM 捕获
    window.electron?.ipcRenderer?.send('dwm:start', dwmHwnd)

    const handler = (_event: any, data: any) => {
      if (data.type === 'frame' && data.rawBuffer) {
        dwmActiveRef.current = true
        const canvas = canvasRef.current
        if (!canvas) return
        // 调整 Canvas 尺寸匹配帧
        if (canvas.width !== data.width || canvas.height !== data.height) {
          canvas.width = data.width
          canvas.height = data.height
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // 从 Uint8Array/ArrayBuffer 创建 ImageData
        let arr: Uint8ClampedArray
        if (data.rawBuffer instanceof Uint8Array) {
          arr = new Uint8ClampedArray(data.rawBuffer.buffer, data.rawBuffer.byteOffset, data.rawBuffer.byteLength)
        } else if (data.rawBuffer instanceof ArrayBuffer) {
          arr = new Uint8ClampedArray(data.rawBuffer)
        } else {
          return
        }
        const imageData = new ImageData(arr, data.width, data.height)
        ctx.putImageData(imageData, 0, 0)
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

  // ── 全屏截图兜底（DWM 无数据时） ──────────────
  useEffect(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return

    sm.setFps(defaultFps)
    sm.start()
    const handler = (data: { dataUrl: string }) => {
      if (!dwmActiveRef.current && backingImgRef.current) {
        backingImgRef.current.src = data.dataUrl
      }
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
      <div className="sm-screen" ref={containerRef}>
        {/* DWM Canvas（有数据时覆盖 img） */}
        <canvas ref={canvasRef} className="sm-canvas" style={{ display: dwmActiveRef.current ? 'block' : 'none' }} />
        {/* 全屏截图兜底（DWM 无数据时显示） */}
        <img ref={backingImgRef} alt="" className="sm-screen-img"
          style={{ display: dwmActiveRef.current ? 'none' : 'block' }} />
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
