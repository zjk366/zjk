/**
 * ScreenMonitor — 桌面实时监控组件
 *
 * - 进入页面自动开始推流，离开自动停止
 * - 无工具栏，画面全屏展示
 * - 有终端输出时自动显示终端面板
 */
import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  /** AI 终端输出行，由外部传入（如 MonitorService） */
  terminalLines?: string[]
  /** 默认帧率，默认 3 */
  defaultFps?: number
}

const MAX_TERM_LINES = 500

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 3 }) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)

  // ── 进入自动开始，离开自动停止 ──────────────────
  useEffect(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return

    sm.setFps(defaultFps)
    sm.start()

    const handler = (data: { dataUrl: string }) => {
      if (imgRef.current) {
        imgRef.current.src = data.dataUrl
      }
    }
    sm.onFrame(handler)

    return () => {
      sm.offFrame(handler)
      sm.stop()
    }
  }, [defaultFps])

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
      {/* ─── 桌面画面 ─────────────────────────── */}
      <div className="sm-screen">
        <img ref={imgRef} alt="desktop" className="sm-screen-img" />
      </div>

      {/* ─── AI 终端面板（有输出时才显示） ────────── */}
      {displayLines.length > 0 && (
        <div className="sm-terminal">
          <div className="sm-terminal-header">AI 终端输出</div>
          <div className="sm-terminal-body">
            {displayLines.map((line, i) => (
              <div key={i} className="sm-term-line">
                {line}
              </div>
            ))}
            <div ref={termEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}

export default ScreenMonitor
