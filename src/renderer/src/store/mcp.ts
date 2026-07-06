/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { loggerService } from '@logger'
import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import McpSkillsSyncService from '@renderer/services/McpSkillsSyncService'
import { type BuiltinMCPServer, BuiltinMCPServerNames, type MCPConfig, type MCPServer } from '@renderer/types'

const logger = loggerService.withContext('Store:MCP')
const filesystemManualApprovalTools = ['write', 'edit', 'delete'] as const

export const initialState: MCPConfig = {
  servers: [],
  isUvInstalled: true,
  isBunInstalled: true
}

const mcpSlice = createSlice({
  name: 'mcp',
  initialState,
  reducers: {
    setMCPServers: (state, action: PayloadAction<MCPServer[]>) => {
      state.servers = action.payload
    },
    addMCPServer: (state, action: PayloadAction<MCPServer>) => {
      state.servers.unshift(action.payload)
    },
    updateMCPServer: (state, action: PayloadAction<MCPServer>) => {
      const index = state.servers.findIndex((server) => server.id === action.payload.id)
      if (index !== -1) {
        state.servers[index] = action.payload
      }
    },
    deleteMCPServer: (state, action: PayloadAction<string>) => {
      state.servers = state.servers.filter((server) => server.id !== action.payload)
    },
    setMCPServerActive: (state, action: PayloadAction<{ id: string; isActive: boolean }>) => {
      const index = state.servers.findIndex((server) => server.id === action.payload.id)
      if (index !== -1) {
        state.servers[index].isActive = action.payload.isActive
      }
    },
    setIsUvInstalled: (state, action: PayloadAction<boolean>) => {
      state.isUvInstalled = action.payload
    },
    setIsBunInstalled: (state, action: PayloadAction<boolean>) => {
      state.isBunInstalled = action.payload
    }
  },
  selectors: {
    getActiveServers: (state) => {
      return state.servers.filter((server) => server.isActive)
    },
    getAllServers: (state) => state.servers
  }
})

export const {
  setMCPServers,
  addMCPServer,
  updateMCPServer,
  deleteMCPServer,
  setMCPServerActive,
  setIsBunInstalled,
  setIsUvInstalled
} = mcpSlice.actions

// Export the generated selectors from the slice
export const { getActiveServers, getAllServers } = mcpSlice.selectors

// Type-safe selector for accessing this slice from the root state
export const selectMCP = (state: { mcp: MCPConfig }) => state.mcp

export { mcpSlice }
// Export the reducer as default export
export default mcpSlice.reducer

/**
 * Hub MCP server for auto mode - aggregates all MCP servers for LLM code mode.
 * This server is injected automatically when mcpMode === 'auto'.
 */
export const hubMCPServer: BuiltinMCPServer = {
  id: 'hub',
  name: BuiltinMCPServerNames.hub,
  type: 'inMemory',
  isActive: true,
  provider: 'CherryAI',
  installSource: 'builtin',
  isTrusted: true
}

/**
 * User-installable built-in MCP servers shown in the UI.
 *
 * Note: The `hub` server (@cherry/hub) is intentionally excluded because:
 * - It's a meta-server that aggregates all other MCP servers
 * - It's designed for LLM code mode, not direct user interaction
 * - It should be auto-enabled internally when needed, not manually installed
 */
export const builtinMCPServers: BuiltinMCPServer[] = [
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.mcpAutoInstall,
    reference: 'https://docs.cherry-ai.com/advanced-basic/mcp/auto-install',
    type: 'inMemory',
    command: 'npx',
    args: ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'],
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.sequentialThinking,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.fetch,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.python,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.browser,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMCPServerNames.terminal,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  }
] as const

/**
 * Utility function to add servers to the MCP store during app initialization
 * @param servers Array of MCP servers to add
 * @param dispatch Redux dispatch function
 */
