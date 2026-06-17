import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message } from '@renderer/types/newMessage'
import { Popover } from 'antd'
import { t } from 'i18next'
import styled from 'styled-components'

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
  const locateMessage = () => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, false)
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

export default MessageTokens
