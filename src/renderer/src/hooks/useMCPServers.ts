import { createSelector } from '@reduxjs/toolkit'
import NavigationService from '@renderer/services/NavigationService'
import SkillsService from '@renderer/services/SkillsService'
import type { RootState } from '@renderer/store'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { addMCPServer, deleteMCPServer, setMCPServers, updateMCPServer } from '@renderer/store/mcp'
import type { MCPServer } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'

// 当 MCP 服务器变更时，同步注册/更新到 skills 管理室
async function syncMcpToSkills(servers: MCPServer[]) {
  try {
    const skillsService = SkillsService.getInstance()
    for (const server of servers) {
      const existing = (await skillsService.getAll()).find((s) => s.name === server.name || s.id === `mcp_${server.id}`)
      if (!existing) {
        await skillsService.register({
          id: `mcp_${server.id}`,
          name: server.name,
          description: server.description || `${server.name} MCP 服务`,
          plainDescription: server.description || server.name,
          source: 'MCP 自动安装',
          isEnabled: server.isActive ?? true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: ['MCP', server.type || 'server'],
        })
      } else if (existing.isEnabled !== (server.isActive ?? true)) {
        await skillsService.update(existing.id, { isEnabled: server.isActive ?? true })
      }
    }
  } catch (err) {
    console.error('Failed to sync MCP to skills:', err)
  }
}

// Listen for server changes from main process
window.electron.ipcRenderer.on(IpcChannel.Mcp_ServersChanged, (_event, servers) => {
  store.dispatch(setMCPServers(servers))
  void syncMcpToSkills(servers)
})

window.electron.ipcRenderer.on(IpcChannel.Mcp_AddServer, (_event, server: MCPServer) => {
  store.dispatch(addMCPServer(server))
  void syncMcpToSkills([server])
  NavigationService.navigate?.('/settings/mcp')
  NavigationService.navigate?.(`/settings/mcp/settings/${encodeURIComponent(server.id)}`)
})

const selectMcpServers = (state: RootState) => state.mcp.servers
const selectActiveMcpServers = createSelector([selectMcpServers], (servers) =>
  servers.filter((server) => server.isActive)
)

export const useMCPServers = () => {
  const mcpServers = useAppSelector(selectMcpServers)
  const activedMcpServers = useAppSelector(selectActiveMcpServers)
  const dispatch = useAppDispatch()

  return {
    mcpServers,
    activedMcpServers,
    addMCPServer: (server: MCPServer) => dispatch(addMCPServer(server)),
    updateMCPServer: (server: MCPServer) => dispatch(updateMCPServer(server)),
    deleteMCPServer: (id: string) => dispatch(deleteMCPServer(id)),
    setMCPServerActive: (server: MCPServer, isActive: boolean) => dispatch(updateMCPServer({ ...server, isActive })),
    getActiveMCPServers: () => mcpServers.filter((server) => server.isActive),
    updateMcpServers: (servers: MCPServer[]) => dispatch(setMCPServers(servers))
  }
}

export const useMCPServer = (id: string) => {
  const server = useAppSelector((state) => (state.mcp.servers || []).find((server) => server.id === id))
  const dispatch = useAppDispatch()

  return {
    server,
    updateMCPServer: (server: MCPServer) => dispatch(updateMCPServer(server)),
    setMCPServerActive: (server: MCPServer, isActive: boolean) => dispatch(updateMCPServer({ ...server, isActive })),
    deleteMCPServer: (id: string) => dispatch(deleteMCPServer(id))
  }
}
