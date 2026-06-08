/**
 * ScreenMonitor — 桌面实时监控组件
 *
 * - 进入页面自动开始推流，离开自动停止
 * - 显示桌面画面，自身窗口区域用遮罩覆盖
 * - 有终端输出时自动显示终端面板
 */
import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  terminalLines?: string[]
  defaultFps?: number
}

interface FrameMask {
  x: number; y: number; w: number; h: number
}

const MAX_TERM_LINES = 500

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 2 }) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)
  const [mask, setMask] = useState<FrameMask | null>(null)
  const [maskStyle, setMaskStyle] = useState<React.CSSProperties>({})

  // ── 进入自动开始，离开自动停止 ──────────────────
  useEffect(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return

    sm.setFps(defaultFps)
    sm.start()

    const handler = (data: { dataUrl: string; mask?: FrameMask }) => {
      if (imgRef.current) {
        imgRef.current.src = data.dataUrl
      }
      if (data.mask) {
        setMask(data.mask)
      }
    }
    sm.onFrame(handler)

    return () => {
      sm.offFrame(handler)
      sm.stop()
    }
  }, [defaultFps])

  // ── 根据图片自然尺寸和容器尺寸计算遮罩位置 ────
  useEffect(() => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container || !mask) return

    const handleLoad = () => {
      const naturalW = img.naturalWidth || 480
      const naturalH = img.naturalHeight || 270
      const containerRect = container.getBoundingClientRect()
      const containerW = containerRect.width
      const containerH = containerRect.height

      // 计算 object-fit: contain 下的图片实际绘制区域
      const scale = Math.min(containerW / naturalW, containerH / naturalH)
      const drawW = naturalW * scale
      const drawH = naturalH * scale
      const offsetX = (containerW - drawW) / 2
      const offsetY = (containerH - drawH) / 2

      // 遮罩坐标（mask 基于 480×270 截图坐标系）
      const scaleFactor = drawW / 480
      setMaskStyle({
        position: 'absolute',
        left: offsetX + mask.x * scaleFactor,
        top: offsetY + mask.y * scaleFactor,
        width: mask.w * scaleFactor,
        height: mask.h * scaleFactor,
        background: 'rgba(0,0,0,0.55)',
        borderRadius: 4,
        pointerEvents: 'none',
        transition: 'all 0.3s ease',
      })
    }

    if (img.complete) handleLoad()
    else img.addEventListener('load', handleLoad)
    return () => img.removeEventListener('load', handleLoad)
  }, [mask])

  // ── 终端自动滚底 ───────────────────────────────
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
        {mask && <div style={maskStyle} />}
      </div>

      {displayLines.length > 0 && (
        <div className="sm-terminal">
          <div className="sm-terminal-header">AI 终端输出</div>
          <div className="sm-terminal-body" style={{ maxHeight: 160 }}>
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
