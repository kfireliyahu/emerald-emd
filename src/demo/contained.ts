import { bringIntoView } from './tour/runner.ts'

/**
 * **The app inside a frame never moves the page around it** (M33 U3, found on
 * the host page). A browser answers `focus()` and
 * `scrollIntoView()` by scrolling every ancestor until the element shows — the
 * embedding page included — so a tour playing in one frame dragged the page to
 * it while the visitor was watching another, and on a host site it would pull the
 * page to the demo while the visitor reads the paragraph above it.
 *
 * The app's own code focuses and scrolls in a dozen places (`autoFocus`, a
 * list's active row), and they are right in the app. Here, and only when the
 * page is embedded, both are bounded to the app's own document: focus never
 * scrolls, and then whatever holds the element inside the app is scrolled by
 * hand, as the runner already does for itself.
 */
export function containScrolling(win: Window & typeof globalThis): void {
  if (win.parent === win) return
  const focus = win.HTMLElement.prototype.focus
  win.HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions): void {
    focus.call(this, { ...options, preventScroll: true })
    if (options?.preventScroll !== true) bringIntoView(this)
  }
  win.Element.prototype.scrollIntoView = function (this: Element): void {
    if (this instanceof win.HTMLElement) bringIntoView(this)
  }
}
