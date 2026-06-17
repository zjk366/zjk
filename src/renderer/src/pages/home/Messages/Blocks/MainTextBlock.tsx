import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { type Model } from '@renderer/types'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import { Flex } from 'antd'
import React, { useCallback } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'
import FormQuestionSet from './FormQuestion'

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
  mentions?: Model[]
  role: Message['role']
}

const MainTextBlock: React.FC<Props> = ({ block, citationBlockId, role, mentions = [] }) => {
  // Use the passed citationBlockId directly in the selector
  const { renderInputMessageAsMarkdown } = useSettings()

  const rawCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, citationBlockId))

  // 创建引用处理函数，传递给 Markdown 组件在流式渲染中使用
  const processContent = useCallback(
    (rawText: string) => {
      if (!block.citationReferences?.length || !citationBlockId || rawCitations.length === 0) {
        return rawText
      }

      // 确定最适合的 source
      const sourceType = determineCitationSource(block.citationReferences)

      return withCitationTags(rawText, rawCitations, sourceType)
    },
    [block.citationReferences, citationBlockId, rawCitations]
  )

  // 在内容中搜索 <form_question> XML
  const content = block.content || ''
  const hasFormTagOpen = content.includes('<form_question')
  const fullFormTagRe = /<form_question[\s\S]*?<\/form_question>/g
  const allFormMatches = hasFormTagOpen ? [...content.matchAll(fullFormTagRe)] : []
  const hasCompleteForms = allFormMatches.length > 0

  // 如果是纯 form_question 内容，直接渲染表单集
  if (content.trim().startsWith('<form_question')) {
    return <FormQuestionSet content={content} />
  }

  // 检测到 <form_question 但尚未完全闭合（流式加载中）
  if (hasFormTagOpen && !hasCompleteForms) {
    const formStart = content.indexOf('<form_question')
    const before = formStart > 0 ? content.slice(0, formStart).trim() : ''
    return (
      <>
        {before && <Markdown block={{ ...block, content: before }} postProcess={processContent} />}
        <FormLoadingPlaceholder />
      </>
    )
  }

  // 有完整的 form_question 标签 → 分段渲染：文本段 + 表单集合 + 文本段
  if (hasCompleteForms) {
    // 构建分段数组：每个元素是 { type: 'text' | 'form', content: string }
    const segments: { type: 'text' | 'form'; content: string }[] = []
    let lastEnd = 0
    for (const m of allFormMatches) {
      const beforeText = content.slice(lastEnd, m.index).trim()
      if (beforeText) segments.push({ type: 'text', content: beforeText })
      segments.push({ type: 'form', content: m[0] })
      lastEnd = m.index + m[0].length
    }
    const afterText = content.slice(lastEnd).trim()
    if (afterText) segments.push({ type: 'text', content: afterText })

    // 收集所有表单 XML 到一个 FormQuestionSet
    const formXmls = segments.filter((s) => s.type === 'form').map((s) => s.content)
    const joinedFormXml = formXmls.join('\n')

    return (
      <>
        {segments
          .filter((s) => s.type === 'text')
          .map((s, i) => (
            <Markdown key={i} block={{ ...block, content: s.content }} postProcess={processContent} />
          ))}
        {joinedFormXml && <FormQuestionSet content={joinedFormXml} />}
      </>
    )
  }

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
          {mentions.map((m) => (
            <MentionTag key={getModelUniqId(m)}>{'@' + m.name}</MentionTag>
          ))}
        </Flex>
      )}
      {role === 'user' && !renderInputMessageAsMarkdown ? (
        <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
          {block.content}
        </p>
      ) : (
        <Markdown block={block} postProcess={processContent} />
      )}
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

const FormLoadingPlaceholder = styled.div`
  border: 0.5px solid var(--color-border);
  border-radius: 10px;
  padding: 20px;
  margin: 8px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-text-3);
  font-size: 13px;
  min-height: 60px;
  animation: formPulse 1.5s ease-in-out infinite;

  &::after {
    content: '正在加载表单...';
  }

  @keyframes formPulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
`

export default React.memo(MainTextBlock)
