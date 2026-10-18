import type { TourDeclare } from './tour/declare.ts'

/**
 * **What the demo's app page offers the frame around it** (M33 U2).
 *
 * The frame (`demo-frame.html`, `src/demo/tour/`) holds the app in an iframe
 * of the same origin: the app sees a viewport of its own, so a list that
 * places itself by the viewport lands where it should even when the frame
 * plays it scaled down as a movie. The frame reaches the app through this and
 * through the app's DOM, and nothing else — no screen knows a tour exists.
 */
export interface DemoHandle {
  /** Settles once the document is open. */
  readonly ready: Promise<void>
  /**
   * Throws away whatever is open — the tour's work, or a visitor's — and opens
   * the demo's bytes again, at Home.
   */
  reopen(): Promise<void>
  /** Called after every write to the open document; returns the unsubscribe. */
  onWrite(listener: () => void): () => void
  /**
   * **A tour's `write`** (M33 F5): rows into a declared format, judged and
   * written as `record_format_rows` writes them — `stageRows`, then
   * `insertRows`, inside the store's `mutate` so the open screen redraws as
   * after any write. Throws the engine's refusal, and writes nothing then.
   */
  record(format: string, rows: readonly Readonly<Record<string, unknown>>[]): void
  /**
   * **A tour's declaring `write`** (M33 U7): a format made, or added to, judged
   * as the screens judge one — its own rules, a pack's lock, the reconciler's
   * plan — and written by `adoptFormat`. Throws the refusal, and writes nothing then.
   */
  declare(input: TourDeclare): void
}

declare global {
  interface Window {
    emeraldDemo?: DemoHandle
  }
}
