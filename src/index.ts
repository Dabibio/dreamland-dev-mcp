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
const SERVER_VERSION = '0.6.0'

/**
 * Server-level instructions, injected into the MCP client's LLM system prompt per
 * MCP spec. Tells the model:
 *
 *  - what this server is for (scope it tightly to the DreamLand frontend-publishing
 *    use case so it doesn't fight with other MCP servers like backend/CI tools);
 *  - what user phrases / workspace signals should make it pick our tools;
 *  - what is explicitly out of scope (deferred to other MCP servers / scripts);
 *  - the project_dir calling convention so the model doesn't hit our "required"
 *    rejection on the first call.
 */
const SERVER_INSTRUCTIONS = `DreamLand MCP — publishes a creator's frontend build artifact (typically the contents of ./dist from a web project) to DreamLand, a creator-feedback platform, and returns a public URL where end users can experience the demo.

In scope (use these tools):
  • User mentions DreamLand by name (publish / share / ship / get-link to DreamLand).
  • The workspace directory contains \`.dreamland/project.json\` — that file marks the folder as bound to a DreamLand project; "publish a new version" of such a workspace means dreamland_publish.
  • User asks about their DreamLand inventory: "what do I have on DreamLand", "what's my DreamLand link for X".

Out of scope (defer to other MCP servers or the user's own scripts):
  • Backend / API / database / container deployments.
  • Generic CI/CD or hosting platforms other than DreamLand.
  • Building the project — the user must run their build first. If \`./dist\` is missing, ask them to build, do not build for them.

Calling convention:
  • Every fs-touching tool (publish, link) requires \`project_dir\` = absolute path to the user's open workspace. The MCP server's own \`process.cwd()\` is NOT the workspace and the tools will reject calls without project_dir.`

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
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
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
