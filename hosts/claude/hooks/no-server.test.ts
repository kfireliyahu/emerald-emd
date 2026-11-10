import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The plugin's own SessionStart hook, run as a host runs it: a second emerald
 * server registered beside the plugin's is said once, with how to remove it,
 * and nothing is written (M58 U2, D-569, D-571).
 */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'no-server.mjs')

let root: string
let home: string
let project: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'emerald-no-server-'))
  home = join(root, 'home')
  project = join(root, 'project')
  mkdirSync(join(project, '.claude'), { recursive: true })
  mkdirSync(home, { recursive: true })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

/** Where the desktop app keeps its configuration on the platform the test runs on. */
function desktopConfig(): string {
  const file = 'claude_desktop_config.json'
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', file)
  if (process.platform === 'win32') return join(root, 'appdata', 'Claude', file)
  return join(home, '.config', 'Claude', file)
}

function run(env: Record<string, string> = {}): string {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('CLAUDE') && name !== 'APPDATA' && name !== 'LOCALAPPDATA'),
  )
  return execFileSync(process.execPath, [SCRIPT], {
    env: { ...clean, HOME: home, USERPROFILE: home, APPDATA: join(root, 'appdata'), CLAUDE_PROJECT_DIR: project, ...env },
    encoding: 'utf8',
  })
}

const SERVER = { command: 'npx', args: ['-y', 'emerald-mcp@0.3.0', '--engine-only'] }

describe('no-server.mjs, where the plugin server starts', () => {
  it('says nothing when the plugin’s server is the only emerald one', () => {
    write(join(home, '.claude.json'), { mcpServers: { other: { command: 'node', args: ['other.mjs'] } } })
    expect(run()).toBe('')
  })

  it('names a user-scope and a local-scope server, each with how to remove it', () => {
    write(join(home, '.claude.json'), {
      mcpServers: { emerald: SERVER },
      projects: { [project.replace(/\\/g, '/')]: { mcpServers: { mine: { command: 'node', args: ['F:/x/emerald/dist-plugin/server.mjs'] } } } },
    })
    const said = run()
    expect(said).toContain("Emerald's tools are here twice")
    expect(said).toContain('`claude mcp remove emerald -s user`')
    expect(said).toContain('`claude mcp remove mine -s local`')
    expect(said).toContain('never change their configuration yourself')
    expect(said.trim().split('\n')).toHaveLength(1)
  })

  it('names the project’s .mcp.json server unless the project turned it off', () => {
    write(join(project, '.mcp.json'), { mcpServers: { emerald: { command: 'node', args: ['dist-plugin/server.mjs'] } } })
    expect(run()).toContain(`delete "emerald" from ${join(project, '.mcp.json')}`)
    write(join(project, '.claude', 'settings.local.json'), { disabledMcpjsonServers: ['emerald'] })
    expect(run()).toBe('')
  })

  it('reads the desktop app’s configuration only in a session the desktop app started', () => {
    write(desktopConfig(), { mcpServers: { 'emerald-ledger': { command: 'node', args: ['server.mjs'] } } })
    expect(run({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe('')
    const said = run({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' })
    expect(said).toContain('`emerald-ledger`')
    expect(said).toContain(`under "mcpServers" in ${desktopConfig()}, then quit and reopen the Claude app`)
  })

  it('says nothing of a second server where the host starts no plugin server, since there is no first', () => {
    write(join(home, '.claude.json'), { mcpServers: { emerald: SERVER } })
    const said = run({ CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS: '1' })
    expect(said).not.toContain("Emerald's tools are here twice")
    expect(said).toContain('This host does not start plugin MCP servers')
  })
})
