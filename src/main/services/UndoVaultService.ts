/**
 * UndoVaultService — 操作撤销保险库
 *
 * 在 AI 执行破坏性操作（删除/覆写文件）前自动备份原文件，
 * 支持按需恢复（回溯）和超时自动清理。
 *
 * 存储结构：
 *   userData/UndoVault/{entryId}/
 *     meta.json   — { originalPaths, backupPaths, createdAt, expiresAt }
 *     files/      — 备份的原文件内容
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { app } from 'electron'

const logger = loggerService.withContext('UndoVaultService')

export interface VaultEntry {
  id: string
  /** 备份时的原始文件路径 */
  originalPaths: string[]
  /** 备份文件的相对路径（相对 entryDir） */
  backupFiles: string[]
  /** 备份时间 */
  createdAt: number
  /** 过期时间戳，超过此时间可自动清理 */
  expiresAt: number
  /** 操作摘要（如 "删除"、"覆写"），用于 UI 显示 */
  summary: string
}

interface VaultMeta {
  entries: Record<string, Omit<VaultEntry, 'id'>>
}

const DEFAULT_TTL_MS = 30 * 60 * 1000 // 默认 30 分钟过期
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 每 5 分钟清理一次
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 超过 10MB 的文件不备份

class UndoVaultService {
  private vaultDir: string
  private metaPath: string
  private meta: VaultMeta = { entries: {} }
  private loaded = false
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  /** 最近一次备份的 entryId，供渲染进程读取 */
  private lastEntryId: string | null = null

  constructor() {
    this.vaultDir = path.join(app.getPath('userData'), 'UndoVault')
    this.metaPath = path.join(this.vaultDir, 'entries.json')
  }

  // ── 初始化 ────────────────────────────────────────

