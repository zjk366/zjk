/**
 * 监控室（MonitorRoom）
 *
 * Step 3: 实时操作流 + 真实资源面板。
 * - 左上：操作实时流（最新操作实时滚动）
 * - 左下：Skill 卡片（来自 SkillsService）+ 文件网格（来自 MonitorService 关联文件）
 *        + 仪表盘（来自 MonitorService 统计数据）
 * - 右侧：操作日志（Step 2 实现）
 */
import ScreenMonitor from '@renderer/components/ScreenMonitor'
import { EventEmitter } from '@renderer/services/EventService'
import MonitorService, { MONITOR_EVENTS } from '@renderer/services/MonitorService'
import type { MonitorLogEntry, ScreenContent } from '@renderer/types/monitor'
import { ArrowLeft } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

/** 缓存已获取的 skills（避免每次渲染都读） */
let cachedSkills: { name: string; status: 'active' | 'idle' | 'error' }[] | null = null

async function loadSkills(): Promise<typeof cachedSkills> {
  if (cachedSkills) return cachedSkills
  try {
    const { default: SkillsService } = await import('@renderer/services/SkillsService')
    const svc = SkillsService.getInstance()
    const all = await svc.getAll()
    cachedSkills = all.slice(0, 6).map((s) => ({
      name: s.name,
      status: s.isEnabled ? ('active' as const) : ('idle' as const)
    }))
    return cachedSkills
  } catch {
    return null
  }
}

interface WinEntry {
  hwnd: string
  title: string
  pid: number
  width: number
  height: number
  isMinimized: boolean
}

