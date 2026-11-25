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
 *   node scripts/probe-screens.mjs --document year.emd --routes '#/,#/year,#/specimen'   (the synthetic year, M64 U16)
 *   node scripts/probe-screens.mjs --document custom.emd --routes '#/formats/card_charge/entry/new' --themes dark
 *   options: --themes light,dark (both by default) · --size 1280x800 · --root main
 *            --limit 10 (entries per list) · --json (everything, as JSON) · --fresh
 *            --dir rtl (or --lang he): the page mirrored as Hebrew draws it (M60 U3, D-586),
 *            with the rail's side and what is cut off sideways measured; --dir ltr pins it.
 *            --lang he also draws the app's words in Hebrew and lists what is still
 *            English outside a document's own values (M60 U4, D-589)
 *            --screen main: what the density measures read, the screen and not the chrome
 *            --budget limits.json: limits per route, exits 1 naming each one a screen is over
 *            --shots: a picture of every route and theme into .probe/shots/ (git ignores it),
 *            and .probe/shots/index.html, a contact sheet of every picture there (M64 U2, D-612)
 *
 * **Density** (M64 U2, D-612) is measured on every run: the words in the screen
 * and how many sit above the fold, its blocks (a heading-led section, a table, a
 * chart, a list of 3+ rows, a `data-block`), its headline figures (the
 * secondary-number step or larger, or a `data-figure`), its actions and how many
 * are primary, the type sizes and colours it spends, and how many windows tall it
 * is. A budget is JSON keyed by route hash, `*` for every route, each a set of
 * maximums named as the measures are:
 *   { "*": { "primary": 1 }, "#/": { "words": 300, "blocks": 6, "screens": 1.5 } }
 * (words, wordsAboveFold, blocks, blocksAboveFold, figures, actions, primary,
 * typeSizes, colours, screens).
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
  dir: option('dir', option('lang', undefined) === undefined ? undefined : option('lang') === 'he' ? 'rtl' : 'ltr'),
  lang: option('lang', undefined),
  screen: option('screen', undefined),
  budget: undefined,
}
const budgetFile = option('budget', undefined)
if (budgetFile !== undefined) {
  try {
    probeOptions.budget = JSON.parse(readFileSync(path.resolve(budgetFile), 'utf8'))
  } catch (error) {
    console.error(`--budget could not read ${budgetFile}: ${String(error?.message ?? error)}`)
    process.exit(1)
  }
}
/** Pictures go only here, which git ignores: never commit a picture (D-608). */
const SHOTS = path.join(REPO, '.probe', 'shots')
const shots = args.includes('--shots')
if (probeOptions.dir !== undefined && probeOptions.dir !== 'rtl' && probeOptions.dir !== 'ltr') {
  console.error(`--dir takes rtl or ltr, not ${String(probeOptions.dir)}.`)
  process.exit(1)
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
    ...(shots ? { PROBE_SHOTS: SHOTS, PROBE_PREFIX: document.replace(/\.emd$/, '') } : {}),
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
const breaches = found.results.flatMap((r) => r.breaches.map((breach) => `${r.route} · ${r.theme}: ${breach}`))
if (shots) contactSheet(found)
if (args.includes('--json')) {
  console.log(JSON.stringify(found, null, 1))
  process.exit(breaches.length ? 1 : 0)
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
    `cut off sideways ${String(r.clippedX.count)}`,
    ...(r.english.count || probeOptions.lang === 'he' ? [`english ${String(r.english.count)}`] : []),
  ].join(' · ')
  console.log(`${r.route} · ${r.theme} · ${r.dir} · rail ${r.railSide} · ${String(r.width)}px · h1 ${r.h1.length === 0 ? 'none' : r.h1.map((h) => `"${h}"`).join(', ')}${r.headingSkips.length ? ` · skips ${r.headingSkips.join(', ')}` : ''}${r.pageOverflowsX ? ' · PAGE SCROLLS SIDEWAYS' : ''}`)
  console.log(`  ${counts}`)
  console.log(`  ${densityLine(r.density)}`)
  if (r.density.blocks.count) console.log(`  blocks:${items(r.density.blocks, (b) => `${b.kind}${b.aboveFold ? '' : ' (below the fold)'}: ${b.label}`)}`)
  if (r.density.figures.count) console.log(`  figures: ${r.density.figures.items.map((f) => `${f.text} (${String(f.size)}px)`).join(' · ')}`)
  if (r.breaches.length) console.log(`  OVER BUDGET: ${r.breaches.join(' · ')}`)
  const detail = [
    r.lowContrast.count ? `  low contrast:${items(r.lowContrast, (i) => `${String(i.ratio)} < ${String(i.needs)} at ${i.size}: ${i.text}`)}` : '',
    r.offRamp.count ? `  off the ramp:${items(r.offRamp, (i) => `${i.size}: ${i.text}`)}` : '',
    r.unnamed.count ? `  no name:${items(r.unnamed, (i) => i.html)}` : '',
    r.placeholderOnly.count ? `  placeholder only:${items(r.placeholderOnly, (i) => i.placeholder)}` : '',
    r.roundedFields.count ? `  round fields:${items(r.roundedFields, (i) => `${i.tag} ${i.radius} ${i.name}`)}` : '',
    r.clippedX.count ? `  cut off sideways:${items(r.clippedX, (i) => `${i.text} (by ${i.by})`)}` : '',
    r.english.count ? `  still english:${items(r.english, (i) => i.text)}` : '',
  ].filter(Boolean)
  if (detail.length) console.log(detail.join('\n'))
}
if (found.refused.length) console.log(`Requests refused (nothing leaves the page): ${found.refused.join(', ')}`)
console.log(`${String(found.results.length)} measurement(s) in ${seconds} s.`)
if (shots) console.log(`${String(found.shots.length)} picture(s) in .probe/shots/, and the contact sheet: .probe/shots/index.html`)
if (breaches.length) {
  console.log(`Over budget (${String(breaches.length)}):\n  ${breaches.join('\n  ')}`)
  process.exit(1)
}

