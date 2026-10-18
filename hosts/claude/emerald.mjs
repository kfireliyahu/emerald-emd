#!/usr/bin/env node
/**
 * The Claude plugin's launcher (M42 U4, D-498): runs one of the published
 * package's bins with plain `node`, from a copy of `emerald-mcp` kept in the
 * plugin's data folder, at the version `.claude-plugin/plugin.json` names.
 *
 *     node emerald.mjs <emerald-hooks | emerald-status-line | emerald-mcp> [arguments]
 *
 * Why not `npx` in `hooks/hooks.json`: an npx call costs ~2 s on the
 * maintainer's Windows machine against ~0.35 s for `node` (D-497), and the
 * inbox hook runs before every prompt. Why not a committed build: the package
 * is the build, published once, and the plugin only pins it.
 *
 * The copy lives in `${CLAUDE_PLUGIN_DATA}/node_modules/emerald-mcp`, a folder
 * Claude Code keeps across the plugin's updates, so the path is the same for
 * every version and a status line can name it. When the copy is missing or is
 * another version, this installs the pinned one with npm — `--prefer-offline`,
 * so the tarball the server's own `npx` already fetched is used — except for
 * the per-prompt `rows`, which never makes a prompt wait on npm: it is silent
 * until the next `start-here` has installed it.
 *
 * Plain JavaScript and no imports but Node's, because it runs as it is
 * committed: nothing builds the plugin. A hook's stdout is context, so npm's
 * output goes to stderr; a failure is said on stderr with exit 1, never 2,
 * which to Claude Code blocks the person's prompt.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE = 'emerald-mcp'
const here = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(here, '.claude-plugin', 'plugin.json'), 'utf8'))
// Where Claude Code puts it for `emerald@emerald-emd`; set in every hook, absent on hosts before it.
const data = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'plugins', 'data', 'emerald-emerald-emd')
const folder = join(data, 'node_modules', PACKAGE)

const [bin, ...args] = process.argv.slice(2)
const perPrompt = bin === 'emerald-hooks' && args[0] === 'rows'

/** The installed copy's manifest, or undefined. */
function installed() {
  try {
    return JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** npm, started without a shell where its script sits beside this node (npm is a .cmd on Windows). */
function npm(words) {
  const beside = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((path) => existsSync(path))
  const stdio = ['ignore', 2, 2]
  if (beside !== undefined) return spawnSync(process.execPath, [beside, ...words], { stdio })
  const windows = process.platform === 'win32'
  return spawnSync(windows ? 'npm.cmd' : 'npm', windows ? words.map((word) => `"${word}"`) : words, { stdio, shell: windows })
}

let manifest = installed()
if (manifest?.version !== version && !perPrompt) {
  npm(['install', '--prefix', data, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--prefer-offline', '--loglevel=error', `${PACKAGE}@${version}`])
  manifest = installed()
}
if (manifest?.version !== version) {
  if (perPrompt) process.exit(0)
  console.error(`Emerald: ${PACKAGE}@${version} is not in ${data} and npm could not install it; the next session tries again.`)
  process.exit(1)
}

const file = typeof bin === 'string' ? manifest.bin?.[bin] : undefined
if (file === undefined) {
  console.error(`Emerald: ${bin ?? '(nothing)'} is not one of ${Object.keys(manifest.bin ?? {}).join(', ')}.`)
  process.exit(1)
}
// In this process rather than a second node: the bin reads its arguments and stdin as if started itself.
const entry = join(folder, file)
process.argv = [process.argv[0], entry, ...args]
await import(pathToFileURL(entry).href)
