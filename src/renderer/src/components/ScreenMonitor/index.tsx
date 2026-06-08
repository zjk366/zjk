/**
 * ScreenMonitor — 桌面实时监控组件
 *
 * 截图中用 Canvas 抠掉 CherryStudio 自身窗口区域，
 * 露出监控室黑色背景，实现"看不到自身窗口"效果。
 */
import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  terminalLines?: string[]
  defaultFps?: number
}

interface Rect { x: number; y: number; w: number; h: number }

const MAX_TERM_LINES = 500

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 2 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)
  const currentUrlRef = useRef('')
  const maskRef = useRef<Rect | null>(null)
  const renderReqRef = useRef(0)

  // ── 绘制帧到 Canvas（含抠洞） ──────────────────
  const drawFrame = () => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const img = new Image()
    img.onload = () => {
      const cw = container.clientWidth
      const ch = container.clientHeight
      canvas.width = cw
      canvas.height = ch

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // 计算 object-fit: contain 的绘制区域
      const scale = Math.min(cw / img.width, ch / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      const dx = (cw - dw) / 2
      const dy = (ch - dh) / 2

      // 绘制截图
      ctx.clearRect(0, 0, cw, ch)
      ctx.drawImage(img, dx, dy, dw, dh)

      // 抠掉自身窗口区域
      const m = maskRef.current
      if (m) {
        const sf = dw / 480 // 480×270 截图坐标系 → 实际像素
        ctx.clearRect(
          dx + m.x * sf,
          dy + m.y * sf,
          m.w * sf,
          m.h * sf,
        )
      }
    }
    if (currentUrlRef.current) {
      img.src = currentUrlRef.current
    }
    renderReqRef.current = 0
  }

  // ── 启动截屏 ──────────────────────────────────
  useEffect(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return

    sm.setFps(defaultFps)
    sm.start()

    const handler = (data: { dataUrl: string; windowRect?: Rect }) => {
      currentUrlRef.current = data.dataUrl
      if (data.windowRect) maskRef.current = data.windowRect
      if (!renderReqRef.current) {
        renderReqRef.current = requestAnimationFrame(drawFrame)
      }
    }
    sm.onFrame(handler)

    // 窗口尺寸变化时重绘
    const ro = new ResizeObserver(() => {
      if (!renderReqRef.current) {
        renderReqRef.current = requestAnimationFrame(drawFrame)
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      sm.offFrame(handler)
      sm.stop()
      ro.disconnect()
      if (renderReqRef.current) cancelAnimationFrame(renderReqRef.current)
    }
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
        <canvas ref={canvasRef} className="sm-canvas" />
      </div>

      {displayLines.length > 0 && (
        <div className="sm-terminal">
          <div className="sm-terminal-header">AI 终端输出</div>
          <div className="sm-terminal-body">
            {displayLines.map((line, i) => (
              <div key={i} className="sm-term-line">{line}</div>
            ))}
            <div ref={termEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}

export default ScreenMonitor
