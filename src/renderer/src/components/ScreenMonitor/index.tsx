/**
 * ScreenMonitor — 桌面实时监控组件
 *
 * - 进入页面自动开始推流，离开自动停止
 * - 截图中已排除 CherryStudio 自身窗口（主进程透明化后截取）
 * - 有终端输出时自动显示终端面板
 */
import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  terminalLines?: string[]
  defaultFps?: number
}

const MAX_TERM_LINES = 500

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 2 }) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)

  useEffect(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return

    sm.setFps(defaultFps)
    sm.start()

    const handler = (data: { dataUrl: string }) => {
      if (imgRef.current) imgRef.current.src = data.dataUrl
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
      <div className="sm-screen">
        <img ref={imgRef} alt="desktop" className="sm-screen-img" />
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
