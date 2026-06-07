/**
 * 监控室（MonitorRoom）
 *
 * 排版：
 * ┌─────────────────────────────┬──────────────────────────┐
 * │  左上：实时监控屏幕           │  右侧：操作日志            │
 * │  (AI 操作实时推流)           │  (记录 + 回溯 + 强制停止)  │
 * │                             │                          │
 * ├─────────────────────────────┤                          │
 * │  左下：当前任务上下文面板     │                          │
 * │  - Skill 卡片               │                          │
 * │  - 文件网格                 │                          │
 * │  - 仪表盘占位               │                          │
 * └─────────────────────────────┴──────────────────────────┘
 *
 * 术语体系：回溯（retrograde）用于描述 AI 操作的撤销/回滚。
 *
 * ——— Step 1: 纯静态 UI 布局，不含真实数据绑定 ———
 */
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'
import { useMemo } from 'react'
import styled from 'styled-components'

const MonitorRoomPage: FC = () => {
  const { t } = useTranslation()

  // 静态占位数据（Step 1: 纯 UI，无真实绑定）
  const staticSkills = useMemo<{ name: string; status: 'active' | 'idle' | 'error' }[]>(
    () => [
      { name: '@cherry/filesystem', status: 'active' },
      { name: '@cherry/terminal', status: 'idle' },
      { name: '@cherry/browser', status: 'idle' },
    ],
    [],
  )

  const staticFiles = useMemo<{ name: string; type: string }[]>(
    () => [
      { name: 'hosts.txt', type: 'text' },
      { name: 'screenshot_2026-06-07.png', type: 'image' },
      { name: 'report.pdf', type: 'document' },
    ],
    [],
  )

  const staticLogs = useMemo<{ time: string; action: string; status: 'ok' | 'blocked' | 'retro' }[]>(
    () => [
      { time: '14:32:15', action: '读取 C:\\Users\\...\\config.json', status: 'ok' },
      { time: '14:31:50', action: '执行终端命令: del temp.txt', status: 'blocked' },
      { time: '14:30:22', action: '写入 D:\\project\\output.txt', status: 'ok' },
      { time: '14:29:08', action: '读取 C:\\Windows\\System32\\...', status: 'blocked' },
      { time: '14:28:44', action: '创建文件 D:\\backup\\data.json', status: 'ok' },
    ],
    [],
  )

  return (
    <PageContainer>
      {/* ─── 顶部标题栏 ─────────────────────────────── */}
      <HeaderBar>
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
          {/* 左上：实时监控屏幕 */}
          <ScreenPanel>
            <ScreenHeader>{t('monitor.screenLive')}</ScreenHeader>
            <ScreenBody>
              <ScreenPlaceholder>
                <ScreenGlow />
                <ScreenText>{t('monitor.screenWaiting')}</ScreenText>
              </ScreenPlaceholder>
            </ScreenBody>
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
                {staticSkills.map((sk) => (
                  <SkillCard key={sk.name} $status={sk.status}>
                    <SkillName>{sk.name}</SkillName>
                    <SkillStatus $status={sk.status}>
                      {sk.status === 'active' ? '活跃' : sk.status === 'error' ? '错误' : '待命中'}
                    </SkillStatus>
                  </SkillCard>
                ))}
              </SkillGrid>
            </SectionBlock>

            {/* ---- 文件网格区 ---- */}
            <SectionBlock>
              <SectionTitle>
                <FileDot />
                {t('monitor.relatedFiles')}
              </SectionTitle>
              <FileGrid>
                {staticFiles.map((f) => (
                  <FileCell key={f.name}>
                    <FileIcon $type={f.type}>
                      {f.type === 'image' ? '🖼' : f.type === 'document' ? '📄' : '📝'}
                    </FileIcon>
                    <FileName>{f.name}</FileName>
                  </FileCell>
                ))}
              </FileGrid>
            </SectionBlock>

            {/* ---- 仪表盘占位 ---- */}
            <SectionBlock>
              <SectionTitle>
                <DashDot />
                {t('monitor.sessionMetrics')}
              </SectionTitle>
              <DashboardRow>
                <DashItem>
                  <DashValue>—</DashValue>
                  <DashLabel>{t('monitor.totalOps')}</DashLabel>
                </DashItem>
                <DashItem>
                  <DashValue>—</DashValue>
                  <DashLabel>{t('monitor.blockedOps')}</DashLabel>
                </DashItem>
                <DashItem>
                  <DashValue>—</DashValue>
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
                <RetroButton disabled title={t('monitor.retroDisabledHint')}>
                  <RetroIcon viewBox="0 0 24 24" width="14" height="14">
                    <path d="M3 12a9 9 0 1 0 9-9" strokeWidth="2" fill="none" />
                    <polyline points="3 3 3 9 9 9" strokeWidth="2" fill="none" />
                  </RetroIcon>
                  回溯
                </RetroButton>
                <StopButton disabled title={t('monitor.stopDisabledHint')}>
                  <StopIcon viewBox="0 0 24 24" width="14" height="14">
                    <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
                  </StopIcon>
                  停止
                </StopButton>
              </LogActions>
            </LogHeader>

            <LogList>
              {staticLogs.map((log, i) => (
                <LogEntry key={i} $status={log.status}>
                  <LogTime>{log.time}</LogTime>
                  <LogAction>{log.action}</LogAction>
                  <LogStatusBadge $status={log.status}>
                    {log.status === 'ok' ? '通过' : log.status === 'blocked' ? '阻止' : '回溯'}
                  </LogStatusBadge>
                </LogEntry>
              ))}
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
  background: var(--color-background, #0a0e1a);
  color: var(--color-text, #e8ecf4);
  overflow: hidden;
`

// ─── 顶栏 ────────────────────────────────────────────

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 0.5px solid var(--color-border, rgba(255,255,255,0.06));
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
`

// ─── 左列 ────────────────────────────────────────────

const LeftColumn = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 8px;
  padding: 8px;
  min-width: 0;
`

// ─── 左上：屏幕面板 ────────────────────────────────────

const ScreenPanel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 3;
  border-radius: 10px;
  border: 0.5px solid var(--color-border, rgba(255,255,255,0.08));
  background: var(--color-background-soft, rgba(255,255,255,0.02));
  overflow: hidden;
  min-height: 200px;
`

const ScreenHeader = styled.div`
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-3, #8892b0);
  border-bottom: 0.5px solid var(--color-border, rgba(255,255,255,0.06));
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const ScreenBody = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
`

const ScreenPlaceholder = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  position: relative;
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
  border: 0.5px solid var(--color-border, rgba(255,255,255,0.08));
  background: var(--color-background-soft, rgba(255,255,255,0.02));
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
  border-bottom: 0.5px solid var(--color-border, rgba(255,255,255,0.06));
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
    p.$status === 'active' ? 'var(--color-primary, #338cff)' : p.$status === 'error' ? 'var(--color-error, #ff4d4f)' : 'var(--color-text-3, #8892b0)'};
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
  width: 320px;
  flex-shrink: 0;
  padding: 8px 8px 8px 0;
  display: flex;
`

const LogPanel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  border-radius: 10px;
  border: 0.5px solid var(--color-border, rgba(255,255,255,0.08));
  background: var(--color-background-soft, rgba(255,255,255,0.02));
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
  border-bottom: 0.5px solid var(--color-border, rgba(255,255,255,0.06));
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
`

const LogActions = styled.div`
  display: flex;
  gap: 4px;
`

const RetroButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  cursor: ${(p) => (p.disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.disabled ? 0.35 : 1)};
  background: rgba(250,173,20,0.12);
  color: #faad14;

  &:not(:disabled):hover {
    background: rgba(250,173,20,0.22);
  }
`

const RetroIcon = styled.svg`
  stroke: currentColor;
  fill: none;
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

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
`

const LogEntry = styled.div<{ $status: 'ok' | 'blocked' | 'retro' }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 11px;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  border-left: 2px solid
    ${(p) =>
      p.$status === 'ok' ? 'rgba(82,196,26,0.5)' : p.$status === 'blocked' ? 'rgba(255,77,79,0.5)' : 'rgba(250,173,20,0.5)'};
  background: ${(p) =>
    p.$status === 'retro' ? 'rgba(250,173,20,0.04)' : 'transparent'};

  &:hover {
    background: rgba(255,255,255,0.03);
  }
`

const LogTime = styled.span`
  color: var(--color-text-3, #555);
  flex-shrink: 0;
  width: 52px;
`

const LogAction = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text, #e8ecf4);
`

const LogStatusBadge = styled.span<{ $status: 'ok' | 'blocked' | 'retro' }>`
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
  background: ${(p) =>
    p.$status === 'ok'
      ? 'rgba(82,196,26,0.12)'
      : p.$status === 'blocked'
        ? 'rgba(255,77,79,0.12)'
        : 'rgba(250,173,20,0.12)'};
  color: ${(p) =>
    p.$status === 'ok' ? '#52c41a' : p.$status === 'blocked' ? '#ff4d4f' : '#faad14'};
`

export default MonitorRoomPage
