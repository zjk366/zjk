/**
 * Terminal MCP Server - types and security utilities
 */
import { loggerService } from '@logger'
import path from 'node:path'

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
  'c:\\config.msi',
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

/** 从命令中提取文件路径参数（简易解析） */
const FILE_CMD_PATTERNS = [
  // Windows cmd
  /^(?:del|erase|rd|rmdir)\s+(.+?)(?:\s*\/[a-z]\s*)?$/im,
  /^(?:copy|xcopy|robocopy)\s+("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  /^(?:move|ren|rename)\s+("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  // Unix
  /^rm\s+(?:-[rf]+\s+)?(.+)$/im,
  /^rmdir\s+(.+)$/im,
  /^cp\s+(?:-[a-z]+\s+)?("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  /^mv\s+(?:-[a-z]+\s+)?("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  // PowerShell: Remove-Item (支持 -Path 和 -LiteralPath 参数)
  /^remove-item\s+(?:-(?:path|literalpath)\s+)?(.+?)(?:\s+-|\||$)/im,
  /^ri\s+(?:-(?:path|literalpath)\s+)?(.+?)(?:\s+-|\||$)/im,
  /^move-item\s+(?:-path\s+)?(.+?)(\s+-destination\s+.+?)?(?:\s+-|\||$)/im,
  /^copy-item\s+(?:-path\s+)?(.+?)(\s+-destination\s+.+?)?(?:\s+-|\||$)/im,
  /^rename-item\s+(?:-path\s+)?(.+?)(?:\s+-|\||$)/im,
]

/**
 * 检测命令是否操作了受保护的系统路径。
 * 如果是，返回被操作的受保护文件路径列表；否则返回空数组。
 */
export function checkProtectedFileOperation(command: string): string[] {
  const violated: string[] = []

  for (const pattern of FILE_CMD_PATTERNS) {
    const match = command.trim().match(pattern)
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
  'format', 'mkfs', 'dd', 'fdisk', 'parted', 'wipefs',
  'rm -rf /', 'rm -rf --no-preserve-root', 'del /f /s /q',
  'shutdown', 'reboot', 'halt', 'poweroff', 'init',
  'sudo', 'su ', 'chmod 777', 'chown',
  'nmap', 'hydra', 'aircrack', 'metasploit',
  'wget *miner', 'curl *miner',
]

export const DANGEROUS_WIN_COMMANDS = [
  'diskpart', 'bcdedit', 'bootrec', 'reg delete', 'sc delete',
  'net user', 'net localgroup', 'netsh firewall',
  'vssadmin', 'wm ic',
]

export function isDangerousCommand(cmd: string): boolean {
  const lower = cmd.trim().toLowerCase()
  for (const pattern of DANGEROUS_COMMANDS) {
    if (lower.startsWith(pattern)) return true
  }
  for (const pattern of DANGEROUS_WIN_COMMANDS) {
    if (lower.startsWith(pattern)) return true
  }
  return false
}

/** 检测命令是否为文件/目录删除操作（含 PowerShell 变体） */
function isDeleteCommand(lower: string): boolean {
  // cmd: del, erase, rd, rmdir
  if (/^(?:del|erase|rd|rmdir)\s/.test(lower)) return true
  // Unix: rm (不含 rm -rf / 已在 dangerous 处理)
  if (/^rm\s+(?:(?!-rf\s+\/).)*$/.test(lower) && !lower.startsWith('rm -rf /')) return true
  // PowerShell: Remove-Item, ri (alias), rm (PowerShell alias)
  if (/^remove-item\b/.test(lower)) return true
  if (/^ri\s/.test(lower)) return true
  // PowerShell with -LiteralPath
  if (/^remove-item\s+-literalpath\b/.test(lower)) return true
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
