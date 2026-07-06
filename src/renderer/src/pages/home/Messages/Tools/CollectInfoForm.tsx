/**
 * CollectInfoForm — collect_missing_info 工具渲染组件
 *
 * 将 AI 定义的字段渲染为结构化表单，用户填写后提交。
 * 采用简洁的卡片风格，与主流智能体体验一致。
 */
import { getCollectFields, getCollectMessage, resolveCollectInfo } from '@renderer/aiCore/utils/clarify'
import { Button, Input, Radio } from 'antd'
import { Send } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

interface Props {
  toolCallId: string
  /** 当已有结果时传入 */
  resultText?: string
}

const CollectInfoForm = memo(function CollectInfoForm({ toolCallId, resultText }: Props) {
  const fields = useMemo(() => getCollectFields(toolCallId), [toolCallId])
  const message = useMemo(() => getCollectMessage(toolCallId), [toolCallId])
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  // 监听 clarify-resolved 事件切换到结果展示
  const [resolvedAnswer, setResolvedAnswer] = useState<string | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { toolCallId: string; answer: string } | undefined
      if (detail?.toolCallId === toolCallId && detail?.answer) {
        setResolvedAnswer(detail.answer)
      }
    }
    window.addEventListener('clarify-resolved', handler)
    return () => window.removeEventListener('clarify-resolved', handler)
  }, [toolCallId])

  const effectiveResultText = resultText ?? resolvedAnswer

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const canSubmit = useMemo(() => {
    if (!fields) return false
    return fields.some((f) => (values[f.key] ?? '').trim().length > 0)
  }, [fields, values])

  const handleSubmit = useCallback(() => {
    if (submitted || !fields) return
    setSubmitted(true)
    const resolved = resolveCollectInfo(toolCallId, values)
    if (!resolved) {
      const lines = Object.entries(values)
        .filter(([, v]) => v.trim())
        .map(([k, v]) => `${k}: ${v}`)
      window.dispatchEvent(new CustomEvent('form-answer', { detail: `[信息收集完成]:\n${lines.join('\n')}` }))
      window.dispatchEvent(
        new CustomEvent('clarify-resolved', { detail: { toolCallId, answer: JSON.stringify(values) } })
      )
    }
  }, [submitted, fields, toolCallId, values])

  // 无字段定义或已有结果 → 不渲染
  if (!fields || fields.length === 0) return null
  if (effectiveResultText) {
    return (
      <Container>
        {message && <MessageText>{message}</MessageText>}
        <ResultText>已确认 ✓</ResultText>
      </Container>
    )
  }

  return (
    <Container>
      {message && <MessageText>{message}</MessageText>}

      {fields.map((field) => (
        <FieldRow key={field.key}>
          <FieldLabel>{field.label}</FieldLabel>
          {field.type === 'select' && field.options ? (
            <Radio.Group
              disabled={submitted}
              value={values[field.key] ?? ''}
              onChange={(e) => setValue(field.key, e.target.value)}>
              {field.options.map((opt) => (
                <Radio key={opt} value={opt}>
                  {opt}
                </Radio>
              ))}
            </Radio.Group>
          ) : field.type === 'textarea' ? (
            <Input.TextArea
              disabled={submitted}
              placeholder={field.placeholder || `请输入${field.label}`}
              value={values[field.key] ?? ''}
              onChange={(e) => setValue(field.key, e.target.value)}
              rows={3}
            />
          ) : (
            <Input
              disabled={submitted}
              placeholder={field.placeholder || `请输入${field.label}`}
              value={values[field.key] ?? ''}
              onChange={(e) => setValue(field.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !submitted && canSubmit) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
          )}
        </FieldRow>
      ))}

      <Footer>
        <SubmitButton
          disabled={!canSubmit || submitted}
          type="primary"
          onClick={handleSubmit}
          icon={<Send size={13} />}
          size="small">
          {submitted ? '已提交' : '确认'}
        </SubmitButton>
      </Footer>
    </Container>
  )
})

export default CollectInfoForm

// ==================== Styled Components ====================

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  margin: 8px 0;
  border: 0.5px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-opacity);
`

const MessageText = styled.div`
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text);
`

const FieldRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const FieldLabel = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-2);
`

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
`

const SubmitButton = styled(Button)`
  min-width: 80px;
`

const ResultText = styled.div`
  font-size: 13px;
  color: var(--color-primary);
  font-weight: 500;
`
