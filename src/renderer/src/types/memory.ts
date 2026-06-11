/** 记忆库数据类型定义 */

/** 单条记忆 */
export interface Memory {
  /** 唯一 ID */
  id: string
  /** 关联的话题 ID */
  topicId: string
  /** 记忆摘要 */
  summary: string
  /** 关键词 */
  keywords: string[]
  /** 创建时间 */
  createdAt: string
  /** 最后提及时间 */
  lastReferencedAt: string
  /** 是否已删除（放入垃圾桶） */
  isDeleted: boolean
  /** 删除时间 */
  deletedAt?: string
  /** 过期时间（超过此时间未提及则自动垃圾桶） */
  expiresAt?: string
  /** 来源（哪个助手的对话） */
  sourceAssistantName: string
}

/** 记忆库统计数据 */
export interface MemoryStats {
  total: number
  active: number
  trashed: number
}

/** 原始对话记录（每次对话后保存） */
export interface ConversationLog {
  id: string
  topicId: string
  userContent: string
  assistantContent: string
  createdAt: string
}

/** 记忆清理策略 */
export const MEMORY_CONFIG = {
  /** 默认过期天数（7天未提及自动垃圾桶） */
  DEFAULT_EXPIRE_DAYS: 7,
  /** 垃圾桶保留天数（30天后永久删除） */
  TRASH_RETENTION_DAYS: 30,
  /** 关键词提取最大数量 */
  MAX_KEYWORDS: 10,
  /** 摘要最大长度 */
  MAX_SUMMARY_LENGTH: 800,
}
