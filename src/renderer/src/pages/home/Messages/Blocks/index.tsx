import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { ImageMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { isMainTextBlock, isMessageProcessing, isToolBlock, isVideoBlock } from '@renderer/utils/messageUtils/is'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import CollectInfoForm from '../Tools/CollectInfoForm'
import BlockErrorFallback from './BlockErrorFallback'
import CitationBlock from './CitationBlock'
import CompactBlock from './CompactBlock'
import CompressedBlock from './CompressedBlock'
import ErrorBlock from './ErrorBlock'
import FileBlock from './FileBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import ToolBlock from './ToolBlock'
import ToolBlockGroup from './ToolBlockGroup'
import TranslationBlock from './TranslationBlock'
import VideoBlock from './VideoBlock'

const logger = loggerService.withContext('MessageBlockRenderer')

interface AnimatedBlockWrapperProps {
  children: React.ReactNode
  enableAnimation: boolean
}

const blockWrapperVariants: Variants = {
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, type: 'spring', bounce: 0 }
  },
  hidden: {
    opacity: 0,
    x: 10
  },
  static: {
    opacity: 1,
    x: 0,
    transition: { duration: 0 }
  }
}

const AnimatedBlockWrapper: React.FC<AnimatedBlockWrapperProps> = ({ children, enableAnimation }) => {
  return (
    <motion.div
      className="block-wrapper"
      variants={blockWrapperVariants}
      initial={enableAnimation ? 'hidden' : 'static'}
      animate={enableAnimation ? 'visible' : 'static'}>
      <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
    </motion.div>
  )
}

interface Props {
  blocks: string[] // 可以接收块ID数组或MessageBlock数组
  messageStatus?: Message['status']
  message: Message
}

