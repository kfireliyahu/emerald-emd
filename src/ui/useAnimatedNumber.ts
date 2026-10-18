import { useEffect, useRef, useState } from 'react'

import { money, type Money } from '@/core/money.ts'

/**
 * A figure counting to its new value — docs/11's "numbers animate when they
 * change", which that note has called *the app's signature interaction* since
 * M1 and which nothing had ever built.
 *
 * **The boundary is the whole of the feature, and it is not "money animates".**
 * Animate a figure that **changes in front of you** — the splitter's amounts as
 * a slider moves, the fee-impact columns as a rate is typed, the ledger's total
 * as a filter narrows — and never one that merely *appears*. A hero number
 * counting up on every route change is the excess docs/11 warns about, so this
 * hook **does not animate its first value**: it mounts showing the truth, and
 * only a subsequent change is worth watching. That single rule is what keeps it
 * from spreading to every screen.
 *
 * **The money path is untouched.** The interpolation is float — it is a
 * position along 200ms, not an amount — and what comes out is a rounded integer
 * of minor units. `useAnimatedMoney` is the wrapper that keeps the currency
 * attached, and the last frame is the target itself rather than a rounded
 * approach to it, so a count-up can never leave a figure an agora short of what
 * the domain computed.
 */

/** docs/11's "standard duration". A count that outlasts the gesture is a wait. */
export const COUNT_DURATION_MS = 200

/**
 * docs/11's ease-out for entrances, as a function rather than a bezier string:
 * this animation is driven by `requestAnimationFrame` and not by CSS, because
 * CSS cannot interpolate the text inside an element.
 *
 * Cubic, which is the same shape as `--ease-out`'s tail — fast first, settling
 * — so a counting figure and a fading panel feel like one system.
 */
export function easeOut(progress: number): number {
  const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress
  return 1 - (1 - clamped) ** 3
}

/**
 * Where a count is at, as a pure function of elapsed time — the whole of the
 * arithmetic, extracted so it is testable in Node with no DOM (the suite has no
 * jsdom, deliberately).
 *
 * Rounds to an integer, because every figure this drives is minor units. Past
 * the duration it returns `to` exactly: the final frame must be the value, not
 * a value near it.
 */
export function countAt(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs: number = COUNT_DURATION_MS,
): number {
  if (elapsedMs >= durationMs || durationMs <= 0) return to
  if (elapsedMs <= 0) return from
  return Math.round(from + (to - from) * easeOut(elapsedMs / durationMs))
}

/**
 * True when the machine has asked for less motion. Read per animation rather
 * than subscribed to: the answer only matters at the moment one would start,
 * and a count that is already running is 200ms from being over anyway.
 *
 * `tokens.css` collapses every CSS transition under the same query; this is the
 * JS half of the same promise, and it makes the figure **snap** — which is what
 * docs/11 asks for by name.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A page nobody is looking at does not run `requestAnimationFrame` — the same
 * fact `pdfText.ts` records about pdf.js's own drawing — so a count started
 * while the window is hidden would sit on its first frame until the window came
 * back. It heals itself on the next frame either way, because the elapsed time
 * is by then past the duration; snapping instead means the figure is simply
 * correct the whole time, which is what a figure nobody is watching should be.
 */
function pageIsHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

/**
 * The target, counted to. Returns the target itself on the first render and
 * whenever motion is refused.
 *
 * Retargeting mid-flight starts from wherever the figure currently reads rather
 * than from the previous target, which is what makes dragging a slider look
 * like one continuous movement instead of a series of restarts.
 */
export function useAnimatedNumber(
  target: number,
  options: {
    readonly durationMs?: number
    /**
     * What the figure is *of*. When this changes the count snaps, because the
     * new target is a different quantity rather than a movement of the same
     * one, and interpolating between two of those draws frames that were never
     * true of either.
     */
    readonly snapKey?: string
  } = {},
): number {
  const { durationMs = COUNT_DURATION_MS, snapKey } = options
  const [shown, setShown] = useState(target)
  // What is on screen right now, readable synchronously — the effect below
  // starts from it, and reading it out of `shown` would mean re-running the
  // effect on every frame it just painted.
  const current = useRef(target)
  const frame = useRef<number | undefined>(undefined)
  const lastKey = useRef(snapKey)

  useEffect(() => {
    const snapped = lastKey.current !== snapKey
    lastKey.current = snapKey

    if (current.current === target) return

    if (
      snapped ||
      prefersReducedMotion() ||
      pageIsHidden() ||
      typeof requestAnimationFrame !== 'function'
    ) {
      current.current = target
      setShown(target)
      return
    }

    const from = current.current
    const startedAt = performance.now()

    const tick = (now: number): void => {
      const value = countAt(from, target, now - startedAt, durationMs)
      current.current = value
      setShown(value)
      if (value !== target) frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      // Unmounting or retargeting mid-count leaves the ref where the pixels
      // are, so the next count picks up from what the user can see.
    }
  }, [target, durationMs, snapKey])

  return shown
}

/**
 * The same, with the currency kept attached.
 *
 * A currency change is a different quantity, not a movement of the same one, so
 * it snaps: counting from ₪4,000 to $60 would draw two hundred figures that
 * were never true of either.
 */
export function useAnimatedMoney(target: Money): Money {
  return money(useAnimatedNumber(target.minor, { snapKey: target.currency }), target.currency)
}
