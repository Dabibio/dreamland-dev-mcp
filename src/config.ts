/**
 * 环境变量配置 —— 启动时一次性读完并校验。
 *
 * 设计纪律(tech/mcp-integration.md 4.7):
 *  - DREAMLAND_TOKEN 必填,缺则进程 stderr 报错后立即退出 —— 不要给 LLM 一个看似在跑、实则每次调
 *    都 401 的工具,这种"看着正常"的失败比硬启动错误更难排查。
 *  - DREAMLAND_API_BASE 给默认 http://localhost:8080,方便本地 dev 不传 env 也能跑;prod 用 deeplink
 *    的 dashboard 流程会显式嵌入 origin。
 *  - 任何配置错误的输出走 stderr —— stdio 协议下 stdout 给 JSON-RPC,污染就跟 server 死了一样。
 */

export interface Config {
  /** API 凭证,形如 `dl_live_…`。绝不出现在日志 / tool_result / LLM 上下文。 */
  readonly token: string
  /** 后端 base URL,**末尾无斜杠**(由 http 层拼路径)。 */
  readonly apiBase: string
}

/**
 * 启动期读取配置;不合法即 throw,index.ts 转 stderr + exit。
 *
 * 不在这里做 token 格式校验(校验在后端 TokenAuthFilter,客户端做了反而双重维护)—— 但**前缀
 * 检查**保留一道,防止用户把整段 mcp.json 当 token 粘进 env 这种荒唐输入,提早爆出来。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = (env.DREAMLAND_TOKEN ?? '').trim()
  if (!token) {
    throw new ConfigError(
      'DREAMLAND_TOKEN is required. Generate one at <dashboard>/settings/api-token.',
    )
  }
  if (!token.startsWith('dl_live_')) {
    throw new ConfigError(
      'DREAMLAND_TOKEN must look like dl_live_…. Did you paste the wrong value?',
    )
  }

  const rawBase = (env.DREAMLAND_API_BASE ?? 'http://localhost:8080').trim()
  if (!rawBase) {
    throw new ConfigError('DREAMLAND_API_BASE is empty.')
  }
  if (!/^https?:\/\//.test(rawBase)) {
    throw new ConfigError(
      `DREAMLAND_API_BASE must start with http:// or https:// (got "${rawBase}").`,
    )
  }
  const apiBase = rawBase.replace(/\/+$/, '') // 去掉末尾斜杠,http 层统一拼

  return { token, apiBase }
}

/** 区别于普通 Error,index.ts 据此走启动期失败路径。 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}
