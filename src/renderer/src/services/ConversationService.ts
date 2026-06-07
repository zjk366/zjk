import { loggerService } from '@logger'
import { convertMessagesToSdkMessages } from '@renderer/aiCore/prepareParams'
import type { Assistant, Message } from '@renderer/types'
import { filterAdjacentUserMessaegs, filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { ModelMessage } from 'ai'
import { findLast, isEmpty, takeRight } from 'lodash'

import { getAssistantSettings, getDefaultModel } from './AssistantService'
import {
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterErrorOnlyMessagesWithRelated,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from './MessagesService'
import MemoryBankService from './MemoryBankService'

const logger = loggerService.withContext('ConversationService')

/** 从记忆中提取与当前用户消息相关的上下文 */
async function getRelatedMemories(userMessage: string): Promise<string> {
  try {
    const service = MemoryBankService.getInstance()
    const memories = await service.search(userMessage)
    if (memories.length === 0) return ''

    // 格式化为文本
    const lines = memories.slice(0, 5).map((m, i) =>
      `[记忆 ${i + 1}] ${m.summary}`
    )
    return lines.join('\n')
  } catch { return '' }
}

export class ConversationService {
  /**
   * Applies the filtering pipeline that prepares UI messages for model consumption.
   * This keeps the logic testable and prevents future regressions when the pipeline changes.
   */
  static filterMessagesPipeline(messages: Message[], contextCount: number): Message[] {
    const messagesAfterContextClear = filterAfterContextClearMessages(messages)
    const usefulMessages = filterUsefulMessages(messagesAfterContextClear)
    // Run the error-only filter before trimming trailing assistant responses so the pair is removed together.
    const withoutErrorOnlyPairs = filterErrorOnlyMessagesWithRelated(usefulMessages)
    const withoutTrailingAssistant = filterLastAssistantMessage(withoutErrorOnlyPairs)
    const withoutAdjacentUsers = filterAdjacentUserMessaegs(withoutTrailingAssistant)
    const limitedByContext = takeRight(withoutAdjacentUsers, contextCount + 2)
    const contextClearFiltered = filterAfterContextClearMessages(limitedByContext)
    const nonEmptyMessages = filterEmptyMessages(contextClearFiltered)
    const userRoleStartMessages = filterUserRoleStartMessages(nonEmptyMessages)
    return userRoleStartMessages
  }

  static async prepareMessagesForModel(
    messages: Message[],
    assistant: Assistant
  ): Promise<{ modelMessages: ModelMessage[]; uiMessages: Message[] }> {
    const { contextCount } = getAssistantSettings(assistant)
    // This logic is extracted from the original ApiService.fetchChatCompletion
    // const contextMessages = filterContextMessages(messages)
    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    if (!lastUserMessage) {
      return {
        modelMessages: [],
        uiMessages: []
      }
    }

    const uiMessagesFromPipeline = ConversationService.filterMessagesPipeline(messages, contextCount)
    logger.debug('uiMessagesFromPipeline', uiMessagesFromPipeline)

    // Fallback: ensure at least the last user message is present to avoid empty payloads
    let uiMessages = uiMessagesFromPipeline
    if ((!uiMessages || uiMessages.length === 0) && lastUserMessage) {
      uiMessages = [lastUserMessage]
    }

    const modelMessages = await convertMessagesToSdkMessages(uiMessages, assistant.model || getDefaultModel())

    // ── 记忆注入：在首批消息前插入相关记忆作为上下文 ──────
    // 只在对话轮次较少时注入，避免重复
    if (modelMessages.length <= 4 && lastUserMessage) {
      const userText = getMainTextContent(lastUserMessage)
      const memoryContext = await getRelatedMemories(userText)
      if (memoryContext) {
        modelMessages.unshift({
          role: 'system',
          content: `以下是之前的对话记忆，可能对当前对话有帮助：\n${memoryContext}\n\n请参考这些记忆，同时注意记忆可能已不适用于当前场景。`
        })
      }
    }

    return {
      modelMessages,
      uiMessages
    }
  }

  static needsWebSearch(assistant: Assistant): boolean {
    return !!assistant.webSearchProviderId
  }

  static needsKnowledgeSearch(assistant: Assistant): boolean {
    return !isEmpty(assistant.knowledge_bases)
  }
}
