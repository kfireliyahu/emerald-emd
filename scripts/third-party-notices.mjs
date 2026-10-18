/**
 * The licences of everything a build bundles, written beside what it built (M43 U6, D-449).
 *
 * Emerald is AGPL-3.0-only, but the installers, the plugin and the demo also carry other
 * people's code: pdf.js, tesseract.js and SheetJS under Apache-2.0, sql.js, React and the MCP
 * SDK under MIT, the IBM Plex fonts under OFL-1.1. Each of those licences asks that its text and
 * notices travel with the copy, and electron-builder adds only Electron's and Chromium's. So
 * every build that ships something ends with this, and writes `THIRD_PARTY_NOTICES.txt` — and
 * Emerald's own `LICENSE`, as `LICENSE.txt` (M43 U7) — into each directory it is given:
 *
 *   node scripts/third-party-notices.mjs dist [dist-plugin ...]
 *
 * **What is listed is the production dependency tree**, what `npm ls --omit=dev` would print, read
 * from `package-lock.json` plus the files vendored outside npm. Not from `npm ls` itself: npm
 * redacts anything shaped like a UUID in what it prints, its old token format, so a clone under a
 * directory with one in its name read `***` for its own root and failed the build (M43 U9). That can name a package the bundler shook out entirely, which costs a
 * few lines; leaving out one it kept would be the breach, so it errs the cheap way.
 *
 * **It fails rather than guesses**: a package that declares no licence stops the build, because
 * a notices file that silently skips one is the same as having none.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Files in the bundle that did not come from npm, and where their licence text is. */
const VENDORED = [
  {
    name: 'heb.traineddata (public/tesseract/)',
    source: 'Tesseract OCR language data, github.com/tesseract-ocr',
    license: 'Apache-2.0',
    // The data files carry no licence file of their own; the text is the Apache licence,
    // printed from pdf.js's copy of it.
    textFrom: 'pdfjs-dist',
  },
]

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i

function licenceFiles(dir) {
  return readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').trim())
}

function declared(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
  return undefined
}

export function collectNotices() {
  const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
  // Every installed package the lockfile does not mark dev-only is in the production tree; a
  // platform's optional package that was never installed here is not. A missing package that is
  // not optional is an install that went wrong, and reading its package.json below says so.
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const dirs = Object.entries(lock.packages ?? {})
    .filter(([at, entry]) => at !== '' && !entry.dev && !entry.link)
    .map(([at, entry]) => ({ dir: join(root, at), optional: entry.optional === true }))
    .filter(({ dir, optional }) => !optional || existsSync(dir))
    .map(({ dir }) => dir)

  const byKey = new Map()
  const unlicensed = []
  for (const dir of dirs) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    if (pkg.name === own) continue
    const key = `${pkg.name}@${pkg.version}`
    if (byKey.has(key)) continue
    const license = declared(pkg)
    if (!license) unlicensed.push(key)
    byKey.set(key, { name: key, license: license ?? '?', texts: licenceFiles(dir) })
  }
  if (unlicensed.length > 0) {
    throw new Error(`These bundled packages declare no licence: ${unlicensed.join(', ')}`)
  }

  const entries = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const v of VENDORED) {
    const from = [...byKey.values()].find((e) => e.name.startsWith(`${v.textFrom}@`))
    if (!from || from.texts.length === 0) throw new Error(`No licence text to borrow for ${v.name}`)
    entries.push({ name: `${v.name}, ${v.source}`, license: v.license, texts: from.texts })
  }
  return entries
}

export function render(entries) {
  const rule = '='.repeat(78)
  const head = [
    'Emerald is free software under the GNU Affero General Public License, version 3 only',
    '(see LICENSE). It includes the following third-party software, each under its own licence,',
    'whose text and notices follow.',
    '',
    ...entries.map((e) => `  ${e.name}  (${e.license})`),
  ]
  const bodies = entries.map((e) =>
    [rule, `${e.name}  (${e.license})`, rule, '', ...(e.texts.length > 0 ? e.texts : [`Licensed under ${e.license}; the package ships no licence file.`])].join('\n'),
  )
  return [...head, '', ...bodies, ''].join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const dirs = process.argv.slice(2)
  if (dirs.length === 0) {
    console.error('usage: node scripts/third-party-notices.mjs <outDir> [<outDir> ...]')
    process.exit(2)
  }
  const entries = collectNotices()
  const text = render(entries)
  for (const dir of dirs) {
    const target = resolve(root, dir)
    if (!existsSync(target)) throw new Error(`${dir} does not exist; build it first`)
    writeFileSync(join(target, 'THIRD_PARTY_NOTICES.txt'), text)
    // Emerald's own licence travels with the copy as well (M43 U7): the desktop app's Help →
    // License opens it from here, and `.txt` is what the shell serves as text.
    copyFileSync(join(root, 'LICENSE'), join(target, 'LICENSE.txt'))
  }
  console.log(`THIRD_PARTY_NOTICES.txt and LICENSE.txt: ${entries.length} entries, into ${dirs.join(', ')}`)
}
