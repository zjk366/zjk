/**
 * Terminal MCP - execute_command tool
 *
 * 在本地终端中执行命令，返回 stdout/stderr。
 * 危险命令会触发用户确认弹窗。
 */
import { dialog } from 'electron'
import { exec } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as z from 'zod'

import { DEFAULT_TIMEOUT_MS, getCommandSummary, isDangerousCommand, logger, MAX_OUTPUT_LENGTH } from '../types'

const ExecuteSchema = z.object({
  command: z.string().describe('要执行的命令'),
  cwd: z.string().optional().describe('工作目录（默认当前用户 home）'),
  timeout: z.number().optional().describe('超时时间（毫秒，默认 30000）'),
  description: z.string().optional().describe('命令说明（用于确认弹窗，可选）'),
})

export const executeToolDefinition = {
  name: 'execute_command',
  description: `在本地终端中执行命令并返回输出结果。

## 能力
- 支持任意终端命令（PowerShell、cmd、bash、zsh 等）
- 可指定工作目录
- 可设置超时时间

## 安全规则
- 格式化/擦除/关机/权限提升等危险命令会弹出用户确认窗口
- 所有命令都有超时保护，防止命令卡死
- 输出超过 100KB 会自动截断

## 适用场景
- 运行脚本、自动化任务
- 编译、构建项目
- 查看系统信息、网络状态
- 包管理器操作（npm/pip/go 等）
- 文件操作（推荐优先使用 filesystem 工具的 read/write/edit）`,
  inputSchema: z.toJSONSchema(ExecuteSchema)
}

export async function handleExecuteTool(args: unknown) {
  const parsed = ExecuteSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`参数错误: ${parsed.error}`)
  }

  const { command, cwd, timeout, description } = parsed.data
  const workDir = cwd || os.homedir()

  // ── 危险命令检查 ──────────────────────────────────
  if (isDangerousCommand(command)) {
    const summary = description || getCommandSummary(command)
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '⚠️ AI 请求执行危险命令',
      message: `AI 请求执行: ${summary}`,
      detail: `命令: ${command}\n\n此操作可能对系统产生影响，请确认是否允许。`,
      buttons: ['拒绝执行', '允许执行'],
      defaultId: 0,
      cancelId: 0,
    })
    if (result.response !== 1) {
      logger.info('Dangerous command rejected by user', { command })
      return {
        content: [{ type: 'text', text: `用户拒绝了危险命令: ${command}` }],
        isError: true
      }
    }
  }

  // ── 检查工作目录是否存在 ─────────────────────────────
  try {
    await fs.access(workDir)
  } catch {
    return {
      content: [{ type: 'text', text: `工作目录不存在: ${workDir}` }],
      isError: true
    }
  }

  // ── 执行命令 ──────────────────────────────────────
  const timeoutMs = Math.min(timeout || DEFAULT_TIMEOUT_MS, 120_000) // 最大 2 分钟

  return new Promise((resolve) => {
    logger.info(`Executing: ${command} (cwd=${workDir}, timeout=${timeoutMs}ms)`)

    const child = exec(`${command}`, {
      cwd: workDir,
      shell: process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash',
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_LENGTH,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
      // Windows fallback
      if (process.platform === 'win32') {
        try {
          process.kill(child.pid!)
        } catch { /* ok */ }
      }
    }, timeoutMs)

    child.stdout?.on('data', (data: string) => {
      stdout += data
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n... [输出已截断]'
        child.kill('SIGTERM')
      }
    })

    child.stderr?.on('data', (data: string) => {
      stderr += data
    })

    child.on('close', (code) => {
      clearTimeout(timer)

      const output: string[] = []
      output.push(`$ ${command}`)
      output.push(`工作目录: ${path.resolve(workDir)}`)
      output.push('')

      if (stdout.trim()) {
        output.push('── stdout ──')
        output.push(stdout.trimEnd())
      }

      if (stderr.trim()) {
        output.push('── stderr ──')
        output.push(stderr.trimEnd())
      }

      output.push('')
      if (killed) {
        output.push(`! 命令超时 (${timeoutMs}ms)` + (code !== null ? `, 退出码: ${code}` : ''))
      } else {
        output.push(`退出码: ${code ?? '未知'}`)
      }

      logger.info(`Command completed (exit=${code}, stdout=${stdout.length}bytes, stderr=${stderr.length}bytes)`)

      resolve({
        content: [{ type: 'text', text: output.join('\n') }]
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      logger.error('Command execution error:', err)
      resolve({
        content: [{ type: 'text', text: `命令执行失败: ${err.message}` }],
        isError: true
      })
    })
  })
}
