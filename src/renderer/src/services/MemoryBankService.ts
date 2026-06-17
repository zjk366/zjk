/**
 * 记忆库服务（MemoryBank）
 *
 * 每次对话完成后保存原始对话记录，启动 3 分钟无操作计时器。
 * 超时后将所有记录交给 AI 精炼总结，保存到记忆库。
 */
import { loggerService } from '@logger'
import db from '@renderer/databases'
import { fetchGenerate } from '@renderer/services/ApiService'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import type { ConversationLog, Memory } from '@renderer/types/memory'
import { MEMORY_CONFIG } from '@renderer/types/memory'

const logger = loggerService.withContext('MemoryBankService')

class MemoryBankService {
  private static instance: MemoryBankService
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  /** 对话中不断精炼的草稿总结计时器 */
  private draftTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false
  private activeTopicId: string | null = null
  /** 记录草稿总结时已处理了多少条日志 */
  private lastDraftLogCount = 0
  /** 当前会话 ID（每次启动生成） */
  private sessionId = ''

  static getInstance(): MemoryBankService {
    if (!MemoryBankService.instance) {
      MemoryBankService.instance = new MemoryBankService()
    }
    return MemoryBankService.instance
  }

  setActiveTopicId(topicId: string | null): void {
    this.activeTopicId = topicId
  }

  // ---- 初始化/销毁 ----

  init(): void {
    if (this.initialized) return
    this.initialized = true
    this.sessionId = `session_${Date.now()}`

    // 每次对话完成 → 保存原始记录 + 触发草稿精炼
    EventEmitter.on(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)

    // 启动时：处理遗留未完成的草稿 + 去重
    void this.startupCleanup()

    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('beforeunload', this.onBeforeUnload)

    this.startCleanupTimer()
    logger.info('MemoryBankService initialized')
  }

