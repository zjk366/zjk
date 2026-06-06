import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { FileMetadata, KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { filterSupportedFiles, formatFileSize } from '@renderer/utils/file'
import { Tooltip } from 'antd'
import dayjs from 'dayjs'
import { FileSearch, FileText, FolderOpen, FolderTree, List, Paperclip, Upload, X } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  quickPanel: ToolQuickPanelApi
  couldAddImageFile: boolean
  extensions: string[]
  files: FileMetadata[]
  setFiles: Dispatch<SetStateAction<FileMetadata[]>>
  disabled?: boolean
  onTextChange?: (updater: string | ((prev: string) => string)) => void
}

// 目录树节点
interface TreeNode {
  name: string
  isDir: boolean
  children: Map<string, TreeNode>
}

// 从扁平文件路径列表构建目录树（不依赖 listDirectory API）
function buildTreeFromPaths(rootPath: string, filePaths: string[]): TreeNode | null {
  // 规范化根路径（统一用 /，去掉末尾斜杠）
  const root = rootPath.replace(/\\/g, '/').replace(/\/$/, '')
  const rootName = root.split('/').pop() || root

  const treeRoot: TreeNode = { name: rootName, isDir: true, children: new Map() }

  for (const rawPath of filePaths) {
    const normalized = rawPath.replace(/\\/g, '/')
    // 去掉根路径前缀得到相对路径
    let relative = normalized
    if (normalized.startsWith(root + '/')) {
      relative = normalized.slice(root.length + 1)
    } else if (normalized.startsWith(root)) {
      relative = normalized.slice(root.length)
    }
    if (!relative) continue

    const parts = relative.split('/')
    let current = treeRoot
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue
      const isLast = i === parts.length - 1
      if (!current.children.has(part)) {
        current.children.set(part, { name: part, isDir: !isLast, children: new Map() })
      }
      const child = current.children.get(part)!
      // 如果之前以为是目录但实际上是文件，修正
      if (isLast) child.isDir = false
      current = child
    }
  }

  return treeRoot
}

// 计算节点下所有子孙文件数
function countFiles(node: TreeNode): number {
  let count = 0
  for (const child of node.children.values()) {
    if (child.isDir) {
      count += countFiles(child)
    } else {
      count++
    }
  }
  return count
}

// 将目录树转为简洁的树形文本
// 折叠规则：只按直接子节点数判断（非子孙总数），保证深层次包结构不被隐藏
function treeToText(node: TreeNode, prefix = '', isLast = true, collapseThreshold = 10): string {
  const entries = [...node.children.entries()]
  entries.sort((a, b) => {
    if (a[1].isDir !== b[1].isDir) return a[1].isDir ? -1 : 1
    return a[0].localeCompare(b[0])
  })

  // 计算直接子文件数（只算当前层）
  const directFiles = entries.filter(([, c]) => !c.isDir).length
  const directDirs = entries.filter(([, c]) => c.isDir).length
  const totalDirect = entries.length

  let result = ''
  for (let i = 0; i < entries.length; i++) {
    const [name, child] = entries[i]
    const last = i === entries.length - 1
    const connector = last ? '└── ' : '├── '
    const childPrefix = prefix + (last ? '    ' : '│   ')

    if (child.isDir) {
      const grandChildren = child.children.size
      result += `${prefix}${connector}${name}/\n`

      if (grandChildren > collapseThreshold) {
        // 直接子节点太多才折叠
        const subFiles = [...child.children.values()].filter((c) => !c.isDir).length
        const subDirs = grandChildren - subFiles
        const parts: string[] = []
        if (subDirs > 0) parts.push(`${subDirs} 个子目录`)
        if (subFiles > 0) parts.push(`${subFiles} 个文件`)
        result += `${childPrefix}(共 ${parts.join('，')})\n`
      } else if (grandChildren > 0) {
        result += treeToText(child, childPrefix, last, collapseThreshold)
      }
    } else {
      result += `${prefix}${connector}${name}\n`
    }
  }
  return result
}

