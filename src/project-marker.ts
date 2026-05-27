/**
 * `.dreamland/project.json` —— 本地标记文件,跨 session / 跨设备记住"这个目录绑哪个 DreamLand 项目"。
 *
 * 协议见 tech/mcp-integration.md 4.6。要点:
 *  - 默认 check 进 git(跟 Vercel / Netlify 一致),让 team / 多设备 git pull 就继承绑定。
 *  - 内容不是凭证(project_id 即便被偷,backend 仍走 ownership 校验)。
 *  - 查找规则:**只在传入目录直接找**,不向上递归。monorepo 多 package 共一 root 标记有歧义,
 *    简单到"哪个目录跑就找哪个目录"。
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 协议自身版本号。加字段不破 ABI,减字段 / 改语义时升版本。 */
const CURRENT_SCHEMA_VERSION = 1

export interface ProjectMarker {
  schemaVersion: number
  projectId: number
  name: string
  createdAt: string
}

export class MarkerReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarkerReadError'
  }
}

export class MarkerWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'MarkerWriteError'
  }
}

/** 从 {@code cwd} 直接子目录 `.dreamland/project.json` 读;不存在或解析失败均返 null,**不抛**。 */
export async function readMarker(cwd: string): Promise<ProjectMarker | null> {
  const path = markerPath(cwd)
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new MarkerReadError(`Failed to read ${path}: ${(e as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new MarkerReadError(
      `${path} is not valid JSON: ${(e as Error).message}. Delete it to publish as a new project.`,
    )
  }

  if (!isMarkerShape(parsed)) {
    throw new MarkerReadError(
      `${path} does not look like a DreamLand marker. Expected { schemaVersion, projectId, name, createdAt }.`,
    )
  }
  if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
    // 客户端比 marker 老 —— 这是真实可能的(用户 npm 包没更新)。明确提示,**不静默忽略**。
    throw new MarkerReadError(
      `${path} was written by a newer @dreamland_dev/mcp (schemaVersion=${parsed.schemaVersion}). ` +
        `Upgrade the package to read this marker.`,
    )
  }
  return parsed
}

/**
 * 写入(覆盖)marker。
 *
 * 写失败不影响业务正确性(publish 已经成功),但要明确报告 —— 上层把它包成 warning 拼在 tool_result。
 */
export async function writeMarker(
  cwd: string,
  data: Omit<ProjectMarker, 'schemaVersion'>,
): Promise<void> {
  const path = markerPath(cwd)
  const payload: ProjectMarker = { schemaVersion: CURRENT_SCHEMA_VERSION, ...data }
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
  } catch (e) {
    throw new MarkerWriteError(`Failed to write ${path}: ${(e as Error).message}`, e)
  }
}

/** dreamland_link 用 —— 显式重新绑定。 */
export async function removeMarker(cwd: string): Promise<void> {
  const path = markerPath(cwd)
  try {
    await unlink(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new MarkerWriteError(`Failed to remove ${path}: ${(e as Error).message}`, e)
  }
}

export function markerPath(cwd: string): string {
  return join(cwd, '.dreamland', 'project.json')
}

function isMarkerShape(v: unknown): v is ProjectMarker {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.schemaVersion === 'number' &&
    typeof o.projectId === 'number' &&
    typeof o.name === 'string' &&
    typeof o.createdAt === 'string'
  )
}
