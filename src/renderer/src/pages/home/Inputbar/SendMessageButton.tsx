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
        fontSize: disabled ? 20 : 21,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        marginTop: 0,
        marginRight: 2,
        opacity: disabled ? 0.3 : 1,
        filter: disabled
          ? 'none'
          : 'drop-shadow(0 0 8px var(--color-primary)) drop-shadow(0 0 24px color-mix(in srgb, var(--color-primary) 30%, transparent))',
        transform: disabled ? 'scale(0.95)' : 'scale(1)'
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.filter =
            'drop-shadow(0 0 12px var(--color-primary)) drop-shadow(0 0 36px color-mix(in srgb, var(--color-primary) 40%, transparent))'
          e.currentTarget.style.transform = 'scale(1.15)'
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.filter =
            'drop-shadow(0 0 8px var(--color-primary)) drop-shadow(0 0 24px color-mix(in srgb, var(--color-primary) 30%, transparent))'
          e.currentTarget.style.transform = 'scale(1)'
        }
      }}
    />
  )
}

export default SendMessageButton
