/**
 * TokenMonitorButton - 实时 token 用量监控按钮
 *
 * 替换翻译按钮，显示黑洞图标。
 * 鼠标悬停展示：当前模型、本日用量、本周用量、预估费用、剩余额度。
 * 切换模型时重新初始化。
 */
import { loggerService } from '@logger'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { RootState } from '@renderer/store'
import { useAppSelector } from '@renderer/store'
import { Popover, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

const logger = loggerService.withContext('TokenMonitor')

// ─── 类型定义 ────────────────────────────────────────

interface DayRecord {
  date: string // "2026-06-07"
  prompt: number
  completion: number
  cost: number
}

interface TokenStats {
  today: DayRecord
  week: { prompt: number; completion: number; cost: number; days: number }
  month: { prompt: number; completion: number; cost: number }
}

// ─── localStorage 管理（按模型 ID 分表）─────────────────

function storageKey(modelId: string): string {
  return `token_monitor_history_${modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function loadRecords(modelId: string): DayRecord[] {
  try {
    const raw = localStorage.getItem(storageKey(modelId))
    return raw ? (JSON.parse(raw) as DayRecord[]) : []
  } catch {
    return []
  }
}

function saveRecords(modelId: string, records: DayRecord[]) {
  try {
    localStorage.setItem(storageKey(modelId), JSON.stringify(records))
  } catch {
    // localStorage 满了忽略
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 计算本周起始日 (周一) */
function weekStartStr(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1 // 周日算第6天
  d.setDate(d.getDate() - diff)
  return d.toISOString().slice(0, 10)
}

/** 计算本月起始日 */
function monthStartStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function computeStats(records: DayRecord[]): TokenStats {
  const today = todayStr()
  const ws = weekStartStr()
  const ms = monthStartStr()

  const todayRec = records.find((r) => r.date === today) || { date: today, prompt: 0, completion: 0, cost: 0 }
  const weekRecs = records.filter((r) => r.date >= ws)
  const monthRecs = records.filter((r) => r.date >= ms)

  return {
    today: todayRec,
    week: {
      prompt: weekRecs.reduce((a, b) => a + b.prompt, 0),
      completion: weekRecs.reduce((a, b) => a + b.completion, 0),
      cost: weekRecs.reduce((a, b) => a + b.cost, 0),
      days: new Set(weekRecs.map((r) => r.date)).size
    },
    month: {
      prompt: monthRecs.reduce((a, b) => a + b.prompt, 0),
      completion: monthRecs.reduce((a, b) => a + b.completion, 0),
      cost: monthRecs.reduce((a, b) => a + b.cost, 0)
    }
  }
}

/** 将 token 数格式化为可读字符串 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** 格式化费用 */
function fmtCost(cost: number, currency = '$'): string {
  if (cost === 0) return '—'
  if (cost < 0.001) return `<${currency}0.001`
  return `${currency}${cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2)}`
}

// ─── 组件 ─────────────────────────────────────────────

const TokenMonitorButton: React.FC = () => {
  // 从 store 获取当前 assistant 和 model（取第一个 assistant）
  const assistants = useAppSelector((state: RootState) => state.assistants?.assistants || [])
  const assistant = useMemo(() => assistants[0] || null, [assistants])
  const model = assistant?.model || null

  const modelId = model?.id || ''
  const [records, setRecords] = useState<DayRecord[]>(() => loadRecords(modelId))

  // 模型切换时重新加载对应模型的用量记录
  useEffect(() => {
    setRecords(loadRecords(modelId))
    if (modelId) {
      logger.info(`Token monitor switched to model: ${model?.name || modelId}`)
    }
  }, [modelId, model?.name])

  // 监听消息完成事件，自动累计 token（按当前模型独立存储）
  useEffect(() => {
    if (!modelId) return
    const handler = (event: {
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }) => {
      const usage = event?.usage
      if (!usage) return

      const prompt = usage.prompt_tokens ?? 0
      const completion = usage.completion_tokens ?? 0
      let cost = 0
      if (model?.pricing) {
        cost =
          (prompt * (model.pricing.input_per_million_tokens || 0) +
            completion * (model.pricing.output_per_million_tokens || 0)) /
          1_000_000
      }

      setRecords((prev) => {
        const today = todayStr()
        const existing = prev.findIndex((r) => r.date === today)
        const next = [...prev]
        if (existing >= 0) {
          next[existing] = {
            ...next[existing],
            prompt: next[existing].prompt + prompt,
            completion: next[existing].completion + completion,
            cost: next[existing].cost + cost
          }
        } else {
          next.push({ date: today, prompt, completion, cost })
        }
        // 只保留最近 90 天
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 90)
        const cutoffStr = cutoff.toISOString().slice(0, 10)
        const filtered = next.filter((r) => r.date >= cutoffStr)
        saveRecords(modelId, filtered)
        return filtered
      })
    }

    const unsubscribe = EventEmitter.on(EVENT_NAMES.MESSAGE_COMPLETE, handler)
    return () => {
      if (typeof unsubscribe === 'function') {
        ;(unsubscribe as () => void)()
      } else if (unsubscribe && typeof (unsubscribe as any).then === 'function') {
        ;(unsubscribe as Promise<() => void>).then((fn) => fn())
      }
    }
  }, [modelId])

  const stats = useMemo(() => computeStats(records), [records])
  const currency = model?.pricing?.currencySymbol || '$'

  // 模型是否配置了定价
  const hasPricing =
    model?.pricing && (model.pricing.input_per_million_tokens > 0 || model.pricing.output_per_million_tokens > 0)

  const popoverContent = (
    <PopoverContent>
      <div className="header">
        <span className="model-name">{model?.name || '未选择模型'}</span>
      </div>

      <SectionTitle>今日用量</SectionTitle>
      <Row>
        <span>Prompt</span>
        <span className="val">{fmtTokens(stats.today.prompt)}</span>
      </Row>
      <Row>
        <span>Completion</span>
        <span className="val">{fmtTokens(stats.today.completion)}</span>
      </Row>
      <Row>
        <span>合计</span>
        <span className="val">{fmtTokens(stats.today.prompt + stats.today.completion)}</span>
      </Row>
      {hasPricing && (
        <Row>
          <span>费用</span>
          <span className="val cost">{fmtCost(stats.today.cost, currency)}</span>
        </Row>
      )}

      <SectionTitle>本周用量 ({stats.week.days}天)</SectionTitle>
      <Row>
        <span>合计</span>
        <span className="val">{fmtTokens(stats.week.prompt + stats.week.completion)}</span>
      </Row>
      {hasPricing && (
        <Row>
          <span>费用</span>
          <span className="val cost">{fmtCost(stats.week.cost, currency)}</span>
        </Row>
      )}

      <SectionTitle>本月用量</SectionTitle>
      <Row>
        <span>合计</span>
        <span className="val">{fmtTokens(stats.month.prompt + stats.month.completion)}</span>
      </Row>
      {hasPricing && (
        <Row>
          <span>费用</span>
          <span className="val cost">{fmtCost(stats.month.cost, currency)}</span>
        </Row>
      )}

      {model?.pricing && (
        <>
          <Divider />
          <Row dim>
            <span>输入价格</span>
            <span>{fmtCost(model.pricing.input_per_million_tokens, currency)}/M</span>
          </Row>
          <Row dim>
            <span>输出价格</span>
            <span>{fmtCost(model.pricing.output_per_million_tokens, currency)}/M</span>
          </Row>
        </>
      )}
    </PopoverContent>
  )

  // 工具提示文本：显示当前 token 概况
  const tooltipTitle = model
    ? `${model.name} | 今日: ${fmtTokens(stats.today.prompt + stats.today.completion)}`
    : 'Token 监控'

  return (
    <Popover
      content={popoverContent}
      placement="topRight"
      trigger="hover"
      mouseLeaveDelay={0.15}
      arrow
      styles={{ root: { fontSize: 12 } }}>
      <Tooltip placement="top" title={tooltipTitle} mouseLeaveDelay={0} arrow>
        <MonitorButton type="button">
          <BlackHoleIcon viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
            {/* 黑洞标志：外环 + 中心吸积盘 */}
            <circle cx="12" cy="12" r="10" strokeDasharray="4 3" opacity="0.6" />
            <circle cx="12" cy="12" r="5" opacity="0.8" />
            <ellipse cx="12" cy="12" rx="7" ry="2" opacity="0.5" />
            <ellipse cx="12" cy="12" rx="2" ry="7" opacity="0.5" />
          </BlackHoleIcon>
        </MonitorButton>
      </Tooltip>
    </Popover>
  )
}

// ─── 样式 ─────────────────────────────────────────────

const MonitorButton = styled.button`
  min-width: 30px;
  height: 30px;
  font-size: 16px;
  border-radius: 50%;
  transition: all 0.3s ease;
  color: var(--color-icon);
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text-1);
  }
`

const BlackHoleIcon = styled.svg`
  transition: transform 0.6s ease;
  ${MonitorButton}:hover & {
    transform: rotate(180deg);
  }
`

const PopoverContent = styled.div`
  min-width: 220px;
  font-size: 12px;
  line-height: 1.6;

  .header {
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--color-border);
  }
  .model-name {
    font-weight: 600;
    font-size: 13px;
  }
`

const SectionTitle = styled.div`
  font-weight: 500;
  margin-top: 8px;
  margin-bottom: 2px;
  color: var(--color-text-2);
  font-size: 11px;
`

const Row = styled.div<{ dim?: boolean }>`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  opacity: ${(p) => (p.dim ? 0.5 : 1)};

  .val {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  .cost {
    color: var(--color-warning, #d48806);
  }
`

const Divider = styled.div`
  margin: 6px 0;
  height: 1px;
  background: var(--color-border);
`

export default TokenMonitorButton
