import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * **The Claude plugin is this folder, served by the repository's marketplace**
 * (M42 U4, D-498). Nothing builds it: it pins the published `emerald-mcp` and
 * runs it — the server through `npx`, the hooks through `emerald.mjs` from a
 * copy in the plugin's data folder. So the one thing that can drift is the
 * version, and it is written once, as the manifest's `version`, which every
 * pin must equal and which must be the version `npm run build:plugin` stamps
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

  it('runs every hook through the launcher, with a bin the package has', () => {
    // The bins as `scripts/npm-package.mjs` declares them; importing it would write the package.
    const declared = /const BINS = \{([^}]*)\}/.exec(readFileSync(join(ROOT, 'scripts', 'npm-package.mjs'), 'utf8'))?.[1] ?? ''
    const bins = [...declared.matchAll(/'([a-z-]+)':/g)].map((found) => found[1])
    expect(bins).toContain('emerald-hooks')
    const commands = Object.values(hooks.hooks as Record<string, { hooks: { command: string }[] }[]>).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    )
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      const bin = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/emerald\.mjs" (\S+) /.exec(command)?.[1]
      expect(bin, command).toBeDefined()
      expect(bins).toContain(bin)
    }
  })
})

describe('the launcher', () => {
  let made: string[] = []
  afterEach(() => {
    for (const folder of made) rmSync(folder, { recursive: true, force: true })
    made = []
  })

  /** A plugin folder holding the launcher and the manifest, and a data folder with a stand-in package at `version`. */
  function aPlugin(version: string | undefined) {
    const root = mkdtempSync(join(tmpdir(), 'emerald-plugin-'))
    const data = mkdtempSync(join(tmpdir(), 'emerald-data-'))
    made.push(root, data)
    mkdirSync(join(root, '.claude-plugin'))
    cpSync(join(HERE, 'emerald.mjs'), join(root, 'emerald.mjs'))
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'emerald', version: '9.9.9' }))
    if (version !== undefined) {
      const pkg = join(data, 'node_modules', 'emerald-mcp')
      mkdirSync(pkg, { recursive: true })
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'emerald-mcp', version, type: 'module', bin: { 'emerald-hooks': 'hooks.mjs' } }))
      // Says what it was started with and what it read, the way a bin would see them.
      writeFileSync(
        join(pkg, 'hooks.mjs'),
        "#!/usr/bin/env node\nimport { readFileSync } from 'node:fs'\nconsole.log(JSON.stringify({ argv: process.argv.slice(2), stdin: readFileSync(0, 'utf8') }))\nprocess.exitCode = 3\n",
      )
    }
    return { root, data }
  }

  function launch(root: string, data: string, args: string[], stdin = '') {
    const child = spawn(process.execPath, [join(root, 'emerald.mjs'), ...args], { env: { ...process.env, CLAUDE_PLUGIN_DATA: data }, stdio: 'pipe' })
    let out = ''
    let error = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (error += chunk.toString('utf8')))
    child.stdin.end(stdin)
    return new Promise<{ code: number | null; out: string; error: string }>((settle) => child.on('close', (code) => settle({ code, out, error })))
  }

  it('runs the bin from the data folder in its own process, with its arguments, stdin and exit code', async () => {
    const { root, data } = aPlugin('9.9.9')
    const ran = await launch(root, data, ['emerald-hooks', 'rows', '/a/project', 'inbox', '--once-per-session'], '{"session_id":"s"}')
    expect(ran.code).toBe(3)
    expect(JSON.parse(ran.out)).toEqual({ argv: ['rows', '/a/project', 'inbox', '--once-per-session'], stdin: '{"session_id":"s"}' })
  })

  it('keeps the per-prompt hook silent while the pinned version is not installed, and never waits on npm', async () => {
    const { root, data } = aPlugin('9.9.8')
    const ran = await launch(root, data, ['emerald-hooks', 'rows', '/a/project', 'inbox'])
    expect(ran).toEqual({ code: 0, out: '', error: '' })
  })

  it('says which bins there are, on stderr with exit 1, for one the package does not have', async () => {
    const { root, data } = aPlugin('9.9.9')
    const ran = await launch(root, data, ['emerald-nothing'])
    expect(ran.code).toBe(1)
    expect(ran.out).toBe('')
    expect(ran.error).toContain('emerald-hooks')
  })
})
