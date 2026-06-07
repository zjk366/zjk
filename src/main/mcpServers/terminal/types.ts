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
  // Windows: del/erase file, rmdir/rd dir, copy src dst, move src dst, ren old new
  /^(?:del|erase|rd|rmdir)\s+(.+?)(?:\s*\/[a-z]\s*)?$/im,
  /^(?:copy|xcopy|robocopy)\s+("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  /^(?:move|ren|rename)\s+("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  // Unix: rm file, rm -rf dir, rmdir dir, mv src dst, cp src dst
  /^rm\s+(?:-[rf]+\s+)?(.+)$/im,
  /^rmdir\s+(.+)$/im,
  /^cp\s+(?:-[a-z]+\s+)?("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  /^mv\s+(?:-[a-z]+\s+)?("(?:[^"]+)"\s+"(?:[^"]+)")/im,
  // PowerShell: Remove-Item, Move-Item, Copy-Item
  /^remove-item\s+(?:-path\s+)?(.+?)(?:\s+-|\||$)/im,
  /^move-item\s+(?:-path\s+)?(.+?)(\s+-destination\s+.+?)?(?:\s+-|\||$)/im,
  /^copy-item\s+(?:-path\s+)?(.+?)(\s+-destination\s+.+?)?(?:\s+-|\||$)/im,
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

export function getCommandSummary(cmd: string): string {
  const lower = cmd.trim().toLowerCase()
  if (lower.startsWith('rm ') || lower.startsWith('del ') || lower.startsWith('rd ') || lower.startsWith('rmdir ')) {
    return '删除文件/目录'
  }
  if (lower.startsWith('mv ') || lower.startsWith('move ') || lower.startsWith('ren ')) {
    return '移动/重命名'
  }
  if (lower.startsWith('cp ') || lower.startsWith('copy ') || lower.startsWith('xcopy ') || lower.startsWith('robocopy')) {
    return '复制文件'
  }
  if (lower.startsWith('net')) return '网络配置变更'
  if (lower.startsWith('reg')) return '注册表操作'
  if (lower.startsWith('taskkill') || lower.startsWith('kill')) return '终止进程'
  if (lower.startsWith('wget ') || lower.startsWith('curl ') || lower.startsWith('iwr ')) return '下载文件'
  if (/^(pip|npm|yarn|pnpm|go |cargo |gem |brew |choco |winget |scoop )/.test(lower)) return '包管理器操作'
  return '执行命令'
}
