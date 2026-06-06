import { useCallback, useEffect, useState } from 'react'

const ONBOARDING_COMPLETED_KEY = 'onboarding-completed'

export function useOnboardingState() {
  const [onboardingCompleted, setOnboardingCompleted] = useState(
    () => localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true'
  )

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    setOnboardingCompleted(true)
  }, [])

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
    setOnboardingCompleted(false)
  }, [])

  // Dev shortcut: Ctrl+Shift+R 重置欢迎页
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault()
        resetOnboarding()
        window.location.reload()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [resetOnboarding])

  return {
    onboardingCompleted,
    completeOnboarding,
    resetOnboarding
  }
}
