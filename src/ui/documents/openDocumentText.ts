/**
 * Getting the text out of a file a person opened — the one path every
 * label-value document takes, whatever it is a document *of*.
 *
 * A payslip and a pension report are the same file to a PDF reader, and every
 * hard-won thing under this is about the file rather than about payroll: lines
 * rebuilt from glyph positions (D-141), a page split into panels (D-142), a
 * boxed total whose name and figure are two lines (D-143), a `ToUnicode` table
 * that lies (D-144), a document that states no encoding at all and is read from
 * its glyph order (D-146) with its *words* from a local OCR pass over a picture
 * of the page (D-147). Sharing this is not tidiness — it is the difference
 * between fund reports getting four decisions' worth of PDF handling and getting
 * an empty document that reads as a format nothing recognises.
 *
 * **The notices come back with the text, not from inside the reader.** What a
 * screen has to *say* about a document is a fact about the document, and the two
 * cases here differ in what they ask of a person: one is a doubt about
 * provenance ("nothing in this file says what its text is"), the other is a
 * request ("name the rows once"). A screen renders them; nothing here decides
 * where.
 */

import {
  extractPdfText,
  type DocumentLayout,
  type ReadStage,
} from '@/data/importer/pdfText.ts'

/**
 * What is happening, in one sentence, for the surface to print (D-171).
 *
 * **Said here rather than in the reader**, for the reason the notices are: what
 * a screen has to *say* is a fact about the document, and the reader's business
 * is stages. Two sentences would drift the first time one of them gained a
 * case.
 */
export function readStageText(stage: ReadStage): string {
  switch (stage.kind) {
    case 'loading':
      return 'Loading the PDF reader…'
    case 'reading':
      return stage.pages === 1
        ? 'Reading the page…'
        : `Reading page ${String(stage.page)} of ${String(stage.pages)}…`
    case 'recovering':
      // D-144 and D-146: the file is lying about its own text, and this is the
      // second pass through it. Worth naming, because it is also the reason the
      // notice underneath will say something surprising afterwards.
      return 'This PDF does not say what its text is — working it out…'
    case 'ocr':
      // The four-second one (D-147). The only stage a person would otherwise
      // wonder about, and the reason this exists at all.
      return `Reading the words off a picture of page ${String(stage.page)}…`
  }
}

/**
 * The document the text came off, kept so a person can look at it (D-168).
 *
 * **The file rather than its bytes**, because pdf.js takes ownership of a buffer
 * it is handed and may detach it — a `File` can be read again as many times as
 * a viewer needs, and a detached `Uint8Array` reads as an empty document with
 * no error anywhere.
 *
 * Present only for a PDF. Pasted text has no page to show, which is not a
 * failure: it is the terminating rung of F17's ladder, and the surface simply
 * offers nothing to open.
 */
export interface DocumentSource {
  readonly file: File
  readonly layout: DocumentLayout
}

export type DocumentText =
  | {
      readonly kind: 'text'
      readonly text: string
      readonly notice: string | undefined
      readonly source: DocumentSource | undefined
    }
  | { readonly kind: 'problem'; readonly problem: string }

/** The stronger claim, and the one the user chose to be told (D-146). */
const INFERRED_NOTICE =
  'This PDF does not say what its text is — it carries the shapes of the letters and no record ' +
  'anywhere of what they mean, so no reader can extract it, this one included. The words and ' +
  'figures below were worked out from the order the shapes are stored in. The arithmetic still ' +
  'has to check out, and it is worth reading the figures against the document once.'

/**
 * Said once, plainly, because it looks like the app is broken and it is not
 * (D-144). Everything else still works — the figures are right, the arithmetic
 * checks them, and the template will read next month's document by the same
 * marks.
 */
const UNREADABLE_LABELS_NOTICE =
  'The names in this PDF are not text — the font carries the shapes and no record of what they ' +
  'say, so no reader can turn them back into words. The figures are unaffected. Name what needs ' +
  'naming once below and this format will be read the same way every time.'

const NO_TEXT_LAYER =
  'There is no text in that PDF at all — it is a scan, a photograph, or a file that was ' +
  'printed back to PDF, which turns the page into a picture. Try the original download rather ' +
  'than a printed copy; if this is the original, open it in a viewer and see whether any text ' +
  'can be selected, and if none can, it has to be entered by hand.'

/**
 * A file, whichever of the two it is.
 *
 * **The PDF reader is only reached from this function**, which is what makes it
 * a chunk that a person who never opens one never fetches — still true after
 * D-171 moved the *call site* up into the two flows, because what moved is who
 * calls this and not what this calls. A scan and a damaged file are both
 * sentences rather than an empty document: an empty document would match no
 * template, derive nothing, and leave somebody staring at a page they can see
 * the figures on.
 *
 * `onStage` is what a surface prints while it waits (D-171). Optional, because
 * nothing about the read depends on anybody listening.
 */
export async function openDocumentText(
  file: File,
  onStage?: (stage: ReadStage) => void,
): Promise<DocumentText> {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'

  if (!isPdf) {
    const text = await file.text()
    return { kind: 'text', text, notice: undefined, source: undefined }
  }

  const buffer = await file.arrayBuffer()
  const extract = await extractPdfText(new Uint8Array(buffer), onStage)

  if (extract.kind === 'text') {
    // Two different things a document can be wrong about, and they get different
    // sentences because they ask different things of a person.
    const notice = extract.inferredFromGlyphOrder
      ? INFERRED_NOTICE
      : extract.unreadableLabels
        ? UNREADABLE_LABELS_NOTICE
        : undefined
    return {
      kind: 'text',
      text: extract.text,
      notice,
      source: { file, layout: extract.layout },
    }
  }

  return {
    kind: 'problem',
    problem: extract.kind === 'noTextLayer' ? NO_TEXT_LAYER : extract.reason,
  }
}
