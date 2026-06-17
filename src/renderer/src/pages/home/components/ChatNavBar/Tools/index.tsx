import { HStack } from '@renderer/components/Layout'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { type RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { setNarrowMode } from '@renderer/store/settings'
import { clearTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import type { Assistant } from '@renderer/types'
import { Modal, Tooltip } from 'antd'
import { PanelLeftClose, PanelRightClose, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'

interface ToolsProps {
  assistant?: Assistant
}

const Tools = ({ assistant }: ToolsProps) => {
  const { t } = useTranslation()
  const { showTopics, toggleShowTopics } = useShowTopics()
  const { isTopNavbar } = useNavbarPosition()
  const { topicPosition, narrowMode } = useSettings()
  const dispatch = useAppDispatch()
  const activeTopic = useAppSelector((s: RootState) => s.runtime.chat.activeTopic)

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    dispatch(setNarrowMode(!narrowMode))
  }

  const handleClearMessages = () => {
    if (!activeTopic?.id) return
    Modal.confirm({
      title: '清空聊天记录',
      content: '确定要清空当前会话的所有消息吗？此操作不可撤销。',
      okButtonProps: { danger: true },
      okText: '清空',
      cancelText: '取消',
      onOk: () => dispatch(clearTopicMessagesThunk(activeTopic.id))
    })
  }

  return (
    <HStack alignItems="center" gap={8}>
      {isTopNavbar && (
        <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
          <NavbarIcon onClick={() => SearchPopup.show()}>
            <Search size={18} />
          </NavbarIcon>
        </Tooltip>
      )}
      {isTopNavbar && (
        <Tooltip title="清空当前会话" mouseEnterDelay={0.8}>
          <NavbarIcon onClick={handleClearMessages}>
            <Trash2 size={16} />
          </NavbarIcon>
        </Tooltip>
      )}
      {isTopNavbar && topicPosition === 'right' && !showTopics && (
        <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={2}>
          <NavbarIcon onClick={toggleShowTopics}>
            <PanelLeftClose size={18} />
          </NavbarIcon>
        </Tooltip>
      )}
      {isTopNavbar && topicPosition === 'right' && showTopics && (
        <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={2}>
          <NavbarIcon onClick={toggleShowTopics}>
            <PanelRightClose size={18} />
          </NavbarIcon>
        </Tooltip>
      )}
    </HStack>
  )
}

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

export default Tools
