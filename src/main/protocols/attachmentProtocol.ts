/**
 * attachment:// 自定义协议
 *
 * URI 格式: attachment://<fileName>
 * fileName 仅包含文件名，不含任何路径信息。
 * 文件路径由 FileVault 根据当前 vault 根目录解析。
 *
 * 安全特性：
 * - 路径解析委托 FileVault.resolvePath()（三重防遍历校验）
 * - MIME 类型通过 mime-types 库推断
 * - 所有响应注入 CSP 头
 * - 支持 Range 请求（视频/音频渐进式加载）
 */

import { loggerService } from '@logger'
import { protocol } from 'electron'
import fs from 'node:fs'
import mime from 'mime-types'

import { fileVault } from '../services/FileVault'

const logger = loggerService.withContext('AttachmentProtocol')

/** 1x1 透明 PNG 占位 */
const EMPTY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

/** 所有响应注入的 CSP */
const CSP_HEADER = "default-src 'none'"

/**
 * 注册 attachment:// 自定义协议
 */
export function registerAttachmentProtocol(): void {
  logger.info('Registering attachment:// protocol...')

  protocol.handle('attachment', async (request) => {
    try {
      // 1. 解析 URI → 文件路径（FileVault 会做三重防遍历校验）
      const filePath = fileVault.resolvePath(request.url)

      // 2. 文件存在性检查
      if (!fs.existsSync(filePath)) {
        logger.warn(`Attachment not found: ${filePath}`)
        return new Response(EMPTY_PNG, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': CSP_HEADER
          }
        })
      }

      const stat = fs.statSync(filePath)
      const mimeType = mime.lookup(filePath) || 'application/octet-stream'
      const fileSize = stat.size

      // 3. 处理 Range 请求（视频/音频渐进式加载）
      const rangeHeader = request.headers.get('range')
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
          const chunkSize = end - start + 1
          const fd = fs.openSync(filePath, 'r')
          const buf = Buffer.alloc(chunkSize)
          fs.readSync(fd, buf, 0, chunkSize, start)
          fs.closeSync(fd)

          return new Response(buf, {
            status: 206,
            headers: {
              'Content-Type': mimeType,
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Content-Length': String(chunkSize),
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'private, max-age=300, must-revalidate',
              'Content-Security-Policy': CSP_HEADER
            }
          })
        }
      }

      // 4. 非 Range 请求：返回完整文件
      const data = fs.readFileSync(filePath)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'private, max-age=300, must-revalidate',
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Content-Security-Policy': CSP_HEADER
        }
      })
    } catch (err: any) {
      // 路径解析失败（校验不通过）或文件读取错误
      logger.warn(`Attachment protocol error: ${err.message}`)
      return new Response(EMPTY_PNG, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': CSP_HEADER
        }
      })
    }
  })

  logger.info('attachment:// protocol registered')
}
