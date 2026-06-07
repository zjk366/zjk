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
import { EventEmitter, EVENT_NAMES } from '@renderer/services/EventService'
import store from '@renderer/store'
import type { ConversationLog, Memory } from '@renderer/types/memory'
import { MEMORY_CONFIG } from '@renderer/types/memory'

const logger = loggerService.withContext('MemoryBankService')

class MemoryBankService {
  private static instance: MemoryBankService
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false
  private activeTopicId: string | null = null
  /** 记录上一次保存时的对话数量，避免重复总结 */
  private lastSavedLogCount = 0

  static getInstance(): MemoryBankService {
    if (!MemoryBankService.instance) {
      MemoryBankService.instance = new MemoryBankService()
    }
    return MemoryBankService.instance
  }

  setActiveTopicId(topicId: string | null): void {
    this.activeTopicId = topicId
    this.lastSavedLogCount = 0
  }

  // ---- 初始化/销毁 ----

  init(): void {
    if (this.initialized) return
    this.initialized = true

    // 每次对话完成 → 保存原始记录 + 重置 2 分钟计时器
    EventEmitter.on(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)

    // 启动时：检查是否有未总结的日志 → 调 AI 总结（关闭时来不及做的事）
    void this.summarizePendingLogs()

    // 关闭/切后台时：只保存原始日志（不等待 AI 总结，保证关闭流畅）
    // 启动时再拿这些日志去总结
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('beforeunload', this.onBeforeUnload)

    this.startCleanupTimer()
    logger.info('MemoryBankService initialized')
  }

  destroy(): void {
    EventEmitter.off(EVENT_NAMES.MESSAGE_COMPLETE, this.onMessageComplete)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    this.clearIdleTimer()
    this.stopCleanupTimer()
    this.initialized = false
  }

  /** 启动时：检查是否有未总结的日志 → 合并为一条全局记忆 */
  private async summarizePendingLogs(): Promise<void> {
    try {
      const allLogs: ConversationLog[] = await db.table('conversation_logs').toArray()
      if (allLogs.length === 0) return
      logger.info(`Found ${allLogs.length} pending log(s), triggering global AI summary...`)
      await this.triggerAISummary('__all__')
    } catch (err) {
      logger.error('Failed to summarize pending logs:', err)
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
          const blocks: any[] = await db.table('message_blocks')
            .where('messageId').equals(msgId).toArray()
          return blocks.filter((b) => b.type === 'main_text')
            .map((b) => b.content || '').join('\n').trim()
        } catch { return '' }
      }

      const userContent = await getContent(lastUser.id)
      const assistantContent = await getContent(lastAssistant.id)
      if (!userContent && !assistantContent) return

      // 去重：检查是否已经保存过该条 assistant 消息
      const existing = await db.table('conversation_logs')
        .where('topicId').equals(data.topicId).toArray()
      if (existing.some((l) => l.id?.includes(lastAssistant.id?.slice(0, 8) || ''))) return

      await db.table('conversation_logs').add({
        id: `log_${lastAssistant.id?.slice(0, 8) || ''}_${Date.now()}`,
        topicId: data.topicId,
        userContent: userContent.slice(0, 1000),
        assistantContent: assistantContent.slice(0, 1000),
        createdAt: new Date().toISOString(),
      } as ConversationLog)

