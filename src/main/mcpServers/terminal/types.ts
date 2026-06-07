/**
 * Terminal MCP Server - types and security utilities
 */
import { loggerService } from '@logger'

export const logger = loggerService.withContext('MCP:TerminalServer')

export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_OUTPUT_LENGTH = 100_000

/** 被禁止的危险命令前缀（部分匹配，不区分大小写） */
export const DANGEROUS_COMMANDS = [
  // 格式化/擦除
  'format', 'mkfs', 'dd', 'fdisk', 'parted', 'wipefs',
  // 暴力删除
  'rm -rf /', 'rm -rf --no-preserve-root', 'del /f /s /q',
  // 系统级操作
  'shutdown', 'reboot', 'halt', 'poweroff', 'init',
  // 权限提升
  'sudo', 'su ', 'chmod 777', 'chown',
  // 网络攻击
  'nmap', 'hydra', 'aircrack', 'metasploit',
  // 挖矿/恶意软件
  'wget *miner', 'curl *miner',
]

/** Windows 特有危险命令 */
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

/**
 * 获取命令的友好描述（用于确认弹窗）
 */
export function getCommandSummary(cmd: string): string {
  const lower = cmd.trim().toLowerCase()
  if (lower.startsWith('rm ') || lower.startsWith('del ') || lower.startsWith('rd ')) {
    return '删除文件/目录'
  }
  if (lower.startsWith('mv ') || lower.startsWith('move ') || lower.startsWith('ren ')) {
    return '移动/重命名'
  }
  if (lower.startsWith('cp ') || lower.startsWith('copy ') || lower.startsWith('xcopy ') || lower.startsWith('robocopy')) {
    return '复制文件'
  }
  if (lower.startsWith('net')) {
    return '网络配置变更'
  }
  if (lower.startsWith('reg')) {
    return '注册表操作'
  }
  if (lower.startsWith('taskkill') || lower.startsWith('kill')) {
    return '终止进程'
  }
  if (lower.startsWith('wget ') || lower.startsWith('curl ') || lower.startsWith('iwr ') || lower.startsWith('invoke-webrequest')) {
    return '下载文件'
  }
  if (/^(pip|npm|yarn|pnpm|go |cargo |gem |brew |choco |winget |scoop )/.test(lower)) {
    return '包管理器操作'
  }
  return '执行命令'
}
