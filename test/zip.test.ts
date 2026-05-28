import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { zipDirectory, ZipError } from '../src/zip.js'
import { cleanup, makeTempDir, writeAt } from './helpers.js'

describe('zipDirectory', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTempDir()
  })
  afterEach(async () => {
    await cleanup(dir)
  })

  it('throws ZipError when directory does not exist', async () => {
    await expect(zipDirectory(join(dir, 'nope'))).rejects.toThrow(ZipError)
    await expect(zipDirectory(join(dir, 'nope'))).rejects.toThrow(/not found/)
  })

  it('throws ZipError when target is a file, not directory', async () => {
    const f = join(dir, 'a.txt')
    await writeFile(f, 'x', 'utf-8')
    await expect(zipDirectory(f)).rejects.toThrow(/not a directory/)
  })

  it('throws ZipError when directory is empty', async () => {
    await expect(zipDirectory(dir)).rejects.toThrow(/no files/)
  })

  it('packages files,recording correct count and non-empty size', async () => {
    await writeAt(dir, 'index.html', '<h1>hi</h1>')
    await writeAt(dir, 'assets/foo.css', 'body{color:red}')
    await writeAt(dir, 'sub/bar.txt', 'hello')

    const result = await zipDirectory(dir)
    expect(result.fileCount).toBe(3)
    expect(result.sizeBytes).toBeGreaterThan(0)
    // zip 文件头(本地 file header signature)是 50 4B 03 04
    expect(result.data[0]).toBe(0x50)
    expect(result.data[1]).toBe(0x4b)
    expect(result.data[2]).toBe(0x03)
    expect(result.data[3]).toBe(0x04)
  })

  it('skips excluded directories (node_modules, .git, .DS_Store)', async () => {
    await writeAt(dir, 'index.html', 'x')
    await writeAt(dir, 'node_modules/some-pkg/dist.js', 'noise')
    await writeAt(dir, '.git/config', '[core]')
    await writeAt(dir, '.DS_Store', 'binary')

    const result = await zipDirectory(dir)
    expect(result.fileCount).toBe(1) // 只剩 index.html
  })
})
