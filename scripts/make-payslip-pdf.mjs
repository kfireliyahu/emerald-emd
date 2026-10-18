/**
 * Builds `fixtures/synthetic/payslip-2026-07.pdf` — the same slip as
 * `payslip-2026-07.txt`, as a real PDF with a real embedded Hebrew font.
 *
 * **Why this is generated rather than hand-drawn.** A payslip is a PDF, so a
 * text fixture tests the arithmetic and nothing about the reading. What has to
 * be exercised is the part with actual risk: an embedded CID font, a ToUnicode
 * CMap, right-to-left runs stored the way a layout engine stores them, and
 * numbers positioned in columns with no separators between them at all. None of
 * that can be faked with a `.txt`.
 *
 * **Hebrew runs are written in visual order**, reversed, which is what a real
 * producer emits: the content stream is a sequence of glyph placements and the
 * layout engine has already run bidi over the text. pdf.js reverses it back on
 * the way out. Getting this backwards in the fixture would train the extractor
 * on a document nobody produces.
 *
 * Two fonts, for the reason a real Israeli slip has two: the embedded Hebrew
 * face has no digits in it (it is fontsource's Hebrew subset), so the figures
 * are set in Helvetica, which every PDF reader already has.
 *
 *   node scripts/make-payslip-pdf.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'fixtures', 'synthetic')

const FONT = join(
  here,
  '..',
  'node_modules',
  '@fontsource',
  'ibm-plex-sans-hebrew',
  'files',
  'ibm-plex-sans-hebrew-hebrew-400-normal.woff',
)

// --- WOFF → sfnt -------------------------------------------------------------

/**
 * A WOFF is an sfnt with a different table directory and each table
 * individually deflated. Undoing that is the whole of it — no glyph data is
 * transformed, which is the difference between WOFF and WOFF2 and the reason
 * this reads the older format.
 */
function sfntFromWoff(woff) {
  const numTables = woff.readUInt16BE(12)
  const entries = []
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20
    entries.push({
      tag: woff.toString('latin1', at, at + 4),
      offset: woff.readUInt32BE(at + 4),
      compLength: woff.readUInt32BE(at + 8),
      origLength: woff.readUInt32BE(at + 12),
    })
  }

  const tables = entries.map((entry) => {
    const raw = woff.subarray(entry.offset, entry.offset + entry.compLength)
    const data = entry.compLength === entry.origLength ? raw : inflateSync(raw)
    return { tag: entry.tag, data }
  })
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1))

  const searchRange = 2 ** Math.floor(Math.log2(tables.length)) * 16
  const header = Buffer.alloc(12 + tables.length * 16)
  header.writeUInt32BE(0x00010000, 0)
  header.writeUInt16BE(tables.length, 4)
  header.writeUInt16BE(searchRange, 6)
  header.writeUInt16BE(Math.floor(Math.log2(tables.length)), 8)
  header.writeUInt16BE(tables.length * 16 - searchRange, 10)

  const body = []
  let offset = header.length
  tables.forEach((table, index) => {
    const at = 12 + index * 16
    header.write(table.tag, at, 4, 'latin1')
    header.writeUInt32BE(checksum(table.data), at + 4)
    header.writeUInt32BE(offset, at + 8)
    header.writeUInt32BE(table.data.length, at + 12)

    const padded = Buffer.alloc(Math.ceil(table.data.length / 4) * 4)
    table.data.copy(padded)
    body.push(padded)
    offset += padded.length
  })

  return { sfnt: Buffer.concat([header, ...body]), tables: new Map(tables.map((t) => [t.tag, t.data])) }
}

function checksum(data) {
  let sum = 0
  for (let i = 0; i + 3 < data.length; i += 4) sum = (sum + data.readUInt32BE(i)) >>> 0
  return sum
}

// --- the two tables a PDF needs to be told about ------------------------------

