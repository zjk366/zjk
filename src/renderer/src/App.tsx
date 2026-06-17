import '@renderer/databases'

import { loggerService } from '@logger'
import store, { persistor } from '@renderer/store'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import { ClarifyCard } from './components/ClarifyCard'
import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { CodeStyleProvider } from './context/CodeStyleProvider'
import { NotificationProvider } from './context/NotificationProvider'
import StyleSheetManager from './context/StyleSheetManager'
import { ThemeProvider } from './context/ThemeProvider'
import Router from './Router'
import MemoryBankService from './services/MemoryBankService'

const logger = loggerService.withContext('App.tsx')

// 创建 React Query 客户端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
})

function App(): React.ReactElement {
  logger.info('App initialized')

  useEffect(() => {
    // 初始化记忆库服务（自动摘要 + 定时清理）
    const ms = MemoryBankService.getInstance()
    ms.init()
    return () => ms.destroy()
  }, [])

  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <StyleSheetManager>
          <ThemeProvider>
            <AntdProvider>
              <NotificationProvider>
                <CodeStyleProvider>
                  <PersistGate loading={null} persistor={persistor}>
                    <TopViewContainer>
                      <Router />
                      <ClarifyCard />
                    </TopViewContainer>
                  </PersistGate>
                </CodeStyleProvider>
              </NotificationProvider>
            </AntdProvider>
          </ThemeProvider>
        </StyleSheetManager>
      </QueryClientProvider>
    </Provider>
  )
}

export default App
