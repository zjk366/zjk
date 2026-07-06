/**
 * ClarifyProvider — 中轮转向机制
 *
 * AI SDK v6 流式模式不支持工具 execute 函数挂起等待用户输入。
 * 因此 ask_user 不再返回 hanging Promise，而是立即返回占位结果，
 * 让 AI 流正常结束。用户作出选择后通过 form-answer 事件发送新消息，
 * AI 在新一轮对话中看到用户回答并继续推理。
 *
 * 流程：
 *   模型调用 ask_user(question, choices)
 *     → execute 立即返回占位文本 "等待用户输入..."
 *     → AI 流正常结束（不会再卡在 processing）
 *     → dispatchEvent('clarify-ask') 通知 UI 渲染选择组件
 *     → UI 渲染表单
 *     → 用户选择 → resolveChoice(toolCallId, answer)
 *     → 派发 form-answer 自定义事件
 *     → Inputbar 监听 form-answer，发送一条系统角色消息
 *     → 模型在新一轮对话中看到用户回答并继续推理
 */

export interface ClarifyParams {
  question: string
  choices?: string[]
  allowFreeText?: boolean
  /** 选择模式: single=单选 multiple=多选 input=仅输入框。默认根据 choices 决定 */
  mode?: 'single' | 'multiple' | 'input'
}

export interface ClarifyPending {
  params: ClarifyParams
  timestamp: number
}

/** 存储当前待响应的 ask_user 请求（只用于 UI 渲染，不再用于 Promise 挂起） */
const pendingMap = new Map<string, ClarifyPending>()

/**
 * 注册一个 ask_user 请求并通知 UI 渲染表单。
 * AI SDK v6 流式模式不支持工具 execute 阻塞，因此立即返回占位结果，
 * 让 AI 流正常结束。用户回答后通过 form-answer 事件启动新对话轮次。
 *
 * @param toolCallId 工具调用 ID
 * @param params 参数（问题、选项、模式）
 * @returns 占位结果，不会阻塞
 */
export function waitForUserChoice(
  toolCallId: string,
  params: ClarifyParams
): { content: Array<{ type: 'text'; text: string }>; isError: false } {
  pendingMap.set(toolCallId, {
    params,
    timestamp: Date.now()
  })

  // 通知 UI 层渲染选择组件
  window.dispatchEvent(
    new CustomEvent('clarify-ask', {
      detail: { toolCallId, ...params }
    })
  )

  // AI SDK v6 流式模式不支持 execute 挂起，立即返回占位结果。
  // 用户回答后通过 Inputbar 的 form-answer 事件发送新消息启动下一轮。
  return {
    content: [{ type: 'text' as const, text: '__ASK_USER_PENDING__' }],
    isError: false
  }
}

/**
 * 用户作出选择后调用此函数。
 * 不再 resolve Promise（因为 execute 已返回），
 * 而是派发 form-answer 事件让 Inputbar 发送新消息给 AI。
 *
 * @param toolCallId 工具调用 ID
 * @param answer 用户回答文本
 * @returns 是否成功派发
 */
export function resolveChoice(toolCallId: string, answer: string): boolean {
  const pending = pendingMap.get(toolCallId)
  if (!pending) return false

  // 不再 resolve Promise（流已结束，无消费者），
  // 改为通过 form-answer 事件让 Inputbar 发送一条新消息给 AI。
  pendingMap.delete(toolCallId)

  window.dispatchEvent(
    new CustomEvent('form-answer', {
      detail: `[用户回答]: ${answer}`
    })
  )

  // 同时通知 UI 更新表单显示为已提交状态
  window.dispatchEvent(
    new CustomEvent('clarify-resolved', {
      detail: { toolCallId, answer }
    })
  )

  return true
}

/**
 * 用户取消/关闭时调用。
 */
export function rejectChoice(toolCallId: string, reason?: string): boolean {
  const pending = pendingMap.get(toolCallId)
  if (!pending) return false

  pendingMap.delete(toolCallId)

  window.dispatchEvent(
    new CustomEvent('form-answer', {
      detail: `[用户取消]: ${reason || '未提供原因'}`
    })
  )
  return true
}

/**
 * 检查指定的 toolCallId 是否有正在等待的 clarify 请求。
 */
export function hasPendingChoice(toolCallId: string): boolean {
  return pendingMap.has(toolCallId)
}

/**
 * 检查是否有任何正在等待的 clarify 请求。
 * 用于防止 AI 在已有未回答的问题时再次调用 ask_user。
 */
export function hasAnyPending(): boolean {
  return pendingMap.size > 0
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

// ==================== collect_missing_info ====================

/** 字段定义 */
export interface CollectField {
  key: string
  label: string
  type: 'text' | 'select' | 'textarea'
  placeholder?: string
  options?: string[]
}

/** collect_missing_info 参数 */
export interface CollectInfoParams {
  message: string
  fields: CollectField[]
}

/** collect_missing_info 的 pending 状态 */
export interface CollectInfoPending {
  params: CollectInfoParams
  timestamp: number
}

/** 存储 collect_missing_info 的 fields 数据 */
const collectFieldsMap = new Map<string, CollectInfoPending>()

/**
 * 注册一个 collect_missing_info 请求。
 * 与 ask_user 共用 pendingMap（防重守卫），但额外存储 fields 数据。
 */
export function waitForCollectInfo(
  toolCallId: string,
  params: CollectInfoParams
): { content: Array<{ type: 'text'; text: string }>; isError: false } {
  // 在 pendingMap 中注册（与 ask_user 共用，hasAnyPending 会检测到）
  pendingMap.set(toolCallId, {
    params: { question: params.message, mode: 'input' },
    timestamp: Date.now()
  })
  // 额外存储 fields 定义
  collectFieldsMap.set(toolCallId, { params, timestamp: Date.now() })

  return {
    content: [{ type: 'text' as const, text: '__COLLECT_PENDING__' }],
    isError: false
  }
}

/** 获取 collect_missing_info 的 fields 定义 */
export function getCollectFields(toolCallId: string): CollectField[] | undefined {
  return collectFieldsMap.get(toolCallId)?.params.fields
}

/** 获取 collect_missing_info 的 message */
export function getCollectMessage(toolCallId: string): string | undefined {
  return collectFieldsMap.get(toolCallId)?.params.message
}

/**
 * 用户提交 collect_missing_info 后调用。
 * 发送结构化数据给 AI。
 */
export function resolveCollectInfo(toolCallId: string, values: Record<string, string>): boolean {
  const pending = pendingMap.get(toolCallId)
  if (!pending) return false
  const collectPending = collectFieldsMap.get(toolCallId)

  pendingMap.delete(toolCallId)
  collectFieldsMap.delete(toolCallId)

  // 构建结构化数据字符串
  const lines = Object.entries(values)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v}`)
  const detail = `[信息收集完成]:\n${lines.join('\n')}`

  window.dispatchEvent(new CustomEvent('form-answer', { detail }))

  window.dispatchEvent(
    new CustomEvent('clarify-resolved', {
      detail: { toolCallId, answer: JSON.stringify(values) }
    })
  )

  return true
}
