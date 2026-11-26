/**
 * **Where the reader is on the page** (M33 U8, D-459; M64 F71, D-643): the
 * index of words marks the section under the eye, as the app's rail marks the
 * place you are on. The choice is pure so it is tested without a window.
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
