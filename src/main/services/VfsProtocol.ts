/**
 * cs-vfs:// 自定义协议
 *
 * 用于在聊天中安全地引用文件库中的本地文件。
 * 通过 fileId 映射到实际路径，所有路径经过防目录穿越校验。
 */

import { loggerService } from '@logger'
import { protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
const logger = loggerService.withContext('VfsProtocol')

// 文件 ID → 路径映射（全局共享，供 mcp-bridge 写入，VfsProtocol 读取）
const fileRefStore: Record<string, string> = {}
export function setFileRefPath(fileId: string, filePath: string): void {
  fileRefStore[fileId] = filePath
}
export function getFileRefPath(fileId: string): string | undefined {
  return fileRefStore[fileId]
}

// 1x1 透明 PNG (Base64)
const EMPTY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const EMPTY_PNG_BUFFER = Buffer.from(EMPTY_PNG_BASE64, 'base64')

// MIME 映射
const MIME_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  tiff: 'image/tiff', tif: 'image/tiff', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo', mov: 'video/quicktime',
  flv: 'video/x-flv', f4v: 'video/x-f4v', wmv: 'video/x-ms-wmv', m4v: 'video/x-m4v',
  '3gp': 'video/3gpp', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  aac: 'audio/aac', wma: 'audio/x-ms-wma', m4a: 'audio/mp4', opus: 'audio/opus',
  mid: 'audio/midi', midi: 'audio/midi',
  pdf: 'application/pdf', json: 'application/json', xml: 'application/xml',
  js: 'application/javascript', css: 'text/css',
  html: 'text/html', htm: 'text/html',
  txt: 'text/plain', md: 'text/markdown',
  svgz: 'image/svg+xml',
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * 注册 cs-vfs:// 自定义协议
 *
 * 用法: cs-vfs://<fileId>
 *   或 cs-vfs://path/<relative-path>
 */
export function registerVfsProtocol(): void {
  logger.info('Registering cs-vfs:// protocol...')

  protocol.handle('cs-vfs', async (request) => {
    try {
      const url = new URL(request.url)
      let resourcePath = ''

      // 解析 fileId 或路径
      if (url.host === 'path') {
        // URL 路径是编码的，需要解码
        resourcePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
      } else {
        // host 是 fileId
        const fileId = url.host
        resourcePath = getFileRefPath(fileId) || ''
      }

      if (!resourcePath) {
        logger.warn(`VFS: fileId not found: ${url.host}`)
        // 返回占位图
        return new Response(EMPTY_PNG_BUFFER, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
        })
      }

      // 规范化文件路径（统一用正斜杠）
      let normalizedPath = resourcePath.replace(/\\/g, '/')
      // 安全校验：拒绝包含 .. 的路径（目录遍历防护）
      if (resourcePath.includes('..')) {
        logger.warn(`VFS: path traversal detected: ${normalizedPath}`)
        return new Response(EMPTY_PNG_BUFFER, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
      }

      // 读取文件
      if (!fs.existsSync(normalizedPath)) {
        logger.warn(`VFS: file not found: ${normalizedPath}`)
        return new Response(EMPTY_PNG_BUFFER, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
        })
      }

      const stat = fs.statSync(normalizedPath)
      const mimeType = getMimeType(resourcePath)
      const fileSize = stat.size

      // 处理 Range 请求（视频/音频需要 Partital Content 支持）
      const rangeHeader = request.headers.get('range')
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
          const chunkSize = end - start + 1
          const fd = fs.openSync(normalizedPath, 'r')
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
              'Cache-Control': 'public, max-age=3600',
            },
          })
        }
      }

      // 非 Range 请求：返回完整文件
      const data = fs.readFileSync(normalizedPath)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=3600',
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
        },
      })
    } catch (err: any) {
      logger.error('VFS protocol error:', err)
      return new Response(EMPTY_PNG_BUFFER, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
        },
      })
    }
  })

  logger.info('cs-vfs:// protocol registered')
}
