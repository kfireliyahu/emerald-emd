import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { openPdfPages, type PageDraw, type PdfPages } from '@/data/importer/pdfPages.ts'
import type { LineBox } from '@/data/importer/pdfText.ts'

import type { DocumentSource } from './openDocumentText.ts'

/**
 * The document, beside what was read off it (D-168).
 *
 * **What it fixes is a sentence nobody could check.** A confirm surface says
 * *"the gross was taken from line 34, beside the line 33 the template names"*,
 * and until this existed the only way to test that claim was to open the same
 * PDF in another window and count lines. Every figure in this app that came off
 * a document rests on a transcription, and a transcription nobody can look at
 * is trusted rather than confirmed.
 *
 * **Optional, and off until asked for.** A render is real work, and the person
 * accepting their fourth slip under a stored format has no reason to pay for
 * it. The surface offers this; nothing opens it.
 *
 * **The marks are on the paper, so they are not theme tokens.** A PDF page is
 * drawn on white in both themes — an unprinted PDF is transparent, and the dark
 * theme behind it would make black paper with black ink on it — so a `--color-`
 * anything would be invisible on one side of the theme switch or garish on the
 * other. What is drawn here is a highlighter pen: fixed, amber, translucent,
 * and no relation to `accent`, which marks what you can act on and is a rule
 * about the app's own chrome (D-125).
 */
export function DocumentPane({
  source,
  active,
  read,
}: {
  readonly source: DocumentSource
  /**
   * The line the person is pointing at, 1-based the way a template numbers
   * them. Undefined is the ordinary state: the page, with nothing claimed.
   */
  readonly active: number | undefined
  /** Every line the reading took a figure off, marked faintly. */
  readonly read: readonly number[]
}) {
  const [pages, setPages] = useState<PdfPages | undefined>()
  const [problem, setProblem] = useState<string | undefined>()
  const holder = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // One document per file, torn down with the pane — the worker behind it is a
  // real resource and a flow that is left has to give it back.
  useEffect(() => {
    let live = true
    let opened: PdfPages | undefined

    setPages(undefined)
    setProblem(undefined)

    source.file
      .arrayBuffer()
      .then((buffer) => openPdfPages(new Uint8Array(buffer)))
      .then((result) => {
        opened = result
        if (live) setPages(result)
        else result.close()
      })
      .catch((error: unknown) => {
        if (live) setProblem(`The document could not be drawn: ${String(error)}`)
      })

    return () => {
      live = false
      opened?.close()
    }
  }, [source.file])

  // The width the page is drawn at, measured rather than assumed: the pane is a
  // column in a grid that changes with the window.
  useLayoutEffect(() => {
    const element = holder.current
    if (element === null) return undefined
    const observer = new ResizeObserver((entries) => {
      // Rounded, so a sub-pixel reflow does not redraw the document.
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const boxes = source.layout.lines
  const activeBox = active === undefined ? undefined : boxes[active - 1]
  const readBoxes = read
    .map((line) => boxes[line - 1])
    .filter((box): box is LineBox => box !== undefined)

  return (
    <div ref={holder} className="space-y-3">
      {problem !== undefined && <p className="text-caption text-negative">{problem}</p>}

      {pages === undefined && problem === undefined && (
        <p className="text-caption text-ink-tertiary">Drawing the document…</p>
      )}

      {pages !== undefined &&
        width > 0 &&
        Array.from({ length: pages.pages }, (_, index) => index + 1).map((number) => (
          <Page
            key={number}
            pages={pages}
            number={number}
            width={width}
            active={activeBox?.page === number ? activeBox : undefined}
            read={readBoxes.filter((box) => box.page === number)}
          />
        ))}
    </div>
  )
}

/**
 * One page, drawn, with the marks on top of it.
 *
 * The canvas is drawn imperatively and the marks are DOM, which is the split
 * that matters: a highlight painted into the canvas would mean redrawing the
 * whole page every time the pointer moved down a row.
 */
function Page({
  pages,
  number,
  width,
  active,
  read,
}: {
  readonly pages: PdfPages
  readonly number: number
  readonly width: number
  readonly active: LineBox | undefined
  readonly read: readonly LineBox[]
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const [draw, setDraw] = useState<PageDraw | undefined>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = canvas.current
    if (element === null) return undefined

    let live = true
    setFailed(false)

    pages
      .draw(number, element, width)
      .then((result) => {
        if (!live) return
        setDraw(result)
        // Undefined is a page that would not draw rather than an error — see
        // `PdfPages.draw`, and the `requestAnimationFrame` fact behind it.
        setFailed(result === undefined)
      })
      .catch(() => {
        if (live) setFailed(true)
      })

    return () => {
      live = false
    }
  }, [number, pages, width])

  // Bring the marked line into view when it changes, and only then: scrolling
  // on every render would fight the person scrolling the page themselves.
  useEffect(() => {
    if (active === undefined || draw === undefined) return
    mark.current?.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [active, draw])

  const placedActive = draw === undefined || active === undefined ? undefined : draw.place(active)

  return (
    <div className="relative overflow-hidden rounded-md border border-hairline-strong bg-white">
      <canvas ref={canvas} className="block" />

      {draw !== undefined &&
        read.map((box, index) => {
          const placed = draw.place(box)
          return (
            <div
              key={index}
              aria-hidden
              className="pointer-events-none absolute rounded-[2px]"
              style={{
                left: placed.left,
                top: placed.top,
                width: placed.width,
                height: placed.height,
                // Barely there. The question it answers is whether the reading
                // looked anywhere near the right part of the page, which does
                // not need to compete with the page itself.
                background: 'rgba(17, 17, 17, 0.06)',
              }}
            />
          )
        })}

      {placedActive !== undefined && (
        <div
          ref={mark}
          aria-hidden
          className="pointer-events-none absolute rounded-[2px]"
          style={{
            left: placedActive.left - 2,
            top: placedActive.top - 2,
            width: placedActive.width + 4,
            height: placedActive.height + 4,
            background: 'rgba(250, 204, 21, 0.38)',
            outline: '1.5px solid rgba(202, 138, 4, 0.85)',
          }}
        />
      )}

      {failed && (
        <p className="p-3 text-caption text-ink-secondary">
          Page {number} would not draw. That usually means the window was in the background while
          it was being rendered — bring it back and reopen the document.
        </p>
      )}
    </div>
  )
}

/** The JS half of `tokens.css`'s reduced-motion promise, as `useAnimatedNumber` has it. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
