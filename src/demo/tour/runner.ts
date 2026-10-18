import { choiceOf, rowOf, selectorOf, type TourStep } from './steps.ts'
import { LAYOUT_MOTION } from '@/ui/motion/settle.ts'

/**
 * **The runner's hands** (M33 U2): find an anchor on the real app, bring it
 * into view, and do to it what a person would — a click is the pointer and
 * mouse events a click is made of, a key is a keydown, and typing goes through
 * the input's own value setter so React sees every character.
 *
 * **It never waits on the clock for the app.** Whether the next anchor exists
 * is answered by watching the document change, a render by the frames the app
 * paints, and a layout still moving (M39 U2: a row growing in, a panel making
 * its room) by its animations finishing (`layoutSettled`); the clock paces only
 * the eye, in `player.ts`, and fast-forward has none of it. A missing anchor fails by name after `LOST_AFTER` rather than
 * hanging — the same failure U3's check reports.
 *
 * Everything here acts on the app's own document, which is inside the frame's
 * iframe, so every event and every prototype is that window's, not this one's.
 */

/** How long an anchor may take to appear before the tour says it lost its place. */
export const LOST_AFTER = 10_000

export class TourCancelled extends Error {
  constructor() {
    super('The tour was stopped.')
  }
}

/** What a step looks for: where the ring points, or the box it outlines. */
export type AnchorRole = 'anchor' | 'highlight'

export class TourLost extends Error {
  constructor(
    readonly step: number,
    readonly anchor: string,
    readonly role: AnchorRole = 'anchor',
  ) {
    super(
      `Step ${String(step + 1)}: nothing on the screen is "${anchor}"` +
        `${role === 'highlight' ? ' to outline' : ''}.`,
    )
  }
}

/** The element an anchor names, if it is on the screen now and can be acted on. */
export function findAnchor(doc: Document, anchor: string): HTMLElement | undefined {
  const choice = choiceOf(anchor)
  const row = rowOf(anchor)
  const candidates =
    row !== undefined
      ? // A sheet's stored row: a body row holding the text in one of its cells.
        Array.from(doc.querySelectorAll<HTMLTableRowElement>('tbody tr')).filter((each) =>
          Array.from(each.cells).some((cell) => (cell.textContent ?? '').trim() === row),
        )
      : choice === undefined
        ? Array.from(doc.querySelectorAll<HTMLElement>(selectorOf(anchor)))
        : Array.from(doc.querySelectorAll<HTMLElement>('[role="option"], [role="menuitemradio"]')).filter(
            // The option's whole text, or its first line when it carries a detail
            // after it (`sum` over *adds them up*), or — a menu's item, after
            // its tick — its last (M33 U6).
            (each) =>
              (each.textContent ?? '').trim() === choice ||
              (each.firstChild?.textContent ?? '').trim() === choice ||
              (each.lastChild?.textContent ?? '').trim() === choice,
          )
  // An option that holds a button is chosen by its button: a list that listens
  // on the button, as the category picker does, never hears the option (M33 U5).
  return candidates.map((each) => (choice === undefined ? each : (each.querySelector<HTMLElement>('button') ?? each))).find(usable)
}

/**
 * **A box of the app that scrolls sideways** at the width the frame laid it out
 * at (M33 F1): what is past its edge is off the screen, and a click there
 * scrolls what the tour just typed out of view — the overlaps found at U3,
 * where the receipt's sheet was wider than the screen it sat in. Answered as
 * how much of how much shows, or `undefined`. A box drawn no taller than
 * nothing is not on the screen and is left out.
 */
export function sideways(doc: Document): string | undefined {
  const view = doc.defaultView
  if (view === null) return undefined
  for (const element of Array.from(doc.body.querySelectorAll<HTMLElement>('*'))) {
    if (element.scrollWidth <= element.clientWidth + 1 || element.clientHeight === 0) continue
    const overflow = view.getComputedStyle(element).overflowX
    if (overflow === 'auto' || overflow === 'scroll') {
      return `${String(element.clientWidth)} px of ${String(element.scrollWidth)} show in a ${String(view.innerWidth)} px app`
    }
  }
  return undefined
}

/** On the screen: in the page, laid out, and not a closing copy on its way out. */
export function onScreen(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false
  // A panel closing keeps what it showed, inert, while it goes, and a removed
  // row leaves an inert copy shrinking out (M39 U2): neither is on the screen
  // to be acted on.
  return element.closest('[inert]') === null
}

function usable(element: HTMLElement): boolean {
  if (!onScreen(element)) return false
  if ((element as HTMLButtonElement).disabled === true) return false
  return element.getAttribute('aria-disabled') !== 'true'
}

/**
 * The anchor, once it exists: answered at once when it is already there, and
 * otherwise each time the app's document changes.
 */