  init(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      fs.mkdirSync(this.vaultDir, { recursive: true })
      if (fs.existsSync(this.metaPath)) {
        const raw = fs.readFileSync(this.metaPath, 'utf-8')
        this.meta = JSON.parse(raw)
      }
      this.startCleanupTimer()
      logger.info(`UndoVaultService initialized: ${this.vaultDir}`)
    } catch (err) {
      logger.error('Failed to init UndoVaultService:', err as Error)
    }
  }

  destroy(): void {
    this.stopCleanupTimer()
    this.loaded = false
  }

  /** 保存元数据到磁盘 */
  private saveMeta(): void {
    try {
      fs.mkdirSync(this.vaultDir, { recursive: true })
      fs.writeFileSync(this.metaPath, JSON.stringify(this.meta, null, 2), 'utf-8')
    } catch (err) {
      logger.error('Failed to save vault meta:', err as Error)
    }
  }

  // ── 核心操作 ──────────────────────────────────────

  /**
   * 备份一个或多个文件到保险库
   * @param filePaths 原始文件绝对路径列表
   * @param summary 操作摘要
   * @returns vaultEntryId（空数组时返回 null）
   */
  async backup(filePaths: string[], summary: string): Promise<string | null> {
    this.initIfNeeded()
    if (!filePaths.length) return null

    const entryId = `uv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const entryDir = path.join(this.vaultDir, entryId)
    const filesDir = path.join(entryDir, 'files')

    try {
      fs.mkdirSync(filesDir, { recursive: true })

      const backupFiles: string[] = []
      const validPaths: string[] = []

      for (const fp of filePaths) {
        try {
          const stat = await fsp.stat(fp)
          if (!stat.isFile()) continue
          if (stat.size > MAX_FILE_SIZE) {
            logger.warn(`Skipping large file (>10MB): ${fp}`)
            continue
          }

          // 生成安全的备份文件名（路径哈希）
          const safeName = Buffer.from(fp).toString('base64url').slice(0, 80) + '_' + path.basename(fp)
          const backupPath = path.join(filesDir, safeName)

          // 复制文件到 vault
          await fsp.copyFile(fp, backupPath)
          backupFiles.push(safeName)
          validPaths.push(fp)
          logger.info(`Backed up: ${fp} → ${backupPath}`)
        } catch (err) {
          logger.warn(`Failed to backup ${fp}:`, err as Error)
          // 单个文件失败不影响其他文件
        }
      }

      if (backupFiles.length === 0) {
        // 没有实际备份任何文件，清理空目录
        fs.rmSync(entryDir, { recursive: true, force: true })
        return null
      }

      const entry: Omit<VaultEntry, 'id'> = {
        originalPaths: validPaths,
        backupFiles,
        createdAt: Date.now(),
        expiresAt: Date.now() + DEFAULT_TTL_MS,
        summary
      }

      this.meta.entries[entryId] = entry
      this.lastEntryId = entryId
      this.saveMeta()

      logger.info(`UndoVault backup created: ${entryId} (${validPaths.length} files, ${summary})`)
      return entryId
    } catch (err) {
      logger.error('Failed to backup files:', err as Error)
      // 清理可能已创建的部分目录
      try {
        fs.rmSync(entryDir, { recursive: true, force: true })
      } catch {
        /* ok */
      }
      return null
    }
  }

  /** 备份文件内容（直接传入文本内容，用于渲染进程预读取的场景） */
  async backupFromContent(filePath: string, content: string, summary: string): Promise<string | null> {
    this.initIfNeeded()

    const entryId = `uv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const entryDir = path.join(this.vaultDir, entryId)
    const filesDir = path.join(entryDir, 'files')

    try {
      fs.mkdirSync(filesDir, { recursive: true })

      const safeName = Buffer.from(filePath).toString('base64url').slice(0, 80) + '_' + path.basename(filePath)
      const backupPath = path.join(filesDir, safeName)

      await fsp.writeFile(backupPath, content, 'utf-8')

      const entry: Omit<VaultEntry, 'id'> = {
        originalPaths: [filePath],
        backupFiles: [safeName],
        createdAt: Date.now(),
        expiresAt: Date.now() + DEFAULT_TTL_MS,
        summary
      }

      this.meta.entries[entryId] = entry
      this.lastEntryId = entryId
      this.saveMeta()

      logger.info(`UndoVault content backup: ${entryId} → ${filePath}`)
      return entryId
    } catch (err) {
      logger.error('Failed to backup content:', err as Error)
      try {
        fs.rmSync(entryDir, { recursive: true, force: true })
      } catch {
        /* ok */
      }
      return null
    }
  }

  /**
   * 从保险库恢复文件（撤销操作）
   * @returns 成功恢复的文件数
   */
  async restore(entryId: string): Promise<number> {
    this.initIfNeeded()
    const entry = this.meta.entries[entryId]
    if (!entry) {
      logger.warn(`Vault entry not found: ${entryId}`)
      return 0
    }

    const entryDir = path.join(this.vaultDir, entryId)
    const filesDir = path.join(entryDir, 'files')
    let restored = 0

    for (let i = 0; i < entry.backupFiles.length; i++) {
      const backupPath = path.join(filesDir, entry.backupFiles[i])
      const originalPath = entry.originalPaths[i]

      try {
        if (!fs.existsSync(backupPath)) {
          logger.warn(`Backup file missing: ${backupPath}`)
          continue
        }

        // 确保目标目录存在
        const parentDir = path.dirname(originalPath)
        await fsp.mkdir(parentDir, { recursive: true })

        // 恢复文件
        await fsp.copyFile(backupPath, originalPath)
        restored++
        logger.info(`Restored: ${backupPath} → ${originalPath}`)
      } catch (err) {
        logger.error(`Failed to restore ${originalPath}:`, err as Error)
      }
    }

    logger.info(`UndoVault restore: ${entryId} (${restored}/${entry.backupFiles.length} files)`)
    return restored
  }

  /**
   * 丢弃保险库条目（删除备份文件）
   */
  async discard(entryId: string): Promise<boolean> {
    this.initIfNeeded()
    if (!this.meta.entries[entryId]) return false

    const entryDir = path.join(this.vaultDir, entryId)
    try {
      await fsp.rm(entryDir, { recursive: true, force: true })
    } catch (err) {
      logger.warn(`Failed to remove vault dir ${entryDir}:`, err as Error)
    }

    delete this.meta.entries[entryId]
    this.saveMeta()
    return true
  }

  /**
   * 获取 vault 条目信息
   */
  getEntry(entryId: string): VaultEntry | null {
    this.initIfNeeded()
    const entry = this.meta.entries[entryId]
    if (!entry) return null
    return { id: entryId, ...entry }
  }

  /**
   * 获取最近一次备份的 entryId
   */
  getLastEntryId(): string | null {
    this.initIfNeeded()
    return this.lastEntryId
  }

  /**
   * 列出所有未过期的 vault 条目
   */
  listEntries(): VaultEntry[] {
    this.initIfNeeded()
    const now = Date.now()
    return Object.entries(this.meta.entries)
      .filter(([_, e]) => e.expiresAt > now)
      .map(([id, e]) => ({ id, ...e }))
  }

  // ── 清理 ──────────────────────────────────────────

  /**
   * 清理过期条目
   * @param maxAgeMs 过期时间（毫秒），默认 DEFAULT_TTL_MS
   * @returns 清理的条目数
   */
  async cleanup(maxAgeMs: number = DEFAULT_TTL_MS): Promise<number> {
    this.initIfNeeded()
    const now = Date.now()
    const expired: string[] = []

    for (const [id, entry] of Object.entries(this.meta.entries)) {
      if (now >= entry.expiresAt) {
        expired.push(id)
      }
    }

    for (const id of expired) {
      const entryDir = path.join(this.vaultDir, id)
      try {
        await fsp.rm(entryDir, { recursive: true, force: true })
      } catch {
        /* ok */
      }
      delete this.meta.entries[id]
    }

    if (expired.length > 0) {
      this.saveMeta()
      logger.info(`Cleaned up ${expired.length} expired vault entries`)
    }

    return expired.length
  }

  /** 获取 vault 条目总数 */
  getEntryCount(): number {
    this.initIfNeeded()
    return Object.keys(this.meta.entries).length
  }

  // ── 内部 ──────────────────────────────────────────

  private initIfNeeded(): void {
    if (!this.loaded) this.init()
  }

  private startCleanupTimer(): void {
    this.stopCleanupTimer()
    this.cleanupTimer = setInterval(() => {
      void this.cleanup()
    }, CLEANUP_INTERVAL_MS)
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}

export const undoVaultService = new UndoVaultService()
export default UndoVaultService
