import type { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'

import CollectInfoForm from './CollectInfoForm'
import { MessageAgentTools } from './MessageAgentTools'
import { AgentToolsType } from './MessageAgentTools/types'
import { MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import { MessageMemorySearchToolTitle } from './MessageMemorySearch'
import { MessageWebSearchToolTitle } from './MessageWebSearch'

const ASK_USER_TOOL = 'ask_user'
const COLLECT_INFO_TOOL = 'collect_missing_info'

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

  // ask_user — 清除表单显示，不渲染任何 UI。
  // AI 的问題直接以文字形式出现在消息中，用户在普通输入框打字回答，
  // 像 ChatGPT/Claude 那样自然的文本对话流程。
  if (toolName === ASK_USER_TOOL) {
    return null
  }

  // collect_missing_info — 智能信息补全表单
  if (toolName === COLLECT_INFO_TOOL) {
    const rawResponse =
      typeof toolResponse.response === 'string'
        ? toolResponse.response
        : toolResponse.response
          ? JSON.stringify(toolResponse.response)
          : undefined

    const isPending = rawResponse === '__COLLECT_PENDING__' || rawResponse?.includes?.('__COLLECT_PENDING__')
    const isBlocked = rawResponse === '__COLLECT_BLOCKED__' || rawResponse?.includes?.('__COLLECT_BLOCKED__')
    if (isBlocked) return null

    return (
      <CollectInfoForm
        toolCallId={toolResponse.toolCallId || toolResponse.id}
        resultText={isPending ? undefined : rawResponse}
      />
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

// const PrepareToolWrapper = styled.span`
//   display: flex;
//   align-items: center;
//   gap: 4px;
//   font-size: 14px;
//   padding-left: 0;
// `
