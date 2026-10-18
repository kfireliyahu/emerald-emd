/**
 * A PDF payslip, as the lines a template is written against.
 *
 * **Why this file has to exist.** A payslip is a PDF. Everything downstream —
 * the template, the anchors, the reconciliation — reads *lines of text*, and a
 * PDF has no lines in it: it has glyphs at coordinates. Reconstructing the one
 * from the other is the whole job here, and getting it wrong is invisible,
 * because the arithmetic afterwards still adds up if the columns happen to land
 * in the right order.
 *
 * **pdf.js does the part that must not be reimplemented.** Embedded CID fonts,
 * ToUnicode CMaps, and the bidi pass that turns a right-to-left run stored in
 * visual order back into logical order — every one of those is a place where a
 * hand-rolled reader silently produces mangled Hebrew. It is loaded **on
 * demand**, so the 1.8 MB of it is a chunk nobody who never opens a PDF ever
 * fetches, and it is served from the app's own origin like everything else
 * (D-124): no CDN, no worker, no request that leaves the machine.
 *
 * **It runs on the main thread on purpose.** `globalThis.pdfjsWorker` is the
 * documented hook for that, and the alternative is a `Worker`, which the
 * shell's CSP declines (`default-src 'none'` with no `worker-src`). Widening
 * that header to save a few milliseconds on a one-page document is the trade
 * D-124 exists to refuse.
 *
 * **When a document lies about its own text**, `pdfFontMap.ts` takes the
 * correction out of the embedded font and this file applies it — see
 * `repairFromFonts` below. What cannot be repaired that way is said out loud
 * rather than shown as if it were words.
 *
 * **What is left to a person.** A scanned slip has no text layer, and this says
 * so in a sentence rather than returning an empty document that reads as a
 * format nothing recognises. OCR is not here and is not pretended at.
 */

import { glyphChartsFromPdf, type GlyphChart } from './pdfFontMap.ts'
import { carriesToHebrew, hebrewOffsetOf, legible, recoverRun } from './glyphOrder.ts'
import { relabel, type OcrWord } from './relabel.ts'


/** One run of text, as pdf.js hands it over: placed by its left edge. */
export interface PdfTextItem {
  readonly text: string
  /** The left edge, in points, from the bottom-left of the page. */
  readonly x: number
  /** The baseline, in points. Larger is higher up the page. */
  readonly y: number
  readonly width: number
  /** The font size, which is what decides whether two runs are on one line. */
  readonly size: number
  /** pdf.js's own answer, from its bidi pass. */
  readonly rtl: boolean
  /** Which font set this run. Two runs of one font share an encoding, or share a broken one. */
  readonly font?: string
}

/**
 * Where one line sits on the page it was read off — PDF user space, in points,
 * from the bottom-left, which is the frame pdf.js's own viewport converts from.
 *
 * **Kept unrotated and unscaled on purpose.** A rotated page and a page drawn at
 * 1.4× are the viewer's problem and pdf.js already solves both
 * (`convertToViewportPoint`); a box stored in viewport pixels would be a
 * measurement of a window that has since been resized.
 */
