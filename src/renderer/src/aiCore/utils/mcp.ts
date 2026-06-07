import { loggerService } from '@logger'
import store from '@renderer/store'
import type { MCPCallToolResponse, MCPTool, MCPToolResponse } from '@renderer/types'
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
          const safeUri = item.resource.uri?.startsWith('data:') ? '(base64)' : (item.resource.uri || 'unknown')
          parts.push(
            `[Resource: ${item.resource.mimeType || 'application/octet-stream'}, uri=${safeUri}, delivered to user]`
          )
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
          if (
            mcpTool.serverId === 'hub' &&
            (mcpTool.name === 'invoke' || mcpTool.name === 'exec')
          ) {
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
        if (result.isError) {
          return Promise.reject(result)
        }

        // 保存截图图片：同时存入文件库（如已设置）和内部存储
        if (result?.content) {
          const imageItems = result.content.filter((c: any) => c.type === 'image' && c.data)
          let savedCount = 0
          for (const img of imageItems) {
            try {
              const raw = img.data.startsWith('data:') ? img.data.split(',')[1] : img.data
              const binary = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
              const ext = img.mimeType === 'image/jpeg' ? 'jpeg' : 'png'

              // 1. 保存到内部存储（用于聊天显示）
              const meta: any = await window.api.file.savePastedImage(binary, ext)

              // 2. 同时保存到文件库目录（如已配置）
              try {
                const libPath = localStorage.getItem('filelib_path')
                if (libPath) {
                  const dateStr = new Date().toISOString().slice(0, 7) // 2026-06
                  const dir = `${libPath.replace(/\\/g, '/')}/images/${dateStr}`
                  const name = `screenshot_${Date.now()}.${ext}`
                  // 确保目录存在
                  await (window as any).api?.file?.mkdir(dir).catch(() => {})
                  await (window as any).api?.file?.write(`${dir}/${name}`, binary)
                }
              } catch { /* 文件库保存失败不影响主流程 */ }

              if (meta) {
                savedCount++
                const filePath = meta.path?.replace(/\\/g, '/')
                result.content.push({
                  type: 'text',
                  text: `\n[Screenshot saved to: ${filePath}]\n`
                })
              }
            } catch { /* skip */ }
          }
          if (savedCount > 0) {
            window.toast?.success?.(`已保存 ${savedCount} 张截图到文件库`)
          }
        }

        // 返回工具执行结果
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
