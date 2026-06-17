import { loggerService } from '@logger'
import { convertMessagesToSdkMessages } from '@renderer/aiCore/prepareParams'
import {
  DEFAULT_COMPRESSION_THRESHOLD,
  DEFAULT_CONTEXT_RESERVE_RATIO,
  getContextWindow
} from '@renderer/config/models/contextWindow'
import type { Assistant, Message } from '@renderer/types'
import { filterAdjacentUserMessaegs, filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { ModelMessage } from 'ai'
import { findLast, isEmpty, takeRight } from 'lodash'

import { getAssistantSettings, getDefaultModel } from './AssistantService'
import MemoryBankService from './MemoryBankService'
import {
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterErrorOnlyMessagesWithRelated,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from './MessagesService'
import { estimateTextTokens } from './TokenService'

// ── 压缩缓存（模块级，避免阻塞关键路径） ──
interface CompressionCacheEntry {
  summary: string
  originalText: string // 原始文本指纹，用于判断消息是否变化
  savedTokens: number
  timestamp: number
  oldMessageIds: string // 被压缩的消息 ID 列表（逗号分隔），用于判断是否需要重新压缩
}
const compressionCache = new Map<string, CompressionCacheEntry>()
const CACHE_TTL = 10 * 60 * 1000 // 10 分钟
const pendingCompressions = new Map<string, Promise<void>>()

/** 获取缓存的话题 ID */
function getTopicId(messages: Message[]): string {
  return messages[0]?.topicId || ''
}

const logger = loggerService.withContext('ConversationService')

/** 获取最近的记忆作为上下文，并更新 lastReferencedAt（用于 TTL 清理） */
async function getRecentMemoriesContext(maxCount = 5): Promise<string> {
  try {
    const service = MemoryBankService.getInstance()
    const memories = await service.getAllActive()
    if (memories.length === 0) return ''

    const now = new Date().toISOString()
    const toUse = memories.slice(0, maxCount)

    // 更新 lastReferencedAt — 记忆被引用说明用户"提到"了它，重置 TTL
    for (const m of toUse) {
      try {
        const table = (await import('@renderer/databases')).default.table('memories')
        await table.update(m.id, { lastReferencedAt: now })
      } catch {
        /* 更新失败不影响主流程 */
      }
    }

    const lines = toUse.map((m, i) => `[记忆 ${i + 1}] ${m.summary}`)
    return `以下是之前的对话记忆，可能对当前对话有帮助：\n${lines.join('\n')}\n\n请参考这些记忆，同时注意记忆可能已不适用于当前场景。`
  } catch {
    return ''
  }
}

/**
 * 估算单条消息的 token 数量（文本内容 + 角色开销）
 */
function estimateMessageTokens(message: Message, systemPromptLength: number): number {
  const text = getMainTextContent(message)
  // 每条消息还有 role 开销和 overhead（~4 tokens）
  return estimateTextTokens(text) + 4
}

/**
 * 估算整批消息的总 token 数（用于智能上下文策略）
 */
function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg, 0), 0)
}

/**
 * 获取模型可用的上下文预算
 * budget = contextWindow * (1 - reserveRatio) - outputTokens
 */
function getAvailableContextBudget(modelId: string, reserveRatio: number, outputTokens: number): number {
  const contextWindow = getContextWindow(modelId)
  const reserve = Math.floor(contextWindow * (reserveRatio / 100))
  return contextWindow - reserve - outputTokens
}

export class ConversationService {
  /**
   * 根据 token 预算从消息数组中截取尾部消息。
   * 从最新消息开始向前遍历，累积 token 数，超过预算则停止。
   * 确保始终保留最后一条 user 消息。
   */
  static takeByTokenBudget(messages: Message[], maxTokens: number): Message[] {
    if (maxTokens <= 0 || messages.length === 0) return messages

    const systemPromptLen = 0 // system prompt 单独算，不算在消息预算里
    let accumulated = 0
    const result: Message[] = []

    // 从尾部向前遍历（最新消息开始）
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const tokens = estimateMessageTokens(msg, systemPromptLen)

      if (accumulated + tokens > maxTokens && result.length > 0) {
        // 如果已经至少保留了一条消息，就截断
        // 但如果这条是最后一条 user 消息且 result 里还没有 user，必须保留
        const hasUserInResult = result.some((m) => m.role === 'user')
        if (msg.role === 'user' && !hasUserInResult) {
          result.unshift(msg)
          accumulated += tokens
        }
        break
      }

      result.unshift(msg)
      accumulated += tokens
    }

