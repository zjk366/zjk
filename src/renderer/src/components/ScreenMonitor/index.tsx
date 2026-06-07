/**
 * ScreenMonitor — 桌面实时监控组件
 *
 * - 实时桌面画面（window.screenMonitor.onFrame）
 * - 帧率滑块 1~10fps
 * - 开始/停止按钮
 * - AI 终端输出面板（只读、自动滚底、最多 500 行）
 * - 状态指示器（绿色闪烁/灰色）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  /** AI 终端输出行，由外部传入（如 MonitorService） */
  terminalLines?: string[]
  /** 默认帧率，默认 2 */
  defaultFps?: number
}

const MAX_TERM_LINES = 500

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 2 }) => {
  const [fps, setFps] = useState(defaultFps)
  const [running, setRunning] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const termContainerRef = useRef<HTMLDivElement>(null)
  const runningRef = useRef(false)

  // ── 帧回调 ─────────────────────────────────────
  const onFrameRef = useRef<(data: { dataUrl: string }) => void>(undefined)

  useEffect(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return

    const handler = (data: { dataUrl: string }) => {
      if (imgRef.current) {
        imgRef.current.src = data.dataUrl
      }
    }

    onFrameRef.current = handler
    sm.onFrame(handler)

    return () => {
      sm.offFrame(handler)
    }
  }, [])

  // ── 开始/停止 ──────────────────────────────────
  const handleStart = useCallback(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return
    sm.setFps(fps)
    sm.start()
    setRunning(true)
    runningRef.current = true
  }, [fps])

  const handleStop = useCallback(() => {
    const sm = (window as any).screenMonitor
    if (!sm) return
    sm.stop()
    setRunning(false)
    runningRef.current = false
  }, [])

  // ── 帧率变化 ───────────────────────────────────
  const handleFpsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value)
      setFps(v)
      const sm = (window as any).screenMonitor
      if (sm && runningRef.current) {
        sm.setFps(v)
      }
    },
    [],
  )

  // ── 终端自动滚底 ───────────────────────────────
  const prevLenRef = useRef(0)
  useEffect(() => {
    if (terminalLines.length > prevLenRef.current && termEndRef.current) {
      termEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
    prevLenRef.current = terminalLines.length
  }, [terminalLines.length])

  // 截断超过 500 行
  const displayLines = terminalLines.slice(-MAX_TERM_LINES)

  return (
    <div className="screen-monitor">
      {/* ─── 工具栏 ───────────────────────────── */}
      <div className="sm-toolbar">
        <div className="sm-toolbar-left">
          <button
            className={`sm-btn ${running ? 'sm-btn-stop' : 'sm-btn-start'}`}
            onClick={running ? handleStop : handleStart}
          >
            {running ? '■ 停止' : '▶ 开始'}
          </button>
          <span className="sm-fps-label">
            {fps} fps
          </span>
          <input
            className="sm-slider"
            type="range"
            min={1}
            max={10}
            step={1}
            value={fps}
            onChange={handleFpsChange}
          />
        </div>
        <div className="sm-toolbar-right">
          <span
            className={`sm-indicator ${running ? 'sm-indicator-live' : ''}`}
            title={running ? '实时' : '已停止'}
          />
          <span className="sm-indicator-text">{running ? '实时' : '已停止'}</span>
        </div>
      </div>

      {/* ─── 桌面画面 ─────────────────────────── */}
      <div className="sm-screen">
        <img ref={imgRef} alt="desktop" className="sm-screen-img" />
        {!running && (
          <div className="sm-screen-overlay">
            <span className="sm-screen-hint">点击「开始」查看桌面实时画面</span>
          </div>
        )}
      </div>

      {/* ─── AI 终端面板 ──────────────────────── */}
      <div className="sm-terminal" ref={termContainerRef}>
        <div className="sm-terminal-header">AI 终端输出</div>
        <div className="sm-terminal-body">
          {displayLines.length === 0 ? (
            <div className="sm-terminal-empty">暂无终端输出</div>
          ) : (
            displayLines.map((line, i) => (
              <div key={i} className="sm-term-line">
                {line}
              </div>
            ))
          )}
          <div ref={termEndRef} />
        </div>
      </div>
    </div>
  )
}

export default ScreenMonitor
