import { loggerService } from '@logger'
import MonitorService from '@renderer/services/MonitorService'
import store from '@renderer/store'
import type { MCPCallToolResponse, MCPTool, MCPToolResponse } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import { callMCPTool, getMcpServerByTool, isToolAutoApproved } from '@renderer/utils/mcp-tools'
import {
  confirmSameNameTools,
  requestToolConfirmation,
  sendToolApprovalNotification,
  setToolIdToNameMapping
} from '@renderer/utils/userConfirmation'
import { type Tool, type ToolSet } from 'ai'
import { jsonSchema, tool } from 'ai'
import type { JSONSchema7 } from 'json-schema'

const logger = loggerService.withContext('MCP-utils')

// Setup tools configuration based on provided parameters
export function setupToolsConfig(
  mcpTools?: MCPTool[],
  allowedTools?: string[]
): Record<string, Tool<any, any>> | undefined {
  let tools: ToolSet = {}

  if (!mcpTools?.length) {
    return undefined
  }

  tools = convertMcpToolsToAiSdkTools(mcpTools, allowedTools)

  return tools
}

/** MIME 类型到友好描述的映射 */
const MIME_DESC_MAP: Record<string, string> = {
  'application/pdf': 'PDF 文档',
  'application/json': 'JSON 文件',
  'application/xml': 'XML 文件',
  'application/zip': 'ZIP 压缩包',
  'application/gzip': 'GZIP 压缩包',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel 表格',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word 文档',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPT 演示文稿',
  'application/vnd.ms-excel': 'Excel 表格',
  'application/msword': 'Word 文档',
  'text/csv': 'CSV 文件',
  'text/plain': '文本文件',
  'text/html': 'HTML 文件',
  'text/markdown': 'Markdown 文件'
}

function getMimeDescription(mimeType: string): string {
  return MIME_DESC_MAP[mimeType] || mimeType
}

/** MIME 类型到扩展名映射 */
const MIME_EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/json': '.json',
  'application/xml': '.xml',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/markdown': '.md'
}

