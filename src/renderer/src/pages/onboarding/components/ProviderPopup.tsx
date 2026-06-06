import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import i18n from '@renderer/i18n'
import ProviderList from '@renderer/pages/settings/ProviderSettings/ProviderList'
import { ConfigProvider, theme } from 'antd'
import { MemoryRouter } from 'react-router-dom'

export default class ProviderPopup {
  static show() {
    return GeneralPopup.show({
      title: i18n.t('onboarding.welcome.select_other_provider'),
      content: (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
          <MemoryRouter>
            <ProviderList isOnboarding />
          </MemoryRouter>
        </ConfigProvider>
      ),
      footer: null,
      width: 'min(1200px, 80vw)',
      styles: {
        header: {
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          paddingBottom: 12,
          paddingTop: 12,
          marginBottom: 0
        },
        body: { padding: 0, height: 'max(75vh, calc(100vh - var(--navbar-height) * 2))', display: 'flex' },
        content: { paddingBottom: 0 }
      }
    })
  }

  static hide() {
    GeneralPopup.hide()
  }
}
