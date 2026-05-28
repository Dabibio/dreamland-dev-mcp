/**
 * 把一个目录打成 zip(in memory)—— archiver 流式,大目录不爆内存。
 *
 * 设计纪律:
 *  - 不进入 dotfiles / node_modules —— 防止用户的 ./dist 在配 outDir 时不小心带进去整个项目。
 *    具体名单见 EXCLUDED;白名单更安全但 dist 内容用户随意,不约束生成结构。
 *  - 拒空目录:zip 大小 == 0 通常是配错了 dist_dir,提前抛 ZipError 比传到后端再 400 友好。
 *  - 路径用 forward slash,跨平台一致。
 */

import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'

import archiver from 'archiver'

/**
 * 顶层名匹配即跳过(不区分大小写)。dist/ 里基本不会出现这些,但用户传错路径时是常见误打入项。
 *
 * 注:列表全部存小写,跟下面 `item.name.toLowerCase()` 的比较侧对齐。
 */
const EXCLUDED = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.ds_store',
  '.idea',
  '.vscode',
])

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/** 打包结果。fileCount 用于日志,sizeBytes 用于上传前的边界判断 / 日志。 */
export interface ZipResult {
  data: Buffer
  fileCount: number
  sizeBytes: number
}

/**
 * 把 {@code rootDir} 里所有(过滤后)文件压成一个 zip,在内存里返回 Buffer。
 *
 * @throws ZipError dist 不存在 / 非目录 / 没有可打包内容
 */
export async function zipDirectory(rootDir: string): Promise<ZipResult> {
  let rootStat
  try {
    rootStat = await stat(rootDir)
  } catch {
    throw new ZipError(
      `Build output not found at "${rootDir}". Run your build first, or pass a different dist_dir.`,
    )
  }
  if (!rootStat.isDirectory()) {
    throw new ZipError(`"${rootDir}" is not a directory.`)
  }

  const entries = await collectFiles(rootDir, rootDir)
  if (entries.length === 0) {
    throw new ZipError(`"${rootDir}" contains no files to package.`)
  }

  const archive = archiver('zip', { zlib: { level: 6 } })
  const chunks: Buffer[] = []

  archive.on('data', (chunk: Buffer) => chunks.push(chunk))

  for (const entry of entries) {
    archive.append(createReadStream(entry.absolutePath), { name: entry.archivePath })
  }

  await new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve())
    archive.on('error', (err) => reject(new ZipError(`Failed to build zip: ${err.message}`)))
    archive.on('warning', (err) => {
      // 通常是符号链接 / 文件 stat 异常,记一笔但不打断
      // 这里有意不引 logger 避免循环依赖(zip → logger → http... 跨层耦合),用 stderr 直写
      process.stderr.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'zip.warning',
          message: err.message,
        }) + '\n',
      )
    })
    archive.finalize().catch(reject)
  })

  const data = Buffer.concat(chunks)
  return { data, fileCount: entries.length, sizeBytes: data.length }
}

interface FileEntry {
  absolutePath: string
  archivePath: string // zip 内部的路径,POSIX 分隔符
}

async function collectFiles(root: string, current: string): Promise<FileEntry[]> {
  const items = await readdir(current, { withFileTypes: true })
  const out: FileEntry[] = []
  for (const item of items) {
    if (EXCLUDED.has(item.name.toLowerCase())) continue
    const abs = join(current, item.name)
    if (item.isDirectory()) {
      out.push(...(await collectFiles(root, abs)))
    } else if (item.isFile()) {
      const rel = relative(root, abs).split(sep).join(posix.sep)
      out.push({ absolutePath: abs, archivePath: rel })
    }
    // 符号链接 / 设备文件等显式忽略,避免追循环 / 上传无意义内容
  }
  return out
}
