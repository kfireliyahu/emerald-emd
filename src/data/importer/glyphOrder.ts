/**
 * Recovering text from a document that never says what its text is.
 *
 * **The failure this exists for, and it is not D-144's.** That one is a file
 * that *lies* about itself — a `ToUnicode` table full of a subsetter's
 * boilerplate Latin over Hebrew shapes, corrected by asking the embedded font's
 * own `cmap`. This is the harder case measured on four real slips from the same
 * employer: **no `ToUnicode` anywhere in the file, and no `cmap` in any of the
 * four embedded fonts.** The document carries glyph outlines and no statement,
 * anywhere, of what those outlines mean. It renders perfectly — drawing needs
 * only the outlines — and **no conforming reader can extract its text**, this
 * app included. The same employer's earlier slips carry both tables and read
 * cleanly; the difference is 130KB of the 170KB file.
 *
 * **What is left to work with is the glyph ids**, which pdf.js hands over when
 * it has nothing better, and which the subsetter left in the order the original
 * font had them. That order is not arbitrary in two places, and those two are
 * enough for a payslip:
 *
 * - **The ASCII band.** Macintosh standard glyph order — the ordering every
 *   TrueType subsetter starts from — runs `space` at glyph 3 through `at` at
 *   glyph 34, which over that range *is* ASCII. So `glyph + 0x1D` is a constant,
 *   not a guess, and it is the same constant in every font that follows the
 *   standard order. It gives the digits, the decimal point and the thousands
 *   comma, which is to say it gives the figures.
 * - **The Hebrew band.** The alphabet is 27 consecutive code points, א to ת,
 *   and a subset that kept the original order has them consecutive too. A
 *   contiguous run of glyph ids **exactly 27 wide** can only be laid onto the
 *   alphabet one way, so the offset is *pinned by the width* rather than chosen.
 *   It differs per font — the measured slip needs +0x330 for its Arial and
 *   +0x537 for its Miriam — so it is derived per font and never hardcoded.
 *
 * **This is inference, and the difference from reading is real.** Everything
 * here is checked twice before it is believed: an offset is taken only when it
 * is the *only* one that fits, and a recovered run is kept only when it turns
 * more bytes into legible characters than it started with. The caller says so
 * out loud — `PdfExtract.inferredFromGlyphOrder` exists so the confirm surface
 * can tell a person that this document did not state its own text, and the
 * payslip's two reconciliation proofs still have to pass on top of that.
 *
 * Deliberately narrow, the same way `pdfFontMap.ts` is: two bands, both with a
 * fixed anchor. A script whose alphabet is not a contiguous Unicode run does not
 * belong here, and neither does anything that would have to be guessed at.
 */

/** א through ת: 27 consecutive code points, and the anchor the width pins. */
const HEBREW_FIRST = 0x05d0
const HEBREW_LAST = 0x05ea
const HEBREW_SPAN = HEBREW_LAST - HEBREW_FIRST

/**
 * Macintosh standard glyph order is plain ASCII from `space` to `at`.
 *
 * Glyph 3 is `space`, 15 `comma`, 17 `period`, 19–28 the digits, 29 `colon` —
 * `glyph + 0x1D` throughout. Measured against a real slip, where glyph 19
 * occurred 139 times, which is what `0` does on a page of money and what
 * nothing else does.
 */
const ASCII_FIRST_GLYPH = 3
/**
 * Stopping at 31 rather than at `at`, and the reason is the whole safety of
 * this band: glyph ids 3 to 31 arrive as **C0 control characters**, and a
 * control character is never text. Nothing legitimate is being overwritten,
 * whatever the document turns out to be.
 *
 * From glyph 32 on they arrive as printable ASCII — `=`, `>`, `?`, then the
 * Latin alphabet — where a real character and an unmapped glyph id are the same
 * byte and no test can separate them. Measured the hard way: a literal space
 * (U+0020, which is glyph id 32) came back as `=`. The three punctuation marks
 * given up here cost nothing; the alternative corrupts text that was fine.
 *
 * It is also why **this cannot help a Latin-script document**. Its letters live
 * above the line, so a broken one reads as plausible words and there is nothing
 * to detect.
 */
const ASCII_LAST_GLYPH = 0x1f
const ASCII_SHIFT = 0x1d

/**
 * Where an unmapped non-Latin glyph id lands: past ASCII, below the point any
 * real script this app reads begins.
 *
 * The measured slips put Hebrew at 0x2a0 in one font and 0x99 in another, so
 * the window has to be wide — but it must exclude printable ASCII, for the
 * reason `ASCII_LAST_GLYPH` gives.
 */
const SUSPECT_FIRST = 0x7f
const SUSPECT_LAST = 0x2ff

/**
 * How much of the alphabet has to be present before a 27-wide window is
 * believed to be one.
 *
 * More than half, with **both ends present** — which is the condition that
 * pins the alignment and leaves the density doing only the job it is good at:
 * telling an alphabet from a coincidence.
 *
 * Fifteen rather than twenty because of the four measured slips: April's Miriam
 * uses 21 of the 27 letters and May's uses 18, and there is nothing to choose
 * between them — same employer, same form, one month apart. A threshold that
 * read one and not the other would be a threshold measuring the month.
 */
