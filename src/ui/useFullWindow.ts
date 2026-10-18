import { useEffect, useSyncExternalStore } from 'react'

import { createStore } from '@/state/store.ts'

/**
 * Whether something has taken the whole window.
 *
 * docs/06 calls this **outside the tabs**: onboarding and the import flow
 * replace the routed views entirely, the sidebar stops being navigable, and the
 * flow carries its own way out. It was a property of those two screens because
 * they are rendered by `App` instead of the router — which is exactly why
 * nothing else could have it. A fund reading was a form, inside a pane, inside
 * a list, and there was no way for it to say otherwise.
 *
 * This is that sentence, said by a component rather than by `App`. A flow
 * claims the window while it is mounted; the sidebar, the tab strip and the
 * list-and-detail layout each read the claim and get out of the way.
 *
 * **A counter, not a boolean.** Two claims can overlap for a frame during a
 * transition — a reading accepted from a report opens the editor while the
 * reader is still unmounting — and a boolean would be cleared by whichever one
 * happened to leave second, dropping the window back into the list for a frame.
 *
 * The same plain store as `useSidebar` and `useTheme`. **Not persisted**: this
 * describes what is on screen right now, and a reload has nothing on screen.
 */

const claims = createStore(0)

function snapshot(): boolean {
  return claims.get() > 0
}

/** True while any flow has the window. Read by the shell, never by a flow. */
export function useWindowTaken(): boolean {
  return useSyncExternalStore(claims.subscribe, snapshot, snapshot)
}

/** The same answer, outside React — which is what makes the store testable. */
export function isWindowTaken(): boolean {
  return snapshot()
}

/**
 * Claim the window, and hand back the release.
 *
 * Separated from the hook so the counting and the deferred release can be
 * tested as what they are: two rules about a number, both of which are wrong in
 * ways that look like a flicker rather than like a failure.
 */
export function claimWindow(): () => void {
  claims.set(claims.get() + 1)

  let released = false
  return () => {
    if (released) return
    released = true
    // **The decrement itself is a microtask late, not just the notification.**
    // One flow hands over to the next inside a single commit — a report
    // accepted into the reading form, the text step giving way to the review —
    // and React runs every cleanup before any setup, so a synchronous decrement
    // would take the count through zero with the next claim not yet made.
    // Deferring only the `notify` was not enough: `useSyncExternalStore` reads
    // `getSnapshot` on every render, so any render landing in that gap sees a
    // free window and puts the list back. Deferring the count means the gap
    // does not exist to be observed.
    queueMicrotask(() => claims.set(claims.get() - 1))
  }
}

/**
 * Claim the window for as long as this component is mounted.
 *
 * `FlowFrame` is the only caller and that is deliberate — a claim without the
 * frame is a screen that hides the nav and offers no way back, which is the
 * one shape this must never produce.
 */
export function useClaimWindow(): void {
  useEffect(claimWindow, [])
}
