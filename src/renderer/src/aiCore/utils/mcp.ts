import { loggerService } from '@logger'
import MonitorService from '@renderer/services/MonitorService'
import store from '@renderer/store'
import { FILE_TYPE, type MCPCallToolResponse, type MCPTool, type MCPToolResponse } from '@renderer/types'
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

import { type ClarifyParams, waitForUserChoice } from './clarify'

const logger = loggerService.withContext('MCP-utils')

// write_code_file 创建的脚本文件路径列表
// 所有脚本都是中间产物，执行完毕后自动清理
const allWrittenPaths: string[] = []

/** 删除一个文件（静默失败） */
async function deleteFileSafely(path: string) {
  try {
    await window.api.file.deleteExternalFile(path)
  } catch {
    /* 文件可能已被删除 */
  }
}

/** 清理所有 tracked 的旧脚本文件 */
async function cleanupOldScripts() {
  for (const oldPath of allWrittenPaths) {
    await deleteFileSafely(oldPath)
  }
  allWrittenPaths.length = 0
}

/** 写入后延迟删除（双保险：防止没有下一次写入时文件残留） */
function scheduleCleanup(path: string, delayMs = 180_000) {
  setTimeout(async () => {
    const idx = allWrittenPaths.indexOf(path)
    if (idx >= 0) {
      allWrittenPaths.splice(idx, 1)
      await deleteFileSafely(path)
    }
  }, delayMs)
}

