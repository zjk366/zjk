import { loggerService } from '@logger'
import BlackholeLogo from '@renderer/assets/images/blackhole.png'
import { useAppStore } from '@renderer/store'
import { updateProvider } from '@renderer/store/llm'
import { Button } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { OnboardingStep } from '../OnboardingPage'
import ProviderPopup from './ProviderPopup'

const logger = loggerService.withContext('WelcomePage')

const PORTAL_URL = 'http://8.137.146.148/'

interface WelcomePageProps {
  setStep: (step: OnboardingStep) => void
  setCherryInLoggedIn: (loggedIn: boolean) => void
  onComplete: () => void
}

const WelcomePage: FC<WelcomePageProps> = ({ setStep, onComplete }) => {
  const { t } = useTranslation()
  const store = useAppStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const handleOpenPortal = useCallback(async () => {
    try {
      const port = await window.api.portal.startServer()
      const portalUrl = PORTAL_URL + '?cb=' + port + '&t=' + Date.now()
      window.api.shell.openExternal(portalUrl).catch((err: Error) => {
        logger.error('打开门户失败:', err)
      })
      onComplete()
    } catch (e) {
      logger.error('启动门户服务失败:', e)
      window.api.shell.openExternal(PORTAL_URL).catch((err: Error) => {
        logger.error('打开门户失败:', err)
      })
      onComplete()
    }
  }, [onComplete])

  // 粒子动画（克制版）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let animId: number
    const particles: { x: number; y: number; vx: number; vy: number; r: number }[] = []
    const resize = () => { canvas.width = canvas.offsetWidth * 2; canvas.height = canvas.offsetHeight * 2 }
    resize()
    for (let i = 0; i < 30; i++) particles.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2, r: Math.random() * 1.5 + 0.3 })
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(150, 200, 255, 0.25)'; ctx.fill()
      })
      animId = requestAnimationFrame(draw)
    }
    draw()
    window.addEventListener('resize', resize)
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])

  // 监听门户回调，自动配置提供商
  useEffect(() => {
    const cleanup = window.api.portal.onApiKey((data: { apiKey: string; baseUrl: string }) => {
      logger.info('收到门户回调', { baseUrl: data.baseUrl })
      if (data.apiKey) {
        store.dispatch(
          updateProvider({
            id: 'blackhole',
            apiKey: data.apiKey,
            apiHost: data.baseUrl || 'http://8.137.146.148:9000/v1',
            enabled: true
          })
        )
        logger.info('已自动配置提供商')
      }
    })
    return cleanup
  }, [store])

  const handleSelectProvider = async () => {
    await ProviderPopup.show()
    const hasProvider = store.getState().llm.providers.some((p) => p.enabled)
    if (hasProvider) setStep('select-model')
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center" style={{ position: 'relative', zIndex: 1 }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} />
      <div className="flex flex-col items-center gap-10" style={{ position: 'relative', zIndex: 1 }}>

        {/* Logo */}
        <div className="blackhole-logo-wrapper">
          <img src={BlackholeLogo} alt="Blackhole" className="blackhole-logo" style={{ width: 72, height: 72 }} />
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-2" style={{ marginTop: -12 }}>
          <h1 className="blackhole-title m-0" style={{ fontSize: 32, lineHeight: 1.2 }}>{t('onboarding.welcome.title')}</h1>
          <p className="blackhole-subtitle m-0">{t('onboarding.welcome.subtitle')}</p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3" style={{ width: 300 }}>
          <Button
            type="primary"
            size="large"
            block
            className="blackhole-btn-primary"
            onClick={handleOpenPortal}
            style={{ height: 48, fontSize: 15, fontWeight: 600, letterSpacing: 2, borderRadius: 6 }}>
            {t('onboarding.welcome.login_cherryin')}
          </Button>

          <div className="blackhole-divider" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', lineHeight: '12px', margin: '4px 0' }}>
            <span style={{ padding: '0 8px', fontSize: 11, color: 'rgba(160,185,210,0.4)' }}>{t('onboarding.welcome.or_continue_with')}</span>
          </div>

          <Button
            size="large"
            block
            className="blackhole-btn-secondary"
            onClick={handleSelectProvider}
            style={{ height: 44, fontSize: 13, letterSpacing: 1.5, borderRadius: 6 }}>
            {t('onboarding.welcome.other_provider')}
          </Button>
        </div>

        {/* Version */}
        <p className="blackhole-version m-0">{t('onboarding.welcome.setup_hint')}</p>
      </div>
    </div>
  )
}

export default WelcomePage
