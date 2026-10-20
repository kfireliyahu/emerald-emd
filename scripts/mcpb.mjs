/**
 * The server as a Claude desktop extension, `release/emerald.mcpb` (M42 F9, D-509): the file a
 * person double-clicks to add Emerald to the Claude desktop app, with no Node to install and no
 * configuration file to edit.
 *
 *   npm run build:plugin && npm run build:mcpb     # release/emerald.mcpb; the release workflow attaches it
 *
 * **It is the npm package's server and nothing else.** `dist-plugin/server.mjs` is already whole —
 * every package it reaches is bundled into it (scripts/npm-package.mjs) — so the bundle holds that
 * one file, its two licence files and the icon, and needs no `node_modules`. It runs as the plugin
 * runs it, `--engine-only` (hosts/claude/.claude-plugin/plugin.json).
 *
 * **`server.type: "node"`, so the app runs it on the Node it ships** rather than on one the person
 * installed; the files target Node 20 (vite.config.ts), and `compatibility.runtimes.node` is the npm
 * package's floor, the oldest Node CI runs them on (.github/workflows/package.yml, D-510).
 * Measured on Windows (D-509): the chat side of the app runs it with no `node` on the machine.
 *
 * **The tools are the server's own list**, asked over stdio here rather than written twice, so the
 * install page shows what the server answers. Each keeps its first sentence.
 *
 * The version, licence, author and repository are the repository's own `package.json`'s, like the
 * npm package's. The icon is `build/extension.png`, cut from `src/ui/emerald.svg` at 512 by `npm run icons`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const built = join(root, 'dist-plugin')
const stage = join(root, 'dist-mcpb')
const output = join(root, 'release', 'emerald.mcpb')
const SERVER = 'server.mjs'
const ARGS = ['--engine-only']

/** The server's tools, asked over stdio the way any client asks. */
function toolsOf(server) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [server, ...ARGS])
    const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
    let pending = ''
    let errors = ''
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error(`the server did not list its tools in 30 s\n${errors}`))
    }, 30_000)
    child.stderr.on('data', (chunk) => (errors += chunk))
    child.on('exit', (code) => fail(new Error(`the server exited (${code}) before listing its tools\n${errors}`)))
    child.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop()
      for (const line of lines) {
        const message = JSON.parse(line)
        if (message.id === 1) {
          send({ method: 'notifications/initialized' })
          send({ id: 2, method: 'tools/list' })
        } else if (message.id === 2) {
          clearTimeout(timer)
          child.removeAllListeners('exit')
          child.kill()
          done(message.result.tools)
        }
      }
    })
    send({
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'build-mcpb', version: '0' } },
    })
  })
}

/** A description's first sentence: the install page lists every tool, and the server says the rest. */
function firstSentence(text) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?](\s|$)/)
  return end === -1 ? flat : flat.slice(0, end + 1)
}

function manifest(app, tools) {
  return {
    manifest_version: '0.3',
    name: 'emerald',
    display_name: 'Emerald',
    version: app.version,
    description:
      'The database under the chat: keep tasks, notes, decisions or anything else as typed rows in a .emd file on your disk, and Claude asks for the rows it needs. No account and no network call.',
    long_description:
      "Emerald's engine as a local MCP server. A `.emd` file is a real SQLite database on your disk. Declare a format for any kind of thing you keep, read a spreadsheet, a `.json` of rows or a folder of Markdown notes onto it, and Claude asks for the matching rows instead of re-reading files. Every write is a dry run until you say commit. Every tool takes the absolute path of the `.emd` it works on. The server opens the file it is given and makes no network call of its own.",
    // The bare name, as the plugin's manifest has it: the app makes the extension's id from it, and
    // `Name <email>` would put the address in the id.
    author: { name: (app.author.name ?? app.author).replace(/\s*[<(].*$/, ''), url: 'https://getemerald.dev' },
    repository: { type: 'git', url: 'https://github.com/kfireliyahu/emerald-emd' },
    homepage: 'https://getemerald.dev',
    documentation: 'https://github.com/kfireliyahu/emerald-emd/blob/main/hosts/claude/README.md',
    support: 'https://github.com/kfireliyahu/emerald-emd/issues',
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: SERVER,
      mcp_config: { command: 'node', args: [`\${__dirname}/${SERVER}`, ...ARGS] },
    },
    tools: tools.map((tool) => ({ name: tool.name, description: firstSentence(tool.description ?? '') })),
    tools_generated: false,
    keywords: ['local-first', 'sqlite', 'spreadsheet', 'documents', 'formats', 'mcp-apps'],
    license: app.license,
    privacy_policies: ['https://github.com/kfireliyahu/emerald-emd/blob/main/PRIVACY.md'],
    compatibility: { platforms: ['darwin', 'win32'], runtimes: { node: '>=20.19.0' } },
  }
}

if (!existsSync(join(built, SERVER))) {
  console.error('dist-plugin/server.mjs is missing: run `npm run build:plugin` first.')
  process.exit(1)
}

const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
for (const file of [SERVER, 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) copyFileSync(join(built, file), join(stage, file))
copyFileSync(join(root, 'build', 'extension.png'), join(stage, 'icon.png'))
const tools = await toolsOf(join(stage, SERVER))
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest(app, tools), null, 2)}\n`)

mkdirSync(join(root, 'release'), { recursive: true })
const cli = join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js')
const packed = spawnSync(process.execPath, [cli, 'pack', stage, output], { stdio: 'inherit' })
if (packed.status !== 0) process.exit(packed.status ?? 1)
console.log(`${output}: ${tools.length} tools, version ${app.version}`)