const MonitorRoomPage: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [logs, setLogs] = useState<MonitorLogEntry[]>([])
  const [terminalLines, setTerminalLines] = useState<string[]>([])
  const [screen, setScreen] = useState<ScreenContent>({ type: 'idle' })
  const [skills, setSkills] = useState<{ name: string; status: 'active' | 'idle' | 'error' }[]>([])
  const [skillsLoaded, setSkillsLoaded] = useState(false)

  // ── 自动捕获状态 ────────────────────────────
  const [captureInfo, setCaptureInfo] = useState<string>('')
  const [winList, setWinList] = useState<WinEntry[]>([])
  const [winIndex, setWinIndex] = useState(0)
  const autoStartedRef = useRef(false)

  const serviceRef = useRef(MonitorService.getInstance())
  const screenRef = useRef<HTMLDivElement>(null)
  const termEndRef = useRef<HTMLDivElement>(null)
  const targetHwndRef = useRef('') // 当前监控目标的 HWND

  // ── 仪表盘统计数据 ─────────────────────────────
  const stats = useMemo(() => {
    const total = logs.length
    const blocked = logs.filter((l) => l.status === 'blocked').length
    const retro = logs.filter((l) => l.status === 'retro').length
    return { total, blocked, retro }
  }, [logs])

  // ── 初始化 ────────────────────────────────────
  useEffect(() => {
    const svc = serviceRef.current
    svc.init()
    setLogs(svc.getAll())

    // 加载 skills
    loadSkills().then((s) => {
      if (s) setSkills(s)
      setSkillsLoaded(true)
    })

    // 初始屏幕状态
    setScreen(serviceRef.current.screen)

    // 启动桌面截屏（通过预加载桥接 API）
    const sm = (window as any).screenMonitor
    sm?.start()

    // 监听桌面帧
    const onFrame = (frame: any) => {
      setScreen((prev) => {
        if (prev.type === 'idle' || prev.type === 'desktop') {
          return { type: 'desktop', dataUrl: frame.dataUrl, timestamp: frame.timestamp }
        }
        return prev
      })
    }
    sm?.onFrame(onFrame)

    // ── 自动识别窗口并启动 PrintWindow 捕获 ──
    if (!autoStartedRef.current) {
      autoStartedRef.current = true
      try {
        const list: WinEntry[] = sm?.listWindows() ?? []
        const sorted = list
          .filter((w) => w.title.trim() && !w.isMinimized && w.width > 100 && w.height > 100)
          .sort((a, b) => b.width * b.height - a.width * a.height)
        setWinList(sorted)
        if (sorted.length > 0) {
          targetHwndRef.current = sorted[0].hwnd
          sm?.setTarget(sorted[0].hwnd, sorted[0].title, sorted[0].width, sorted[0].height)
          setCaptureInfo(`🎯 1/${sorted.length} ${sorted[0].title}`)
        } else {
          setCaptureInfo('⏳ 等待可用窗口...')
        }
      } catch {
        setCaptureInfo('⏳ 窗口枚举失败')
      }
    }

    // ── 定时刷新窗口列表 + 窗口关闭自动切换 ──────
    const refreshInterval = setInterval(() => {
      try {
        const sm2 = (window as any).screenMonitor
        const freshList: WinEntry[] = sm2?.listWindows() ?? []
        const sorted = freshList
          .filter((w) => w.title.trim() && !w.isMinimized && w.width > 100 && w.height > 100)
          .sort((a, b) => b.width * b.height - a.width * a.height)

        // 当前目标窗口是否还在？
        const currentHwnd = targetHwndRef.current
        if (currentHwnd && sorted.length > 0 && !sorted.some((w) => w.hwnd === currentHwnd)) {
          // 已关闭 → 自动切到第一个
          const first = sorted[0]
          targetHwndRef.current = first.hwnd
          sm2?.setTarget(first.hwnd, first.title, first.width, first.height)
          setWinIndex(0)
        }
        setWinList(sorted)
      } catch {
        /* 刷新失败，下次再试 */
      }
    }, 3000)

    const onLogAdded = (entry: MonitorLogEntry) => setLogs((prev) => [...prev, entry])
    const onLogRetro = (entry: MonitorLogEntry) => setLogs((prev) => prev.map((l) => (l.id === entry.id ? entry : l)))
    const onRetroAll = () =>
      setLogs((prev) => prev.map((l) => (l.status === 'ok' ? { ...l, status: 'retro' as const } : l)))
    const onScreenUpdate = (content: ScreenContent) => {
      setScreen(content)
      // 从终端输出中提取文本行给 ScreenMonitor
      if (content.type === 'terminal') {
        setTerminalLines((prev) => {
          const newLines = content.output.map((o) => o.text)
          return [...prev, ...newLines].slice(-500)
        })
      }
    }

    const off1 = EventEmitter.on(MONITOR_EVENTS.LOG_ADDED as any, onLogAdded)
    const off2 = EventEmitter.on(MONITOR_EVENTS.LOG_RETRO as any, onLogRetro)
    const off3 = EventEmitter.on(MONITOR_EVENTS.LOG_RETRO_ALL as any, onRetroAll)
    const off4 = EventEmitter.on(MONITOR_EVENTS.SCREEN_UPDATE as any, onScreenUpdate)

    return () => {
      clearInterval(refreshInterval)
      const sm = (window as any).screenMonitor
      sm?.offFrame(onFrame)
      sm?.stop()

      ;(async () => {
        const u1 = await off1
        const u2 = await off2
        const u3 = await off3
        const u4 = await off4
        u1?.()
        u2?.()
        u3?.()
        u4?.()
      })()
    }
  }, [])

  // ── 窗口列表变化时同步状态 + 修正索引 ──────────
  useEffect(() => {
    if (winList.length > 0) {
      // 如果当前索引越界（窗口被关闭），回退到第一个
      if (winIndex >= winList.length) {
        setWinIndex(0)
      }
      const target = winList[winIndex] || winList[0]
      setCaptureInfo(`🎯 ${Math.min(winIndex + 1, winList.length)}/${winList.length} ${target.title}`)
    } else {
      setCaptureInfo('⏳ 等待可用窗口...')
    }
  }, [winList, winIndex])

  // 终端输出自动滚底
  useEffect(() => {
    if (screen.type === 'terminal' && termEndRef.current) {
      termEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [screen])

  // ── 获取关联文件（从日志中提取最近操作过的文件路径）───
  const relatedFiles = useMemo(() => {
    const paths = new Map<string, string>()
    for (const l of [...logs].reverse()) {
      if (l.filePath) {
        const name = l.filePath.split('\\').pop() || l.filePath
        if (!paths.has(name)) paths.set(name, l.filePath)
      }
    }
    return [...paths.entries()].slice(0, 6).map(([name]) => ({
      name,
      type:
        name.endsWith('.png') || name.endsWith('.jpg')
          ? ('image' as const)
          : name.endsWith('.pdf')
            ? ('document' as const)
            : ('text' as const)
    }))
  }, [logs])

  const handleRetroAll = useCallback(async () => {
    const count = await serviceRef.current.retroAll()
    if (count > 0) window.toast?.success?.(`已回溯 ${count} 条操作`)
  }, [])
  const handleRetroOne = useCallback(async (logId: string) => {
    await serviceRef.current.retroLog(logId)
  }, [])
  const handleStop = useCallback(() => {
    serviceRef.current.stopCurrent()
  }, [])

  // ── 窗口切换（ref 取值，永不闭包过期） ────────────
  const winListRef = useRef<WinEntry[]>(winList)
  const winIndexRef = useRef(winIndex)
  winListRef.current = winList
  winIndexRef.current = winIndex

  const handleSwitchWindow = useCallback(() => {
    const list = winListRef.current
    const idx = winIndexRef.current
    if (list.length <= 1) return
    const next = (idx + 1) % list.length
    setWinIndex(next)
    targetHwndRef.current = list[next].hwnd
    const sm = (window as any).screenMonitor
    sm?.setTarget(list[next].hwnd, list[next].title, list[next].width, list[next].height)
  }, [])

  return (
    <PageContainer>
      {/* ─── 顶部标题栏 ─────────────────────────────── */}
      <HeaderBar>
        <BackButton onClick={() => navigate('/')} title="返回">
          <ArrowLeft size={18} />
        </BackButton>
        <HeaderTitle>
          <RadarIcon viewBox="0 0 24 24" width="20" height="20">
            <circle cx="12" cy="12" r="2.5" />
            <path d="M12 5a7 7 0 0 1 7 7" opacity="0.7" />
            <path d="M12 2a10 10 0 0 1 10 10" opacity="0.4" />
            <path d="M5 12a7 7 0 0 1 7-7" opacity="0.7" />
            <path d="M2 12a10 10 0 0 1 10-10" opacity="0.4" />
            <path d="M12 19a7 7 0 0 1-7-7" opacity="0.7" />
            <path d="M12 22a10 10 0 0 1-10 10" opacity="0.4" />
            <path d="M19 12a7 7 0 0 1-7 7" opacity="0.7" />
            <path d="M22 12a10 10 0 0 1-10 10" opacity="0.4" />
          </RadarIcon>
          {t('monitor.title')}
        </HeaderTitle>
      </HeaderBar>

      {/* ─── 主体区域 ─────────────────────────────────── */}
      <MainArea>
        {/* ===== 左侧区域 ===== */}
        <LeftColumn>
          {/* 左上：实时屏幕 — 根据 screen.type 切换视图 */}
          <ScreenPanel style={{ flex: 3, minHeight: 0 }}>
            <ScreenStatus>
              <span>
                {screen.type === 'browser'
                  ? `🌐 ${screen.url}`
                  : screen.type === 'terminal'
                    ? `💻 ${screen.command.slice(0, 60)}`
                    : captureInfo}
              </span>
              {screen.type === 'desktop' && winList.length > 1 && (
                <SwitchBtn onClick={handleSwitchWindow} title="切换到下一个窗口">
                  ⇄ 切换
                </SwitchBtn>
              )}
            </ScreenStatus>

            {/* ── 空闲 ── */}
            {screen.type === 'idle' && (
              <ScreenBody>
                <ScreenPlaceholder>
                  <ScreenGlow />
                  <ScreenText>等待操作…</ScreenText>
                </ScreenPlaceholder>
              </ScreenBody>
            )}

            {/* ── 桌面实时画面（PrintWindow / Canvas） ── */}
            {screen.type === 'desktop' && <ScreenMonitor terminalLines={terminalLines} defaultFps={2} />}

            {/* ── 浏览器截图 ── */}
            {screen.type === 'browser' && (
              <BrowserView>
                <BrowserHeader>{screen.url}</BrowserHeader>
                <DesktopFrame>
                  <BrowserImg src={screen.image} alt={screen.url} />
                </DesktopFrame>
              </BrowserView>
            )}

            {/* ── 终端输出 ── */}
            {screen.type === 'terminal' && (
              <TerminalView>
                <TermHeader>$ {screen.command}</TermHeader>
                {screen.output.map((line, i) => (
                  <TermLine key={i} $stderr={line.stream === 'stderr'}>
                    {line.text}
                  </TermLine>
                ))}
                <TermCursor />
                <div ref={termEndRef} />
              </TerminalView>
            )}
          </ScreenPanel>

          {/* 左下：当前任务上下文面板 */}
          <TaskContextPanel>
            <PanelHeader>{t('monitor.taskContext')}</PanelHeader>

            {/* ---- Skill 卡片区 ---- */}
            <SectionBlock>
              <SectionTitle>
                <SkillDot />
                {t('monitor.relatedSkills')}
              </SectionTitle>
              <SkillGrid>
                {!skillsLoaded ? (
                  <SkillName style={{ color: 'var(--color-text-3)', fontSize: 11 }}>加载中...</SkillName>
                ) : skills.length === 0 ? (
                  <SkillName style={{ color: 'var(--color-text-3)', fontSize: 11 }}>暂无关联 Skills</SkillName>
                ) : (
                  skills.map((sk) => (
                    <SkillCard key={sk.name} $status={sk.status}>
                      <SkillName>{sk.name}</SkillName>
                      <SkillStatus $status={sk.status}>
                        {sk.status === 'active' ? '活跃' : sk.status === 'error' ? '错误' : '待命中'}
                      </SkillStatus>
                    </SkillCard>
                  ))
                )}
              </SkillGrid>
            </SectionBlock>

            {/* ---- 文件网格区 ---- */}
            <SectionBlock>
              <SectionTitle>
                <FileDot />
                {t('monitor.relatedFiles')}
              </SectionTitle>
              <FileGrid>
                {relatedFiles.length === 0 ? (
                  <FileName style={{ color: 'var(--color-text-3)', fontSize: 11 }}>暂无关联文件</FileName>
                ) : (
                  relatedFiles.map((f) => (
                    <FileCell key={f.name}>
                      <FileIcon $type={f.type}>
                        {f.type === 'image' ? '🖼' : f.type === 'document' ? '📄' : '📝'}
                      </FileIcon>
                      <FileName>{f.name}</FileName>
                    </FileCell>
                  ))
                )}
              </FileGrid>
            </SectionBlock>

            {/* ---- 仪表盘 ---- */}
            <SectionBlock>
              <SectionTitle>
                <DashDot />
                {t('monitor.sessionMetrics')}
              </SectionTitle>
              <DashboardRow>
                <DashItem>
                  <DashValue>{stats.total}</DashValue>
                  <DashLabel>{t('monitor.totalOps')}</DashLabel>
                </DashItem>
                <DashItem>
                  <DashValue>{stats.blocked}</DashValue>
                  <DashLabel>{t('monitor.blockedOps')}</DashLabel>
                </DashItem>
                <DashItem>
                  <DashValue>{stats.retro}</DashValue>
                  <DashLabel>{t('monitor.retroCount')}</DashLabel>
                </DashItem>
              </DashboardRow>
            </SectionBlock>
          </TaskContextPanel>
        </LeftColumn>

        {/* ===== 右侧：操作日志 ===== */}
        <RightColumn>
          <LogPanel>
            <LogHeader>
              <span>{t('monitor.operationLog')}</span>
              <LogActions>
                <TopRetroBtn onClick={handleRetroAll} title="回溯到最初">
                  <RetroIcon viewBox="0 0 24 24" width="13" height="13">
                    <path d="M3 12a9 9 0 1 0 9-9" strokeWidth="2" fill="none" />
                    <polyline points="3 3 3 9 9 9" strokeWidth="2" fill="none" />
                  </RetroIcon>
                  回溯
                </TopRetroBtn>
                <StopButton onClick={handleStop} title={t('monitor.stopDisabledHint')}>
                  <StopIcon viewBox="0 0 24 24" width="14" height="14">
                    <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
                  </StopIcon>
                  停止
                </StopButton>
              </LogActions>
            </LogHeader>

            <LogList>
              {logs.length === 0 && <LogEnd>暂无操作记录</LogEnd>}
              {logs.map((log) => (
                <LogEntry key={log.id} $status={log.status}>
                  <LogTime>{log.time}</LogTime>
                  <LogAction>{log.action}</LogAction>
                  <LogRight>
                    <LogStatusBadge $status={log.status}>
                      {log.status === 'ok' ? '通过' : log.status === 'blocked' ? '阻止' : '已回溯'}
                    </LogStatusBadge>
                    {log.status === 'ok' && (
                      <EntryRetroBtn
                        title={
                          (log as any).retroData?.vaultEntryId ? '回溯此操作（可恢复文件）' : '回溯此操作（仅标记）'
                        }
                        onClick={() => handleRetroOne(log.id)}
                        $hasBackup={!!(log as any).retroData?.vaultEntryId}>
                        <RetroIcon viewBox="0 0 24 24" width="11" height="11">
                          <path d="M3 12a9 9 0 1 0 9-9" strokeWidth="2" fill="none" />
                          <polyline points="3 3 3 9 9 9" strokeWidth="2" fill="none" />
                        </RetroIcon>
                      </EntryRetroBtn>
                    )}
                  </LogRight>
                </LogEntry>
              ))}
              {logs.length > 0 && <LogEnd>— 日志结束 —</LogEnd>}
            </LogList>
          </LogPanel>
        </RightColumn>
      </MainArea>
    </PageContainer>
  )
}

// ═══════════════════════════════════════════════════════
//  Styled Components
// ═══════════════════════════════════════════════════════

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1;
  background: var(--color-background, #0a0e1a);
  color: var(--color-text, #e8ecf4);
  overflow: hidden;
`

// ─── 顶栏 ────────────────────────────────────────────

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  padding: 20px 20px 12px;
  flex-shrink: 0;
`

const HeaderTitle = styled.h1`
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`

const RadarIcon = styled.svg`
  stroke: var(--color-primary, #338cff);
  fill: none;
`

// ─── 主体 ────────────────────────────────────────────

const MainArea = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
`

// ─── 左列 ────────────────────────────────────────────

const BackButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  flex-shrink: 0;
  &:hover {
    background: var(--color-background-soft);
  }
`

const LeftColumn = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 8px;
  padding: 8px;
  min-width: 0;
  width: 60%;
`

// ─── 左上：屏幕面板 ────────────────────────────────────

const ScreenPanel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 3;
  border-radius: 10px;
  background: rgba(255,255,255,0.03);
  overflow: hidden;
  min-height: 200px;
`

const ScreenHeader = styled.div`
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-3, #8892b0);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const ScreenBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 6px 0;
  position: relative;
  min-height: 0;

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
`

const ScreenPlaceholder = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  position: relative;
  margin: auto;
`

// ─── 终端视图 ────────────────────────────────────────

const TerminalView = styled.div`
  padding: 8px 10px;
  font-family: 'SF Mono', 'Consolas', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  height: 100%;
  overflow-y: auto;
`

const TermHeader = styled.div`
  color: var(--color-primary, #338cff);
  margin-bottom: 6px;
  font-weight: 500;
  opacity: 0.8;
`

const TermLine = styled.div<{ $stderr: boolean }>`
  color: ${(p) => (p.$stderr ? '#ff6b6b' : 'var(--color-text, #e8ecf4)')};
`

const TermCursor = styled.span`
  display: inline-block;
  width: 6px;
  height: 14px;
  background: var(--color-primary, #338cff);
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
  margin-left: 2px;

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
`

// ─── 浏览器视图 ──────────────────────────────────────

const BrowserView = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

const BrowserHeader = styled.div`
  padding: 4px 8px;
  font-size: 10px;
  color: var(--color-text-3, #8892b0);
  background: rgba(0,0,0,0.15);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
`

const DesktopFrame = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #000;
`

const BrowserImg = styled.img`
  flex: 1;
  object-fit: contain;
  width: 100%;
  min-height: 0;
`

const ScreenGlow = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, rgba(51,140,255,0.15), transparent 70%);
  animation: pulse 2.5s ease-in-out infinite;
  @keyframes pulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.15); }
  }
`

const ScreenText = styled.span`
  font-size: 12px;
  color: var(--color-text-3, #8892b0);
`

// ─── 左下：任务上下文面板 ──────────────────────────────

const TaskContextPanel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 2;
  border-radius: 10px;
  background: rgba(255,255,255,0.02);
  overflow-y: auto;
  padding: 0 12px 8px;
  min-height: 140px;
`

const PanelHeader = styled.div`
  padding: 8px 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-3, #8892b0);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  flex-shrink: 0;
`

// ─── 区块 ────────────────────────────────────────────

const SectionBlock = styled.div`
  margin-bottom: 10px;
`

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-2, #a0a8c0);
  margin-bottom: 6px;
`

const SkillDot = styled.span`
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--color-primary, #338cff);
  flex-shrink: 0;
`
const FileDot = styled.span`
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #52c41a;
  flex-shrink: 0;
`
const DashDot = styled.span`
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #faad14;
  flex-shrink: 0;
`

// ─── Skill 卡片 ──────────────────────────────────────

const SkillGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const SkillCard = styled.div<{ $status: 'active' | 'idle' | 'error' }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  background: ${(p) =>
    p.$status === 'active'
      ? 'rgba(51,140,255,0.1)'
      : p.$status === 'error'
        ? 'rgba(255,77,79,0.1)'
        : 'rgba(255,255,255,0.04)'};
  border: 0.5px solid
    ${(p) =>
      p.$status === 'active'
        ? 'rgba(51,140,255,0.25)'
        : p.$status === 'error'
          ? 'rgba(255,77,79,0.25)'
          : 'rgba(255,255,255,0.06)'};
`

const SkillName = styled.span`
  color: var(--color-text, #e8ecf4);
`

const SkillStatus = styled.span<{ $status: string }>`
  font-size: 10px;
  color: ${(p) =>
    p.$status === 'active'
      ? 'var(--color-primary, #338cff)'
      : p.$status === 'error'
        ? 'var(--color-error, #ff4d4f)'
        : 'var(--color-text-3, #8892b0)'};
`

// ─── 文件网格 ─────────────────────────────────────────

const FileGrid = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`

const FileCell = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255,255,255,0.03);
  border: 0.5px solid rgba(255,255,255,0.06);
  font-size: 11px;
  max-width: 160px;
`

const FileIcon = styled.span<{ $type: string }>`
  font-size: 13px;
  flex-shrink: 0;
`

const FileName = styled.span`
  color: var(--color-text, #e8ecf4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

// ─── 仪表盘 ──────────────────────────────────────────

const DashboardRow = styled.div`
  display: flex;
  gap: 8px;
`

const DashItem = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 0;
  border-radius: 6px;
  background: rgba(255,255,255,0.02);
`

const DashValue = styled.span`
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-2, #a0a8c0);
`

const DashLabel = styled.span`
  font-size: 10px;
  color: var(--color-text-3, #8892b0);
`

// ─── 右列：日志 ───────────────────────────────────────

const RightColumn = styled.div`
  width: 40%;
  min-width: 300px;
  flex-shrink: 0;
  padding: 8px 8px 8px 0;
  display: flex;
  align-self: stretch;
`

const LogPanel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  border-radius: 10px;
  background: rgba(0,0,0,0.12);
  overflow: hidden;
`

const LogHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-3, #8892b0);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
`

const LogActions = styled.div`
  display: flex;
  gap: 4px;
`

const RetroIcon = styled.svg`
  stroke: currentColor;
  fill: none;
`

const TopRetroBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  cursor: pointer;
  background: rgba(250,173,20,0.12);
  color: #faad14;
  &:hover {
    background: rgba(250,173,20,0.22);
  }
`

const StopButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  cursor: ${(p) => (p.disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.disabled ? 0.35 : 1)};
  background: rgba(255,77,79,0.12);
  color: #ff4d4f;

  &:not(:disabled):hover {
    background: rgba(255,77,79,0.22);
  }
`

const StopIcon = styled.svg`
  fill: currentColor;
`

// ─── 日志列表 ─────────────────────────────────────────

const LogList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  background: rgba(0,0,0,0.08);

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
`

const LogEntry = styled.div<{ $status: 'ok' | 'blocked' | 'retro' }>`
  display: grid;
  grid-template-columns: 60px 1fr auto 28px;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 11px;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  background: ${(p) => (p.$status === 'retro' ? 'rgba(250,173,20,0.04)' : 'transparent')};

  &:hover {
    background: rgba(255,255,255,0.03);
  }
`

const LogRight = styled.div`
  display: contents;
`

const LogTime = styled.span`
  color: var(--color-text-3, #555);
  flex-shrink: 0;
  width: 60px;
`

const LogAction = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text, #e8ecf4);
`

const EntryRetroBtn = styled.button<{ $hasBackup?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: ${(p) => (p.$hasBackup ? 'rgba(82,196,26,0.12)' : 'transparent')};
  color: ${(p) => (p.$hasBackup ? '#52c41a' : 'var(--color-text-3, #8892b0)')};
  cursor: pointer;
  opacity: ${(p) => (p.$hasBackup ? '0.8' : '0')};
  transition: opacity 0.15s;
  stroke: currentColor;
  fill: none;
  justify-self: center;

  ${LogEntry}:hover & {
    opacity: 0.7;
  }
  &:hover {
    opacity: 1 !important;
    background: rgba(250,173,20,0.15);
    color: #faad14;
  }
`

const LogEnd = styled.div`
  text-align: center;
  padding: 12px;
  font-size: 10px;
  color: var(--color-text-3, #555);
  letter-spacing: 1px;
`

const LogStatusBadge = styled.span<{ $status: 'ok' | 'blocked' | 'retro' }>`
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
  text-align: center;
  min-width: 48px;
  background: ${(p) =>
    p.$status === 'ok'
      ? 'rgba(82,196,26,0.12)'
      : p.$status === 'blocked'
        ? 'rgba(255,77,79,0.12)'
        : 'rgba(250,173,20,0.15)'};
  color: ${(p) => (p.$status === 'ok' ? '#52c41a' : p.$status === 'blocked' ? '#ff4d4f' : '#faad14')};
`

// ─── 捕获状态栏 ────────────────────────────────────

const ScreenStatus = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: var(--color-text-3, #8892b0);
  padding: 4px 10px;
  background: rgba(0,0,0,0.06);
  border-bottom: 0.5px solid rgba(255,255,255,0.04);
  flex-shrink: 0;
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

const SwitchBtn = styled.button`
  padding: 2px 8px;
  border-radius: 4px;
  border: 0.5px solid rgba(255,255,255,0.12);
  background: rgba(51,140,255,0.12);
  color: var(--color-primary, #338cff);
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  &:hover { background: rgba(51,140,255,0.25); }
`

export default MonitorRoomPage
