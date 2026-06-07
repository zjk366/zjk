/**
 * Terminal MCP Server
 *
 * 提供在本地终端中执行命令的能力。
 * 类似 Claude Code CLI 的工作方式——AI 在终端中执行命令来操作本地环境。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { executeToolDefinition, handleExecuteTool } from './tools/execute'
import { logger } from './types'

export class TerminalServer {
  public server: Server

  constructor() {
    this.server = new Server(
      {
        name: 'terminal-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    this.registerHandlers()
    logger.info('Terminal MCP server initialized')
  }

  private registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          executeToolDefinition
        ]
      }
    })

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'execute_command':
            return await handleExecuteTool(args) as any

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(`Tool execution error for ${request.params.name}:`, { error })
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}

export default TerminalServer