/** One line of a screen's density: what it holds, and how much of it is above the fold. */
function densityLine(d) {
  return [
    `${String(d.words)} words (${String(d.wordsAboveFold)} above the fold)`,
    `${String(d.blocks.count)} blocks (${String(d.blocksAboveFold)} above)`,
    `${String(d.figures.count)} figures`,
    `${String(d.actions)} actions (${String(d.primary)} primary)`,
    `${String(d.typeSizes.length)} type sizes`,
    `${String(d.colours.length)} colours`,
    `${String(d.screens)} screens long`,
  ].join(' · ')
}

/**
 * **The whole app on one page** (M64 U2, D-612): this run's pictures written
 * down beside them as `<document>.json`, and `index.html` made again from every
 * such list in the folder — grouped by document and section, light and dark side
 * by side, the fold marked, and each screen's density under it. It references
 * only the pictures beside it.
 */
function contactSheet(found) {
  mkdirSync(SHOTS, { recursive: true })
  const prefix = document.replace(/\.emd$/, '')
  const byKey = new Map(found.results.map((r) => [`${r.route}|${r.theme}`, r]))
  const entries = found.shots.map((shot) => ({ ...shot, density: byKey.get(`${shot.route}|${shot.theme}`)?.density, fold: Number(size.split('x')[1]) }))
  writeFileSync(path.join(SHOTS, `${prefix}.json`), `${JSON.stringify({ document, size, entries }, null, 1)}\n`)
  const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const lists = readdirSync(SHOTS)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(SHOTS, name), 'utf8')))
    .sort((a, b) => (a.document === 'year.emd' ? -1 : b.document === 'year.emd' ? 1 : a.document.localeCompare(b.document)))
  const sections = []
  for (const list of lists) {
    const groups = new Map()
    for (const entry of list.entries) {
      const section = entry.route.replace(/^#\/?/, '').split('/')[0] || 'home'
      const routes = groups.get(section) ?? new Map()
      const pair = routes.get(entry.route) ?? {}
      pair[entry.theme] = entry
      routes.set(entry.route, pair)
      groups.set(section, routes)
    }
    for (const [section, routes] of groups) {
      const figures = [...routes].map(([route, pair]) => {
        const any = pair.light ?? pair.dark
        const shot = (entry) =>
          entry === undefined
            ? '<div class="none">not taken</div>'
            : `<a class="shot" href="${escape(entry.file)}"><img loading="lazy" src="${escape(entry.file)}" alt="${escape(`${route} ${entry.theme}`)}"><i class="fold" style="top:${String((entry.fold / entry.height) * 100)}%"></i></a>`
        return `<figure><figcaption><b>${escape(route)}</b>${any?.density ? ` <span>${escape(densityLine(any.density))}</span>` : ''}</figcaption><div class="pair">${shot(pair.light)}${shot(pair.dark)}</div></figure>`
      })
      sections.push(`<section><h2>${escape(list.document)} · ${escape(section)}</h2>${figures.join('')}</section>`)
    }
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Every screen</title>
<style>
:root { color-scheme: light dark; --bg: #f7f7f5; --ink: #1a1a1a; --muted: #5c5c5c; --line: #d9d9d4; }
@media (prefers-color-scheme: dark) { :root { --bg: #131413; --ink: #ececea; --muted: #a3a3a0; --line: #333532; } }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--ink); font: 14px/1.5 system-ui, sans-serif; }
h1 { font-size: 24px; margin: 0 0 8px; } h2 { font-size: 16px; margin: 32px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
p { color: var(--muted); margin: 0 0 16px; }
figure { margin: 0 0 24px; } figcaption { margin-bottom: 8px; } figcaption span { color: var(--muted); font-size: 12px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.shot { position: relative; display: block; border: 1px solid var(--line); }
.shot img { display: block; width: 100%; height: auto; }
.fold { position: absolute; left: 0; right: 0; border-top: 2px dashed #d0342c; }
.none { color: var(--muted); padding: 16px; border: 1px dashed var(--line); }
</style></head><body>
<h1>Every screen</h1>
<p>Made by <code>npm run probe:screens -- --shots</code> from the demo documents only. Light on the left, dark on the right; the dashed line is the fold at ${escape(size)}. Each picture opens full size.</p>
${sections.join('\n')}
</body></html>
`
  writeFileSync(path.join(SHOTS, 'index.html'), html)
}
