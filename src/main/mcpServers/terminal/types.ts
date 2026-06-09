/**
 * Terminal MCP Server - types and security utilities
 */
import path from 'node:path'

import { loggerService } from '@logger'

export const logger = loggerService.withContext('MCP:TerminalServer')

export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_OUTPUT_LENGTH = 100_000

// ─── 系统保护路径（与 filesystem MCP 保持一致）────────────

/** 受保护的 Windows 系统目录 */
const SYSTEM_PROTECTED_DIRS: string[] = [
  ...(() => {
    const dirs = new Set<string>()
    for (const key of ['WINDIR', 'SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'ALLUSERSPROFILE']) {
      const val = process.env[key]
      if (val) dirs.add(path.resolve(val).toLowerCase())
    }
    return [...dirs]
  })(),
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  'c:\\system volume information',
  'c:\\$recycle.bin',
  'c:\\recovery',
  'c:\\config.msi'
]

/**
 * 检查路径是否在系统保护目录内
 */
function isPathUnderProtected(targetPath: string): boolean {
  const resolved = path.resolve(targetPath).toLowerCase()
  for (const dir of SYSTEM_PROTECTED_DIRS) {
    if (!dir) continue
    const normalizedDir = path.resolve(dir).toLowerCase()
    if (resolved === normalizedDir) return true
    const relative = path.relative(normalizedDir, resolved)
    if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return true
    }
  }
  return false
}

/**
 * 从命令中提取文件路径参数。
 * 使用 \b 单词边界而非 ^ 开头，防止 "cmd.exe /c del file" 绕过。
 */
