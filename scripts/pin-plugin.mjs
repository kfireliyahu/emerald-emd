/**
 * Moves the Claude plugin's pins to the version npm now has (M42 U3, D-500), or
 * cuts a plugin release of its own (M42 U7, D-504).
 *
 *   node scripts/pin-plugin.mjs           # after `npm publish` of the root package.json's version
 *   node scripts/pin-plugin.mjs --plugin  # a change to the plugin's own files: skills, hooks, README
 *
 * The plugin is served from `main` and runs `npx emerald-mcp@<pin>`, so a pin pushed before its
 * publish starts nothing for anyone who updates. The version is cut first — `package.json`,
 * `server.json` and the server's `PLUGIN_VERSION`, pushed like any commit — and the pins follow
 * once the package is there: this asks npm, refuses while it has no such version, and otherwise
 * rewrites every `emerald-mcp@<version>` the plugin carries and the manifest's `version`.
 * Committing and pushing the result is the caller's; that push lists the version in the MCP
 * Registry (`.github/workflows/registry.yml`).
 *
 * **The manifest's `version` is how an installed plugin learns there is an update**:
 * Claude Code compares it as a string with the one it installed, so a change
 * under an unchanged version never reaches anyone who already has it (D-504).
 * A pin move makes it the bare package version; `--plugin` asks npm nothing,
 * keeps the pins and makes it `<pin>+<n>`, the n-th plugin release on that pin.
 * Both record the digest of what the plugin ships (`hosts/claude/release.ts`) in
 * `hosts/claude-plugin-release.json`, which `hosts/claude/plugin.test.ts` holds.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { pluginDigest } from '../hosts/claude/release.ts'

const root = resolve(import.meta.dirname, '..')
const folder = join(root, 'hosts', 'claude')
const manifest = join(folder, '.claude-plugin', 'plugin.json')
const record = join(root, 'hosts', 'claude-plugin-release.json')

/** Writes the manifest's version and the digest it was cut for. */
function cut(pluginVersion) {
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(/"version": "[^"]+"/, `"version": "${pluginVersion}"`))
  writeFileSync(record, `${JSON.stringify({ version: pluginVersion, digest: pluginDigest(folder) }, null, 2)}\n`)
  console.log(`the plugin is ${pluginVersion}`)
}

if (process.argv.includes('--plugin')) {
  const current = JSON.parse(readFileSync(manifest, 'utf8')).version
  const recorded = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : {}
  if (recorded.version === current && recorded.digest === pluginDigest(folder)) {
    console.log(`nothing the plugin ships changed since ${current}`)
    process.exit(0)
  }
  const [, pin, release] = /^(\d+\.\d+\.\d+)(?:\+(\d+))?$/.exec(current) ?? []
  if (pin === undefined) throw new Error(`plugin.json's version ${current} is not <x.y.z> or <x.y.z>+<n>`)
  cut(`${pin}+${Number(release ?? 0) + 1}`)
  process.exit(0)
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

let published = ''
try {
  // A command line rather than a file and arguments: npm is a shell script on Windows.
  published = execSync(`npm view emerald-mcp@${version} version`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {
  // npm exits non-zero with E404 for a version it has never seen.
}
if (published !== version) {
  console.error(`npm has no emerald-mcp@${version} yet: publish it from dist-plugin/, then run this again.`)
  process.exit(1)
}

const PINNED = /emerald-mcp@\d+\.\d+\.\d+/g
const files = [
  join('hosts', 'claude', '.claude-plugin', 'plugin.json'),
  join('hosts', 'claude', 'hooks', 'hooks.json'),
  join('hosts', 'claude', 'README.md'),
]
for (const file of files) {
  const path = join(root, file)
  writeFileSync(path, readFileSync(path, 'utf8').replace(PINNED, `emerald-mcp@${version}`))
  console.log(`${file} → emerald-mcp@${version}`)
}
cut(version)
