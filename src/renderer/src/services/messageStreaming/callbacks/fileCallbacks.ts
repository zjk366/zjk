/**
 * 文件下载回调模块
 *
 * 当 MCP 工具返回非图片文件（PDF、文档、表格等）时，
 * 将 base64 文件保存到磁盘并创建 FileMessageBlock 在对话中显示。
 */
import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import type { FileMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createFileBlock } from '@renderer/utils/messageUtils/create'
import { FILE_TYPE } from '@renderer/types'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('FileCallbacks')

interface FileCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

/** MIME 类型到文件扩展名的简单映射 */
const MIME_EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/json': '.json',
  'application/xml': '.xml',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-excel': '.xls',
  'application/msword': '.doc',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/markdown': '.md',
}

function mimeToExt(mimeType: string): string {
  return MIME_EXT_MAP[mimeType] || `.${mimeType.split('/')[1] || 'bin'}`
}

export const createFileCallbacks = (deps: FileCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  let fileBlockId: string | null = null

  return {
    onFileCreated: async () => {
      if (blockManager.hasInitialPlaceholder) {
        const initialChanges = {
          type: MessageBlockType.FILE,
          status: MessageBlockStatus.PENDING
        }
        fileBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(fileBlockId, initialChanges, MessageBlockType.FILE)
      } else if (!fileBlockId) {
        const fileBlock = createFileBlock(assistantMsgId, {
          id: '',
          origin_name: 'downloading...',
          name: 'downloading',
          path: '',
          created_at: new Date().toISOString(),
          size: 0,
          ext: 'bin',
          type: FILE_TYPE.OTHER,
          count: 1
        } as unknown as FileMetadata, {
          status: MessageBlockStatus.PENDING
        })
        fileBlockId = fileBlock.id
        await blockManager.handleBlockTransition(fileBlock, MessageBlockType.FILE)
      }
    },

    onFileGenerated: async (fileData: { type: 'base64'; name: string; mimeType: string; data: string }) => {
      try {
        const ext = mimeToExt(fileData.mimeType)
        const fileName = `tool_file_${Date.now()}${ext}`

        // 1. 解码 base64
        const raw = fileData.data.startsWith('data:') ? fileData.data.split(',')[1] : fileData.data
        const binary = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))

        // 2. 通过 IPC 创建临时文件
        const api = window.api.file
        let savedFile: FileMetadata | null = null

        try {
          const tempPath = await api.createTempFile(fileName)
          if (tempPath) {
            // 写入临时文件
            await api.write(tempPath, binary)

            // 导入到托管存储
            savedFile = await api.upload({
              id: '',
              origin_name: fileName,
              name: fileName,
              path: tempPath,
              created_at: new Date().toISOString(),
              size: binary.length,
              ext: ext.replace('.', ''),
              type: FILE_TYPE.OTHER,
              count: 1
            })

            // 注册到 FileManager（用于获取文件 URL）
            if (savedFile) {
              await FileManager.addFile(savedFile)
            }

            // 清理临时文件
            try { await api.deleteExternalFile(tempPath) } catch { /* ok */ }
          }
        } catch (uploadErr) {
          logger.error('Failed to save file via upload:', uploadErr as Error)
        }

        if (!savedFile) {
          logger.error('[FILE] Could not save file to managed storage')
          if (fileBlockId) {
            blockManager.smartBlockUpdate(fileBlockId, {
              status: MessageBlockStatus.ERROR
            }, MessageBlockType.FILE, true)
          }
          fileBlockId = null
          return
        }

        const fields: Partial<FileMessageBlock> = {
          file: savedFile,
          status: MessageBlockStatus.SUCCESS
        }

        if (!fileBlockId && blockManager.hasInitialPlaceholder) {
          fileBlockId = blockManager.initialPlaceholderBlockId
        }

        if (fileBlockId) {
          blockManager.smartBlockUpdate(fileBlockId, fields, MessageBlockType.FILE, true)
        } else {
          const fileBlock = createFileBlock(assistantMsgId, savedFile!, fields)
          await blockManager.handleBlockTransition(fileBlock, MessageBlockType.FILE)
        }

        logger.info(`[FILE] Saved and displayed: ${fileName} (${fileData.mimeType})`)
      } catch (err) {
        logger.error('[FILE] Failed to save file:', err as Error)
        if (fileBlockId) {
          blockManager.smartBlockUpdate(fileBlockId, {
            status: MessageBlockStatus.ERROR
          }, MessageBlockType.FILE, true)
        }
      }

      fileBlockId = null
    }
  }
}
