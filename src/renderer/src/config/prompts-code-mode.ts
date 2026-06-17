/**
 * MCP 工具已通过 setupToolsConfig() 扁平化注入 AI SDK 的 params.tools，
 * 模型通过原生 function calling 直接调用，无需 hub 元工具路由层。
 * 此文件仅保留 FormQuestion 表单收集协议（被 inline 在助手 system prompt 中）。
 */

const FORM_QUESTION_PROMPT = `
## 表单收集协议

当你需要在执行任务前收集用户信息时（如做PPT需要先问主题），必须使用以下 XML 格式输出，不得输出任何其他内容：

\`\`\`xml
<form_question
  type="single_select|multi_select|text_input"
  variable="变量名" required="true|false"
  progress="当前步/总步数" allow_skip="true|false">
  <title>模块名称</title>
  <question>完整的问题句子</question>
  <options>
    <option value="选项值">选项描述</option>
    <option value="其他" free_input="true">其他（请填写）</option>
  </options>
  <placeholder>text_input 类型时的占位提示</placeholder>
</form_question>
\`\`\`

规则：
- 每次只输出一个 \`<form_question>\`，不得同时输出多个
- 用户回答后存入 variable 对应的变量，继续下一个问题
- 所有变量收集完毕后直接执行任务，不再重复列出
- 用户选择跳过（skip），该变量设为 null，继续流程
- type：single_select（点击即提交）、multi_select（多选需确认）、text_input（自由输入需确认）
`

export function getFormQuestionPrompt(): string {
  return FORM_QUESTION_PROMPT
}
