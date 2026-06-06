import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const MonitorRoomPage: FC = () => {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full flex-col items-center justify-center" style={{ background: '#0a0e1a' }}>
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          marginBottom: 24,
          boxShadow: '0 0 30px rgba(22, 119, 255, 0.3)',
          background: 'radial-gradient(circle at 35% 35%, #338cff, #0a1628)',
          border: '1.5px solid rgba(22, 119, 255, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#e8ecf4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="2.5" fill="#e8ecf4" />
          <path d="M12 5a7 7 0 0 1 7 7" opacity="0.7" />
          <path d="M12 2a10 10 0 0 1 10 10" opacity="0.4" />
          <path d="M5 12a7 7 0 0 1 7-7" opacity="0.7" />
          <path d="M2 12a10 10 0 0 1 10-10" opacity="0.4" />
          <path d="M12 19a7 7 0 0 1-7-7" opacity="0.7" />
          <path d="M12 22a10 10 0 0 1-10-10" opacity="0.4" />
          <path d="M19 12a7 7 0 0 1-7 7" opacity="0.7" />
          <path d="M22 12a10 10 0 0 1-10 10" opacity="0.4" />
        </svg>
      </div>
      <h1 style={{ color: '#e8ecf4', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{t('monitor.title')}</h1>
      <p style={{ color: '#8892b0', fontSize: 14, textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>{t('monitor.description')}</p>
    </div>
  )
}

export default MonitorRoomPage
