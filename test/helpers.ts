/**
 * 测试辅助 —— 临时目录 + fetch stub。
 *
 * 跑测试要保证彻底隔离:每个用例自己的 tmp 目录,跑完清掉;fetch 走 stub,不要打到真实 backend。
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

export async function makeTempDir(prefix = 'dlmcp-test-'): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

/** 在 baseDir 下创建一个文件,自动建父目录。 */
export async function writeAt(baseDir: string, relPath: string, content: string): Promise<void> {
  const full = join(baseDir, relPath)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf-8')
}

// ============================================================
// fetch stub
// ============================================================

export interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown // 已解析的 JSON / multipart fields
  rawBody?: BodyInit | null
}

export interface StubResponse {
  status: number
  body?: unknown // JSON 体
  text?: string // 非 JSON 体
}

export type StubMatcher = (req: RecordedRequest) => StubResponse | null | undefined

/**
 * 安装 fetch stub。返回 { calls, restore } —— 用例自行在 afterEach 调 restore。
 *
 * matchers 按顺序匹配,第一个返回非 null 的生效;全没命中 → 抛 "no stub matched",
 * 强迫用例显式描述每个预期的请求。
 */
export function installFetchStub(...matchers: StubMatcher[]): {
  calls: RecordedRequest[]
  restore: () => void
} {
  const calls: RecordedRequest[] = []
  const original = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headers[k.toLowerCase()] = v
      } else {
        for (const [k, v] of Object.entries(init.headers)) headers[k.toLowerCase()] = String(v)
      }
    }
    const body = await parseBody(init?.body, headers['content-type'])

    const recorded: RecordedRequest = { url, method, headers, body, rawBody: init?.body ?? null }
    calls.push(recorded)

    for (const matcher of matchers) {
      const resp = matcher(recorded)
      if (resp) {
        return makeResponse(resp)
      }
    }
    throw new Error(`fetch stub: no matcher for ${method} ${url}`)
  }) as typeof fetch

  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

async function parseBody(
  body: BodyInit | null | undefined,
  contentType?: string,
): Promise<unknown> {
  if (body == null) return undefined
  if (body instanceof FormData) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of body.entries()) {
      // Blob → 记下 size + type 便于断言"上传了一个 zip 包"
      out[k] = v instanceof Blob ? { _blob: true, size: v.size, type: v.type } : v
    }
    return out
  }
  if (typeof body === 'string') {
    if (contentType?.includes('json')) {
      try {
        return JSON.parse(body)
      } catch {
        return body
      }
    }
    return body
  }
  return body
}

function makeResponse(stub: StubResponse): Response {
  const status = stub.status
  if (stub.body !== undefined) {
    return new Response(JSON.stringify(stub.body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response(stub.text ?? '', { status })
}

/** 便捷:匹配某个 path + method,返指定响应。 */
export function whenRequest(
  expect: { method?: string; pathEndsWith: string },
  respond: StubResponse,
): StubMatcher {
  return (req) => {
    if (expect.method && req.method !== expect.method.toUpperCase()) return null
    if (!req.url.endsWith(expect.pathEndsWith)) return null
    return respond
  }
}
