import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makePublishHandler } from '../src/tools/publish.js'
import { writeMarker, readMarker } from '../src/project-marker.js'
import {
  cleanup,
  installFetchStub,
  makeTempDir,
  whenRequest,
  writeAt,
} from './helpers.js'

const baseConfig = {
  token: 'dl_live_testtoken',
  apiBase: 'http://backend.test',
}

const publishOkBody = {
  projectId: 99,
  demoId: 'foo-a1b2c3',
  publicUrl: 'https://foo-a1b2c3.example.com',
  version: 'v1',
}

describe('dreamland_publish', () => {
  let projectDir: string
  let stub: ReturnType<typeof installFetchStub>
  beforeEach(async () => {
    projectDir = await makeTempDir()
    await writeAt(projectDir, 'dist/index.html', '<h1>hi</h1>')
  })
  afterEach(async () => {
    stub?.restore()
    await cleanup(projectDir)
  })

  // ============================================================
  // 创建新项目场景
  // ============================================================

  it('uses project_name when explicitly provided (new project)', async () => {
    stub = installFetchStub(
      whenRequest({ method: 'POST', pathEndsWith: '/projects' }, { status: 200, body: publishOkBody }),
    )
    const handler = makePublishHandler(baseConfig)
    const result = await handler({ project_dir: projectDir, project_name: 'My Explicit Name' })

    expect(result.isError).toBeFalsy()
    expect(stub.calls).toHaveLength(1)
    const call = stub.calls[0]
    expect(call.url).toBe('http://backend.test/projects')
    expect(call.headers.authorization).toBe('Bearer dl_live_testtoken')
    expect((call.body as Record<string, unknown>).name).toBe('My Explicit Name')

    // marker 写入用的也是显式名字
    const marker = await readMarker(projectDir)
    expect(marker?.name).toBe('My Explicit Name')
    expect(marker?.projectId).toBe(99)
  })

  it('falls back to package.json name when project_name absent', async () => {
    await writeAt(
      projectDir,
      'package.json',
      JSON.stringify({ name: '@some-scope/pkg-name', version: '0.0.1' }),
    )
    stub = installFetchStub(
      whenRequest({ method: 'POST', pathEndsWith: '/projects' }, { status: 200, body: publishOkBody }),
    )
    const result = await makePublishHandler(baseConfig)({ project_dir: projectDir })

    expect(result.isError).toBeFalsy()
    // scope 部分去掉,只留 pkg-name
    expect((stub.calls[0].body as Record<string, unknown>).name).toBe('pkg-name')
  })

  it('falls back to directory basename when no package.json and no project_name', async () => {
    stub = installFetchStub(
      whenRequest({ method: 'POST', pathEndsWith: '/projects' }, { status: 200, body: publishOkBody }),
    )
    const result = await makePublishHandler(baseConfig)({ project_dir: projectDir })

    expect(result.isError).toBeFalsy()
    const name = (stub.calls[0].body as Record<string, unknown>).name as string
    // baseName 应是 makeTempDir 生成的随机串(以 dlmcp-test- 开头)
    expect(name).toMatch(/^dlmcp-test-/)
  })

  // ============================================================
  // 续发场景
  // ============================================================

  it('appends a new version when marker exists and force_new_project is false', async () => {
    await writeMarker(projectDir, {
      projectId: 7,
      name: 'Linked Name',
      createdAt: '2026-05-28T00:00:00.000Z',
    })
    stub = installFetchStub(
      whenRequest(
        { method: 'POST', pathEndsWith: '/projects/7/versions' },
        { status: 200, body: { ...publishOkBody, projectId: 7, version: 'v3' } },
      ),
    )
    const result = await makePublishHandler(baseConfig)({ project_dir: projectDir })

    expect(result.isError).toBeFalsy()
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0].url).toContain('/projects/7/versions')
    // 续发不传 name 字段
    expect((stub.calls[0].body as Record<string, unknown>).name).toBeUndefined()

    // marker 不变(续发不写)
    const marker = await readMarker(projectDir)
    expect(marker?.projectId).toBe(7)
    expect(marker?.name).toBe('Linked Name')
  })

  it('warns if project_name is supplied alongside existing marker without force_new_project', async () => {
    await writeMarker(projectDir, {
      projectId: 7,
      name: 'Old',
      createdAt: '2026-05-28T00:00:00.000Z',
    })
    stub = installFetchStub(
      whenRequest(
        { method: 'POST', pathEndsWith: '/projects/7/versions' },
        { status: 200, body: { ...publishOkBody, projectId: 7, version: 'v2' } },
      ),
    )
    const result = await makePublishHandler(baseConfig)({
      project_dir: projectDir,
      project_name: 'ignored',
    })

    expect(result.isError).toBeFalsy()
    // 仍走续发路径(版本接口)
    expect(stub.calls[0].url).toContain('/projects/7/versions')
    // tool_result 文本明确告诉 LLM/agent 这个 name 被忽略了
    const text = result.content[0].text
    expect(text).toMatch(/ignored/i)
    expect(text).toMatch(/force_new_project/i)
  })

  it('creates new project with explicit project_name when force_new_project=true overrides marker', async () => {
    await writeMarker(projectDir, {
      projectId: 7,
      name: 'Old Name',
      createdAt: '2026-05-28T00:00:00.000Z',
    })
    stub = installFetchStub(
      whenRequest(
        { method: 'POST', pathEndsWith: '/projects' },
        { status: 200, body: { ...publishOkBody, projectId: 88, version: 'v1' } },
      ),
    )
    const result = await makePublishHandler(baseConfig)({
      project_dir: projectDir,
      project_name: 'Fresh Fork',
      force_new_project: true,
    })

    expect(result.isError).toBeFalsy()
    expect(stub.calls[0].url).toBe('http://backend.test/projects')
    expect((stub.calls[0].body as Record<string, unknown>).name).toBe('Fresh Fork')

    // marker 覆盖到新项目
    const marker = await readMarker(projectDir)
    expect(marker?.projectId).toBe(88)
    expect(marker?.name).toBe('Fresh Fork')
  })

  // ============================================================
  // 错误路径
  // ============================================================

  it('returns actionable error when backend returns 401', async () => {
    stub = installFetchStub(
      whenRequest(
        { method: 'POST', pathEndsWith: '/projects' },
        { status: 401, body: { code: 'AUTH_FAILED', message: 'Authentication failed' } },
      ),
    )
    const result = await makePublishHandler(baseConfig)({ project_dir: projectDir })

    expect(result.isError).toBe(true)
    const text = result.content[0].text
    expect(text).toMatch(/Authentication failed|invalid|reset/i)
    expect(text).toMatch(/settings\/api-token/)
  })

  it('returns actionable error when continuing-version target 404s', async () => {
    await writeMarker(projectDir, {
      projectId: 7,
      name: 'Gone',
      createdAt: '2026-05-28T00:00:00.000Z',
    })
    stub = installFetchStub(
      whenRequest(
        { method: 'POST', pathEndsWith: '/projects/7/versions' },
        { status: 404, body: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } },
      ),
    )
    const result = await makePublishHandler(baseConfig)({ project_dir: projectDir })

    expect(result.isError).toBe(true)
    const text = result.content[0].text
    expect(text).toMatch(/not found/i)
    expect(text).toMatch(/dreamland_link|Delete \.dreamland/i)
  })

  it('rejects calls without project_dir', async () => {
    stub = installFetchStub() // 不应该有任何请求
    const result = await makePublishHandler(baseConfig)({})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/required/i)
    expect(stub.calls).toHaveLength(0)
  })
})
