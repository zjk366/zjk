import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'

import { startAutoSync } from './services/BackupService'
import { startNutstoreAutoSync } from './services/NutstoreService'
import storeSyncService from './services/StoreSyncService'
import { webTraceService } from './services/WebTraceService'
import store from './store'
import { installMcpPackage } from './store/mcp'

loggerService.initWindowSource('mainWindow')

function initKeyv() {
  window.keyv = new KeyvStorage()
  void window.keyv.init()
}

/**
 * Listen for MCP package installation events from main process
 * and auto-register the installed package in Skills management room
 */
function initMcpInstallListener() {
  window.electron?.ipcRenderer?.on(
    'mcp:package-installed',
    async (
      _event,
      data: {
        packageName: string
        description: string
      }
    ) => {
      const { packageName, description } = data
      // installMcpPackage 处理全套流程：添加 Redux store + 弹出终端窗口 + 连接 Hub + 注册 Skills
      installMcpPackage(packageName, description)
    }
  )
}

function initAutoSync() {
  setTimeout(() => {
    const { webdavAutoSync, localBackupAutoSync, s3 } = store.getState().settings
    const { nutstoreAutoSync } = store.getState().nutstore
    if (webdavAutoSync || (s3 && s3.autoSync) || localBackupAutoSync) {
      startAutoSync()
    }
    if (nutstoreAutoSync) {
      void startNutstoreAutoSync()
    }
  }, 8000)
}

function initStoreSync() {
  storeSyncService.subscribe()
}

function initWebTrace() {
  webTraceService.init()
}

initKeyv()
initMcpInstallListener()
initAutoSync()
initStoreSync()
initWebTrace()