    logger.debug(
      `[DynamicContext] ${messages.length} msgs → ${result.length} msgs (${accumulated} tokens, budget ${maxTokens})`
    )
    return result
  }

  /**
   * 智能上下文策略：感知模型上下文窗口，动态决定保留多少消息。
   *
   * 相比固定 token 预算模式（takeByTokenBudget），此方法：
   * 1. 自动查询模型的实际上下文窗口大小
   * 2. 自动为输出预留空间
   * 3. 当上下文使用量低于可用预算时，保留全部消息（不浪费窗口）
   * 4. 只有当真正超限时才截断旧消息
   *
   * @param messages - 过滤后的消息列表
   * @param modelId - 模型 ID（用于查询上下文窗口）
   * @param settings - 助手设置（包含预留比例等参数）
   * @returns 截断后的消息列表
   */
  static takeBySmartContext(
    messages: Message[],
    modelId: string,
    settings: {
      contextReserveRatio?: number
      enableMaxTokens?: boolean
      maxTokens?: number
    }
  ): Message[] {
    if (messages.length === 0) return messages

    const reserveRatio = settings.contextReserveRatio ?? DEFAULT_CONTEXT_RESERVE_RATIO
    const outputTokens = settings.enableMaxTokens && settings.maxTokens ? settings.maxTokens : 4096

    // 计算可用上下文预算
    const availableBudget = getAvailableContextBudget(modelId, reserveRatio, outputTokens)
    const totalTokens = estimateTotalTokens(messages)

    logger.debug(
      `[SmartContext] model=${modelId} window=${getContextWindow(modelId)} ` +
        `total=${totalTokens} available=${availableBudget} reserve=${reserveRatio}%`
    )

    // 如果总 token 数 <= 可用预算，保留全部（不浪费窗口空间）
    if (totalTokens <= availableBudget) {
      logger.debug(
        `[SmartContext] Keeping all ${messages.length} msgs (${totalTokens} tokens ≤ ${availableBudget} budget)`
      )
      return messages
    }

    // 超限了，从旧消息开始丢弃
    logger.debug(`[SmartContext] Truncating ${messages.length} msgs from ${totalTokens} to budget ${availableBudget}`)
    return ConversationService.takeByTokenBudget(messages, availableBudget)
  }

  /**
   * Applies the filtering pipeline that prepares UI messages for model consumption.
   * This keeps the logic testable and prevents future regressions when the pipeline changes.
   *
   * 现在支持三种上下文策略：
   * 1. 固定条数（contextCount）— 保留最近 N 条
   * 2. 固定 token 预算（enableDynamicContext + maxContextTokens）— 保留直到占满预算
   * 3. 智能上下文（enableSmartContext）— 根据模型上下文窗口动态决定
   */
  static filterMessagesPipeline(
    messages: Message[],
    contextCount: number,
    enableDynamicContext?: boolean,
    maxContextTokens?: number,
    enableSmartContext?: boolean,
    modelId?: string,
    smartSettings?: {
      contextReserveRatio?: number
      enableMaxTokens?: boolean
      maxTokens?: number
    }
  ): Message[] {
    const messagesAfterContextClear = filterAfterContextClearMessages(messages)
    const usefulMessages = filterUsefulMessages(messagesAfterContextClear)
    // Run the error-only filter before trimming trailing assistant responses so the pair is removed together.
    const withoutErrorOnlyPairs = filterErrorOnlyMessagesWithRelated(usefulMessages)
    const withoutTrailingAssistant = filterLastAssistantMessage(withoutErrorOnlyPairs)
    const withoutAdjacentUsers = filterAdjacentUserMessaegs(withoutTrailingAssistant)

    // ── 上下文截断策略 ──
    const limitedByContext =
      // 优先级 1: 智能上下文（感知模型窗口）
      enableSmartContext && modelId
        ? ConversationService.takeBySmartContext(withoutAdjacentUsers, modelId, smartSettings || {})
        : // 优先级 2: 动态上下文（固定 token 预算）
          enableDynamicContext && maxContextTokens && maxContextTokens > 0
          ? ConversationService.takeByTokenBudget(withoutAdjacentUsers, maxContextTokens)
          : // 优先级 3: 固定条数
            takeRight(withoutAdjacentUsers, contextCount + 2)

    const contextClearFiltered = filterAfterContextClearMessages(limitedByContext)
    const nonEmptyMessages = filterEmptyMessages(contextClearFiltered)
    const userRoleStartMessages = filterUserRoleStartMessages(nonEmptyMessages)
    return userRoleStartMessages
  }

  /**
   * 判断当前消息是否需要触发压缩。
   * 纯本地计算，不调 LLM，不阻塞。
   */
  static shouldCompress(
    messages: Message[],
    assistant: Assistant
  ): {
    needsCompress: boolean
    oldMessages: Message[]
    newMessages: Message[]
    originalTokens: number
  } {
    const result = {
      needsCompress: false,
      oldMessages: [] as Message[],
      newMessages: [] as Message[],
      originalTokens: 0
    }

    const model = assistant.model || getDefaultModel()
    if (!model) return result

    const contextWindow = getContextWindow(model.id)
    const totalTokens = estimateTotalTokens(messages)
    const settings = getAssistantSettings(assistant)
    const threshold = (settings.compressionThreshold ?? DEFAULT_COMPRESSION_THRESHOLD) / 100

    if (totalTokens < contextWindow * threshold) return result
    if (messages.length < 4) return result

    // 检查缓存是否已经涵盖当前消息
    const topicId = getTopicId(messages)
    const cached = topicId ? compressionCache.get(topicId) : undefined
    if (cached) {
      // 用缓存中的 oldMessageIds 跟当前消息的前面部分对比
      const cachedIds = cached.oldMessageIds
      const currentIds = messages
        .slice(0, Math.min(10, messages.length))
        .map((m) => m.id)
        .join(',')
      if (currentIds.startsWith(cachedIds) && Date.now() - cached.timestamp < CACHE_TTL) {
        // 缓存仍有效，不需要重新压缩
        return result
      }
    }

    const compressCount = Math.max(2, Math.min(20, Math.floor(messages.length * 0.4)))
    result.oldMessages = messages.slice(0, compressCount)
    result.newMessages = messages.slice(compressCount)
    result.originalTokens = estimateTotalTokens(result.oldMessages)
    result.needsCompress = true
    return result
  }

  /**
   * 后台执行压缩（调 LLM），不阻塞主流程。
   * 结果存入 compressionCache，下次请求生效。
   */
  static runBackgroundCompression(
    oldMessages: Message[],
    _newMessages: Message[],
    originalTokens: number,
    assistant: Assistant
  ): void {
    const topicId = getTopicId(oldMessages)
    if (!topicId) return
    // 避免同一 topic 重复触发
    if (pendingCompressions.has(topicId)) return

    const oldContent = oldMessages
      .map((msg) => {
        const text = getMainTextContent(msg)
        const role = msg.role === 'user' ? '用户' : '助手'
        return `[${role}]: ${text}`
      })
      .join('\n\n')

    const model = assistant.model || getDefaultModel()
    if (!model) return

    const promise = (async () => {
      try {
        const { fetchGenerate } = await import('./ApiService')
        const summary = await fetchGenerate({
          prompt: `请将以下对话内容压缩为一段简洁的中文摘要。

要求：
- 提取关键信息和重要结论
- 保留技术细节和决策结果
- 忽略寒暄和无关内容
- 控制在 200 字以内

待压缩的对话：`,
          content: oldContent,
          model
        })

        const summaryText = summary?.text?.trim()
        if (!summaryText || summaryText.length < 10) return

        const summaryTokens = estimateTextTokens(summaryText) + 4
        const savedTokens = originalTokens - summaryTokens

        compressionCache.set(topicId, {
          summary: summaryText,
          originalText: oldContent.slice(0, 200),
          savedTokens,
          timestamp: Date.now(),
          oldMessageIds: oldMessages.map((m) => m.id).join(',')
        })

        logger.info(
          `[BgCompression] ${oldMessages.length} msgs: ${originalTokens}t → ${summaryTokens}t (saved ${savedTokens}t)`
        )
      } catch (err) {
        logger.warn('[BgCompression] Failed:', err as Error)
      } finally {
        pendingCompressions.delete(topicId)
      }
    })()

    pendingCompressions.set(topicId, promise)
  }

  /**
   * 从缓存中获取压缩摘要，应用压缩。
   * 不调 LLM，不阻塞。
   */
  static applyCachedCompression(
    messages: Message[],
    assistant: Assistant
  ): { summary: string; newMessages: Message[]; applied: boolean } {
    const result = { summary: '', newMessages: messages, applied: false }

    const topicId = getTopicId(messages)
    if (!topicId) return result

    const cached = compressionCache.get(topicId)
    if (!cached) return result
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      compressionCache.delete(topicId)
      return result
    }

    // 验证缓存是否仍然匹配当前消息的开头部分
    const cachedIds = cached.oldMessageIds
    const currentIds = messages.map((m) => m.id).join(',')
    if (!currentIds.startsWith(cachedIds)) {
      compressionCache.delete(topicId)
      return result
    }

    // 应用压缩：移除被缓存覆盖的旧消息
    const oldCount = cached.oldMessageIds.split(',').length
    const newMessages = messages.slice(oldCount)

    return {
      summary: cached.summary,
      newMessages: newMessages.length > 0 ? newMessages : messages,
      applied: true
    }
  }

  /**
   * 智能上下文准备：整合智能截断 + 非阻塞后台压缩
   *
   * 流程：
   * 1. 基础过滤
   * 2. 尝试应用缓存压缩摘要（不调 LLM，不阻塞）
   * 3. 检查是否需要新的压缩（纯本地计算），是则后台触发（fire-and-forget）
   * 4. 智能截断
   * 5. 摘要注入
   */
  static async prepareSmartContext(
    messages: Message[],
    assistant: Assistant
  ): Promise<{ modelMessages: ModelMessage[]; uiMessages: Message[] }> {
    const settings = getAssistantSettings(assistant)
    const model = assistant.model || getDefaultModel()
    const modelId = model?.id || ''

    // Step 1: 基础过滤
    const baseFiltered = (() => {
      const a = filterAfterContextClearMessages(messages)
      const b = filterUsefulMessages(a)
      const c = filterErrorOnlyMessagesWithRelated(b)
      const d = filterLastAssistantMessage(c)
      return filterAdjacentUserMessaegs(d)
    })()

    // Step 2: 应用缓存的压缩摘要（不调 LLM，不阻塞）
    let compressionSummary = ''
    let compressionApplied = false
    let messagesForTruncation = baseFiltered

    const cachedCompression = ConversationService.applyCachedCompression(baseFiltered, assistant)
    if (cachedCompression.applied) {
      compressionSummary = cachedCompression.summary
      compressionApplied = true
      messagesForTruncation = cachedCompression.newMessages
    }

    // Step 3: 检查是否需要触发后台压缩（非阻塞，结果下次请求生效）
    if (modelId) {
      const check = ConversationService.shouldCompress(baseFiltered, assistant)
      if (check.needsCompress) {
        ConversationService.runBackgroundCompression(
          check.oldMessages,
          check.newMessages,
          check.originalTokens,
          assistant
        )
      }
    }

    // Step 4: 智能截断
    let contextMessages = modelId
      ? ConversationService.takeBySmartContext(messagesForTruncation, modelId, settings)
      : takeRight(messagesForTruncation, settings.contextCount + 2)

    // 后处理过滤
    contextMessages = filterAfterContextClearMessages(contextMessages)
    contextMessages = filterEmptyMessages(contextMessages)
    contextMessages = filterUserRoleStartMessages(contextMessages)

    // Fallback
    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    if ((!contextMessages || contextMessages.length === 0) && lastUserMessage) {
      contextMessages = [lastUserMessage]
    }

    const modelMessages = await convertMessagesToSdkMessages(contextMessages, model || getDefaultModel())

    // Step 5: 注入缓存摘要
    if (compressionApplied && compressionSummary) {
      modelMessages.unshift({
        role: 'system',
        content: `[以下是对之前部分对话的摘要，帮助保持上下文连贯]\n${compressionSummary}`
      })
    }

    // 记忆注入（无论对话长短，始终注入最近活跃的记忆）
    // 基于 lastReferencedAt 的 TTL 确保不相关的记忆会自动淘汰
    const memoryContext = await getRecentMemoriesContext(5)
    if (memoryContext) {
      modelMessages.unshift({ role: 'system', content: memoryContext })
    }

    return { modelMessages, uiMessages: contextMessages }
  }

  static async prepareMessagesForModel(
    messages: Message[],
    assistant: Assistant
  ): Promise<{ modelMessages: ModelMessage[]; uiMessages: Message[] }> {
    // 始终使用智能上下文链路（在对话短时会回退到等效旧行为）
    return ConversationService.prepareSmartContext(messages, assistant)
  }

  static needsWebSearch(assistant: Assistant): boolean {
    return !!assistant.webSearchProviderId
  }

  static needsKnowledgeSearch(assistant: Assistant): boolean {
    return !isEmpty(assistant.knowledge_bases)
  }
}
