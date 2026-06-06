import { Button } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface SkipButtonProps {
  onSkip: () => void
}

const SkipButton: FC<SkipButtonProps> = ({ onSkip }) => {
  const { t } = useTranslation()

  return (
    <Button
      type="text"
      className="blackhole-skip-btn"
      style={{ position: 'absolute', top: 16, right: 16, width: 'auto', zIndex: 10 }}
      onClick={onSkip}>
      {t('onboarding.skip')}
    </Button>
  )
}

export default SkipButton
