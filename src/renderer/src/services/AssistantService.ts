import { loggerService } from '@logger'
import {
  DEFAULT_CONTEXTCOUNT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MAX_CONTEXT_COUNT,
  UNLIMITED_CONTEXT_COUNT
} from '@renderer/config/constant'
import { getModelSupportedReasoningEffortOptions } from '@renderer/config/models'
import { isQwenMTModel } from '@renderer/config/models/qwen'
import { UNKNOWN } from '@renderer/config/translate'
import { getStoreProviders } from '@renderer/hooks/useStore'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { addAssistant } from '@renderer/store/assistants'
import type {
  Assistant,
  AssistantPreset,
  AssistantSettings,
  Model,
  Provider,
  Topic,
  TranslateAssistant,
  TranslateLanguage
} from '@renderer/types'
import { v4 as uuid } from 'uuid'

const logger = loggerService.withContext('AssistantService')

/**
 * Default assistant settings configuration template.
 *
 * **Important**: This defines the DEFAULT VALUES for assistant settings, NOT the current settings
 * of the default assistant. To get the actual settings of the default assistant, use `getDefaultAssistantSettings()`.
 *
 * Provides sensible defaults for all assistant settings with a focus on minimal parameter usage:
 * - **Temperature disabled**: Use provider defaults by default
 * - **MaxTokens disabled**: Use provider defaults by default
 * - **TopP disabled**: Use provider defaults by default
 * - **Streaming enabled**: Provides real-time response for better UX
 * - **Standard context count**: Balanced memory usage and conversation length
 */
export const DEFAULT_ASSISTANT_SETTINGS = {
  maxTokens: DEFAULT_MAX_TOKENS,
  enableMaxTokens: false,
  temperature: DEFAULT_TEMPERATURE,
  enableTemperature: false,
  topP: 1,
  enableTopP: false,
  contextCount: DEFAULT_CONTEXTCOUNT,
  streamOutput: true,
  defaultModel: undefined,
  customParameters: [],
  reasoning_effort: 'default',
  reasoning_effort_cache: undefined,
  qwenThinkMode: undefined,
  // It would gracefully fallback to prompt if not supported by model.
  toolUseMode: 'function',
  maxToolCalls: 20,
  enableMaxToolCalls: true
} as const satisfies AssistantSettings

/**
 * Creates a temporary default assistant instance.
 *
 * **Important**: This creates a NEW temporary assistant instance with DEFAULT_ASSISTANT_SETTINGS,
 * NOT the actual default assistant from Redux store. This is used as a template for creating
 * new assistants or as a fallback when no assistant is specified.
 *
 * To get the actual default assistant from Redux store (with current user settings), use:
 * ```typescript
 * const defaultAssistant = store.getState().assistants.defaultAssistant
 * ```
 *
 * @returns New temporary assistant instance with default settings
 */