export interface LineBox {
  /** 1-based, the way pdf.js numbers pages. */
  readonly page: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One line of a document, and the box it was read off. */
export interface PlacedLine {
  readonly text: string
  /** Absent for the empty line a blank page contributes. */
  readonly box: LineBox | undefined
}

/** A page's own size in points, for a viewer that has to lay one out. */
export interface PageSize {
  readonly width: number
  readonly height: number
}

/**
 * Enough to draw the document beside what was read off it (D-168).
 *
 * `lines` is one entry per line of the extract's `text`, in the same order,
 * produced by the same pass that produced the text — so a template's line
 * number indexes straight into it.
 */
export interface DocumentLayout {
  readonly pages: readonly PageSize[]
  readonly lines: readonly (LineBox | undefined)[]
}

export type PdfExtract =
  | {
      readonly kind: 'text'
      readonly text: string
      readonly pages: number
      /**
       * At least one font on the page has no readable encoding, so the words it
       * sets are not words.
       *
       * **The figures usually survive** — digits come through almost any
       * encoding — which is why this is a note beside a reading rather than a
       * refusal to produce one. "Usually" rather than "always" since D-146: a
       * document that states no encoding at all breaks the numbers too, and
       * that case is `inferredFromGlyphOrder` below rather than this one.
       */
      readonly unreadableLabels: boolean
      /**
       * **This document does not say what its text is, and this text was worked
       * out from the order of its glyphs** (D-146).
       *
       * Not a warning about quality — the recovery is pinned and checked — but a
       * statement about *where the text came from*, which is different in kind
       * from every other reading this app produces and which the person
       * confirming a slip is entitled to know. Both reconciliation proofs still
       * have to pass on top of it.
       */
      readonly inferredFromGlyphOrder: boolean
      /**
       * Where every line of `text` is on the page it came from (D-168).
       *
       * The one thing this reader has always computed and thrown away. A
       * template anchors a figure to a line number, a confirm surface says so
       * out loud — *"taken from line 34, beside the line 33 the template
       * names"* — and until this existed that sentence could only be checked by
       * opening the same PDF in another window.
       */
      readonly layout: DocumentLayout
    }
  /** A scan. Every page rendered and not one glyph in any of them. */
  | { readonly kind: 'noTextLayer'; readonly pages: number }
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * Two runs are on the same line when their baselines are within this much of
 * one font size of each other.
 *
 * Generous, because a line of a payslip is not flat: a Hebrew label and the
 * Latin figure beside it are set in different fonts at different sizes, and a
 * superscript or a smaller column heading shifts a baseline by a point or two
 * without leaving the row.
 */
const SAME_LINE = 0.5

/** A gap smaller than this share of a font size is kerning, not a space. */
const NO_GAP = 0.2

/** And a space is about this wide, which is what turns a gap into a count of them. */
const SPACE = 0.3

/**
 * A gap wider than this many font sizes is not a column, it is the edge of a
 * panel — and what is on the other side of it belongs to a different line.
 *
 * **This is the difference between reading a payslip and reading a page.** A
 * real Israeli slip is several tables printed side by side: payments, then
 * deductions, then a box of totals, all at the same heights. Grouping purely by
 * baseline puts a deduction row and an unrelated total on one line, and
 * `readDeductionRow` then takes the total as that row's employer contribution —
 * which is a figure no equation on the slip checks (D-138), so it passes both
 * proofs and is wrong. That is not a hypothetical: it is what the first real
 * payslip did, with the deductions total landing in the pension row.
 *
 * **Width alone will not do it**, and that is the part that took a real
 * document to learn. A table with a basis column has an empty cell wherever a
 * row has no basis, and an empty cell is a gap as wide as a panel's. What tells
 * them apart is what comes *after* the gap: across a panel boundary the next
 * thing is the next panel's **label**, and inside a table it is the row's next
 * **figure**. So a gap splits only when it is both wide and followed by a word.
 *
 * Eight, measured rather than picked: on a real slip 85% of the gaps between
 * runs are under 8.3 font sizes, and the ones that cross a panel run from 13 to
 * 55. The cost of being wrong is asymmetric — splitting one table in two leaves
 * both halves readable, where merging two panels invents a figure.
 *
 * A page-wide gutter would be the principled version of this and does not work:
 * a real payslip's text covers every column of the page at some height, so
 * there is no vertical strip that is empty all the way down.
 */
const PANEL_GAP = 8

/**
 * Whether any font here sets text that is not text.
 *
 * **A subsetted font with no `ToUnicode` map has shapes and no statement of
 * what they say.** The producer assigns its own codes to its own glyphs, a
 * reader decodes those codes through whatever encoding it can guess at, and
 * Hebrew comes out as a run of mathematical operators and Latin-1 punctuation.
 * There is nothing to recover: the mapping is private to that file, and the
 * only thing that knows it is the glyph outlines themselves.
 *
 * Judged **per font**, because a real payslip has several and only some are
 * broken — the one measured had its headings in Arial, which read perfectly,
 * and its table in a subset of Miriam, which did not.
 *
 * **Judged per run rather than per character**, which is the correction a real
 * document forced. The first version counted characters across a whole font and
 * required more symbols than digits — and on the measured slip the broken font
 * set the *figures* as well as the words, 353 digits against 93 symbols, so the
 * one font that was unreadable was the one that got a clean bill. A run is a
 * word or it is a number; asking of each run separately is asking the question
 * that was meant.
 */
export function unreadableLabels(items: readonly PdfTextItem[]): boolean {
  const garbled = new Map<string, number>()

  for (const item of items) {
    if (!isGarbled(item.text)) continue
    const font = item.font ?? ''
    garbled.set(font, (garbled.get(font) ?? 0) + 1)
  }

  // Three runs, so a single odd glyph — a currency sign, a bullet, a stray
  // ligature — is never enough to condemn a font that reads perfectly.
  for (const count of garbled.values()) if (count >= 3) return true
  return false
}

/**
 * A run that is not a word and not a number.
 *
 * Two symbol-block characters at minimum, outnumbering everything legible in
 * the run: `ª»«¬ª` qualifies, `€` alone does not, and neither does `30,900.00`
 * or the em dash a deductions table prints where an amount does not apply.
 */
function isGarbled(text: string): boolean {
  let legible = 0
  let symbols = 0
  for (const character of text) {
    if (/\s/.test(character)) continue
    // Tested before the letter check: µ, ø and æ are letters in their own right
    // and are also where a misread encoding lands.
    if (SYMBOL_BLOCK.test(character)) symbols++
    else if (/[\p{L}0-9]/u.test(character)) legible++
  }
  return symbols >= 2 && symbols > legible
}

/**
 * Latin-1 supplement, IPA, general punctuation, arrows and maths — where a
 * misread encoding lands. Some of these are letters in their own right (µ, ø,
 * æ), which is why the census above tests this *before* it tests for a letter.
 */
const SYMBOL_BLOCK = /[\u00a0-\u02ff\u2000-\u23ff]/

/**
 * The lines of a page, **with the box each one was read off**.
 *
 * The text every reader downstream sees is made **out of** these rather than
 * kept beside them, and that is the whole point of the shape. A template
 * anchors a figure to a line *number*; a confirm surface drawing a highlight
 * from a second array kept in step with the text would point at the wrong row
 * the first time the two disagreed, which is worse than drawing nothing.
 * There is no second array — `linesFromItems` is this function with the boxes
 * dropped, so a line and its box cannot drift apart without the text changing
 * with them (D-168).
 *
 * **A page with nothing on it still contributes one line**, because joining the
 * pages has always given it one and the numbering downstream is the numbering
 * of that string.
 */
export function placeLines(items: readonly PdfTextItem[], page: number): readonly PlacedLine[] {
  const real = items.filter((item) => item.text.trim() !== '')
  if (real.length === 0) return [BLANK]

  const rightToLeft = isRightToLeft(real)

  // Top of the page first. A PDF's y grows upward, so descending y is reading
  // order — and it is the only ordering that survives a producer emitting a
  // page's runs in whatever sequence its layout engine finished them in.
  const sorted = [...real].sort((a, b) => b.y - a.y)

  const lines: PdfTextItem[][] = []
  let current: PdfTextItem[] = []
  let baseline = Number.NaN

  for (const item of sorted) {
    const tolerance = Math.max(1, item.size * SAME_LINE)
    if (current.length === 0 || Math.abs(item.y - baseline) <= tolerance) {
      if (current.length === 0) baseline = item.y
      current.push(item)
      continue
    }
    lines.push(current)
    current = [item]
    baseline = item.y
  }
  if (current.length > 0) lines.push(current)

  const placed = lines
    .flatMap((line) => joinLine(line, rightToLeft))
    .map((piece) => ({ text: piece.text, box: boxOf(piece.items, page) }))
  return placed.length === 0 ? [BLANK] : placed
}

const BLANK: PlacedLine = { text: '', box: undefined }

/** The text alone, which is all any reader of a document has ever wanted. */
export function linesFromItems(items: readonly PdfTextItem[]): string {
  return placeLines(items, 1)
    .map((line) => line.text)
    .join('\n')
}

/**
 * How far above and below its baseline a line is drawn, as a share of the
 * largest font on it.
 *
 * Approximate on purpose. The true ascent and descent are properties of a font
 * file, and reading them would mean carrying font metrics through a path that
 * exists to draw a rectangle a person looks at. Slightly generous is the right
 * direction to be wrong in: a highlight a shade taller than its row still says
 * *this row*, and one a shade short clips a Hebrew descender and reads as a
 * misregistration — which is exactly the doubt this is here to remove.
 */
const ASCENT = 0.9
const DESCENT = 0.25

function boxOf(items: readonly PdfTextItem[], page: number): LineBox | undefined {
  if (items.length === 0) return undefined

  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.NEGATIVE_INFINITY
  let bottom = Number.POSITIVE_INFINITY

  for (const item of items) {
    const size = Math.max(item.size, 1)
    left = Math.min(left, item.x)
    right = Math.max(right, item.x + item.width)
    top = Math.max(top, item.y + size * ASCENT)
    bottom = Math.min(bottom, item.y - size * DESCENT)
  }

  return { page, x: left, y: bottom, width: right - left, height: top - bottom }
}

/**
 * Which way this page reads, decided on the runs that carry letters.
 *
 * Digits, punctuation and currency signs are direction-neutral and pdf.js calls
 * them `ltr`; a Hebrew payslip is more than half of them by item count, so
 * counting everything would call an Israeli slip an English document. What
 * decides it is the words.
 */
function isRightToLeft(items: readonly PdfTextItem[]): boolean {
  const words = items.filter((item) => /\p{L}/u.test(item.text))
  if (words.length === 0) return false
  return words.filter((item) => item.rtl).length * 2 >= words.length
}

/**
 * One line's runs, in reading order, with the gaps between them as spaces —
 * and split wherever a gap is too wide to be a column.
 *
 * **Reading order is by descending x on a right-to-left page**, which is the
 * measurement that matters here: a Hebrew slip's label sits at the right margin
 * and its columns march leftwards, so descending x reproduces exactly the
 * logical string a `.txt` version of the same slip would have. Ascending x
 * would hand every deduction row to `readDeductionRow` backwards — and the
 * employer column would land where the employee column belongs, which
 * reconciles and is wrong (D-138).
 *
 * The gaps are kept **proportional** rather than collapsed to one space,
 * because two things downstream read them: the label is everything before the
 * first run of two spaces, and a column that prints nothing at all is a gap
 * where a figure would be.
 */
function joinLine(
  items: readonly PdfTextItem[],
  rightToLeft: boolean,
): readonly { readonly text: string; readonly items: readonly PdfTextItem[] }[] {
  const ordered = [...items].sort((a, b) => (rightToLeft ? b.x - a.x : a.x - b.x))

  const pieces: { text: string; items: PdfTextItem[] }[] = []
  let line = ''
  let members: PdfTextItem[] = []
  let edge = Number.NaN

  for (const item of ordered) {
    const size = Math.max(item.size, 1)
    if (line !== '') {
      // The distance from where the previous run ended to where this one starts,
      // measured in the direction the line is read.
      const gap = rightToLeft ? edge - (item.x + item.width) : item.x - edge

      if (gap > size * PANEL_GAP && startsWithWord(item.text)) {
        // A different panel of the page. It keeps its place in reading order —
        // rightmost first on a right-to-left page — and becomes its own line,
        // with its own box: two panels at one height are two rows on the page
        // and highlighting the pair of them would frame half the width of it.
        pieces.push({ text: line.trimEnd(), items: members })
        line = ''
        members = []
      } else if (gap > size * NO_GAP) {
        line += ' '.repeat(Math.max(1, Math.round(gap / (size * SPACE))))
      }
    }
    line += item.text
    members.push(item)
    edge = rightToLeft ? item.x : item.x + item.width
  }

  if (line.trimEnd() !== '') pieces.push({ text: line.trimEnd(), items: members })
  return pieces
}

/** Does this run open with a word? A panel starts with its name; a column does not. */
function startsWithWord(text: string): boolean {
  return /^\s*\p{L}/u.test(text)
}

/**
 * Read a PDF into the text a template is executed against.
 *
 * Never throws for anything the document did: a PDF that is encrypted, damaged,
 * or a photograph of a slip is a sentence the surface has to be able to say.
 */
/**
 * What a read is doing right now, for a surface that has to say so (D-171).
 *
 * **The stages are the expensive ones, not every step.** Loading the reader is
 * 1.7 MB fetched on demand (D-141); a page's text is milliseconds; the font
 * repair is a second read of the file; and the OCR pass is *four seconds a
 * page* with nothing on screen (D-147). A progress report that named the cheap
 * steps too would flicker through them and make the one that matters look like
 * one of a crowd.
 */
export type ReadStage =
  | { readonly kind: 'loading' }
  | { readonly kind: 'reading'; readonly page: number; readonly pages: number }
  | { readonly kind: 'recovering'; readonly page: number }
  | { readonly kind: 'ocr'; readonly page: number }

export async function extractPdfText(
  bytes: Uint8Array,
  onStage?: (stage: ReadStage) => void,
): Promise<PdfExtract> {
  const stage = (next: ReadStage): void => onStage?.(next)
  stage({ kind: 'loading' })
  let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    pdfjs = await loadPdfJs()
  } catch (error) {
    return { kind: 'failed', reason: `The PDF reader could not be loaded: ${String(error)}` }
  }

