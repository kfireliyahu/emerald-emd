// Runs once per `vitest` run, before any worker starts (vite.config.ts
// `globalSetup`). It gives the run a temp folder of its own — TMP, TEMP and
// TMPDIR point into it, and the workers inherit that — and on the way out it
// fails the run if anything is still in it, then removes it. That is the proof
// that the suite leaves nothing behind (M28 F19), and since the folder is the
// run's own, another process writing to the system temp cannot trip it.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VARIABLES = ['TMP', 'TEMP', 'TMPDIR'] as const

export default function setup(): () => void {
  const run = mkdtempSync(join(tmpdir(), 'emerald-test-run-'))
  const saved = VARIABLES.map((name) => [name, process.env[name]] as const)
  for (const name of VARIABLES) process.env[name] = run

  return () => {
    const left = readdirSync(run)
    rmSync(run, { recursive: true, force: true, maxRetries: 5 })
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    if (left.length > 0) {
      throw new Error(
        `The test run left ${left.length} thing(s) in the temp folder (${left.slice(0, 10).join(', ')}). ` +
          'Make test folders with tempDir from src/testing/tempDir.ts, which removes them.',
      )
    }
  }
}
