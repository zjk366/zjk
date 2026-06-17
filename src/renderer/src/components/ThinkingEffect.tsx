import { accretionVariants, lightbulbVariants } from '@renderer/utils/motionVariants'
import { ChevronRight } from 'lucide-react'
import { motion } from 'motion/react'
import React, { useMemo } from 'react'
import styled from 'styled-components'

interface Props {
  isThinking: boolean
  thinkingTimeText: React.ReactNode
  content: string
  expanded: boolean
}

/** 黑洞图标 SVG — 暗心 + 吸积盘光环 */
const BlackHoleIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* 吸积盘外层光晕 */}
    <circle cx="16" cy="16" r="15" stroke="var(--color-primary)" strokeWidth="0.5" opacity="0.3" />
    {/* 吸积盘内环 */}
    <circle
      cx="16"
      cy="16"
      r="12"
      stroke="var(--color-primary)"
      strokeWidth="1.5"
      opacity="0.6"
      strokeDasharray="4 3"
    />
    {/* 事件视界 */}
    <circle
      cx="16"
      cy="16"
      r="8"
      fill="color-mix(in srgb, var(--color-background) 60%, transparent)"
      stroke="var(--color-primary)"
      strokeWidth="0.5"
      opacity="0.8"
    />
    {/* 奇点 */}
    <circle cx="16" cy="16" r="2.5" fill="var(--color-primary)" opacity="1" />
    {/* 引力透镜微光 */}
    <circle
      cx="16"
      cy="16"
      r="5"
      fill="none"
      stroke="var(--color-icon-white)"
      strokeWidth="0.5"
      opacity="0.15"
      strokeDasharray="2 6"
    />
  </svg>
)

const ThinkingEffect: React.FC<Props> = ({ isThinking, thinkingTimeText, content, expanded }) => {
  const messages = useMemo(() => {
    const allLines = (content || '').split('\n')
    const newMessages = isThinking ? allLines.slice(0, -1) : allLines
    return newMessages.filter((line) => line.trim() !== '')
  }, [content, isThinking])

  const showThinking = useMemo(() => {
    return isThinking && !expanded
  }, [expanded, isThinking])

  const LINE_HEIGHT = 14

  const containerHeight = useMemo(() => {
    if (!showThinking || messages.length < 1) return 38
    return Math.min(75, Math.max(messages.length + 1, 2) * LINE_HEIGHT + 25)
  }, [showThinking, messages.length])

  return (
    <ThinkingContainer style={{ height: containerHeight }} className={expanded ? 'expanded' : ''}>
      <LoadingContainer>
        {/* 外层吸积盘缓慢旋转 */}
        <motion.div
          variants={accretionVariants}
          animate={isThinking ? 'active' : 'idle'}
          initial="idle"
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
          <svg
            width={44}
            height={44}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ position: 'absolute' }}>
            <circle cx="16" cy="16" r="15" stroke="var(--color-primary)" strokeWidth="0.5" opacity="0.2" />
            <circle
              cx="16"
              cy="16"
              r="13.5"
              stroke="var(--color-primary)"
              strokeWidth="0.3"
              opacity="0.1"
              strokeDasharray="2 4"
            />
          </svg>
        </motion.div>
        {/* 内层脉冲 */}
        <motion.div variants={lightbulbVariants} animate={isThinking ? 'active' : 'idle'} initial="idle">
          <BlackHoleIcon size={!showThinking || messages.length < 2 ? 22 : 32} />
        </motion.div>
      </LoadingContainer>

      <TextContainer>
        <Title className={!showThinking || !messages.length ? 'showThinking' : ''}>{thinkingTimeText}</Title>

        {showThinking && (
          <Content>
            <Messages
              style={{
                height: messages.length * LINE_HEIGHT
              }}
              initial={{
                y: -2
              }}
              animate={{
                y: -messages.length * LINE_HEIGHT - 2
              }}
              transition={{
                duration: 0.15,
                ease: 'linear'
              }}>
              {messages.map((message, index) => {
                if (index < messages.length - 5) return null

                return <Message key={index}>{message}</Message>
              })}
            </Messages>
          </Content>
        )}
      </TextContainer>
      <ArrowContainer className={expanded ? 'expanded' : ''}>
        <ChevronRight size={20} color="var(--color-text-3)" strokeWidth={1} />
      </ArrowContainer>
    </ThinkingContainer>
  )
}

const ThinkingContainer = styled.div`
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  border: 0.5px solid var(--color-border);
  transition: height, border-radius, 150ms;
  pointer-events: none;
  user-select: none;
  &.expanded {
    border-radius: 10px 10px 0 0;
  }
`

const Title = styled.div`
  position: absolute;
  inset: 0 0 auto 0;
  font-size: 14px;
  line-height: 14px;
  font-weight: 500;
  padding: 10px 0;
  z-index: 99;
  transition: padding-top 150ms;
  &.showThinking {
    padding-top: 12px;
  }
`

const LoadingContainer = styled.div`
  width: 50px;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
  position: relative;
  padding-left: 5px;
  transition: width 150ms;
  > div {
    display: flex;
    justify-content: center;
    align-items: center;
  }
`

const TextContainer = styled.div`
  flex: 1;
  height: 100%;
  padding: 5px 0;
  overflow: hidden;
  position: relative;
`

const Content = styled.div`
  width: 100%;
  height: 100%;
  mask: linear-gradient(
    to bottom,
    rgb(0 0 0 / 0%) 0%,
    rgb(0 0 0 / 0%) 35%,
    rgb(0 0 0 / 25%) 40%,
    rgb(0 0 0 / 100%) 90%,
    rgb(0 0 0 / 100%) 100%
  );
  position: relative;
`

const Messages = styled(motion.div)`
  width: 100%;
  position: absolute;
  top: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
`

const Message = styled.div`
  width: 100%;
  line-height: 14px;
  font-size: 11px;
  color: var(--color-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const ArrowContainer = styled.div`
  width: 40px;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
  position: relative;
  color: var(--color-border);
  transition: transform 150ms;
  &.expanded {
    transform: rotate(90deg);
  }
`

export default ThinkingEffect
