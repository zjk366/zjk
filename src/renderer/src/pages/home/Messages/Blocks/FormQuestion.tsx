/**
 * FormQuestion - 解析 AI 输出的 <form_question> XML 并渲染为交互式表单
 *
 * AI 在需要收集信息时输出 XML 格式，此组件将其渲染为可点击的选项按钮或输入框，
 * 用户选择后通过 window.dispatchEvent 注入到输入框并触发发送。
 */
import { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'

interface FormQuestionData {
  type: 'single_select' | 'multi_select' | 'text_input'
  variable: string
  required: string
  progress: string
  allow_skip: string
  title: string
  question: string
  options: { value: string; description: string; free_input?: string }[]
  placeholder: string
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

    const options: { value: string; description: string; free_input?: string }[] = []
    const optionRe = /<option\s+value="([^"]*)"(?:\s+free_input="([^"]*)")?>([\s\S]*?)<\/option>/g
    let match: RegExpExecArray | null
    while ((match = optionRe.exec(xml)) !== null) {
      options.push({
        value: match[1],
        description: match[3].trim(),
        ...(match[2] ? { free_input: match[2] } : {})
      })
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

interface FormQuestionProps {
  content: string
}

const FormQuestion: React.FC<FormQuestionProps> = ({ content }) => {
  const form = useMemo(() => parseFormXml(content), [content])
  const [selected, setSelected] = useState<string[]>([])
  const [textInput, setTextInput] = useState('')
  const [submitted, setSubmitted] = useState(false)

  /** 将用户回答注入到输入框并触发发送 */
  const sendAnswer = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('form-answer', { detail: text }))
  }, [])

  const handleSingleSelect = useCallback(
    (value: string) => {
      if (submitted) return
      setSubmitted(true)
      sendAnswer(value)
    },
    [submitted, sendAnswer]
  )

  const handleMultiSelectConfirm = useCallback(() => {
    if (submitted || selected.length === 0) return
    setSubmitted(true)
    sendAnswer(selected.join('、'))
  }, [submitted, selected, sendAnswer])

  const handleTextInputConfirm = useCallback(() => {
    if (submitted || !textInput.trim()) return
    setSubmitted(true)
    sendAnswer(textInput.trim())
  }, [submitted, textInput, sendAnswer])

  const handleSkip = useCallback(() => {
    if (submitted) return
    setSubmitted(true)
    sendAnswer('跳过')
  }, [submitted, sendAnswer])

  if (!form) return null

  return (
    <Container>
      <ProgressBar>
        <ProgressFill
          style={{
            width: form.progress
              ? `${(parseInt(form.progress.split('/')[0]) / parseInt(form.progress.split('/')[1])) * 100}%`
              : '0%'
          }}
        />
      </ProgressBar>
      <FormBody>
        <FormTitle>{form.title}</FormTitle>
        <FormQuestionText>{form.question}</FormQuestionText>

        {form.type === 'single_select' && (
          <OptionsList>
            {form.options.map((opt) => (
              <OptionButton key={opt.value} onClick={() => handleSingleSelect(opt.value)} disabled={submitted}>
                <OptionValue>{opt.value}</OptionValue>
                {opt.description && <OptionDesc>{opt.description}</OptionDesc>}
              </OptionButton>
            ))}
          </OptionsList>
        )}

        {form.type === 'multi_select' && (
          <>
            <OptionsList>
              {form.options.map((opt) => (
                <CheckOption
                  key={opt.value}
                  $selected={selected.includes(opt.value)}
                  onClick={() =>
                    setSelected((prev) =>
                      prev.includes(opt.value) ? prev.filter((v) => v !== opt.value) : [...prev, opt.value]
                    )
                  }
                  disabled={submitted}>
                  <Checkbox $checked={selected.includes(opt.value)} />
                  <div>
                    <OptionValue>{opt.value}</OptionValue>
                    {opt.description && <OptionDesc>{opt.description}</OptionDesc>}
                  </div>
                </CheckOption>
              ))}
            </OptionsList>
            <ActionButton onClick={handleMultiSelectConfirm} disabled={submitted || selected.length === 0}>
              确认选择 ({selected.length})
            </ActionButton>
          </>
        )}

        {form.type === 'text_input' && !submitted && (
          <TextInputRow>
            <TextInput
              autoFocus
              placeholder={form.placeholder || '请输入...'}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTextInputConfirm()}
            />
            <ActionButton onClick={handleTextInputConfirm} disabled={!textInput.trim()} style={{ width: 'auto' }}>
              发送
            </ActionButton>
          </TextInputRow>
        )}

        {form.allow_skip === 'true' && !submitted && <SkipButton onClick={handleSkip}>跳过</SkipButton>}

        {submitted && <SubmittedHint>已提交 ✓</SubmittedHint>}
      </FormBody>
    </Container>
  )
}

