/**
 * FileVault - 持久化文件保险库服务
 *
 * 功能：
 * - 动态切换存储根目录（通过 electron-store 持久化）
 * - 安全地保存 Base64 文件
 * - 双重防遍历校验解析 URI
 * - URI 格式: attachment://<fileName>（不含路径信息）
 */

import { loggerService } from '@logger'
import { app, dialog } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import mime from 'mime-types'
import path from 'node:path'
import { v7 as uuid } from 'uuid'

const logger = loggerService.withContext('FileVault')

/** 文件库内存状态 */
interface VaultState {
  rootDir: string
}

/** electron-store 持久化结构 */
interface VaultStore {
  rootDir?: string
}

const DEFAULT_VAULT_ROOT = 'vault'

/** 禁止出现在文件名中的字符 */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

/**
 * 安全截断文件名，防止超长或非法字符
 */
function sanitizeFileName(name: string): string {
  // 去除非法字符
  let safe = name.replace(INVALID_FILENAME_CHARS, '_')
  // 限制长度
  if (safe.length > 80) {
    const ext = path.extname(safe)
    safe = safe.slice(0, 80 - ext.length) + ext
  }
  return safe || 'unnamed'
}

/**
 * FileVault 单例
 */
class FileVault {
  private store: Store<VaultStore>
  private state: VaultState

  constructor() {
    this.store = new Store<VaultStore>({
      name: 'file-vault-config',
      defaults: { rootDir: DEFAULT_VAULT_ROOT }
    })
    const persisted = this.store.get('rootDir')
    this.state = { rootDir: persisted || DEFAULT_VAULT_ROOT }
  }

  // ──────────────────────────────────────────────
  //  rootDir 管理
  // ──────────────────────────────────────────────

  /** 获取当前 vault 根目录（绝对路径） */
  get rootDir(): string {
    const dir = this.state.rootDir
    if (path.isAbsolute(dir)) return dir
    return path.join(app.getPath('userData'), dir)
  }

  /** 设置新的 vault 根目录（接受绝对路径或 userData 相对路径） */
  set rootDir(dir: string) {
    // 安全检查：拒绝包含 .. 的路径
    if (dir.includes('..')) {
      throw new Error('Path traversal denied: rootDir must not contain ".."')
    }
    this.state.rootDir = dir
    this.store.set('rootDir', dir)
    // 确保目录存在
    fs.mkdirSync(this.rootDir, { recursive: true })
    logger.info(`FileVault root changed to: ${this.rootDir}`)
  }

  /**
   * 弹出系统目录选择器让用户选择 vault 根目录
   */
  async selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择文件库存储目录'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const selected = result.filePaths[0]
    // 安全检查
    if (selected.includes('..')) {
      logger.warn(`Path traversal denied in selected directory: ${selected}`)
      return null
    }
    this.rootDir = selected
    return selected
  }

  // ──────────────────────────────────────────────
  //  核心操作方法
  // ──────────────────────────────────────────────

  /**
   * 将 Base64 图片/文件保存到 vault
   *
   * @param base64Data - 可能含 data: 前缀的 base64 字符串
   * @param originalName - 原始文件名（仅用于扩展名推断）
   * @returns attachment://<fileName> URI
   */
  saveFromBase64(base64Data: string, originalName: string = 'file'): string {
    // 1. 提取纯 base64
    const raw = base64Data.startsWith('data:') ? base64Data.split(',')[1] : base64Data

    // 2. 推断扩展名
    let ext = path.extname(originalName)
    if (!ext) {
      // 从 data: URI 中的 mime 推断
      const mimeMatch = base64Data.match(/^data:([^;]+);/)
      if (mimeMatch) {
        ext = mime.extension(mimeMatch[1]) || 'bin'
        ext = '.' + ext
      } else {
        ext = '.bin'
      }
    }

    // 3. 生成唯一文件名
    const safeBase = sanitizeFileName(path.basename(originalName, ext))
    const uniqueName = `${safeBase}_${Date.now().toString(36)}${ext}`
    const filePath = path.join(this.rootDir, uniqueName)

    // 4. 确保目录存在
    fs.mkdirSync(this.rootDir, { recursive: true })

    // 5. 写入磁盘
    fs.writeFileSync(filePath, Buffer.from(raw, 'base64'))

    // 6. 返回 URI（不含路径信息）
    const uri = `attachment://${uniqueName}`
    logger.info(`File saved: ${filePath} -> ${uri}`)
    return uri
  }

  /**
   * 将 attachment:// URI 解析为绝对文件路径
   *
   * ## 双重防遍历校验
   * 1. 字符级: 拒绝包含 .. 的 fileName
   * 2. 路径级: 确保解析后的完整路径以 rootDir 开头
   *
   * @param uri - attachment://<fileName>
   * @returns 绝对路径
   * @throws Error 如果校验失败
   */
  resolvePath(uri: string): string {
    if (!uri.startsWith('attachment://')) {
      throw new Error(`Invalid URI scheme: ${uri}`)
    }

    const fileName = uri.slice('attachment://'.length)

    // 第一重校验：拒绝包含路径分隔符或 .. 的文件名
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      throw new Error(`Path traversal denied in fileName: ${fileName}`)
    }

    // 第二重校验：确保 fileName 不包含非法字符
    if (INVALID_FILENAME_CHARS.test(fileName)) {
      throw new Error(`Invalid characters in fileName: ${fileName}`)
    }

    const fullPath = path.join(this.rootDir, fileName)

    // 第三重校验：确保解析后的路径确实以 rootDir 开头
    const normalizedRoot = path.resolve(this.rootDir)
    const normalizedFull = path.resolve(fullPath)
    if (!normalizedFull.startsWith(normalizedRoot)) {
      throw new Error(`Path traversal denied: ${normalizedFull} is outside vault root ${normalizedRoot}`)
    }

    return fullPath
  }

  /**
   * 列出 vault 中的所有文件
   */
  listFiles(): { name: string; size: number; mtime: Date }[] {
    try {
      if (!fs.existsSync(this.rootDir)) {
        return []
      }
      return fs.readdirSync(this.rootDir).map((name) => {
        const fullPath = path.join(this.rootDir, name)
        try {
          const stat = fs.statSync(fullPath)
          return { name, size: stat.size, mtime: stat.mtime }
        } catch {
          return { name, size: 0, mtime: new Date() }
        }
      })
    } catch (err) {
      logger.error('Failed to list vault files:', err as Error)
      return []
    }
  }
}

/** 单例导出 */
export const fileVault = new FileVault()
export default FileVault
