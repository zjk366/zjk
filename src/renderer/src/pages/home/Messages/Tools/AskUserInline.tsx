/**
 * AskUserInline — 嵌入在对话消息中的 ask_user 工具交互
 *
 * AI 调用 ask_user 时，选择卡片直接渲染在工具调用消息块内部，
 * 用户在对话流中完成选择，无需弹窗或浮动卡片。
 *
 * 支持三种模式：
 * - single：单选（Radio），默认预选第一项
 * - multiple：多选（Checkbox）
 * - input：仅输入框
 */
import { resolveChoice } from '@renderer/aiCore/utils/clarify'
import { Button, Checkbox, Input, Radio } from 'antd'
import { HelpCircle, Send } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

export interface AskUserArgs {
  question: string
  choices?: string[]
  allowFreeText?: boolean
  mode?: 'single' | 'multiple' | 'input'
}

interface Props {
  toolCallId: string
  args: AskUserArgs
  /** 用户已回答后的结果文本（如 "用户选择了: xxx"） */
  resultText?: string
}

const AskUserInline = memo(function AskUserInline({ toolCallId, args, resultText }: Props) {
  const [selected, setSelected] = useState<string | null>(args.mode === 'multiple' ? null : args.choices?.[0] || null)
  const [multiSelected, setMultiSelected] = useState<string[]>([])
  const [textInput, setTextInput] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [resolvedAnswer, setResolvedAnswer] = useState<string | null>(null)

  // 监听 clarify-resolved 事件：当 AI SDK 流已结束而 tool-result 未到达时，
  // 手动将表单切换为结果展示状态
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

  // 合成 resultText：优先用 props，其次用本地 resolvedAnswer
  const effectiveResultText = resultText ?? (resolvedAnswer ? `用户选择了: ${resolvedAnswer}` : undefined)

  const effectiveMode = useMemo<'single' | 'multiple' | 'input'>(() => {
    if (args.mode) return args.mode
    if (args.choices?.length) return 'single'
    return 'input'
  }, [args])

  const hasChoices = args.choices && args.choices.length > 0
  const isSingle = effectiveMode === 'single'
  const isMultiple = effectiveMode === 'multiple'
  const isInput = effectiveMode === 'input'

  const canSubmit = isMultiple
    ? multiSelected.length > 0
    : isInput
      ? textInput.trim().length > 0
      : !!(selected || textInput.trim())

  const handleSubmit = useCallback(() => {
    if (submitted) return
    let answer: string | null = null
    if (isMultiple) {
      answer = multiSelected.length > 0 ? multiSelected.join(', ') : null
    } else if (isInput) {
      answer = textInput.trim() || null
    } else {
      answer = selected || textInput.trim() || null
    }
    if (!answer) return
    setSubmitted(true)
    const resolved = resolveChoice(toolCallId, answer)
    // 即使 resolveChoice 没找到 pending 条目（toolCallId 不匹配），
    // 也派发 form-answer 确保对话继续
    if (!resolved) {
      window.dispatchEvent(
        new CustomEvent('form-answer', {
          detail: `[用户回答]: ${answer}`
        })
      )
      // 也派发 clarify-resolved 让 UI 切换到结果展示
      window.dispatchEvent(
        new CustomEvent('clarify-resolved', {
          detail: { toolCallId, answer }
        })
      )
    }
  }, [submitted, toolCallId, isMultiple, isInput, selected, multiSelected, textInput])

  // 已得到结果 → 显示结果文本（必须在所有 hooks 之后）
  if (effectiveResultText) {
    return (
      <Container>
        <Header>
          <HelpCircle size={14} />
          <Title>{args.question}</Title>
        </Header>
        <ResultText>{effectiveResultText.replace(/^用户选择了: /, '')}</ResultText>
      </Container>
    )
  }

  return (
    <Container>
      <Header>
        <HelpCircle size={14} />
        <Title>需要你确认</Title>
      </Header>

      <QuestionText>{args.question}</QuestionText>

      {/* Single: Radio */}
      {isSingle && hasChoices && (
        <ChoicesList>
          <Radio.Group
            disabled={submitted}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value)
              setTextInput('')
            }}>
            {args.choices!.map((choice) => (
              <ChoiceItem key={choice} $selected={selected === choice}>
                <Radio value={choice}>{choice}</Radio>
              </ChoiceItem>
            ))}
          </Radio.Group>
        </ChoicesList>
      )}

      {/* Multiple: Checkbox */}
      {isMultiple && hasChoices && (
        <ChoicesList>
          {args.choices!.map((choice) => {
            const checked = multiSelected.includes(choice)
            return (
              <MultiChoiceItem
                key={choice}
                $selected={checked}
                onClick={() => {
                  if (submitted) return
                  setMultiSelected((prev) => (checked ? prev.filter((c) => c !== choice) : [...prev, choice]))
                }}>
                <Checkbox checked={checked} disabled={submitted}>
                  {choice}
                </Checkbox>
              </MultiChoiceItem>
            )
          })}
        </ChoicesList>
      )}

      {/* Free text — input 模式必须显示输入框，不受 allowFreeText 限制 */}
      {(isInput || args.allowFreeText) && !isMultiple && (
        <CustomInputArea>
          {isSingle && hasChoices && <CustomInputLabel>或自定义输入</CustomInputLabel>}
          <Input
            disabled={submitted}
            placeholder={isInput ? '请输入...' : '输入你的想法...'}
            value={textInput}
            onChange={(e) => {
              if (submitted) return
              setTextInput(e.target.value)
              if (e.target.value && isSingle) setSelected(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
            autoFocus={isInput}
          />
        </CustomInputArea>
      )}

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

export default AskUserInline

// ==================== Styled Components ====================

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary);
`

const Title = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
`

const QuestionText = styled.div`
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text);
`

const ChoicesList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ChoiceItem = styled.div<{ $selected: boolean }>`
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid ${(p) => (p.$selected ? 'var(--color-border)' : 'transparent')};
  background: ${(p) => (p.$selected ? 'var(--color-background-soft)' : 'transparent')};
  transition: all 0.15s ease;
  cursor: pointer;

  .ant-radio-wrapper {
    font-size: 13px;
  }

  &:hover {
    background: var(--color-background-soft);
  }
`

const MultiChoiceItem = styled.div<{ $selected: boolean }>`
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid ${(p) => (p.$selected ? 'var(--color-border)' : 'transparent')};
  background: ${(p) => (p.$selected ? 'var(--color-background-soft)' : 'transparent')};
  transition: all 0.15s ease;
  cursor: pointer;

  .ant-checkbox-wrapper {
    font-size: 13px;
  }

  &:hover {
    background: var(--color-background-soft);
  }
`

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
`

const SubmitButton = styled(Button)``

const CustomInputArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const CustomInputLabel = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  font-weight: 500;
`

const ResultText = styled.div`
  font-size: 14px;
  color: var(--color-text);
  padding: 4px 0;
`
