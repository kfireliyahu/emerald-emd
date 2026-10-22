// The one way a test makes a folder on disk (M28 F19). Every folder made here
// is removed when its test file finishes — `setup.ts` registers the `afterAll`
// — so a test never has to remember to clean up, and `tempDir.test.ts` fails
// if a test file reaches for `mkdtemp` itself. Before this existed the suite
// left ~50,000 `emerald-*` folders (56 GB) in the system temp and filled C:.
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const made = new Set<string>()

/** A fresh, empty folder under the system temp, removed after this test file. */
export async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  made.add(directory)
  return directory
}

/** `tempDir`, for the few places a test cannot await. */
export function tempDirSync(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  made.add(directory)
  return directory
}

/**
 * A unique folder's path, removed with the rest, that is **not made** until
 * something writes into it (M51 F6). A file whose every test is skipped runs no
 * `afterAll`, so a folder made for it up front outlived it: the privacy test,
 * skipped wherever its denylist is missing, left one on the first CI run.
 */
export function tempPathSync(prefix: string): string {
  const path = join(tmpdir(), prefix + randomBytes(6).toString('hex'))
  made.add(path)
  return path
}

/** Removes every folder made so far. `setup.ts` calls this after each file. */
export async function removeTempDirs(): Promise<void> {
  const directories = [...made]
  made.clear()
  // maxRetries: Windows can hold a handle a moment after the test lets go.
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5 })),
  )
}
