import { useTranslation } from 'react-i18next'

const BlackholePage = () => {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full flex-col items-center justify-center" style={{ background: '#0a0e1a' }}>
      <img src="/src/assets/images/blackhole.png" style={{ width: 80, height: 80, borderRadius: '50%', marginBottom: 24, boxShadow: '0 0 30px rgba(22,119,255,0.3)' }} />
      <h1 style={{ color: '#e8ecf4', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Blackhole 模式</h1>
      <p style={{ color: '#8892b0', fontSize: 14 }}>超级功能即将上线</p>
    </div>
  )
}

export default BlackholePage