  destroy(): void {
    EventEmitter.off(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    this.clearDraftTimer()
    this.stopCleanupTimer()
    this.initialized = false
  }

  /** 启动时：合并上次会话记忆 + 处理遗留草稿 */
  private async startupCleanup(): Promise<void> {
    try {
      const table = db.table<Memory>('memories')

      // 1) 检查是否有未定稿的草稿 → 定稿为不可修改记录
      const all = await table.toArray()
      const draft = all.find((m) => m.topicId === '__draft__' && !m.isDeleted)
      if (draft) {
        logger.info(`Finalizing draft memory from previous session...`)
        await table.update(draft.id, {
          topicId: this.sessionId,
          // 定稿后不再设置 expiresAt，改为依赖 lastReferencedAt
          lastReferencedAt: draft.lastReferencedAt || draft.createdAt
        })
        this.debounceSyncToDisk()
      }

      // 2) 处理遗留日志 → 重新开始草稿精炼
      const pendingLogs: ConversationLog[] = await db.table('conversation_logs').toArray()
      if (pendingLogs.length > 0) {
        logger.info(`Found ${pendingLogs.length} pending log(s), starting new draft...`)
        this.lastDraftLogCount = 0
        await this.updateDraft()
      }

      // 4) 去重合并
      await this.deduplicateMemories()
    } catch (err) {
      logger.error('Failed startup cleanup:', err)
    }
  }

  /** 合并关键词重叠的相似记忆（启动时执行） */
  private async deduplicateMemories(): Promise<void> {
    try {
      const table = db.table<Memory>('memories')
      const all = (await table.toArray()).filter((m) => !m.isDeleted)
      if (all.length <= 1) return

      const toDelete = new Set<string>()

      for (let i = 0; i < all.length; i++) {
        if (toDelete.has(all[i].id)) continue
        for (let j = i + 1; j < all.length; j++) {
          if (toDelete.has(all[j].id)) continue
          // 检查关键词是否有重叠
          const overlap = all[i].keywords.some((ka) => all[j].keywords.some((kb) => ka.includes(kb) || kb.includes(ka)))
          if (!overlap) continue

          // 合并：保留最新的（createdAt 更新的那条），丢弃旧的
          const [newer, older] =
            new Date(all[i].createdAt) > new Date(all[j].createdAt) ? [all[i], all[j]] : [all[j], all[i]]

          const mergedKeywords = [...new Set([...newer.keywords, ...older.keywords])].slice(
            0,
            MEMORY_CONFIG.MAX_KEYWORDS
          )

          await table.update(newer.id, {
            summary: newer.summary, // 保留最新的摘要
            keywords: mergedKeywords,
            lastReferencedAt: new Date().toISOString()
          })
          toDelete.add(older.id)
        }
      }

      // 删除被合并的旧记忆
      if (toDelete.size > 0) {
        await Promise.all([...toDelete].map((id) => table.delete(id)))
        this.debounceSyncToDisk()
        logger.info(`Merged ${toDelete.size} duplicate memory/ies`)
      }
    } catch (err) {
      logger.error('Failed to deduplicate memories:', err)
    }
  }

  // ============================================================
  //  第一步：每次对话 → 保存原始对话记录 + 重置闲置计时器
  // ============================================================

  private onMessageComplete = async (data: { id: string; topicId: string; status: string }) => {
    if (data.status !== 'success') return

    // 保存原始对话记录
    try {
      const topicRecord = await db.topics.get(data.topicId)
      if (!topicRecord?.messages || topicRecord.messages.length < 2) return

      const msgs = topicRecord.messages
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
      if (!lastUser || !lastAssistant) return

      // 从 message_blocks 表提取消息文本
      const getContent = async (msgId: string): Promise<string> => {
        try {
          const blocks: any[] = await db.table('message_blocks').where('messageId').equals(msgId).toArray()
          return blocks
            .filter((b) => b.type === 'main_text')
            .map((b) => b.content || '')
            .join('\n')
            .trim()
        } catch {
          return ''
        }
      }

      const userContent = await getContent(lastUser.id)
      const assistantContent = await getContent(lastAssistant.id)
      if (!userContent && !assistantContent) return

      // 去重：检查是否已经保存过该条 assistant 消息
      const existing = await db.table('conversation_logs').where('topicId').equals(data.topicId).toArray()
      if (existing.some((l) => l.id?.includes(lastAssistant.id?.slice(0, 8) || ''))) return

      await db.table('conversation_logs').add({
        id: `log_${lastAssistant.id?.slice(0, 8) || ''}_${Date.now()}`,
        topicId: data.topicId,
        userContent: userContent.slice(0, 10000),
        assistantContent: assistantContent.slice(0, 10000),
        createdAt: new Date().toISOString()
      } as ConversationLog)

      // 触发草稿精炼（30 秒防抖）
      this.scheduleDraft()
    } catch (err) {
      logger.error('Failed to save conversation log:', err)
    }
  }

  // ============================================================
  //  草稿精炼：对话中不断更新草稿总结（30 秒防抖）
  // ============================================================

  private scheduleDraft(): void {
    this.clearDraftTimer()
    this.draftTimer = setTimeout(() => {
      void this.updateDraft()
    }, 30 * 1000) // 30 秒防抖
  }

  private clearDraftTimer(): void {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer)
      this.draftTimer = null
    }
  }

  /** 估算文本的 token 数（粗略，用于分块决策） */
  private estimateTokens(text: string): number {
    // 中英文混合粗略估算：中文 ~1.5 token/字，英文 ~0.25 token/字符
    let cn = 0
    let en = 0
    for (const ch of text) {
      if (/[\u4e00-\u9fff]/.test(ch)) cn++
      else if (ch.trim()) en++
    }
    return Math.ceil(cn * 1.5 + en * 0.25)
  }

  /**
   * 分层总结：日志过多时分块 → 各块分别总结 → 合并 → 最终总结
   * 避免单次输入过长导致模型总结不完整
   */
  private async summarizeInLayers(allLogs: ConversationLog[], model: any): Promise<string> {
    const buildText = (logs: ConversationLog[]) =>
      logs.map((l, i) => `[对话 ${i + 1}]\n[用户]: ${l.userContent}\n[助手]: ${l.assistantContent}`).join('\n\n')

    const fullText = buildText(allLogs)
    // 如果文本量不大，直接一次总结
    if (this.estimateTokens(fullText) < 3000 || allLogs.length <= 5) {
      return (
        (await fetchGenerate({
          prompt: `你是一个对话记忆总结助手。请对以下对话进行精炼总结。

严格要求输出格式：
1. 【用户信息】
2. 【技术要点】
3. 【结论/决策】

要求：总字数控制在 800 字以内，语言简洁。保留可操作的细节。

这是对话的实时总结，后续可能还有更多对话会追加进来，请在总结中注明"截至目前"。`,
          content: fullText,
          model
        })) || ''
      )
    }

    // 超过阈值：分层总结
    // 第一层：每 5 条对话分一块，各块单独总结
    const CHUNK_SIZE = 5
    const layer1: string[] = []
    for (let i = 0; i < allLogs.length; i += CHUNK_SIZE) {
      const chunk = allLogs.slice(i, i + CHUNK_SIZE)
      const chunkText = buildText(chunk)
      const chunkSummary = await fetchGenerate({
        prompt: `请对以下对话片段进行精炼总结。
要求：提取关键信息、用户需求和技术要点。控制在 300 字以内。`,
        content: chunkText,
        model
      })
      if (chunkSummary?.trim()) layer1.push(chunkSummary.trim())
    }

    if (layer1.length === 0) return ''

    // 第二层：合并各块摘要，做最终总结
    const mergedText = layer1.map((s, i) => `[部分 ${i + 1}]\n${s}`).join('\n\n')
    if (layer1.length <= 3) {
      // 块不多，直接第二次总结
      const finalSummary = await fetchGenerate({
        prompt: `你是一个对话记忆总结助手。请将以下各部分摘要合并，形成一份完整的对话总结。

严格要求输出格式：
1. 【用户信息】
2. 【技术要点】
3. 【结论/决策】

要求：总字数控制在 800 字以内，语言简洁。保留可操作的细节。`,
        content: mergedText,
        model
      })
      return finalSummary || layer1.join('\n')
    }

    // 块太多（>3），再做一层合并
    const layer2: string[] = []
    for (let i = 0; i < layer1.length; i += 3) {
      const chunk = layer1.slice(i, i + 3)
      const chunkText = chunk.map((s, j) => `[部分 ${j + 1}]\n${s}`).join('\n\n')
      const summary = await fetchGenerate({
        prompt: `请将以下各部分摘要合并为一段连贯的总结。控制在 400 字以内。`,
        content: chunkText,
        model
      })
      if (summary?.trim()) layer2.push(summary.trim())
    }

    if (layer2.length === 0) return layer1.join('\n')

    const finalText = layer2.map((s, i) => `[部分 ${i + 1}]\n${s}`).join('\n\n')
    const finalSummary = await fetchGenerate({
      prompt: `你是一个对话记忆总结助手。请将以下各部分摘要合并，形成一份完整的对话总结。

严格要求输出格式：
1. 【用户信息】
2. 【技术要点】
3. 【结论/决策】

要求：总字数控制在 800 字以内，语言简洁。保留可操作的细节。`,
      content: finalText,
      model
    })
    return finalSummary || layer2.join('\n')
  }

  /** 更新草稿记忆（读取所有 logs → 分层总结 → 保存） */
  private async updateDraft(): Promise<void> {
    try {
      const allLogs: ConversationLog[] = await db.table('conversation_logs').toArray()
      if (allLogs.length === 0) return
      if (allLogs.length <= this.lastDraftLogCount) return

      const assistant = store.getState().assistants.defaultAssistant
      const model = assistant?.model || getDefaultModel()
      if (!model) {
        const fullText = allLogs
          .map((l, i) => `[对话 ${i + 1}]\n[用户]: ${l.userContent}\n[助手]: ${l.assistantContent}`)
          .join('\n\n')
        await this.saveDraftLocally(fullText)
        this.lastDraftLogCount = allLogs.length
        return
      }

      const summary = await this.summarizeInLayers(allLogs, model)

      if (summary) {
        const fullText = allLogs
          .map((l, i) => `[对话 ${i + 1}]\n[用户]: ${l.userContent}\n[助手]: ${l.assistantContent}`)
          .join('\n\n')
        await this.saveDraft(summary, fullText)
        this.lastDraftLogCount = allLogs.length
      } else {
        const fullText = allLogs
          .map((l, i) => `[对话 ${i + 1}]\n[用户]: ${l.userContent}\n[助手]: ${l.assistantContent}`)
          .join('\n\n')
        await this.saveDraftLocally(fullText)
        this.lastDraftLogCount = allLogs.length
      }
    } catch {
      // 草稿失败不影响主流程，且 lastDraftLogCount 未更新，下次会重试
    }
  }

  /** 无模型时的本地草稿降级 */
  private async saveDraftLocally(fullText: string): Promise<void> {
    const words = fullText.split(/\s+/).slice(-100).join(' ')
    await this.saveDraft(words.slice(0, 800), fullText)
  }

  /** 保存/更新草稿记忆（topicId = __draft__ 标记为草稿） */
  private async saveDraft(summary: string, fullText: string): Promise<void> {
    if (!summary) return
    const keywords = this.extractKeywords(fullText)
    const table = db.table<Memory>('memories')
    const existing = (await table.toArray()).find((m) => m.topicId === '__draft__' && !m.isDeleted)
    const now = new Date().toISOString()

    if (existing) {
      await table.update(existing.id, { summary, keywords, lastReferencedAt: now })
    } else {
      await table.add({
        id: `draft_${Date.now()}`,
        topicId: '__draft__',
        summary,
        keywords,
        createdAt: now,
        lastReferencedAt: now,
        isDeleted: false,
        sourceAssistantName: ''
      })
    }
    // 草稿也同步到磁盘（防止崩溃丢失）
    this.debounceSyncToDisk()
  }

  /** AI 总结失败时的降级方案：本地截取摘要 */
  private async saveLocalSummary(topicId: string, logs: ConversationLog[]): Promise<void> {
    const userContents = logs.map((l) => l.userContent).filter(Boolean)
    const assistantContents = logs.map((l) => l.assistantContent).filter(Boolean)
    const summary = this.generateLocalSummary(userContents, assistantContents)
    const fullText = [...userContents, ...assistantContents].join(' ')
    await this.saveDraft(summary, fullText)
  }

  // ============================================================
  //  保存到记忆库
  // ============================================================

  private memoryDirty = false
  private syncTimer: ReturnType<typeof setTimeout> | null = null

  /** 同步所有记忆到磁盘 JSON 文件（供主进程 MCP 服务读取） */
  private async syncToDisk(): Promise<void> {
    try {
      const all = await this.getAllActive()
      const json = JSON.stringify(all, null, 2)
      // 通过 IPC 写入文件
      const filePath = await window.electron?.ipcRenderer?.invoke('memory:get-disk-path')
      if (filePath) {
        await window.api.file.write(filePath, json)
      }
    } catch {
      /* 同步到磁盘失败不影响核心功能 */
    }
  }

  /** 延迟触发磁盘同步（防抖） */
  private debounceSyncToDisk(): void {
    this.memoryDirty = true
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      void this.syncToDisk()
      this.syncTimer = null
    }, 2000)
  }

  /** 关闭时：将草稿记忆定稿为不可修改的永久记忆 */
  private async finalizeDraft(): Promise<void> {
    try {
      const table = db.table<Memory>('memories')
      const draft = (await table.toArray()).find((m) => m.topicId === '__draft__' && !m.isDeleted)
      if (!draft) return
      this.clearDraftTimer()
      // 先把草稿更新一次（拿到最新的 logs）
      await this.updateDraft()
      // 重新读取草稿（updateDraft 可能更新了它）
      const updated = await table.get(draft.id)
      if (!updated) return
      // 定稿：topicId 改为 sessionId，标记为不可修改
      // 后续 saveDraft 只查找 topicId === '__draft__'，所以不会覆盖此记录
      // 不设 expiresAt，改为依赖 lastReferencedAt 的 TTL（runCleanup 中判断）
      await table.update(draft.id, {
        topicId: this.sessionId,
        lastReferencedAt: new Date().toISOString()
      })
      // 清理已总结的日志
      await db.table('conversation_logs').clear()
      this.debounceSyncToDisk()
      logger.info(`Draft finalized as memory for session ${this.sessionId}`)
    } catch {
      /* 定稿失败下次启动再处理 */
    }
  }

  // ---- 本地降级总结 ----

  private generateLocalSummary(userContents: string[], assistantContents: string[]): string {
    const parts: string[] = []
    if (userContents.length > 0) {
      const text =
        userContents.length <= 3
          ? userContents.join('；')
          : `${userContents.slice(0, 2).join('；')}；...；${userContents[userContents.length - 1]}`
      parts.push(`用户关注: ${text.slice(0, 300)}`)
    }
    if (assistantContents.length > 0) {
      const text =
        assistantContents.length <= 2
          ? assistantContents.join('；')
          : `${assistantContents[0]}；...；${assistantContents[assistantContents.length - 1]}`
      parts.push(`回答要点: ${text.slice(0, 300)}`)
    }
    return parts.join('\n').slice(0, MEMORY_CONFIG.MAX_SUMMARY_LENGTH)
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      '一个',
      '这个',
      '那个',
      '什么',
      '怎么',
      '可以',
      '没有',
      '就是',
      '不是',
      '我们',
      '你们',
      '他们',
      '自己',
      '因为',
      '所以',
      '如果',
      '但是',
      '而且',
      '或者',
      '然后',
      '最后',
      '开始',
      '需要',
      '使用',
      '知道',
      '认为',
      '可能',
      '应该',
      '已经',
      '通过',
      '还有',
      '之后',
      '之前',
      '并且',
      '虽然',
      '以及'
    ])
    const words = text.split(/[\s，。！？、；：""''（）\(\)\[\]【】,.\!?;:()\[\]{}]+/)
    const freq: Record<string, number> = {}
    for (const w of words) {
      const word = w.trim()
      if (word.length < 2 || /^\d+$/.test(word) || stopWords.has(word)) continue
      freq[word] = (freq[word] || 0) + 1
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MEMORY_CONFIG.MAX_KEYWORDS)
      .map(([w]) => w)
  }

  // ---- 关闭/切后台时保存 ----

  /** 切后台时：定稿草稿（如果用户不回来） */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      void this.finalizeDraft()
    }
  }

  /** 关闭时：定稿草稿（来不及的话下次启动处理） */
  private onBeforeUnload = (): void => {
    this.clearDraftTimer()
    // 尽力定稿
    void this.finalizeDraft()
  }

  /** 保存当前活跃话题的最新一条对话 */
  private async saveLatestConversationLog(): Promise<void> {
    if (!this.activeTopicId) return
    try {
      const topicRecord = await db.topics.get(this.activeTopicId)
      if (!topicRecord?.messages || topicRecord.messages.length < 2) return
      const msgs = topicRecord.messages
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
      if (!lastUser || !lastAssistant) return
      const existing = await db.table('conversation_logs').where('topicId').equals(this.activeTopicId).toArray()
      if (existing.some((l) => l.id?.includes(lastAssistant.id?.slice(0, 8) || ''))) return
      const getContent = async (msgId: string): Promise<string> => {
        try {
          const blocks: any[] = await db.table('message_blocks').where('messageId').equals(msgId).toArray()
          return blocks
            .filter((b) => b.type === 'main_text')
            .map((b) => b.content || '')
            .join('\n')
            .trim()
        } catch {
          return ''
        }
      }
      const userContent = await getContent(lastUser.id)
      const assistantContent = await getContent(lastAssistant.id)
      if (!userContent && !assistantContent) return
      await db.table('conversation_logs').add({
        id: `log_${lastAssistant.id?.slice(0, 8) || ''}_${Date.now()}`,
        topicId: this.activeTopicId,
        userContent: userContent.slice(0, 10000),
        assistantContent: assistantContent.slice(0, 10000),
        createdAt: new Date().toISOString()
      } as ConversationLog)
    } catch {
      /* 关闭时尽力保存 */
    }
  }

  // ---- CRUD (公开) ----

  async getAllActive(): Promise<Memory[]> {
    const all: Memory[] = await db.table('memories').toArray()
    return all
      .filter((m) => !m.isDeleted)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  async getAllTrashed(): Promise<Memory[]> {
    const all: Memory[] = await db.table('memories').toArray()
    return all
      .filter((m) => m.isDeleted)
      .sort((a, b) => new Date(b.deletedAt || b.createdAt).getTime() - new Date(a.deletedAt || a.createdAt).getTime())
  }

  async trash(id: string): Promise<void> {
    await db.table('memories').update(id, { isDeleted: true, deletedAt: new Date().toISOString() })
  }

  async restore(id: string): Promise<void> {
    await db.table('memories').update(id, { isDeleted: false, deletedAt: undefined })
  }

  async permanentlyDelete(id: string): Promise<void> {
    await db.table('memories').delete(id)
  }

  /** 一键清空垃圾桶中的所有记忆 */
  async clearTrash(): Promise<number> {
    const trashed = await this.getAllTrashed()
    const ids = trashed.map((m) => m.id)
    if (ids.length === 0) return 0
    const table = db.table('memories')
    await Promise.all(ids.map((id) => table.delete(id)))
    return ids.length
  }

  async search(keyword: string): Promise<Memory[]> {
    const all = await this.getAllActive()
    const kw = keyword.toLowerCase()
    return all.filter(
      (m) => m.summary.toLowerCase().includes(kw) || m.keywords.some((k) => k.toLowerCase().includes(kw))
    )
  }

  // ---- 定时清理 ----

  private startCleanupTimer(): void {
    this.runCleanup()
    this.cleanupTimer = setInterval(() => this.runCleanup(), 6 * 60 * 60 * 1000)
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private async runCleanup(): Promise<void> {
    try {
      const now = Date.now()
      const all: Memory[] = await db.table('memories').toArray()
      const oneDay = 24 * 60 * 60 * 1000
      for (const m of all) {
        // 基于 lastReferencedAt 判断：一周未提及则移入垃圾桶
        if (!m.isDeleted && m.lastReferencedAt) {
          const lastRef = new Date(m.lastReferencedAt).getTime()
          if (now - lastRef > MEMORY_CONFIG.DEFAULT_EXPIRE_DAYS * oneDay) {
            await this.trash(m.id)
          }
        }
        // 垃圾桶中的记录超过保留期则永久删除
        if (
          m.isDeleted &&
          m.deletedAt &&
          now - new Date(m.deletedAt).getTime() > MEMORY_CONFIG.TRASH_RETENTION_DAYS * oneDay
        ) {
          await this.permanentlyDelete(m.id)
        }
      }
    } catch (err) {
      logger.error('Cleanup error:', err)
    }
  }
}

export default MemoryBankService
