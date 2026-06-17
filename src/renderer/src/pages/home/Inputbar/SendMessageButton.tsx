import type { FC, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  disabled: boolean
  sendMessage: () => void
}

const SendMessageButton: FC<Props> = ({ disabled, sendMessage }) => {
  const { t } = useTranslation()

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <i
      className="iconfont icon-ic_send"
      onClick={disabled ? undefined : sendMessage}
      onKeyDown={handleKeyDown}
      role="button"
      aria-label={t('chat.input.send')}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--color-text-3)' : 'var(--color-primary)',
        fontSize: 20,
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        marginTop: 0,
        marginRight: 2,
        opacity: disabled ? 0.3 : 1,
        filter: disabled ? 'none' : 'drop-shadow(0 0 6px color-mix(in srgb, var(--color-primary) 40%, transparent))',
        transform: disabled ? 'scale(0.95)' : 'scale(1)'
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.filter = 'drop-shadow(0 0 10px var(--color-primary))'
          e.currentTarget.style.transform = 'scale(1.1)'
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.filter =
            'drop-shadow(0 0 6px color-mix(in srgb, var(--color-primary) 40%, transparent))'
          e.currentTarget.style.transform = 'scale(1)'
        }
      }}
    />
  )
}

export default SendMessageButton
