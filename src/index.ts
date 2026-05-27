#!/usr/bin/env node
/**
 * @dreamland_dev/mcp · stdio MCP server entry.
 *
 * Lifecycle:
 *  1. Boot:loadConfig → 缺 env 立即 exit(1) + stderr 报错(N3 不让"看着在跑实则每次都失败"的工具上去)
 *  2. Register tools(name + inputSchema + handler)
 *  3. Connect StdioServerTransport(stdin/stdout = JSON-RPC,stderr = 日志)
 *
 * 进程退出语义:transport 断开时 stdio MCP 的 connect() resolves,从这里 main() 自然结束 → 进程退出。
 * Cursor 杀子进程时也走这条路径。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { ConfigError, loadConfig } from './config.js'
import { logger } from './logger.js'
import { LINK_TOOL, makeLinkHandler } from './tools/link.js'
import { LIST_PROJECTS_TOOL, makeListProjectsHandler } from './tools/list-projects.js'
import { PUBLISH_TOOL, makePublishHandler } from './tools/publish.js'
import type { ToolHandler } from './tools/types.js'

const SERVER_NAME = 'dreamland'
const SERVER_VERSION = '0.3.0'

async function main(): Promise<void> {
  let config
  try {
    config = loadConfig()
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`[dreamland-mcp] config error: ${e.message}\n`)
      process.exit(1)
    }
    throw e
  }

  // tokenId 不可得(我们这边只有明文),日志里仅记 origin 便于排查;明文绝不出现
  logger.info('boot', { apiBase: config.apiBase })

  const handlers: Record<string, ToolHandler> = {
    [PUBLISH_TOOL.name]: makePublishHandler(config),
    [LIST_PROJECTS_TOOL.name]: makeListProjectsHandler(config),
    [LINK_TOOL.name]: makeLinkHandler(config),
  }

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [PUBLISH_TOOL, LIST_PROJECTS_TOOL, LINK_TOOL],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    const handler = handlers[name]
    if (!handler) {
      // SDK 把 throw 转成 protocol-level 错误;tool-level 业务失败用 isError:true
      throw new Error(`Unknown tool: ${name}`)
    }
    logger.debug('tool.call', { name })
    try {
      return await handler(args)
    } catch (e) {
      // 工具内部已尽量自己包错;真正未捕获的丢出去让 SDK 走 protocol error
      logger.error('tool.uncaught', { name, message: (e as Error).message })
      throw e
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`[dreamland-mcp] fatal: ${err?.message ?? err}\n`)
  process.exit(1)
})
