/**
 * Terminal MCP - execute_command tool
 *
 * 在本地终端中执行命令，返回 stdout/stderr。
 * 危险命令会触发用户确认弹窗。
 */
import { dialog, shell } from 'electron'
import { exec } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as z from 'zod'

import { checkProtectedFileOperation, DEFAULT_TIMEOUT_MS, getCommandSummary, isDangerousCommand, logger, MAX_OUTPUT_LENGTH } from '../types'

/** 从删除命令中提取文件路径 */
function extractPathFromCommand(cmd: string): string | null {
  // 提取引号包裹的路径："C:\Users\..." 或 'C:\Users\...'
  const q = cmd.match(/['"]([a-zA-Z]:\\[^'"]+)['"]/)
  if (q) return q[1]

  // 提取裸露的 Windows 路径（命令参数中第一个盘符开头的字符串）
  const words = cmd.split(/\s+/)
  for (const w of words) {
    const p = w.replace(/["']/g, '')
    if (/^[a-zA-Z]:\\/i.test(p) && p.length > 3) return p
  }
  return null
}

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

  // ── 系统保护路径的删除操作需要用户确认 ────────────────
  const cmdSummary = getCommandSummary(command)
  const protectedPaths = checkProtectedFileOperation(command)

  if (cmdSummary === '删除文件/目录' && protectedPaths.length > 0) {
    const pathsStr = protectedPaths.join('\n')
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '⚠️ AI 请求删除系统保护路径中的文件',
      message: `AI 请求删除受系统保护的文件`,
      detail: `命令: ${command}\n\n以下路径受系统保护：\n${pathsStr}\n\n确认后将移入回收站。`,
      buttons: ['取消', '确认删除'],
      defaultId: 0,
      cancelId: 0,
    })
    if (result.response !== 1) {
      logger.info('Delete of protected file rejected by user', { command, paths: protectedPaths })
      return {
        content: [{ type: 'text', text: `用户已取消删除受保护路径的文件: ${command}` }],
        isError: true
      }
    }
    // 用户确认 → 提取路径并移入回收站
    try {
      const filePath = extractPathFromCommand(command)
      if (filePath) {
        await shell.trashItem(filePath)
        logger.info('Protected file moved to trash (user confirmed)', { command, path: filePath })
        return {
          content: [{
            type: 'text',
            text: `$ ${command}\n\n文件已安全移入回收站 ✅`
          }]
        }
      }
    } catch (e) {
      logger.error('Failed to move file to trash:', e as Error)
      return {
        content: [{ type: 'text', text: `删除失败: ${e instanceof Error ? e.message : e}` }],
        isError: true
      }
    }
  }

  // ── 危险命令检查 ──────────────────────────────────
  if (isDangerousCommand(command)) {
    const summary = description || cmdSummary
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

  // ── 检查是否操作受保护的系统路径 ─────────────────────
  const protectedFiles = checkProtectedFileOperation(command)
  if (protectedFiles.length > 0) {
    const pathsStr = protectedFiles.join('\n')
    await dialog.showMessageBox({
      type: 'warning',
      title: '⚠️ 禁止操作系统保护路径',
      message: `AI 试图操作受系统保护的文件/目录`,
      detail: `以下路径受系统保护，禁止 AI 修改：\n${pathsStr}\n\n命令: ${command}`,
      buttons: ['我知道了，取消执行'],
      defaultId: 0,
      cancelId: 0,
    })
    logger.info('Protected file operation rejected', { command, paths: protectedFiles })
    return {
      content: [{ type: 'text', text: `错误：无法操作受系统保护的路径：\n${pathsStr}\n\n此路径受系统保护，禁止 AI 修改。` }],
      isError: true
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