export function waitForAnchor(
  doc: Document,
  anchor: string,
  step: number,
  cancelled: () => boolean,
  role: AnchorRole = 'anchor',
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const win = doc.defaultView
    let done = false
    const finish = (outcome: () => void): void => {
      if (done) return
      done = true
      observer.disconnect()
      win?.clearTimeout(timer)
      outcome()
    }
    // A mutation says the tree changed; a frame catches what only layout
    // changes, such as a button whose `disabled` went while its node stayed.
    const look = (): void => {
      if (cancelled()) return finish(() => reject(new TourCancelled()))
      const found = findAnchor(doc, anchor)
      if (found !== undefined) return finish(() => resolve(found))
    }
    const observer = new (win ?? window).MutationObserver(look)
    observer.observe(doc, { subtree: true, childList: true, attributes: true })
    const tick = (): void => {
      look()
      if (!done && win !== null) void nextFrame(win).then(tick)
    }
    const timer = (win ?? window).setTimeout(() => finish(() => reject(new TourLost(step, anchor, role))), LOST_AFTER)
    tick()
  })
}

/**
 * The app's next frame. A page nobody can see paints none, so there it is the
 * next turn of the timer instead — which a hidden tab slows down, and that is
 * the tour pausing with the tab rather than racing it. **A page that says it
 * is visible can paint nothing too** — a window not shown, an iframe scrolled
 * out of its host's view — so a frame that has not come in `FRAME_AT_MOST` is
 * taken as come (M33 U3: in a pane that said visible and painted nothing, the
 * tour sat on one step for good).
 */
export function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => {
    const hidden = win.document.visibilityState === 'hidden'
    const timer = win.setTimeout(resolve, hidden ? 16 : FRAME_AT_MOST)
    if (!hidden)
      win.requestAnimationFrame(() => {
        win.clearTimeout(timer)
        resolve()
      })
  })
}

/** The longest a visible page's frame is waited for, in ms. */
export const FRAME_AT_MOST = 100

/** The longest the screen an address names is waited for, in ms: past it the step goes on and its anchor says what is wrong. */
export const ROUTE_AT_MOST = 3000

/** A path as the router keeps it and as the address bar spells it, compared alike. */
function samePath(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

/**
 * **The screen the address names, drawn** (M43 U10). React Router 7 renders a
 * navigation as a transition: for a frame or more after a click the screen
 * that is leaving is still the one in the tree, and an anchor or an outline
 * looked up then is found on it — the timesheet tour's first outline went to
 * Home's September row, which was gone a frame later. The app's routed view
 * says the path it drew (`data-route`, `App.tsx`); this waits until that is the
 * address. A page with no routed view on show answers at once.
 */
export async function routeDrawn(doc: Document, cancelled: () => boolean): Promise<void> {
  const win = doc.defaultView
  if (win === null) return
  const started = Date.now()
  for (;;) {
    if (cancelled()) throw new TourCancelled()
    const view = doc.querySelector<HTMLElement>('[data-route]')
    if (view === null) return
    const address = win.location.hash.replace(/^#/, '').split('?')[0] || '/'
    if (samePath(view.dataset.route ?? '') === samePath(address)) return
    if (Date.now() - started > ROUTE_AT_MOST) return
    await nextFrame(win)
  }
}

/** Two frames of the app: what a click's re-render has had time to show. */
export async function painted(doc: Document): Promise<void> {
  const win = doc.defaultView
  if (win === null) return
  await nextFrame(win)
  await nextFrame(win)
}

/**
 * Scrolls whatever holds the element until it is in view — by hand, nearest
 * edge, no smoothing, and never past the app's own document: `scrollIntoView`
 * would also scroll the page the frame is embedded in. Says whether it moved
 * anything: **a scroll's event arrives a frame later**, and an app that closes
 * an open list on scroll closes the one the next action opens unless the
 * runner lets that frame pass first (M33 U3, found by the check at phone size,
 * where the sheet scrolls sideways to its last column).
 */
export function bringIntoView(element: HTMLElement): boolean {
  const doc = element.ownerDocument
  const win = doc.defaultView
  if (win === null) return false
  let moved = false
  const margin = 24
  for (let box = element.parentElement; box !== null && box !== doc.body; box = box.parentElement) {
    const style = win.getComputedStyle(box)
    const scrollsY = /(auto|scroll)/.test(style.overflowY) && box.scrollHeight > box.clientHeight
    const scrollsX = /(auto|scroll)/.test(style.overflowX) && box.scrollWidth > box.clientWidth
    if (!scrollsY && !scrollsX) continue
    const outer = box.getBoundingClientRect()
    const inner = element.getBoundingClientRect()
    const was = [box.scrollTop, box.scrollLeft]
    if (scrollsY) {
      if (inner.top < outer.top + margin) box.scrollTop -= outer.top + margin - inner.top
      else if (inner.bottom > outer.bottom - margin)
        box.scrollTop += Math.min(inner.bottom - outer.bottom + margin, inner.top - outer.top - margin)
    }
    if (scrollsX) {
      if (inner.left < outer.left + margin) box.scrollLeft -= outer.left + margin - inner.left
      else if (inner.right > outer.right - margin)
        box.scrollLeft += Math.min(inner.right - outer.right + margin, inner.left - outer.left - margin)
    }
    if (box.scrollTop !== was[0] || box.scrollLeft !== was[1]) moved = true
  }
  return moved
}

/** A click as a pointer makes one: down, focus unless the app kept it, up, click. */
export function click(element: HTMLElement): void {
  const win = element.ownerDocument.defaultView
  if (win === null) return
  const rect = element.getBoundingClientRect()
  const at = { bubbles: true, cancelable: true, composed: true, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
  element.dispatchEvent(new win.PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }))
  const kept = !element.dispatchEvent(new win.MouseEvent('mousedown', { ...at, buttons: 1 }))
  if (!kept && element.tabIndex >= 0) element.focus({ preventScroll: true })
  element.dispatchEvent(new win.PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }))
  element.dispatchEvent(new win.MouseEvent('mouseup', at))
  element.dispatchEvent(new win.MouseEvent('click', { ...at, detail: 1 }))
}

