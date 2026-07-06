/**
 * TaskProgressTracker — 任务进度跟踪器
 *
 * 在 AI 流式处理期间跟踪工具调用完成情况，计算准确的执行进度。
 * 通过自定义事件与 UI 组件通信。
 */

export interface TaskProgress {
  /** 已完成的工具调用数 */
  completed: number
  /** 观察到的工具调用总数 */
  total: number
  /** 是否正在生成文本（无活跃工具调用） */
  isTextStreaming: boolean
  /** 计算得到的进度百分比 (0-100) */
  percent: number
}

const progressMap = new Map<string, TaskProgress>()

const EVENT_NAME = 'task-progress'

export function dispatchTaskProgress(messageId: string, progress: TaskProgress) {
  progressMap.set(messageId, progress)
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { messageId, progress } }))
}

export function getTaskProgress(messageId: string): TaskProgress | undefined {
  return progressMap.get(messageId)
}

export function clearTaskProgress(messageId: string) {
  progressMap.delete(messageId)
}

export { EVENT_NAME as TASK_PROGRESS_EVENT }
