/**
 * dreamland_list_projects —— 列出当前用户在 DreamLand 上的所有项目。
 *
 * 设计纪律(tech/mcp-integration.md F2):一次性返回 agent 自筛所需全部字段(id / name /
 * current_version / public_url),**不开"按 id 查"等细颗粒接口**;agent 在 LLM 头脑里筛即可。
 */

import type { Config } from '../config.js'
import { BackendError, request } from '../http.js'
import type { ToolHandler, ToolResult } from './types.js'

interface ProjectSummary {
  projectId: number
  name: string
  demoId: string
  publicUrl: string
  currentVersion: string | null
}

export const LIST_PROJECTS_TOOL = {
  name: 'dreamland_list_projects',
  description:
    'List the user\'s DreamLand projects (id, name, current version, public URL). Use when the ' +
    'user asks what they have on DreamLand, asks for the public URL of a specific DreamLand ' +
    'project, or before dreamland_link to find the right project_id.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
} as const

export function makeListProjectsHandler(config: Config): ToolHandler {
  return async (): Promise<ToolResult> => {
    let projects: ProjectSummary[]
    try {
      projects = await request<ProjectSummary[]>(config, '/projects')
    } catch (e) {
      if (e instanceof BackendError && e.status === 401) {
        return {
          content: [
            {
              type: 'text',
              text:
                'Authentication failed. Your DREAMLAND_TOKEN is invalid or has been reset. ' +
                'Generate a new token at <dashboard>/settings/api-token and update your agent config.',
            },
          ],
          isError: true,
        }
      }
      const msg = e instanceof Error ? e.message : String(e)
      return {
        content: [{ type: 'text', text: `Failed to list projects: ${msg}` }],
        isError: true,
      }
    }

    if (projects.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'You have no projects on DreamLand yet. Run dreamland_publish to create one.',
          },
        ],
      }
    }

    // 给 LLM 一份结构化 JSON 列表 —— LLM 解析比读"v1 · alice…"这种自由文本更稳。
    const json = JSON.stringify(projects, null, 2)
    return {
      content: [
        {
          type: 'text',
          text: `Found ${projects.length} project(s) on DreamLand:\n\n${json}`,
        },
      ],
    }
  }
}
