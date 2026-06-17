/**
 * ClarifyCard — 中轮转向 UI 组件
 *
 * 监听 'clarify-ask' 事件，渲染带选项的卡片，
 * 用户选择后通过 ClarifyProvider.resolveChoice 恢复模型推理。
 */
import { loggerService } from '@logger'
import { type ClarifyParams, rejectChoice, resolveChoice } from '@renderer/aiCore/utils/clarify'
import { Button, Input, Radio } from 'antd'
import { HelpCircle, Send, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('ClarifyCard')

interface ClarifyRequest {
  toolCallId: string
  question: string
  choices?: string[]
  allowFreeText?: boolean
}

export function ClarifyCard() {
  const { t } = useTranslation()
  const [request, setRequest] = useState<ClarifyRequest | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [textInput, setTextInput] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as ClarifyRequest & ClarifyParams
      logger.info('[ClarifyCard] Received clarify-ask:', detail.question)
      setRequest({
        toolCallId: detail.toolCallId,
        question: detail.question,
        choices: detail.choices,
        allowFreeText: detail.allowFreeText
      })
      setSelected(null)
      setTextInput('')
      setSubmitted(false)
    }
    window.addEventListener('clarify-ask', handler)
    return () => window.removeEventListener('clarify-ask', handler)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!request || submitted) return

    const answer = selected || textInput.trim()
    if (!answer) return

    setSubmitted(true)
    const success = resolveChoice(request.toolCallId, answer)
    if (success) {
      logger.info('[ClarifyCard] Choice resolved:', answer)
      // 短暂延迟后关闭卡片，让用户看到提交成功
      setTimeout(() => setRequest(null), 800)
    }
  }, [request, submitted, selected, textInput])

  const handleDismiss = useCallback(() => {
    if (!request) return
    rejectChoice(request.toolCallId, '用户关闭了选择面板')
    setRequest(null)
  }, [request])

  // 键盘快捷键：Enter 提交
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        handleDismiss()
      }
    },
    [handleSubmit, handleDismiss]
  )

  if (!request) return null

  const hasChoices = request.choices && request.choices.length > 0
  const canSubmit = selected || textInput.trim()

  return (
    <Overlay onClick={handleDismiss}>
      <Card ref={cardRef} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <CardHeader>
          <HeaderLeft>
            <HelpCircle size={18} />
            <HeaderTitle>需要你确认</HeaderTitle>
          </HeaderLeft>
          <CloseButton onClick={handleDismiss}>
            <X size={16} />
          </CloseButton>
        </CardHeader>

        <QuestionText>{request.question}</QuestionText>

        {hasChoices && (
          <ChoicesList>
            <Radio.Group
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value)
                setTextInput('')
              }}
              className="w-full">
              {request.choices!.map((choice) => (
                <ChoiceItem key={choice} $selected={selected === choice}>
                  <Radio value={choice}>{choice}</Radio>
                </ChoiceItem>
              ))}
            </Radio.Group>
          </ChoicesList>
        )}

        {request.allowFreeText && (
          <Input
            placeholder={hasChoices ? '或者直接输入...' : '请输入...'}
            value={textInput}
            onChange={(e) => {
              setTextInput(e.target.value)
              if (e.target.value) setSelected(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
            autoFocus={!hasChoices}
          />
        )}

        <CardFooter>
          <Button disabled={!canSubmit || submitted} type="primary" onClick={handleSubmit} icon={<Send size={14} />}>
            {submitted ? '已提交' : '确认'}
          </Button>
        </CardFooter>
      </Card>
    </Overlay>
  )
}

// ==================== Styled Components ====================

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 10500;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.15s ease;

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`

const Card = styled.div`
  width: 420px;
  max-width: 90vw;
  background: var(--color-background);
  border: 0.5px solid var(--color-border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: slideUp 0.2s ease;

  @keyframes slideUp {
    from { transform: translateY(12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-primary);
`

const HeaderTitle = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
`

const CloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--color-background-mute);
    color: var(--color-text);
  }
`

const QuestionText = styled.div`
  font-size: 15px;
  line-height: 1.5;
  color: var(--color-text);
  padding: 4px 0;
`

const ChoicesList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const ChoiceItem = styled.div<{ $selected: boolean }>`
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid ${(p) => (p.$selected ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${(p) => (p.$selected ? 'var(--color-primary-mute)' : 'transparent')};
  transition: all 0.15s ease;
  cursor: pointer;

  &:hover {
    border-color: var(--color-primary);
    background: var(--color-primary-mute);
  }
`

const CardFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
`
