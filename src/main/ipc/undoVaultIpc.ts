/**
 * undoVaultIpc — UndoVault IPC 通道
 *
 * 注册 7 个 IPC 通道，渲染进程通过它们操作撤销保险库。
 */
import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { undoVaultService } from '../services/UndoVaultService'

const logger = loggerService.withContext('UndoVaultIpc')

/** 注册所有 UndoVault IPC 通道 */
export function registerUndoVaultIpc(): void {
  // 备份文件（接收文件路径列表，主进程自行读取文件）
  ipcMain.handle(IpcChannel.UndoVault_Backup, async (_event, filePaths: string[], summary: string) => {
    try {
      return await undoVaultService.backup(filePaths, summary)
    } catch (err) {
      logger.error('undo-vault:backup error:', err as Error)
      return null
    }
  })

  // 备份文件内容（接收文件路径 + 文本内容，适合渲染进程已读取内容的场景）
  ipcMain.handle(
    IpcChannel.UndoVault_BackupContent,
    async (_event, filePath: string, content: string, summary: string) => {
      try {
        return await undoVaultService.backupFromContent(filePath, content, summary)
      } catch (err) {
        logger.error('undo-vault:backup-content error:', err as Error)
        return null
      }
    }
  )

  // 恢复文件（撤销操作）
  ipcMain.handle(IpcChannel.UndoVault_Restore, async (_event, entryId: string) => {
    try {
      return await undoVaultService.restore(entryId)
    } catch (err) {
      logger.error('undo-vault:restore error:', err as Error)
      return 0
    }
  })

  // 丢弃备份
  ipcMain.handle(IpcChannel.UndoVault_Discard, async (_event, entryId: string) => {
    try {
      return await undoVaultService.discard(entryId)
    } catch (err) {
      logger.error('undo-vault:discard error:', err as Error)
      return false
    }
  })

  // 获取 vault 条目
  ipcMain.handle(IpcChannel.UndoVault_GetEntry, (_event, entryId: string) => {
    try {
      return undoVaultService.getEntry(entryId)
    } catch (err) {
      logger.error('undo-vault:get-entry error:', err as Error)
      return null
    }
  })

  // 获取最近一次备份的 entryId
  ipcMain.handle(IpcChannel.UndoVault_GetLastEntry, () => {
    try {
      return undoVaultService.getLastEntryId()
    } catch (err) {
      logger.error('undo-vault:get-last-entry error:', err as Error)
      return null
    }
  })

  // 列出所有 vault 条目
  ipcMain.handle(IpcChannel.UndoVault_ListEntries, () => {
    try {
      return undoVaultService.listEntries()
    } catch (err) {
      logger.error('undo-vault:list-entries error:', err as Error)
      return []
    }
  })

  // 手动触发清理
  ipcMain.handle(IpcChannel.UndoVault_Cleanup, async () => {
    try {
      return await undoVaultService.cleanup()
    } catch (err) {
      logger.error('undo-vault:cleanup error:', err as Error)
      return 0
    }
  })
}
