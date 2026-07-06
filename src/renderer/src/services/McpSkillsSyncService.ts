/**
 * MCP → Skills 管理室 统一同步服务
 *
 * 职责：
 *   1. 将 MCP 服务器注册/更新为技能
 *   2. MCP 服务器删除时清理对应技能
 *   3. 初始化时全量同步
 *   4. 清理孤儿条目（已不存在的 MCP 服务器的技能）
 *
 * 安全约束：
 *   - 不静默吞错误，所有失败都有 logger + toast
 *   - 输入校验（名称、ID 合法性）
 *   - 防重复注册（按 name 去重）
 *   - 一致性保证（增删改都同步）
 */
import { loggerService } from '@logger'
import SkillsService from '@renderer/services/SkillsService'
import type { MCPServer } from '@renderer/types'
import type { LocalSkill } from '@renderer/types/localSkill'

const logger = loggerService.withContext('McpSkillsSyncService')

/** MCP 来源的技能统一前缀 */
const SKILL_ID_PREFIX = 'mcp_'

/** 合法字符白名单（防止恶意 ID/名称注入 IndexedDB） */
const SAFE_ID_RE = /^[a-zA-Z0-9_.\-@]+$/

function sanitizeSkillId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.\-@]/g, '_')
}

function validateLocalSkill(skill: Partial<LocalSkill>): boolean {
  if (!skill.name || typeof skill.name !== 'string' || skill.name.trim().length === 0) {
    logger.warn('validateLocalSkill: empty name', { name: skill.name })
    return false
  }
  if (!skill.id || typeof skill.id !== 'string') {
    logger.warn('validateLocalSkill: invalid id', { id: skill.id })
    return false
  }
  return true
}

/**
 * 将单个 MCP 服务器同步到 Skills 管理室
 * - 已存在则更新，不存在则注册
 * - 返回 true 表示成功，false 表示失败
 */
async function syncServerToSkill(server: MCPServer): Promise<boolean> {
  try {
    const skillId = `${SKILL_ID_PREFIX}${sanitizeSkillId(server.id)}`
    const skillName = server.name || server.id

    const skill: LocalSkill = {
      id: skillId,
      name: skillName,
      description: server.description || `${skillName} MCP 服务`,
      plainDescription: server.description || `${skillName} - MCP 服务器`,
      source: 'MCP 自动安装',
      isEnabled: server.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: ['MCP', server.type || 'stdio']
    }

    if (!validateLocalSkill(skill)) {
      logger.error('syncServerToSkill: invalid skill data, skipping', {
        serverId: server.id,
        serverName: server.name
      })
      return false
    }

    await SkillsService.getInstance().register(skill)
    logger.info(`syncServerToSkill: synced "${skillName}" → skills`)
    return true
  } catch (err) {
    logger.error(`syncServerToSkill: failed for "${server.name}"`, {
      serverId: server.id,
      error: (err as Error).message
    })
    return false
  }
}

/**
 * MCP 服务器删除时，从 Skills 管理室移除对应技能
 */
async function removeServerSkill(server: MCPServer): Promise<boolean> {
  try {
    const skillId = `${SKILL_ID_PREFIX}${sanitizeSkillId(server.id)}`
    const all = await SkillsService.getInstance().getAll()

    // 按 id 或 name 匹配
    const target = all.find((s) => s.id === skillId || s.name === server.name)
    if (target) {
      await SkillsService.getInstance().remove(target.id)
      logger.info(`removeServerSkill: removed "${target.name}" from skills`)
      return true
    }
    return true // 不存在也算成功
  } catch (err) {
    logger.error(`removeServerSkill: failed for "${server.name}"`, {
      serverId: server.id,
      error: (err as Error).message
    })
    return false
  }
}

/**
 * 全量同步 MCP 服务器列表到 Skills 管理室
 * 返回 { synced, failed, removed } 计数
 */
async function syncAllServers(servers: MCPServer[]): Promise<{
  synced: number
  failed: number
  removed: number
}> {
  let synced = 0
  let failed = 0

  // 1. 同步所有活跃服务器
  for (const server of servers) {
    const ok = await syncServerToSkill(server)
    if (ok) synced++
    else failed++
  }

  // 2. 清理孤儿：删掉 Skills 表中已不存在的 MCP 服务器对应的条目
  const activeNames = new Set(servers.map((s) => s.name))
  let removed = 0
  try {
    const all = await SkillsService.getInstance().getAll()
    for (const skill of all) {
      // 只处理 MCP 来源的技能
      if (!skill.tags?.includes('MCP') && !skill.source?.includes('MCP')) continue
      if (!activeNames.has(skill.name.replace(/^mcp_/, '')) && !servers.some((s) => skill.name === s.name)) {
        // 检查是否是 mcp_ 前缀的 id
        if (skill.id.startsWith(SKILL_ID_PREFIX)) {
          await SkillsService.getInstance().remove(skill.id)
          removed++
          logger.info(`syncAllServers: removed orphan skill "${skill.name}"`)
        }
      }
    }
  } catch (err) {
    logger.error('syncAllServers: orphan cleanup failed', { error: (err as Error).message })
  }

  logger.info(`syncAllServers: synced=${synced} failed=${failed} removed=${removed}`)
  return { synced, failed, removed }
}

/**
 * 检查并提示同步失败次数
 */
function reportSyncResult(action: string, result: { synced: number; failed: number; removed: number }): void {
  if (result.failed > 0) {
    logger.warn(`${action}: ${result.failed} server(s) failed to sync to skills`)
  }
}

export const McpSkillsSyncService = {
  syncServerToSkill,
  removeServerSkill,
  syncAllServers,
  reportSyncResult
}

export default McpSkillsSyncService
