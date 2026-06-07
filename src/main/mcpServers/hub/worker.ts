export const hubWorkerSource = `
const crypto = require('node:crypto')
const { parentPort } = require('node:worker_threads')

const MAX_LOGS = 1000

const logs = []
const pendingCalls = new Map()
let isExecuting = false

const stringify = (value) => {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Error) return value.message

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const pushLog = (level, args) => {
  if (logs.length >= MAX_LOGS) {
    return
  }

  const message = args.map((arg) => stringify(arg)).join(' ')
  const entry = \`[\${level}] \${message}\`
  logs.push(entry)
  parentPort?.postMessage({ type: 'log', entry })
}

const capturedConsole = {
  log: (...args) => pushLog('log', args),
  warn: (...args) => pushLog('warn', args),
  error: (...args) => pushLog('error', args),
  info: (...args) => pushLog('info', args),
  debug: (...args) => pushLog('debug', args)
}

const callTool = (name, params) =>
  new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    pendingCalls.set(requestId, { resolve, reject })
    parentPort?.postMessage({ type: 'callTool', requestId, name, params })
  })

const mcp = {
  callTool,
  log: (level, message, fields) => {
    const safeLevel = typeof level === 'string' ? level : 'info'
    const safeMsg = typeof message === 'string' ? message : stringify(message)
    if (fields !== undefined) {
      pushLog(safeLevel, [safeMsg, fields])
    } else {
      pushLog(safeLevel, [safeMsg])
    }
  }
}

const buildContext = () => {
  // 只暴露安全的 API，不允许 AI 直接操作文件系统
  return {
    mcp,
    parallel: (...promises) => Promise.all(promises),
    settle: (...promises) => Promise.allSettled(promises),
    console: capturedConsole
  }
}

const runCode = async (code, context) => {
  const contextKeys = Object.keys(context)
  const contextValues = contextKeys.map((key) => context[key])

  // ── 安全沙箱：临时删除 Node.js 全局变量 ─────────────────
  // AI 可能通过 Function('return process')() 等方式从全局作用域
  // 获取 process，然后利用 process.binding 或 child_process 绕过工具层保护。
  // 此处临时从 global 中删除危险 API，执行完毕后恢复。
  const SAVED_GLOBALS = {
    process: global.process,
    require: global.require,
    module: global.module
  }
  try {
    delete global.process
    delete global.require
    delete global.module

    const wrappedCode = "return (async () => {\\n" + code + "\\n})()"
    const fn = new Function(...contextKeys, wrappedCode)
    return await fn(...contextValues)
  } finally {
    // 恢复全局变量
    if (SAVED_GLOBALS.process !== undefined) global.process = SAVED_GLOBALS.process
    if (SAVED_GLOBALS.require !== undefined) global.require = SAVED_GLOBALS.require
    if (SAVED_GLOBALS.module !== undefined) global.module = SAVED_GLOBALS.module
  }
}

const handleExec = async (code) => {
  if (isExecuting) {
    return
  }
  isExecuting = true

  try {
    const context = buildContext()
    const result = await runCode(code, context)
    parentPort?.postMessage({ type: 'result', result, logs: logs.length > 0 ? logs : undefined })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    parentPort?.postMessage({ type: 'error', error: errorMessage, logs: logs.length > 0 ? logs : undefined })
  } finally {
    pendingCalls.clear()
  }
}

const handleToolResult = (message) => {
  const pending = pendingCalls.get(message.requestId)
  if (!pending) {
    return
  }
  pendingCalls.delete(message.requestId)
  pending.resolve(message.result)
}

const handleToolError = (message) => {
  const pending = pendingCalls.get(message.requestId)
  if (!pending) {
    return
  }
  pendingCalls.delete(message.requestId)
  pending.reject(new Error(message.error))
}

parentPort?.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    return
  }
  switch (message.type) {
    case 'exec':
      handleExec(message.code)
      break
    case 'toolResult':
      handleToolResult(message)
      break
    case 'toolError':
      handleToolError(message)
      break
    default:
      break
  }
})
`
