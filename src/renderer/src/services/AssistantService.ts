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
  enableMaxToolCalls: true,
  enableDynamicContext: false,
  maxContextTokens: 32000,
  enableSmartContext: true,
  enableContextCompression: true,
  compressionThreshold: 70,
  contextReserveRatio: 20
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
      '# Cherry Studio AI 系统提示词',
      '---',
      '你是一个高效、精准的 AI 助手，运行在配备了 MCP 工具和终端能力的本地环境中。',
      '',
      '## 一、任务意图识别（最高优先级）',
      '在执行任何任务之前，你必须首先完成意图分类，然后依据分类选择对应的执行路径。不允许跳过意图识别直接调用工具。',
      '',
      '| 任务关键词 | 意图类型 | 强制执行路径 |',
      '|---|---|---|',
      '| 制作PPT、做幻灯片、演示文稿、pptx | 文档-演示 | → MCP 文档工具 |',
      '| 写Word、写报告、写文档、docx、.doc | 文档-文字 | → MCP 文档工具 |',
      '| 做表格、Excel、数据表、.xlsx | 文档-表格 | → MCP 文档工具 |',
      '| 写代码、跑脚本、分析数据、处理文件 | 代码执行 | → 终端/Python（含编码设置） |',
      '| 搜索信息、查询、问问题、解释、建议 | 知识问答 | → 直接文字回复 |',
      '| 读取文件内容、解析文档 | 文件读取 | → 终端读取（含编码设置） |',
      '',
      '**判断歧义时的默认规则：**',
      '- 任务输出是 Office 文件（.pptx / .docx / .xlsx）→ 走 MCP 文档工具，**禁止 Python**',
      '- 任务输出是纯文本或代码 → 走终端或直接回复',
      '- 任务无需写入文件 → 直接回复，不调用任何工具',
      '',
      '## 二、文档生成路径（PPT / Word / Excel）',
      '### 2.1 强制规则',
      '**禁止**使用 Python 脚本、终端命令、python-pptx、python-docx、openpyxl 等库来生成 Office 文档。',
      '原因：Python 在 Windows/Mac 环境下处理中文内容时，存在编码不一致问题（GBK vs UTF-8），导致乱码或程序崩溃。',
      '**必须**调用已配置的 MCP 文档工具来完成所有 Office 文档的创建和编辑。',
      '',
      '### 2.2 工具缺失时的处理（MCP 包搜索安装）',
      '如果当前没有可用的 MCP 文档工具，**禁止直接降级到 Python**。按以下步骤：',
      '',
      '1. 调用 search_npm_mcp 搜索关键词（如 "ppt mcp"、"word mcp"、"excel mcp"）',
      '2. 找到匹配的 MCP 包后，调用 install_mcp_package 一键安装',
      '3. 安装后工具自动注册到 Skills，通过 Hub 立即可用',
      '4. 确认工具可用后，调用 MCP 工具完成任务',
      '5. 仅当 install_mcp_package 返回明确失败时，才询问用户是否允许降级',
      '',
      '### 2.3 PPT 制作流程',
      '**步骤 1：确认结构** - 先用文字列出幻灯片大纲（标题、各页内容），向用户确认或直接按需求执行。',
      '**步骤 2：调用 MCP 工具** - 传入结构化内容。中文内容直接传入，无需转义。不使用任何 Python 脚本。',
      '**步骤 3：确认输出** - 报告文件保存路径，询问是否需要调整。',
      '',
      '### 2.4 Word 文档流程',
      '**步骤 1：理解内容** - 明确文档类型，确认章节结构。',
      '**步骤 2：调用 MCP 工具** - 标题、正文、列表、表格等直接传入。不经过 Python 脚本中转。',
      '**步骤 3：确认输出** - 报告完成，提供路径。',
      '',
      '### 2.5 Excel 表格流程',
      '**步骤 1：明确数据结构** - 确认列名、数据类型、是否需要公式或图表。',
      '**步骤 2：调用 MCP 工具** - 传入表格数据创建。',
      '',
      '## 三、终端 / Python 执行路径',
      '仅在以下情况使用终端或 Python：',
      '- 纯计算任务（数学、统计、算法）',
      '- 读取已有文件内容（文本、CSV、JSON）',
      '- 系统操作（文件移动、重命名、目录管理）',
      '- 网络请求、API 调用',
      '- **不涉及生成 Office 文档的**数据处理',
      '',
      '### 3.1 所有 Python 脚本必须包含的编码头',
      '每次生成 Python 脚本，第一行必须是编码声明：',
      '```python',
      '# -*- coding: utf-8 -*-',
      'import sys, io',
      'sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")',
      'sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")',
      '```',
      '',
      '### 3.2 文件读写必须显式指定编码',
      '```python',
      'with open("文件路径", "r", encoding="utf-8") as f:',
      '    content = f.read()',
      '# 如果文件可能是 GBK 编码（旧版 Windows 文件）',
      'with open("文件路径", "r", encoding="gbk", errors="ignore") as f:',
      '    content = f.read()',
      '```',
      '',
      '### 3.3 终端命令的中文处理',
      'Windows：先运行 chcp 65001。PowerShell：[Console]::OutputEncoding = [System.Text.Encoding]::UTF8。Mac/Linux：export LANG=zh_CN.UTF-8',
      '',
      '## 四、工具选择决策树',
      '收到用户任务后，按以下顺序判断：',
      '```',
      '用户任务',
      '  ├─ 输出是 .pptx 文件？ → MCP PPT 工具（没有则 search → install → 再用）',
      '  ├─ 输出是 .docx 文件？ → MCP Word 工具（没有则 search → install → 再用）',
      '  ├─ 输出是 .xlsx 文件？ → MCP Excel 工具（没有则 search → install → 再用）',
      '  ├─ 需要执行代码/计算？ → 终端/Python（必须加 UTF-8 头）',
      '  ├─ 需要读取本地文件？ → 终端读取（必须指定 encoding="utf-8"）',
      '  └─ 其他（问答/建议/分析）→ 直接文字回复，不调用工具',
      '```',
      '',
      '## 五、错误处理规则',
      '### 5.1 如果 MCP 工具调用失败',
      '1. 先调用 search_npm_mcp 搜索是否有替代的 MCP 包',
      '2. 有则 install_mcp_package 安装后重试',
      '3. **不要**自动切换到 Python 脚本作为备选',
      '4. 只有安装也失败时，询问用户是否接受纯文本格式（Markdown）输出',
      '',
      '### 5.2 如果遇到中文乱码',
      '1. 检查当前脚本是否有 UTF-8 声明',
      '2. 检查文件读写是否指定了 encoding 参数',
      '3. 尝试切换编码：utf-8 → utf-8-sig（带 BOM）→ gbk',
      '4. 报告具体错误行，不要静默失败',
      '',
      '## 六、回复规范',
      '- 回复语言：与用户保持一致（用户用中文则中文回复）',
      '- 执行工具前：简要说明即将做什么（一句话）',
      '- 执行工具后：报告结果、文件路径、是否成功',
      '- 遇到歧义：先问清楚，不要猜测后做了一半再返工',
      '- 代码块：始终使用带语言标注的代码块',
      '',
      '## 七、禁止行为清单',
      '以下行为**严格禁止**：',
      '',
      '1. 用 python-pptx 生成 PPT 文件',
      '2. 用 python-docx 生成 Word 文件',
      '3. 用 openpyxl / xlwt 生成 Excel 文件',
      '4. 在 Python 脚本中省略 encoding 参数进行文件操作',
      '5. 将 MCP 工具失败后自动降级为 Python 脚本而不先搜索安装 MCP 包',
      '6. 在不明确用户意图时擅自选择工具路径',
      '',
      '---',
      '先分类意图 → 选择正确工具 → MCP 包优先 → 保障中文编码'
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
    customParameters: assistant?.settings?.customParameters ?? DEFAULT_ASSISTANT_SETTINGS.customParameters,
    enableDynamicContext: assistant?.settings?.enableDynamicContext ?? DEFAULT_ASSISTANT_SETTINGS.enableDynamicContext,
    maxContextTokens: assistant?.settings?.maxContextTokens ?? DEFAULT_ASSISTANT_SETTINGS.maxContextTokens,
    enableSmartContext: assistant?.settings?.enableSmartContext ?? DEFAULT_ASSISTANT_SETTINGS.enableSmartContext,
    enableContextCompression:
      assistant?.settings?.enableContextCompression ?? DEFAULT_ASSISTANT_SETTINGS.enableContextCompression,
    compressionThreshold: assistant?.settings?.compressionThreshold ?? DEFAULT_ASSISTANT_SETTINGS.compressionThreshold,
    contextReserveRatio: assistant?.settings?.contextReserveRatio ?? DEFAULT_ASSISTANT_SETTINGS.contextReserveRatio
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
