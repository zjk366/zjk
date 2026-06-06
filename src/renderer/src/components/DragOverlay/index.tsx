/**
 * 拖拽上传覆盖层组件
 *
 * 在拖拽文件进入聊天区域时显示高亮提示蒙层。
 */
import type { FC } from 'react'
import { File, FolderOpen } from 'lucide-react'
import styled, { keyframes } from 'styled-components'

interface DragOverlayProps {
  /** 是否可见 */
  visible: boolean
}

const DragOverlay: FC<DragOverlayProps> = ({ visible }) => {
  if (!visible) return null

  return (
    <Overlay>
      <Content>
        <IconWrapper>
          <FolderOpen size={48} strokeWidth={1.5} />
          <File size={48} strokeWidth={1.5} style={{ marginLeft: -16 }} />
        </IconWrapper>
        <Title>释放以上传文件/文件夹</Title>
        <Hint>支持拖入单个文件或整个文件夹</Hint>
      </Content>
    </Overlay>
  )
}

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.6; }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3px dashed rgba(22, 119, 255, 0.5);
  border-radius: 0;
  animation: ${pulse} 2s ease-in-out infinite;
  pointer-events: none;
  user-select: none;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`

const IconWrapper = styled.div`
  display: flex;
  align-items: center;
  color: rgba(22, 119, 255, 0.8);
`

const Title = styled.div`
  font-size: 20px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`

const Hint = styled.div`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
`

export default DragOverlay
