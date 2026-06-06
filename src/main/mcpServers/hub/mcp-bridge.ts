/**
 * Bridge module for Hub server to access MCPService.
 */
import { loggerService } from '@logger'
import mcpService from '@main/services/MCPService'
import { windowService } from '@main/services/WindowService'
import type { MCPCallToolResponse, MCPTool, MCPToolResultContent } from '@types'
import { IpcChannel } from '@shared/IpcChannel'

import { buildToolNameMapping, resolveToolId, type ToolIdentity, type ToolNameMapping } from './toolname'

const logger = loggerService.withContext('HubBridge')

// 延迟加载，避免循环引用
const getSetFileRefPath = () => require('@main/services/VfsProtocol').setFileRefPath as (id: string, p: string) => void

export const listAllTools = () => mcpService.listAllActiveServerTools()

let toolNameMapping: ToolNameMapping | null = null

export async function refreshToolMap(): Promise<void> {
  const tools = await listAllTools()
  syncToolMapFromTools(tools)
}

export function syncToolMapFromTools(tools: MCPTool[]): void {
  const identities: ToolIdentity[] = tools.map((tool) => ({
    id: `${tool.serverId}__${tool.name}`,
    serverName: tool.serverName,
    toolName: tool.name
  }))

  toolNameMapping = buildToolNameMapping(identities)
}

export function syncToolMapFromHubTools(tools: { id: string; serverName: string; toolName: string }[]): void {
  const identities: ToolIdentity[] = tools.map((tool) => ({
    id: tool.id,
    serverName: tool.serverName,
    toolName: tool.toolName
  }))

  toolNameMapping = buildToolNameMapping(identities)
}

export function clearToolMap(): void {
  toolNameMapping = null
}

/**
 * Resolve a hub tool JS name (or namespaced id) to its original serverId and toolName.
 * Returns null if the name cannot be resolved.
 */
export function resolveHubToolName(nameOrId: string): { serverId: string; toolName: string } | null {
  if (!toolNameMapping) return null

  const toolId = resolveToolId(toolNameMapping, nameOrId)
  if (!toolId) return null

  const separatorIndex = toolId.indexOf('__')
  if (separatorIndex === -1) return null

  return {
    serverId: toolId.substring(0, separatorIndex),
    toolName: toolId.substring(separatorIndex + 2)
  }
}

/**
 * Async version of resolveHubToolName that lazily refreshes the tool mapping
 * if it has been cleared (e.g., after cache invalidation).
 */
export async function resolveHubToolNameAsync(
  nameOrId: string
): Promise<{ serverId: string; toolName: string } | null> {
  if (!toolNameMapping) {
    await refreshToolMap()
  }

  const result = resolveHubToolName(nameOrId)
  if (!result && toolNameMapping) {
    // Mapping exists but tool not found — refresh once and retry
    await refreshToolMap()
    return resolveHubToolName(nameOrId)
  }

  return result
}

/**
 * Call a tool by either:
 * - JS name (camelCase), e.g. "githubSearchRepos"
 * - original tool id (namespaced), e.g. "github__search_repos"
 */
