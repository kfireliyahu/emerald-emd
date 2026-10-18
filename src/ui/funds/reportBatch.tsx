import type { ReactNode } from 'react'

/**
 * A stack of fund reports being read in one sitting (D-164).
 *
 * **What this fixes is a shape, not a screen** — the same sentence `FlowFrame`
 * was written for, one level up. Reading one report is built and works
 * (D-149, D-152, D-153); reading the eight in a drawer means doing it eight
 * times, and between each one the flow drops you back on the fund screen with
 * no memory that there are seven left. That is not a feature that is missing,
 * it is the same feature with the wrong scope, and the cost of it is the thing
 * F13 says matters: a fund whose readings start this year reports a return and a
 * fee drag over a window it did not live through.
 *
 * **The batch is a queue of files and nothing more.** No file is opened until
 * the reader asks for it, which is what keeps eight PDFs from being eight
 * pdf.js passes before anybody has looked at the first — and it is also why the
 * batch gets *cheaper as it goes*: accepting the first report stores the format,
 * and the other seven are read by it without a model being asked anything.
 *
 * **It holds `File`s, which is the one thing here a person cannot get back.** A
 * `File` is a handle the browser gave the picker; nothing in this app can
 * re-open one by name. So the queue lives on the screen that owns the flow, and
 * leaving the flow throws it away — the honest behaviour, and the reason the
 * exit says how many are still unread.
 */
export interface ReportBatch {
  /** The document the reader should open now, and the only one it opens. */
  readonly opening: File | undefined
  /** Behind it, unopened. */
  readonly queued: readonly File[]
  /** What became of the ones already through, oldest first. */
  readonly done: readonly BatchOutcome[]
  /**
   * Bumped on every advance, and used as the reader's `key`.
   *
   * A reader carrying the previous document's text, format name and typed-over
   * fees into the next report is exactly the mistake this queue would otherwise
   * make easy. Remounting is not a workaround for stale state; it is the
   * statement that each document is read from nothing.
   */
  readonly step: number
}

export interface BatchOutcome {
  readonly name: string
  readonly outcome: 'saved' | 'skipped'
}

export const NO_BATCH: ReportBatch = { opening: undefined, queued: [], done: [], step: 0 }

/** What the picker handed over, with the first of them going to the reader. */
export function startBatch(files: readonly File[], from: ReportBatch): ReportBatch {
  return {
    opening: files[0],
    queued: files.slice(1),
    done: from.done,
    step: from.step + 1,
  }
}

/**
 * The current document is finished with; the next one goes to the reader.
 *
 * A document with nothing behind it leaves `opening` undefined, which is the
 * reader's empty state — the picker, ready for another handful.
 */
export function advanceBatch(batch: ReportBatch, outcome: BatchOutcome['outcome']): ReportBatch {
  return {
    opening: batch.queued[0],
    queued: batch.queued.slice(1),
    done:
      batch.opening === undefined
        ? batch.done
        : [...batch.done, { name: batch.opening.name, outcome }],
    step: batch.step + 1,
  }
}

/** Whether anything is in flight — the whole surface is quiet without one. */
export function inBatch(batch: ReportBatch): boolean {
  return batch.done.length > 0 || batch.queued.length > 0
}

export function batchTotal(batch: ReportBatch): number {
  return batch.done.length + (batch.opening === undefined ? 0 : 1) + batch.queued.length
}

/**
 * Where you are in the stack, for the header of whichever of the three surfaces
 * is showing.
 *
 * One line rather than a rail, because the flow already fills the window with
 * the figures being checked and a progress bar competing with them would be the
 * wrong thing drawn largest. It is `ink-tertiary` and it counts.
 */
export function BatchProgress({ batch }: { batch: ReportBatch }): ReactNode {
  if (!inBatch(batch)) return undefined
  const total = batchTotal(batch)
  const at = batch.done.length + (batch.opening === undefined ? 0 : 1)
  const skipped = batch.done.filter((one) => one.outcome === 'skipped').length

  return (
    <span className="text-caption text-ink-tertiary tabular-nums">
      {batch.opening === undefined ? `${total} read` : `Report ${at} of ${total}`}
      {skipped > 0 && ` · ${skipped} skipped`}
    </span>
  )
}

/**
 * The stack itself, under the reader's input.
 *
 * Named files rather than a count, because the question a person has here is
 * *which* one is being read — eight quarterlies downloaded from one portal are
 * eight names that differ by four characters, and "report 3 of 8" does not say
 * whether 3 is Q3 2024 or Q3 2025.
 */
export function BatchStack({ batch }: { batch: ReportBatch }): ReactNode {
  if (!inBatch(batch)) return undefined

  return (
    <div className="space-y-1 text-caption">
      {batch.done.map((one, index) => (
        <div key={`${one.name}-${index}`} className="flex items-center gap-2 text-ink-tertiary">
          <span className="w-16 shrink-0">{one.outcome === 'saved' ? 'Saved' : 'Skipped'}</span>
          <span className="truncate line-through decoration-hairline-strong">{one.name}</span>
        </div>
      ))}

      {batch.opening !== undefined && (
        <div className="flex items-center gap-2 text-ink">
          <span className="w-16 shrink-0 text-ink-secondary">Reading</span>
          <span className="truncate font-medium">{batch.opening.name}</span>
        </div>
      )}

      {batch.queued.map((file, index) => (
        <div key={`${file.name}-${index}`} className="flex items-center gap-2 text-ink-tertiary">
          <span className="w-16 shrink-0">Waiting</span>
          <span className="truncate">{file.name}</span>
        </div>
      ))}

      {batch.queued.length > 0 && (
        <p className="pt-2 text-ink-tertiary">
          Leaving drops the {batch.queued.length} still waiting. Nothing here can re-open a file by
          name — the picker is the only thing that can hand one over — so they would have to be
          picked again, which costs nothing but the walk back.
        </p>
      )}
    </div>
  )
}