const DENSE_ENOUGH = 15

/**
 * The offset that lays a font's glyph ids onto the Hebrew alphabet, when
 * exactly one does.
 *
 * Both ends of the run must be present, which is what pins the width to the
 * alphabet's and leaves no freedom in the alignment. **Two candidates mean
 * none**: a document that cannot say which of two readings is its own is a
 * document this refuses, and the notice is what remains for it.
 */
export function hebrewOffsetOf(codes: Iterable<number>): number | undefined {
  // **The ASCII band is not a candidate**, and excluding it is what lets the
  // density threshold be honest. Those glyph ids are already spoken for by the
  // standard order, and left in they form a second 27-wide window of their own
  // — space through colon is exactly that wide — so a threshold low enough to
  // accept a thin alphabet would accept the punctuation too, and two windows
  // veto each other. Measured: April's Miriam qualifies twice at a threshold of
  // sixteen and recovers nothing.
  const seen = new Set<number>()
  for (const code of codes) if (isSuspect(code)) seen.add(code)

  let found: number | undefined

  for (const low of seen) {
    if (!seen.has(low + HEBREW_SPAN)) continue

    let present = 0
    for (let at = low; at <= low + HEBREW_SPAN; at++) if (seen.has(at)) present++
    if (present < DENSE_ENOUGH) continue

    // A second fit is an ambiguity, not a better answer.
    if (found !== undefined) return undefined
    found = HEBREW_FIRST - low
  }

  return found
}

/**
 * Does this offset carry every one of a font's unrecovered codes onto a Hebrew
 * letter?
 *
 * How a font too small to pin its own width borrows one: the measured slip sets
 * five runs in Arial Bold, thirteen distinct glyphs, far too few to span the
 * alphabet — and the offset its regular Arial pinned lands every one of them on
 * a letter, where the offset the Miriam pinned lands none. That is the whole
 * test, and it is only ever applied to offsets another font in the same document
 * already earned.
 */
export function carriesToHebrew(codes: Iterable<number>, offset: number): boolean {
  let any = false
  for (const code of codes) {
    // Only what is broken is evidence. A run's spaces and figures say nothing
    // about where its alphabet sits, and counting them would let one literal
    // space veto an offset that carries every letter correctly.
    if (!isSuspect(code)) continue
    const moved = code + offset
    if (moved < HEBREW_FIRST || moved > HEBREW_LAST) return false
    any = true
  }
  return any
}

function isAsciiGlyph(code: number): boolean {
  return code >= ASCII_FIRST_GLYPH && code <= ASCII_LAST_GLYPH
}

/** A code that cannot be text as it stands, and so is a candidate to be moved. */
function isSuspect(code: number): boolean {
  return code >= SUSPECT_FIRST && code <= SUSPECT_LAST
}

/**
 * One run, recovered.
 *
 * The Hebrew offset is optional because a run may be all figures — which is the
 * ordinary case for most of a payslip, and the case that matters most.
 */
export function recoverRun(text: string, hebrewOffset: number | undefined): string {
  let out = ''
  let hebrew = 0

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0

    if (isAsciiGlyph(code)) {
      out += String.fromCodePoint(code + ASCII_SHIFT)
      continue
    }

    if (hebrewOffset !== undefined && isSuspect(code)) {
      const moved = code + hebrewOffset
      if (moved >= HEBREW_FIRST && moved <= HEBREW_LAST) {
        out += String.fromCodePoint(moved)
        hebrew++
        continue
      }
    }

    out += character
  }

  // Visual order in, logical order out — pdf.js never saw Hebrew here, so its
  // own bidi pass had nothing to reorder and left the run as it was drawn.
  // Only a run the recovery actually turned into Hebrew: a row of figures was
  // never reordered and must not be.
  return hebrew > 0 ? [...out].reverse().join('') : out
}

/**
 * How much of a run is a character a person could read.
 *
 * The gain test, and it counts **digits as well as letters** — which the
 * `cmap` repair's own score does not have to, because that one only ever fixes
 * words. Here the figures are broken too, and a font that sets nothing but
 * numbers would score zero on letters alone and be left as control codes.
 */
export function legible(text: string): number {
  let count = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    // C0 controls are what an unmapped glyph id looks like at the bottom of the
    // range, and they are never text.
    if (code < 0x20) continue
    // **And the symbol block is excluded even though much of it is letters** —
    // which is the correction a real slip forced. An unmapped Hebrew glyph id
    // lands on things like `ʣ` (U+02A3) and `ʲ` (U+02B2), and Unicode calls
    // those letters, so a score that merely counted letters found the broken
    // run every bit as legible as the repaired one and kept the breakage. This
    // is the same exclusion `letters` in `pdfText.ts` makes, for the same
    // reason.
    if (SYMBOL_BLOCK.test(character)) continue
    if (/[\p{L}\p{N}]/u.test(character)) count++
  }
  return count
}

/** Where a misread encoding lands. Kept in step with `pdfText.ts`'s own copy. */
const SYMBOL_BLOCK = /[ -˿ -⏿]/
