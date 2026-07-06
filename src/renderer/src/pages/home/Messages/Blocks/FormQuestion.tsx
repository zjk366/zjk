/**
 * FormQuestion — 解析 AI 输出的 <form_question> XML 并渲染为交互式表单集
 *
 * 多个表单时逐个展示，用户填完一个后再出现下一个。
 * 所有表单都填完后一次性提交给 AI。
 *
 * 三种模式：
 * - single_select：选项列表 + 自定义输入，点选后需点提交
 * - multi_select：多选勾选 + 自定义输入，需点提交
 * - text_input：输入框 + 发送按钮
 */
import { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'

// ==================== 类型定义 ====================

interface FormQuestionData {
  type: 'single_select' | 'multi_select' | 'text_input'
  variable: string
  required: string
  progress: string
  allow_skip: string
  title: string
  question: string
  options: { value: string; description: string }[]
  placeholder: string
}

/** 提取内容中所有 <form_question> XML 并解析，自动去重 */
function extractForms(text: string): FormQuestionData[] {
  const results: FormQuestionData[] = []
  const seenVariables = new Set<string>()
  const re = /<form_question[\s\S]*?<\/form_question>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const parsed = parseFormXml(match[0])
    if (parsed && !seenVariables.has(parsed.variable)) {
      seenVariables.add(parsed.variable)
      results.push(parsed)
    }
  }
  return results
}

function parseFormXml(xml: string): FormQuestionData | null {
  try {
    const getTag = (tag: string): string => {
      const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
      return m ? m[1].trim() : ''
    }
    const typeMatch = xml.match(/type="([^"]+)"/)
    const variableMatch = xml.match(/variable="([^"]+)"/)
    const requiredMatch = xml.match(/required="([^"]+)"/)
    const progressMatch = xml.match(/progress="([^"]+)"/)
    const allowSkipMatch = xml.match(/allow_skip="([^"]+)"/)

    const options: { value: string; description: string }[] = []
    const optionRe = /<option\s+value="([^"]*)"?>([\s\S]*?)<\/option>/g
    let m: RegExpExecArray | null
    while ((m = optionRe.exec(xml)) !== null) {
      options.push({ value: m[1], description: m[2].trim() })
    }

    return {
      type: (typeMatch?.[1] as any) || 'single_select',
      variable: variableMatch?.[1] || '',
      required: requiredMatch?.[1] || 'true',
      progress: progressMatch?.[1] || '',
      allow_skip: allowSkipMatch?.[1] || 'false',
      title: getTag('title'),
      question: getTag('question'),
      options,
      placeholder: getTag('placeholder')
    }
  } catch {
    return null
  }
}

// 每个 FormQuestionSet 独立管理自身状态，不跨消息共享。
// 之前使用模块级 Map 导致不同消息间表单状态串扰：
// AI 在新消息中生成的表单会被之前消息的已提交状态污染，直接显示"已提交 ✓"。
// 移除模块级持久化，每个实例的 useState 完全自洽。

// ==================== 每个表单的本地状态 ====================

interface FormLocalState {
  selected: string | null
  multiSelected: string[]
  textInput: string
  showCustom: boolean
}

function emptyFormState(): FormLocalState {
  return { selected: null, multiSelected: [], textInput: '', showCustom: false }
}

// ==================== 主组件：FormQuestionSet ====================

interface FormQuestionSetProps {
  content: string
}

/**
 * 渲染一组 <form_question> 表单，逐个展示，全部填完后统一提交
 */
