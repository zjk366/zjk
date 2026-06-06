import WindowControls from '@renderer/components/WindowControls'
import type { FC } from 'react'
import { useState } from 'react'

import './blackhole-theme.css'
import SelectModelPage from './components/SelectModelPage'
import SkipButton from './components/SkipButton'
import WelcomePage from './components/WelcomePage'

export type OnboardingStep = 'welcome' | 'select-model'

interface OnboardingPageProps {
  onComplete: () => void
}

const OnboardingPage: FC<OnboardingPageProps> = ({ onComplete }) => {
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [cherryInLoggedIn, setCherryInLoggedIn] = useState(false)

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="drag flex w-full shrink-0 items-center justify-end" style={{ height: 'var(--navbar-height)' }}>
        <WindowControls />
      </div>
      <div className="flex flex-1 px-2 pb-2">
        <div className="blackhole-container blackhole-bg relative flex flex-1 overflow-hidden rounded-xl">
          {/* Starfield layer */}
          <div className="blackhole-stars" />
          {/* Nebula layer */}
          <div className="blackhole-nebula" />
          <SkipButton onSkip={onComplete} />
          {step === 'welcome' && <WelcomePage setStep={setStep} setCherryInLoggedIn={setCherryInLoggedIn} onComplete={onComplete} />}
          {step === 'select-model' && (
            <SelectModelPage cherryInLoggedIn={cherryInLoggedIn} setStep={setStep} onComplete={onComplete} />
          )}
        </div>
      </div>
    </div>
  )
}

export default OnboardingPage
