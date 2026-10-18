/**
 * Letting a picture of the page say what the words are, while the page itself
 * still says what the numbers are.
 *
 * **Why both, and why neither alone.** Measured on four real slips (D-146,
 * D-147):
 *
 * - The **PDF** knows its figures exactly. A glyph id is not a guess — id 19
 *   *is* `0` — so every amount, and every position on the page, is arithmetic.
 * - The PDF does **not** know its words. A document that states no encoding
 *   gets no bidi pass out of pdf.js, so its runs are split and ordered as
 *   though they were Latin, and characters land in the wrong run before this
 *   app sees them. That is a ceiling, not a bug: `ביטוח` arrives as `ביטו`.
 * - **OCR** knows the words — it reads the drawn page, so segmentation and bidi
 *   never enter into it. On the measured slip it recovered every label the PDF
 *   route mangled.
 * - OCR does **not** know the figures well enough: 41 of 45 on the same slip,
 *   and *worse* at higher resolution, so it is a ceiling there too. A wrong
 *   figure in the employer column is D-138's silent case, which is the one
 *   thing this app must not produce.
 *
 * So each side supplies what it is exact at, and this module is the join. It is
 * geometry and nothing else: **no DOM, no tesseract, no pdf.js**, so the rule
 * that decides which words belong to which run is a plain function with tests.
 *
 * **A run keeps its own text unless OCR has something for that exact place.**
 * Never worse than not running, which is what makes the pass safe to apply
 * whenever the text was inferred.
 */

import { containsHebrew } from '@/core/text.ts'

/** A word the OCR pass found, in the page's own coordinates. */
export interface OcrWord {
  readonly text: string
  /** Centre of the word's box, in PDF points from the bottom-left of the page. */
  readonly x: number
  readonly y: number
}

/** The part of a text run this module needs: where it is and what it says. */
export interface PlacedRun {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly size: number
}

/**
 * How far above the baseline a word's centre may sit and still belong to this
 * run, as a fraction of the font size — and how far below.
 *
 * Asymmetric because a baseline is not the middle of a line: letters rise well
 * above it and only descenders fall below. Measured against a real slip's
 * fourfold render, where a tighter box lost the tall Hebrew forms and a
 * symmetric one stole words from the row beneath.
 */
const ABOVE = 0.9
const BELOW = 0.3

/** A word's centre may sit this far outside a run's horizontal span, in points. */
const SLACK = 1

/**
 * The words that fall inside one run's box, right to left.
 *
 * Right to left because these are Hebrew: the run's own order was never
 * trustworthy — that is the whole reason OCR is here — so the order is taken
 * from the geometry instead, which is the one thing both sides agree on.
 */
export function wordsIn(run: PlacedRun, words: readonly OcrWord[]): readonly OcrWord[] {
  const top = run.y + run.size * ABOVE
  const bottom = run.y - run.size * BELOW
  const left = run.x - SLACK
  const right = run.x + run.width + SLACK

  return words
    .filter((word) => word.y <= top && word.y >= bottom && word.x >= left && word.x <= right)
    .sort((a, b) => b.x - a.x)
}

/**
 * One run's text, from OCR where OCR has any, and unchanged otherwise.
 *
 * **Only runs that came out as Hebrew are offered up.** A run of figures is
 * already exact and has nothing to gain and everything to lose — that is the
 * whole bargain of this module, and it is enforced here rather than trusted to
 * a caller.
 */
export function relabel(run: PlacedRun, words: readonly OcrWord[]): string {
  // A Hebrew test and not a "does it have letters" one, because it is asked of
  // the **recovered** text: an unrecovered run is symbol-block characters that
  // Unicode calls letters, and a run nothing could recover is a run nothing
  // knows the position of, so it must not be handed to OCR either.
  if (!containsHebrew(run.text)) return run.text
  const found = wordsIn(run, words)
  if (found.length === 0) return run.text
  return found.map((word) => word.text).join(' ')
}

