/**
 * dreamland_link —— 把当前目录(`.dreamland/project.json`)显式绑到一个已有项目。
 *
 * 使用场景:
 *  - 换电脑了,本机没有 marker,但项目早在 DreamLand 上
 *  - 误删 .dreamland/ 之后想恢复关联
 *  - 想把本目录指向一个已经存在的项目(不发新版,仅建立映射)
 *
 * 实现纪律:
 *  - **必须先 GET /projects/by-slug/{demoId} 验证项目存在且属当前用户** —— 不验证就写,等于把任意
 *    demo_id 塞进 marker,下次 publish 才发现 404,体验差;另外这也防止用户输错值卷死自己。
 *  - 走 backend ownership 校验,跟 N2 一致(失败一律 404 处理,不暴露存在性)。
 */

import type { Config } from '../config.js'
import { BackendError, request } from '../http.js'
import { logger } from '../logger.js'
import { writeMarker } from '../project-marker.js'
import { validateProjectDir } from './project-dir.js'
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
    'Bind a workspace directory to an existing DreamLand project by writing ' +
    '.dreamland/project.json. Use when the marker is missing or lost (switched machine, repo ' +
    'cloned fresh), or when the user wants this folder to point at an existing DreamLand ' +
    'project instead of creating a new one. The project must belong to the authenticated user.',
  inputSchema: {
    type: 'object',
    properties: {
      demo_id: {
        type: 'string',
        description:
          'The project\'s demo_id (a slug like "home-money-a3b9c7" — get it from ' +
          'dreamland_list_projects). This is the same value that appears in the project\'s ' +
          'public URL subdomain.',
      },
      project_dir: {
        type: 'string',
        description:
          'Absolute path to the user\'s project root (their open workspace folder). The ' +
          '.dreamland/project.json marker is written inside this directory. Required because ' +
          'the MCP server\'s own process.cwd() does NOT match the user\'s workspace.',
      },
    },
    required: ['demo_id', 'project_dir'],
    additionalProperties: false,
  },
} as const

export function makeLinkHandler(config: Config): ToolHandler {
  return async (raw): Promise<ToolResult> => {
    const args = raw as { demo_id?: unknown; project_dir?: unknown } | undefined
    const demoId = typeof args?.demo_id === 'string' ? args.demo_id.trim() : ''
    if (!demoId) {
      return {
        content: [
          {
            type: 'text',
            text: 'demo_id is required. Use dreamland_list_projects to find your project\'s demo_id.',
          },
        ],
        isError: true,
      }
    }

    // 同 publish:project_dir 必填 + 绝对路径 + 真实目录。
    const baseDirErr = await validateProjectDir(args?.project_dir)
    if (baseDirErr) {
      return { content: [{ type: 'text', text: baseDirErr }], isError: true }
    }
    const baseDir = (args!.project_dir as string).trim()

    let project: ProjectSummary
    try {
      project = await request<ProjectSummary>(
        config,
        `/projects/by-slug/${encodeURIComponent(demoId)}`,
      )
    } catch (e) {
      if (e instanceof BackendError && e.status === 404) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Project "${demoId}" not found or not owned by your account. ` +
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

    try {
      await writeMarker(baseDir, {
        demoId: project.demoId,
        name: project.name,
        createdAt: new Date().toISOString(),
      })
    } catch (e) {
      const now = new Date().toISOString()
      return {
        content: [
          {
            type: 'text',
            text:
              `Verified project but failed to write marker: ${(e as Error).message}\n` +
              `Create .dreamland/project.json manually with: ` +
              `{"schemaVersion":2,"demoId":${JSON.stringify(project.demoId)},"name":${JSON.stringify(project.name)},"createdAt":"${now}"}`,
          },
        ],
        isError: true,
      }
    }
    logger.info('link.written', { demoId: project.demoId, baseDir })

    return {
      content: [
        {
          type: 'text',
          text:
            `Linked "${baseDir}" to "${project.name}" (${project.demoId}).\n` +
            `Public URL: ${project.publicUrl}\n` +
            `Future dreamland_publish calls with project_dir="${baseDir}" will append new versions.`,
        },
      ],
    }
  }
}
