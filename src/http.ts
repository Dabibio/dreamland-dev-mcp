/**
 * 后端 HTTP 客户端 —— 唯一封装跟 DreamLand backend 的通讯。
 *
 * 设计纪律(tech/mcp-integration.md 4.5 / 4.7):
 *  - 所有出站请求统一加 Authorization: Bearer。token 由配置注入,不在请求路径 / URL 上出现。
 *  - 错误响应转 {@link BackendError},含 status / code / message,上层 tool 据此组人话。
 *    特别处理 401 / 404 —— 这是 N1 / N2 兑现的位置,工具要给用户"下一步动作",不能干瘪一句 "failed"。
 *  - 显式 timeout 30s —— stdio 工具调用阻塞太久 agent 会卡死,这是 N3 的边界。
 *  - 永不打 token 明文 / 完整响应体到日志(响应体可能含敏感字段)—— 仅 method / path / status。
 */

import type { Config } from './config.js'
import { logger } from './logger.js'

/** 默认 30s,够大文件上传 + 后端 R2/KV/CDN 编排一轮;再长就该让用户中断。 */
const DEFAULT_TIMEOUT_MS = 30_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** JSON 体(自动 stringify + content-type)。与 form 互斥。 */
  json?: unknown
  /** multipart/form-data(由调用方组装,自带 boundary)。与 json 互斥。 */
  form?: FormData
  /** 覆盖默认 timeout。 */
  timeoutMs?: number
}

/**
 * 调一个 backend 端点。
 *
 * @param config 启动期注入的配置
 * @param path 以 `/` 开头的路径(`/projects`、`/me/api-token` 等)
 */
export async function request<T = unknown>(
  config: Config,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', json, form, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  if (json !== undefined && form !== undefined) {
    throw new Error('request: json and form are mutually exclusive')
  }
  if (!path.startsWith('/')) {
    throw new Error(`request: path must start with "/" (got "${path}")`)
  }

  const url = config.apiBase + path
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
  }

  let body: BodyInit | undefined
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  } else if (form !== undefined) {
    // fetch 给 FormData 自动算 boundary,我们不能手动加 Content-Type 头(否则 boundary 缺失)
    body = form
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(url, { method, headers, body, signal: ctl.signal })
  } catch (e) {
    clearTimeout(timer)
    if (ctl.signal.aborted) {
      throw new BackendError(0, 'TIMEOUT', `Request to ${path} timed out after ${timeoutMs}ms.`)
    }
    const cause = e instanceof Error ? e.message : String(e)
    throw new BackendError(0, 'NETWORK_ERROR', `Network error calling ${path}: ${cause}`)
  } finally {
    clearTimeout(timer)
  }

  logger.debug('http', { method, path, status: res.status })

  if (!res.ok) {
    // 后端约定错误体:{ code: "XXX", message: "..." };偶尔会有非 JSON(401 Spring 默认 / 5xx)
    let code = 'BACKEND_ERROR'
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { code?: string; message?: string }
      if (body.code) code = body.code
      if (body.message) message = body.message
    } catch {
      // 非 JSON 响应:status 已经够说明,message 用 statusText 补
      if (res.statusText) message = `HTTP ${res.status} ${res.statusText}`
    }
    throw new BackendError(res.status, code, message)
  }

  // 204 No Content / 体为空:返回 undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (res.status === 204 || !contentType.includes('json')) {
    return undefined as T
  }
  return (await res.json()) as T
}

/** 后端返回的非 2xx 响应。status === 0 表示请求未到后端(网络 / timeout)。 */
export class BackendError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'BackendError'
    this.status = status
    this.code = code
  }
}
