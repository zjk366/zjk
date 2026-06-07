/**
 * vaultIpc - FileVault 安全 IPC 通道
 *
 * 注册 4 个白名单 IPC 通道，渲染进程通过它们操作文件库。
 * 绝不直接暴露 fs 模块或文件系统路径。
 */

import { loggerService } from '@logger'
import { ipcMain } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'

import { fileVault } from '../services/FileVault'

const logger = loggerService.withContext('VaultIpc')

/** 注册所有 FileVault IPC 通道 */
export function registerVaultIpc(): void {
  // 列出 vault 中所有文件（仅返回文件名、大小、修改时间）
  ipcMain.handle(IpcChannel.Vault_ListFiles, () => {
    try {
      return fileVault.listFiles()
    } catch (err) {
      logger.error('vault:list-files error:', err as Error)
      return []
    }
  })

  // 弹出系统目录选择器，让用户选择新的 vault 根目录
  ipcMain.handle(IpcChannel.Vault_SelectDirectory, async () => {
    try {
      return await fileVault.selectDirectory()
    } catch (err) {
      logger.error('vault:select-directory error:', err as Error)
      return null
    }
  })

  // 设置 vault 根目录（带路径安全校验）
  ipcMain.handle(IpcChannel.Vault_SetRoot, async (_event, dir: string) => {
    if (typeof dir !== 'string') {
      throw new Error('vault:set-root requires a string path')
    }
    fileVault.rootDir = dir
    return fileVault.rootDir
  })

  // 获取当前 vault 根目录
  ipcMain.handle(IpcChannel.Vault_GetRoot, () => {
    return fileVault.rootDir
  })
}
