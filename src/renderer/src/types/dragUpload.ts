/**
 * 拖拽上传功能的类型定义
 *
 * 支持文件和文件夹混合拖拽上传，包含安全校验和虚拟路径映射。
 */

/** 拖拽上传的文件节点类型 */
export type DragUploadNodeType = 'file' | 'folder'

/** 拖拽上传解析后的文件树节点 */
export interface DragUploadNode {
  /** 节点唯一标识 */
  id: string
  /** 节点类型 */
  type: DragUploadNodeType
  /** 文件名/文件夹名 */
  name: string
  /** 相对于根文件夹的虚拟路径（不暴露系统绝对路径） */
  relativePath: string
  /** 文件大小（字节），文件夹为子节点总和 */
  size: number
  /** 文件扩展名（不含点），文件夹为空 */
  ext: string
  /** 子节点（仅文件夹有） */
  children?: DragUploadNode[]
  /** 原始 File 对象（仅文件有，用于后续上传） */
  file?: File
}

/** 拖拽上传的解析结果 */
export interface DragUploadResult {
  /** 根节点树 */
  root: DragUploadNode
  /** 文件总数 */
  totalFiles: number
  /** 文件夹总数 */
  totalFolders: number
  /** 总大小（字节） */
  totalSize: number
}

/** 拖拽上传的状态 */
export type DragUploadStatus = 'idle' | 'dragging' | 'parsing' | 'ready' | 'uploading' | 'error'

/** 拖拽上传上下文 */
export interface DragUploadContextValue {
  /** 当前状态 */
  status: DragUploadStatus
  /** 解析结果 */
  result: DragUploadResult | null
  /** 是否正在拖拽中 */
  isDragging: boolean
  /** 错误信息 */
  error: string | null
  /** 清除当前上传数据 */
  clear: () => void
  /** 确认上传（将文件注入 Inputbar） */
  confirm: () => void
}

/** 文件类型白名单 - 允许上传的扩展名 */
export const ALLOWED_EXTENSIONS = new Set([
  // 文档类
  'txt', 'md', 'markdown', 'pdf', 'doc', 'docx', 'csv', 'json', 'xml', 'yaml', 'yml',
  // 代码类
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'cc', 'cxx',
  'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'kts', 'sql', 'sh', 'bash', 'zsh',
  'html', 'htm', 'css', 'scss', 'less', 'sass', 'vue', 'svelte', 'astro',
  'lua', 'r', 'pl', 'pm', 'dart', 'scala', 'clj', 'cljs', 'elm', 'hs', 'erl', 'ex', 'exs',
  'tf', 'tfvars', 'gradle', 'cmake', 'makefile', 'dockerfile',
  // 配置文件
  'toml', 'ini', 'cfg', 'conf', 'env', 'editorconfig', 'gitignore', 'properties',
  // 图片类
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'tif',
  // 数据类
  'log', 'lock', 'patch', 'diff',
])

/** 危险文件类型黑名单 - 禁止上传 */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'vbs', 'vbe', 'wsf', 'wsh',
  'dll', 'sys', 'drv', 'ocx', 'cpl',
  'so', 'dylib', 'bundle', 'app', 'framework',
  'deb', 'rpm', 'pkg', 'apk', 'ipa', 'xapk',
  'iso', 'img', 'bin', 'dat', 'dmg',
  'jar', 'war', 'ear', 'class',
  'ps1', 'psm1', 'psd1', 'psc1', 'reg',
])

/** 单文件最大大小：10MB */
export const MAX_SINGLE_FILE_SIZE = 10 * 1024 * 1024

/** 文件夹总大小限制：50MB */
export const MAX_FOLDER_TOTAL_SIZE = 50 * 1024 * 1024

/** 文件夹最大递归深度 */
export const MAX_FOLDER_DEPTH = 20

/** 文件夹最大文件数 */
export const MAX_FILES_IN_FOLDER = 500