  try {
    const document = await pdfjs.getDocument({
      ...openOptions(bytes),
      // The `ToUnicode` map, which `repairFromFonts` needs to invert when a
      // document turns out to be lying about its own text.
      fontExtraProperties: true,
    }).promise

    // The lines of every page, in order, and the pages' own sizes beside them.
    // The text below is joined out of these rather than gathered separately,
    // which is what keeps a line number and a box describing the same line.
    const placed: PlacedLine[] = []
    const sizes: PageSize[] = []
    let unreadable = false
    let inferred = false

    // Only read out of the file when the text says it is needed. A document
    // whose fonts tell the truth never pays for this.
    let charts: readonly GlyphChart[] | undefined
    // Hebrew offsets earned on an earlier page, per font. A payslip's first
    // page is the dense one, and a second page of two lines could not pin its
    // own width — so what page one proved, page two may borrow (D-146).
    const offsets = new Map<string, number>()

    for (let number = 1; number <= document.numPages; number++) {
      stage({ kind: 'reading', page: number, pages: document.numPages })
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      let items: readonly PdfTextItem[] = content.items.flatMap(toItem)

      if (unreadableLabels(items)) {
        stage({ kind: 'recovering', page: number })
        charts ??= await glyphChartsFromPdf(bytes).catch(() => [])
        // The font objects a repair reads are only put in `commonObjs` by the
        // render pass. `getTextContent` alone leaves them unresolved, and asking
        // for one then throws rather than waiting — so the pass is run here, and
        // only here, on a page that has already proved it needs the help.
        await page.getOperatorList().catch(() => undefined)
        items = await repairFromFonts(items, page, charts)

        // The last rung, and the only one that works with no evidence in the
        // file at all: the fonts carry no `cmap` and the document no
        // `ToUnicode`, so what is left is the order the glyphs are in (D-146).
        if (unreadableLabels(items)) {
          const recovered = repairFromGlyphOrder(items, offsets)
          if (recovered !== undefined) {
            items = recovered
            inferred = true

            // **And then the words, from a picture of the page** (D-147). The
            // arithmetic above recovers the figures exactly and the *words* only
            // as far as pdf.js's segmentation allows, which for a document it
            // could not decode is not far. OCR has no such ceiling because it
            // never sees the runs at all. Only ever here: a page whose text the
            // file actually states is never drawn, never read, and never pays
            // the four seconds.
            stage({ kind: 'ocr', page: number })
            const words = await pageWords(page, bytes)
            if (words.length > 0) {
              items = items.map((item) => ({ ...item, text: relabel(item, words) }))
            }
          }
        }
      }

      const size = page.getViewport({ scale: 1 })
      sizes.push({ width: size.width, height: size.height })
      placed.push(...placeLines(items, number))
      unreadable ||= unreadableLabels(items)
    }

    const text = placed.map((line) => line.text).join('\n')
    if (text.trim() === '') return { kind: 'noTextLayer', pages: document.numPages }
    return {
      kind: 'text',
      text,
      pages: document.numPages,
      unreadableLabels: unreadable,
      inferredFromGlyphOrder: inferred,
      layout: { pages: sizes, lines: placed.map((line) => line.box) },
    }
  } catch (error) {
    return { kind: 'failed', reason: reasonFor(error) }
  }
}

