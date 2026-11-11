/**
 * **Which way the page reads, for what CSS cannot mirror** — M60 U3 (D-586).
 *
 * The layout mirrors by itself: every class is logical (`ms-`, `ps-`, `start-`,
 * `text-end`), so `<html dir="rtl">` puts the rail on the right and a pager's
 * Previous where Hebrew reads first. What does not mirror by itself is a key:
 * ← and → name sides of the keyboard, not the reading order, so a pager, a
 * board's lanes or a radio group step the way their buttons are drawn.
 */

/** True while the page is drawn right to left. Asked at the moment, never cached. */
export function pageIsRtl(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
}

/**
 * ← or → as a step along the reading order: +1 toward what comes after (the
 * next month, the next lane), -1 toward what came before, 0 for any other key.
 * In Hebrew the next thing is drawn on the left, so ← is +1.
 */
export function arrowStep(key: string): -1 | 0 | 1 {
  const physical = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  if (physical === 0) return 0
  return pageIsRtl() ? (physical === 1 ? -1 : 1) : physical
}
