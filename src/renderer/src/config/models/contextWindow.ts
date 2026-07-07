/**
 * 模型上下文窗口注册表
 *
 * 定义各模型系列的上下文窗口大小（单位：token）。
 * 用于智能上下文策略，根据模型实际能力动态决定保留多少历史消息。
 *
 * 优先级：
 * 1. 用户自定义的 model.contextWindow（未来可通过 API 响应更新）
 * 2. 此注册表中的模式匹配
 * 3. 默认值（DEFAULT_CONTEXT_WINDOW）
 */

export const DEFAULT_CONTEXT_WINDOW = 128_000 // 默认 128K（大部分现代模型）

/**
 * 模型上下文窗口映射表
 * key: 正则表达式模式（匹配 model.id）
 * value: 上下文窗口大小（token 数）
 */
const CONTEXT_WINDOW_MAP: Record<string, number> = {
  // ── DeepSeek ──
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'deepseek-v3': 64_000,
  'deepseek-v4': 64_000,
  'deepseek-v3\\.\\d+': 64_000,
  'deepseek-v[4-9]': 128_000, // V4+ 可能支持更大窗口
  'deepseek-r1': 1_000_000, // R1 支持百万级上下文

  // ── Claude ──
  'claude-opus-4[.-]7': 200_000,
  'claude-opus-4[.-]6': 200_000,
  'claude-sonnet-4[.-]6': 200_000,
  'claude-haiku-4[.-]6': 200_000,
  'claude-(sonnet|opus|haiku)-4[.-]5': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-opus-4': 200_000,
  'claude-haiku-4': 200_000,
  'claude-3\\.5-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,
  'claude-3\\.7-sonnet': 200_000,
  claude: 100_000, // 其他 Claude 模型兜底

  // ── OpenAI ──
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-4\\.5': 128_000,
  o1: 200_000,
  o3: 200_000,
  'o3-mini': 200_000,
  o4: 200_000,
  'o4-mini': 200_000,
  'gpt-5': 128_000,
  'gpt-5\\.1': 1_000_000, // GPT-5.1 百万级上下文

  // ── Gemini ──
  'gemini-2\\.5-pro': 1_000_000,
  'gemini-2\\.5-flash': 1_000_000,
  'gemini-2\\.0-pro': 2_000_000, // Gemini 2.0 Pro 200万
  'gemini-3\\.\\d+-pro': 1_000_000,
  'gemini-3\\.\\d+-flash': 1_000_000,
  gemini: 128_000, // 其他 Gemini 兜底

  // ── Qwen ──
  'qwen-plus': 131_072,
  'qwen-max': 131_072,
  'qwen-turbo': 131_072,
  'qwen-flash': 1_000_000,
  'qwen3-max': 131_072,
  'qwen3-\\d+b': 131_072,
  qwen: 32_000, // 旧版 Qwen 兜底

  // ── Grok ──
  'grok-4': 131_072,
  'grok-3': 131_072,
  'grok-2': 131_072,
  grok: 131_072,

  // ── 其他主流模型 ──
  'mistral-large': 128_000,
  'mistral-small': 128_000,
  mistral: 32_000,
  'llama-3\\.\\d+': 128_000,
  'llama-3': 8_192,
  llama: 8_192,
  mixtral: 32_000,
  'command-r': 128_000,
  'command-r\\+': 128_000,
  command: 4_096,
  dbrx: 32_768,
  'dbrx-instruct': 32_768,
  cohere: 128_000,

  // ── 国产模型 ──
  ernie: 128_000,
  'glm-4': 128_000,
  'glm-4v': 128_000,
  'glm-5': 128_000,
  glm: 128_000,
  moonshot: 128_000,
  kimi: 128_000,
  'kimi-k2': 128_000,
  'kimi-k3': 131_072,
  minimax: 1_000_000,
  yi: 200_000,
  baichuan: 128_000,
  doubao: 128_000,
  hunyuan: 128_000,
  step: 128_000,
  sensechat: 128_000
}

/**
 * 获取模型的最大上下文窗口大小（token 数）
 * @param modelId - 模型 ID（如 "deepseek-chat", "gpt-4o"）
 * @returns 上下文窗口大小，找不到则返回 DEFAULT_CONTEXT_WINDOW
 */
export function getContextWindow(modelId: string): number {
  const lowerId = modelId.toLowerCase()

  for (const [pattern, windowSize] of Object.entries(CONTEXT_WINDOW_MAP)) {
    try {
      if (new RegExp(pattern, 'i').test(lowerId)) {
        return windowSize
      }
    } catch {
      // 忽略无效正则
    }
  }

  return DEFAULT_CONTEXT_WINDOW
}

/**
 * 获取建议的输出预留空间（token 数）
 * 通常保留 20% 的上下文窗口用于模型输出
 */
export function getRecommendedOutputReserve(contextWindow: number, ratio = 20): number {
  return Math.floor(contextWindow * (ratio / 100))
}

/**
 * 压缩触发阈值
 * 当上下文使用量超过此时触发压缩
 */
export const DEFAULT_COMPRESSION_THRESHOLD = 70 // %

/**
 * 默认输出预留比例
 */
export const DEFAULT_CONTEXT_RESERVE_RATIO = 5 // %

export default CONTEXT_WINDOW_MAP
