/**
 * ScreenMonitor — PrintWindow 原生截图显示 + 全屏截图兜底
 *
 * 优先使用 PrintWindow 捕获其它窗口（排除自身、系统覆盖层、透明窗口），
 * PrintWindow 不可用时降级到全屏截图。
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
  const pwReceivedRef = useRef(false)

  useEffect(() => {
    const pw = (window as any).printWindow
    const sm = (window as any).screenMonitor

    // PrintWindow 捕获（优先）
    pw?.onFrame((data: any) => {
      if (!data.windows?.length) return
      const w = data.windows[0]
      if (!w.pngBuffer?.length) return
      pwReceivedRef.current = true
      const blob = new Blob([w.pngBuffer], { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      if (imgRef.current) imgRef.current.src = url
    })
    pw?.start()

    // 全屏截图兜底（PrintWindow 无数据时显示）
    sm?.onFrame((d: { dataUrl: string }) => {
      if (!pwReceivedRef.current && imgRef.current) {
        imgRef.current.src = d.dataUrl
      }
    })
    sm?.start()

    return () => { pw?.stop(); sm?.stop() }
  }, [])

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
        <img ref={imgRef} alt="" className="sm-screen-img" />
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
