// M28 F19: the suite filled C: with ~50,000 `emerald-*` folders because every
// test that made one left it behind. Two halves keep that from coming back:
// a test makes folders only through `tempDir`, which removes them after the
// file (`setup.ts`), and `globalSetup.ts` fails the run if its own temp folder
// is not empty at the end. This file proves the first half holds everywhere.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeTempDirs, tempDir, tempDirSync } from './tempDir'

const ROOT = join(__dirname, '..', '..')

function testFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return testFiles(path)
    return name.endsWith('.ts') ? [path] : []
  })
}

describe('test folders', () => {
  it('are removed once the file is done with them', async () => {
    const one = await tempDir('emerald-tempdir-')
    const two = tempDirSync('emerald-tempdir-')
    expect(existsSync(one) && existsSync(two)).toBe(true)
    await removeTempDirs()
    expect(existsSync(one) || existsSync(two)).toBe(false)
  })

  it('live under the run’s own temp folder, which globalSetup checks is left empty', async () => {
    const directory = await tempDir('emerald-tempdir-')
    expect(directory).toContain('emerald-test-run-')
  })

  it('are made with tempDir and nothing else, in every test file', () => {
    const offenders = [join(ROOT, 'src'), join(ROOT, 'electron')]
      .flatMap(testFiles)
      .filter((path) => path.endsWith(".test.ts") && !path.startsWith(__dirname))
      .filter((path) => /\bmkdtemp(Sync)?\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path))
    expect(offenders).toEqual([])
  })
})
