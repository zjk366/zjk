/**
 * ClarifyProvider — 中轮转向机制
 *
 * 模型调用 ask_user 工具时，execute 函数挂起一个 Promise，
 * 等待用户在 UI 层作出选择后 resolve。
 *
 * 流程：
 *   模型调用 ask_user(question, choices)
 *     → execute 存入 pendingMap 并挂起 Promise
 *     → dispatchEvent('clarify-ask') 通知 UI 渲染
 *     → UI 渲染选择组件
 *     → 用户选择 → resolveChoice(toolCallId, answer)
 *     → Promise resolve → 工具结果返回给模型
 *     → 模型拿到用户选择继续推理
 */

import type { MCPCallToolResponse } from '@renderer/types'

export interface ClarifyParams {
  question: string
  choices?: string[]
  allowFreeText?: boolean
  /** 选择模式: single=单选 multiple=多选 input=仅输入框。默认根据 choices 决定 */
  mode?: 'single' | 'multiple' | 'input'
}

export interface ClarifyPending {
  params: ClarifyParams
  resolve: (value: MCPCallToolResponse) => void
  reject: (error: Error) => void
  timestamp: number
}

const pendingMap = new Map<string, ClarifyPending>()

const CLARIFY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * 注册一个等待用户选择的 Promise。
 * 由 ask_user 工具的 execute 函数调用。
 */
export function waitForUserChoice(toolCallId: string, params: ClarifyParams): Promise<MCPCallToolResponse> {
  return new Promise<MCPCallToolResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingMap.delete(toolCallId)
      reject(new Error('用户未在 5 分钟内回答'))
    }, CLARIFY_TIMEOUT_MS)

    pendingMap.set(toolCallId, {
      params,
      resolve: (value) => {
        clearTimeout(timeout)
        pendingMap.delete(toolCallId)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timeout)
        pendingMap.delete(toolCallId)
        reject(error)
      },
      timestamp: Date.now()
    })

    // 通知 UI 层渲染选择组件
    window.dispatchEvent(
      new CustomEvent('clarify-ask', {
        detail: { toolCallId, ...params }
      })
    )
  })
}

/**
 * 用户作出选择后调用此函数，resolve 对应的 Promise。
 * 由 UI 层的 ClarifyCard 组件调用。
 */
export function resolveChoice(toolCallId: string, answer: string): boolean {
  const pending = pendingMap.get(toolCallId)
  if (!pending) return false

  pending.resolve({
    content: [
      {
        type: 'text',
        text: `用户选择了: ${answer}`
      }
    ],
    isError: false
  })

  // AI SDK v6 流式模式：ask_user 的 execute 不阻塞流，
  // tool-call 发出后流可能已结束（finish reason: 'tool-calls'），
  // 导致 tool-result 事件永远不会到达流处理器，消息卡在 processing。
  // 因此手动派发事件通知 UI 层更新块状态和消息状态。
  window.dispatchEvent(
    new CustomEvent('clarify-resolved', {
      detail: { toolCallId, answer }
    })
  )

  return true
}

/**
 * 用户取消/关闭时调用，reject 对应的 Promise。
 */
export function rejectChoice(toolCallId: string, reason?: string): boolean {
  const pending = pendingMap.get(toolCallId)
  if (!pending) return false

  pending.reject(new Error(reason || '用户取消了选择'))
  return true
}

/**
 * 检查是否有正在等待的 clarify 请求。
 */
export function hasPendingChoice(toolCallId: string): boolean {
  return pendingMap.has(toolCallId)
}

/**
 * 获取所有 pending 的请求信息（用于调试/监控）。
 */
export function getPendingRequests(): Array<{
  toolCallId: string
  params: ClarifyParams
  elapsed: number
}> {
  const now = Date.now()
  return Array.from(pendingMap.entries()).map(([toolCallId, pending]) => ({
    toolCallId,
    params: pending.params,
    elapsed: now - pending.timestamp
  }))
}