function mimeToExt(mimeType: string): string {
  return MIME_EXT_MAP[mimeType] || `.${mimeType.split('/')[1] || 'bin'}`
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

/**
 * 检查 MCP 工具调用结果是否包含可能携带大体积 base64 数据的多模态内容。
 * 包括 image、audio 以及含 blob 的 resource 类型。
 */
export function hasMultimodalContent(result: MCPCallToolResponse): boolean {
  return (
    Array.isArray(result?.content) &&
    result.content.some(
      (item) => item.type === 'image' || item.type === 'audio' || (item.type === 'resource' && !!item.resource?.blob)
    )
  )
}

/**
 * 将 MCP 工具调用结果转换为纯文本摘要，把图片/音频/resource blob 替换为文本占位描述，
 * 避免 base64 数据超出消息大小限制（如 kimi 的 4MB 限制）。
 */
export function mcpResultToTextSummary(result: MCPCallToolResponse): string {
  if (!result || !result.content || !Array.isArray(result.content)) {
    return JSON.stringify(result)
  }

  const parts: string[] = []
  for (const item of result.content) {
    switch (item.type) {
      case 'text':
        parts.push(item.text || '')
        break
      case 'image':
        // 图片通过 IMAGE_COMPLETE chunk 显示，这里只返回简短描述
        parts.push('[截图已生成，见上方图片]')
        break
      case 'audio':
        parts.push(`[Audio: ${item.mimeType || 'audio/mp3'}, delivered to user]`)
        break
      case 'resource':
        if (item.resource?.blob) {
          const mime = item.resource.mimeType || 'application/octet-stream'
          if (isImageMime(mime)) {
            parts.push('[截图已生成，见上方图片]')
          } else {
            const desc = getMimeDescription(mime)
            parts.push(`[${desc} 已保存到文件库]`)
          }
        } else {
          parts.push(item.resource?.text || JSON.stringify(item))
        }
        break
      default:
        parts.push(JSON.stringify(item))
        break
    }
  }

  return parts.join('\n')
}

/**
 * 将 MCPTool 转换为 AI SDK 工具格式
 */
export function convertMcpToolsToAiSdkTools(mcpTools: MCPTool[], allowedTools?: string[]): ToolSet {
  const tools: ToolSet = {}

  for (const mcpTool of mcpTools) {
    // Use mcpTool.id (which includes serverId suffix) to ensure uniqueness
    // when multiple instances of the same MCP server type are configured
    tools[mcpTool.id] = tool({
      description: mcpTool.description || `Tool from ${mcpTool.serverName}`,
      inputSchema: jsonSchema(mcpTool.inputSchema as JSONSchema7),
      execute: async (params, { toolCallId }) => {
        // 检查是否启用自动批准
        const server = getMcpServerByTool(mcpTool)
        let isAutoApproveEnabled = isToolAutoApproved(mcpTool, server, allowedTools)

        // 全局自动模式已开启 → 无需额外解析，直接执行
        if (!isAutoApproveEnabled) {
          // For hub invoke/exec, resolve the underlying tool and check its server's auto-approve config
          if (mcpTool.serverId === 'hub' && (mcpTool.name === 'invoke' || mcpTool.name === 'exec')) {
            const underlyingToolName = (params as Record<string, unknown>)?.name as string | undefined
            if (underlyingToolName) {
              try {
                const resolved = await window.api.mcp.resolveHubTool(underlyingToolName)
                if (resolved) {
                  const underlyingServer = store.getState().mcp.servers.find((s) => s.id === resolved.serverId)
                  if (underlyingServer) {
                    isAutoApproveEnabled = !underlyingServer.disabledAutoApproveTools?.includes(resolved.toolName)
                  }
                }
              } catch (err) {
                logger.warn('Failed to resolve hub tool for auto-approve check', err as Error)
              }
            }
          }
        }

        let confirmed = true

        if (!isAutoApproveEnabled) {
          // Register mapping so confirmSameNameTools can batch-confirm pending tools.
          // For hub invoke/exec, use the underlying tool name so tools targeting the
          // same underlying server+tool are grouped together.
          const mappingName =
            mcpTool.serverId === 'hub' && (mcpTool.name === 'invoke' || mcpTool.name === 'exec')
              ? ((params as Record<string, unknown>)?.name as string) || mcpTool.name
              : mcpTool.name
          setToolIdToNameMapping(toolCallId, mappingName)

          // Send system notification for tool approval
          sendToolApprovalNotification(mcpTool.name)

          // 请求用户确认
          logger.debug(`Requesting user confirmation for tool: ${mcpTool.name}`)
          confirmed = await requestToolConfirmation(toolCallId)

          if (confirmed) {
            // Auto-confirm other pending tools with the same name
            confirmSameNameTools(mappingName)
          }
        }

        if (!confirmed) {
          // 用户拒绝执行工具
          logger.debug(`User cancelled tool execution: ${mcpTool.name}`)
          return {
            content: [
              {
                type: 'text',
                text: `User declined to execute tool "${mcpTool.name}".`
              }
            ],
            isError: false
          }
        }

        // 用户确认或自动批准，执行工具
        logger.debug(`Executing tool: ${mcpTool.name}`)

        // 向 MonitorService 注册当前 toolCallId（供停止按钮中止）
        try {
          MonitorService.getInstance().setCurrentToolCallId(toolCallId)
        } catch {
          /* ok */
        }

        // ── 回溯备份：执行前检测破坏性操作，备份原文件 ──
        let vaultEntryId: string | null = null
        try {
          const fp = (params as any)?.file_path || (params as any)?.path || ''

          if (fp) {
            // MCP filesystem 工具：write（覆写）/ delete / edit 等
            const content = await (window as any).api?.file?.readExternal(fp).catch(() => null)
            if (content !== null && typeof content === 'string' && content.length > 0) {
              vaultEntryId = await (window as any).api?.undoVault?.backupContent(fp, content, mcpTool.name)
            }
          }
          // 终端命令的 vault 标记在 result 中，执行后解析
        } catch {
          /* 回溯备份失败不影响主流程 */
        }

        // 创建适配的 MCPToolResponse 对象
        const toolResponse: MCPToolResponse = {
          id: toolCallId,
          tool: mcpTool,
          arguments: params,
          status: 'pending',
          toolCallId
        }

        const result = await callMCPTool(toolResponse)

        // 返回结果，AI SDK 会处理序列化
        // 注意：不要对 isError 结果使用 Promise.reject，否则 AI SDK 可能终止流
        // 而不是将错误信息传给模型继续生成回复

        // 保存截图图片 + 非图片文件：同时存入文件库（如已设置）和内部存储
        if (result?.content) {
          // 收集所有需要保存的条目（图片 + 非图片 resource blob）
          const saveItems: { data: string; mimeType: string; isImage: boolean }[] = []
          for (const c of result.content as any[]) {
            if (c.type === 'image' && c.data) {
              saveItems.push({ data: c.data, mimeType: c.mimeType || 'image/png', isImage: true })
            }
            if (c.type === 'resource' && c.resource?.blob) {
              const mime = c.resource.mimeType || 'application/octet-stream'
              saveItems.push({ data: c.resource.blob, mimeType: mime, isImage: isImageMime(mime) })
            }
          }

          let savedImageCount = 0
          let savedFileCount = 0
          for (const item of saveItems) {
            try {
              const raw = item.data.startsWith('data:') ? item.data.split(',')[1] : item.data
              const binary = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
              const ext = mimeToExt(item.mimeType).replace('.', '') || (item.isImage ? 'png' : 'bin')

              // 1. 图片通过 IMAGE_COMPLETE chunk 显示和保存（在 onImageGenerated 中处理）
              // 这里不再重复保存，避免文件库出现重复文件
              if (item.isImage) {
                // 仅在 result 中添加文本提示，不重复保存文件
                result.content.push({
                  type: 'text',
                  text: '\n[截图已生成，见上方图片]\n'
                })
              } else {
                // 非图片文件保存到托管存储
                try {
                  const api = (window as any).api?.file
                  if (api?.createTempFile && api?.write && api?.upload) {
                    const tempPath = await api.createTempFile(`tool_file_${Date.now()}.${ext}`)
                    if (tempPath) {
                      // 写入数据到临时文件
                      await api.write(tempPath, binary)
                      // 导入到托管存储
                      const savedFile = await api.upload({
                        id: '',
                        origin_name: `tool_file_${Date.now()}.${ext}`,
                        name: `tool_file_${Date.now()}.${ext}`,
                        path: tempPath,
                        created_at: new Date().toISOString(),
                        size: binary.length,
                        ext,
                        type: FILE_TYPE.OTHER,
                        count: 1
                      })
                      // 清理临时文件
                      if (api.deleteExternalFile) {
                        try {
                          await api.deleteExternalFile(tempPath)
                        } catch {
                          /* ok */
                        }
                      }
                      if (savedFile) {
                        savedFileCount++
                        result.content.push({
                          type: 'text',
                          text: `\n[File saved to: ${(savedFile as any).path?.replace(/\\/g, '/') || 'managed storage'}]\n`
                        })
                      }
                    }
                  }
                } catch {
                  /* 托管存储保存失败不影响主流程 */
                }
              }

              // 2. 同时保存到文件库目录（如已配置）
              try {
                const libPath = localStorage.getItem('filelib_path')
                if (libPath) {
                  const dateStr = new Date().toISOString().slice(0, 7) // 2026-06
                  const subDir = item.isImage ? 'images' : 'files'
                  const dir = `${libPath.replace(/\\/g, '/')}/${subDir}/${dateStr}`
                  const prefix = item.isImage ? 'screenshot' : 'file'
                  const name = `${prefix}_${Date.now()}.${ext}`
                  // 确保目录存在
                  await (window as any).api?.file?.mkdir(dir).catch(() => {})
                  await (window as any).api?.file?.write(`${dir}/${name}`, binary)
                }
              } catch {
                /* 文件库保存失败不影响主流程 */
              }
            } catch {
              /* skip */
            }
          }
          const totalSaved = savedImageCount + savedFileCount
          if (totalSaved > 0) {
            const parts: string[] = []
            if (savedImageCount > 0) parts.push(`${savedImageCount} 张截图`)
            if (savedFileCount > 0) parts.push(`${savedFileCount} 个文件`)
            window.toast?.success?.(`已保存 ${parts.join('，')} 到文件库`)
          }
        }

        // ── 解析终端命令结果中的 vaultEntryId 标记 ──
        if (!vaultEntryId) {
          try {
            const rc = (result as any)?.content as any[] | undefined
            if (Array.isArray(rc)) {
              const marker = rc.find((c: any) => c.type === 'resource' && c.resource?.text?.startsWith('__vault__:'))
              if (marker) vaultEntryId = marker.resource.text.replace('__vault__:', '')
            }
          } catch {
            /* ok */
          }
        }

        // 记录到监控室日志 + 实时屏幕（不论成功/失败都显示）
        try {
          const svc = MonitorService.getInstance()
          const resultContent = (result as any)?.content as any[] | undefined
          const hasImage = Array.isArray(resultContent) && resultContent.some((c: any) => c.type === 'image' && c.data)
          const hasText = Array.isArray(resultContent) && resultContent.some((c: any) => c.type === 'text')
          const cmd = (params as any)?.command || ''
          let desc = mcpTool.name
          const isBlocked = result.isError

          if (cmd) {
            // 终端命令
            desc = `终端命令: ${cmd.slice(0, 80)}`
            svc.startTerminalSession(cmd.slice(0, 200))
            if (Array.isArray(resultContent)) {
              const text = resultContent
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n')
              const lines = text.split('\n').filter(Boolean).slice(0, 80)
              for (const line of lines) {
                svc.appendTerminalLine(line, /error|error/i.test(line) ? 'stderr' : 'stdout')
              }
            }
            if (isBlocked) svc.appendTerminalLine('⛔ 操作被安全机制拦截', 'stderr')
          } else if (hasImage) {
            // 浏览器截图
            const imgItem = Array.isArray(resultContent) && resultContent.find((c: any) => c.type === 'image' && c.data)
            if (imgItem?.data) {
              svc.setBrowserImage(imgItem.data, (params as any)?.url || (params as any)?.name || 'browser')
            }
            desc = `截图 ${(params as any)?.url || ''}`
          } else if (hasText) {
            const fp = (params as any)?.file_path || (params as any)?.path || ''
            if (fp) desc = `操作 ${fp}`
          }

          svc.addLog(desc.slice(0, 120), isBlocked ? 'blocked' : 'ok', {
            source: mcpTool.serverName,
            retroData: vaultEntryId ? { vaultEntryId } : undefined
          })
        } catch {
          /* 监控日志不影响主流程 */
        }

        // 返回工具执行结果（含 isError 标识，AI SDK 会传给模型继续生成回复）
        if (result.isError) {
          logger.warn(`[ToolExecute] Tool ${mcpTool.name} returned error, passing to model`)
        }
        return result
      },
      // 将多模态结果 (image/audio/resource blob) 转为文本摘要，避免 base64 超出消息大小限制。
      // 图片/音频已通过 IMAGE_COMPLETE chunk 展示给用户。
      // TODO: 待 AI SDK 支持 provider 感知后，可按 provider 返回 media 格式。
      toModelOutput(rawOutput: unknown) {
        // AI SDK v4 的 toModelOutput 签名接收 { toolCallId, input, output }
        // 其中 output 才是 execute 返回的 MCPCallToolResponse
        const { output } = rawOutput as { output: MCPCallToolResponse }
        return { type: 'text' as const, value: mcpResultToTextSummary(output) }
      }
    })
  }

  return tools
}
