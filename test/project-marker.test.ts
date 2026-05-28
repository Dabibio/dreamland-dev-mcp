import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  MarkerReadError,
  markerPath,
  readMarker,
  removeMarker,
  writeMarker,
} from '../src/project-marker.js'
import { cleanup, makeTempDir, writeAt } from './helpers.js'

describe('project-marker', () => {
  let baseDir: string
  beforeEach(async () => {
    baseDir = await makeTempDir()
  })
  afterEach(async () => {
    await cleanup(baseDir)
  })

  describe('readMarker', () => {
    it('returns null when no .dreamland directory', async () => {
      expect(await readMarker(baseDir)).toBeNull()
    })

    it('parses valid v2 marker', async () => {
      await writeAt(
        baseDir,
        '.dreamland/project.json',
        JSON.stringify({
          schemaVersion: 2,
          demoId: 'my-app-a3b9c7',
          name: 'My App',
          createdAt: '2026-05-28T00:00:00.000Z',
        }),
      )
      const m = await readMarker(baseDir)
      expect(m).toEqual({
        schemaVersion: 2,
        demoId: 'my-app-a3b9c7',
        name: 'My App',
        createdAt: '2026-05-28T00:00:00.000Z',
      })
    })

    it('throws on malformed JSON with actionable message', async () => {
      await writeAt(baseDir, '.dreamland/project.json', '{not-json')
      await expect(readMarker(baseDir)).rejects.toThrow(MarkerReadError)
      await expect(readMarker(baseDir)).rejects.toThrow(/Delete it/)
    })

    it('throws on shape mismatch', async () => {
      await writeAt(baseDir, '.dreamland/project.json', JSON.stringify({ foo: 'bar' }))
      await expect(readMarker(baseDir)).rejects.toThrow(/does not look like/)
    })

    it('throws on newer schemaVersion (client is older)', async () => {
      await writeAt(
        baseDir,
        '.dreamland/project.json',
        JSON.stringify({
          schemaVersion: 99,
          demoId: 'x-a3b9c7',
          name: 'X',
          createdAt: '2026-05-28T00:00:00.000Z',
        }),
      )
      await expect(readMarker(baseDir)).rejects.toThrow(/Upgrade the package/)
    })

    it('rejects v1 (projectId-based) marker with clear migration message', async () => {
      // 老协议 v1 不再支持(dev 期约定,见 tech/mcp-integration.md 议题 1)
      await writeAt(
        baseDir,
        '.dreamland/project.json',
        JSON.stringify({
          schemaVersion: 1,
          projectId: 1,
          name: 'Home Money',
          createdAt: '2026-05-27T16:04:22.590Z',
        }),
      )
      await expect(readMarker(baseDir)).rejects.toThrow(/v1 format/)
      await expect(readMarker(baseDir)).rejects.toThrow(/Delete the \.dreamland\/ directory/)
    })
  })

  describe('writeMarker', () => {
    it('creates .dreamland directory and writes v2 JSON file', async () => {
      await writeMarker(baseDir, {
        demoId: 'foo-a3b9c7',
        name: 'foo',
        createdAt: '2026-05-28T00:00:00.000Z',
      })
      const raw = await readFile(join(baseDir, '.dreamland', 'project.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      expect(parsed).toEqual({
        schemaVersion: 2,
        demoId: 'foo-a3b9c7',
        name: 'foo',
        createdAt: '2026-05-28T00:00:00.000Z',
      })
    })

    it('overwrites an existing marker', async () => {
      await writeMarker(baseDir, {
        demoId: 'a-xxxxxx',
        name: 'A',
        createdAt: '2026-01-01T00:00:00Z',
      })
      await writeMarker(baseDir, {
        demoId: 'b-yyyyyy',
        name: 'B',
        createdAt: '2026-02-01T00:00:00Z',
      })
      const m = await readMarker(baseDir)
      expect(m?.demoId).toBe('b-yyyyyy')
      expect(m?.name).toBe('B')
    })
  })

  describe('removeMarker', () => {
    it('removes existing marker', async () => {
      await writeMarker(baseDir, {
        demoId: 'a-xxxxxx',
        name: 'A',
        createdAt: '2026-01-01T00:00:00Z',
      })
      await removeMarker(baseDir)
      expect(await readMarker(baseDir)).toBeNull()
    })

    it('is a no-op when marker does not exist', async () => {
      await expect(removeMarker(baseDir)).resolves.toBeUndefined()
    })
  })

  describe('markerPath', () => {
    it('returns baseDir/.dreamland/project.json', () => {
      expect(markerPath('/tmp/foo')).toBe('/tmp/foo/.dreamland/project.json')
    })
  })
})
