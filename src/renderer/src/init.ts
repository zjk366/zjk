import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'

import { startAutoSync } from './services/BackupService'
import { startNutstoreAutoSync } from './services/NutstoreService'
import storeSyncService from './services/StoreSyncService'
import { webTraceService } from './services/WebTraceService'
import store from './store'
import { addMCPServer } from './store/mcp'

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
  window.electron?.ipcRenderer?.on('mcp:package-installed', async (_event, data: {
    packageName: string
    serverId: string
    description: string
  }) => {
    const { packageName, serverId, description } = data

    // 1. Add to Redux store if not already present
    const state = store.getState()
    const exists = state.mcp.servers.some((s) => s.name === packageName || s.id === serverId)
    if (!exists) {
      store.dispatch(addMCPServer({
        id: serverId,
        name: packageName,
        description,
        command: 'npx',
        args: ['-y', packageName],
        isActive: true,
        type: 'stdio',
        installSource: 'manual',
        isTrusted: true,
        installedAt: Date.now()
      }))
    }

    // 2. Register in Skills management room
    try {
      const { default: SkillsService } = await import('./services/SkillsService')
      await SkillsService.getInstance().register({
        id: `mcp_${serverId}`,
        name: packageName,
        description,
        plainDescription: `${packageName} - 通过 AI 自动安装的 MCP 服务`,
        source: 'MCP 自动安装',
        isEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: ['MCP', '自动安装'],
      })
      loggerService.withContext('init').info(`MCP package registered in Skills: ${packageName}`)
    } catch (err) {
      // Skills registration failure is non-critical
    }

    // 3. Try to restart the server to connect to Hub
    try {
      const restartServer = (window as any).api?.mcp?.restartServer
      if (typeof restartServer === 'function') {
        await restartServer({ id: serverId, name: packageName })
      }
    } catch {
      // Server restart failure is non-critical
    }
  })
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
