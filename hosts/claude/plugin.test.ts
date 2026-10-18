import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * **The Claude plugin is this folder, served by the repository's marketplace**
 * (M42 U4, D-498, D-499). Nothing builds it: it pins the published
 * `emerald-mcp` and runs it through `npx` — the server and the hooks alike. So
 * the one thing that can drift is the version, and it is written once, as the
 * manifest's `version`, which every pin must equal and which must be the version `npm run build:plugin` stamps
 * on the package (the repository's own) — publish, then push.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const plugin = json(join(HERE, '.claude-plugin', 'plugin.json'))
const marketplace = json(join(ROOT, '.claude-plugin', 'marketplace.json'))
const hooks = json(join(HERE, 'hooks', 'hooks.json'))

describe('the plugin', () => {
  it("pins the package at the manifest's version, which is the package's", () => {
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(plugin.version).toBe(json(join(ROOT, 'package.json')).version)
    expect(plugin.mcpServers.emerald).toEqual({
      command: 'npx',
      args: ['-y', '--prefer-offline', `emerald-mcp@${plugin.version}`, '--engine-only'],
    })
  })

  it('is the one plugin the marketplace lists, from this folder', () => {
    expect(marketplace.plugins).toHaveLength(1)
    expect(marketplace.plugins[0]).toMatchObject({ name: plugin.name, source: './hosts/claude' })
  })

  it('links its privacy policy over https, and the file is there', () => {
    expect(plugin.privacyPolicyUrl).toBe('https://github.com/kfireliyahu/emerald-emd/blob/main/PRIVACY.md')
    expect(readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8')).toContain('Claude plugin')
  })

  it('runs every hook through npx, at the pinned version, with a bin the package has', () => {
    // The bins as `scripts/npm-package.mjs` declares them; importing it would write the package.
    const declared = /const BINS = \{([^}]*)\}/.exec(readFileSync(join(ROOT, 'scripts', 'npm-package.mjs'), 'utf8'))?.[1] ?? ''
    const bins = [...declared.matchAll(/'([a-z-]+)':/g)].map((found) => found[1])
    const commands = Object.values(hooks.hooks as Record<string, { hooks: { command: string }[] }[]>).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    )
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      const found = /^npx -y --prefer-offline -p emerald-mcp@(\S+) (\S+) /.exec(command)
      expect(found, command).not.toBeNull()
      expect(found?.[1]).toBe(plugin.version)
      expect(bins).toContain(found?.[2])
    }
  })
})