// Setup tools configuration based on provided parameters
export function setupToolsConfig(
  mcpTools?: MCPTool[],
  allowedTools?: string[]
): Record<string, Tool<any, any>> | undefined {
  let tools: ToolSet = {}

  if (mcpTools?.length) {
    tools = convertMcpToolsToAiSdkTools(mcpTools, allowedTools)
  }

  // ask_user — 中轮转向工具：向用户提问并等待选择/输入
  // 当任务需要用户决策、确认方向或提供额外信息时使用。
  // 与 Claude Code agent 的 AskUserQuestion 不同，此工具走通用 Promise 挂起模式，
  // 不经过权限系统，所有模型均可调用。
  tools['ask_user'] = tool({
    description:
      '向用户提问获取决策或信息。当任务需要用户选择方向、确认细节或提供缺失信息时使用。不要猜测用户的偏好，直接问。',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        question: { type: 'string', description: '要问用户的完整问题' },
        choices: {
          type: 'array',
          items: { type: 'string' },
          description: '选项列表（最多 6 个），用户可直接点击选择。不传则仅显示输入框。'
        },
        allowFreeText: {
          type: 'boolean',
          description: '是否允许用户自由输入。默认 true（有 choices 时也允许自由输入）。'
        },
        mode: {
          type: 'string',
          enum: ['single', 'multiple', 'input'],
          description:
            '选择模式：single=单选用Radio，multiple=多选用Checkbox，input=仅输入框。默认根据choices和allowFreeText自动决定。'
        }
      },
      required: ['question']
    } as any),
    execute: async (params: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
      const question = String(params.question || '')
      const choices = (params.choices as string[]) || []
      const allowFreeText = params.allowFreeText !== false
      const mode = (params.mode as string) || (choices.length > 0 ? 'single' : 'input')

      logger.info(`[Clarify] ask_user: ${question} (mode=${mode}, choices=${choices.length})`)

      // 挂起当前推理，等待用户选择
      return await waitForUserChoice(toolCallId, {
        question,
        choices,
        allowFreeText,
        mode: mode as ClarifyParams['mode']
      })
    }
  })

  // write_code_file — 直接写入代码/脚本文件，避免终端 echo 的 shell 转义问题
  // 用于创建 Python/JS/PowerShell 等脚本，写入后由 terminal 执行。
  // 临时文件自清理：每次写入新文件前，自动删除上一次的临时文件。
  tools['write_code_file'] = tool({
    description:
      '直接写入代码文件到磁盘（避免终端 echo 的 shell 转义问题）。' +
      '当需要创建 Python/JS/Shell 等脚本时使用此工具替代 terminal echo 写入。' +
      '写入后请用 terminal 执行。' +
      '用户指定了保存位置时传绝对路径（如 C:\\Users\\xxx\\Documents\\script.py）；' +
      '用户未指定位置时不传 file_path，文件自动存入临时目录，历史临时文件自动清理。',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '（可选）用户指定的保存路径，绝对路径。不传则自动存入临时目录。' },
        content: { type: 'string', description: '文件内容，直接原样写入，无需转义' }
      },
      required: ['content']
    } as any),
    execute: async ({ file_path, content }: { file_path?: string; content: string }) => {
      try {
        // 清理上一次的脚本文件（中间产物不留痕迹）
        await cleanupOldScripts()

        let targetPath: string

        if (file_path) {
          const isAbsolute =
            file_path.startsWith('/') || /^[a-zA-Z]:\\/.test(file_path) || /^[a-zA-Z]:\//.test(file_path)
          targetPath = isAbsolute
            ? file_path
            : [await window.api.file.getHomeDir(), file_path].join('/').replace(/\\/g, '/')

          const parentDir = targetPath.substring(0, Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\')))
          if (parentDir) await window.api.file.mkdir(parentDir).catch(() => {})
        } else {
          targetPath = await window.api.file.createTempFile(`script_${Date.now()}.py`)
        }

        await window.api.file.write(targetPath, content)
        allWrittenPaths.push(targetPath)

        // 3分钟后自动删除（双保险：即使没有下一次写入，文件也不会残留）
        scheduleCleanup(targetPath)

        logger.info(`[write_code_file] Written to ${targetPath}`)
        return `文件已写入: ${targetPath}\n\n请使用 terminal 执行此脚本。`
      } catch (err: any) {
        return `写入失败: ${err?.message || '未知错误'}`
      }
    }
  })

  return Object.keys(tools).length > 0 ? (tools as any) : undefined
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

          const savedImageCount = 0
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

  // 任务拆解与跟踪工具
  const planStore = new Map<string, { steps: any[] }>()
  tools['plan_task'] = tool({
    description:
      '在开始复杂任务之前，拆解执行步骤并记录到计划中。每完成一步更新状态。如果某步失败则记录失败原因并尝试替代方案。',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['init', 'update', 'get'],
          description: 'init=创建新计划, update=更新步骤状态, get=查看当前计划'
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              description: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] }
            }
          },
          description: '步骤列表（init 时必填）'
        },
        step_id: { type: 'string', description: '要更新的步骤 ID（update 时必填）' },
        new_status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'failed'],
          description: '新状态（update 时必填）'
        },
        error_type: {
          type: 'string',
          description: '失败时的错误分类：NETWORK_ERROR / TOOL_ERROR / PACKAGE_ERROR / UNKNOWN'
        },
        suggestion: { type: 'string', description: '失败时的替代方案建议' },
        plan_id: { type: 'string', description: '计划 ID，不传则自动生成' }
      },
      required: ['action']
    } as any),
    execute: async ({ action, steps, step_id, new_status, error_type, suggestion, plan_id: inputPlanId }: any) => {
      const planId = inputPlanId || `plan_${Date.now()}`
      if (action === 'init') {
        const plan = { steps: (steps || []).map((s: any) => ({ ...s, status: s.status || 'pending' })) }
        planStore.set(planId, plan)
        return `计划已创建 (${planId})，共 ${plan.steps.length} 步。\n${plan.steps.map((s: any, i: number) => `${i + 1}. [${s.status}] ${s.description}`).join('\n')}`
      }
      const plan = planStore.get(planId)
      if (!plan) return `未找到计划: ${planId}`
      if (action === 'update') {
        const step = plan.steps.find((s: any) => s.id === step_id)
        if (!step) return `未找到步骤: ${step_id}`
        step.status = new_status
        if (new_status === 'failed') {
          step.error_type = error_type || 'UNKNOWN'
          step.suggestion = suggestion || ''
        }
        const failedSteps = plan.steps.filter((s: any) => s.status === 'failed')
        const completedSteps = plan.steps.filter((s: any) => s.status === 'completed')
        let summary = `步骤 ${step_id} 已更新为 ${new_status}\n`
        summary += `进度: ${completedSteps.length}/${plan.steps.length}\n`
        if (failedSteps.length > 0) {
          summary += `失败步骤: ${failedSteps.map((s: any) => `${s.description}[${s.error_type}]`).join(', ')}\n`
          summary += `建议: ${failedSteps[0].suggestion || '尝试替代方案或重试'}`
        }
        return summary
      }
      if (action === 'get') {
        const completed = plan.steps.filter((s: any) => s.status === 'completed').length
        return `计划 (${planId}) ${completed}/${plan.steps.length}\n${plan.steps
          .map(
            (s: any, i: number) =>
              `${i + 1}. [${s.status}] ${s.description}${s.error_type ? ` (${s.error_type})` : ''}${s.suggestion ? ` → ${s.suggestion}` : ''}`
          )
          .join('\n')}`
      }
      return `未知操作: ${action}`
    }
  })

  return tools
}