// --- Styled Components ---

const Container = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  margin: 8px 0;
  background: var(--color-background-soft);
`

const ProgressBar = styled.div`
  height: 3px;
  background: var(--color-background-mute);
`

const ProgressFill = styled.div`
  height: 100%;
  background: var(--color-primary);
  transition: width 0.3s ease;
  border-radius: 0 2px 2px 0;
`

const FormBody = styled.div`
  padding: 14px 16px;
`

const FormTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
`

const FormQuestionText = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 14px;
  line-height: 1.5;
`

const OptionsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const OptionButton = styled.button<{ disabled?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  cursor: ${(p) => (p.disabled ? 'default' : 'pointer')};
  text-align: left;
  transition: all 0.15s;
  opacity: ${(p) => (p.disabled ? 0.5 : 1)};
  &:hover:not(:disabled) {
    border-color: var(--color-primary);
    background: var(--color-primary-mute);
  }
`

const CheckOption = styled.button<{ $selected: boolean; disabled?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid ${(p) => (p.$selected ? 'var(--color-primary)' : 'var(--color-border)')};
  border-radius: 8px;
  background: ${(p) => (p.$selected ? 'var(--color-primary-mute)' : 'var(--color-background)')};
  cursor: ${(p) => (p.disabled ? 'default' : 'pointer')};
  text-align: left;
  transition: all 0.15s;
  opacity: ${(p) => (p.disabled ? 0.5 : 1)};
`

const Checkbox = styled.div<{ $checked: boolean }>`
  width: 18px;
  height: 18px;
  min-width: 18px;
  border-radius: 4px;
  border: 2px solid ${(p) => (p.$checked ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${(p) => (p.$checked ? 'var(--color-primary)' : 'transparent')};
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  &::after {
    content: '✓';
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    display: ${(p) => (p.$checked ? 'block' : 'none')};
  }
`

const OptionValue = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
`

const OptionDesc = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  line-height: 1.4;
`

const ActionButton = styled.button<{ disabled?: boolean }>`
  margin-top: 10px;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 8px;
  background: ${(p) => (p.disabled ? 'var(--color-background-mute)' : 'var(--color-primary)')};
  color: ${(p) => (p.disabled ? 'var(--color-text-3)' : '#fff')};
  font-size: 13px;
  font-weight: 500;
  cursor: ${(p) => (p.disabled ? 'default' : 'pointer')};
`

const TextInputRow = styled.div`
  display: flex;
  gap: 8px;
`

const TextInput = styled.input`
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 14px;
  outline: none;
  &:focus {
    border-color: var(--color-primary);
  }
`

const SkipButton = styled.button`
  margin-top: 8px;
  padding: 6px;
  width: 100%;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-3);
  font-size: 12px;
  cursor: pointer;
  &:hover {
    color: var(--color-text);
  }
`

const SubmittedHint = styled.div`
  text-align: center;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 500;
  padding: 8px;
`

export default FormQuestion
