/**
 * 极简日志 —— 走 stderr。
 *
 * 为什么自己写不用 pino / winston:
 *  - stdio MCP 协议把 stdout 占给 JSON-RPC 帧,日志库默认写 stdout 会污染协议、让 client 把
 *    server 当死了。我们必须显式走 stderr。
 *  - 这个包要尽量瘦,多一个 dep 多一份维护。
 *
 * 纪律(tech/mcp-integration.md N1):
 *  - 调用方传给 fields 的对象自己保证不含敏感字段(token / 明文 / hash / prefix);本模块不再做
 *    白名单过滤,简化心智 —— 业务代码每个打点处都该手动确认。
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function currentLevel(): number {
  const raw = (process.env.DREAMLAND_LOG_LEVEL ?? 'info').toLowerCase() as Level
  return LEVELS[raw] ?? LEVELS.info
}

function emit(level: Level, event: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < currentLevel()) return
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  }
  // 单行 JSON,工具友好 + grep 友好
  process.stderr.write(JSON.stringify(line) + '\n')
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
}
