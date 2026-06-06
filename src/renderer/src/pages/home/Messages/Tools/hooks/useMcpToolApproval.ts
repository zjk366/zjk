import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer, MCPToolResponse } from '@renderer/types'
import { getEffectiveMcpMode } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'

/** 全局 MCP 自动模式标志（由 MCPToolsButton 切换时设置，持久化到 localStorage） */
const GLOBAL_KEY = '__mcp_auto_mode'
const STORAGE_KEY = 'mcp_auto_mode'
const EVENT_NAME = 'mcp-auto-mode-changed'
export function setGlobalAutoMode(v: boolean) {
  (window as any)[GLOBAL_KEY] = v
  localStorage.setItem(STORAGE_KEY, String(v))
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: v }))
}
export function getGlobalAutoMode() {
  const mem = !!(window as any)[GLOBAL_KEY]
  if (mem) return true
  // 兜底：从 localStorage 读取持久化值（跨页面刷新）
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'true') {
    (window as any)[GLOBAL_KEY] = true
    return true
  }
  return false
}

import {
  cancelToolAction,
  confirmToolAction,
  isToolPending,
  onToolPendingChange
} from '@renderer/utils/userConfirmation'
import { useCallback, useEffect, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

/**
 * Resolve a hub tool (invoke/exec) to the underlying server and tool name.
 * Returns null if the tool is not a hub tool or resolution fails.
 */
async function resolveHubToolServer(
  tool: { serverId: string; name: string },
  toolResponse: MCPToolResponse | undefined,
  mcpServers: MCPServer[]
): Promise<{ server: MCPServer; toolName: string } | null> {
  if (tool.serverId !== 'hub' || (tool.name !== 'invoke' && tool.name !== 'exec')) {
    return null
  }
  const toolArgs = toolResponse?.arguments as Record<string, unknown> | undefined
  const underlyingToolName = toolArgs?.name as string | undefined
  if (!underlyingToolName) return null

  try {
    const resolved = await window.api.mcp.resolveHubTool(underlyingToolName)
    if (!resolved) return null
    const server = mcpServers.find((s) => s.id === resolved.serverId)
    if (!server) return null
    return { server, toolName: resolved.toolName }
  } catch {
    return null
  }
}

/**
 * Hook for MCP tool approval logic
 * Extracts approval state management from MessageMcpTool
 */
export function useMcpToolApproval(block: ToolMessageBlock): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const { mcpServers, updateMCPServer } = useMCPServers()
  const { agent } = useActiveAgent()

  const toolResponse = block.metadata?.rawMcpToolResponse as MCPToolResponse | undefined
  const tool = toolResponse?.tool
  const id = toolResponse?.id ?? ''
  const status = toolResponse?.status

  // Force re-render when requestToolConfirmation() is called for this tool.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!id) return
    return onToolPendingChange((toolId) => {
      if (toolId === id) forceUpdate()
    })
  }, [id])

  // 监听全局自动模式切换，立即重渲染
  useEffect(() => {
    const handler = () => forceUpdate()
    window.addEventListener('mcp-auto-mode-changed', handler)
    return () => window.removeEventListener('mcp-auto-mode-changed', handler)
  }, [])

  // 视 'pending' 和 'streaming' 为进行中状态。
  // streaming 期间工具可能已开始执行，此时应显示中止按钮而非等待审批。
  // 只要状态不是 'done'/'error'，都算活跃（让中止按钮持续可见）。
  const isPending = status === 'pending' || status === 'streaming'

  // For hub invoke/exec tools, resolve the underlying server asynchronously
  // so the UI auto-approve state matches the execution layer's decision.
  const [hubResolvedAutoApproved, setHubResolvedAutoApproved] = useState(false)
  useEffect(() => {
    if (!tool || tool.serverId !== 'hub' || (tool.name !== 'invoke' && tool.name !== 'exec')) {
      setHubResolvedAutoApproved(false)
      return
    }
    let cancelled = false
    void resolveHubToolServer(tool, toolResponse, mcpServers).then((result) => {
      if (cancelled) return
      if (result) {
        setHubResolvedAutoApproved(!result.server.disabledAutoApproveTools?.includes(result.toolName))
      } else {
        setHubResolvedAutoApproved(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [tool, toolResponse, mcpServers])

  const isAutoApproved = (() => {
    if (!tool) return false
    // Auto mode → all tools auto-approved（全局标志，由 MCPToolsButton 设置）
    if (getGlobalAutoMode()) return true
    // Check basic auto-approve (built-in, agent allowed_tools, server-level)
    const basicApproved = isToolAutoApproved(
      tool,
      mcpServers.find((s) => s.id === tool.serverId),
      agent?.allowed_tools
    )
    if (basicApproved) return true
    // For hub invoke/exec, use the async-resolved underlying server result
    return hubResolvedAutoApproved
  })()

  const [isConfirmed, setIsConfirmed] = useState(isAutoApproved)

  // Compute approval states
  const isWaiting = isPending && !isAutoApproved && !isConfirmed
  // 已批准后，只要工具还在跑（pending/streaming）就持续显示中止按钮
  // done/error 时 isPending 为 false，自然隐藏
  const isExecuting = isPending && !isWaiting

  const confirm = useCallback(() => {
    setIsConfirmed(true)
    confirmToolAction(id)
  }, [id])

  const cancel = useCallback(() => {
    cancelToolAction(id)
  }, [id])

  const autoApprove = useCallback(async () => {
    if (!tool || !tool.name) {
      return
    }

    // Try to resolve hub tools to the underlying server
    const hubResult = await resolveHubToolServer(tool, toolResponse, mcpServers)

    // Determine which server and tool name to update
    const server = hubResult?.server ?? mcpServers.find((s) => s.id === tool.serverId)
    const toolNameToApprove = hubResult?.toolName ?? tool.name

    if (!server) {
      // Even if we can't persist auto-approve, confirm the current tool
      setIsConfirmed(true)
      confirmToolAction(id)
      return
    }

    let disabledAutoApproveTools = [...(server.disabledAutoApproveTools || [])]

    // Remove tool from disabledAutoApproveTools to enable auto-approve
    disabledAutoApproveTools = disabledAutoApproveTools.filter((name) => name !== toolNameToApprove)

    updateMCPServer({ ...server, disabledAutoApproveTools })

    // Confirm the current tool. The execution layer will auto-confirm other
    // pending tools with the same name via confirmSameNameTools.
    setIsConfirmed(true)
    confirmToolAction(id)

    window.toast.success(t('message.tools.autoApproveEnabled', 'Auto-approve enabled for this tool'))
  }, [tool, toolResponse, mcpServers, updateMCPServer, id, t])

  return {
    // State
    isWaiting,
    isExecuting,
    isSubmitting: false,
    input: undefined,

    // Actions
    confirm,
    cancel,
    autoApprove: isWaiting ? autoApprove : undefined
  }
}
