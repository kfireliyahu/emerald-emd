/**
 * **Whether the frame is seen** (M42 F1, D-496): a third of it in the view
 * of the page it is embedded in, and that page's tab showing. An
 * `IntersectionObserver` with no root measures against the top page's
 * viewport even from inside a frame on another origin, so the frame knows it
 * alone and an embedding site needs to do nothing. Where there is no observer
 * the frame counts as seen, and plays as it did before.
 */

/** The share of the frame in view at which it counts as seen — the page's recording plays at the same. */
export const SEEN_AT = 0.35

/**
 * Says whether `element` is seen: `false` at once, then on every change.
 * Returns the way to stop watching.
 */
export function watchSeen(element: Element, said: (seen: boolean) => void, win: Window & typeof globalThis = window): () => void {
  const Observer = win.IntersectionObserver as typeof IntersectionObserver | undefined
  if (Observer === undefined) return () => undefined
  const doc = win.document
  let inView = false
  const tell = (): void => {
    said(inView && doc.visibilityState !== 'hidden')
  }
  const observer = new Observer(
    (entries) => {
      const entry = entries.at(-1)
      if (entry === undefined) return
      inView = entry.isIntersecting && entry.intersectionRatio >= SEEN_AT
      tell()
    },
    { threshold: [0, SEEN_AT] },
  )
  said(false)
  observer.observe(element)
  doc.addEventListener('visibilitychange', tell)
  return () => {
    observer.disconnect()
    doc.removeEventListener('visibilitychange', tell)
  }
}
