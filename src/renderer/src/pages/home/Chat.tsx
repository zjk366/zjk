import { loggerService } from '@logger'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { ContentSearch } from '@renderer/components/ContentSearch'
import DragOverlay from '@renderer/components/DragOverlay'
import FileUploadCard from '@renderer/components/FileUploadCard'
import { HStack } from '@renderer/components/Layout'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { SelectChatModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { isEmbeddingModel, isRerankModel, isWebSearchModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { DragUploadProvider, useDragUploadContext } from '@renderer/hooks/useDragUpload'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowTopics } from '@renderer/hooks/useStore'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import FileManager from '@renderer/services/FileManager'
import type { Assistant, FileMetadata, Model, Topic } from '@renderer/types'
import type { DragUploadNode, DragUploadResult } from '@renderer/types/dragUpload'
import { classNames } from '@renderer/utils'
import { flattenFileNodes } from '@renderer/utils/dragUploadUtils'
import { Flex } from 'antd'
import { debounce } from 'lodash'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ChatNavbar from './components/ChatNavBar'
import Inputbar from './Inputbar/Inputbar'
import ChatNavigation from './Messages/ChatNavigation'
import Messages from './Messages/Messages'
import MessageUserSelector from './Messages/MessageUserSelector'
import Tabs from './Tabs'

const logger = loggerService.withContext('Chat')

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

/**
 * 将 DragUploadNode 树中的文件转换为 FileMetadata[]
 * 使用 Electron 的 file.path 获取系统路径，通过现有 API 生成 FileMetadata
 */
async function convertNodesToFileMetadata(nodes: DragUploadNode[]): Promise<FileMetadata[]> {
  const files = nodes.flatMap(flattenFileNodes)
  const metadataList: FileMetadata[] = []

  for (const node of files) {
    try {
      if (!node.file) continue
      // Electron 环境下 File 对象有 .path 属性
      const filePath = (node.file as File & { path?: string }).path
      if (filePath) {
        const metadata = await window.api.file.get(filePath)
        if (metadata) {
          metadataList.push(metadata)
        }
      }
    } catch (err) {
      logger.error(`Failed to get metadata for ${node.name}:`, err)
    }
  }

  return metadataList
}

const Chat: FC<Props> = (props) => {
  const { assistant, updateAssistant, updateTopic } = useAssistant(props.assistant.id)
  const { t } = useTranslation()
  const { topicPosition, messageStyle, messageNavigation } = useSettings()
  const { showTopics } = useShowTopics()
  const { isMultiSelectMode } = useChatContext(props.activeTopic)
  const { isTopNavbar } = useNavbarPosition()

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<FileMetadata[] | undefined>(undefined)

  const { setTimeoutTimer } = useTimer()

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  useShortcut('search_message_in_chat', () => {
    try {
      const selectedText = window.getSelection()?.toString().trim()
      contentSearchRef.current?.enable(selectedText)
    } catch (error) {
      logger.error('Error enabling content search:', error as Error)
    }
  })

  useShortcut('rename_topic', async () => {
    const topic = props.activeTopic
    if (!topic) return

    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)

    const name = await PromptPopup.show({
      title: t('chat.topics.edit.title'),
      message: '',
      defaultValue: topic.name || '',
      extraNode: <div style={{ color: 'var(--color-text-3)', marginTop: 8 }}>{t('chat.topics.edit.title_tip')}</div>
    })
    if (name && topic.name !== name) {
      const updatedTopic = { ...topic, name, isNameManuallyEdited: true }
      updateTopic(updatedTopic as Topic)
    }
  })

  useShortcut('select_model', async () => {
    const modelFilter = (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m)
    const selectedModel = await SelectChatModelPopup.show({
      model: assistant?.model,
      filter: modelFilter
    })
    if (selectedModel) {
      const enabledWebSearch = isWebSearchModel(selectedModel)
      updateAssistant({
        model: selectedModel,
        enableWebSearch: enabledWebSearch && assistant.enableWebSearch
      })
    }
  })

  const contentSearchFilter: NodeFilter = {
    acceptNode(node) {
      const container = node.parentElement?.closest('.message-content-container')
      if (!container) return NodeFilter.FILTER_REJECT

      const message = container.closest('.message')
      if (!message) return NodeFilter.FILTER_REJECT

      if (filterIncludeUser) {
        return NodeFilter.FILTER_ACCEPT
      }
      if (message.classList.contains('message-assistant')) {
        return NodeFilter.FILTER_ACCEPT
      }
      return NodeFilter.FILTER_REJECT
    }
  }

  const userOutlinedItemClickHandler = () => {
    setFilterIncludeUser(!filterIncludeUser)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeoutTimer(
          'userOutlinedItemClickHandler',
          () => {
            contentSearchRef.current?.search()
            contentSearchRef.current?.focus()
          },
          0
        )
      })
    })
  }

  let firstUpdateCompleted = false
  const firstUpdateOrNoFirstUpdateHandler = debounce(() => {
    contentSearchRef.current?.silentSearch()
  }, 10)

  const messagesComponentUpdateHandler = () => {
    if (firstUpdateCompleted) {
      firstUpdateOrNoFirstUpdateHandler()
    }
  }

  const messagesComponentFirstUpdateHandler = () => {
    setTimeoutTimer('messagesComponentFirstUpdateHandler', () => (firstUpdateCompleted = true), 300)
    firstUpdateOrNoFirstUpdateHandler()
  }

  // 拖拽上传确认回调：将 DragUploadResult 转为 FileMetadata[] 并注入 Inputbar
  const handleDragConfirm = useCallback(async (result: DragUploadResult) => {
    if (!result.root.children || result.root.children.length === 0) return

    // 先上传文件到内部存储
    const metadata = await convertNodesToFileMetadata(result.root.children)
    if (metadata.length === 0) {
      window.toast.warning('未能读取任何文件，请重试')
      return
    }

    // 上传到内部文件系统
    const uploaded = await FileManager.uploadFiles(metadata)

    // 通过 props 注入 Inputbar
    setDroppedFiles(uploaded)
    window.toast.success(`已添加 ${uploaded.length} 个文件`)
  }, [])

  const mainHeight = isTopNavbar ? 'calc(100vh - var(--navbar-height) - 6px)' : 'calc(100vh - var(--navbar-height))'

  return (
    <Container id="chat" className={classNames([messageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
      <DragUploadProvider onConfirm={handleDragConfirm}>
        <DragUploadConsumer />
        <HStack>
          <motion.div
            layout
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ flex: 1, display: 'flex', minWidth: 0, overflow: 'hidden' }}>
            <Main
              ref={mainRef}
              id="chat-main"
              vertical
              flex={1}
              justify="space-between"
              style={{ height: mainHeight, width: '100%' }}>
              <QuickPanelProvider>
                <ChatNavbar
                  activeAssistant={props.assistant}
                  activeTopic={props.activeTopic}
                  setActiveTopic={props.setActiveTopic}
                  setActiveAssistant={props.setActiveAssistant}
                  position="left"
                />
                <div
                  className="flex flex-1 flex-col justify-between"
                  style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                  <Messages
                    key={props.activeTopic?.id ?? 'loading'}
                    assistant={assistant}
                    topic={props.activeTopic}
                    setActiveTopic={props.setActiveTopic}
                    onComponentUpdate={messagesComponentUpdateHandler}
                    onFirstUpdate={messagesComponentFirstUpdateHandler}
                  />
                  <ContentSearch
                    ref={contentSearchRef}
                    searchTarget={mainRef as React.RefObject<HTMLElement>}
                    filter={contentSearchFilter}
                    includeUser={filterIncludeUser}
                    onIncludeUserChange={userOutlinedItemClickHandler}
                  />
                  <DragUploadFileCard onClose={() => setDroppedFiles(undefined)} />
                  {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
                  <MessageUserSelector topic={props.activeTopic} />
                  <Inputbar
                    assistant={assistant}
                    setActiveTopic={props.setActiveTopic}
                    topic={props.activeTopic}
                    droppedFiles={droppedFiles}
                  />
                  {isMultiSelectMode && <MultiSelectActionPopup topic={props.activeTopic} />}
                </div>
              </QuickPanelProvider>
            </Main>
          </motion.div>
          <AnimatePresence initial={false}>
            {topicPosition === 'right' && showTopics && (
              <motion.div
                key="right-tabs"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--assistants-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{
                  overflow: 'hidden'
                }}>
                <Tabs
                  activeAssistant={assistant}
                  activeTopic={props.activeTopic}
                  setActiveAssistant={props.setActiveAssistant}
                  setActiveTopic={props.setActiveTopic}
                  position="right"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </HStack>
      </DragUploadProvider>
    </Container>
  )
}

// --- 内部组件：消费 DragUploadContext，渲染 DragOverlay 和 FileUploadCard ---

/** 拖拽蒙层 + 文件卡片消费者 */
const DragUploadConsumer: FC = () => {
  const { isDragging, status, result, clear, confirm } = useDragUploadContext()
  return <DragOverlay visible={isDragging || status === 'parsing'} />
}

interface DragUploadFileCardProps {
  onClose: () => void
}

/** 拖拽上传文件预览卡片 */
const DragUploadFileCard: FC<DragUploadFileCardProps> = ({ onClose }) => {
  const { status, result, clear, confirm } = useDragUploadContext()

  if (!result || (status !== 'ready' && status !== 'uploading')) return null

  return (
    <FileUploadCard
      root={result.root}
      uploading={status === 'uploading'}
      onClose={() => {
        clear()
        onClose()
      }}
      onConfirm={() => {
        confirm()
        clear()
        onClose()
      }}
    />
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
  flex: 1;
  overflow: hidden;
  [navbar-position='top'] & {
    height: calc(100vh - var(--navbar-height) - 6px);
    background-color: var(--color-background);
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
  }
`

const Main = styled(Flex)`
  [navbar-position='left'] & {
    height: calc(100vh - var(--navbar-height));
  }
  transform: translateZ(0);
  position: relative;
`

export default Chat
