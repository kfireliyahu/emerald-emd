#!/usr/bin/env node
/**
 * **Every tour, replayed in a real browser** (M33 U3, D-413): `dist-demo/`
 * served on loopback, the frame opened with `?check` in a hidden Electron
 * window, and each tour played once at fast-forward — no travel, no typing, no
 * holds — over the document as the app page opened it. It fails on the first
 * step whose anchor, or whose highlight, never comes on the screen, naming the
 * step, so a screen that changes under a tour breaks the build rather than the
 * demo — and, at a phone size, on one whose ring would be outside the crop's
 * window (M33 F4, D-426).
 *
 * **It plays the frame itself**, not a copy of the runner: the strip, the
 * layout the frame gives the app at that size (`layout.ts`) and the paper
 * beside it in its scene are all there. It runs at two sizes by default — a
 * desktop, where the app is laid out at the window's width, and a phone, where
 * it is laid out at `LAYOUT_LEAST` and drawn as a crop around the action — because
 * an anchor can be on the screen at one and not the other. **And nothing
 * leaves the page** (M33 U4): a request for anything this server does not
 * serve is refused in the window and fails the check, by URL.
 *
 * Electron rather than a new dependency: it is already in devDependencies (the
 * icons and the receipt are drawn with it), and it is Chromium. The window
 * script is `.cjs` for `make-icons.cjs`'s reason — the main process hangs on
 * `app.whenReady()` when the entry is an ES module — so this file serves and
 * reports, and `check-tours-window.cjs` drives.
 *
 * Usage:
 *   npm run check:tours                      builds the demo, then checks it
 *   node scripts/check-tours.mjs [--sizes 1280x800,375x440] [folder]
 *                                            checks a built dist-demo/ as it is
 */

import { spawn } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import electron from 'electron'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const sizesAt = args.indexOf('--sizes')
const sizes = (sizesAt === -1 ? '1280x800,375x440' : (args[sizesAt + 1] ?? '')).split(',').filter(Boolean)
const rest = args.filter((_, index) => index !== sizesAt && index !== sizesAt + 1)
const folder = path.resolve(rest[0] ?? path.join(REPO, 'dist-demo'))

for (const needed of ['index.html', 'tour.html', 'app.html', 'tours.emd']) {
  try {
    statSync(path.join(folder, needed))
  } catch {
    console.error(`No ${path.relative(REPO, path.join(folder, needed))} — run npm run build:demo first.`)
    process.exit(1)
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.emd': 'application/octet-stream',
}

// The folder, as a static host serves it: `/` is index.html (Emerald's page, M33 U8; the
// frame is tour.html beside it), and nothing outside it.
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
  const file = path.join(folder, pathname === '/' ? 'index.html' : pathname)
  if (!file.startsWith(folder) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(response)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}/`

const started = Date.now()
const window = spawn(String(electron), [path.join(REPO, 'scripts', 'check-tours-window.cjs')], {
  env: { ...process.env, TOURS_BASE: base, TOURS_SIZES: sizes.join(',') },
  stdio: ['ignore', 'pipe', 'inherit'],
})

let failed = false
let checked = 0
let buffered = ''
window.stdout.on('data', (chunk) => {
  buffered += String(chunk)
  for (let at = buffered.indexOf('\n'); at !== -1; at = buffered.indexOf('\n')) {
    const line = buffered.slice(0, at).trim()
    buffered = buffered.slice(at + 1)
    if (!line.startsWith('{')) continue
    const found = JSON.parse(line)
    checked += 1
    const where = `${found.tour || '(no tour)'} at ${found.size}`
    if (found.result.ok) {
      console.log(found.result.steps === 0 ? `  ok    ${found.tour}` : `  ok    ${where}: ${String(found.result.steps)} steps in ${String(found.result.ms)} ms`)
    } else {
      failed = true
      console.log(`  FAIL  ${where}: ${found.result.said}`)
    }
  }
})

const code = await new Promise((resolve) => window.on('exit', resolve))
server.close()
const seconds = ((Date.now() - started) / 1000).toFixed(1)
if (code !== 0 || checked === 0) {
  console.error(`The check's window stopped (exit ${String(code)}) after ${String(checked)} tour(s).`)
  process.exit(1)
}
console.log(`${failed ? 'Failed' : 'Every tour played'}: ${String(checked)} run(s) in ${seconds} s.`)
process.exit(failed ? 1 : 0)
