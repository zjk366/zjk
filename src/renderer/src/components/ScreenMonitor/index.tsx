/**
 * ScreenMonitor — 桌面实时监控组件
 *
 * - 自动截屏推流，离开自动停止
 * - CherryStudio 自身窗口位置用 blur + 暗色遮罩覆盖，避免递归
 */
import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  terminalLines?: string[]
  defaultFps?: number
}

interface Rect { x: number; y: number; w: number; h: number }

const MAX_TERM_LINES = 500

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 2 }) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)
  const [maskStyle, setMaskStyle] = useState<React.CSSProperties>({ display: 'none' })

  useEffect(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return

    sm.setFps(defaultFps)
    sm.start()

    const handler = (data: { dataUrl: string; windowRect?: Rect }) => {
      if (imgRef.current) imgRef.current.src = data.dataUrl

      // 计算遮罩位置（基于 480×270 → 实际显示尺寸缩放）
      if (data.windowRect && imgRef.current && containerRef.current) {
        const img = imgRef.current
        const imgW = img.naturalWidth || 480
        const imgH = img.naturalHeight || 270
        const c = containerRef.current.getBoundingClientRect()
        const scale = Math.min(c.width / imgW, c.height / imgH)
        const drawW = imgW * scale
        const drawH = imgH * scale
        const ox = (c.width - drawW) / 2
        const oy = (c.height - drawH) / 2
        const sf = drawW / 480

        setMaskStyle({
          position: 'absolute',
          left: ox + data.windowRect.x * sf,
          top: oy + data.windowRect.y * sf,
          width: data.windowRect.w * sf,
          height: data.windowRect.h * sf,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          background: 'rgba(0,0,0,0.25)',
          borderRadius: 6,
          pointerEvents: 'none',
          transition: 'all 0.2s ease',
        })
      }
    }
    sm.onFrame(handler)

    return () => {
      sm.offFrame(handler)
      sm.stop()
    }
  }, [defaultFps])

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
        <img ref={imgRef} alt="desktop" className="sm-screen-img" />
        <div style={maskStyle} />
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