/**
 * Put the fonts' own account of their glyphs back over the document's.
 *
 * The chain, and every link of it is in the file already: the character pdf.js
 * printed → the **code** that produced it, by inverting the `ToUnicode` map the
 * document supplied → the **glyph** that code selects, which for the composite
 * fonts this applies to is the same number → what the **font** says that glyph
 * is.
 *
 * **Self-checking, and that is what makes it safe to do at all.** A chart is
 * only accepted for a font when it turns that font's text into *more letters
 * than it had*, so a wrong chart — the wrong font, a simple font whose codes are
 * not glyph ids, a `cmap` that does not cover the subset — produces fewer
 * letters and is discarded. The rule cannot make a readable document worse; it
 * can only fail to help an unreadable one.
 *
 * **And the recovered run is reversed where it comes back Hebrew.** pdf.js's
 * bidi pass ran over the mangled text and saw Latin symbols, so it left the
 * glyph order alone — and that order is *visual*, because the layout engine that
 * wrote the page had already done its own bidi. Undoing that is what turns
 * `כ"הס` back into `סה"כ`.
 */
async function repairFromFonts(
  items: readonly PdfTextItem[],
  page: { commonObjs: { get(name: string): unknown } },
  charts: readonly GlyphChart[],
): Promise<readonly PdfTextItem[]> {
  if (charts.length === 0) return items

  const byFont = new Map<string, PdfTextItem[]>()
  for (const item of items) {
    const font = item.font ?? ''
    const found = byFont.get(font)
    if (found === undefined) byFont.set(font, [item])
    else found.push(item)
  }

  const repaired = new Map<PdfTextItem, PdfTextItem>()

  for (const [font, group] of byFont) {
    if (!unreadableLabels(group)) continue

    const codes = codesOf(page, font)
    if (codes === undefined) continue

    let best: { readonly gain: number; readonly texts: readonly string[] } | undefined
    for (const chart of charts) {
      const texts = group.map((item) => decodeRun(item.text, codes, chart))
      const gain = texts.reduce((total, text, index) => {
        const was = letters(group[index]?.text ?? '')
        return total + (letters(text) - was)
      }, 0)
      if (gain > 0 && (best === undefined || gain > best.gain)) best = { gain, texts }
    }
    if (best === undefined) continue

    group.forEach((item, index) => {
      const text = best.texts[index]
      if (text === undefined || text === item.text) return
      repaired.set(item, { ...item, text, rtl: item.rtl || mostlyHebrew(text) })
    })
  }

  return items.map((item) => repaired.get(item) ?? item)
}