const FILE_CMD_PATTERNS = [
  // Windows cmd 删除
  /\b(?:del|erase|rd|rmdir)\s+(.+?)(?:\s*\/[a-z]\s*)?$/im,
  // Windows cmd 复制/移动
  /\b(?:copy|xcopy|robocopy)\s+("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  /\b(?:move|ren|rename)\s+("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  // Windows cmd 读取
  /\b(?:type|more)\s+(.+)$/im,
  // Unix 删除
  /\brm\s+(?:-[rf]+\s+)?(.+)$/im,
  /\brmdir\s+(.+)$/im,
  // Unix 复制/移动
  /\bcp\s+(?:-[a-z]+\s+)?("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  /\bmv\s+(?:-[a-z]+\s+)?("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  // Unix 读取
  /\bcat\s+(.+)$/im,
  /\b(?:head|tail|less|more)\s+(.+)$/im,
  // PowerShell 删除
  /\bremove-item\s+(?:-(?:path|literalpath)\s+)?(.+?)(?:\s+-|\||$)/im,
  /\bri\s+(?:-(?:path|literalpath)\s+)?(.+?)(?:\s+-|\||$)/im,
  // PowerShell 复制/移动
  /\bmove-item\s+(?:-path\s+)?(.+?)(\s+-destination\s+.+?)?(?:\s+-|\||$)/im,
  /\bcopy-item\s+(?:-path\s+)?(.+?)(\s+-destination\s+.+?)?(?:\s+-|\||$)/im,
  /\brename-item\s+(?:-path\s+)?(.+?)(?:\s+-|\||$)/im,
  // PowerShell 读取
  /\bget-content\s+(?:-path\s+)?(.+?)(?:\s+-|\||$)/im,
  /\bgc\s+(.+?)(?:\s+-|\||$)/im,
  /\bcat\s+(.+?)(?:\s+-|\||$)/im
]

/** 展开命令中的环境变量（%VAR% → 值） */
function resolveEnvVarsInCmd(cmd: string): string {
  return cmd.replace(/%([^%]+)%/g, (_, key: string) => {
    return process.env[key] || `%${key}%`
  })
}

/**
 * 检测命令是否操作了受保护的系统路径。
 * 如果是，返回被操作的受保护文件路径列表；否则返回空数组。
 */
export function checkProtectedFileOperation(command: string): string[] {
  const violated: string[] = []

  // 先展开环境变量再匹配，防止 %SystemRoot% 绕过
  const expanded = resolveEnvVarsInCmd(command)

  for (const pattern of FILE_CMD_PATTERNS) {
    const match = expanded.trim().match(pattern)
    if (!match) continue

    // 提取路径参数
    const args = match[1] || ''
    // 去掉引号
    const paths = args.match(/"([^"]+)"|(\S+)/g)?.map((p) => p.replace(/^"|"$/g, '')) || [args]

    for (const filePath of paths) {
      if (isPathUnderProtected(filePath)) {
        violated.push(filePath)
      }
    }
  }

  return violated
}

// ─── 危险命令检测 ──────────────────────────────────────

/** 被禁止的危险命令前缀 */
export const DANGEROUS_COMMANDS = [
  'format',
  'mkfs',
  'dd',
  'fdisk',
  'parted',
  'wipefs',
  'rm -rf /',
  'rm -rf --no-preserve-root',
  'del /f /s /q',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
  'sudo',
  'su ',
  'chmod 777',
  'chown',
  'nmap',
  'hydra',
  'aircrack',
  'metasploit',
  'wget *miner',
  'curl *miner'
]

export const DANGEROUS_WIN_COMMANDS = [
  'diskpart',
  'bcdedit',
  'bootrec',
  'reg delete',
  'sc delete',
  'net user',
  'net localgroup',
  'netsh firewall',
  'vssadmin',
  'wm ic'
]

export function isDangerousCommand(cmd: string): boolean {
  const lower = cmd.trim().toLowerCase()
  for (const pattern of DANGEROUS_COMMANDS) {
    // 全文匹配，防止 "cmd.exe /c shutdown" 绕过
    if (lower.includes(pattern)) return true
  }
  for (const pattern of DANGEROUS_WIN_COMMANDS) {
    if (lower.includes(pattern)) return true
  }
  return false
}

/** 检测命令是否为文件/目录删除操作（全文扫描，防止 cmd.exe /c 绕过） */
function isDeleteCommand(lower: string): boolean {
  // cmd: del, erase, rd, rmdir（任意位置）
  if (/\b(?:del|erase|rd|rmdir)\s/.test(lower)) return true
  // Unix: rm（任意位置，排除 rm -rf /）
  if (/\brm\s+(?!-rf\s+\/)/.test(lower) && !/\brm -rf\s+\//.test(lower)) return true
  // PowerShell: Remove-Item, ri（任意位置）
  if (/\bremove-item\b/.test(lower)) return true
  if (/\bri\s/.test(lower)) return true
  return false
}

/** 检测命令是否为文件移动/重命名操作 */
function isMoveCommand(lower: string): boolean {
  if (/^(?:mv|move|ren|rename)\s/.test(lower)) return true
  if (/^move-item\b/.test(lower)) return true
  if (/^rename-item\b/.test(lower)) return true
  return false
}

/** 检测命令是否为文件复制操作 */
function isCopyCommand(lower: string): boolean {
  if (/^(?:cp|copy|xcopy|robocopy)\s/.test(lower)) return true
  if (/^copy-item\b/.test(lower)) return true
  return false
}

/** 检测命令是否为下载操作 */
function isDownloadCommand(lower: string): boolean {
  if (/^(?:wget|curl|iwr|invoke-webrequest)\s/.test(lower)) return true
  return false
}

export function getCommandSummary(cmd: string): string {
  const lower = cmd.trim().toLowerCase()
  if (isDeleteCommand(lower)) return '删除文件/目录'
  if (isMoveCommand(lower)) return '移动/重命名'
  if (isCopyCommand(lower)) return '复制文件'
  if (isDownloadCommand(lower)) return '下载文件'
  if (/^net\b/.test(lower)) return '网络配置变更'
  if (/^reg\b/.test(lower)) return '注册表操作'
  if (/^(?:taskkill|kill)\s/.test(lower)) return '终止进程'
  if (/^(pip|npm|yarn|pnpm|go |cargo |gem |brew |choco |winget |scoop )/.test(lower)) return '包管理器操作'
  return '执行命令'
}

/** 检测命令是否为写文件操作 */
function isWriteCommand(lower: string): boolean {
  if (/\bset-content\b/.test(lower)) return true
  if (/\bsc\s+(?:-(?:path|literalpath)\s+)?/i.test(lower)) return true
  if (/\bout-file\b/.test(lower)) return true
  if (/\badd-content\b/.test(lower)) return true
  if (/\bac\s+(?:-(?:path|literalpath)\s+)?/i.test(lower)) return true
  if (/>\s+['"][^'"]+['"]/.test(lower)) return true // echo text > "file"
  return false
}

/** 检测命令是否为破坏性操作（删除/移动/覆写等） */
export function isDestructiveCommand(command: string): boolean {
  const lower = command.trim().toLowerCase()
  return isDeleteCommand(lower) || isMoveCommand(lower) || isCopyCommand(lower) || isWriteCommand(lower)
}

/**
 * 从命令字符串中提取所有被操作的文件路径（与 checkProtectedFileOperation 共享规则）
 * 不限制系统保护路径，返回所有匹配到的路径
 */
export function extractFilePathsFromCommand(command: string): string[] {
  const expanded = resolveEnvVarsInCmd(command)
  const result: string[] = []

  for (const pattern of FILE_CMD_PATTERNS) {
    const match = expanded.trim().match(pattern)
    if (!match) continue

    const args = match[1] || ''
    const paths =
      args
        .match(/"([^"]+)"|(\S+)/g)
        ?.map((p) => p.replace(/^"|"$/g, ''))
        .filter((p) => p.startsWith('/') || path.isAbsolute(p)) || []

    for (const p of paths) {
      if (p && !result.includes(p)) result.push(p)
    }
  }

  // 兜底：从引号中提取绝对路径
  if (result.length === 0) {
    const quoted = command.match(/['"]([a-zA-Z]:\\[^'"]+)['"]/)
    if (quoted) result.push(quoted[1])
  }

  return result
}