/** Codepoint → glyph id, from a format-4 subtable. Enough for a Hebrew subset. */
function glyphMap(cmap) {
  const count = cmap.readUInt16BE(2)
  let subtable = -1
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 8
    const platform = cmap.readUInt16BE(at)
    const encoding = cmap.readUInt16BE(at + 2)
    const offset = cmap.readUInt32BE(at + 4)
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) subtable = offset
  }
  if (subtable < 0) throw new Error('no unicode cmap subtable')
  if (cmap.readUInt16BE(subtable) !== 4) throw new Error('expected a format 4 cmap')

  const segCount = cmap.readUInt16BE(subtable + 6) / 2
  const ends = subtable + 14
  const starts = ends + segCount * 2 + 2
  const deltas = starts + segCount * 2
  const ranges = deltas + segCount * 2

  const map = new Map()
  for (let seg = 0; seg < segCount; seg++) {
    const end = cmap.readUInt16BE(ends + seg * 2)
    const start = cmap.readUInt16BE(starts + seg * 2)
    const delta = cmap.readInt16BE(deltas + seg * 2)
    const rangeOffset = cmap.readUInt16BE(ranges + seg * 2)
    if (start === 0xffff) continue

    for (let code = start; code <= end; code++) {
      let glyph
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff
      } else {
        const at = ranges + seg * 2 + rangeOffset + (code - start) * 2
        if (at + 1 >= cmap.length) continue
        glyph = cmap.readUInt16BE(at)
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff
      }
      if (glyph !== 0) map.set(code, glyph)
    }
  }
  return map
}

/** Advance widths, in font units. */
function advanceWidths(tables) {
  const hhea = tables.get('hhea')
  const hmtx = tables.get('hmtx')
  const count = hhea.readUInt16BE(34)
  const widths = []
  for (let i = 0; i < count; i++) widths.push(hmtx.readUInt16BE(i * 4))
  return widths
}

// --- the PDF ------------------------------------------------------------------

const SIZE = 10
/** Helvetica's advance widths are not read from anywhere: this is close enough
 *  for a fixture, and the extractor's spacing is proportional rather than exact. */
const LATIN_WIDTH = 0.55

class Pdf {
  constructor() {
    this.objects = []
  }

  add(body) {
    this.objects.push(body)
    return this.objects.length
  }

  build(rootIndex) {
    const parts = [Buffer.from('%PDF-1.7\n', 'latin1')]
    const offsets = []
    let length = parts[0].length

    this.objects.forEach((body, index) => {
      offsets.push(length)
      const head = Buffer.from(`${index + 1} 0 obj\n`, 'latin1')
      const tail = Buffer.from('\nendobj\n', 'latin1')
      const middle = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')
      parts.push(head, middle, tail)
      length += head.length + middle.length + tail.length
    })

    const xrefAt = length
    let xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
    xref += `trailer\n<< /Size ${this.objects.length + 1} /Root ${rootIndex} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
    parts.push(Buffer.from(xref, 'latin1'))

    return Buffer.concat(parts)
  }
}

function stream(dict, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1')
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${bytes.length} >>\nstream\n`, 'latin1'),
    bytes,
    Buffer.from('\nendstream', 'latin1'),
  ])
}

/**
 * WinAnsi bytes for the characters a slip's Latin runs actually use.
 *
 * The em dash matters more than it looks: it is what the deductions table
 * prints where an amount does not apply, and reading it as a *position* rather
 * than skipping it is what stops the employer's severance becoming the
 * employee's (D-138).
 */
function latinBytes(text) {
  let out = ''
  for (const character of text) {
    if (character === '—') out += String.fromCharCode(0x97)
    else if (character === '–') out += String.fromCharCode(0x96)
    else if (character === '(' || character === ')' || character === '\\') out += '\\' + character
    else out += character
  }
  return out
}

/**
 * One page of a payslip.
 *
 * `runs` are `[right, y, text]` — the **right** edge, because the page is
 * right-to-left and that is the edge a line is laid out from. Each run is then
 * split into Hebrew and Latin segments and walked leftwards, which is what a
 * layout engine does and what produces the mixed-font, mixed-direction line an
 * extractor actually meets.
 */
