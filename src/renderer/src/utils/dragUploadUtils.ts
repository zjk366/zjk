/**
 * 拖拽上传工具函数
 *
 * 处理文件和文件夹的递归解析、安全校验、路径脱敏。
 */
import { loggerService } from '@logger'
import {
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  MAX_FILES_IN_FOLDER,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_TOTAL_SIZE,
  MAX_SINGLE_FILE_SIZE,
} from '@renderer/types/dragUpload'
import type { DragUploadNode, DragUploadResult } from '@renderer/types/dragUpload'

const logger = loggerService.withContext('dragUploadUtils')

/** 生成唯一 ID */
function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 安全检查：验证文件扩展名是否在白名单中且不在黑名单中
 */
export function isAllowedFileType(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (BLOCKED_EXTENSIONS.has(ext)) return false
  if (ALLOWED_EXTENSIONS.has(ext)) return true
  // 无扩展名的文件（如 Makefile、Dockerfile 等）默认允许
  if (!name.includes('.')) return true
  // 未知扩展名默认拒绝
  return false
}

/**
 * 获取文件扩展名（不含点，小写）
 */
export function getFileExtension(name: string): string {
  if (!name.includes('.')) return ''
  return name.split('.').pop()?.toLowerCase() || ''
}

/**
 * 递归读取 FileSystemDirectoryEntry 下的所有文件和子目录
 *
 * 使用回调风格的 FileSystemDirectoryReader.readEntries() API，
 * 因为这是 Chrome/Electron 提供的标准 API。
 */
async function readDirectoryEntry(
  dirEntry: FileSystemDirectoryEntry,
  relativePath: string,
  depth: number,
  maxDepth: number,
  maxFiles: number,
): Promise<{ nodes: DragUploadNode[]; fileCount: number; totalSize: number }> {
  if (depth > maxDepth) {
    logger.warn(`Max depth ${maxDepth} reached at ${relativePath}`)
    return { nodes: [], fileCount: 0, totalSize: 0 }
  }

  const reader = dirEntry.createReader()
  const nodes: DragUploadNode[] = []
  let fileCount = 0
  let totalSize = 0

  // readEntries 每次最多返回 100 个条目，需要循环读取
  const readAllEntries = (): Promise<FileSystemEntry[]> => {
    return new Promise((resolve, reject) => {
      const allEntries: FileSystemEntry[] = []
      const readBatch = () => {
        reader.readEntries((entries) => {
          if (entries.length === 0) {
            resolve(allEntries)
          } else {
            allEntries.push(...entries)
            // 防止无限循环
            if (allEntries.length > maxFiles) {
              resolve(allEntries)
            } else {
              readBatch()
            }
          }
        }, reject)
      }
      readBatch()
    })
  }

  const entries = await readAllEntries()

  for (const entry of entries) {
    if (fileCount >= maxFiles) {
      logger.warn(`Max files ${maxFiles} reached`)
      break
    }

    const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry

      // 安全检查
      if (!isAllowedFileType(entry.name)) {
        logger.info(`Skipping disallowed file: ${entry.name}`)
        continue
      }

      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject)
      })

      // 大小检查
      if (file.size > MAX_SINGLE_FILE_SIZE) {
        logger.warn(`File too large (${file.size} bytes): ${entry.name}`)
        continue
      }

      nodes.push({
        id: uid(),
        type: 'file',
        name: entry.name,
        relativePath: entryRelativePath,
        size: file.size,
        ext: getFileExtension(entry.name),
        file,
      })

      fileCount++
      totalSize += file.size
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry
      const result = await readDirectoryEntry(dirEntry, entryRelativePath, depth + 1, maxDepth, maxFiles - fileCount)

      if (result.nodes.length > 0) {
        nodes.push({
          id: uid(),
          type: 'folder',
          name: entry.name,
          relativePath: entryRelativePath,
          size: result.totalSize,
          ext: '',
          children: result.nodes,
        })
      }

      fileCount += result.fileCount
      totalSize += result.totalSize
    }
  }

  // 按类型排序：文件夹在前，文件在后；同类型按名称排序
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { nodes, fileCount, totalSize }
}

/**
 * 从 DataTransfer 中解析所有拖入的文件和文件夹
 *
 * 支持混合拖入（同时包含文件和文件夹），
 * 将系统绝对路径替换为虚拟相对路径。
 */
export async function parseDragData(dataTransfer: DataTransfer): Promise<DragUploadResult> {
  const items = dataTransfer.items
  const rootNodes: DragUploadNode[] = []
  let totalFiles = 0
  let totalFolders = 0
  let totalSize = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind !== 'file') continue

    const entry = item.webkitGetAsEntry?.()
    if (!entry) {
      // 降级处理：使用 File 对象
      const file = item.getAsFile()
      if (!file) continue
      if (!isAllowedFileType(file.name)) continue
      if (file.size > MAX_SINGLE_FILE_SIZE) continue

      rootNodes.push({
        id: uid(),
        type: 'file',
        name: file.name,
        relativePath: file.name,
        size: file.size,
        ext: getFileExtension(file.name),
        file,
      })
      totalFiles++
      totalSize += file.size
      continue
    }

    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      if (!isAllowedFileType(entry.name)) continue

      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject)
      })

      if (file.size > MAX_SINGLE_FILE_SIZE) {
        logger.warn(`File too large: ${entry.name} (${file.size} bytes)`)
        continue
      }

      rootNodes.push({
        id: uid(),
        type: 'file',
        name: entry.name,
        relativePath: entry.name,
        size: file.size,
        ext: getFileExtension(entry.name),
        file,
      })
      totalFiles++
      totalSize += file.size
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry
      const result = await readDirectoryEntry(dirEntry, entry.name, 0, MAX_FOLDER_DEPTH, MAX_FILES_IN_FOLDER)

      if (result.nodes.length > 0) {
        rootNodes.push({
          id: uid(),
          type: 'folder',
          name: entry.name,
          relativePath: entry.name,
          size: result.totalSize,
          ext: '',
          children: result.nodes,
        })
        totalFolders++
        totalFiles += result.fileCount
        totalSize += result.totalSize
      }
    }
  }

  // 总大小检查
  if (totalSize > MAX_FOLDER_TOTAL_SIZE) {
    throw new Error(
      `总大小 (${(totalSize / 1024 / 1024).toFixed(1)}MB) 超过限制 (${MAX_FOLDER_TOTAL_SIZE / 1024 / 1024}MB)`
    )
  }

  // 构建根节点
  const root: DragUploadNode = {
    id: uid(),
    type: 'folder',
    name: rootNodes.length === 1 && rootNodes[0].type === 'folder'
      ? rootNodes[0].name
      : `上传 (${totalFiles} 个文件)`,
    relativePath: '',
    size: totalSize,
    ext: '',
    children: rootNodes,
  }

  return { root, totalFiles, totalFolders, totalSize }
}

/**
 * 从 DragUploadResult 中提取所有文件节点（扁平化）
 */
export function flattenFileNodes(node: DragUploadNode): DragUploadNode[] {
  const files: DragUploadNode[] = []
  if (node.type === 'file') {
    files.push(node)
  }
  if (node.children) {
    for (const child of node.children) {
      files.push(...flattenFileNodes(child))
    }
  }
  return files
}

/**
 * 格式化文件大小为人类可读的字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
