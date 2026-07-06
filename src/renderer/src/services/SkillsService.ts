/**
 * 本地技能管理服务
 */
import { loggerService } from '@logger'
import db from '@renderer/databases'
import type { LocalSkill } from '@renderer/types/localSkill'

const logger = loggerService.withContext('SkillsService')

class SkillsService {
  private static instance: SkillsService

  static getInstance(): SkillsService {
    if (!SkillsService.instance) {
      SkillsService.instance = new SkillsService()
    }
    return SkillsService.instance
  }

  /** 获取所有技能 */
  async getAll(): Promise<LocalSkill[]> {
    const all: LocalSkill[] = await db.table('local_skills').toArray()
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  /** 获取已启用的技能 */
  async getEnabled(): Promise<LocalSkill[]> {
    const all = await this.getAll()
    return all.filter((s) => s.isEnabled)
  }

  /** 切换启用/禁用 */
  async toggle(id: string): Promise<void> {
    const skill = await db.table('local_skills').get(id)
    if (!skill) return
    await db.table('local_skills').update(id, {
      isEnabled: !skill.isEnabled,
      updatedAt: new Date().toISOString()
    })
    logger.info(`Skill ${skill.name} ${skill.isEnabled ? 'disabled' : 'enabled'}`)
  }

  /** 注册新技能（同名自动覆盖），带输入安全校验 */
  async register(skill: LocalSkill): Promise<void> {
    if (!skill.name || typeof skill.name !== 'string' || skill.name.trim().length === 0) {
      logger.error('SkillsService.register: rejected empty name', { skill })
      return
    }
    if (!skill.id || typeof skill.id !== 'string') {
      logger.error('SkillsService.register: rejected invalid id', { skill })
      return
    }
    // 限制 description/tags 长度防止 IndexedDB 撑爆
    const truncated: LocalSkill = {
      ...skill,
      name: skill.name.trim(),
      description: (skill.description || '').slice(0, 2000),
      plainDescription: (skill.plainDescription || '').slice(0, 5000),
      tags: (skill.tags || []).slice(0, 20).map((t) => String(t).slice(0, 100))
    }

    const all: LocalSkill[] = await db.table('local_skills').toArray()
    const existing = all.find((s) => s.name === truncated.name)
    if (existing) {
      await db.table('local_skills').update(existing.id, {
        ...truncated,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString()
      })
      logger.info(`Skill updated: ${truncated.name}`)
    } else {
      await db.table('local_skills').add(truncated)
      logger.info(`Skill registered: ${truncated.name}`)
    }
  }

  /** 更新技能 */
  async update(id: string, updates: Partial<LocalSkill>): Promise<void> {
    await db.table('local_skills').update(id, { ...updates, updatedAt: new Date().toISOString() })
  }

  /** 删除技能 */
  async remove(id: string): Promise<void> {
    await db.table('local_skills').delete(id)
  }

  /** 搜索技能 */
  async search(keyword: string): Promise<LocalSkill[]> {
    const all = await this.getAll()
    const kw = keyword.toLowerCase()
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw) ||
        s.plainDescription.toLowerCase().includes(kw) ||
        s.tags.some((t) => t.toLowerCase().includes(kw))
    )
  }

  /**
   * 清理无效技能（删掉已不存在 MCP 服务器的自动安装技能）
   * @param activeServerNames - 当前活跃的 MCP 服务器名列表
   * @returns 删除的技能数量
   */
  async cleanupOrphaned(activeServerNames: string[]): Promise<number> {
    const all = await this.getAll()
    let removed = 0
    for (const skill of all) {
      // 只清理 MCP 自动安装来源的技能，跳过手动创建的
      if (!skill.source?.includes('MCP')) continue
      // 如果技能名不在活跃服务器列表中，说明已失效
      if (!activeServerNames.includes(skill.name)) {
        await this.remove(skill.id)
        removed++
        logger.info(`Cleaned up orphaned skill: ${skill.name}`)
      }
    }
    if (removed > 0) {
      logger.info(`Cleaned up ${removed} orphaned skill(s)`)
    }
    return removed
  }
}

export default SkillsService
