/**
 * dreamland_publish —— 把构建产物发到 DreamLand。
 *
 * 行为(tech/mcp-integration.md F1 + 4.6):
 *  - 首发:`.dreamland/project.json` 不存在(或 `force_new_project: true`)→ 读 package.json 的
 *    name 当项目名 → POST /projects 新建 → **写入 marker**
 *  - 续发:marker 存在 → POST /projects/{id}/versions
 *
 * 错误处理纪律:每种已知失败都有可执行的人话(下一步动作),避免 LLM 看到一堆 stack 不知道怎么转给用户。
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve as resolvePath } from 'node:path'

import type { Config } from '../config.js'
import { BackendError, request } from '../http.js'
import { logger } from '../logger.js'
import { readMarker, writeMarker } from '../project-marker.js'
import { zipDirectory, ZipError } from '../zip.js'
import { validateProjectDir } from './project-dir.js'
import type { ToolHandler, ToolResult } from './types.js'

interface PublishArgs {
  project_dir?: string
  dist_dir?: string
  force_new_project?: boolean
  project_name?: string
}

interface PublishResponse {
  projectId: number
  demoId: string
  publicUrl: string
  version: string
}

interface ProjectSummary {
  projectId: number
  name: string
  demoId: string
  publicUrl: string
  currentVersion: string | null
}

export const PUBLISH_TOOL = {
  name: 'dreamland_publish',
  description:
    'Publish a built frontend artifact (contents of dist_dir, default ./dist relative to ' +
    'project_dir) to DreamLand, returning a public URL. Trigger this when the user mentions ' +
    'DreamLand explicitly, OR when the workspace has a .dreamland/project.json marker and the ' +
    'user asks to push a new version.\n\n' +
    'First publish in a project_dir creates a new DreamLand project (name from project_name ' +
    'arg, or package.json, or directory basename) and writes .dreamland/project.json. ' +
    'Subsequent calls with the same project_dir append new versions; if the user wants a brand-new ' +
    'project (different name), pass force_new_project=true with project_name.',
  inputSchema: {
    type: 'object',
    properties: {
      project_dir: {
        type: 'string',
        description:
          'Absolute path to the user\'s project root (their open workspace folder). All other ' +
          'paths (dist_dir, .dreamland/project.json marker) are resolved relative to this. ' +
          'Required because the MCP server\'s own process.cwd() does NOT match the user\'s workspace.',
      },
      project_name: {
        type: 'string',
        description:
          'Display name for a new DreamLand project. Used only when creating a new project ' +
          '(no marker, OR force_new_project=true). Ignored on plain new-version publishes; in ' +
          'that case the result text will tell you it was ignored.',
      },
      dist_dir: {
        type: 'string',
        description: 'Directory to package. Absolute, or relative to project_dir. Default: ./dist',
      },
      force_new_project: {
        type: 'boolean',
        description:
          'Ignore the existing .dreamland/project.json link and create a brand-new project. ' +
          'Typically paired with project_name to set the new project\'s name. Default: false.',
      },
    },
    required: ['project_dir'],
    additionalProperties: false,
  },
} as const

export function makePublishHandler(config: Config): ToolHandler {
  return async (raw): Promise<ToolResult> => {
    const args = (raw ?? {}) as PublishArgs

    // project_dir 是必填,且必须是已存在的绝对路径。
    // 为什么不 fallback 到 process.cwd():MCP 客户端 spawn 的子进程 cwd 跟用户的 workspace
    // 不一致(常见是用户 home),fallback 会让"找不到 marker→ 误建新项目用 cwd 目录名当
    // 项目名"这种隐性 bug 神不知鬼不觉发生。强制 agent 显式传是更安全的契约。
    const baseDirErr = await validateProjectDir(args.project_dir)
    if (baseDirErr) return errorResult(baseDirErr)
    const baseDir = args.project_dir!.trim()

    const distDir = isAbsolute(args.dist_dir ?? '')
      ? (args.dist_dir as string)
      : resolvePath(baseDir, args.dist_dir ?? './dist')
    const forceNew = args.force_new_project === true
    const explicitName = (args.project_name ?? '').trim() || undefined

    // ① 决定走"新建项目"还是"已链接发新版"
    const marker = await readMarker(baseDir)
    const useExisting = marker !== null && !forceNew

    // ② 打 zip(单点失败 —— 早抛、不调后端)
    let zip
    try {
      zip = await zipDirectory(distDir)
    } catch (e) {
      if (e instanceof ZipError) return errorResult(e.message)
      throw e
    }
    logger.info('zip.built', { distDir, fileCount: zip.fileCount, sizeBytes: zip.sizeBytes })

    // ③ 上传
    if (useExisting && marker) {
      // marker 在 + 没 force_new → 续发;此时 project_name 没意义,显式回馈,不静默忽略。
      const warning =
        explicitName !== undefined
          ? `\n\n⚠ project_name "${explicitName}" was ignored because this directory is ` +
            `already linked to project "${marker.name}" (${marker.demoId}). ` +
            `To create a brand-new project, pass force_new_project=true together with project_name.`
          : ''
      return await publishNewVersion(
        config,
        baseDir,
        marker.demoId,
        zip.data,
        marker.name,
        warning,
      )
    }
    return await publishNewProject(config, baseDir, distDir, zip.data, explicitName)
  }
}

async function publishNewProject(
  config: Config,
  baseDir: string,
  distDir: string,
  zipBytes: Buffer,
  explicitName?: string,
): Promise<ToolResult> {
  const name = explicitName ?? (await resolveProjectName(baseDir))
  const form = makeMultipart(zipBytes, { name })

  let response: PublishResponse
  try {
    response = await request<PublishResponse>(config, '/projects', { method: 'POST', form })
  } catch (e) {
    return mapBackendError(e, { context: 'create new project' })
  }
  logger.info('publish.new', { projectId: response.projectId, version: response.version })

  let markerWarning = ''
  try {
    await writeMarker(baseDir, {
      demoId: response.demoId,
      name,
      createdAt: new Date().toISOString(),
    })
  } catch (e) {
    // 后端已发布成功;marker 写失败不回滚,只在结果里附警告
    markerWarning =
      `\n\n⚠ Failed to write .dreamland/project.json: ${(e as Error).message}\n` +
      `Future publishes from this directory will create a NEW project unless you create the file ` +
      `manually or run dreamland_link with demo_id="${response.demoId}".`
  }

  return okResult(
    `Created project "${name}" (${response.version}) on DreamLand.\n` +
      `Public URL: ${response.publicUrl}\n` +
      `Demo ID: ${response.demoId}` +
      markerWarning,
  )
}

async function publishNewVersion(
  config: Config,
  baseDir: string,
  demoId: string,
  zipBytes: Buffer,
  nameForDisplay: string,
  /** 可选追加文案(目前用于 project_name 被忽略的告示),拼在成功响应末尾 */
  warning = '',
): Promise<ToolResult> {
  const form = makeMultipart(zipBytes)

  let response: PublishResponse
  try {
    response = await request<PublishResponse>(
      config,
      `/projects/by-slug/${encodeURIComponent(demoId)}/versions`,
      { method: 'POST', form },
    )
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) {
      // marker 指向的项目不存在(被删 / 被改主)或不属于当前 token —— 给用户具体出路
      return errorResult(
        `Project "${demoId}" not found (linked in .dreamland/project.json). ` +
          `It may have been deleted, or your current API token belongs to a different account.\n\n` +
          `Next steps:\n` +
          `  • Delete .dreamland/ and run dreamland_publish again to create a fresh project, OR\n` +
          `  • Run dreamland_link with a valid demo_id, OR\n` +
          `  • Verify DREAMLAND_TOKEN points to the right account.`,
      )
    }
    return mapBackendError(e, { context: 'publish new version' })
  }
  logger.info('publish.version', { demoId, version: response.version })

  return okResult(
    `Published "${nameForDisplay}" ${response.version} to DreamLand.\n` +
      `Public URL: ${response.publicUrl}` +
      warning,
  )
}

