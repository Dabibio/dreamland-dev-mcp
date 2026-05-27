/**
 * `project_dir` 入参校验 —— publish / link 共用。
 *
 * 工具调用方传过来的 `project_dir` 必须满足:
 *  - 是字符串、非空
 *  - 绝对路径(相对路径会被 cwd 默默"修正",让 bug 隐性传染)
 *  - 指向一个真实存在的目录(防止 agent 瞎填一个不存在的 path,到 publish 那一步才报错)
 *
 * 返回 null 表示合法;返回 string 表示"请把这句话原样回给用户作为 error"。
 */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export async function validateProjectDir(value: unknown): Promise<string | null> {
  if (typeof value !== 'string' || !value.trim()) {
    return (
      'project_dir is required. Pass the absolute path to the user\'s open workspace folder, ' +
      'e.g. /Users/you/code/my-app.'
    )
  }
  const path = value.trim()
  if (!isAbsolute(path)) {
    return (
      `project_dir must be an absolute path (got "${path}"). ` +
      `Pass the full workspace path, e.g. /Users/you/code/my-app.`
    )
  }
  try {
    const s = await stat(path)
    if (!s.isDirectory()) {
      return `project_dir "${path}" exists but is not a directory.`
    }
  } catch {
    return `project_dir "${path}" does not exist.`
  }
  return null
}
