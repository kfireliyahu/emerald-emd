/**
 * **What is moving, and when it has stopped** — M39 U2.
 *
 * Every animation that moves layout — a row growing in or shrinking out, the
 * rows below it sliding, a panel making its room, a card crossing to another
 * lane — carries `LAYOUT_MOTION` as its `id` (`Flip.tsx`, `Reveal.tsx`). A
 * verdict's mark does not: it tints a word in place and moves nothing, so
 * nothing has to wait for it. **A card popping in counts** (M39 F1): `fc-pop-in`
 * moves its box by a few pixels and a scale while it plays, and a box measured
 * then is not where it stays.
 *
 * **The demo's tour waits on this, never on the clock** (`src/demo/tour/`): a
 * box measured mid-move is where it was a frame ago, so the runner asks for the
 * layout to settle before it scrolls to an anchor, clicks one or outlines one —
 * by the animations' own `finished`, which is the moment and not a guess at it.
 * No DOM types beyond what it reads, so a test can hand it a stand-in.
 */

/** The `id` every layout-moving animation carries. */
export const LAYOUT_MOTION = 'emerald-layout'
/** The CSS entrance that moves a box while it plays (`tokens.css`' `.fc-pop-enter`). */
const POP = 'fc-pop-in'

export interface Moving {
  readonly id: string
  /** A CSS animation's keyframes, by name. */
  readonly animationName?: string
  readonly playState: string
  readonly finished: Promise<unknown>
}

export interface Animated {
  getAnimations?: () => readonly Moving[]
}

/** The layout animations that have not finished, in a document. */
export function movingLayout(doc: Animated): readonly Moving[] {
  const all = typeof doc.getAnimations === 'function' ? doc.getAnimations() : []
  return all.filter((each) => (each.id === LAYOUT_MOTION || each.animationName === POP) && (each.playState === 'running' || each.playState === 'pending'))
}

/**
 * **Resolves when nothing in the document is moving layout**, answering whether
 * anything was. One that is cancelled counts as stopped; one started while the
 * last finished (a panel closing as the rows under it slide) is waited for too.
 * `cancelled` is asked between rounds, so a tour stopped mid-wait lets go.
 */
export async function layoutSettled(doc: Animated, cancelled: () => boolean = () => false): Promise<boolean> {
  let waited = false
  // A round per wave of motion; a hundred would be a loop, not a layout.
  for (let round = 0; round < 100; round += 1) {
    const moving = movingLayout(doc)
    if (moving.length === 0 || cancelled()) return waited
    waited = true
    await Promise.all(moving.map((each) => each.finished.catch(() => undefined)))
  }
  return waited
}
