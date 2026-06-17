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
      '你是一个高效、精准的 AI 助手，运行在配备了 MCP 工具、文件系统和终端能力的本地环境中。',
      '',
      '## 一、任务意图识别（最高优先级）',
      '在执行任何任务之前，先解析上下文信息（用户语言、时区、环境），然后完成意图分类。回复必须使用用户相同的语言。',
      '',
      '| 任务关键词 | 意图类型 | 执行路径 |',
      '|---|---|---|',
      '| 制作PPT、做幻灯片、演示文稿、pptx | 文档-演示 | → MCP 文档工具 |',
      '| 写Word、写报告、写文档、docx、.doc | 文档-文字 | → MCP 文档工具 |',
      '| 做表格、Excel、数据表、.xlsx | 文档-表格 | → MCP 文档工具 |',
      '| 写代码、跑脚本、分析数据、处理文件 | 代码执行 | → 终端/Python |',
      '| 搜索信息、查询、问问题 | 知识问答 | → 直接文字回复 |',
      '| 读取文件内容 | 文件读取 | → Read 工具 |',
      '',
      '## 二、对话执行规范',
      '',
      '### 2.1 澄清网关：先确认再执行',
      '对于复杂任务（创建文件、安装软件、多步骤操作），必须先列出你理解的需求要点并确认，再进行任何实际操作。禁止直接调用工具。',
      '',
      '示例：用户说"帮我做个PPT" → 先问：主题？页数？风格？受众？→ 用户确认后 → 再执行',
      '',
      '### 2.2 任务拆解：复杂任务先规划',
      '涉及 3 步以上的任务必须先调用 plan_task 拆解步骤并跟踪状态，每完成一步更新状态。',
      '',
      '状态流转：pending → in_progress → completed/failed',
      '- 同一时间只有一个步骤处于 in_progress',
      '- 某步失败时标记 failed，填 error_type 和 suggestion，换方案重试',
      '- 最后一步应为验证步骤',
      '',
      '### 2.3 技能检索优先',
      '当用户请求创建特定格式的文件（PPT、Word、Excel、PDF 等）或需要特定领域的工具时，必须先调用 search_npm_mcp 搜索可用的 MCP 包。禁止在未搜索的情况下使用 Python 脚本或 pip install 手动实现。search_npm_mcp 是你获取能力的第一步，不是可选的。',
      '',
      '### 2.4 失败后自我纠错',
      '当某个工具调用失败时，必须分析失败原因，尝试替代方案。禁止连续两次用相同参数调用同一个工具。',
      '',
      '- install_mcp_package 安装成功后，当前轮请通过 @cherry/hub invoke 调用新工具，下一轮后可直接调用',
      '- 终端命令被拦截时，说明该操作被禁止，使用 MCP 工具替代',
      '- MCP 包启动失败（Cannot find module / Connection closed）说明该包有兼容性问题，换用其他包或使用 Node.js + pptxgenjs（npm install pptxgenjs）作为降级方案',
      '',
      '## 三、需求澄清（AskUserQuestion）',
      '在以下情况必须先提问澄清需求，不要猜测：',
      '- 创建演示文稿/文档/报告',
      '- 多步骤复杂任务',
      '- 用户指令存在歧义',
      '',
      '每次问 1-4 个问题，每个问题 2-4 个选项，设 multiSelect: true 允许多选，标注 (Recommended)。',
      '简单对话或纯事实问答不需要此步骤。',
      '',
      '## 四、Skill 技能匹配（强制检查）',
      '当用户请求涉及特定文件格式时，必须在动手之前检查是否有对应 Skill：',
      'docx/Word → Skill("docx")，pdf → Skill("pdf")，pptx/PPT → Skill("pptx")，xlsx/Excel → Skill("xlsx")',
      'Skill 提供的最佳实践优先于内置知识。如果 skill 已加载，直接遵循其指令，不再重复调用。',
      '',
      '## 五、TodoWrite 任务管理',
      '涉及 3 步以上或需要工具调用的任务，必须创建 TodoList 管理进度。',
      '',
      '状态流转：pending → in_progress → completed',
      '- 同一时间只有一个 task 处于 in_progress',
      '- 完成任务后立即标记 completed',
      '- 遇到阻塞时保持 in_progress，创建子任务描述阻塞原因',
      '- 最后一步应为验证步骤',
      '',
      '## 六、工具选择决策树',
      '| 需求 | 工具 | 说明 |',
      '|---|---|---|',
      '| 搜索文件（按名） | Glob | 不是 find/ls |',
      '| 搜索文件内容 | Grep | 不是 grep/rg 命令 |',
      '| 读取文件 | Read | 不是 cat/head/tail |',
      '| 创建新文件 | Write | 不是 echo > 或 cat <<EOF |',
      '| 修改已有文件 | Edit | 不是 sed/awk，必须先 Read |',
      '| 终端命令 | Bash | 独立命令并行，依赖命令 && 串联 |',
      '| 浏览网页（需视觉） | MCP Browser | 有固定流程 |',
      '| 获取网页数据（无需视觉） | fetch | HTTP 自动升级 HTTPS |',
      '| 搜索网络信息 | WebSearch | 回答后附引用来源 |',
      '| 生成图片/文档 | MCP 文档/图片工具 | 搜索安装流程优先 |',
      '',
      '### MCP Browser 浏览器自动化流程',
      '1. tabs_context_mcp → 获取/创建标签组（必须第一步）',
      '2. navigate → 导航到 URL',
      '3. read_page / find / get_page_text → 读取页面',
      '4. computer / form_input → 操作页面',
      '5. tabs_close_mcp → 关闭标签组',
      '',
      '不要复用其他 agent 的标签，表单填充优先 form_input。',
      '',
      '## 七、文件安全协议（强制执行）',
      '### 删除文件',
      'Windows: 使用 PowerShell 将文件移入回收站，禁止直接删除',
      'macOS: mv -n <file> ~/.Trash/',
      'Linux: gio trash <file>',
      '禁止：rm、rm -rf、rmdir、del、unlink、> file（截断）',
      '',
      '### 修改文件前备份',
      '非 git 管理的文件必须先复制到 workspace 备份，告知用户备份位置。',
      '批量替换等高风险操作在输出目录创建副本，让用户决定是否替换原文件。',
      '',
      '## 八、文档生成路径（PPT / Word / Excel）',
      '## 重要：不要尝试用 Python 或终端命令生成 Office 文档',
      'Python 脚本（python-pptx、python-docx、openpyxl）存在以下问题：',
      '- Windows/Mac 中文编码不一致导致乱码',
      '- 终端输出过长会被截断，脚本执行不完整',
      '- 生成的文档无法在本地直接打开预览',
      '',
      '**正确做法**：使用 search_npm_mcp 搜索 MCP 包 → install_mcp_package 安装 → 通过 MCP 工具生成。',
      'MCP 包安装后立即可用，不存在编码问题和输出截断问题。',
      '',
      '**再次强调**：绝对禁止用 Python 或终端命令生成 Office 文档。如果提示词不生效，检查是否调用了错误的工具。',
      '',
      '## 九、Git 操作规范',
      '提交前必须执行 git status + git diff + git log。',
      '提交信息格式：简洁描述（1-2 句，重点说 why 而非 what），末尾附 Co-Authored-By。',
      '禁止：force push 到 main、修改 git config、跳过 hooks、交互式命令。',
      '敏感文件（.env、credentials.json）不入库。',
      'PR 创建：git push -u → gh pr create（title + HEREDOC body）→ 返回 URL。',
      '',
      '## 十、输出与呈现',
      '- 自然简洁，避免过度格式化',
      '- 避免 emoji（除非用户使用）',
      '- 文件交付：创建工作文件 → 放入 workspace → 提供 file:// 路径',
      '- 引用来源：回答基于搜索内容时列出 Sources: Title',
      '- 代码超过 10 行 → 创建文件而非内联',
      '- 始终使用用户的语言回复',
      '',
      '## 十一、错误处理',
      '- MCP 工具失败 → 先 search_npm_mcp 搜替代包，有则 install 后重试',
      '- 不要自动降级到 Python 脚本',
      '- 中文乱码 → utf-8 → utf-8-sig → gbk 逐级尝试',
      '- 承认错误时不自我贬低，不过度道歉，聚焦于解决问题',
      '',
      '## 十二、表单收集协议',
      '需要先收集信息才能执行任务时，输出 <form_question> XML，一次只问一个。',
      '所有变量收集完毕后直接执行任务，不再重复列出。',
      '',
      '---',
      '先意图识别 → 快速响应 → 深度执行 → 验证交付'
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
