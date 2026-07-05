import type { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import styled from 'styled-components'

import AskUserInline from './AskUserInline'
import { MessageAgentTools } from './MessageAgentTools'
import { AgentToolsType } from './MessageAgentTools/types'
import { MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import { MessageMemorySearchToolTitle } from './MessageMemorySearch'
import { MessageWebSearchToolTitle } from './MessageWebSearch'

const ASK_USER_TOOL = 'ask_user'

interface Props {
  block: ToolMessageBlock
}
const builtinToolsPrefix = 'builtin_'
const agentMcpToolsPrefix = 'mcp__'
const agentTools = Object.values(AgentToolsType)

const isAgentTool = (toolName: AgentToolsType) => {
  if (agentTools.includes(toolName) || toolName.startsWith(agentMcpToolsPrefix)) {
    return true
  }
  return false
}

const ChooseTool = (toolResponse: NormalToolResponse): React.ReactNode | null => {
  let toolName = toolResponse.tool.name
  const toolType = toolResponse.tool.type

  // ask_user — 嵌入对话流的选择卡片
  if (toolName === ASK_USER_TOOL) {
    const args = toolResponse.arguments as Record<string, unknown> | undefined
    const rawResponse =
      typeof toolResponse.response === 'string'
        ? toolResponse.response
        : toolResponse.response
          ? JSON.stringify(toolResponse.response)
          : undefined
    // __ASK_USER_PENDING__ 是 waitForUserChoice 返回的占位符，
    // 表示 AI SDK 流已正常结束但用户还未回答，此时仍然显示表单而不是结果文本。
    const resultText = rawResponse === '__ASK_USER_PENDING__' ? undefined : rawResponse
    return (
      <AskUserCard>
        <AskUserInline
          toolCallId={toolResponse.toolCallId || toolResponse.id}
          args={{
            question: (args?.question as string) || '',
            choices: args?.choices as string[] | undefined,
            allowFreeText: args?.allowFreeText as boolean | undefined,
            mode: (args?.mode as 'single' | 'multiple' | 'input') || (args?.choices ? 'single' : 'input')
          }}
          resultText={resultText}
        />
      </AskUserCard>
    )
  }

  if (toolName.startsWith(builtinToolsPrefix)) {
    toolName = toolName.slice(builtinToolsPrefix.length)
    switch (toolName) {
      case 'web_search':
      case 'web_search_preview':
        return toolType === 'provider' ? null : <MessageWebSearchToolTitle toolResponse={toolResponse} />
      case 'knowledge_search':
        return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
      case 'memory_search':
        return <MessageMemorySearchToolTitle toolResponse={toolResponse} />
      default:
        return null
    }
  } else if (isAgentTool(toolName as AgentToolsType)) {
    return <MessageAgentTools toolResponse={toolResponse} />
  }
  return null
}

export default function MessageTool({ block }: Props) {
  // FIXME: 语义错误，这里已经不是 MCP tool 了,更改rawMcpToolResponse需要改用户数据, 所以暂时保留
  const toolResponse = block.metadata?.rawMcpToolResponse as NormalToolResponse

  if (!toolResponse) return null

  const toolRenderer = ChooseTool(toolResponse)

  if (!toolRenderer) return null

  return toolRenderer
}

// ── ask_user 卡片样式 ─────────────────────────────────────

const AskUserCard = styled.div`
  border: 0.5px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-opacity);
  overflow: hidden;
  margin: 8px 0;
`

// const PrepareToolWrapper = styled.span`
//   display: flex;
//   align-items: center;
//   gap: 4px;
//   font-size: 14px;
//   padding-left: 0;
// `
