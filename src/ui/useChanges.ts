import { useRef } from 'react'

/** A key that changed: how many times it has, and what it said before the last. */
export interface Change {
  readonly times: number
  readonly was: string
}

/**
 * Which keyed things changed since the last render — M27 U8, D-306: the motion
 * that explains a change, and nothing else.
 *
 * D-167's rule, for the same reason: **nothing changes on the first
 * render**, so opening a roadmap animates nothing, and a key seen for the first
 * time is not a change either. Only a key whose signature differs from the one
 * it had last render counts — the unit a session just moved, and not the forty
 * beside it that a reload from disk re-read unchanged.
 *
 * **Keys are what a row is called, never its id**: a text document renews ids
 * on every write (D-247), so an id-keyed answer would call every row new after
 * every save.
 *
 * `times` is what a caller alternates two keyframe names on (`-a`/`-b`), so a
 * second change to the same row replays the animation instead of finding it
 * already finished. The answer is kept between renders, so a class driven by it
 * stays on and an animation is never cut off by an unrelated re-render.
 */
export function useChanges(entries: readonly (readonly [string, string])[]): ReadonlyMap<string, Change> {
  const seen = useRef<ReadonlyMap<string, string> | undefined>(undefined)
  const changes = useRef<ReadonlyMap<string, Change>>(EMPTY)
  changes.current = changesSince(seen.current, entries, changes.current)
  seen.current = new Map(entries)
  return changes.current
}

/** The decision, with no hook around it so it can be tested without a DOM. */
export function changesSince(
  previous: ReadonlyMap<string, string> | undefined,
  entries: readonly (readonly [string, string])[],
  before: ReadonlyMap<string, Change>,
): ReadonlyMap<string, Change> {
  if (previous === undefined) return before
  let next: Map<string, Change> | undefined
  for (const [key, signature] of entries) {
    const was = previous.get(key)
    if (was === undefined || was === signature) continue
    next ??= new Map(before)
    next.set(key, { times: (before.get(key)?.times ?? 0) + 1, was })
  }
  return next ?? before
}

/** `fc-x-a` or `fc-x-b` for a change, alternating so a second one replays. */
export function changeClass(base: string, change: Change | undefined): string {
  if (change === undefined) return ''
  return `${base}-${change.times % 2 === 1 ? 'a' : 'b'}`
}

const EMPTY: ReadonlyMap<string, Change> = new Map()