export function FormQuestionSet({ content }: FormQuestionSetProps) {
  const forms = useMemo(() => extractForms(content), [content])
  const [states, setStates] = useState<FormLocalState[]>(() => forms.map(() => emptyFormState()))
  const [allSubmitted, setAllSubmitted] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [transitionDir, setTransitionDir] = useState<'next' | 'prev' | null>(null)

  // 已收集的所有答案
  const [allAnswers, setAllAnswers] = useState<string[]>(() => forms.map(() => ''))

  // 进度文本
  const progressText =
    forms.length > 1 && currentIndex < forms.length ? `问题 ${currentIndex + 1} / ${forms.length}` : ''

  // 更新第 i 个表单的状态
  const updateState = useCallback((idx: number, patch: Partial<FormLocalState>) => {
    setStates((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }, [])

  // 收集当前表单的答案
  const collectCurrentAnswer = useCallback((): string => {
    const i = currentIndex
    const form = forms[i]
    const s = states[i]
    if (!form) return ''
    let answer = ''
    if (form.type === 'single_select') {
      answer = s.showCustom && s.textInput.trim() ? s.textInput.trim() : s.selected || ''
    } else if (form.type === 'multi_select') {
      const parts = [...s.multiSelected]
      if (s.textInput.trim()) parts.push(s.textInput.trim())
      answer = parts.join('、')
    } else {
      answer = s.textInput.trim()
    }
    return answer
  }, [currentIndex, forms, states])

  // 当前是否有答案
  const hasCurrentAnswer = useMemo(() => {
    if (currentIndex >= forms.length) return false
    const s = states[currentIndex]
    if (!s) return false
    const form = forms[currentIndex]
    if (!form) return false
    if (form.type === 'single_select') return !!(s.selected || (s.showCustom && s.textInput.trim()))
    if (form.type === 'multi_select') return s.multiSelected.length > 0 || s.textInput.trim().length > 0
    return s.textInput.trim().length > 0
  }, [currentIndex, forms, states])

  // 提交当前表单
  const handleSubmitCurrent = useCallback(() => {
    if (allSubmitted || currentIndex >= forms.length) return
    const answer = collectCurrentAnswer()
    const form = forms[currentIndex]
    if (!answer && form?.required !== 'false') return
    if (!form) return

    // 保存答案
    const newAnswers = [...allAnswers]
    newAnswers[currentIndex] = answer || '(跳过)'
    setAllAnswers(newAnswers)

    // 检查是否还有下一个表单
    const nextIndex = currentIndex + 1
    if (nextIndex < forms.length) {
      // 过渡动画方向
      setTransitionDir('next')
      setTimeout(() => setCurrentIndex(nextIndex), 50)
    } else {
      // 所有表单都已完成 → 统一提交
      setAllSubmitted(true)
      const combined = newAnswers
        .map((a, i) => (a ? `${forms[i].variable}: ${a}` : ''))
        .filter(Boolean)
        .join('\n')
      window.dispatchEvent(new CustomEvent('form-answer', { detail: `[用户回答]:\n${combined}` }))
    }
  }, [allSubmitted, currentIndex, forms, collectCurrentAnswer, allAnswers])

  // 回车提交
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isPropagationStopped() && !allSubmitted && hasCurrentAnswer) {
        e.preventDefault()
        handleSubmitCurrent()
      }
    },
    [allSubmitted, hasCurrentAnswer, handleSubmitCurrent]
  )

  // 跳过全部
  const canSkip = forms.some((f) => f.allow_skip === 'true')
  const handleSkipAll = useCallback(() => {
    if (allSubmitted) return
    setAllSubmitted(true)
    window.dispatchEvent(new CustomEvent('form-answer', { detail: '跳过' }))
  }, [allSubmitted])

  if (forms.length === 0) return null
  if (allSubmitted) {
    return <SubmittedHint>已提交 ✓</SubmittedHint>
  }

  const form = forms[currentIndex]
  if (!form) return <SubmittedHint>已提交 ✓</SubmittedHint>

  return (
    <FormSetContainer onKeyDown={handleKeyDown}>
      {/* 进度指示器 */}
      {progressText && <ProgressBar>{progressText}</ProgressBar>}

      {/* 当前表单 */}
      <FormCard $transition={transitionDir}>
        <FormTitle>{form.title || `第 ${currentIndex + 1} 项`}</FormTitle>
        <FormQuestionText>{form.question}</FormQuestionText>

        {form.type === 'single_select' && (
          <>
            <OptionsList>
              {form.options.map((opt) => (
                <OptionButton
                  key={opt.value}
                  $selected={states[currentIndex].selected === opt.value}
                  onClick={() => updateState(currentIndex, { selected: opt.value, textInput: '', showCustom: false })}
                  disabled={allSubmitted}>
                  <OptionValue>{opt.value}</OptionValue>
                  {opt.description && <OptionDesc>{opt.description}</OptionDesc>}
                </OptionButton>
              ))}
              <CustomOption
                $active={states[currentIndex].showCustom}
                onClick={() => updateState(currentIndex, { showCustom: true, selected: null })}
                disabled={allSubmitted}>
                <OptionValue>自定义...</OptionValue>
              </CustomOption>
            </OptionsList>
            {states[currentIndex].showCustom && (
              <CustomInputRow>
                <TextInput
                  autoFocus
                  placeholder="输入你的想法..."
                  value={states[currentIndex].textInput}
                  onChange={(e) => updateState(currentIndex, { textInput: e.target.value })}
                />
              </CustomInputRow>
            )}
          </>
        )}

        {form.type === 'multi_select' && (
          <>
            <OptionsList>
              {form.options.map((opt) => {
                const checked = states[currentIndex].multiSelected.includes(opt.value)
                return (
                  <CheckOption
                    key={opt.value}
                    $selected={checked}
                    onClick={() => {
                      updateState(currentIndex, {
                        multiSelected: checked
                          ? states[currentIndex].multiSelected.filter((v) => v !== opt.value)
                          : [...states[currentIndex].multiSelected, opt.value]
                      })
                    }}>
                    <Checkbox $checked={checked} />
                    <div>
                      <OptionValue>{opt.value}</OptionValue>
                      {opt.description && <OptionDesc>{opt.description}</OptionDesc>}
                    </div>
                  </CheckOption>
                )
              })}
            </OptionsList>
            <CustomInputArea>
              <CustomInputLabel>或自定义输入</CustomInputLabel>
              <TextInput
                placeholder="输入你的想法..."
                value={states[currentIndex].textInput}
                onChange={(e) => updateState(currentIndex, { textInput: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.stopPropagation()
                    handleSubmitCurrent()
                  }
                }}
              />
            </CustomInputArea>
          </>
        )}

        {form.type === 'text_input' && (
          <TextInputRow>
            <TextInput
              autoFocus
              placeholder={form.placeholder || '请输入...'}
              value={states[currentIndex].textInput}
              onChange={(e) => updateState(currentIndex, { textInput: e.target.value })}
            />
          </TextInputRow>
        )}
      </FormCard>

      {/* 操作栏 */}
      {currentIndex < forms.length && (
        <ActionBar>
          {canSkip && <SkipButton onClick={handleSkipAll}>跳过全部</SkipButton>}
          <SubmitButton onClick={handleSubmitCurrent} disabled={!hasCurrentAnswer && form.required !== 'false'}>
            {currentIndex + 1 < forms.length ? '下一步' : '提交'}
          </SubmitButton>
        </ActionBar>
      )}
    </FormSetContainer>
  )
}

