/**
 * dreamland_link —— 把当前目录(`.dreamland/project.json`)显式绑到一个已有项目。
 *
 * 使用场景:
 *  - 换电脑了,本机没有 marker,但项目早在 DreamLand 上
 *  - 误删 .dreamland/ 之后想恢复关联
 *  - 想把本目录指向一个已经存在的项目(不发新版,仅建立映射)
 *
 * 实现纪律:
 *  - **必须先 GET /projects/{id} 验证项目存在且属当前用户** —— 不验证就写,等于把任意 id 塞进
 *    marker,下次 publish 才发现 404,体验差;另外这也防止用户输错 id 把自己卷死。
 *  - 走 backend ownership 校验,跟 N2 一致(失败一律 404 处理,不暴露存在性)。
 */

import type { Config } from '../config.js'
import { BackendError, request } from '../http.js'
import { logger } from '../logger.js'
import { writeMarker } from '../project-marker.js'
import type { ToolHandler, ToolResult } from './types.js'

interface ProjectSummary {
  projectId: number
  name: string
  demoId: string
  publicUrl: string
  currentVersion: string | null
}

export const LINK_TOOL = {
  name: 'dreamland_link',
  description:
    'Bind the current working directory to an existing DreamLand project by writing ' +
    '.dreamland/project.json. Use this when switching machines or recovering a lost marker. ' +
    'The project must exist on DreamLand and belong to you.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'number',
        description: 'Numeric project id to link to. Get it from dreamland_list_projects.',
      },
    },
    required: ['project_id'],
    additionalProperties: false,
  },
} as const

export function makeLinkHandler(config: Config): ToolHandler {
  return async (raw): Promise<ToolResult> => {
    const args = raw as { project_id?: unknown } | undefined
    const projectId = Number(args?.project_id)
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'project_id must be a positive integer. Use dreamland_list_projects to find it.',
          },
        ],
        isError: true,
      }
    }

    let project: ProjectSummary
    try {
      project = await request<ProjectSummary>(config, `/projects/${projectId}`)
    } catch (e) {
      if (e instanceof BackendError && e.status === 404) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Project ${projectId} not found or not owned by your account. ` +
                `Run dreamland_list_projects to see your projects.`,
            },
          ],
          isError: true,
        }
      }
      if (e instanceof BackendError && e.status === 401) {
        return {
          content: [
            {
              type: 'text',
              text:
                'Authentication failed. Your DREAMLAND_TOKEN is invalid or has been reset. ' +
                'Generate a new token at <dashboard>/settings/api-token.',
            },
          ],
          isError: true,
        }
      }
      const msg = e instanceof Error ? e.message : String(e)
      return {
        content: [{ type: 'text', text: `Failed to verify project: ${msg}` }],
        isError: true,
      }
    }

    const cwd = process.cwd()
    try {
      await writeMarker(cwd, {
        projectId: project.projectId,
        name: project.name,
        createdAt: new Date().toISOString(),
      })
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text:
              `Verified project but failed to write marker: ${(e as Error).message}\n` +
              `Create .dreamland/project.json manually with: ` +
              `{"schemaVersion":1,"projectId":${project.projectId},"name":${JSON.stringify(project.name)},"createdAt":"${new Date().toISOString()}"}`,
          },
        ],
        isError: true,
      }
    }
    logger.info('link.written', { projectId: project.projectId, cwd })

    return {
      content: [
        {
          type: 'text',
          text:
            `Linked this directory to "${project.name}" (project ${project.projectId}).\n` +
            `Public URL: ${project.publicUrl}\n` +
            `Future dreamland_publish calls from this directory will append a new version.`,
        },
      ],
    }
  }
}