export function getDefaultAssistant(): Assistant {
  return {
    id: 'default',
    name: 'blackhole AI',
    emoji: '◉',
    prompt: [
      '你是 blackhole AI，一个全知全能的智能助手。请严格遵守以下行为准则：',
      '',
      '## 核心能力',
      '- 你可以随时调用网络搜索获取最新信息',
      '- 你可以使用 MCP 工具执行系统操作（如浏览器控制、文件管理、终端命令等）',
      '- 你可以理解为用户提供帮助是你的唯一使命',
      '',
      '## 三层执行通道（优先级从高到低）',
      '当需要执行任务时，按以下顺序尝试，前一级失败自动降级到下一级：',
      '',
      '### 第一级：API 搜索（信息获取）',
      '- 适用：搜索信息、查找资料、获取安装命令',
      '- 执行：调用 web_search 搜索，提取关键信息',
      '- 失败降级：→ 第二级',
      '',
      '### 第二级：MCP 工具（标准化操作）',
      '- 适用：浏览器控制、文件操作、代码执行等已有工具',
      '- 执行：通过 @cherry/hub 调用 list/invoke/exec',
      '- 如果 list 超时或返回空，不要放弃，转到第三级',
      '- 失败降级：→ 第三级',
      '',
      '### 第三级：直接终端（命令执行）',
      '- 适用：MCP 超时、缺少工具时安装、系统操作',
      '- 执行：直接在终端执行命令（用户需确认）',
      '- 用户操作：双击输入框的 MCP 按钮（Sparkles），输入包名安装',
      '- 安装后自动注册到 Skills 管理室',
      '',
      '## 技能与工具使用规范',
      '- 优先使用 Skills 管理室中已注册的技能',
      '- 如果工具列表为空或超时，直接搜索该工具的 npm 包并引导安装',
      '- 安装命令格式：npx -y <包名>（如 npx -y @playwright/mcp）',
      '- 安装完成后工具会自动可用，不需要重启',
      '',
      '## 附件说明',
      '工具生成的文件（截图、图片等）会自动保存到文件库并显示在对话中。',
      '你禁止在回复中使用任何 Markdown 图片语法，包括 ![...](data:image/...) 或 ![...](attachment://...) 等。',
      '禁止输出任何 Base64 格式的图片数据。',
      '系统会自动展示图片，你只需要用文字描述截图内容即可。',
      '如果工具返回了 File saved to vault 信息，说明图片已保存，你正常回复即可。',
      '',
      '你收到的工具返回格式为：',
      '”[System: File saved to vault. Reference: attachment://xxx]”',
      '',
      '## 全链路监控日志',
      '每次操作后必须在回复末尾附加 JSON 格式的 [SYS_LOG]：',
      '```',
      '[SYS_LOG] {"timestamp":"...","task_id":"...","action_type":"API_SEARCH|MCP_CALL|CLI_EXEC","target":"...","status":"SUCCESS|FAILED|FALLBACK","message":"..."}',
      '```',
      '- FALLBACK 标记表示降级到下一级通道',
      '',
      '## 交互风格',
      '- 简洁直接，不啰嗦',
      '- 遇到问题给出具体解决方案，而非笼统建议',
      '- 能自动完成的绝不麻烦用户',
      '- 始终保持在用户需要时提供帮助的状态',
      '',
      '## 安全边界',
      '- 仅从 npm 官方源安装工具，不执行来源不明的命令',
      '- 涉及系统敏感操作时，在回复中明确告知用户正在执行的操作',
    ].join('\n'),
    topics: [getDefaultTopic('default')],
    messages: [],
    type: 'assistant',
    regularPhrases: [],
    settings: DEFAULT_ASSISTANT_SETTINGS
  }
}

/**
 * Creates a default translate assistant.
 *
 * @param targetLanguage - Target language for translation
 * @param text - Text to be translated
 * @param _settings - Optional settings to override default assistant settings
 * @returns Configured translate assistant
 */
export function getDefaultTranslateAssistant(
  targetLanguage: TranslateLanguage,
  text: string,
  _settings?: Partial<AssistantSettings>
): TranslateAssistant {
  const model = getTranslateModel()
  const assistant: Assistant = getDefaultAssistant()

  if (!model) {
    logger.error('No translate model')
    throw new Error(i18n.t('translate.error.not_configured'))
  }

  if (targetLanguage.langCode === UNKNOWN.langCode) {
    logger.error('Unknown target language', targetLanguage)
    throw new Error('Unknown target language')
  }

  const supportedOptions = getModelSupportedReasoningEffortOptions(model)
  // disable reasoning if it could be disabled, otherwise no configuration
  const reasoningEffort = supportedOptions?.includes('none') ? 'none' : 'default'
  const settings = {
    reasoning_effort: reasoningEffort,
    ..._settings
  } satisfies Partial<AssistantSettings>

  const getTranslateContent = (model: Model, text: string, targetLanguage: TranslateLanguage): string => {
    if (isQwenMTModel(model)) {
      return text // QwenMT models handle raw text directly
    }

    return store
      .getState()
      .settings.translateModelPrompt.replaceAll('{{target_language}}', targetLanguage.value)
      .replaceAll('{{text}}', text)
  }

  const content = getTranslateContent(model, text, targetLanguage)
  const translateAssistant = {
    ...assistant,
    model,
    settings,
    prompt: '',
    targetLanguage,
    content
  } satisfies TranslateAssistant
  return translateAssistant
}

/**
 * Gets the CURRENT SETTINGS of the default assistant.
 *
 * **Important**: This returns the actual current settings of the default assistant (user-configured),
 * NOT the DEFAULT_ASSISTANT_SETTINGS template. The settings may have been modified by the user
 * from their initial default values.
 *
 * To get the template of default values, use DEFAULT_ASSISTANT_SETTINGS directly.
 *
 * @returns Current settings of the default assistant from store state
 */
export function getDefaultAssistantSettings() {
  return store.getState().assistants.defaultAssistant.settings
}

export function getDefaultTopic(assistantId: string): Topic {
  return {
    id: uuid(),
    assistantId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: i18n.t('chat.default.topic.name'),
    messages: [],
    isNameManuallyEdited: false
  }
}

