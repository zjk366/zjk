import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getProgress, type ProgressData } from '@renderer/services/TaskProgressService'
import type { Message } from '@renderer/types/newMessage'
import { isMessageProcessing } from '@renderer/utils/messageUtils/is'
import { Popover } from 'antd'
import { t } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components'

interface MessageTokensProps {
  message: Message
  isLastMessage?: boolean
}

/** 格式化数字为紧凑读数：12345 → 12.3K */
const fmt = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

const MessageTokens: React.FC<MessageTokensProps> = ({ message }) => {
  const isProcessing = isMessageProcessing(message)

  // 任务进度状态（基于工具调用完成情况）
  const [progress, setProgress] = useState<ProgressData>(
    () => getProgress(message.id) || { completed: 0, total: 0, percent: 0 }
  )
  const progressRef = useRef(progress)
  progressRef.current = progress

  // 轮询 progressMap，不受事件时序影响
  useEffect(() => {
    if (!isProcessing) return
    const interval = setInterval(() => {
      const p = getProgress(message.id)
      if (p) {
        const current = progressRef.current
        if (p.completed !== current.completed || p.total !== current.total) {
          setProgress(p)
        }
      }
    }, 200)
    return () => clearInterval(interval)
  }, [isProcessing, message.id])

  const locateMessage = () => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, false)
  }

  // 流式处理中显示工具执行进度
  // 采用「完成计数驱动条宽」方案：条宽 = completed × 固定像素，只增不减，
  // 避免多轮工具调用时百分比暴跌的问题
  if (isProcessing) {
    const count = progress.completed ?? 0
    const totalCount = Math.max(progress.total ?? 0, count)
    const PER_TASK_PX = 13
    const barPx = Math.min(count * PER_TASK_PX, 64)
    return (
      <ProgressMeter onClick={locateMessage}>
        <ProgressBarTrack>
          <ProgressBarFill style={{ width: `${barPx}px` }}>
            <ProgressBarGlow />
          </ProgressBarFill>
        </ProgressBarTrack>
        <ProgressLabel>{count}</ProgressLabel>
        <ProgressDetail>/ {totalCount}</ProgressDetail>
      </ProgressMeter>
    )
  }

  const getPrice = () => {
    const inputTokens = message?.usage?.prompt_tokens ?? 0
    const outputTokens = message?.usage?.completion_tokens ?? 0
    const model = message.model

    if (model?.provider === 'openrouter' && message?.usage?.cost !== undefined) {
      return message.usage.cost
    }

    if (!model || model.pricing?.input_per_million_tokens === 0 || model.pricing?.output_per_million_tokens === 0) {
      return 0
    }
    return (
      (inputTokens * (model.pricing?.input_per_million_tokens ?? 0) +
        outputTokens * (model.pricing?.output_per_million_tokens ?? 0)) /
      1000000
    )
  }

  const getPriceString = () => {
    const price = getPrice()
    if (price === 0) return ''
    const shouldShowCost = message.model?.provider === 'openrouter' || price > 0
    if (!shouldShowCost) return ''
    const currencySymbol = message.model?.pricing?.currencySymbol || '$'
    return `${currencySymbol}${price.toFixed(6)}`
  }

  if (!message.usage) return null

  const total = message.usage.total_tokens ?? 0
  const input = message.usage.prompt_tokens ?? 0
  const output = message.usage.completion_tokens ?? 0
  const price = getPriceString()
  const ratio = total > 0 ? (output / total) * 100 : 0

  let metrixs = ''
  let hasMetrics = false
  if (message?.metrics?.completion_tokens && message?.metrics?.time_completion_millsec) {
    hasMetrics = true
    metrixs = t('settings.messages.metrics', {
      time_first_token_millsec: message?.metrics?.time_first_token_millsec,
      token_speed: (message?.metrics?.completion_tokens / (message?.metrics?.time_completion_millsec / 1000)).toFixed(0)
    })
  }

  const content = (
    <Meter className="message-tokens" onClick={locateMessage}>
      {/* 能量条：输入/输出比例 */}
      <BarTrack>
        <BarFill style={{ width: `${ratio}%` }} />
        <BarGlow style={{ left: `${ratio}%` }} />
      </BarTrack>
      {/* 读数 */}
      <Readout>
        <Total>{fmt(total)}</Total>
        <Divider />
        <InLabel>↑</InLabel>
        <InValue>{fmt(input)}</InValue>
        <Divider />
        <OutLabel>↓</OutLabel>
        <OutValue>{fmt(output)}</OutValue>
        {price && (
          <>
            <Divider />
            <Cost>{price}</Cost>
          </>
        )}
      </Readout>
    </Meter>
  )

  if (message.role === 'user') {
    return content
  }

  if (message.role === 'assistant') {
    return hasMetrics ? (
      <Popover content={metrixs} placement="top" trigger="hover" styles={{ root: { fontSize: 11 } }}>
        {content}
      </Popover>
    ) : (
      content
    )
  }

  return null
}

