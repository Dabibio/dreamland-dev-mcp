import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { validateProjectDir } from '../src/tools/project-dir.js'
import { cleanup, makeTempDir } from './helpers.js'

describe('validateProjectDir', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTempDir()
  })
  afterEach(async () => {
    await cleanup(dir)
  })

  it('rejects missing / undefined', async () => {
    expect(await validateProjectDir(undefined)).toMatch(/required/)
    expect(await validateProjectDir(null)).toMatch(/required/)
    expect(await validateProjectDir('')).toMatch(/required/)
    expect(await validateProjectDir('   ')).toMatch(/required/)
  })

  it('rejects non-string types', async () => {
    expect(await validateProjectDir(42)).toMatch(/required/)
    expect(await validateProjectDir({})).toMatch(/required/)
  })

  it('rejects relative paths', async () => {
    expect(await validateProjectDir('./foo')).toMatch(/absolute/)
    expect(await validateProjectDir('foo/bar')).toMatch(/absolute/)
  })

  it('rejects non-existent absolute path', async () => {
    expect(await validateProjectDir('/this/path/does/not/exist/xyz')).toMatch(/does not exist/)
  })

  it('rejects path that is a file, not a directory', async () => {
    const file = join(dir, 'a.txt')
    await writeFile(file, 'hello', 'utf-8')
    expect(await validateProjectDir(file)).toMatch(/not a directory/)
  })

  it('accepts a real existing directory', async () => {
    expect(await validateProjectDir(dir)).toBeNull()
  })
})
