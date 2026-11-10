/**
 * **What the plugin's own folder says at a session's start**, in two cases:
 *
 * - Where the host starts a plugin's skills and hooks but not its MCP server —
 *   a cloud Cowork task sets CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS — it prints
 *   the emerald-setup skill, so the session can tell the person how to make
 *   Emerald's tools available on their own computer.
 * - Where the plugin's server does start, and **another emerald server is
 *   registered beside it** (M58 U2, D-569, D-571), it says so once, with how to
 *   remove the other one: every tool was listed twice, and sessions used both.
 *   The plugin's stays. It reads the places a Claude Code session takes servers
 *   from — `~/.claude.json` (user and local scope), the project's `.mcp.json`
 *   unless turned off, and, in the Claude desktop app, which attaches the
 *   servers of its own `claude_desktop_config.json` to every Code session, that
 *   file — and never writes any of them.
 *
 * Anywhere else it prints nothing.
 *
 * Plain Node with no imports but Node's, run from the plugin folder rather than
 * the npm package, so changing it needs a plugin release and no new emerald-mcp.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A server is Emerald's when its name, command or arguments say emerald. */
const EMERALD = /emerald/i

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function objectOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}

function isEmerald(name, entry) {
  const server = objectOf(entry)
  const args = Array.isArray(server.args) ? server.args.filter((arg) => typeof arg === 'string') : []
  return EMERALD.test([name, typeof server.command === 'string' ? server.command : '', typeof server.url === 'string' ? server.url : '', ...args].join(' '))
}

function emeraldNames(servers) {
  return Object.entries(objectOf(servers))
    .filter(([name, entry]) => isEmerald(name, entry))
    .map(([name]) => name)
}

/** A folder as `~/.claude.json` keys its projects: either slash, and any case on Windows. */
function sameFolder(a, b, platform) {
  const plain = (path) => {
    const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return platform === 'win32' ? slashed.toLowerCase() : slashed
  }
  return plain(a) === plain(b)
}

/** Where the Claude desktop app may keep `claude_desktop_config.json` on this machine. */
function desktopConfigs(env, home, platform) {
  const file = 'claude_desktop_config.json'
  if (platform === 'darwin') return [join(home, 'Library', 'Application Support', 'Claude', file)]
  if (platform !== 'win32') return [join(home, '.config', 'Claude', file)]
  const found = env.APPDATA ? [join(env.APPDATA, 'Claude', file)] : []
  if (env.LOCALAPPDATA) {
    // The app's newer data folder: one folder per installation under Claude-Data.
    const data = join(env.LOCALAPPDATA, 'Claude-Data')
    let folders = []
    try {
      folders = readdirSync(data, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      // No such folder: the older layout alone.
    }
    for (const folder of folders) found.push(join(data, folder, file))
  }
  return found
}

/**
 * Every emerald server registered for a session in `project` other than the
 * plugin's own, which none of these files holds: `{ name, scope, file }`, with
 * scope `desktop`, `user`, `local` or `project`.
 */
export function otherEmeraldServers({ env, home, platform, project }) {
  const found = []
  const claudeJsonPath = join(env.CLAUDE_CONFIG_DIR || home, '.claude.json')
  const claudeJson = objectOf(readJson(claudeJsonPath))
  for (const name of emeraldNames(claudeJson.mcpServers)) found.push({ name, scope: 'user', file: claudeJsonPath })

  const projects = objectOf(claudeJson.projects)
  const here = Object.entries(projects)
    .filter(([folder]) => sameFolder(folder, project, platform))
    .map(([, entry]) => objectOf(entry))
  for (const entry of here) for (const name of emeraldNames(entry.mcpServers)) found.push({ name, scope: 'local', file: claudeJsonPath })

  const mcpJson = join(project, '.mcp.json')
  const off = new Set(
    [readJson(join(project, '.claude', 'settings.local.json')), readJson(join(project, '.claude', 'settings.json')), ...here]
      .flatMap((settings) => objectOf(settings).disabledMcpjsonServers)
      .filter((name) => typeof name === 'string'),
  )
  for (const name of emeraldNames(objectOf(readJson(mcpJson)).mcpServers)) {
    if (!off.has(name)) found.push({ name, scope: 'project', file: mcpJson })
  }

  if ((env.CLAUDE_CODE_ENTRYPOINT ?? '').startsWith('claude-desktop')) {
    for (const file of desktopConfigs(env, home, platform)) {
      for (const name of emeraldNames(objectOf(readJson(file)).mcpServers)) found.push({ name, scope: 'desktop', file })
    }
  }

  const seen = new Set()
  return found.filter((server) => {
    const key = `${server.scope} ${server.name} ${server.file}`
    return seen.has(key) ? false : (seen.add(key), true)
  })
}

/** How the person removes one, in their own hands. */
function howToRemove({ name, scope, file }) {
  if (scope === 'desktop') return `delete "${name}" under "mcpServers" in ${file}, then quit and reopen the Claude app`
  if (scope === 'user') return `run \`claude mcp remove ${name} -s user\``
  if (scope === 'local') return `run \`claude mcp remove ${name} -s local\` in this project`
  return `delete "${name}" from ${file}, or add it to "disabledMcpjsonServers" in .claude/settings.local.json`
}

/** The line, or '' when the plugin's is the only one. */
export function otherServersLine(found) {
  if (found.length === 0) return ''
  const names = found.map((server) => `\`${server.name}\``).join(', ')
  return (
    `**Emerald's tools are here twice**: the plugin's, and ${names}. Use the plugin's.` +
    ` Tell the person once how to remove the other — ${found.map(howToRemove).join('; ')} — and never change their configuration yourself.\n`
  )
}

function main() {
  if (process.env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS) {
    const skill = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'emerald-setup', 'SKILL.md')
    const body = readFileSync(skill, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    process.stdout.write(
      '**For you, never the person.** This host does not start plugin MCP servers, so the plugin\'s own Emerald server is not here.' +
        ' If you already have tools with emerald in their name, under any prefix, they are the person\'s Emerald, from their computer:' +
        ' use them and ignore the rest of this. Otherwise, when the person wants to work with a .emd, do what follows.\n' +
        body,
    )
    return
  }
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  process.stdout.write(otherServersLine(otherEmeraldServers({ env: process.env, home: homedir(), platform: process.platform, project })))
}

const self = fileURLToPath(import.meta.url)
const started = process.argv[1] ? resolve(process.argv[1]) : ''
if (process.platform === 'win32' ? started.toLowerCase() === self.toLowerCase() : started === self) main()