/** 项目名优先级:package.json 的 name > 目录名兜底。 */
async function resolveProjectName(baseDir: string): Promise<string> {
  try {
    const raw = await readFile(resolvePath(baseDir, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { name?: unknown }
    if (typeof pkg.name === 'string' && pkg.name.trim()) {
      // 去 scope 前缀更适合做项目展示名(@org/foo → foo)
      const name = pkg.name.trim()
      const slash = name.lastIndexOf('/')
      return slash >= 0 ? name.slice(slash + 1) : name
    }
  } catch {
    // 没 package.json 也没事,落到目录名
  }
  const base = baseDir.split(/[/\\]/).pop() ?? 'demo'
  return base || 'demo'
}

function makeMultipart(zipBytes: Buffer, extraFields: Record<string, string> = {}): FormData {
  const form = new FormData()
  // backend 字段名约定:file(MultipartFile)+ name(项目名,仅首发用)。
  // 拷一份到独立 ArrayBuffer 是为绕 TS 对 Buffer.buffer 类型 ArrayBufferLike(可能 SharedArrayBuffer)
  // 跟 BlobPart 要求 ArrayBuffer 的不兼容;运行时没区别,几 MB zip 的拷贝开销忽略不计。
  const ab = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(ab).set(zipBytes)
  form.append('file', new Blob([ab], { type: 'application/zip' }), 'dist.zip')
  for (const [k, v] of Object.entries(extraFields)) {
    form.append(k, v)
  }
  return form
}

function mapBackendError(
  e: unknown,
  ctx: { context: string },
): ToolResult {
  if (!(e instanceof BackendError)) {
    return errorResult(`Unexpected error during ${ctx.context}: ${(e as Error).message}`)
  }
  if (e.status === 0) {
    return errorResult(`${ctx.context}: ${e.message}`)
  }
  if (e.status === 401) {
    return errorResult(
      `Authentication failed. Your DREAMLAND_TOKEN is invalid or has been reset. ` +
        `Generate a new token at <dashboard>/settings/api-token and update your agent's mcp.json env.`,
    )
  }
  return errorResult(`${ctx.context} failed (HTTP ${e.status} ${e.code}): ${e.message}`)
}

function okResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}
