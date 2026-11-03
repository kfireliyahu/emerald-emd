/**
 * Runs the plugin's hooks module tests under Claude Code (M56 U1, D-541):
 *
 *   npm run test:mod        # claude plugin test, on hosts/claude without its Vitest files
 *
 * `claude plugin test <dir>` runs every `*.test.ts` and `*.test.tsx` under the
 * folder in the module's own environment, with no Node — so the plugin's Vitest
 * files beside the module (`plugin.test.ts`, `mod.test.ts`, the hooks' and the
 * skills') fail to load there. This copies the plugin to a folder of its own
 * without them, keeping the module's own tests in `mod/`, runs the command
 * there and exits with its code. Needs `claude` on the PATH; CI has none, so
 * it is the maintainer's and a session's to run, like `check:tours`.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const plugin = join(root, 'hosts', 'claude')
const staged = join(mkdtempSync(join(tmpdir(), 'emerald-mod-test-')), 'emerald')

/** What stays behind: a Vitest file outside the module, and what the engine lays beside a mod it loaded. */
function isLeftOut(path) {
  const file = relative(plugin, path).split(sep).join('/')
  if (file === 'tsconfig.json' || file === 'node_modules' || file.startsWith('.claude-plugin/types')) return true
  return /\.test\.tsx?$/.test(file) && !file.startsWith('mod/')
}

cpSync(plugin, staged, { recursive: true, filter: (path) => !isLeftOut(path) })
const run = spawnSync('claude', ['plugin', 'test', staged], { stdio: 'inherit' })
rmSync(join(staged, '..'), { recursive: true, force: true })
process.exit(run.status ?? 1)
