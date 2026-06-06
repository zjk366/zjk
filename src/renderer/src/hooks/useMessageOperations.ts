import { loggerService } from '@logger'
import { createSelector } from '@reduxjs/toolkit'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { appendMessageTrace, pauseTrace, restartTrace } from '@renderer/services/SpanManagerService'
import { estimateUserPromptUsage } from '@renderer/services/TokenService'
import store, { type RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import {
  appendAssistantResponseThunk,
  clearTopicMessagesThunk,
  cloneMessagesToNewTopicThunk,
  deleteMessageGroupThunk,
  deleteSingleMessageThunk,
  initiateTranslationThunk,
  regenerateAssistantResponseThunk,
  removeBlocksThunk,
  resendMessageThunk,
  resendUserMessageWithEditThunk,
  updateMessageAndBlocksThunk,
  updateTranslationBlockThunk
} from '@renderer/store/thunk/messageThunk'
import { type Assistant, type Model, objectKeys, type Topic, type TranslateLanguageCode } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { difference, throttle } from 'lodash'
import { useCallback } from 'react'

const logger = loggerService.withContext('UseMessageOperations')

const selectMessagesState = (state: RootState) => state.messages

export const selectNewTopicLoading = createSelector(
  [selectMessagesState, (_, topicId: string) => topicId],
  (messagesState, topicId) => messagesState.loadingByTopic[topicId] || false
)

export const selectNewDisplayCount = createSelector(
  [selectMessagesState],
  (messagesState) => messagesState.displayCount
)

export function useMessageOperations(topic: Topic) {
  const safeId = topic?.id ?? ''
  const dispatch = useAppDispatch()

  const deleteMessage = useCallback(
    async (id: string, traceId?: string, modelName?: string) => {
      if (!safeId) return
      await dispatch(deleteSingleMessageThunk(safeId, id))
      void window.api.trace.cleanHistory(safeId, traceId || '', modelName)
    },
    [dispatch, safeId]
  )

  const deleteGroupMessages = useCallback(
    async (askId: string) => {
      await dispatch(deleteMessageGroupThunk(safeId, askId))
    },
    [dispatch, safeId]
  )

  const editMessage = useCallback(
    async (messageId: string, updates: Partial<Omit<Message, 'id' | 'topicId' | 'blocks'>>) => {
      if (!safeId) {
        logger.error('[editMessage] Topic prop is not valid.')
        return
      }
      const uiStates = ['multiModelMessageStyle', 'foldSelected'] as const satisfies (keyof Message)[]
      const extraUpdate = difference(objectKeys(updates), uiStates)
      const isUiUpdateOnly = extraUpdate.length === 0
      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: messageId,
        updatedAt: isUiUpdateOnly ? undefined : new Date().toISOString(),
        ...updates
      }

      await dispatch(updateMessageAndBlocksThunk(safeId, messageUpdates, []))
    },
    [dispatch, safeId]
  )

  const resendMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      await restartTrace(message)
      await dispatch(resendMessageThunk(safeId, message, assistant))
    },
    [dispatch, safeId]
  )

  const clearTopicMessages = useCallback(
    async (_topicId?: string) => {
      const topicIdToClear = _topicId || safeId
      await dispatch(clearTopicMessagesThunk(topicIdToClear))
    },
    [dispatch, safeId]
  )

  const createNewContext = useCallback(async () => {
    void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [])

  const displayCount = useAppSelector(selectNewDisplayCount)

  const pauseMessages = useCallback(async () => {
    const state = store.getState()
    const topicMessages = selectMessagesForTopic(state, safeId)
    if (!topicMessages) return

    const streamingMessages = topicMessages.filter((m) => m.status === 'processing' || m.status === 'pending')
    const askIds = [...new Set(streamingMessages?.map((m) => m.askId).filter((id) => !!id) as string[])]

    for (const askId of askIds) {
      abortCompletion(askId)
    }
    pauseTrace(safeId)
    dispatch(newMessagesActions.setTopicLoading({ topicId: safeId, loading: false }))
  }, [safeId, dispatch])

  const resumeMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      return resendMessage(message, assistant)
    },
    [resendMessage]
  )

  const regenerateAssistantMessage = useCallback(
    async (message: Message, assistant: Assistant) => {
      await restartTrace(message)
      if (message.role !== 'assistant') {
        logger.warn('regenerateAssistantMessage should only be called for assistant messages.')
        return
      }
      await dispatch(regenerateAssistantResponseThunk(safeId, message, assistant))
    },
    [dispatch, safeId]
  )

  const appendAssistantResponse = useCallback(
    async (existingAssistantMessage: Message, newModel: Model, assistant: Assistant) => {
      await appendMessageTrace(existingAssistantMessage, newModel)
      if (existingAssistantMessage.role !== 'assistant') {
        logger.error('appendAssistantResponse should only be called for an existing assistant message.')
        return
      }
      if (!existingAssistantMessage.askId) {
        logger.error('Cannot append response: The existing assistant message is missing its askId.')
        return
      }
      await dispatch(
        appendAssistantResponseThunk(
          safeId,
          existingAssistantMessage.id,
          newModel,
          assistant,
          existingAssistantMessage.traceId
        )
      )
    },
    [dispatch, safeId]
  )

  const getTranslationUpdater = useCallback(
    async (
      messageId: string,
      targetLanguage: TranslateLanguageCode,
      sourceBlockId?: string,
      sourceLanguage?: TranslateLanguageCode
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!safeId) return null

      const state = store.getState()
      const message = state.messages.entities[messageId]
      if (!message) {
        logger.error(`[getTranslationUpdater] cannot find message: ${messageId}`)
        return null
      }

      let existingTranslationBlockId: string | undefined
      if (message.blocks && message.blocks.length > 0) {
        for (const blockId of message.blocks) {
          const block = state.messageBlocks.entities[blockId]
          if (block && block.type === MessageBlockType.TRANSLATION) {
            existingTranslationBlockId = blockId
            break
          }
        }
      }

      let blockId: string | undefined
      if (existingTranslationBlockId) {
        blockId = existingTranslationBlockId
        const changes: Partial<MessageBlock> = {
          content: '',
          status: MessageBlockStatus.STREAMING,
          metadata: {
            targetLanguage,
            sourceBlockId,
            sourceLanguage
          }
        }
        dispatch(updateOneBlock({ id: blockId, changes }))
        await dispatch(updateTranslationBlockThunk(blockId, '', false))
      } else {
        blockId = await dispatch(
          initiateTranslationThunk(messageId, safeId, targetLanguage, sourceBlockId, sourceLanguage)
        )
      }

      if (!blockId) {
        logger.error('[getTranslationUpdater] Failed to create translation block.')
        return null
      }

      return throttle(
        (accumulatedText: string, isComplete: boolean = false) => {
          dispatch(updateTranslationBlockThunk(blockId!, accumulatedText, isComplete))
        },
        200,
        { leading: true, trailing: true }
      )
    },
    [dispatch, safeId]
  )

  const createTopicBranch = useCallback(
    (sourceTopicId: string, branchPointIndex: number, newTopic: Topic) => {
      logger.info(`Cloning messages from topic ${sourceTopicId} to new topic ${newTopic.id}`)
      return dispatch(cloneMessagesToNewTopicThunk(sourceTopicId, branchPointIndex, newTopic))
    },
    [dispatch]
  )

  const editMessageBlocks = useCallback(
    async (messageId: string, editedBlocks: MessageBlock[]) => {
      if (!safeId) {
        logger.error('[editMessageBlocks] Topic prop is not valid.')
        return
      }

      try {
        const state = store.getState()
        const message = state.messages.entities[messageId]
        if (!message) {
          logger.error(`[editMessageBlocks] Message not found: ${messageId}`)
          return
        }

        const originalBlocks = message.blocks
          ? (message.blocks
              .map((blockId) => state.messageBlocks.entities[blockId])
              .filter((block) => block !== undefined) as MessageBlock[])
          : []

        const originalBlockIds = new Set(originalBlocks.map((block) => block.id))
        const editedBlockIds = new Set(editedBlocks.map((block) => block.id))

        const blockIdsToRemove = originalBlocks
          .filter((block) => !editedBlockIds.has(block.id))
          .map((block) => block.id)

        const blocksToUpdate = editedBlocks
          .filter((block) => originalBlockIds.has(block.id))
          .map((block) => ({
            ...block,
            updatedAt: new Date().toISOString()
          }))

        const blocksToAdd = editedBlocks
          .filter((block) => !originalBlockIds.has(block.id))
          .map((block) => ({
            ...block,
            updatedAt: new Date().toISOString()
          }))

        const updatedBlockIds = editedBlocks.map((block) => block.id)
        const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
          id: messageId,
          updatedAt: new Date().toISOString(),
          blocks: updatedBlockIds
        }

        if (blocksToAdd.length > 0) {
          await dispatch(updateMessageAndBlocksThunk(safeId, messageUpdates, blocksToAdd))
        }

        if (blocksToUpdate.length > 0) {
          await dispatch(updateMessageAndBlocksThunk(safeId, messageUpdates, blocksToUpdate))
        }

        if (blockIdsToRemove.length > 0) {
          await dispatch(removeBlocksThunk(safeId, messageId, blockIdsToRemove))
        }
      } catch (error) {
        logger.error('[editMessageBlocks] Failed to update message blocks:', error as Error)
      }
    },
    [dispatch, safeId]
  )

  const resendUserMessageWithEdit = useCallback(
    async (message: Message, editedBlocks: MessageBlock[], assistant: Assistant) => {
      await editMessageBlocks(message.id, editedBlocks)

      const mainTextBlock = editedBlocks.find((block) => block.type === MessageBlockType.MAIN_TEXT)
      if (!mainTextBlock) {
        logger.error('[resendUserMessageWithEdit] Main text block not found in edited blocks')
        return
      }

      await restartTrace(message, mainTextBlock.content)

      const fileBlocks = editedBlocks.filter(
        (block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE
      )

      const files = fileBlocks.map((block) => block.file).filter((file) => file !== undefined)

      const usage = await estimateUserPromptUsage({ content: mainTextBlock.content, files })
      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: message.id,
        updatedAt: new Date().toISOString(),
        usage
      }

      await dispatch(
        newMessagesActions.updateMessage({ topicId: safeId, messageId: message.id, updates: messageUpdates })
      )
      await dispatch(resendUserMessageWithEditThunk(safeId, message, assistant))
    },
    [dispatch, editMessageBlocks, safeId]
  )

  const removeMessageBlock = useCallback(
    async (messageId: string, blockIdToRemove: string) => {
      if (!safeId) {
        logger.error('[removeMessageBlock] Topic prop is not valid.')
        return
      }

      const state = store.getState()
      const message = state.messages.entities[messageId]
      if (!message || !message.blocks) {
        logger.error(`[removeMessageBlock] Message not found or has no blocks: ${messageId}`)
        return
      }

      const updatedBlocks = message.blocks.filter((blockId) => blockId !== blockIdToRemove)

      const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
        id: messageId,
        updatedAt: new Date().toISOString(),
        blocks: updatedBlocks
      }

      await dispatch(updateMessageAndBlocksThunk(safeId, messageUpdates, []))
    },
    [dispatch, safeId]
  )

  return {
    displayCount,
    deleteMessage,
    deleteGroupMessages,
    editMessage,
    resendMessage,
    regenerateAssistantMessage,
    resendUserMessageWithEdit,
    appendAssistantResponse,
    createNewContext,
    clearTopicMessages,
    pauseMessages,
    resumeMessage,
    getTranslationUpdater,
    createTopicBranch,
    editMessageBlocks,
    removeMessageBlock
  }
}

export const useTopicMessages = (topicId: string) => {
  return useAppSelector((state) => selectMessagesForTopic(state, topicId))
}

export const useTopicLoading = (topic: Topic) => {
  return useAppSelector((state) => selectNewTopicLoading(state, topic?.id ?? ''))
}
