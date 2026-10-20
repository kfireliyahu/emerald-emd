/**
 * The npm package, run as a stranger runs it, on whatever `node` runs this (M42 F13, D-510): the
 * proof behind `engines` in `scripts/npm-package.mjs`, so the range claims only a Node that CI ran.
 *
 *   npm run build:plugin && npm run check:package     # or node scripts/check-package.mjs [<folder>]
 *
 * Against a document it makes in an empty folder, with nothing installed:
 *
 * 1. **The server's handshake** — `server.mjs --engine-only` over stdio: `initialize`, `tools/list`,
 *    then `create_document` with the development pack, an inbox row recorded with `commit: true`, and
 *    `start_here` reading the document back; and the full server, without the flag, listing more.
 * 2. **A hook run** — `hooks.mjs start-here <folder>` and `hooks.mjs rows <folder> inbox --match
 *    state=new`, each printing the row; `status-line.mjs <folder>` exits cleanly.
 * 3. **Through npm, as the plugin calls it** — `npm pack`, then `npx -y -p <tarball> emerald-hooks
 *    rows …` with an empty npm cache, which installs the package and checks its `engines` on the way.
 *    On a Node below the range npm prints `npm warn EBADENGINE` before every hook (seen on a cloud
 *    host's Node 22, 2026-10-20); that warning fails the check.
 *
 * It imports only Node's own modules and runs on the oldest Node it checks. It writes nothing in
 * the repository: the document, the tarball and the npm cache go in a temporary folder.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const folder = resolve(root, process.argv[2] ?? 'dist-plugin')
const node = process.execPath

for (const file of ['server.mjs', 'hooks.mjs', 'status-line.mjs', 'package.json']) {
  if (!existsSync(join(folder, file))) {
    console.error(`check-package: ${join(folder, file)} is missing; run \`npm run build:plugin\` first`)
    process.exit(1)
  }
}
const { version, engines } = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))
console.log(`emerald-mcp ${version} (engines ${engines?.node ?? 'none'}) on Node ${process.versions.node}`)

const work = mkdtempSync(join(tmpdir(), 'emerald-check-package-'))
const project = join(work, 'project')
const path = join(project, 'project.emd')
const SUBJECT = 'A row the hooks print'
mkdirSync(project)

let failed = false
function check(ok, what, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) {
    failed = true
    if (detail) console.log(detail.replace(/^/gm, '     '))
  }
}

/** One stdio server, spoken to one request at a time. */
function serve(args) {
  const child = spawn(node, [join(folder, 'server.mjs'), ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  const waiting = new Map()
  let buffer = ''
  let stderr = ''
  let next = 1
  child.stderr.on('data', (chunk) => (stderr += chunk))
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let at
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      if (!line) continue
      const message = JSON.parse(line)
      waiting.get(message.id)?.(message)
      waiting.delete(message.id)
    }
  })
  const exited = new Promise((done) => child.on('exit', done))
  return {
    request(method, params) {
      const id = next++
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      return Promise.race([
        new Promise((done) => waiting.set(id, done)),
        exited.then((code) => ({ error: { message: `the server exited (${code}): ${stderr}` } })),
        new Promise((done) => setTimeout(() => done({ error: { message: `no answer to ${method} in 60 s` } }), 60_000)),
      ])
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)
    },
    async call(name, args) {
      const answer = await this.request('tools/call', { name, arguments: args })
      const text = (answer.result?.content ?? []).map((part) => part.text ?? '').join('\n')
      return { ok: !answer.error && !answer.result?.isError, text: answer.error?.message ?? text }
    },
    close() {
      child.stdin.end()
      child.kill()
    },
  }
}

/** `npm-cli.js` or `npx-cli.js` of the npm installed with this Node: beside it on Windows, under `lib/` elsewhere. */
function npmCli(name) {
  const prefix = dirname(node)
  for (const npm of [join(prefix, 'node_modules', 'npm'), join(prefix, '..', 'lib', 'node_modules', 'npm')]) {
    if (existsSync(join(npm, 'bin', `${name}-cli.js`))) return join(npm, 'bin', `${name}-cli.js`)
  }
  console.error(`check-package: no npm installed with ${node}`)
  process.exit(1)
}

