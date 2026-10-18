import type { Tone } from '@/ui/formats/tone.ts'

/**
 * **The page as a roadmap** (M33 U8, D-459): Emerald's page is laid out as the
 * app — the timeline down the left in the sidebar's plane, every section a
 * row of it. Where the reader is decides the tones, exactly as `liveIndex`
 * decides them for a pack's roadmap: what was read is `done`, the row under
 * the eye is `live`, what is ahead is `waiting`. The two functions here are
 * pure so the choice is tested without a window.
 */

/**
 * Which row the reader is at: the last whose top has passed `mark` (two
 * fifths of the window, so a row counts once its heading is well in view),
 * the first when none has, and the last once the page is scrolled to its end
 * — otherwise a short final row could never be reached.
 */
export function rowAt(tops: readonly number[], mark: number, atEnd: boolean): number {
  if (tops.length === 0) return -1
  if (atEnd) return tops.length - 1
  let at = 0
  tops.forEach((top, index) => {
    if (top <= mark) at = index
  })
  return at
}

/** The tone of each of `count` rows when the reader is at `at`. */
export function tones(count: number, at: number): Tone[] {
  return Array.from({ length: count }, (_, index) => (index < at ? 'done' : index === at ? 'live' : 'waiting'))
}
