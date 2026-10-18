import { EASING, FADE_MS, motionOn } from '@/ui/motion/motion.ts'
import { LAYOUT_MOTION } from '@/ui/motion/settle.ts'

/**
 * **Closing a window, panel or dialog is a short fade** — M39's motion (4),
 * app-wide, in one place (U3).
 *
 * What pops in fades out: an element that opened with `fc-pop-enter` — every
 * popover, menu, dialog, drawer and panel the app has — or that says
 * `data-motion-close`, when React takes it away, leaves a copy where it was
 * that fades in `FADE_MS` and is gone. Nobody wires it per screen, so a panel
 * written next year closes like the rest.
 *
 * - **Over the page** (`fixed` or `absolute`): the copy fades and nothing else.
 * - **In the flow** (a panel under a list, a pane beside one): the copy fades
 *   *out of its room* while the room closes — its height, or its width in a
 *   row — so what was below or beside it slides back rather than jumping. That
 *   one moves layout, so it carries `LAYOUT_MOTION` and the demo's tour waits
 *   for it (`settle.ts`).
 *
 * **Nothing waits on it.** The copy is outside React, `inert` and takes no
 * pointer, and the real element is already gone: the screen behind is usable
 * the moment it was told to close, and the tour's `findAnchor` skips anything
 * inert. The copy names nothing — no `id`, no tour anchor, no `aria-modal` —
 * so a lookup for the open dialog, a label's `for` or a tour step finds the
 * real thing or nothing.
 *
 * Not a close: an element **replaced** in the same commit by another that pops
 * in under the same parent (a form for a different rule), anything a `Reveal`
 * already let go of as it closed its room, and anything removed with its whole
 * screen — only the element that itself went is copied, never what went
 * inside it, so navigating is never a cloud of fading popovers.
 */

/** What says it closes with the fade. */
function closes(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && (node.classList.contains('fc-pop-enter') || node.hasAttribute('data-motion-close'))
}

/** The copy keeps how it looked and nothing that names it. */
function copyOf(element: HTMLElement): HTMLElement {
  const copy = element.cloneNode(true) as HTMLElement
  // What was typed is a property, not an attribute, and a clone keeps only attributes.
  const typed = element.querySelectorAll('input, textarea, select')
  const copied = copy.querySelectorAll('input, textarea, select')
  typed.forEach((field, index) => {
    const twin = copied[index]
    if (twin !== undefined && 'value' in twin && 'value' in field) (twin as HTMLInputElement).value = (field as HTMLInputElement).value
  })
  for (const named of [copy, ...Array.from(copy.querySelectorAll('[id], [data-tour], [data-row], [data-motion-key], [aria-modal]'))]) {
    for (const name of ['id', 'data-tour', 'data-row', 'data-motion-key', 'aria-modal']) named.removeAttribute(name)
  }
  copy.classList.remove('fc-pop-enter')
  copy.removeAttribute('data-motion-close')
  copy.setAttribute('inert', '')
  copy.setAttribute('aria-hidden', 'true')
  copy.style.pointerEvents = 'none'
  return copy
}

/** Which way the room an element stood in closes: across a row, or down a column. */
function axisOf(parent: Element): 'width' | 'height' {
  const style = getComputedStyle(parent)
  const flex = style.display === 'flex' || style.display === 'inline-flex'
  return flex && style.flexDirection.startsWith('row') ? 'width' : 'height'
}

function fadeOut(element: HTMLElement, parent: Element, before: Node | null): void {
  const copy = copyOf(element)
  parent.insertBefore(copy, before !== null && before.parentNode === parent ? before : null)
  const position = getComputedStyle(copy).position
  if (position === 'fixed' || position === 'absolute' || getComputedStyle(copy).display === 'contents') {
    const fading = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASING, fill: 'forwards' })
    const done = (): void => copy.remove()
    fading.addEventListener('finish', done)
    fading.addEventListener('cancel', done)
    return
  }
  // In the flow: a room around the copy, the size it was, that closes. The
  // copy keeps its own size inside it, so its text does not reflow as it goes.
  const axis = axisOf(parent)
  const box = copy.getBoundingClientRect()
  const size = axis === 'width' ? box.width : box.height
  if (size < 1) {
    copy.remove()
    return
  }
  const room = document.createElement('div')
  room.setAttribute('inert', '')
  room.setAttribute('aria-hidden', 'true')
  Object.assign(room.style, {
    overflow: 'hidden',
    flex: 'none',
    pointerEvents: 'none',
    [axis]: `${String(size)}px`,
    ...(axis === 'width' ? { display: 'flex', alignSelf: 'stretch' } : {}),
  })
  copy.style[axis] = `${String(size)}px`
  copy.style.flex = 'none'
  copy.style.margin = '0'
  parent.insertBefore(room, copy)
  room.appendChild(copy)
  const closing = room.animate(
    [
      { [axis]: `${String(size)}px`, opacity: 1 },
      { [axis]: '0px', opacity: 0 },
    ],
    { duration: FADE_MS, easing: EASING, fill: 'forwards', id: LAYOUT_MOTION },
  )
  const done = (): void => room.remove()
  closing.addEventListener('finish', done)
  closing.addEventListener('cancel', done)
}

/** One commit's removals: the ones that are closes, with where they stood. */
function onMutations(records: readonly MutationRecord[]): void {
  if (!motionOn()) return
  for (const record of records) {
    if (record.removedNodes.length === 0) continue
    const parent = record.target
    if (!(parent instanceof Element) || !parent.isConnected) continue
    // A Reveal let it go when its own close had played; under an inert parent
    // it is a copy already, or inside something closing.
    if (parent.hasAttribute('data-motion-reveal') || parent.closest('[inert]') !== null) continue
    for (const node of Array.from(record.removedNodes)) {
      if (!closes(node)) continue
      // Replaced, not closed: something that pops in arrived under the same parent in this commit.
      const replaced = records.some(
        (other) => other.target === parent && Array.from(other.addedNodes).some((added) => closes(added) && added.isConnected),
      )
      if (replaced) continue
      fadeOut(node, parent, record.nextSibling)
    }
  }
}

/**
 * Watches `root` for closes, from now until the returned function is called.
 * Once, for the app (`App.tsx`); the observer costs a loop over each commit's
 * removed nodes, and nothing at all under reduced motion.
 */
export function watchClosing(root: Element): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined
  const observer = new MutationObserver(onMutations)
  observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
}
