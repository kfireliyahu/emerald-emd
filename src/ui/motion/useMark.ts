import { useLayoutEffect, useRef } from 'react'

import { EASING, MARK_MS, motionOn } from '@/ui/motion/motion.ts'

/** The tone a verdict reports in — `accent` is never one (D-125): a verdict is found, not acted on. */
export type MarkTone = 'negative' | 'positive' | 'neutral'

/**
 * **A claim whose verdict changed is marked once** — M39's motion (3), the
 * mockup (U1), on everywhere since U2.
 *
 * `times` is `useChanges`' count for the claim — keyed by what the row or the
 * claim is called, so a text document's renewed ids (D-247) never replay it,
 * and a reload that changed nothing marks nothing. Each new count plays the
 * mark once: a tint of the verdict's own tone behind it, there at once and gone
 * in `MARK_MS`. **Never on the first render**, never looping, and the word and
 * its colour are already the verdict before the tint has started to fade — the
 * mark says *this changed*, and nothing about what it changed to.
 */
export function useMark<T extends HTMLElement>(times: number | undefined, tone: MarkTone) {
  const ref = useRef<T>(null)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const element = ref.current
    if (times === undefined || element === null || !motionOn()) return
    mark(element, tone)
  }, [times, tone])
  return ref
}

/** The tint: the verdict's tone, stronger for a failure, on nothing else. */
export function markTint(tone: MarkTone): string {
  if (tone === 'negative') return 'color-mix(in srgb, var(--color-negative) 24%, transparent)'
  if (tone === 'positive') return 'color-mix(in srgb, var(--color-positive) 16%, transparent)'
  return 'color-mix(in srgb, var(--color-ink) 10%, transparent)'
}

function mark(element: HTMLElement, tone: MarkTone): void {
  element.animate(
    [
      { backgroundColor: markTint(tone), boxShadow: `0 0 0 3px ${markTint(tone)}` },
      { backgroundColor: 'transparent', boxShadow: '0 0 0 3px transparent' },
    ],
    { duration: MARK_MS, easing: EASING, iterations: 1 },
  )
}