/**
 * Draw one page and read the words off the picture (D-147).
 *
 * **Returns nothing where there is nothing to draw on**, which is the plugin
 * and the tests: `document` is a browser thing, and a headless caller gets the
 * arithmetic's own answer rather than a crash. Nothing else changes — the
 * figures are the same either way, and it is only the labels that are better
 * with a canvas than without one.
 *
 * The whole of tesseract arrives behind this dynamic import, so the four
 * megabytes it costs are fetched by the documents that need them and by nobody
 * else — pdf.js's own bargain (D-141), applied one level further in.
 */
/**
 * How long a page may take to draw, and to be read, before the words are given
 * up on.
 *
 * Generous rather than tight: on the measured slip the drawing is under a
 * second and the reading about four, and the cost of being wrong here is a
 * label nobody got rather than a wrong one. What these are really for is the
 * case that never finishes at all.
 */
const RENDER_DEADLINE_MS = 20_000
const OCR_DEADLINE_MS = 60_000

/**
 * The promise's value, or a flag saying it never came.
 *
 * A *result object* rather than `T | undefined`, because the first thing waited
 * on here is `render`, which resolves to `undefined` on success — so "did it
 * finish" and "what did it give me" are genuinely different questions and
 * collapsing them treats every successful render as a timeout.
 */
