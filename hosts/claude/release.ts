/**
 * **What a person who installed the plugin gets, as one digest** (M42 U7, D-504).
 *
 * Claude Code updates an installed marketplace plugin only when the version it
 * computes for it differs from the one it recorded — and with a `version` in
 * `plugin.json`, that is the version, compared as a string. So a skill changed
 * under an unchanged version reaches a new install and never an existing one.
 * This digest is of every file the plugin ships that a person's Claude reads —
 * the manifest without its `version`, the hook set, the skills, the README; not
 * the TypeScript beside them, which runs from the npm package — and
 * `hosts/claude-plugin-release.json` records it with the version cut for it.
 * `plugin.test.ts` fails when they differ: run `node scripts/pin-plugin.mjs
 * --plugin`, which cuts the next plugin version and records the digest.
 *
 * Plain Node, no imports of this repository's, so the script can import it too.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Every shipped file under `folder`, relative and with forward slashes, sorted. */
function shipped(folder: string, under: string = folder): string[] {
  return readdirSync(under, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(under, entry.name)
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : shipped(folder, path)
      return entry.name.endsWith('.ts') ? [] : [relative(folder, path).split(sep).join('/')]
    })
    .sort()
}

/** The digest of the plugin in `folder`: its shipped files, line endings as LF, the manifest's version left out. */
export function pluginDigest(folder: string): string {
  const hash = createHash('sha256')
  for (const file of shipped(folder)) {
    let text = readFileSync(join(folder, file), 'utf8').replace(/\r\n/g, '\n')
    if (file === '.claude-plugin/plugin.json') text = text.replace(/"version": "[^"]*"/, '"version": ""')
    hash.update(`${file}\n${text}\n`)
  }
  return hash.digest('hex').slice(0, 16)
}
