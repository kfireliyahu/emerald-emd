/**
 * Drawing the page a reading came off — the other half of `pdfText.ts` (D-168).
 *
 * That file turns a PDF into lines and remembers where each one is; this one
 * puts the page on screen and converts a line's box into pixels inside it. They
 * are separate because they are wanted at different moments and by different
 * people: every reading pays for the text, and only somebody who wants to look
 * pays for a render.
 *
 * **Nothing here decides anything about the document.** No figure, no anchor, no
 * proof — a canvas and a rectangle. If this file ever starts reading, it is in
 * the wrong place.
 *
 * **The same pdf.js, loaded the same way**: on demand, from the app's own origin,
 * with no worker and no request that leaves the machine (D-124, D-141). The
 * import is the chunk `openDocumentText` already pulls, so opening the viewer
 * after a reading costs nothing to fetch.
 */

import { loadPdfJs, openOptions, paintPage, type LineBox } from './pdfText.ts'

/**
 * A page's box in CSS pixels inside the canvas it was drawn on.
 *
 * Top-left origin, because that is where the DOM puts things — the conversion
 * out of the PDF's bottom-left frame is `convertToViewportPoint`'s job and not
 * arithmetic anybody should be doing by hand, since it also carries the page's
 * rotation.
 */
export interface PlacedBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface PageDraw {
  /** What the canvas ended up measuring, in CSS pixels. */
  readonly width: number
  readonly height: number
  /** Where a line of this page landed on it. */
  place(box: LineBox): PlacedBox
}

export interface PdfPages {
  readonly pages: number
  /**
   * Draw one page into a canvas at `width` CSS pixels across.
   *
   * Undefined when the page would not draw, which is a real outcome rather than
   * an error: **pdf.js draws through `requestAnimationFrame`, so a page nothing
   * is looking at never finishes** — a collapsed pane, a hidden window, another
   * workspace. It cost an afternoon once looking like a code bug (D-147), and
   * the answer is the same here as there: a deadline, and a surface that says
   * the page could not be drawn instead of a spinner that never stops.
   */
  draw(page: number, canvas: HTMLCanvasElement, width: number): Promise<PageDraw | undefined>
  close(): void
}

/**
 * How sharp a page is drawn, capped.
 *
 * Device pixels on a 3× phone screen would be nine times the canvas for a page
 * nobody is reading at that magnification, and a payslip is one page of text —
 * 2× is the point past which nothing in it gets easier to read.
 */
const MAX_PIXEL_RATIO = 2

export async function openPdfPages(bytes: Uint8Array): Promise<PdfPages> {
  const pdfjs = await loadPdfJs()
  // The **loading task** is kept, not just the document: closing the viewer has
  // to tear the worker down, and `destroy` is the task's method rather than the
  // document proxy's.
  const task = pdfjs.getDocument(openOptions(bytes))
  const document = await task.promise

  return {
    pages: document.numPages,

    async draw(number, canvas, width) {
      if (number < 1 || number > document.numPages || width <= 0) return undefined

      const page = await document.getPage(number)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })

      const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO)
      canvas.width = Math.ceil(viewport.width * ratio)
      canvas.height = Math.ceil(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const drawn = await paintPage(page, canvas, viewport, ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0])
      if (!drawn) return undefined

      return {
        width: viewport.width,
        height: viewport.height,
        place(box) {
          const [x1, y1] = viewport.convertToViewportPoint(box.x, box.y)
          const [x2, y2] = viewport.convertToViewportPoint(box.x + box.width, box.y + box.height)
          const left = Math.min(x1, x2)
          const top = Math.min(y1, y2)
          return {
            left,
            top,
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          }
        },
      }
    },

    close() {
      void task.destroy()
    },
  }
}