type Deadline<T> = { readonly done: true; readonly value: T } | { readonly done: false }

async function raceDeadline<T>(work: Promise<T>, ms: number): Promise<Deadline<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work.then((value) => ({ done: true, value }) as const),
      new Promise<{ readonly done: false }>((resolve) => {
        timer = setTimeout(() => resolve({ done: false }), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function pageWords(
  page: {
    getViewport(options: { scale: number }): { width: number; height: number }
    render(options: Record<string, unknown>): { promise: Promise<unknown> }
  },
  bytes: Uint8Array,
): Promise<readonly OcrWord[]> {
  void bytes
  if (typeof document === 'undefined') return []

  try {
    const { readPage, RENDER_SCALE } = await import('./ocr.ts')

    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)

    // The reading below does not depend on any of this, so a page that will
    // not draw costs the labels and nothing else.
    if (!(await paintPage(page, canvas, viewport))) return []

    const read = await raceDeadline(readPage(canvas, viewport.height / RENDER_SCALE), OCR_DEADLINE_MS)
    return read.done ? read.value : []
  } catch {
    // A page that would not draw, or a model that would not load. The reading
    // stands on the arithmetic alone, which is what it did before this existed.
    return []
  }
}

/**
 * The rung for a document that states nothing about its own text (D-146).
 *
 * **Every font on the page, not only the ones flagged.** `unreadableLabels`
 * looks for symbol-block characters, which is what an unmapped *Hebrew* glyph id
 * looks like — an unmapped *digit* glyph id is a C0 control and trips nothing.
 * On the measured slip that is a whole font of figures that no test would have
 * asked about, in a document already proved broken by the font beside it. Once
 * the page has earned this rung, it is applied across it.
 *
 * Two passes, because the offsets are a fact about the document rather than
 * about one font: the first takes every offset a font can pin by its own width,
 * and the second lets a font too small to pin one borrow, but only when exactly
 * one of the earned offsets carries all of it onto letters.
 *
 * Nothing is kept that does not read better than what it replaced.
 */
function repairFromGlyphOrder(
  items: readonly PdfTextItem[],
  offsets: Map<string, number>,
): readonly PdfTextItem[] | undefined {
  const byFont = new Map<string, PdfTextItem[]>()
  for (const item of items) {
    const font = item.font ?? ''
    const found = byFont.get(font)
    if (found === undefined) byFont.set(font, [item])
    else found.push(item)
  }

  const codesOfFont = new Map<string, Set<number>>()
  for (const [font, group] of byFont) {
    const codes = new Set<number>()
    for (const item of group) {
      for (const character of item.text) codes.add(character.codePointAt(0) ?? 0)
    }
    codesOfFont.set(font, codes)
    // Pinned by width, and only when a single alignment fits.
    if (offsets.has(font)) continue
    const own = hebrewOffsetOf(codes)
    if (own !== undefined) offsets.set(font, own)
  }

  // What this document has proved anywhere, which is what a thin font may
  // borrow from. Deduplicated: two fonts of one family pin the same offset.
  const earned = new Set(offsets.values())

  const repaired = new Map<PdfTextItem, PdfTextItem>()

  for (const [font, group] of byFont) {
    let offset = offsets.get(font)

    if (offset === undefined) {
      const codes = codesOfFont.get(font) ?? new Set<number>()
      const fits = [...earned].filter((candidate) => carriesToHebrew(codes, candidate))
      // One is an answer. Two is an ambiguity, and none is a font of figures,
      // which the ASCII band handles without an offset at all.
      if (fits.length === 1) offset = fits[0]
    }

    for (const item of group) {
      const text = recoverRun(item.text, offset)
      if (text === item.text) continue
      if (legible(text) <= legible(item.text)) continue
      repaired.set(item, { ...item, text, rtl: item.rtl || mostlyHebrew(text) })
    }
  }

  if (repaired.size === 0) return undefined
  return items.map((item) => repaired.get(item) ?? item)
}

/** The document's `ToUnicode`, inverted: the character it claims → the code. */
function codesOf(
  page: { commonObjs: { get(name: string): unknown } },
  font: string,
): ReadonlyMap<string, number> | undefined {
  let loaded: unknown
  try {
    loaded = page.commonObjs.get(font)
  } catch {
    return undefined
  }

  const map = (loaded as { toUnicode?: { _map?: unknown } } | undefined)?.toUnicode?._map
  if (!Array.isArray(map)) return undefined

  const codes = new Map<string, number>()
  map.forEach((value: unknown, code: number) => {
    if (typeof value !== 'string' || value === '') return
    if (!codes.has(value)) codes.set(value, code)
  })
  return codes.size === 0 ? undefined : codes
}

function decodeRun(
  text: string,
  codes: ReadonlyMap<string, number>,
  chart: GlyphChart,
): string {
  let out = ''
  for (const character of text) {
    const code = codes.get(character)
    const recovered = code === undefined ? undefined : chart.get(code)
    out += recovered ?? character
  }
  // Visual order in, logical order out — but only for a run the recovery
  // actually turned into Hebrew. A run of digits was never reordered and must
  // not be.
  return mostlyHebrew(out) ? [...out].reverse().join('') : out
}

function letters(text: string): number {
  let count = 0
  for (const character of text) {
    if (SYMBOL_BLOCK.test(character)) continue
    if (/\p{L}/u.test(character)) count++
  }
  return count
}

function mostlyHebrew(text: string): boolean {
  let hebrew = 0
  let other = 0
  for (const character of text) {
    if (/[\u0590-\u05ff]/.test(character)) hebrew++
    else if (/\p{L}/u.test(character)) other++
  }
  return hebrew > other
}

/**
 * pdf.js, on the main thread, fetched only when a PDF is actually opened.
 *
 * The dynamic import is what makes it a separate chunk; the `pdfjsWorker`
 * global is what stops it wanting a `Worker`.
 *
 * **D-147 tried to take this off the main thread and put it back.** Adding OCR
 * gave the CSP a `worker-src`, so the constraint D-141 chose this under was
 * gone — but the shim turned out never to have been the problem. It renders a
 * page perfectly well under Node, and the browser hang that looked like its
 * fault was the test window being *hidden*: pdf.js's renderer waits on
 * `requestAnimationFrame`, which a background page does not run. Changing a
 * path that works, to fix something it was not doing, is the trade this comment
 * exists to stop the next session making.
 */
/**
 * How a document is opened, here and by the page viewer (`pdfPages.ts`).
 *
 * **A copy of the bytes**, because pdf.js takes ownership of what it is handed
 * and may detach the buffer — and `pdfFontMap` reads the same file again when
 * the document turns out to be lying about its own text, and the viewer's
 * caller holds a `File` it may open again.
 *
 * **Fonts are set up even though the text does not need them, because the page
 * may be drawn** (D-147). With `disableFontFace: true` pdf.js paints glyph
 * outlines instead of letting the platform render real fonts, and the
 * difference does not show up as an error — it shows up as Tesseract reading
 * fewer words off a rougher page, which is how it was found. Still no *system*
 * fonts: those would be whatever this machine happens to have, which is not what
 * the document says and not the same twice.
 *
 * Errors only. Reading a standard font's metrics is a warning pdf.js prints on
 * every document that uses Helvetica, and it has nothing to do with the text;
 * anything that actually stops a read comes back as a `failed` reason.
 */
export function openOptions(bytes: Uint8Array): {
  readonly data: Uint8Array
  readonly disableFontFace: false
  readonly useSystemFonts: false
  readonly verbosity: 0
} {
  return { data: new Uint8Array(bytes), disableFontFace: false, useSystemFonts: false, verbosity: 0 }
}

/** What `paintPage` needs of a pdf.js page. */
interface Paintable {
  render(options: Record<string, unknown>): { promise: Promise<unknown> }
}

/**
 * Paint a page onto a canvas already sized for it, for OCR here and for the
 * page viewer (`pdfPages.ts`). False when it did not draw.
 *
 * **White first**: a PDF page is transparent where it is unprinted, and
 * Tesseract reads transparent as black — as does a dark theme's card behind the
 * viewer, which turns an unprinted page into black paper with black ink on it.
 *
 * **Under a deadline, because a render can wait forever.** pdf.js draws through
 * `requestAnimationFrame`, which a page that is not visible does not run — a
 * backgrounded window, a collapsed pane — so the promise simply never settles
 * (D-147). A render that fails outright is not drawn either.
 */
export async function paintPage(
  page: Paintable,
  canvas: HTMLCanvasElement,
  viewport: object,
  transform?: readonly number[],
): Promise<boolean> {
  const context = canvas.getContext('2d')
  if (context === null) return false
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  try {
    const drawn = await raceDeadline(
      page.render({ canvasContext: context, viewport, canvas, ...(transform === undefined ? {} : { transform }) })
        .promise,
      RENDER_DEADLINE_MS,
    )
    return drawn.done
  } catch {
    return false
  }
}

export async function loadPdfJs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ])
  const global = globalThis as { pdfjsWorker?: unknown }
  global.pdfjsWorker ??= worker
  return pdfjs
}