function payslipPdf(runs, { lyingToUnicode = false } = {}) {
  const woff = readFileSync(FONT)
  const { sfnt, tables } = sfntFromWoff(woff)
  const codeToGlyph = glyphMap(tables.get('cmap'))
  const unitsPerEm = tables.get('head').readUInt16BE(18)
  const widths = advanceWidths(tables)

  const used = new Map()
  const glyphOf = (character) => {
    const glyph = codeToGlyph.get(character.codePointAt(0))
    if (glyph === undefined) throw new Error(`the font has no glyph for ${JSON.stringify(character)}`)
    used.set(glyph, character)
    return glyph
  }

  const widthOf = (glyph) => Math.round(((widths[glyph] ?? widths[0]) / unitsPerEm) * 1000)

  const isHebrew = (character) => /[\u0590-\u05ff]/.test(character)

  /** Maximal runs of one script, in the string's own (logical) order. */
  const segmentsOf = (text) => {
    const segments = []
    for (const character of text) {
      const hebrew = isHebrew(character)
      const last = segments[segments.length - 1]
      // A space belongs to whichever segment it follows, so it does not become a
      // segment of its own and split a line into twice as many text items.
      if (last !== undefined && (last.hebrew === hebrew || character === ' ')) last.text += character
      else segments.push({ hebrew, text: character })
    }
    return segments
  }

  const content = ['BT']
  for (const [right, y, text] of runs) {
    let cursor = right
    for (const segment of segmentsOf(text)) {
      if (segment.hebrew) {
        // Visual order: reversed, as a layout engine emits it.
        const glyphs = [...segment.text].reverse().map(glyphOf)
        const advance = (glyphs.reduce((total, glyph) => total + widthOf(glyph), 0) / 1000) * SIZE
        const hex = glyphs.map((glyph) => glyph.toString(16).padStart(4, '0')).join('')
        content.push(`/FH ${SIZE} Tf`, `1 0 0 1 ${(cursor - advance).toFixed(2)} ${y} Tm`, `<${hex}> Tj`)
        cursor -= advance
      } else {
        const advance = segment.text.length * LATIN_WIDTH * SIZE
        content.push(
          `/FL ${SIZE} Tf`,
          `1 0 0 1 ${(cursor - advance).toFixed(2)} ${y} Tm`,
          `(${latinBytes(segment.text)}) Tj`,
        )
        cursor -= advance
      }
    }
  }
  content.push('ET')

  const pdf = new Pdf()

  const fontFile = pdf.add(stream(`/Length1 ${sfnt.length}`, sfnt))
  const descriptor = pdf.add(
    `<< /Type /FontDescriptor /FontName /PlexHebrew /Flags 4 /FontBBox [-500 -300 1500 1000] ` +
      `/ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 ${fontFile} 0 R >>`,
  )

  const glyphList = [...used.keys()].sort((a, b) => a - b)
  const widthEntries = glyphList.map((glyph) => `${glyph} [${widthOf(glyph)}]`).join(' ')

  /**
   * What the document *claims* each glyph is.
   *
   * `lyingToUnicode` writes the failure a real payslip arrived with (D-144): a
   * subsetter's boilerplate Latin table over Hebrew shapes, so every reader
   * prints mathematical operators where the page shows Hebrew. The font's own
   * `cmap` still tells the truth, which is what makes the document recoverable
   * and what the recovery is tested against.
   */
  const lie = new Map([...used.keys()].sort((a, b) => a - b).map((glyph, index) => [glyph, 0x2200 + index]))
  const claimed = (glyph) =>
    lyingToUnicode ? lie.get(glyph) : used.get(glyph).codePointAt(0)

  // The ToUnicode CMap: glyph id back to the character it stands for. Without
  // it a reader has the shapes and no idea what they say, which is exactly the
  // failure this fixture exists to prove does not happen.
  const toUnicode =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
    '/CMapName /Plex def /CMapType 2 def\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
    `${glyphList.length} beginbfchar\n` +
    glyphList
      .map((glyph) => {
        const code = claimed(glyph).toString(16).padStart(4, '0')
        return `<${glyph.toString(16).padStart(4, '0')}> <${code}>`
      })
      .join('\n') +
    '\nendbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end'

  const toUnicodeObject = pdf.add(stream('', toUnicode))
  const cidFont = pdf.add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /PlexHebrew ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${descriptor} 0 R /DW 600 /W [${widthEntries}] /CIDToGIDMap /Identity >>`,
  )
  const hebrew = pdf.add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /PlexHebrew /Encoding /Identity-H ` +
      `/DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicodeObject} 0 R >>`,
  )
  const latin = pdf.add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  )

  const contents = pdf.add(stream('', content.join('\n') + '\n'))
  const pages = pdf.objects.length + 2
  const page = pdf.add(
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /FH ${hebrew} 0 R /FL ${latin} 0 R >> >> /Contents ${contents} 0 R >>`,
  )
  pdf.add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`)
  const catalog = pdf.add(`<< /Type /Catalog /Pages ${pages} 0 R >>`)

  return pdf.build(catalog)
}

