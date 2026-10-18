/**
 * Reading the drawn page, locally, when the file will not say what it contains.
 *
 * **Everything here stays on this machine, and that is enforced rather than
 * intended.** Tesseract is C++ compiled to wasm and runs in this process: there
 * is no service behind it and no key for one. What it *ships* with, though, is
 * a set of defaults that would quietly reach a CDN for its core and its
 * language data and cache that data in IndexedDB — so all four are overridden
 * here, and the reasons are different for each:
 *
 * - `corePath` and `workerPath` are bundled assets, imported with `?url` so the
 *   build emits them and hands back an `app://` path. The **self-contained**
 *   core is used — the variant with its wasm embedded — because a second fetch
 *   is a second thing to get wrong offline.
 * - `langPath` is `public/tesseract/`, where `heb.traineddata` is vendored. It
 *   is a data file that never changes and it is 1MB; a build step to copy it
 *   would be more machinery than the file is worth.
 * - `cacheMethod: 'none'`, because the default writes the language data into
 *   **IndexedDB**, and this app keeps its state in the document and nowhere
 *   else (D-115). There is nothing to cache: the file is already local.
 *
 * If any of that were wrong it would fail loudly rather than phone home — the
 * shell cancels every request that is not `app://`, `blob:` or `data:` (D-124),
 * so a CDN default dies in development instead of shipping.
 *
 * **Hebrew only.** English was in the spike and came out again: the figures
 * come from the PDF, exactly, so the only thing asked of OCR is the words
 * (D-147). That is 5MB of language data not shipped.
 *
 * **Loaded on demand.** Everything here is behind a dynamic import in
 * `pdfText.ts`, so a person who never opens a document that needs it never
 * fetches four megabytes of it — the same bargain pdf.js already makes (D-141).
 */

import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import workerUrl from 'tesseract.js/dist/worker.min.js?url'

import type { OcrWord } from './relabel.ts'

/**
 * How much bigger than its natural size the page is drawn before it is read.
 *
 * Four, and it is measured rather than chosen: the same slip read at six and at
 * eight came out **worse**, 38 figures against 41, because the glyph edges
 * Tesseract's model was trained on stop looking like themselves. More pixels is
 * not more evidence.
 */
export const RENDER_SCALE = 4

/**
 * Where the language data sits.
 *
 * **Absolute, and that is the whole of it.** A relative path is resolved by the
 * *worker*, which is served from wherever the bundler put it — so `tesseract`
 * became `…/tesseract.js/dist/tesseract/heb.traineddata` and the dev server
 * refused it, leaving the read hanging with a bare 403 in the console.
 */
const LANG_PATH = '/tesseract'

/**
 * Read one already-drawn page.
 *
 * Takes the canvas rather than the PDF: rendering is pdf.js's job and belongs
 * with the rest of it, and this way the expensive half can be handed a page
 * from anywhere — including, one day, a photograph, which is the case none of
 * D-146's arithmetic can touch.
 *
 * `pageHeight` is the page in points, which is what turns image pixels back
 * into the coordinates every other part of the reader speaks.
 */
export async function readPage(
  canvas: HTMLCanvasElement,
  pageHeight: number,
): Promise<readonly OcrWord[]> {
  const { createWorker } = await import('tesseract.js')

  const worker = await createWorker('heb', 1, {
    corePath: coreUrl,
    workerPath: workerUrl,
    langPath: LANG_PATH,
    // The vendored file is not gzipped, so it is not asked for as `.gz`.
    gzip: false,
    // Never IndexedDB. The data is already on disk, beside the app.
    cacheMethod: 'none',
    legacyCore: false,
    legacyLang: false,
  })

  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true })
    // Both measurements come from the canvas rather than from the result.
    // Tesseract's own `imageHeight` is not on the object in this version, and
    // reading it off anyway yields `undefined` — which silently turns every
    // word's y into a negative number, puts the whole page above its own top
    // edge, and matches nothing. It failed by finding no words rather than the
    // wrong ones, which is the kind of failure that looks like "OCR did not
    // help" instead of like a bug.
    return wordsOf(data, canvas.height, canvas.height / pageHeight)
  } finally {
    // Always, including when recognition threw: a worker left running holds a
    // wasm heap the size of the model.
    await worker.terminate()
  }
}

/**
 * Tesseract's nested blocks, flattened to placed words in the page's own
 * coordinates.
 *
 * Two conversions, and the y one is the one that is easy to get wrong: an image
 * counts down from the top and a PDF counts up from the bottom.
 */
function wordsOf(data: unknown, pixelsHigh: number, scale: number): readonly OcrWord[] {
  const blocks = (data as { blocks?: unknown }).blocks
  if (!Array.isArray(blocks)) return []

  const words: OcrWord[] = []

  for (const block of blocks) {
    for (const paragraph of listOf(block, 'paragraphs')) {
      for (const line of listOf(paragraph, 'lines')) {
        for (const word of listOf(line, 'words')) {
          const found = word as { text?: unknown; bbox?: Record<string, unknown> }
          const text = typeof found.text === 'string' ? found.text.trim() : ''
          if (text === '') continue

          const box = found.bbox
          if (box === undefined) continue
          const x0 = Number(box['x0'])
          const y0 = Number(box['y0'])
          const x1 = Number(box['x1'])
          const y1 = Number(box['y1'])
          if (![x0, y0, x1, y1].every(Number.isFinite)) continue

          words.push({
            text,
            x: (x0 + x1) / 2 / scale,
            y: (pixelsHigh - (y0 + y1) / 2) / scale,
          })
        }
      }
    }
  }
  return words
}

function listOf(node: unknown, key: string): readonly unknown[] {
  const found = (node as Record<string, unknown>)?.[key]
  return Array.isArray(found) ? found : []
}