/** pdf.js's text items, with the marked-content entries dropped. */
function toItem(entry: unknown): PdfTextItem[] {
  if (typeof entry !== 'object' || entry === null) return []
  const item = entry as {
    str?: unknown
    width?: unknown
    height?: unknown
    dir?: unknown
    transform?: unknown
    fontName?: unknown
  }
  if (typeof item.str !== 'string') return []

  const transform = item.transform
  if (!Array.isArray(transform) || transform.length < 6) return []

  const [scaleX, skewY, , , x, y] = transform as number[]
  // The font size, from the text matrix rather than from `height` — a run set
  // at an angle has a height that is not its size, and `height` is zero on the
  // empty runs a producer emits between two fonts.
  const size = Math.hypot(scaleX ?? 0, skewY ?? 0)

  return [
    {
      text: item.str,
      x: x ?? 0,
      y: y ?? 0,
      width: typeof item.width === 'number' ? item.width : 0,
      size: size > 0 ? size : Number(item.height) || 10,
      rtl: item.dir === 'rtl',
      ...(typeof item.fontName === 'string' ? { font: item.fontName } : {}),
    },
  ]
}

function reasonFor(error: unknown): string {
  const name = (error as { name?: unknown })?.name
  if (name === 'PasswordException') {
    return 'That PDF is password-protected. Open it, save an unprotected copy, and try again.'
  }
  if (name === 'InvalidPDFException') return 'That file is not a PDF this reader can open.'
  return `The PDF could not be read: ${String((error as { message?: unknown })?.message ?? error)}`
}