/** A key, pressed on the element: what the app's own key handlers read. */
export function press(element: HTMLElement, key: string): void {
  const win = element.ownerDocument.defaultView
  if (win === null) return
  element.focus({ preventScroll: true })
  const at = { key, code: key, bubbles: true, cancelable: true, composed: true }
  element.dispatchEvent(new win.KeyboardEvent('keydown', at))
  element.dispatchEvent(new win.KeyboardEvent('keyup', at))
}

/**
 * Sets a field's text the way typing does: through the element's own value
 * setter, so React's tracker sees a change, then an `input` event.
 */
export function setText(element: HTMLElement, text: string): void {
  const win = element.ownerDocument.defaultView
  if (win === null) return
  const proto = element instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter === undefined) return
  setter.call(element, text)
  element.dispatchEvent(new win.Event('input', { bubbles: true }))
}

/** What a field holds before a `type` step adds to it. */
export function startingText(element: HTMLElement, step: TourStep): string {
  if (step.replace === true) return ''
  return 'value' in element && typeof element.value === 'string' ? element.value : ''
}

/**
 * **Typing moves nothing** (M39 F1): types `value` after `before` a character
 * at a time, a frame apart, and names the first layout motion — a row, a
 * column or a panel growing or sliding (`LAYOUT_MOTION`) — that a keystroke
 * after the first one started, or `undefined`. A first character may make
 * something appear (a foot row, a header); after it, text changing is neither
 * an arrival nor a move, and a header that re-grew on every key is what
 * showed in the custom tour. Something leaving may still fade (its copy is
 * inert), and a list of choices may pop as a word starts — those are not layout.
 * `check:tours` types every field this way, so the rule holds wherever a tour types.
 */
export async function typedStill(element: HTMLElement, before: string, value: string): Promise<string | undefined> {
  const doc = element.ownerDocument
  if (typeof doc.getAnimations !== 'function') {
    setText(element, before + value)
    return undefined
  }
  let seen: Set<Animation> | undefined
  for (let typed = 1; typed <= value.length; typed += 1) {
    setText(element, before + value.slice(0, typed))
    await painted(doc)
    const now = doc.getAnimations().filter((each) => each.id === LAYOUT_MOTION && !leaving(each))
    const started = seen === undefined ? undefined : now.find((each) => !seen?.has(each))
    if (started !== undefined) return `typing "${value.slice(0, typed)}" moved ${targetName(started)}`
    seen = new Set(now)
  }
  return undefined
}

/** The app's own realm: `instanceof` against the frame's `KeyframeEffect` would never hold. */
function targetOf(animation: Animation): Element | null {
  return (animation.effect as { target?: Element | null } | null)?.target ?? null
}

/** A copy fading out of where something was (`closing.ts`, `Flip.tsx`' ghosts): inert, and a leave. */
function leaving(animation: Animation): boolean {
  return (targetOf(animation)?.closest('[inert]') ?? null) !== null
}

function targetName(animation: Animation): string {
  const target = targetOf(animation)
  if (target === null) return 'something'
  const key = target.getAttribute('data-motion-col') ?? target.getAttribute('data-motion-key')
  return `a ${target.tagName.toLowerCase()}${key === null ? '' : ` (${key})`}`
}
/** A tour's `write` the engine refused (M33 F5): the step fails, and `check:tours` with it. */
export class TourRefused extends Error {
  constructor(
    readonly step: number,
    reason: string,
  ) {
    super(`Step ${String(step + 1)}: the write was refused. ${reason}`)
  }
}

/** An outline held over a box the screen no longer shows (M33 F6): the step fails, and `check:tours` with it. */
export class OutlineOutlived extends Error {
  constructor(readonly step: number) {
    super(`Step ${String(step + 1)}: the outline is still held over a box that has left the screen.`)
  }
}

/** A tour whose typing set something moving (`typedStill`). */
export class TypingMoved extends Error {
  constructor(
    readonly step: number,
    what: string,
  ) {
    super(`Step ${String(step + 1)}: ${what}, and a keystroke should move nothing.`)
  }
}