const AttachmentButton: FC<Props> = ({ quickPanel, couldAddImageFile, extensions, files, setFiles, disabled, onTextChange }) => {
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const { bases: knowledgeBases } = useKnowledgeBases()
  const [selecting, setSelecting] = useState<boolean>(false)
  const [scanning, setScanning] = useState<boolean>(false)
  // 文件夹选择模式：null=未选择, 'tree'=保留结构, 'flat'=仅文件
  const [folderMode, setFolderMode] = useState<{ path: string; name: string } | null>(null)

  // 递归扫描目录（获取所有文件的 FileMetadata）
  const scanDirRecursive = useCallback(async (dirPath: string): Promise<FileMetadata[]> => {
    const result: FileMetadata[] = []
    try {
      const listFn = (window.api.file as any).listDirectory as
        ((p: string) => Promise<{ name: string; path: string; type: string; isDirectory?: boolean }[]>) | undefined
      if (typeof listFn !== 'function') return result

      const entries = await listFn(dirPath)
      for (const entry of entries || []) {
        const fullPath = entry.path || `${dirPath}/${entry.name}`.replace(/\/\//g, '/')
        if (entry.isDirectory || entry.type === 'directory' || entry.type === 'folder') {
          const subFiles = await scanDirRecursive(fullPath)
          result.push(...subFiles)
        } else {
          try {
            const meta = await window.api.file.get(fullPath)
            if (meta) result.push(meta)
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
    return result
  }, [])

  // 扫出所有文件并过滤危险类型
  const doScanFiles = useCallback(async (dirPath: string): Promise<FileMetadata[]> => {
    let scanned: FileMetadata[] = []
    if (typeof (window.api.file as any).listAllFiles === 'function') {
      scanned = await (window.api.file as any).listAllFiles(dirPath)
    } else {
      scanned = await scanDirRecursive(dirPath)
    }
    const dangerous = new Set(['exe', 'bat', 'cmd', 'com', 'dll', 'sys', 'msi', 'scr', 'pif', 'so', 'dylib'])
    return scanned.filter((f) => {
      const ext = (f.ext || f.origin_name?.split('.').pop() || '').toLowerCase().replace(/^\./, '')
      return !dangerous.has(ext)
    })
  }, [scanDirRecursive])

  // 保留目录结构：生成目录树并注入输入框（不读取文件内容，按需由 AI 读取）
  const handleTreeMode = useCallback(async () => {
    if (!folderMode) return
    setFolderMode(null)
    setScanning(true)
    try {
      const filesToAdd = await doScanFiles(folderMode.path)

      if (filesToAdd.length === 0) {
        window.toast.info('未找到可上传的文件')
        return
      }

      // 从文件路径构建目录树
      const filePaths = filesToAdd.map((f) => f.path)
      const tree = buildTreeFromPaths(folderMode.path, filePaths)

      if (!tree || tree.children.size === 0 || !onTextChange) {
        window.toast.info('文件夹为空')
        return
      }

      const treeBody = treeToText(tree)
      const totalFiles = countFiles(tree)
      const subDirs = [...tree.children.values()].filter((c) => c.isDir).length
      const safePath = folderMode.path.replace(/\\/g, '/')

      // 默认不读取文件内容，只展示目录结构
      // AI 可通过 Read/Glob 等工具在用户提出需求时按需读取
      const outputParts = [
        `## 📂 ${tree.name}/`,
        `> 路径：${safePath}`,
        `> 共 ${totalFiles} 个文件，${subDirs} 个子目录`,
        '',
        '### 目录结构',
        '```',
        `${tree.name}/`,
        treeBody,
        '```',
        '',
        '> 💡 需要查看或修改文件时请直接告诉 AI，它会自动读取并处理。',
      ]

      onTextChange((prev) => {
        const sep = prev ? '\n\n' : ''
        return prev + sep + outputParts.join('\n')
      })

      window.toast.success('目录结构已生成')
    } catch (err) {
      console.error('Tree mode failed:', err)
      window.toast.error(`处理失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setScanning(false)
    }
  }, [folderMode, doScanFiles, onTextChange])

  // 仅上传文件（平铺）
  const handleFlatMode = useCallback(async () => {
    if (!folderMode) return
    setFolderMode(null)
    setScanning(true)
    try {
      const filesToAdd = await doScanFiles(folderMode.path)
      if (filesToAdd.length === 0) {
        window.toast.info('未找到可上传的文件')
        return
      }
      setFiles((prev) => [...prev, ...filesToAdd])
      window.toast.success(`已添加 ${filesToAdd.length} 个文件`)
    } catch (err) {
      console.error('Flat mode failed:', err)
      window.toast.error(`扫描失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setScanning(false)
    }
  }, [folderMode, doScanFiles, setFiles])

  // 选择文件夹 → 弹出模式选择
  const openFolderSelectDialog = useCallback(async () => {
    if (scanning || folderMode) return
    try {
      const folderPath = await window.api.file.selectFolder({ title: '选择文件夹' })
      if (!folderPath) return
      const name = folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath
      setFolderMode({ path: folderPath, name })
    } catch (err) {
      console.error('Select folder failed:', err)
      window.toast.error('选择文件夹失败')
    }
  }, [scanning, folderMode])

  const openFileSelectDialog = useCallback(async () => {
    if (selecting) return
    const useAllFiles = extensions.length > 20
    setSelecting(true)
    const _files = await window.api.file.select({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Files', extensions: useAllFiles ? ['*'] : extensions.map((i) => i.replace('.', '')) }]
    })
    setSelecting(false)
    if (_files) {
      if (!useAllFiles) {
        setFiles([...files, ..._files])
        return
      }
      const supportedFiles = await filterSupportedFiles(_files, extensions)
      if (supportedFiles.length > 0) setFiles([...files, ...supportedFiles])
      if (supportedFiles.length !== _files.length) {
        window.toast.info(t('chat.input.file_not_supported_count', { count: _files.length - supportedFiles.length }))
      }
    }
  }, [extensions, files, selecting, setFiles, t])

  const openKnowledgeFileList = useCallback(
    (base: KnowledgeBase) => {
      quickPanelHook.open({
        title: base.name,
        list: base.items
          .filter((file): file is KnowledgeItem => ['file'].includes(file.type))
          .map((file) => {
            const fileContent = file.content as FileMetadata
            return {
              label: fileContent.origin_name || fileContent.name,
              description: formatFileSize(fileContent.size) + ' · ' + dayjs(fileContent.created_at).format('YYYY-MM-DD HH:mm'),
              icon: <FileText />,
              isSelected: files.some((f) => f.path === fileContent.path),
              action: async ({ item }) => {
                item.isSelected = !item.isSelected
                if (fileContent.path) {
                  setFiles((prevFiles) => {
                    const fileExists = prevFiles.some((f) => f.path === fileContent.path)
                    if (fileExists) return prevFiles.filter((f) => f.path !== fileContent.path)
                    return fileContent ? [...prevFiles, fileContent] : prevFiles
                  })
                }
              }
            }
          }),
        symbol: QuickPanelReservedSymbol.File,
        multiple: true
      })
    },
    [files, quickPanelHook, setFiles]
  )

  const items = useMemo(() => {
    return [
      { label: t('chat.input.upload.upload_from_local'), description: '', icon: <Upload />, action: () => openFileSelectDialog() },
      { label: t('chat.input.upload.select_folder'), description: '', icon: <FolderOpen />, disabled: scanning, action: () => { void openFolderSelectDialog() } },
      ...knowledgeBases.map((base) => {
        const length = base.items?.filter((item): item is KnowledgeItem => ['file', 'note'].includes(item.type) && typeof item.content !== 'string').length
        return { label: base.name, description: `${length} ${t('files.count')}`, icon: <FileSearch />, disabled: length === 0, isMenu: true, action: () => openKnowledgeFileList(base) }
      })
    ]
  }, [knowledgeBases, openFileSelectDialog, openFolderSelectDialog, openKnowledgeFileList, scanning, t])

  const openQuickPanel = useCallback(() => {
    quickPanelHook.open({ title: t('chat.input.upload.attachment'), list: items, symbol: QuickPanelReservedSymbol.File })
  }, [items, quickPanelHook, t])

  useEffect(() => {
    const disposeRootMenu = quickPanel.registerRootMenu([{
      label: couldAddImageFile ? t('chat.input.upload.attachment') : t('chat.input.upload.document'),
      description: '', icon: <Paperclip />, isMenu: true, action: () => openQuickPanel()
    }])
    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.File, () => openQuickPanel())
    return () => { disposeRootMenu(); disposeTrigger() }
  }, [couldAddImageFile, openQuickPanel, quickPanel, t])

  return (
    <>
      <Tooltip placement="top" title={t('chat.input.upload.select_folder')} mouseLeaveDelay={0} arrow>
        <ActionIconButton
          onClick={() => { void openFolderSelectDialog() }}
          active={files.length > 0}
          disabled={disabled}
          aria-label={t('chat.input.upload.select_folder')}>
          <FolderOpen size={18} />
        </ActionIconButton>
      </Tooltip>

      {/* 文件夹上传模式选择弹窗 */}
      {folderMode && (
        <ModeOverlay onClick={() => setFolderMode(null)}>
          <ModePanel onClick={(e) => e.stopPropagation()}>
            <ModeHeader>
              <ModeTitle>选择上传方式</ModeTitle>
              <ModeClose onClick={() => setFolderMode(null)}><X size={16} /></ModeClose>
            </ModeHeader>
            <ModeFolderName>📁 {folderMode.name}</ModeFolderName>
            <ModeButtons>
              <ModeButton $primary onClick={() => { void handleTreeMode() }}>
                <FolderTree size={20} />
                <ModeButtonLabel>
                  <strong>保留目录结构</strong>
                  <span>上传目录树和路径信息，AI 可凭此了解项目结构。按需读取文件请直接告诉 AI</span>
                </ModeButtonLabel>
              </ModeButton>
              <ModeButton onClick={() => { void handleFlatMode() }}>
                <List size={20} />
                <ModeButtonLabel>
                  <strong>仅上传文件</strong>
                  <span>平铺上传文件夹内所有文件，不含目录层级信息</span>
                </ModeButtonLabel>
              </ModeButton>
            </ModeButtons>
          </ModePanel>
        </ModeOverlay>
      )}
    </>
  )
}

// --- 模式选择弹窗样式 ---

const ModeOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
`

const ModePanel = styled.div`
  background: var(--color-background);
  border: 0.5px solid var(--color-border);
  border-radius: 12px;
  padding: 20px;
  width: 380px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
`

const ModeHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`

const ModeTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
`

const ModeClose = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
  &:hover { background: var(--color-background-soft); color: var(--color-text); }
`

const ModeFolderName = styled.div`
  font-size: 13px;
  color: var(--color-text-2);
  margin-bottom: 16px;
  padding: 6px 10px;
  background: var(--color-background-soft);
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ModeButtons = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const ModeButton = styled.button<{ $primary?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid ${(p) => (p.$primary ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${(p) => (p.$primary ? 'var(--color-primary-mute)' : 'var(--color-background-soft)')};
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
  &:hover {
    border-color: var(--color-primary);
    background: ${(p) => (p.$primary ? 'var(--color-primary-soft)' : 'var(--color-background-mute)')};
  }
`

const ModeButtonLabel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  strong { font-size: 14px; color: var(--color-text); }
  span { font-size: 12px; color: var(--color-text-3); line-height: 1.4; }
`

export default AttachmentButton
