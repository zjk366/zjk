/** 本地技能类型（用于 skills 管理室） */
export interface LocalSkill {
  id: string
  name: string
  description: string
  /** 通俗解释（给普通用户看的） */
  plainDescription: string
  /** 来源（AI 生成 / 市场下载） */
  source: string
  /** 是否启用 */
  isEnabled: boolean
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
  /** 标签 */
  tags: string[]
  /** AI 生成时的对话 ID */
  topicId?: string
}
