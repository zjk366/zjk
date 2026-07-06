/**
 * TaskProgressService — 任务执行进度跟踪服务
 *
 * 跟踪 AI 响应流中工具调用的完成情况，提供准确的执行进度百分比。
 * 通过自定义事件与 UI 组件通信。
 */

const EVENT_NAME = 'cherry-task-progress'

export interface ProgressData {
  completed: number
  total: number
  percent: number
}

/** 全局 Map：messageId → ProgressData */
const progressMap = new Map<string, ProgressData>()

/** 自增计数器：用于生成唯一的 progressId */
let counter = 0

/**
 * 注册一个新的工具调用（在 onToolCallPending 中调用）
 */
export function registerToolCall(messageId: string): string {
  const current = progressMap.get(messageId) || { completed: 0, total: 0, percent: 0 }
  current.total += 1
  progressMap.set(messageId, current)
  const progressId = `tool_${messageId}_${++counter}`
  dispatchProgress(messageId)
  return progressId
}

/**
 * 标记一个工具调用完成（在 onToolCallComplete 中调用）
 */
export function completeToolCall(messageId: string) {
  const current = progressMap.get(messageId)
  if (!current) return
  current.completed += 1
  current.percent = Math.round((current.completed / Math.max(current.total, 1)) * 100)
  progressMap.set(messageId, current)
  dispatchProgress(messageId)
}

/**
 * 获取指定消息的当前进度
 */
export function getProgress(messageId: string): ProgressData | undefined {
  return progressMap.get(messageId)
}

/**
 * 清除指定消息的进度数据
 */
export function clearProgress(messageId: string) {
  progressMap.delete(messageId)
}

function dispatchProgress(messageId: string) {
  const data = progressMap.get(messageId)
  if (!data) return
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { messageId, progress: data } }))
}

export { EVENT_NAME as TASK_PROGRESS_EVENT }