const groupSimilarBlocks = (blocks: MessageBlock[]): (MessageBlock[] | MessageBlock)[] => {
  return blocks.reduce((acc: (MessageBlock[] | MessageBlock)[], currentBlock) => {
    if (currentBlock.type === MessageBlockType.IMAGE) {
      // 对于IMAGE类型，按连续分组
      const prevGroup = acc[acc.length - 1]
      if (Array.isArray(prevGroup) && prevGroup[0].type === MessageBlockType.IMAGE) {
        prevGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else if (currentBlock.type === MessageBlockType.VIDEO) {
      // 对于VIDEO类型，按相同filePath分组
      if (!isVideoBlock(currentBlock)) {
        logger.warn('Block type is VIDEO but failed type guard check', currentBlock)
        acc.push(currentBlock)
        return acc
      }
      const videoBlock = currentBlock
      const existingGroup = acc.find(
        (group) =>
          Array.isArray(group) &&
          group[0].type === MessageBlockType.VIDEO &&
          isVideoBlock(group[0]) &&
          group[0].filePath === videoBlock.filePath
      ) as MessageBlock[] | undefined

      if (existingGroup) {
        existingGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else if (currentBlock.type === MessageBlockType.TOOL) {
      // 对于TOOL类型，按连续分组
      const prevGroup = acc[acc.length - 1]
      if (Array.isArray(prevGroup) && prevGroup[0].type === MessageBlockType.TOOL) {
        prevGroup.push(currentBlock)
      } else {
        acc.push([currentBlock])
      }
    } else {
      acc.push(currentBlock)
    }
    return acc
  }, [])
}

const MessageBlockRenderer: React.FC<Props> = ({ blocks, message }) => {
  // 始终调用useSelector，避免条件调用Hook
  const blockEntities = useSelector((state: RootState) => messageBlocksSelectors.selectEntities(state))
  // 根据blocks类型处理渲染数据
  const renderedBlocks = blocks.map((blockId) => blockEntities[blockId]).filter(Boolean)
  const groupedBlocks = useMemo(() => groupSimilarBlocks(renderedBlocks), [renderedBlocks])

  // Check if message is still processing
  const isProcessing = isMessageProcessing(message)
  // ask_user 已提交（用户点击确认后，AI SDK 流可能已结束，
  // tool-result 不会到达，消息卡在 processing）
  const [askUserResolved, setAskUserResolved] = useState(false)
  useEffect(() => {
    const handler = () => setAskUserResolved(true)
    window.addEventListener('clarify-resolved', handler)
    return () => window.removeEventListener('clarify-resolved', handler)
  }, [])

  return (
    <AnimatePresence mode="sync">
      {groupedBlocks.map((block) => {
        if (Array.isArray(block)) {
          const groupKey = block.map((b) => b.id).join('-')

          if (block[0].type === MessageBlockType.IMAGE) {
            if (block.length === 1) {
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                  <ImageBlock key={block[0].id} block={block[0]} isSingle={true} />
                </AnimatedBlockWrapper>
              )
            }
            // 多张图片使用 ImageBlockGroup 包装
            return (
              <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                <ImageBlockGroup count={block.length}>
                  {block.map((imageBlock) => (
                    <ImageBlock key={imageBlock.id} block={imageBlock as ImageMessageBlock} isSingle={false} />
                  ))}
                </ImageBlockGroup>
              </AnimatedBlockWrapper>
            )
          } else if (block[0].type === MessageBlockType.VIDEO) {
            // 对于相同路径的video，只渲染第一个
            if (!isVideoBlock(block[0])) {
              logger.warn('Expected video block but got different type', block[0])
              return null
            }
            const firstVideoBlock = block[0]
            return (
              <AnimatedBlockWrapper key={groupKey} enableAnimation={message.status.includes('ing')}>
                <VideoBlock key={firstVideoBlock.id} block={firstVideoBlock} />
              </AnimatedBlockWrapper>
            )
          } else if (block[0].type === MessageBlockType.TOOL) {
            const isProcessing = message.status.includes('ing')

            // ask_user 不渲染任何 UI；collect_missing_info 需要渲染表单
            const firstBlock: MessageBlock = Array.isArray(block) ? block[0] : block
            const toolResponse = isToolBlock(firstBlock) ? (firstBlock as any).metadata?.rawMcpToolResponse : undefined
            const toolName = toolResponse?.tool?.name

            if (toolName === 'ask_user') return null

            // collect_missing_info：流式处理中也直接渲染表单，不让工具块加载线遮住
            if (toolName === 'collect_missing_info') {
              const rawResp = toolResponse?.response
              const respStr = typeof rawResp === 'string' ? rawResp : rawResp ? JSON.stringify(rawResp) : ''
              const isBlocked = respStr === '__COLLECT_BLOCKED__' || respStr.includes('__COLLECT_BLOCKED__')
              const isPending = respStr === '__COLLECT_PENDING__' || respStr.includes('__COLLECT_PENDING__')
              if (isBlocked) return null
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={false}>
                  <CollectInfoForm
                    toolCallId={toolResponse.toolCallId || toolResponse.id}
                    resultText={isPending ? undefined : respStr || undefined}
                  />
                </AnimatedBlockWrapper>
              )
            }

            // 黑洞风格：processing 阶段不渲染任何工具加载动画，
            // 避免多线程并发产生多条闪烁横线。AI 的文字流本身已提供视觉反馈。
            if (isProcessing) {
              return null
            }
            // 黑洞风格：非错误状态的 MCP 工具块不渲染 ToolBlock/ToolBlockGroup
            // 检查此工具块是否应显示（只显示错误状态）
            const allToolBlocks = (Array.isArray(block) ? block : [block]).filter(isToolBlock)
            const shouldShowToolBlock = allToolBlocks.some((tb) => {
              const tr = (tb as any).metadata?.rawMcpToolResponse
              return tr?.status === 'error' || tr?.tool?.name === 'collect_missing_info'
            })
            if (!shouldShowToolBlock) return null

            // 非 ask_user/collect_missing_info 工具按原有方式渲染
            if (block.length === 1) {
              if (!isToolBlock(block[0])) {
                logger.warn('Expected tool block but got different type', block[0])
                return null
              }
              return (
                <AnimatedBlockWrapper key={groupKey} enableAnimation={false}>
                  <ToolBlock key={block[0].id} block={block[0]} />
                </AnimatedBlockWrapper>
              )
            }
            // 多个工具调用，使用分组组件
            const toolBlocks = block.filter(isToolBlock)
            const stableGroupKey = `tool-group-${toolBlocks[0].id}`
            return (
              <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={false}>
                <ToolBlockGroup blocks={toolBlocks} />
              </AnimatedBlockWrapper>
            )
          }
          return null
        }

        let blockComponent: React.ReactNode = null

        switch (block.type) {
          case MessageBlockType.UNKNOWN:
            break
          case MessageBlockType.MAIN_TEXT:
          case MessageBlockType.CODE: {
            if (!isMainTextBlock(block)) {
              logger.warn('Expected main text block but got different type', block)
              break
            }
            const mainTextBlock = block
            // Find the associated citation block ID from the references
            const citationBlockId = mainTextBlock.citationReferences?.[0]?.citationBlockId

            blockComponent = (
              <MainTextBlock
                key={block.id}
                block={mainTextBlock}
                // Pass only the ID string
                citationBlockId={citationBlockId}
                role={message.role}
              />
            )
            break
          }
          case MessageBlockType.IMAGE:
            blockComponent = <ImageBlock key={block.id} block={block} />
            break
          case MessageBlockType.FILE:
            blockComponent = <FileBlock key={block.id} block={block} />
            break
          case MessageBlockType.TOOL:
            blockComponent = <ToolBlock key={block.id} block={block} />
            break
          case MessageBlockType.CITATION:
            blockComponent = <CitationBlock key={block.id} block={block} />
            break
          case MessageBlockType.ERROR:
            blockComponent = <ErrorBlock key={block.id} block={block} message={message} />
            break
          case MessageBlockType.THINKING:
            blockComponent = <ThinkingBlock key={block.id} block={block} />
            break
          case MessageBlockType.TRANSLATION:
            blockComponent = <TranslationBlock key={block.id} block={block} />
            break
          case MessageBlockType.VIDEO:
            blockComponent = <VideoBlock key={block.id} block={block} />
            break
          case MessageBlockType.COMPACT:
            blockComponent = <CompactBlock key={block.id} block={block} />
            break
          case MessageBlockType.COMPRESSED:
            blockComponent = <CompressedBlock key={block.id} block={block} />
            break
          default:
            logger.warn('Unsupported block type in MessageBlockRenderer:', (block as any).type, block)
            break
        }

        if (!blockComponent) {
          return null
        }

        return (
          <AnimatedBlockWrapper key={block.id} enableAnimation={message.status.includes('ing')}>
            {blockComponent}
          </AnimatedBlockWrapper>
        )
      })}
      {isProcessing && !askUserResolved && (
        <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
          <PlaceholderBlock
            block={{
              id: `loading-${message.id}`,
              messageId: message.id,
              type: MessageBlockType.UNKNOWN,
              status: MessageBlockStatus.PROCESSING,
              createdAt: new Date().toISOString()
            }}
          />
        </AnimatedBlockWrapper>
      )}
    </AnimatePresence>
  )
}

export default React.memo(MessageBlockRenderer)

const ImageBlockGroup = styled.div<{ count: number }>`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 100%;
`
