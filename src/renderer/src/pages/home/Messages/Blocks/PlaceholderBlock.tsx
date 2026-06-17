import { MessageBlockStatus, MessageBlockType, type PlaceholderMessageBlock } from '@renderer/types/newMessage'
import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { motion } from 'motion/react'
import React from 'react'
import styled from 'styled-components'

/** 紧凑版黑洞图标（用于加载占位） */
const MiniBlackHole = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle
      cx="16"
      cy="16"
      r="12"
      stroke="var(--color-primary)"
      strokeWidth="1.5"
      opacity="0.5"
      strokeDasharray="3 3"
    />
    <circle
      cx="16"
      cy="16"
      r="7"
      fill="color-mix(in srgb, var(--color-background) 60%, transparent)"
      stroke="var(--color-primary)"
      strokeWidth="0.5"
      opacity="0.7"
    />
    <circle cx="16" cy="16" r="2.5" fill="var(--color-primary)" opacity="1" />
  </svg>
)

interface PlaceholderBlockProps {
  block: PlaceholderMessageBlock
}
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ block }) => {
  if (block.status === MessageBlockStatus.PROCESSING && block.type === MessageBlockType.UNKNOWN) {
    return (
      <MessageContentLoading>
        <motion.div variants={lightbulbVariants} animate="active" initial="idle">
          <MiniBlackHole size={20} />
        </motion.div>
      </MessageContentLoading>
    )
  }
  return null
}
const MessageContentLoading = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 32px;
  margin-top: -5px;
  margin-bottom: 5px;
  padding-left: 4px;
`
export default React.memo(PlaceholderBlock)
