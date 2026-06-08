/**
 * ScreenMonitor — 桌面/窗口级实时监控组件
 *
 * 双模式：
 * - 窗口模式（默认）：捕获独立窗口排除自身，Canvas 合成排列
 * - 截屏模式（兜底）：全屏截图直接显示
 */
import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import './style.css'

export interface ScreenMonitorProps {
  terminalLines?: string[]
  defaultFps?: number
}

interface WindowInfo {
  id: string; name: string; dataUrl: string; width: number; height: number
}

const MAX_TERM_LINES = 500
const IMG_CACHE = new Map<string, HTMLImageElement>()

function getOrCreateImage(dataUrl: string): HTMLImageElement {
  let img = IMG_CACHE.get(dataUrl)
  if (!img) { img = new Image(); img.src = dataUrl; IMG_CACHE.set(dataUrl, img) }
  return img
}

/** 在 Canvas 上绘制单个窗口（带标题栏 + 圆角） */
function drawWindowTile(
  ctx: CanvasRenderingContext2D,
  w: WindowInfo,
  x: number, y: number,
  dw: number, dh: number,
) {
  const titleH = Math.min(dw * 0.05 + 10, 22)
  const img = getOrCreateImage(w.dataUrl)
  if (!img.complete || !img.naturalWidth) return

  // 阴影
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 3
  ctx.fillStyle = '#1a1e2a'
  ctx.beginPath()
  ctx.roundRect(x - 1, y - 1, dw + 2, dh + 2, 8)
  ctx.fill()
  ctx.restore()

  // 标题栏
  ctx.fillStyle = '#252836'
  ctx.beginPath()
  ctx.roundRect(x + 1, y + 1, dw - 2, titleH - 1, [7, 7, 0, 0])
  ctx.fill()

  // 标题文字
  ctx.fillStyle = '#8892b0'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const title = w.name.length > 32 ? w.name.slice(0, 30) + '…' : w.name
  ctx.fillText(title, x + dw / 2, y + titleH / 2 + 1)

  // 窗口内容
  ctx.drawImage(img, x + 1, y + titleH + 1, dw - 2, dh - titleH - 2)
}

/** 绘制所有窗口合成 */
function renderWindows(
  ctx: CanvasRenderingContext2D,
  cw: number, ch: number,
  windows: WindowInfo[],
) {
  ctx.fillStyle = '#0a0e1a'
  ctx.fillRect(0, 0, cw, ch)

  if (windows.length === 0) {
    ctx.fillStyle = '#8892b0'
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('无可见窗口', cw / 2, ch / 2)
    return
  }

  const pad = 16
  const gap = 10
  const uW = cw - pad * 2
  const uH = ch - pad * 2

  if (windows.length === 1) {
    const w = windows[0]
    const maxW = uW
    const maxH = uH
    const scale = Math.min(maxW / w.width, maxH / w.height, 2.5)
    const dw = Math.round(w.width * scale)
    const dh = Math.round(w.height * scale)
    drawWindowTile(ctx, w, Math.round((cw - dw) / 2), Math.round((ch - dh) / 2), dw, dh)
    return
  }

  const cols = Math.min(windows.length, 3)
  const rows = Math.ceil(windows.length / cols)
  const cellW = (uW - gap * (cols - 1)) / cols
  const cellH = (uH - gap * (rows - 1)) / rows

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const maxW = cellW - 8
    const maxH = cellH - 8
    const scale = Math.min(maxW / w.width, maxH / w.height, 1.5)
    const dw = Math.round(w.width * scale)
    const dh = Math.round(w.height * scale)
    const cx = pad + col * (cellW + gap) + (cellW - dw) / 2
    const cy = pad + row * (cellH + gap) + (cellH - dh) / 2
    drawWindowTile(ctx, w, Math.round(cx), Math.round(cy), dw, dh)
  }
}

/** 绘制全屏截图 */
function renderScreen(ctx: CanvasRenderingContext2D, cw: number, ch: number, dataUrl: string) {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, cw, ch)

  const img = getOrCreateImage(dataUrl)
  if (!img.complete || !img.naturalWidth) return

  const scale = Math.min(cw / img.width, ch / img.height)
  const dw = Math.round(img.width * scale)
  const dh = Math.round(img.height * scale)
  const dx = Math.round((cw - dw) / 2)
  const dy = Math.round((ch - dh) / 2)
  ctx.drawImage(img, dx, dy, dw, dh)
}

const ScreenMonitor: FC<ScreenMonitorProps> = ({ terminalLines = [], defaultFps = 2 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)
  const rafRef = useRef(0)
  const winRef = useRef<WindowInfo[] | null>(null)
  const screenRef = useRef<string | null>(null)
  const modeRef = useRef<'window' | 'screen'>('screen')

  const render = () => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    if (cw < 10 || ch < 10) return
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    if (modeRef.current === 'window' && winRef.current?.length) {
      renderWindows(ctx, cw, ch, winRef.current)
    } else if (screenRef.current) {
      renderScreen(ctx, cw, ch, screenRef.current)
    } else {
      ctx.fillStyle = '#1a1e2a'
      ctx.fillRect(0, 0, cw, ch)
      ctx.fillStyle = '#8892b0'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('等待桌面画面...', cw / 2, ch / 2)
    }
    rafRef.current = 0
  }

  const schedule = () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(render) }

  useEffect(() => {
    const wc = (window as any).windowCapture
    const sm = (window as any).screenMonitor
    let windowActive = false

    const preloadAndRender = (windows: WindowInfo[]) => {
      winRef.current = windows
      // 预加载所有图片，全部完成后渲染一次
      let loaded = 0
      const total = windows.length
      if (total === 0) return schedule()
      for (const w of windows) {
        const img = new Image()
        img.onload = () => { loaded++; if (loaded >= total) schedule() }
        img.onerror = () => { loaded++; if (loaded >= total) schedule() }
        img.src = w.dataUrl
        // 缓存到 IMG_CACHE
        IMG_CACHE.set(w.dataUrl, img)
      }
    }

    const onWindows = (data: any) => {
      if (data.type === 'windows' && data.windows?.length > 0) {
        if (!windowActive) { windowActive = true; sm?.stop() }
        modeRef.current = 'window'
        preloadAndRender(data.windows)
      } else if (data.type === 'empty' && modeRef.current === 'window') {
        windowActive = false
        modeRef.current = 'screen'
        sm?.setFps(defaultFps)
        sm?.start()
        setTimeout(() => schedule(), 100)
      }
    }
    wc?.start()
    wc?.onFrame(onWindows)

    const onScreen = (data: { dataUrl: string }) => {
      screenRef.current = data.dataUrl
      if (modeRef.current === 'screen') schedule()
    }
    sm?.setFps(defaultFps)
    sm?.start()
    sm?.onFrame(onScreen)

    const onResize = () => schedule()
    window.addEventListener('resize', onResize)

    return () => {
      wc?.offFrame(onWindows)
      wc?.stop()
      sm?.offFrame(onScreen)
      sm?.stop()
      window.removeEventListener('resize', onResize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
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
      <div className="sm-mode-tag">{modeRef.current === 'window' ? '窗口捕获' : '全屏捕获'}</div>
      <div className="sm-screen" ref={containerRef}>
        <canvas ref={canvasRef} className="sm-canvas" />
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