      // 重置 3 分钟闲置计时器
      this.resetIdleTimer(data.topicId)
    } catch (err) {
      logger.error('Failed to save conversation log:', err)
    }
  }

  // ============================================================
  //  闲置计时器：3 分钟无对话 → 调 AI 总结
  // ============================================================

  private resetIdleTimer(topicId: string): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      void this.triggerAISummary(topicId)
    }, 2 * 60 * 1000) // 2 分钟
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  /** 闲置超时 → 调 AI 总结所有话题对话（合并为一条全局记忆） */
  private async triggerAISummary(topicId: string): Promise<void> {
    try {
      // 读取 ALL 原始对话记录（不再按话题区分）
      const allLogs: ConversationLog[] = await db.table('conversation_logs').toArray()
      if (allLogs.length === 0) return

      // 组装对话文本
      const conversationText = allLogs.map((l, i) =>
        `[对话 ${i + 1}]\n[用户]: ${l.userContent}\n[助手]: ${l.assistantContent}`
      ).join('\n\n')

      // 获取当前模型
      const assistant = store.getState().assistants.defaultAssistant
      const model = assistant?.model || getDefaultModel()
      if (!model) {
        logger.warn('No model available for AI summary, using local summary')
        await this.saveLocalSummary('__all__', allLogs)
        return
      }

      // 调 AI 总结
      const systemPrompt = `你是一个对话记忆总结助手。请对以下所有对话进行精炼总结，提取关键信息作为长期记忆保存。

严格按要求输出：
1. 【用户信息】提取用户提到的个人偏好、项目信息、身份背景等可识别的用户画像信息
2. 【技术要点】用户关心的技术问题、解决方案、代码片段的关键思路
3. 【结论/决策】对话中达成的结论、做出的决策、待办事项

要求：总字数控制在 300 字以内，语言简洁，保留可操作的细节。
这是之前所有对话的综合，请确保覆盖所有重要信息，不要遗漏。`

      const summary = await fetchGenerate({
        prompt: systemPrompt,
        content: conversationText,
        model,
      })

      if (summary) {
        await this.saveMemory('__all__', summary, conversationText)
      } else {
        await this.saveLocalSummary('__all__', allLogs)
      }
    } catch (err) {
      logger.error('AI summary failed, using local summary:', err)
      const allLogs: ConversationLog[] = await db.table('conversation_logs').toArray()
      if (allLogs.length > 0) await this.saveLocalSummary('__all__', allLogs)
    }
  }

  /** AI 总结失败时的降级方案：本地截取摘要 */
  private async saveLocalSummary(topicId: string, logs: ConversationLog[]): Promise<void> {
    const userContents = logs.map((l) => l.userContent).filter(Boolean)
    const assistantContents = logs.map((l) => l.assistantContent).filter(Boolean)
    const summary = this.generateLocalSummary(userContents, assistantContents)
    const fullText = [...userContents, ...assistantContents].join(' ')
    await this.saveMemory(topicId, summary, fullText)
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
    } catch { /* 同步到磁盘失败不影响核心功能 */ }
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

  private async saveMemory(topicId: string, summary: string, fullText: string): Promise<void> {
    if (!summary) return

    const keywords = this.extractKeywords(fullText)
    const table = db.table<Memory>('memories')
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + MEMORY_CONFIG.DEFAULT_EXPIRE_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // 每次保存都是一条新记忆（不合并），按时间倒序排列
    // 每次软件关闭时生成一条会话总结，多次关闭就有多条记忆
    await table.add({
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      topicId, summary, keywords, createdAt: now, lastReferencedAt: now,
      isDeleted: false, expiresAt, sourceAssistantName: '',
    })

    // 同步到磁盘（供主进程 MCP 读取）
    this.debounceSyncToDisk()

    // 清除所有已总结的原始日志
    await db.table('conversation_logs').clear()
    logger.info(`Memory saved (session summary)`)
  }

  // ---- 本地降级总结 ----

  private generateLocalSummary(userContents: string[], assistantContents: string[]): string {
    const parts: string[] = []
    if (userContents.length > 0) {
      const text = userContents.length <= 3
        ? userContents.join('；')
        : `${userContents.slice(0, 2).join('；')}；...；${userContents[userContents.length - 1]}`
      parts.push(`用户关注: ${text.slice(0, 300)}`)
    }
    if (assistantContents.length > 0) {
      const text = assistantContents.length <= 2
        ? assistantContents.join('；')
        : `${assistantContents[0]}；...；${assistantContents[assistantContents.length - 1]}`
      parts.push(`回答要点: ${text.slice(0, 300)}`)
    }
    return parts.join('\n').slice(0, MEMORY_CONFIG.MAX_SUMMARY_LENGTH)
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      '一个', '这个', '那个', '什么', '怎么', '可以', '没有', '就是', '不是',
      '我们', '你们', '他们', '自己', '因为', '所以', '如果', '但是', '而且',
      '或者', '然后', '最后', '开始', '需要', '使用', '知道', '认为', '可能',
      '应该', '已经', '通过', '还有', '之后', '之前', '并且', '虽然', '以及',
    ])
    const words = text.split(/[\s，。！？、；：""''（）\(\)\[\]【】,.\!?;:()\[\]{}]+/)
    const freq: Record<string, number> = {}
    for (const w of words) {
      const word = w.trim()
      if (word.length < 2 || /^\d+$/.test(word) || stopWords.has(word)) continue
      freq[word] = (freq[word] || 0) + 1
    }
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, MEMORY_CONFIG.MAX_KEYWORDS).map(([w]) => w)
  }

  // ---- 关闭/切后台时保存 ----

  /** 切后台时：尽早开始保存（比 beforeunload 早数秒到数分钟） */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      void this.saveLatestConversationLog()
    }
  }

  /** 关闭时：尽力保存末条对话（即使没写完，对话数据也在 db.topics 中不丢失） */
  private onBeforeUnload = (): void => {
    this.clearIdleTimer()
    void this.saveLatestConversationLog()
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
      const existing = await db.table('conversation_logs')
        .where('topicId').equals(this.activeTopicId).toArray()
      if (existing.some((l) => l.id?.includes(lastAssistant.id?.slice(0, 8) || ''))) return
      const getContent = async (msgId: string): Promise<string> => {
        try {
          const blocks: any[] = await db.table('message_blocks')
            .where('messageId').equals(msgId).toArray()
          return blocks.filter((b) => b.type === 'main_text')
            .map((b) => b.content || '').join('\n').trim()
        } catch { return '' }
      }
      const userContent = await getContent(lastUser.id)
      const assistantContent = await getContent(lastAssistant.id)
      if (!userContent && !assistantContent) return
      await db.table('conversation_logs').add({
        id: `log_${lastAssistant.id?.slice(0, 8) || ''}_${Date.now()}`,
        topicId: this.activeTopicId,
        userContent: userContent.slice(0, 1000),
        assistantContent: assistantContent.slice(0, 1000),
        createdAt: new Date().toISOString(),
      } as ConversationLog)
    } catch { /* 关闭时尽力保存 */ }
  }

  // ---- CRUD (公开) ----

  async getAllActive(): Promise<Memory[]> {
    const all: Memory[] = await db.table('memories').toArray()
    return all.filter((m) => !m.isDeleted)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  async getAllTrashed(): Promise<Memory[]> {
    const all: Memory[] = await db.table('memories').toArray()
    return all.filter((m) => m.isDeleted)
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
    return all.filter((m) => m.summary.toLowerCase().includes(kw) || m.keywords.some((k) => k.toLowerCase().includes(kw)))
  }

  // ---- 定时清理 ----

  private startCleanupTimer(): void {
    this.runCleanup()
    this.cleanupTimer = setInterval(() => this.runCleanup(), 6 * 60 * 60 * 1000)
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null }
  }

  private async runCleanup(): Promise<void> {
    try {
      const now = Date.now()
      const all: Memory[] = await db.table('memories').toArray()
      const oneDay = 24 * 60 * 60 * 1000
      for (const m of all) {
        if (!m.isDeleted && m.expiresAt && now > new Date(m.expiresAt).getTime()) await this.trash(m.id)
        if (m.isDeleted && m.deletedAt && now - new Date(m.deletedAt).getTime() > MEMORY_CONFIG.TRASH_RETENTION_DAYS * oneDay)
          await this.permanentlyDelete(m.id)
      }
    } catch (err) { logger.error('Cleanup error:', err) }
  }
}

export default MemoryBankService
