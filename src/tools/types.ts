/**
 * 工具调用的统一类型 —— 直接复用 MCP SDK 的 {@link CallToolResult}。
 *
 * 这样 index.ts 注册时的 handler 返回值能精确匹配 SDK 的 union;tool 实现里只构造 SDK 接受的形状
 * (content + 可选 isError),不需要额外类型对齐。
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export type ToolResult = CallToolResult

export type ToolHandler = (args: unknown) => Promise<ToolResult>
