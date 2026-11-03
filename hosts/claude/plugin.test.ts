import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PLUGIN_INSTRUCTIONS, SKILLS_FLAG } from '@/plugin/host.ts'

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
/** What every npx hook starts behind (M56 U2, D-547). */
const GATE = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/unless-mod.mjs" '
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
      args: ['-y', '--prefer-offline', `emerald-mcp@${pin}`, '--engine-only', SKILLS_FLAG],
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
    const npx = commands.filter((command) => command.includes('npx '))
    // Every npx hook starts through the gate, which exits where the hooks module answered (M56 U2, D-547).
    expect(npx.length).toBeGreaterThan(0)
    for (const command of npx) {
      expect(command.startsWith(GATE), command).toBe(true)
      const found = /^npx -y --prefer-offline -p emerald-mcp@(\S+) (\S+) /.exec(command.slice(GATE.length))
      expect(found, command).not.toBeNull()
      expect(found?.[1]).toBe(pin)
      expect(bins).toContain(found?.[2])
    }
  })

  it('runs a node hook only on a file of its own folder, with no import of the package', () => {
    const commands = Object.values(hooks.hooks as Record<string, { hooks: { command: string }[] }[]>).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    )
    const local = commands.filter((command) => command.startsWith('node ') && !command.startsWith(GATE))
    expect(local).toEqual(['node "${CLAUDE_PLUGIN_ROOT}/hooks/no-server.mjs"'])
    for (const file of ['no-server.mjs', 'unless-mod.mjs']) {
      const source = readFileSync(join(HERE, 'hooks', file), 'utf8')
      expect([...source.matchAll(/from '([^']+)'/g)].map((found) => found[1]).every((name) => name?.startsWith('node:')), file).toBe(true)
    }
  })

  it('pins the same emerald-mcp in every skill as everywhere else, and the pin script moves each one', () => {
    const mover = readFileSync(join(ROOT, 'scripts', 'pin-plugin.mjs'), 'utf8')
    const skills = readdirSync(join(HERE, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory())
    const pinning = skills.filter((entry) => {
      const skill = readFileSync(join(HERE, 'skills', entry.name, 'SKILL.md'), 'utf8')
      const pins = [...skill.matchAll(/emerald-mcp@(\d+\.\d+\.\d+)/g)].map((found) => found[1])
      if (pins.length === 0) return false
      expect(new Set(pins), entry.name).toEqual(new Set([pin]))
      expect(mover, `scripts/pin-plugin.mjs leaves ${entry.name}'s pin behind`).toContain(`'skills', '${entry.name}', 'SKILL.md'`)
      return true
    })
    expect(pinning.map((entry) => entry.name)).toEqual(expect.arrayContaining(['emerald-setup', 'set-up-a-project']))
  })

  it('ships every skill its server text sends a session to, and each says what that line left out (M56 U5, D-552)', () => {
    // Started `--skills`, the server says a how-to in one line naming a skill;
    // a session on the plugin reaches the rest only through that skill. So each
    // one named is shipped here, and says what the full text said in its place.
    const said: Record<string, readonly string[]> = {
      'read-a-file': ['read_onto_format', '`fixed`', 'supersede_reading', 'unique'],
      'what-looks-wrong': ['format_problems', 'refuses the whole'],
      'bring-in-a-plan': ['keep_packs', '`milestone`', '`open_question`'],
      'set-up-a-project': ['stored as text and committed', 'One file outside every repository', 'store_document_as'],
      'closing-pass': ['land_units', 'inbox'],
    }
    const named = [...new Set([...PLUGIN_INSTRUCTIONS.matchAll(/the `([a-z-]+)` skill/g)].map((found) => found[1] ?? ''))]
    expect(named.sort()).toEqual(Object.keys(said).sort())
    for (const name of named) {
      const skill = readFileSync(join(HERE, 'skills', name, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ')
      for (const phrase of said[name] ?? []) expect(skill, `${name}: ${phrase}`).toContain(phrase)
    }
  })
})