export function getDefaultProvider() {
  return getProviderByModel(getDefaultModel())
}

export function getDefaultModel() {
  return store.getState().llm.defaultModel
}

export function getQuickModel() {
  return store.getState().llm.quickModel
}

export function getTranslateModel() {
  return store.getState().llm.translateModel
}

export function getAssistantProvider(assistant: Assistant): Provider {
  const providers = getStoreProviders()
  const provider = providers.find((p) => p.id === assistant.model?.provider)
  return provider || getDefaultProvider()
}

// FIXME: This function fails in silence.
// TODO: Refactor it to make it return exactly valid value or null, and update all usage.
export function getProviderByModel(model?: Model): Provider {
  const providers = getStoreProviders()
  const provider = providers.find((p) => p.id === model?.provider)

  if (!provider) {
    const defaultProvider = providers.find((p) => p.id === getDefaultModel()?.provider)
    return defaultProvider || providers[0]
  }

  return provider
}

// FIXME: This function may return undefined but as Provider
export function getProviderByModelId(modelId?: string) {
  const providers = getStoreProviders()
  const _modelId = modelId || getDefaultModel().id
  return providers.find((p) => p.models.find((m) => m.id === _modelId)) as Provider
}

/**
 * Retrieves and normalizes assistant settings with special transformation handling.
 *
 * **Special Transformations:**
 * 1. **Context Count**: Converts `MAX_CONTEXT_COUNT` to `UNLIMITED_CONTEXT_COUNT` for internal processing
 * 2. **Max Tokens**: Only returns a value when `enableMaxTokens` is true, otherwise returns `undefined`
 * 3. **Max Tokens Validation**: Ensures maxTokens > 0, falls back to `DEFAULT_MAX_TOKENS` if invalid
 * 4. **Fallback Defaults**: Applies system defaults for all undefined/missing settings
 *
 * @param assistant - The assistant instance to extract settings from
 * @returns Normalized assistant settings with all transformations applied
 */
export const getAssistantSettings = (assistant: Assistant): AssistantSettings => {
  const contextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  const getAssistantMaxTokens = () => {
    if (assistant.settings?.enableMaxTokens) {
      const maxTokens = assistant.settings.maxTokens
      if (typeof maxTokens === 'number') {
        return maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS
      }
      return DEFAULT_MAX_TOKENS
    }
    return undefined
  }

  return {
    contextCount: contextCount === MAX_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : contextCount,
    temperature: assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE,
    enableTemperature: assistant?.settings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature,
    topP: assistant?.settings?.topP ?? DEFAULT_ASSISTANT_SETTINGS.topP,
    enableTopP: assistant?.settings?.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP,
    enableMaxTokens: assistant?.settings?.enableMaxTokens ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxTokens,
    maxTokens: getAssistantMaxTokens(),
    streamOutput: assistant?.settings?.streamOutput ?? DEFAULT_ASSISTANT_SETTINGS.streamOutput,
    toolUseMode: assistant?.settings?.toolUseMode ?? DEFAULT_ASSISTANT_SETTINGS.toolUseMode,
    maxToolCalls: assistant?.settings?.maxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.maxToolCalls,
    enableMaxToolCalls: assistant?.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls,
    defaultModel: assistant?.defaultModel ?? DEFAULT_ASSISTANT_SETTINGS.defaultModel,
    reasoning_effort: assistant?.settings?.reasoning_effort ?? DEFAULT_ASSISTANT_SETTINGS.reasoning_effort,
    customParameters: assistant?.settings?.customParameters ?? DEFAULT_ASSISTANT_SETTINGS.customParameters
  }
}

export function getAssistantById(id: string) {
  const assistants = store.getState().assistants.assistants
  return assistants.find((a) => a.id === id)
}

export async function createAssistantFromAgent(agent: AssistantPreset) {
  const assistantId = uuid()
  const topic = getDefaultTopic(assistantId)

  const assistant: Assistant = {
    ...agent,
    id: assistantId,
    name: agent.name,
    emoji: agent.emoji,
    topics: [topic],
    model: agent.defaultModel,
    type: 'assistant',
    regularPhrases: agent.regularPhrases || [], // Ensured regularPhrases
    settings: agent.settings || DEFAULT_ASSISTANT_SETTINGS
  }

  store.dispatch(addAssistant(assistant))

  window.toast.success(i18n.t('message.assistant.added.content'))

  return assistant
}