/** A bin run to the end, as a hook runs: its output, its errors, its exit code. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180_000, ...options })
  return { code: result.status, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}${result.error ? String(result.error) : ''}` }
}

try {
  // 1. The server's handshake, and a document it writes and reads back.
  const server = serve(['--engine-only'])
  const hello = await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'check-package', version: '1' },
  })
  check(Boolean(hello.result?.serverInfo), 'initialize', JSON.stringify(hello.error ?? hello))
  server.notify('notifications/initialized')
  const listed = await server.request('tools/list', {})
  const tools = listed.result?.tools ?? []
  check(tools.some((tool) => tool.name === 'start_here'), `tools/list (${tools.length} tools)`, JSON.stringify(listed.error ?? listed))

  const created = await server.call('create_document', { path, packs: ['development'] })
  check(created.ok && existsSync(path), 'create_document with the development pack', created.text)
  const recorded = await server.call('record_format_rows', {
    path,
    format: 'inbox',
    rows: [{ subject: SUBJECT, from: '/elsewhere/sender.emd', sent_on: '2026-10-20', state: 'new' }],
    commit: true,
  })
  check(recorded.ok, 'record_format_rows inbox, committed', recorded.text)
  const started = await server.call('start_here', { path })
  check(started.ok && started.text.includes(SUBJECT), 'start_here reads the row back', started.text)
  server.close()

  // The full server is the same file without the flag; it lists the ledger's tools too.
  const full = serve([])
  await full.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-package', version: '1' } })
  full.notify('notifications/initialized')
  const fullTools = (await full.request('tools/list', {})).result?.tools ?? []
  check(fullTools.length > tools.length, `tools/list without --engine-only (${fullTools.length} tools)`)
  full.close()

  // 2. The hooks, run from the folder as a hook runs them.
  const startHere = run(node, [join(folder, 'hooks.mjs'), 'start-here', project])
  check(startHere.code === 0 && startHere.stdout.includes(SUBJECT), 'hooks.mjs start-here', startHere.stderr || startHere.stdout)
  const rows = run(node, [join(folder, 'hooks.mjs'), 'rows', project, 'inbox', '--match', 'state=new'])
  check(rows.code === 0 && rows.stdout.includes(SUBJECT), 'hooks.mjs rows inbox --match state=new', rows.stderr || rows.stdout)
  const statusLine = run(node, [join(folder, 'status-line.mjs'), project], { input: '{}' })
  check(statusLine.code === 0, 'status-line.mjs', statusLine.stderr)

  // 3. Through npm: pack, then npx from an empty cache, which installs it and checks `engines`.
  // The npm that ships with this Node, run by this Node: one found on the PATH may be another's,
  // and would check the range against that Node instead.
  const packed = run(node, [npmCli('npm'), 'pack', folder, '--pack-destination', work, '--silent'])
  const tarball = join(work, packed.stdout.trim().split(/\s+/).pop() ?? '')
  check(packed.code === 0 && existsSync(tarball), 'npm pack', packed.stderr || packed.stdout)
  const viaNpx = run(
    node,
    [npmCli('npx'), '-y', '--cache', join(work, 'npm-cache'), '-p', tarball, 'emerald-hooks', 'rows', project, 'inbox', '--match', 'state=new'],
    // From the temporary folder, as a stranger runs it: inside the repository npm would see its package.
    { cwd: work, env: { ...process.env, npm_config_update_notifier: 'false' } },
  )
  check(viaNpx.code === 0 && viaNpx.stdout.includes(SUBJECT), 'npx -p <tarball> emerald-hooks rows', viaNpx.stderr || viaNpx.stdout)
  check(!/EBADENGINE/.test(viaNpx.stderr), 'npm prints no EBADENGINE warning', viaNpx.stderr)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failed) {
  console.error(`check-package: emerald-mcp ${version} does not run cleanly on Node ${process.versions.node}`)
  process.exit(1)
}
console.log(`check-package: emerald-mcp ${version} runs on Node ${process.versions.node}`)
