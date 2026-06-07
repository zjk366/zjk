import { dialog, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import * as z from 'zod'

import { logger, validatePath } from '../types'

// Schema definition
export const DeleteToolSchema = z.object({
  path: z.string().describe('The path to the file or directory to delete'),
  recursive: z.boolean().optional().describe('For directories, whether to delete recursively (default: false)')
})

// Tool definition with detailed description
export const deleteToolDefinition = {
  name: 'delete',
  description: `Deletes a file or directory from the filesystem.

CAUTION: This operation cannot be undone!

- For files: simply provide the path
- For empty directories: provide the path
- For non-empty directories: set recursive=true
- The path must resolve within the configured workspace root
- Always verify the path before deleting to avoid data loss`,
  inputSchema: z.toJSONSchema(DeleteToolSchema)
}

// Handler implementation
export async function handleDeleteTool(args: unknown, baseDir: string) {
  const parsed = DeleteToolSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments for delete: ${parsed.error}`)
  }

  const targetPath = parsed.data.path
  const validPath = await validatePath(targetPath, baseDir)
  const recursive = parsed.data.recursive || false

  // Check if path exists and get stats
  let stats
  try {
    stats = await fs.stat(validPath)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Path not found: ${targetPath}`)
    }
    throw error
  }

  const isDirectory = stats.isDirectory()
  const relativePath = baseDir ? path.relative(baseDir, validPath) : validPath

  // ── 用户确认弹窗（所有删除操作必须确认）────────────────
  const itemName = path.basename(validPath)
  const typeLabel = isDirectory ? '目录' : '文件'

  const confirmResult = await dialog.showMessageBox({
    type: 'warning',
    title: `⚠️ AI 请求删除 ${typeLabel}`,
    message: `AI 请求删除 "${itemName}"`,
    detail: isDirectory
      ? `路径: ${validPath}\n\n此 ${typeLabel} 将${recursive ? '及其所有内容' : ''}移入回收站。\n请在下方确认是否允许。`
      : `路径: ${validPath}\n\n此 ${typeLabel} 将移入回收站。\n请在下方确认是否允许。`,
    buttons: ['取消', '确认删除'],
    defaultId: 0,
    cancelId: 0,
  })

  if (confirmResult.response !== 1) {
    logger.info('Delete cancelled by user', { path: validPath })
    return {
      content: [{ type: 'text', text: `用户已取消删除操作: ${relativePath}` }],
      isError: true
    }
  }
  // ──────────────────────────────────────────────────

  // 执行删除（移入回收站而非永久删除）
  try {
    if (isDirectory && recursive) {
      // 目录递归删除直接使用 fs.rm（shell.trashItem 不支持目录递归）
      await fs.rm(validPath, { recursive: true, force: true })
    } else {
      // 文件/空目录 → 移入回收站
      await shell.trashItem(validPath)
    }
  } catch (error: any) {
    if (error.code === 'ENOTEMPTY') {
      throw new Error(`Directory not empty: ${targetPath}. Use recursive=true to delete non-empty directories.`)
    }
    throw new Error(`Failed to delete: ${error.message}`)
  }

  // Log the operation
  logger.info('Path deleted', {
    path: validPath,
    type: isDirectory ? 'directory' : 'file',
    recursive: isDirectory ? recursive : undefined
  })

  // Format output
  const itemType = isDirectory ? 'Directory' : 'File'
  const recursiveNote = isDirectory && recursive ? ' (recursive)' : ''

  return {
    content: [
      {
        type: 'text',
        text: `${itemType} deleted${recursiveNote}: ${relativePath}`
      }
    ]
  }
}
