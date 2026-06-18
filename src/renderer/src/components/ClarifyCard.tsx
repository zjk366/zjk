/**
 * ClarifyCard — 中轮转向 UI 组件
 *
 * 监听 'clarify-ask' 事件，渲染带选项的卡片，
 * 用户选择后通过 ClarifyProvider.resolveChoice 恢复模型推理。
 *
 * 三种选择模式：
 * - single：单选（Radio），默认预选第一项
 * - multiple：多选（Checkbox），可勾选多项
 * - input：仅输入框
 *
 * 两种展示模式：
 * - modal（默认）：全屏遮罩弹窗
 * - inline：浮动在输入框上方
 */
import { loggerService } from '@logger'
import { type ClarifyParams, rejectChoice, resolveChoice } from '@renderer/aiCore/utils/clarify'
import { Button, Checkbox, Input, Radio } from 'antd'
import { HelpCircle, Send, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

const logger = loggerService.withContext('ClarifyCard')

interface ClarifyRequest {
  toolCallId: string
  question: string
  choices?: string[]
  allowFreeText?: boolean
  mode?: 'single' | 'multiple' | 'input'
}

interface ClarifyCardProps {
  inline?: boolean
}

export function ClarifyCard({ inline = false }: ClarifyCardProps) {
  const { t } = useTranslation()
  const [request, setRequest] = useState<ClarifyRequest | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [multiSelected, setMultiSelected] = useState<string[]>([])
  const [textInput, setTextInput] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // 有效模式：优先取 mode 参数，fallback 根据是否有 choices 决定
  const effectiveMode = useMemo<'single' | 'multiple' | 'input'>(() => {
    if (request?.mode) return request.mode
    if (request?.choices?.length) return 'single'
    return 'input'
  }, [request])

  const hasChoices = request?.choices && request.choices.length > 0
  const isSingle = effectiveMode === 'single'
  const isMultiple = effectiveMode === 'multiple'
  const isInput = effectiveMode === 'input'

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as ClarifyRequest & ClarifyParams
      logger.info('[ClarifyCard] Received clarify-ask:', detail.question)
      setRequest({
        toolCallId: detail.toolCallId,
        question: detail.question,
        choices: detail.choices,
        allowFreeText: detail.allowFreeText,
        mode: detail.mode
      })
      // Single: 默认预选第一个；Multiple: 全部不选；Input: 无选中
      setSelected(detail.mode === 'multiple' ? null : detail.choices?.[0] || null)
      setMultiSelected([])
      setTextInput('')
      setSubmitted(false)
    }
    window.addEventListener('clarify-ask', handler)
    return () => window.removeEventListener('clarify-ask', handler)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!request || submitted) return

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
    resolveChoice(request.toolCallId, answer)
    logger.info('[ClarifyCard] Choice resolved:', answer)
    // 无论 resolveChoice 是否成功，都清除表单（已提交的状态不能继续交互）
    setTimeout(() => setRequest(null), 800)
  }, [request, submitted, selected, multiSelected, textInput, isMultiple, isInput])

  const handleDismiss = useCallback(() => {
    if (!request) return
    rejectChoice(request.toolCallId, '用户关闭了选择面板')
    setRequest(null)
  }, [request])

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

  // ==================== Can Submit ====================

  const canSubmit = useMemo(() => {
    if (isMultiple) return multiSelected.length > 0
    if (isInput) return textInput.trim().length > 0
    return !!(selected || textInput.trim())
  }, [isMultiple, isInput, selected, multiSelected, textInput])

  // ==================== Shared Card Content ====================

  const cardContent = request ? (
    <>
      <CardHeader>
        <HeaderLeft>
          <HelpCircle size={16} />
          <HeaderTitle>需要你确认</HeaderTitle>
        </HeaderLeft>
        <CloseButton onClick={handleDismiss}>
          <X size={14} />
        </CloseButton>
      </CardHeader>
      <QuestionText>{request.question}</QuestionText>

      {/* ===== Single Mode: Radio ===== */}
      {isSingle && hasChoices && (
        <ChoicesList>
          <Radio.Group
            disabled={submitted}
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

      {/* ===== Multiple Mode: Checkbox ===== */}
      {isMultiple && hasChoices && (
        <ChoicesList>
          {request.choices!.map((choice) => {
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

      {/* ===== Free Text Input ===== */}
      {request.allowFreeText && !isMultiple && (
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

      <CardFooter>
        <Button
          disabled={!canSubmit || submitted}
          type="primary"
          onClick={handleSubmit}
          icon={<Send size={13} />}
          size="small">
          {submitted ? '已提交' : '确认'}
        </Button>
      </CardFooter>
    </>
  ) : null

  // ==================== Inline Mode ====================

  if (inline) {
    return (
      <InlineWrapper>
        <AnimatePresence>
          {request && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}>
              <InlineCard ref={cardRef} onKeyDown={handleKeyDown}>
                {cardContent}
              </InlineCard>
            </motion.div>
          )}
        </AnimatePresence>
      </InlineWrapper>
    )
  }

  // ==================== Modal Mode ====================

  return (
    <AnimatePresence>
      {request && (
        <Overlay onClick={handleDismiss}>
          <ModalCard
            ref={cardRef}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}>
            {cardContent}
          </ModalCard>
        </Overlay>
      )}
    </AnimatePresence>
  )
}

// ==================== Styled Components ====================

// --- Shared ---

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary);
`

const HeaderTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
`

const CloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
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

const CardFooter = styled.div`
  display: flex;
  justify-content: flex-end;
`

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

// --- Modal Mode ---

const Overlay = styled(motion.div)`
  position: fixed;
  inset: 0;
  z-index: 10500;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
`

const modalCardStyles = css`
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
`

const ModalCard = styled(motion.div)`
  ${modalCardStyles}
`

// --- Inline Mode ---

const InlineWrapper = styled.div`
  width: 100%;
`

const InlineCard = styled.div`
  background: var(--color-background-opacity);
  border: 0.5px solid var(--color-border);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`