export const callMcpTool = async (nameOrId: string, params: unknown, callId?: string): Promise<unknown> => {
  if (!toolNameMapping) {
    await refreshToolMap()
  }

  const mapping = toolNameMapping
  if (!mapping) {
    throw new Error('Tool mapping not initialized')
  }

  let toolId = resolveToolId(mapping, nameOrId)
  if (!toolId) {
    // Refresh and retry once (tools might have changed)
    await refreshToolMap()
    const refreshed = toolNameMapping
    if (!refreshed) {
      throw new Error('Tool mapping not initialized')
    }
    toolId = resolveToolId(refreshed, nameOrId)
  }

  if (!toolId) {
    throw new Error(`Tool not found: ${nameOrId}`)
  }

  const result = await mcpService.callToolById(toolId, params, callId)
  throwIfToolError(result)

  // 保存图片并返回路径给 AI
  if (result?.content) {
    const imageItems = result.content.filter((c: any) => c.type === 'image' && c.data)
    if (imageItems.length > 0) {
      const fs = require('node:fs')
      const p = require('node:path')
      const { app } = require('electron')
      const savedPaths: string[] = []
      for (const img of imageItems) {
        try {
          const raw = img.data.startsWith('data:') ? img.data.split(',')[1] : img.data
          const ext = img.mimeType === 'image/jpeg' ? 'jpeg' : 'png'
          const dateStr = new Date().toISOString().slice(0, 7)

          // 尝试读取文件库路径配置
          let libBase = ''
          try {
            const configPath = p.join(app.getPath('userData'), 'filelib_config.json')
            if (fs.existsSync(configPath)) {
              libBase = JSON.parse(fs.readFileSync(configPath, 'utf-8')).path || ''
            }
          } catch { /* 没有配置则用默认路径 */ }

          if (libBase) {
            // 直接保存到文件库
            const dir = `${libBase.replace(/\\/g, '/')}/images/${dateStr}`
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            const name = `screenshot_${Date.now()}.${ext}`
            const filePath = `${dir}/${name}`
            // 解码 base64 并写入二进制
            fs.writeFileSync(filePath, Buffer.from(raw, 'base64'))
            savedPaths.push(filePath)
            logger.info(`Saved screenshot to filelib: ${filePath}`)
          } else {
            // 保存到默认缓存目录
            const dir = p.join(app.getPath('userData'), 'filelib_cache', 'images', dateStr)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            const name = `screenshot_${Date.now()}.${ext}`
            const filePath = p.join(dir, name).replace(/\\/g, '/')
            fs.writeFileSync(filePath, Buffer.from(raw, 'base64'))
            savedPaths.push(filePath)
            logger.info(`Saved screenshot to cache: ${filePath}`)
          }
        } catch (e) {
          logger.error('Failed to save image:', e)
        }
      }

      if (savedPaths.length > 0) {
        // 生成文件 ID 并通知渲染进程
        const fileIds: string[] = []
        for (const fp of savedPaths) {
          const fileId = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
          fileIds.push(fileId)
          // 维护文件 ID → 路径映射（存到内存或 IPC）
          try { getSetFileRefPath()(fileId, fp) } catch { /* ok */ }
        }
        // 通知渲染进程
        try {
          const win = windowService.getMainWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send(IpcChannel.Skill_Updated, { command: 'hub-image-saved', images: savedPaths })
          }
        } catch { /* ok */ }
        // 将图片路径作为 resource 加入结果，渲染进程据此显示图片
        const imgRefs = savedPaths.map((fp) => ({
          type: 'resource' as const,
          resource: { uri: `file://${fp.replace(/\\/g, '/')}`, mimeType: 'image/png' }
        }))
        const textSummary = `[System: 截图已保存至 ${savedPaths[0]}。摘要: 页面快照]`
        // 保留原始图片数据 + 添加 resource 文件引用 + 文字摘要
        // 原始 image 数据保留后，渲染进程的 extractImagesFromToolOutput 能提取并展示到聊天
        const originalContent = result.content || []
        result.content = [...originalContent, ...imgRefs, { type: 'text', text: textSummary }]
        return result
      }
    }
  }

  return extractToolResult(result)
}

export const abortMcpTool = async (callId: string): Promise<boolean> => {
  return mcpService.abortTool(null as unknown as Electron.IpcMainInvokeEvent, callId)
}

function extractToolResult(result: MCPCallToolResponse): unknown {
  // Some MCP tools deliver their payload exclusively via structuredContent
  // with an empty content array; surface it instead of returning null.
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent
  }

  if (!result.content || result.content.length === 0) {
    return null
  }

  const textBlocks = result.content.filter(
    (item): item is MCPToolResultContent & { type: 'text'; text: string } =>
      item.type === 'text' && typeof item.text === 'string'
  )

  // Non-text-only (image/audio/resource) or mixed (text + non-text): return
  // the first text block when present, otherwise the raw array. Proper
  // multimodal content handling (base64 placeholders, etc.) is tracked in
  // #13209; expanding that here would risk base64 payloads being serialized
  // into LLM messages (see #12735).
  if (textBlocks.length !== result.content.length) {
    if (textBlocks.length === 0) {
      return result.content
    }
    try {
      return JSON.parse(textBlocks[0].text)
    } catch {
      return textBlocks[0].text
    }
  }

  // Single text block keeps the historical behavior so `exec` user code that
  // accesses parsed object fields directly continues to work unchanged.
  if (textBlocks.length === 1) {
    try {
      return JSON.parse(textBlocks[0].text)
    } catch {
      return textBlocks[0].text
    }
  }

  // Multi-block responses: previously only `content[0]` was returned, silently
  // dropping every block after the first. Parse each block and return them as
  // an array so the full payload reaches both `invoke` and `exec`.
  return textBlocks.map((block) => {
    try {
      return JSON.parse(block.text)
    } catch {
      return block.text
    }
  })
}

function throwIfToolError(result: MCPCallToolResponse): void {
  if (!result.isError) {
    return
  }

  const textContent = extractTextContent(result.content)
  throw new Error(textContent ?? 'Tool execution failed')
}

function extractTextContent(content: MCPToolResultContent[] | undefined): string | undefined {
  if (!content || content.length === 0) {
    return undefined
  }

  // Join every text block so multi-block error payloads surface in full
  // instead of being truncated to the first block.
  const textParts = content
    .filter(
      (item): item is MCPToolResultContent & { type: 'text'; text: string } =>
        item.type === 'text' && typeof item.text === 'string' && item.text.length > 0
    )
    .map((item) => item.text)

  return textParts.length > 0 ? textParts.join('\n') : undefined
}
