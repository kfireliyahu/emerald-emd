import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { pluginDigest } from './release.ts'

/**
 * **The Claude plugin is this folder, served by the repository's marketplace**
 * (M42 U4, D-498, D-499). Nothing builds it: it pins the published
 * `emerald-mcp` and runs it through `npx` — the server and the hooks alike, but
 * for one hook of its own folder, which prints the setup skill where no plugin
 * server starts (M42 F8, D-508). So
 * the one thing that can drift is the version, and it is written once, as the
 * manifest's `version`, which every pin must equal. It may trail the version
 * `npm run build:plugin` stamps on the package (the repository's own), never
 * lead it: the version is cut and pushed first, and `scripts/pin-plugin.mjs`
 * moves the pins once npm has it, because a pin pushed before its publish
 * starts nothing (M42 U3, D-500).
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const plugin = json(join(HERE, '.claude-plugin', 'plugin.json'))
const marketplace = json(join(ROOT, '.claude-plugin', 'marketplace.json'))
const hooks = json(join(HERE, 'hooks', 'hooks.json'))
const release = json(join(ROOT, 'hosts', 'claude-plugin-release.json'))
/** The package version every pin names: the manifest's version before any `+<n>`. */
const pin = String(plugin.version).split('+')[0] ?? ''

describe('the plugin', () => {
  it("pins the package at the manifest's version, never ahead of the package's", () => {
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+(\+\d+)?$/)
    const parts = (version: string) => version.split('.').map(Number)
    const [pinned, cut] = [parts(pin), parts(json(join(ROOT, 'package.json')).version)]
    const order = pinned.map((part, at) => part - (cut[at] ?? 0)).find((difference) => difference !== 0) ?? 0
    expect(order, `${pin} is ahead of the package`).toBeLessThanOrEqual(0)
    expect(plugin.mcpServers.emerald).toEqual({
      command: 'npx',
      args: ['-y', '--prefer-offline', `emerald-mcp@${pin}`, '--engine-only'],
    })
  })

  it('cuts a new version whenever what it ships changes, or no installed plugin would update', () => {
    expect(
      { version: plugin.version, digest: pluginDigest(HERE) },
      'what the plugin ships changed since its version was cut: run `node scripts/pin-plugin.mjs --plugin`',
    ).toEqual(release)
  })

  it('is the one plugin the marketplace lists, from this folder', () => {
    expect(marketplace.plugins).toHaveLength(1)
    expect(marketplace.plugins[0]).toMatchObject({ name: plugin.name, source: './hosts/claude' })
  })

  it('carries only the keys Claude Code reads, or an install warns and strips the rest', () => {
    const read = ['name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords',
      'commands', 'agents', 'skills', 'hooks', 'mcpServers', 'outputStyles', 'lspServers']
    expect(Object.keys(plugin).filter((key) => !read.includes(key))).toEqual([])
  })

  it('links its privacy policy over https from its README, and the file is there', () => {
    expect(readFileSync(join(HERE, 'README.md'), 'utf8')).toContain('https://github.com/kfireliyahu/emerald-emd/blob/main/PRIVACY.md')
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
    for (const command of commands.filter((command) => !command.startsWith('node '))) {
      const found = /^npx -y --prefer-offline -p emerald-mcp@(\S+) (\S+) /.exec(command)
      expect(found, command).not.toBeNull()
      expect(found?.[1]).toBe(pin)
      expect(bins).toContain(found?.[2])
    }
  })

  it('runs a node hook only on a file of its own folder, with no import of the package', () => {
    const commands = Object.values(hooks.hooks as Record<string, { hooks: { command: string }[] }[]>).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    )
    const local = commands.filter((command) => command.startsWith('node '))
    expect(local).toEqual(['node "${CLAUDE_PLUGIN_ROOT}/hooks/no-server.mjs"'])
    const source = readFileSync(join(HERE, 'hooks', 'no-server.mjs'), 'utf8')
    expect([...source.matchAll(/from '([^']+)'/g)].map((found) => found[1]).every((name) => name?.startsWith('node:'))).toBe(true)
  })

  it('pins the same emerald-mcp in the setup skill as everywhere else', () => {
    const skill = readFileSync(join(HERE, 'skills', 'emerald-setup', 'SKILL.md'), 'utf8')
    const pins = [...skill.matchAll(/emerald-mcp@(\d+\.\d+\.\d+)/g)].map((found) => found[1])
    expect(pins.length).toBeGreaterThan(0)
    expect(new Set(pins)).toEqual(new Set([pin]))
  })
})