const Meter = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-background-soft) 70%, transparent);
  border: 0.5px solid color-mix(in srgb, var(--color-border) 60%, transparent);
  cursor: pointer;
  user-select: text;
  transition: all 0.2s ease;
  position: relative;

  &:hover {
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
    box-shadow: 0 0 10px -3px var(--color-primary);
  }
`

/* ── 能量条（吸积盘输入/输出比例） ── */
const BarTrack = styled.div`
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--color-primary) 30%, transparent);
  position: relative;
  overflow: visible;
`

const BarFill = styled.div`
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-status-success));
  transition: width 0.3s ease;
  box-shadow: 0 0 4px var(--color-status-success);
`

const BarGlow = styled.div`
  position: absolute;
  top: -2px;
  width: 5px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-status-success);
  filter: blur(3px);
  opacity: 0.9;
  margin-left: -2.5px;
`

/* ── 数字读数 ── */
const Readout = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
`

const Total = styled.span`
  color: var(--color-text-1);
  font-weight: 700;
  font-size: 11px;
`

const Divider = styled.span`
  width: 1px;
  height: 9px;
  background: color-mix(in srgb, var(--color-border) 60%, transparent);
  margin: 0 3px;
`

const InLabel = styled.span`
  color: var(--color-primary);
  font-weight: 600;
  font-size: 10px;
`

const InValue = styled.span`
  color: var(--color-primary);
  font-weight: 500;
`

const OutLabel = styled.span`
  color: var(--color-status-success);
  font-weight: 600;
  font-size: 10px;
`

const OutValue = styled.span`
  color: var(--color-status-success);
  font-weight: 500;
`

const Cost = styled.span`
  color: var(--color-text-2);
  font-size: 9px;
`

// ── 任务进度条（黑洞风格，逐渐累加动画） ──

const shimmerSlide = keyframes`
  0% { transform: translateX(-100%); }
  100% { transform: translateX(500%); }
`

const glowPulse = keyframes`
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 0.9; transform: scale(1.2); }
`

const ProgressMeter = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px 3px 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-background-soft) 70%, transparent);
  border: 0.5px solid color-mix(in srgb, var(--color-status-warning, #faad14) 25%, transparent);
  cursor: pointer;
  user-select: text;
  transition: border-color 0.3s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--color-status-warning, #faad14) 50%, transparent);
  }
`

const ProgressBarTrack = styled.div`
  width: 64px;
  height: 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-status-warning, #faad14) 12%, transparent);
  position: relative;
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
`

const ProgressBarFill = styled.div`
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--color-status-warning, #faad14), var(--color-primary));
  transition: width 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  position: relative;
  overflow: visible;

  /* 外层辉光 */
  box-shadow:
    0 0 6px 1px color-mix(in srgb, var(--color-status-warning, #faad14) 35%, transparent),
    inset 0 0 2px rgba(255, 255, 255, 0.08);

  /* 流光扫描线 */
  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 24px;
    border-radius: 3px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.1) 50%,
      transparent 100%
    );
    animation: ${shimmerSlide} 2s ease-in-out infinite;
    pointer-events: none;
  }
`

const ProgressBarGlow = styled.div`
  position: absolute;
  right: -3px;
  top: 50%;
  transform: translateY(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-primary);
  filter: blur(3.5px);
  opacity: 0.7;
  animation: ${glowPulse} 1.5s ease-in-out infinite;
  pointer-events: none;
`

const ProgressLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  color: var(--color-status-warning, #faad14);
  font-variant-numeric: tabular-nums;
  min-width: 28px;
`

const ProgressDetail = styled.span`
  font-size: 10px;
  color: var(--color-text-3);
  font-variant-numeric: tabular-nums;
`

export default MessageTokens
