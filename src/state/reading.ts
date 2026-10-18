import { createStore } from './store.ts'

/**
 * The one document being read, kept where the screen reading it cannot take it
 * away (D-171).
 *
 * **What this fixes.** Opening a payslip PDF is 1.7 MB of reader fetched on
 * demand (D-141), then the text, then — on a document that lies about its own
 * encoding — a four-second OCR pass per page (D-147), and then, if a model is
 * switched on, the fourteen seconds D-152 measured. All of it ran inside
 * `ReadSlip`'s `useState`, so leaving the flow threw it away and the only
 * honest thing the app could do was refuse to let you leave.
 *
 * **One read at a time, on purpose.** Two concurrent PDF reads on the main
 * thread (D-141) would make both slower and neither cancellable, and the batch
 * that reads eight reports in a sitting is deliberately a *queue* for the same
 * reason (D-164). Starting a second read replaces the first, and the `id` is
 * what stops the replaced one writing its answer over the new one when it
 * finally settles — the same stale-response guard any async screen needs, in
 * the one place all of them now share.
 *
 * **The trap named in docs/08 turns out not to apply here, and it is worth
 * saying why.** pdf.js draws through `requestAnimationFrame`, so a page nothing
 * is looking at never finishes — the fact `pdfText.ts` records and that cost an
 * afternoon. But `requestAnimationFrame` is a property of **the document's
 * visibility**, not of whether a React component is mounted: leaving the flow
 * for another screen keeps the window visible, so the render still runs. What
 * still stalls is switching to another application, and that was already true
 * before any of this and is what `RENDER_DEADLINE_MS` is for.
 *
 * A plain store rather than zustand, like `useFullWindow` and `useSidebar`:
 * this describes what is happening right now, and a reload has nothing
 * happening.
 */

/**
 * Which flow a read belongs to. No two of them ever share one: two flows
 * sharing a kind would each collect the other's read, and the whole point of
 * this store is that a read outlives the screen that started it (D-171).
 */
export type ReadKind = 'payslip' | 'report'

export interface DocumentRead {
  readonly id: number
  readonly kind: ReadKind
  /** The hash the flow lives at, so the bar can offer to go back to it. */
  readonly at: string
  /** What is being read, named the way a person would name it: the file. */
  readonly label: string
  /**
   * Whether the flow that owns this read is being shown.
   *
   * **It is here rather than in the screen** because two things decide it and
   * they are in different components: leaving the flow closes it, and the foot
   * bar reopens it. A screen holding its own boolean cannot be reopened by a
   * bar that is not its child, and hanging the reopen off the screen *mounting*
   * silently does nothing when the bar is pressed from the screen it points at
   * — which is exactly what it did, on the first drive.
   */
  readonly open: boolean
  readonly working: boolean
  /** What it is doing, while it is working. */
  readonly note: string | undefined
  /** Model tokens so far, where a model is involved at all. */
  readonly tokens: number
  /**
   * What the flow got — the flow's own shape, and the one piece of this store
   * that is not typed.
   *
   * There is exactly one reader per `kind` and it is the only thing that ever
   * writes or reads this, so the cast at that boundary is checked by the same
   * file that produces the value. A generic store would push the same cast up
   * into every consumer and call it safety.
   */
  readonly value: unknown
  /** Why there is no value, said the flow's way. */
  readonly problem: string | undefined
}

const reading = createStore<DocumentRead | undefined>(undefined)
let nextId = 1

function set(next: DocumentRead | undefined): void {
  reading.set(next)
}

/** The read in flight or waiting to be collected, whichever flow owns it. */
export function useDocumentRead(): DocumentRead | undefined {
  return reading.use()
}

/** The same answer outside React, which is what makes the store testable. */
export function readingNow(): DocumentRead | undefined {
  return reading.get()
}

/**
 * Begin a read, replacing whatever was there.
 *
 * The returned id is the caller's proof that it is still the current read.
 * Every update below takes it and does nothing if it does not match, so a read
 * the user abandoned cannot land in the flow they abandoned it for.
 */
export function startRead(input: {
  readonly kind: ReadKind
  readonly label: string
}): number {
  const id = nextId++
  set({
    id,
    kind: input.kind,
    // **Where the app is standing when the read starts**, which is the screen
    // that rendered the flow — no prop to thread through two layers of
    // wrapper, and no way for a caller to name a hash it is not on.
    at: typeof window === 'undefined' ? '#/' : window.location.hash || '#/',
    label: input.label,
    open: true,
    working: true,
    note: undefined,
    tokens: 0,
    value: undefined,
    problem: undefined,
  })
  return id
}

export function noteRead(id: number, note: string | undefined): void {
  const current = reading.get()
  if (current?.id !== id) return
  set({ ...current, note })
}

export function countTokens(id: number, tokens: number): void {
  const current = reading.get()
  if (current?.id !== id) return
  set({ ...current, tokens })
}

/** The read is over, one way or the other. */
export function finishRead(
  id: number,
  outcome: { readonly value?: unknown; readonly problem?: string | undefined },
): void {
  const current = reading.get()
  if (current?.id !== id) return
  set({
    ...current,
    working: false,
    note: undefined,
    value: outcome.value,
    problem: outcome.problem,
  })
}

/**
 * The flow replacing what it is holding — a format chosen by hand, a reading
 * discarded.
 *
 * The read is *finished* by then, so this does not take an id: the entry it
 * writes to is the one the flow is looking at.
 */
export function replaceRead(value: unknown): void {
  const current = reading.get()
  if (current === undefined || current.working) return
  set({ ...current, value })
}

/**
 * Show or hide the flow this read belongs to.
 *
 * Hiding does not stop the read — that is the whole point of it — and the foot
 * bar is what stops a hidden read from being a thing happening for no visible
 * reason.
 */
export function showRead(): void {
  const current = reading.get()
  if (current === undefined || current.open) return
  set({ ...current, open: true })
}

export function hideRead(): void {
  const current = reading.get()
  if (current === undefined || !current.open) return
  set({ ...current, open: false })
}

/** Nothing is being read and nothing is waiting. Called when a flow is left for good. */
export function clearRead(): void {
  set(undefined)
}