// ==================== 导出兼容单个表单（内部复用 parseFormXml） ====================

/**
 * 兼容旧用法：直接传入一个 <form_question> XML 字符串
 */
export function SingleFormQuestion({ content }: { content: string }) {
  const form = useMemo(() => parseFormXml(content), [content])
  return form ? <FormQuestionSet content={content} /> : null
}

export default FormQuestionSet

// ==================== Styled Components ====================

const FormSetContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0;
`

const ProgressBar = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-3);
  text-align: center;
  padding: 4px 0;
`

const FormCard = styled.div<{ $transition?: 'next' | 'prev' | null }>`
  border: 0.5px solid var(--color-border);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--color-background-opacity);
  animation: ${(p) => (p.$transition === 'next' ? 'formSlideIn 0.25s ease-out' : 'none')};

  @keyframes formSlideIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`

const FormTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
`

const FormQuestionText = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 10px;
  line-height: 1.5;
`

const OptionsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const OptionButton = styled.button<{ $selected: boolean; disabled?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid ${(p) => (p.$selected ? 'var(--color-border)' : 'transparent')};
  border-radius: 8px;
  background: ${(p) => (p.$selected ? 'var(--color-background-soft)' : 'transparent')};
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  opacity: ${(p) => (p.disabled ? 0.5 : 1)};
  &:hover:not(:disabled) {
    background: var(--color-background-soft);
  }
`

const OptionValue = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
`

const OptionDesc = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  line-height: 1.4;
`

const CustomOption = styled.button<{ $active: boolean; disabled?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px dashed ${(p) => (p.$active ? 'var(--color-border)' : 'transparent')};
  border-radius: 8px;
  background: ${(p) => (p.$active ? 'var(--color-background-soft)' : 'transparent')};
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  opacity: ${(p) => (p.disabled ? 0.5 : 1)};
  color: var(--color-text-2);
  font-size: 13px;
  &:hover:not(:disabled) {
    background: var(--color-background-soft);
  }
`

const CheckOption = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid ${(p) => (p.$selected ? 'var(--color-border)' : 'transparent')};
  border-radius: 8px;
  background: ${(p) => (p.$selected ? 'var(--color-background-soft)' : 'transparent')};
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  &:hover {
    background: var(--color-background-soft);
  }
`

const Checkbox = styled.div<{ $checked: boolean }>`
  width: 16px;
  height: 16px;
  min-width: 16px;
  border-radius: 4px;
  border: 1.5px solid ${(p) => (p.$checked ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${(p) => (p.$checked ? 'var(--color-primary)' : 'transparent')};
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  transition: all 0.15s;
  &::after {
    content: '✓';
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: ${(p) => (p.$checked ? 'block' : 'none')};
  }
`

const TextInputRow = styled.div`
  display: flex;
  gap: 8px;
`

const CustomInputRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`

const TextInput = styled.input`
  flex: 1;
  padding: 8px 12px;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 13px;
  outline: none;
  &:focus {
    border-color: var(--color-primary);
  }
`

const CustomInputArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
`

const CustomInputLabel = styled.div`
  font-size: 11px;
  color: var(--color-text-3);
  font-weight: 500;
`

const ActionBar = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`

const SubmitButton = styled.button<{ disabled?: boolean }>`
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: ${(p) => (p.disabled ? 'var(--color-background-mute)' : 'var(--color-primary)')};
  color: ${(p) => (p.disabled ? 'var(--color-text-3)' : '#fff')};
  font-size: 13px;
  font-weight: 500;
  cursor: ${(p) => (p.disabled ? 'default' : 'pointer')};
  transition: all 0.15s;
`

const SkipButton = styled.button`
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-3);
  font-size: 13px;
  cursor: pointer;
  &:hover {
    color: var(--color-text);
    background: var(--color-background-soft);
  }
`

const SubmittedHint = styled.div`
  text-align: center;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 500;
  padding: 8px;
`
