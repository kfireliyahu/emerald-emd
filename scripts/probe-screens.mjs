#!/usr/bin/env node
/**
 * **A screen measured in one command, with no browser pane** (D-534): the demo
 * served by Vite in this process on a free port, the app opened in an offscreen
 * Electron window, and `window.emeraldProbe()` (src/ui/probe.ts) run over every
 * route and theme asked for — text under AA, type off the ramp, controls with no
 * name or only a placeholder, round fields, platform selects and date inputs,
 * headings, a page wider than its window. It prints what it found and exits.
 *
 * Why not the pane: M54's units made 927 browser calls, most of them measuring
 * these same things by hand, and every unit that reviewed a screen needed the
 * one pane and the one demo port, so none could run beside another. This takes
 * neither — a worktree runs its own — and it is `check:tours`' Electron, so no
 * new dependency. The pane stays for what needs eyes: a screenshot, or a flow
 * clicked through.
 *
 * The demo documents are made once into `.demo/` (`make-demo-document.mjs`,
 * which needs `npm run build:plugin`); `--fresh` makes them again.
 *
 * Usage:
 *   node scripts/probe-screens.mjs --document project.emd --routes formats,dashboard
 *   node scripts/probe-screens.mjs --document custom.emd --routes '#/formats/card_charge/entry/new' --themes dark
 *   options: --themes light,dark (both by default) · --size 1280x800 · --root main
 *            --limit 10 (entries per list) · --json (everything, as JSON) · --fresh
 */

import { spawn, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import electron from 'electron'
import { createServer } from 'vite'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : (args[at + 1] ?? fallback)
}
const list = (value) => value.split(',').map((part) => part.trim()).filter(Boolean)

const document = option('document', 'custom.emd')
if (!/^[a-z0-9-]+\.emd$/.test(document)) {
  console.error(`--document takes a demo document's name, like project.emd, not ${document}.`)
  process.exit(1)
}
const probeOptions = {
  routes: list(option('routes', '')),
  themes: list(option('themes', 'light,dark')),
  root: option('root', undefined),
  limit: Number(option('limit', '10')),
}
const size = option('size', '1280x800')

if (args.includes('--fresh') || !statSync(path.join(REPO, '.demo', document), { throwIfNoEntry: false })) {
  console.error('Making the demo documents (once per checkout)…')
  const made = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'make-demo-document.mjs')], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (made.status !== 0) process.exit(made.status ?? 1)
}

const vite = await createServer({
  configFile: path.join(REPO, 'vite.config.ts'),
  root: REPO,
  mode: 'demo',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
})
await vite.listen()
const address = vite.httpServer?.address()
const base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}/`

const started = Date.now()
const window = spawn(String(electron), [path.join(REPO, 'scripts', 'probe-screens-window.cjs')], {
  env: {
    ...process.env,
    PROBE_BASE: base,
    PROBE_URL: `${base}app.html?document=${document}`,
    PROBE_OPTIONS: JSON.stringify(probeOptions),
    PROBE_SIZE: size,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let out = ''
window.stdout.on('data', (chunk) => (out += String(chunk)))
const code = await new Promise((resolve) => window.on('exit', resolve))
await vite.close()

const line = out.split('\n').find((text) => text.startsWith('{'))
if (code !== 0 || !line) {
  console.error(`The probe's window stopped (exit ${String(code)}) with no answer.`)
  process.exit(1)
}
const found = JSON.parse(line)
if (args.includes('--json')) {
  console.log(JSON.stringify(found, null, 1))
  process.exit(0)
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
const items = (named, show) => (named.count === 0 ? '' : `\n    ${named.items.map(show).join('\n    ')}${named.count > named.items.length ? `\n    … ${String(named.count - named.items.length)} more` : ''}`)
for (const r of found.results) {
  const counts = [
    `low contrast ${String(r.lowContrast.count)}`,
    `off the ramp ${String(r.offRamp.count)}`,
    `no name ${String(r.unnamed.count)}`,
    `placeholder only ${String(r.placeholderOnly.count)}`,
    `round fields ${String(r.roundedFields.count)}`,
    `selects ${String(r.platformSelects)}`,
    `date inputs ${String(r.nativeDates)}`,
  ].join(' · ')
  console.log(`${r.route} · ${r.theme} · ${String(r.width)}px · h1 ${r.h1.length === 0 ? 'none' : r.h1.map((h) => `"${h}"`).join(', ')}${r.headingSkips.length ? ` · skips ${r.headingSkips.join(', ')}` : ''}${r.pageOverflowsX ? ' · PAGE SCROLLS SIDEWAYS' : ''}`)
  console.log(`  ${counts}`)
  const detail = [
    r.lowContrast.count ? `  low contrast:${items(r.lowContrast, (i) => `${String(i.ratio)} < ${String(i.needs)} at ${i.size}: ${i.text}`)}` : '',
    r.offRamp.count ? `  off the ramp:${items(r.offRamp, (i) => `${i.size}: ${i.text}`)}` : '',
    r.unnamed.count ? `  no name:${items(r.unnamed, (i) => i.html)}` : '',
    r.placeholderOnly.count ? `  placeholder only:${items(r.placeholderOnly, (i) => i.placeholder)}` : '',
    r.roundedFields.count ? `  round fields:${items(r.roundedFields, (i) => `${i.tag} ${i.radius} ${i.name}`)}` : '',
  ].filter(Boolean)
  if (detail.length) console.log(detail.join('\n'))
}
if (found.refused.length) console.log(`Requests refused (nothing leaves the page): ${found.refused.join(', ')}`)
console.log(`${String(found.results.length)} measurement(s) in ${seconds} s.`)
