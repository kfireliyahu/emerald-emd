#!/usr/bin/env node
/**
 * Builds the documents the demo opens (M33 U1, U2; D-413): one per tour.
 *
 * **A document is never committed.** It is made here, at build time, by
 * driving `dist-plugin/server.mjs` over stdio, as an MCP client does, so every
 * build of the demo is a document this build's own engine wrote, at this
 * build's schema. A committed `.emd` would be
 * one migration behind the first time somebody forgot it.
 *
 * Everything in them comes from committed synthetic sources:
 *   - `demo.emd`, the ledger tour's (U1, played by U5): the ledger pack,
 *     `fixtures/synthetic/demo/card-statement-2026-08.xlsx` (made up and in
 *     English, like every shop on it) read through the ledger's
 *     own import (which refuses a file whose printed total does not
 *     reconcile) and its columns kept as a reader, and from
 *     `fixtures/synthetic/demo/ledger.json` the rules that file what it left
 *     unfiled, three months of pay, a goal, a debt and the savings
 *     counted. The next statement,
 *     the one the tour reads, is bundled beside the page (`bundled.json`)
 *   - `custom.emd`, the custom tour's (U2): **no pack at all**, one declared
 *     `card_charge` format and its rows from `fixtures/synthetic/demo/
 *     card-charges.json`, and the document's currency, ILS, so an amount typed
 *     on a sheet starts in it; and `receipt.png`, copied beside it for the
 *     frame to show
 *   - `project.emd`, the development tour's (U6): a made-up project — a
 *     service with a versioned API (M33 F6) — in the development pack's formats, as
 *     a text document: the pack's own declarations and views from
 *     `src/data/packs/development/`, each under its rows from
 *     `fixtures/synthetic/demo/project.md`, so the pack is the one a real
 *     project keeps and the rail shows it as it shows `docs/memory.emd`'s
 *   - `timesheet.emd`, the timesheet tour's (U7): the ledger pack, one
 *     paycheck and the plan its net goes to, from `fixtures/synthetic/demo/timesheet.json`, and nothing of a
 *     timesheet — the tour declares it, connects it and types its days
 *   - `tours.emd`, every tour (U3): `tour.format.md` and `tour_step.format.md`
 *     from `fixtures/synthetic/demo/`, declarations and rows, as the two parts
 *     of a text document at this build's schema — the file a text document
 *     already is (D-244), so the tours are written where a person reads them,
 *     and the build reads them back through the plugin before it goes on. The
 *     frame reads them through the engine; **no tour is in the document it
 *     plays** (D-414)
 *
 * The formats later tours need are added here by the units that write those
 * tours (U5–U7), from files beside `ledger.json`, and their steps to
 * `tour_step.format.md`.
 *
 * Any tool that answers with an error fails the build: a demo that opens on a
 * half-made document is worse than no demo.
 *
 * Usage (npm run build:demo does all three):
 *   npm run build:plugin
 *   node scripts/make-demo-document.mjs [folder]   default: .demo/
 *   vite build --mode demo                         copies .demo/ into dist-demo/
 */

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { makeShowcase } from './demo-showcase.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(REPO, 'dist-plugin', 'server.mjs')
const FIXTURES = path.join(REPO, 'fixtures', 'synthetic')
const SOURCES = JSON.parse(readFileSync(path.join(FIXTURES, 'demo', 'ledger.json'), 'utf8'))
const CHARGES = JSON.parse(readFileSync(path.join(FIXTURES, 'demo', 'card-charges.json'), 'utf8'))
const TIMESHEET = JSON.parse(readFileSync(path.join(FIXTURES, 'demo', 'timesheet.json'), 'utf8'))
const SHOWCASE = JSON.parse(readFileSync(path.join(FIXTURES, 'demo', 'showcase.json'), 'utf8'))

const folder = path.resolve(process.argv[2] ?? path.join(REPO, '.demo'))

try {
  statSync(SERVER)
} catch {
  console.error(`No ${path.relative(REPO, SERVER)} — run npm run build:plugin first.`)
  process.exit(1)
}

mkdirSync(folder, { recursive: true })

