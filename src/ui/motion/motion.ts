/**
 * **App-wide motion, one module** — M39 (D-421, D-423, U3).
 *
 * Four motions and no others: a row added or removed grows or shrinks into
 * place (`Flip.tsx`), a layout that reshapes moves its pieces to their new
 * places (`Flip.tsx`, `Reveal.tsx`), a claim whose verdict changes is marked
 * once (`useMark.ts`), and navigating or closing is a short fade (the route's
 * `fc-view-enter`, `closing.ts`). **Figures still count** (D-167 stands,
 * 2026-10-07): `useAnimatedNumber` is not one of the four and is not
 * touched by them.
 *
 * **All four are on everywhere** — every build, the demo and `check:tours` —
 * and **all four are off under reduced motion**, read at the moment a motion
 * starts. The dev server's mockup switch went when U3 ported the last of them;
 * to see what moves, slow the page's animations in the browser's own tools.
 */

/** The one duration a motion takes, in ms — about 150–200, the brief's range. */
export const MOTION_MS = 180
/** Navigating and closing: shorter, because nothing is being explained. */
export const FADE_MS = 150
/** A verdict that changed: how long the mark takes to fade, once. */
export const MARK_MS = 900
/**
 * The one easing — `tokens.css`' `--ease-out`, the curve every entrance in the
 * app already uses. Front-loaded: a moved piece is nearly there at once and
 * settles, which is what makes 180 ms read as quick rather than slow.
 */
export const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

export function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * **Whether anything moves right now** — all four motions. Read at the moment a motion would start, not cached: a person can
 * ask the OS for less motion while the app is open, and the next row added
 * must already be still.
 */
export function motionOn(): boolean {
  return !reducedMotion() && typeof Element !== 'undefined' && 'animate' in Element.prototype
}
