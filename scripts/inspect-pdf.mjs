/**
 * What a PDF actually contains, for when a slip reads wrongly.
 *
 *   node scripts/inspect-pdf.mjs "C:\\path\\to\\payslip.pdf"
 *   node scripts/inspect-pdf.mjs "C:\\path\\to\\payslip.pdf" --numbers-only
 *
 * **Nothing leaves your machine.** This prints to your terminal and writes
 * nothing. It exists because a payslip can read wrongly for several unrelated
 * reasons and the fix differs for each, so the first job is finding out which
 * one it is rather than guessing.
 *
 * It prints, per font, **what that font's text decodes to** and a census of the
 * scripts those characters fall in. Hebrew that comes out as `ª»«¬ª »≈` is a
 * font with shapes on the page and no statement of what they say — no
 * `ToUnicode` map, and glyph names a reader cannot turn back into letters. The
 * figures beside it are still right, because digits survive anything.
 *
 * Then the **raw runs** with their positions, before any line is reconstructed,
 * which is what says whether the columns are being grouped correctly.
 *
 * The lines the app builds out of those runs are visible in the app itself:
 * press **Discard** on the confirm surface and the text it read is in the box.
 *
 * `--numbers-only` replaces every letter with a middle dot, which leaves the
 * layout and the figures legible and the words unreadable. That is the version
 * to paste into a conversation.
 */

import { readFileSync } from 'node:fs'

const [, , path, ...flags] = process.argv
if (path === undefined) {
  console.error('usage: node scripts/inspect-pdf.mjs <file.pdf> [--numbers-only]')
  process.exit(1)
}

const redact = flags.includes('--numbers-only')
const show = (text) => (redact ? text.replace(/\p{L}/gu, '\u00b7') : text)

const HEBREW = /[\u0590-\u05ff]/
const LATIN = /[A-Za-z]/
const DIGIT = /[0-9]/
/** Latin-1 supplement, IPA, general punctuation, arrows, maths — where mojibake lands. */
const SYMBOL = /[\u00a0-\u02ff\u2000-\u23ff]/

/**
 * Which scripts a font's characters fall in.
 *
 * The verdict that matters: more symbol-block characters than letters, in a
 * document that is Hebrew or English, means an encoding nobody can read.
 */
function census(text) {
  let hebrew = 0
  let latin = 0
  let digits = 0
  let odd = 0

  for (const character of text) {
    if (/\s/.test(character)) continue
    if (HEBREW.test(character)) hebrew++
    else if (LATIN.test(character)) latin++
    else if (DIGIT.test(character)) digits++
    else if (SYMBOL.test(character)) odd++
  }

  // Symbols outnumbering both letters and digits, and enough of them to be
  // words rather than a stray dash or two. A font that sets only figures has no
  // letters to be wrong about.
  const unreadable = odd > hebrew + latin && odd > digits && odd >= 8
  const verdict = unreadable ? '   <-- UNREADABLE: no usable encoding' : ''
  return `${hebrew} Hebrew, ${latin} Latin, ${digits} digits, ${odd} symbol-block${verdict}`
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const data = new Uint8Array(readFileSync(path))
const doc = await pdfjs.getDocument({
  data,
  disableFontFace: true,
  useSystemFonts: false,
  verbosity: 0,
}).promise

console.log(`pages: ${doc.numPages}`)

for (let number = 1; number <= doc.numPages; number++) {
  const page = await doc.getPage(number)

  // Before the text: this is what actually loads the font objects, and without
  // it every font below reports only the name pdf.js invented for it.
  await page.getOperatorList()

  const content = await page.getTextContent()
  const items = content.items.filter(
    (item) => typeof item.str === 'string' && item.str.trim() !== '',
  )

  console.log(`\n=== page ${number}: ${items.length} runs ===`)

  const fonts = new Map()
  for (const item of items) {
    if (item.fontName === undefined) continue
    fonts.set(item.fontName, (fonts.get(item.fontName) ?? 0) + 1)
  }

  console.log('\nfonts, and what each one decodes to:')
  for (const [name, count] of fonts) {
    let label = name
    try {
      label = String(page.commonObjs.get(name).name ?? name)
    } catch {
      /* the name pdf.js invented will do */
    }

    const text = items
      .filter((item) => item.fontName === name)
      .map((item) => item.str)
      .join('')

    console.log(`  ${label} (${name}) x${count} - ${census(text)}`)
    console.log(`      sample: ${JSON.stringify(show(text.slice(0, 60)))}`)
  }

  console.log(`\nfirst 50 of ${items.length} runs (text | x | y | width | dir | font):`)
  for (const item of items.slice(0, 50)) {
    const [, , , , x, y] = item.transform
    console.log(
      `  ${JSON.stringify(show(item.str)).padEnd(30)} ${x.toFixed(1).padStart(7)} ${y
        .toFixed(1)
        .padStart(7)} ${item.width.toFixed(1).padStart(6)}  ${item.dir}  ${item.fontName}`,
    )
  }
}
