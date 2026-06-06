import { loggerService } from '@logger'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useAppDispatch } from '@renderer/store'
import { setNarrowMode } from '@renderer/store/settings'
import type { Assistant, Topic } from '@renderer/types'
import { Tooltip } from 'antd'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import NavbarIcon from '../../../../components/NavbarIcon'
import ChatNavbarContent from './ChatNavbarContent'

const logger = loggerService.withContext('ChatNavBar')

interface Props {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
  position: 'left' | 'right'
}

const HeaderNavbar: FC<Props> = ({ activeAssistant }) => {
  const { assistant } = useAssistant(activeAssistant.id)
  const { narrowMode } = useSettings()
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  useShortcut('search_message', () => {
    void SearchPopup.show()
  })

  const handleImmersiveToggle = async () => {
    try {
      await modelGenerating()
    } catch (e) {
      logger.warn('modelGenerating failed during narrow toggle', e as Error)
    }
    dispatch(setNarrowMode(!narrowMode))
  }

  return (
    <NavbarHeader className="home-navbar" style={{ height: 'var(--navbar-height)' }}>
      <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        {!narrowMode && (
          <AnimatePresence>
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{ overflow: 'hidden' }}>
              <ChatNavbarContent assistant={assistant} />
            </motion.div>
          </AnimatePresence>
        )}
        <Tooltip title={narrowMode ? t('navbar.show_sidebar') : '进入沉浸模式'} mouseEnterDelay={0.8} placement="bottom">
          <NavbarIcon onClick={handleImmersiveToggle}>
            {narrowMode ? <PanelRightClose size={18} /> : <PanelLeftClose size={18} />}
          </NavbarIcon>
        </Tooltip>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