// --- July 2026, laid out the way a slip is ------------------------------------

/**
 * The right margin, and the three numeric columns.
 *
 * **Compact on purpose.** The first draft of this fixture spread one table
 * across four hundred points, which no real slip does — an Israeli payslip
 * prints several tables side by side and each one is narrow. Those distances
 * mattered once `pdfText.ts` learned to split a line at a panel-wide gap
 * (D-142): a fixture with column gaps wider than the panel gaps on a real
 * document would have been a fixture that tested the opposite of the truth.
 */
const RIGHT = 545
const BASIS = 430
const EMPLOYEE = 360
const EMPLOYER = 290

/** A row: its label against the right margin, then the columns, each right-aligned. */
function row(y, label, columns = []) {
  return [[RIGHT, y, label], ...columns.map(([right, text]) => [right, y, text])]
}

const runs = [
  ...row(800, 'תלוש שכר — יולי 2026', []),
  ...row(775, 'מעסיק: מעבדות תוכנה בע"מ', [[BASIS, '515000000']]),
  ...row(760, 'עובד: ישראל ישראלי', [[BASIS, '000000000']]),
  ...row(745, 'תאריך תשלום:', [[BASIS, '01/08/2026']]),
  ...row(730, 'חודש שכר:', [[BASIS, '07/2026']]),

  ...row(700, 'תשלומים', []),
  ...row(685, 'שכר יסוד', [[EMPLOYEE, '23,000.00']]),
  ...row(670, 'תוספת ותק', [[EMPLOYEE, '900.00']]),
  ...row(655, 'החזר נסיעות', [[EMPLOYEE, '600.00']]),
  ...row(635, 'סה"כ ברוטו', [[EMPLOYEE, '24,500.00']]),

  ...row(605, 'ניכויים', []),
  ...row(590, 'תיאור', [[BASIS, 'בסיס'], [EMPLOYEE, 'עובד'], [EMPLOYER, 'מעסיק']]),
  ...row(575, 'מס הכנסה', [[EMPLOYEE, '3,980.50'], [EMPLOYER, '—']]),
  ...row(560, 'ביטוח לאומי', [[EMPLOYEE, '1,062.00'], [EMPLOYER, '1,470.00']]),
  ...row(545, 'מס בריאות', [[EMPLOYEE, '775.00'], [EMPLOYER, '—']]),
  ...row(530, 'פנסיה', [[BASIS, '24,500.00'], [EMPLOYEE, '1,470.00'], [EMPLOYER, '1,592.50']]),
  ...row(515, 'קרן השתלמות', [[BASIS, '24,500.00'], [EMPLOYEE, '612.50'], [EMPLOYER, '1,837.50']]),
  ...row(500, 'פיצויים', [[BASIS, '24,500.00'], [EMPLOYEE, '—'], [EMPLOYER, '2,040.85']]),
  ...row(485, 'דמי ועד', [[EMPLOYEE, '45.00'], [EMPLOYER, '—']]),
  ...row(470, 'ניכוי הלוואה', [[EMPLOYEE, '350.00'], [EMPLOYER, '—']]),
  ...row(450, 'סה"כ ניכויי עובד', [[EMPLOYEE, '8,295.00']]),

  ...row(420, 'נטו לתשלום', [[EMPLOYEE, '16,205.00']]),

  ...row(380, 'נתונים מצטברים מתחילת השנה', []),
  ...row(365, 'ברוטו מצטבר', [[EMPLOYEE, '171,500.00']]),
  ...row(350, 'מס הכנסה מצטבר', [[EMPLOYEE, '27,863.50']]),
]

mkdirSync(outDir, { recursive: true })

const path = join(outDir, 'payslip-2026-07.pdf')
writeFileSync(path, payslipPdf(runs))
console.log(`wrote ${path}`)

// The same slip, from a producer that got its own ToUnicode table wrong. This
// is not a hypothetical shape: it is what the first real Israeli payslip did,
// and it is the document `pdfFontMap.ts` exists to repair.
const mislabelled = join(outDir, 'payslip-2026-07-mislabelled.pdf')
writeFileSync(mislabelled, payslipPdf(runs, { lyingToUnicode: true }))
console.log(`wrote ${mislabelled}`)