const client = new Client({ name: 'make-demo-document', version: '0.1.0' }, { capabilities: {} })
// The copies a write takes go to Emerald's own per-user folder (D-455); a build's
// go to a folder of its own, removed when it is done, never the machine's.
const copies = mkdtempSync(path.join(tmpdir(), 'emerald-demo-copies-'))
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, EMERALD_BACKUPS_DIR: copies },
  }),
)

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content ?? []).map((part) => part.text ?? '').join('\n')
  // A refusal is not always an error: a declaration that cannot be accepted
  // answers in prose that nothing was written. Either way, the build stops.
  if (result.isError || /nothing was written|declares no formats/i.test(text)) {
    await client.close()
    throw new Error(`${name} refused:\n${text.slice(0, 1200)}`)
  }
  console.log(`  ${name}`)
  return text
}

/** A fresh document at `name` in the folder, with the packs named. */
async function fresh(name, packs) {
  const target = path.join(folder, name)
  rmSync(target, { force: true })
  console.log(`Making the demo document: ${path.relative(REPO, target)}`)
  await call('create_document', { path: target, packs })
  return target
}

// The ledger tour's (U1): a statement makes its account (D-313).
const ledger = await fresh('demo.emd', ['ledger'])
await call('import_statement', {
  path: ledger,
  file: path.join(FIXTURES, SOURCES.statement.file),
  new_account: SOURCES.statement.account,
  // Kept as a reader, so the statement the tour reads is known on sight (U5).
  save_mapping_as: SOURCES.statement.reader,
  commit: true,
})
// The shops last month's statement left unfiled, filed by rules — which file
// the same shops in the tour's statement too (U5). A rule commits on the token
// its preview printed.
for (const rule of SOURCES.rules) {
  const preview = await call('create_rule', { path: ledger, ...rule })
  const confirmation = /confirmation: "([^"]+)"/.exec(preview)?.[1]
  if (confirmation === undefined) throw new Error(`create_rule printed no token:
${preview.slice(0, 600)}`)
  await call('create_rule', { path: ledger, ...rule, confirmation, commit: true })
}
await call('record_paychecks', { path: ledger, paychecks: SOURCES.paychecks, commit: true })
await call('create_goals', { path: ledger, goals: SOURCES.goals, commit: true })
await call('create_debts', { path: ledger, debts: SOURCES.debts, commit: true })
// Lived in (U5): the savings were counted lately, so Home does not ask about
// them once the tour's statement is read. Nothing tells the detector the shops
// are not bills: two statements of the same shops are not evidence of one (M37 F2).
await call('record_holding_readings', { path: ledger, readings: SOURCES.readings, commit: true })

// The custom tour's (U2): no pack, card charges as a format somebody declared.
const custom = await fresh('custom.emd', [])
await call('record_units', { path: custom, currency: CHARGES.currency, commit: true })
await call('declare_format', { path: custom, ...CHARGES.format, commit: true })
await call('record_format_rows', { path: custom, format: CHARGES.format.format, rows: CHARGES.rows, commit: true })

// The timesheet tour's (U7): the ledger and the paycheck the tour's days are claimed against.
const timesheet = await fresh('timesheet.emd', ['ledger'])
await call('record_units', { path: timesheet, currency: TIMESHEET.currency, commit: true })
await call('record_paychecks', { path: timesheet, paychecks: TIMESHEET.paychecks, commit: true })
// A plan the net goes to, so scene 1 has nothing red that is not the story (M33 F7).
await call('set_plan', { path: timesheet, plans: TIMESHEET.plans, commit: true })

// The ledger's pictures on Emerald's page (M33 F12): a made-up year in a document of
// its own, so no tour's document changes under its tour.
const showcase = await fresh('showcase.emd', ['ledger'])
await makeShowcase(showcase, SHOWCASE, call)

