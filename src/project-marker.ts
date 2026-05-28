/**
 * `.dreamland/project.json` —— 本地标记文件,跨 session / 跨设备记住"这个目录绑哪个 DreamLand 项目"。
 *
 * 协议见 tech/mcp-integration.md 4.6 + 议题 1。要点:
 *  - 默认 check 进 git(跟 Vercel / Netlify 一致),让 team / 多设备 git pull 就继承绑定。
 *  - 内容不是凭证(demoId 即便被偷,backend 仍走 ownership 校验)。
 *  - 查找规则:**只在传入目录直接找**,不向上递归。monorepo 多 package 共一 root 标记有歧义,
 *    简单到"哪个目录跑就找哪个目录"。
 *
 * schemaVersion 历史:
 *  - v1(0.1.0 ~ 0.5.x):字段含 `projectId`(DB 主键)。**v0.6.0 起客户端不再支持读 v1**,
 *    告诉用户删 `.dreamland/` 重新 link 即可,无需迁移代码(dev 期约定无兼容)。
 *  - v2(0.6.0+):字段含 `demoId`(不可枚举的业务标识,backend 同步支持 `/projects/by-slug/{demoId}` 路径)。
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 协议自身版本号。加字段不破 ABI,减字段 / 改语义时升版本。 */
const CURRENT_SCHEMA_VERSION = 2

export interface ProjectMarker {
  schemaVersion: number
  demoId: string
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

/** 从 {@code cwd} 直接子目录 `.dreamland/project.json` 读;不存在返 null,解析 / 形态错误抛 MarkerReadError。 */
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

  if (typeof parsed !== 'object' || parsed === null) {
    throw new MarkerReadError(`${path} is not an object.`)
  }
  const o = parsed as Record<string, unknown>

  // v1 老 marker(含 projectId,无 demoId)—— dev 期约定不兼容,明确指引用户重新 link
  if (typeof o.projectId === 'number' && o.demoId === undefined) {
    throw new MarkerReadError(
      `${path} is in the v1 format (projectId-based) which is no longer supported. ` +
        `Delete the .dreamland/ directory and run dreamland_link with demo_id to bind again, ` +
        `or just dreamland_publish to create a new project.`,
    )
  }

  if (!isMarkerShape(o)) {
    throw new MarkerReadError(
      `${path} does not look like a DreamLand marker. Expected { schemaVersion, demoId, name, createdAt }.`,
    )
  }
  const marker = o as unknown as ProjectMarker
  if (marker.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new MarkerReadError(
      `${path} was written by a newer @dreamland_dev/mcp (schemaVersion=${marker.schemaVersion}). ` +
        `Upgrade the package to read this marker.`,
    )
  }
  return marker
}

/**
 * 写入(覆盖)marker。写失败不影响业务正确性(publish 已成功),但要明确报告 —— 上层把它包成
 * warning 拼在 tool_result。
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

function isMarkerShape(o: Record<string, unknown>): boolean {
  return (
    typeof o.schemaVersion === 'number' &&
    typeof o.demoId === 'string' &&
    typeof o.name === 'string' &&
    typeof o.createdAt === 'string'
  )
}