export const initializeMCPServers = (existingServers: MCPServer[], dispatch: (action: any) => void): void => {
  const serverIds = new Set(existingServers.map((server) => server.name))

  // 1. 添加缺失的内置服务器
  const newServers = builtinMCPServers.filter((server) => !serverIds.has(server.name))
  newServers.forEach((server) => {
    dispatch(addMCPServer(server))
  })

  // 2. 强制启用所有内置服务器（将已存在但禁用的也打开）
  const builtinNames = builtinMCPServers.map((s) => s.name)
  existingServers.forEach((server) => {
    if (builtinNames.includes(server.name) && !server.isActive) {
      dispatch(updateMCPServer({ ...server, isActive: true }))
    }
  })

  // 3. 同步注册到 Skills 管理室（内置服务器，延迟 + 静默容错，不给启动加压）
  setTimeout(() => {
    builtinMCPServers.forEach((s) => {
      McpSkillsSyncService.syncServerToSkill({
        id: s.name,
        name: s.name,
        description: `${s.name} 内置 MCP 服务`,
        type: s.type || 'inMemory',
        isActive: true,
        installSource: 'builtin'
      } as MCPServer).catch(() => {})
    })
  }, 8000)

  // 4. 清除缓存 + 逐台热启动内置服务（隔 2 秒避免并发超时）
  window.electron?.ipcRenderer?.invoke('mcp:clear-cache').catch(() => {})
  const restartServer = (window as any).api?.mcp?.restartServer
  if (typeof restartServer === 'function') {
    // 先关后启，按间隔顺序启动，避免并发超时
    const serversToStart = [...builtinMCPServers]
    const startNext = (i: number) => {
      if (i >= serversToStart.length) return
      const s = serversToStart[i]
      restartServer(s)
        .catch(() => {})
        .finally(() => {
          setTimeout(() => startNext(i + 1), 2000)
        })
    }
    setTimeout(() => startNext(0), 1000)
  }

  // 5. 清理已移除的内置服务 + 孤儿技能
  // 使用 syncAllServers 全量同步会顺便清理孤儿
  const OBSOLETE_NAMES = [
    '@cherry/flomo',
    '@cherry/memory',
    '@cherry/brave-search',
    '@cherry/filesystem',
    '@cherry/dify-knowledge',
    '@cherry/didi-mcp',
    '@cherry/nowledge-mem'
  ]
  const currentServers = existingServers.filter((s) => s.isActive && !OBSOLETE_NAMES.includes(s.name))
  // 把内置服务器也加进去一起同步（延迟+静默容错，Redux persist 恢复后才写 IndexedDB）
  const allCurrent = [...builtinMCPServers, ...currentServers]
  setTimeout(() => {
    McpSkillsSyncService.syncAllServers(allCurrent).catch(() => {})
  }, 10000)
}

/**
 * 通过 npm 包名安装 MCP 服务器
 * 自动创建 MCPServer 配置并添加到 Redux store
 * 安装后自动同步到 Skills 管理室
 */
let _counter = 0
export function installMcpPackage(packageName: string, description?: string): MCPServer {
  _counter++
  const now = Date.now()
  // 尝试提取二进制名（取包名最后一段，如 @8btc/ppt-generator-mcp → ppt-generator-mcp）
  const server: MCPServer = {
    id: `mcp_${packageName.replace(/[^a-zA-Z0-9]/g, '_')}_${_counter}`,
    name: packageName,
    description: description || `${packageName} MCP 服务`,
    command: 'npx',
    args: ['-y', packageName],
    isActive: true,
    type: 'stdio',
    installSource: 'manual',
    isTrusted: true,
    installedAt: now
  }
  store.dispatch(addMCPServer(server))

  // 1. 弹出终端窗口（先 npm install -g 安装，避免 npx stdio 污染）
  const openTerminal = (window as any).api?.openTerminal
  if (typeof openTerminal === 'function') {
    openTerminal(`npx -y ${packageName}`, packageName)
  }

  // 2. 后台轮询连接 Hub（不阻塞，npx 下载完自动连上）
  const restartServer = (window as any).api?.mcp?.restartServer
  if (typeof restartServer === 'function') {
    let retries = 20 // 最长等 100 秒
    const poll = () => {
      if (retries-- <= 0) return
      restartServer(server)
        .then(() => {
          window.toast.success(`MCP ${packageName} 已启动并接入 Hub`)
        })
        .catch(() => setTimeout(poll, 5000))
    }
    setTimeout(poll, 5000)
  }

  // 同步注册到 Skills 管理室
  McpSkillsSyncService.syncServerToSkill(server)

  window.toast.success(`已添加 MCP: ${packageName}`)
  return server
}