// The development tour's (U6): the pack's declarations and views, each format
// under its rows from `project.md`, as the parts of a text document — the
// file `docs/memory.emd` is, at this build's schema. Read back below.
const PACK = path.join(REPO, 'src', 'data', 'packs', 'development')
const lf = (text) => text.replace(/\r\n/g, '\n').replace(/\n+$/, '')
const projectRows = new Map(
  lf(readFileSync(path.join(FIXTURES, 'demo', 'project.md'), 'utf8'))
    .replace(/^<!--[\s\S]*?-->\n*/, '')
    .split(/^## /m)
    .filter((each) => each.trim() !== '')
    .map((each) => {
      const [name = '', ...rest] = each.split('\n')
      return [name.trim(), rest.join('\n').trim()]
    }),
)
const packParts = readdirSync(path.join(PACK, 'formats'))
  .filter((name) => name.endsWith('.format.md'))
  .sort()
  .map((name) => {
    const rows = projectRows.get(name.replace(/\.format\.md$/, '')) ?? ''
    const declared = lf(readFileSync(path.join(PACK, 'formats', name), 'utf8'))
    return `<!-- emerald: ${name} -->\n${declared}\n${rows === '' ? '' : `\n${rows}\n`}`
  })

// Every tour (U3): the committed parts, joined as `joinParts` joins them, under
// the header of this build's schema — which the plugin says when it makes a
// document, so the number is never copied here.
const tours = path.join(folder, 'tours.emd')
rmSync(tours, { force: true })
console.log(`Making the demo document: ${path.relative(REPO, tours)}`)
const made = await call('create_document', { path: tours, packs: [] })
const schema = /schema version (\d+)/.exec(made)?.[1]
if (schema === undefined) throw new Error(`create_document did not say its schema:\n${made}`)
const part = (name) =>
  `<!-- emerald: ${name} -->\n` +
  `${readFileSync(path.join(FIXTURES, 'demo', name), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '')}\n`
writeFileSync(
  tours,
  [`<!-- emerald document, schema ${schema} -->`, part('tour.format.md'), part('tour_step.format.md')].join('\n'),
)
// The development tour's document (U6), under the same header.
const project = path.join(folder, 'project.emd')
rmSync(project, { force: true })
console.log(`Making the demo document: ${path.relative(REPO, project)}`)
// The pack's views, with the widths `project.md` keeps put after their header.
const packViews = lf(readFileSync(path.join(PACK, 'views.md'), 'utf8'))
const widths = projectRows.get('views') ?? ''
const views = `<!-- emerald: views.md -->\n${packViews.replace(/^---\nemerald: views\n---\n/, (header) => `${header}\n${widths}\n`)}\n`
writeFileSync(project, [`<!-- emerald document, schema ${schema} -->`, ...packParts, views].join('\n'))
for (const [format, count] of [['milestone', 3], ['unit', 7], ['decision', 4]]) {
  const answer = await call('format_rows', { path: project, format, limit: 1 })
  if (!new RegExp(`^${String(count)} rows of`, 'm').test(answer)) {
    throw new Error(`project.emd: ${format} did not read back ${String(count)} rows:\n${answer.slice(0, 600)}`)
  }
}

// Read back through the engine: a step it refuses fails the build here, not the demo.
for (const format of ['tour', 'tour_step']) {
  const answer = await call('format_rows', { path: tours, format, limit: 1 })
  if (!/^\d+ rows? of/m.test(answer)) throw new Error(`tours.emd: ${format} did not read back:
${answer.slice(0, 600)}`)
}

await client.close()
rmSync(copies, { recursive: true, force: true })

// The plugin keeps a named copy beside a large write — a
// `<name>.before-<when>-<what>.emd` — and the whole folder is served beside the
// page, so the demo ships its documents and nothing else. (A `.bak` from before
// D-455 is cleared too.)
for (const name of readdirSync(folder)) {
  if (name.endsWith('.bak') || /\.before-.*\.emd$/.test(name)) rmSync(path.join(folder, name), { force: true })
}

// The picture the frame shows beside the sheet, served beside the documents.
copyFileSync(path.join(FIXTURES, 'demo', 'receipt.png'), path.join(folder, 'receipt.png'))

// The recordings for Emerald's page (M33 F11), once they are made,
// and the ledger's pictures (M33 F12, npm run demo:shots): served beside the page.
for (const name of readdirSync(path.join(FIXTURES, 'demo'))) {
  if (/\.(mp4|webm)$/.test(name) || /^ledger-[a-z-]+\.png$/.test(name)) {
    copyFileSync(path.join(FIXTURES, 'demo', name), path.join(folder, name))
  }
}

// The files the demo's picker offers (U5): the only demo-only control, a list
// of these where the app opens the system's file picker. Beside the page, with
// the list of them as `bundled.json`.
const bundled = [SOURCES.next.file]
for (const name of bundled) copyFileSync(path.join(FIXTURES, 'demo', name), path.join(folder, name))
writeFileSync(path.join(folder, 'bundled.json'), `${JSON.stringify(bundled)}
`)

for (const each of [ledger, custom, timesheet, showcase, project, tours]) {
  console.log(`Made ${path.relative(REPO, each)} (${Math.round(statSync(each).size / 1024)} KB)`)
}
