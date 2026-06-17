import EmojiAvatar from '@renderer/components/Avatar/EmojiAvatar'
import { HStack } from '@renderer/components/Layout'
import UserPopup from '@renderer/components/Popups/UserPopup'
import { APP_NAME, AppLogo, isLocalAi } from '@renderer/config/env'
import { getModelLogoById } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import useAvatar from '@renderer/hooks/useAvatar'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import ImageStorage from '@renderer/services/ImageStorage'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { getModelName } from '@renderer/services/ModelService'
import { useAppDispatch } from '@renderer/store'
import { setAvatar } from '@renderer/store/runtime'
import { setUserName } from '@renderer/store/settings'
import type { Assistant, Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { compressImage, firstLetter, isEmoji, removeLeadingEmoji } from '@renderer/utils'
import { Avatar, Checkbox, Input, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { Sparkle } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageTokens from './MessageTokens'

interface Props {
  message: Message
  assistant: Assistant
  model?: Model
  topic: Topic
  isGroupContextMessage?: boolean
}

const getModelAvatar = (isLocalAi: boolean, modelId: string | undefined) => {
  if (isLocalAi) return AppLogo
  return modelId ? getModelLogoById(modelId) : undefined
}

const MessageHeader: FC<Props> = memo(({ assistant, model, message, topic, isGroupContextMessage }) => {
  const avatar = useAvatar()
  const { theme } = useTheme()
  const { userName, sidebarIcons } = useSettings()
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const { agent } = useAgent(activeAgentId)
  const isAgentView = window.location.hash.startsWith('#/agents')
  const { t } = useTranslation()
  const { isBubbleStyle } = useMessageStyle()
  const { openMinappById } = useMinappPopup()
  const dispatch = useAppDispatch()

  const { isMultiSelectMode, selectedMessageIds, handleSelectMessage } = useChatContext(topic)

  const isSelected = selectedMessageIds?.includes(message.id)

  // ── 智能体自定义头像 ──
  const [assistantAvatar, setAssistantAvatar] = useState<string | null>(null)
  const modelId = useMemo(() => getMessageModelId(message), [message])
  useEffect(() => {
    ImageStorage.get(`assistant_avatar_${assistant.id}`).then((url) => setAssistantAvatar(url || null))
  }, [assistant.id])
  const avatarSource = useMemo(() => assistantAvatar || getModelAvatar(isLocalAi, modelId), [assistantAvatar, modelId])

  // ── 用户/助手名称编辑状态 ──
  const [editingName, setEditingName] = useState<'user' | 'assistant' | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<any>(null)

  // ── 双击头像上传 ──
  const handleAvatarUpload = useCallback(
    async (target: 'user' | 'assistant') => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const compressed = await compressImage(file)
          const reader = new FileReader()
          reader.onloadend = async () => {
            const dataUrl = reader.result as string
            if (target === 'user') {
              await ImageStorage.set('avatar', dataUrl)
              dispatch(setAvatar(dataUrl))
            } else {
              await ImageStorage.set(`assistant_avatar_${assistant.id}`, dataUrl)
              setAssistantAvatar(dataUrl)
            }
            window.toast?.success?.('头像已更新')
          }
          reader.readAsDataURL(compressed)
        } catch (err: any) {
          window.toast?.error?.(err.message || '头像上传失败')
        }
      }
      input.click()
    },
    [dispatch, assistant.id]
  )

  // ── 双击名字进入编辑 ──
  const handleNameDoubleClick = useCallback(
    (target: 'user' | 'assistant') => {
      const current =
        target === 'user'
          ? userName || t('common.you')
          : isAgentView && agent?.name
            ? agent.name
            : assistant?.name || ''
      setEditValue(current)
      setEditingName(target)
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    [userName, t, isAgentView, agent?.name, assistant?.name]
  )

  const handleNameSave = useCallback(() => {
    const val = editValue.trim()
    if (!val || !editingName) {
      setEditingName(null)
      return
    }
    if (editingName === 'user') {
      dispatch(setUserName(val))
    } else if (editingName === 'assistant') {
      // 智能体名称更新：agent 视图下通过 revalidate 更新，普通视图下暂不处理
      window.toast?.success?.('名称已更新（将在下次会话生效）')
    }
    setEditingName(null)
  }, [editValue, editingName, dispatch])

  const getUserName = useCallback(() => {
    if (isLocalAi && message.role !== 'user') {
      return APP_NAME
    }

    if (isAgentView && message.role === 'assistant') {
      return agent?.name ?? t('common.unknown')
    }

    if (message.role === 'assistant') {
      return getModelName(model) || getMessageModelId(message) || ''
    }

    return userName || t('common.you')
  }, [agent?.name, isAgentView, message, model, t, userName])

  const isAssistantMessage = message.role === 'assistant'
  const isUserMessage = message.role === 'user'
  const showMinappIcon = sidebarIcons.visible.includes('minapp')

  const avatarName = useMemo(() => firstLetter(assistant?.name).toUpperCase(), [assistant?.name])
  const username = useMemo(() => removeLeadingEmoji(getUserName()), [getUserName])

  const showMiniApp = useCallback(() => {
    showMinappIcon && model?.provider && openMinappById(model.provider)
    // because don't need openMinappById to be a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.provider, showMinappIcon])

  const userNameJustifyContent = useMemo(() => {
    if (!isBubbleStyle) return 'flex-start'
    if (isUserMessage && !isMultiSelectMode) return 'flex-end'
    return 'flex-start'
  }, [isBubbleStyle, isUserMessage, isMultiSelectMode])

  return (
    <Container className="message-header">
      {isAssistantMessage ? (
        <Avatar
          src={avatarSource}
          size={35}
          style={{
            borderRadius: '25%',
            cursor: showMinappIcon ? 'pointer' : 'default',
            border: isLocalAi ? '1px solid var(--color-border-soft)' : 'none',
            filter: theme === 'dark' ? 'invert(0.05)' : undefined
          }}
          onClick={showMiniApp}
          onDoubleClick={() => handleAvatarUpload('assistant')}>
          {avatarName}
        </Avatar>
      ) : (
        <div onDoubleClick={() => handleAvatarUpload('user')} style={{ display: 'flex' }}>
          {isEmoji(avatar) ? (
            <EmojiAvatar onClick={() => UserPopup.show()} size={35} fontSize={20}>
              {avatar}
            </EmojiAvatar>
          ) : (
            <Avatar
              src={avatar}
              size={35}
              style={{ borderRadius: '25%', cursor: 'pointer' }}
              onClick={() => UserPopup.show()}
            />
          )}
        </div>
      )}
      <UserWrap>
        <HStack alignItems="center" justifyContent={userNameJustifyContent}>
          {editingName === (isUserMessage ? 'user' : 'assistant') ? (
            <Input
              ref={inputRef}
              size="small"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleNameSave}
              onPressEnter={handleNameSave}
              onKeyDown={(e) => e.key === 'Escape' && setEditingName(null)}
              style={{ width: 160, height: 28, fontSize: 13 }}
            />
          ) : (
            <UserName
              isBubbleStyle={isBubbleStyle}
              theme={theme}
              onDoubleClick={() => handleNameDoubleClick(isUserMessage ? 'user' : 'assistant')}
              style={{ cursor: 'pointer' }}>
              {username}
            </UserName>
          )}
          {isGroupContextMessage && (
            <Tooltip title={t('chat.message.useful.tip')}>
              <Sparkle fill="var(--color-primary)" strokeWidth={0} size={18} />
            </Tooltip>
          )}
        </HStack>
        <InfoWrap className="message-header-info-wrap text-(--color-text-3) text-[10px]">
          <MessageTime>{dayjs(message?.updatedAt ?? message.createdAt).format('MM/DD HH:mm')}</MessageTime>
          {isBubbleStyle && message.usage !== undefined && (
            <>
              |
              <MessageTokens message={message} />
            </>
          )}
        </InfoWrap>
      </UserWrap>
      {isMultiSelectMode && (
        <Checkbox
          checked={isSelected}
          onChange={(e) => handleSelectMessage(message.id, e.target.checked)}
          style={{ position: 'absolute', right: 0, top: 0 }}
        />
      )}
    </Container>
  )
})

MessageHeader.displayName = 'MessageHeader'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  position: relative;
  margin-bottom: 10px;
`

const UserWrap = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
`

const InfoWrap = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
`

const UserName = styled.span<{ isBubbleStyle?: boolean; theme?: string }>`
  font-size: 14px;
  font-weight: 600;
  color: ${(props) => (props.isBubbleStyle && props.theme === 'dark' ? 'white' : 'var(--color-text)')};
`

const MessageTime = styled.div`
  font-size: 10px;
  color: var(--color-text-3);
`

export default MessageHeader
