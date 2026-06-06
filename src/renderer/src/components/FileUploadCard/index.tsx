/**
 * 文件上传预览卡片组件
 *
 * 在聊天界面展示即将上传的文件/文件夹树形结构，支持折叠展开。
 */
import type { DragUploadNode } from '@renderer/types/dragUpload'
import { formatFileSize } from '@renderer/utils/dragUploadUtils'
import { ChevronDown, ChevronRight, File, Folder, X } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import styled from 'styled-components'

interface FileUploadCardProps {
  /** 根节点 */
  root: DragUploadNode
  /** 关闭回调 */
  onClose?: () => void
  /** 确认上传回调 */
  onConfirm?: () => void
  /** 是否正在上传 */
  uploading?: boolean
}

const FileUploadCard: FC<FileUploadCardProps> = ({ root, onClose, onConfirm, uploading }) => {
  const [collapsed, setCollapsed] = useState(false)

  const fileCount = countFiles(root)
  const folderCount = countFolders(root)

  return (
    <CardContainer>
      <CardHeader onClick={() => setCollapsed(!collapsed)}>
        <HeaderLeft>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <Folder size={16} />
          <HeaderTitle>{root.name}</HeaderTitle>
          <HeaderMeta>
            {folderCount > 0 && `${folderCount} 个文件夹 · `}
            {fileCount} 个文件 · {formatFileSize(root.size)}
          </HeaderMeta>
        </HeaderLeft>
        <HeaderRight>
          {onConfirm && (
            <ActionButton onClick={(e) => { e.stopPropagation(); onConfirm() }} disabled={uploading}>
              {uploading ? '上传中...' : '确认上传'}
            </ActionButton>
          )}
          {onClose && (
            <CloseButton onClick={(e) => { e.stopPropagation(); onClose() }}>
              <X size={14} />
            </CloseButton>
          )}
        </HeaderRight>
      </CardHeader>
      {!collapsed && root.children && (
        <CardBody>
          {root.children.map((node) => (
            <TreeNode key={node.id} node={node} depth={0} />
          ))}
        </CardBody>
      )}
    </CardContainer>
  )
}

/** 树节点递归组件 */
const TreeNode: FC<{ node: DragUploadNode; depth: number }> = ({ node, depth }) => {
  const [collapsed, setCollapsed] = useState(false)
  const isFolder = node.type === 'folder'

  return (
    <>
      <TreeNodeRow
        $depth={depth}
        onClick={() => isFolder && setCollapsed(!collapsed)}
        $clickable={isFolder && (node.children?.length ?? 0) > 0}>
        <NodeIcon>
          {isFolder ? (
            <>
              {(node.children?.length ?? 0) > 0 ? (
                collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />
              ) : (
                <span style={{ width: 12 }} />
              )}
              <Folder size={14} />
            </>
          ) : (
            <>
              <span style={{ width: 12 }} />
              <File size={14} />
            </>
          )}
        </NodeIcon>
        <NodeName $isFolder={isFolder}>{node.name}</NodeName>
        <NodeSize>{node.type === 'file' ? formatFileSize(node.size) : `${node.children?.length ?? 0} 项`}</NodeSize>
        {node.type === 'file' && node.ext && (
          <NodeExt>{node.ext}</NodeExt>
        )}
      </TreeNodeRow>
      {isFolder && !collapsed && node.children?.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

function countFiles(node: DragUploadNode): number {
  if (node.type === 'file') return 1
  return node.children?.reduce((acc, child) => acc + countFiles(child), 0) ?? 0
}

function countFolders(node: DragUploadNode): number {
  let count = 0
  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'folder') count++
      count += countFolders(child)
    }
  }
  return count
}

// --- Styled Components ---

const CardContainer = styled.div`
  margin: 0 20px 8px 20px;
  border: 0.5px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-background-soft);
  max-height: 260px;
  display: flex;
  flex-direction: column;
`

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 0.5px solid var(--color-border);
  flex-shrink: 0;

  &:hover {
    background: var(--color-background-mute);
  }
`

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
`

const HeaderTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const HeaderMeta = styled.span`
  font-size: 11px;
  color: var(--color-text-3);
  white-space: nowrap;
`

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`

const ActionButton = styled.button`
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: var(--color-primary-mute);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const CloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;

  &:hover {
    background: var(--color-background-mute);
    color: var(--color-text);
  }
`

const CardBody = styled.div`
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 2px;
  }
`

const TreeNodeRow = styled.div<{ $depth: number; $clickable?: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 12px 3px ${(p) => 12 + p.$depth * 16}px;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  font-size: 12px;

  &:hover {
    background: var(--color-background-mute);
  }
`

const NodeIcon = styled.span`
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--color-text-3);
  flex-shrink: 0;
`

const NodeName = styled.span<{ $isFolder: boolean }>`
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: ${(p) => (p.$isFolder ? 500 : 400)};
`

const NodeSize = styled.span`
  color: var(--color-text-3);
  margin-left: auto;
  white-space: nowrap;
  flex-shrink: 0;
`

const NodeExt = styled.span`
  color: var(--color-text-3);
  background: var(--color-background-mute);
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  flex-shrink: 0;
`

export default FileUploadCard
