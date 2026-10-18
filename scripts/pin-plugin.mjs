/**
 * Moves the Claude plugin's pins to the version npm now has (M42 U3, D-500).
 *
 *   node scripts/pin-plugin.mjs        # after `npm publish` of the root package.json's version
 *
 * The plugin is served from `main` and runs `npx emerald-mcp@<pin>`, so a pin pushed before its
 * publish starts nothing for anyone who updates. The version is cut first — `package.json`,
 * `server.json` and the server's `PLUGIN_VERSION`, pushed like any commit — and the pins follow
 * once the package is there: this asks npm, refuses while it has no such version, and otherwise
 * rewrites every `emerald-mcp@<version>` the plugin carries and the manifest's `version`.
 * Committing and pushing the result is the caller's; that push lists the version in the MCP
 * Registry (`.github/workflows/registry.yml`).
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
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
  let text = readFileSync(path, 'utf8').replace(PINNED, `emerald-mcp@${version}`)
  if (file.endsWith('plugin.json')) text = text.replace(/"version": "[^"]+"/, `"version": "${version}"`)
  writeFileSync(path, text)
  console.log(`${file} → emerald-mcp@${version}`)
}
