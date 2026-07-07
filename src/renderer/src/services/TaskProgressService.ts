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

// ============================================================
//  语义化进度（progress_update 工具调用）
// ============================================================

export interface StageProgress {
  percent: number
  stage: string
  message: string
  output_file?: string
  updatedAt: string
}

const stageProgressMap = new Map<string, StageProgress>()

/**
 * progress_update 工具调用此函数，直接设置语义化进度
 */
export function updateProgressDirect(update: Omit<StageProgress, 'updatedAt'>): void {
  const stage: StageProgress = { ...update, updatedAt: new Date().toISOString() }
  // 使用 '__stage__' 作为特殊 key 存储在 progressMap 中
  // 但这里我们用独立的 map 避免与工具计数混淆
  const messageId =
    update.stage === 'completed' ? '__completed__' : update.stage === 'failed' ? '__failed__' : '__stage__'
  stageProgressMap.set(messageId, stage)
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { stage: stage } }))
}

/** 获取最新的语义化进度 */
export function getStageProgress(): StageProgress | undefined {
  return (
    stageProgressMap.get('__stage__') ?? stageProgressMap.get('__completed__') ?? stageProgressMap.get('__failed__')
  )
}

/** 清除语义化进度 */
export function clearStageProgress(): void {
  stageProgressMap.clear()
}

export { EVENT_NAME as TASK_PROGRESS_EVENT }
