import { Component, createElement, createRef, type ReactNode } from 'react'

import { inView, planFlip, type Box } from '@/ui/motion/flip.ts'
import { EASING, MOTION_MS, motionOn } from '@/ui/motion/motion.ts'
import { LAYOUT_MOTION } from '@/ui/motion/settle.ts'

/**
 * **The pieces of a layout move to their new places** — motions (1) and (2) of
 * M39, one component (U1's mockup, on everywhere since U2).
 *
 * Renders one element (`as`) and FLIPs the keyed pieces inside it whenever
 * `flipKey` changes: each piece is measured before React commits and after, and
 * played back from where it was with a transform (`flip.ts`). A piece that is
 * new grows in; one that is gone shrinks out of where it was, as a ghost — a
 * copy outside React that takes no clicks, so nothing waits for it.
 *
 * **A class component, for the one lifecycle a hook has no equal of**:
 * `getSnapshotBeforeUpdate` runs after React has worked out the change and
 * before it touches the DOM, which is the only moment the old positions — and
 * the rows about to be removed — can still be measured.
 *
 * **With motion off it is the element and nothing else** — under reduced
 * motion nothing is measured and nothing plays. Every animation it starts
 * carries `LAYOUT_MOTION`, so the demo's tour can wait for it to stop
 * (`settle.ts`).
 */

type Props = {
  /** The element rendered: `tbody` for a sheet's rows, `table` for its columns. */
  readonly as: string
  /** Changes when the pieces may have moved: their keys, their order. */
  readonly flipKey: string
  /**
   * Changes when the list was replaced rather than changed — a new sort — and
   * that update snaps.
   */
  readonly resetKey?: string
  /** The attribute a piece carries its key in. */
  readonly attr?: string
  /**
   * A piece inside a group (a cell inside a row) is measured only when its
   * group is in view — a five-hundred-row sheet's cells read only for the
   * thirty rows you can see.
   */
  readonly groups?: string
  /** More pieces entering or leaving than this at once is a list replaced: nothing moves. */
  readonly crowd?: number
  /** Whether a removed piece leaves a ghost that shrinks out. */
  readonly ghosts?: boolean
  readonly children?: ReactNode
  readonly [prop: string]: unknown
}

interface Snapshot {
  readonly view: Box
  readonly existed: ReadonlySet<string>
  readonly boxes: ReadonlyMap<string, Box>
  readonly elements: ReadonlyMap<string, Element>
}

/** One viewport height of rows either side of what you can see. */
const MARGIN = 160

export class Flip extends Component<Props> {
  private readonly ref = createRef<HTMLElement>()
  private running: Animation[] = []

  override getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    if (previous.flipKey === this.props.flipKey) return null
    if (previous.resetKey !== this.props.resetKey) return null
    const root = this.ref.current
    if (root === null || !motionOn()) return null
    const view = viewOf(root)
    const attr = this.props.attr ?? 'data-motion-key'
    const existed = new Set<string>()
    const boxes = new Map<string, Box>()
    const elements = new Map<string, Element>()
    const shown = groupGate(this.props.groups, view)
    for (const element of root.querySelectorAll(`[${attr}]`)) {
      const key = element.getAttribute(attr)
      if (key === null) continue
      existed.add(key)
      if (!shown(element)) continue
      const box = boxOf(element)
      if (!inView(box, view, MARGIN)) continue
      boxes.set(key, box)
      elements.set(key, element)
    }
    return { view, existed, boxes, elements }
  }

  override componentDidUpdate(_previous: Props, _state: unknown, snapshot: Snapshot | null): void {
    const root = this.ref.current
    if (snapshot === null || root === null) return
    // Anything still playing is let go first, so the new places are measured
    // without a transform on them — and a piece interrupted mid-move starts
    // from where it was seen, which is what `before` measured.
    for (const animation of this.running) animation.cancel()
    this.running = []

    const attr = this.props.attr ?? 'data-motion-key'
    const view = viewOf(root)
    const shown = groupGate(this.props.groups, view)
    const after = new Map<string, Box>()
    const now = new Map<string, Element>()
    const parents = new Map<string, string>()
    for (const element of root.querySelectorAll(`[${attr}]`)) {
      const key = element.getAttribute(attr)
      if (key === null) continue
      const known = snapshot.boxes.has(key)
      if (!known && !shown(element)) continue
      const box = boxOf(element)
      if (!known && !inView(box, view, MARGIN)) continue
      after.set(key, box)
      now.set(key, element)
      const parent = element.parentElement?.closest(`[${attr}]`)
      const parentKey = parent !== null && parent !== undefined && root.contains(parent) ? parent.getAttribute(attr) : null
      if (parentKey !== null) parents.set(key, parentKey)
    }

    const plan = planFlip({
      before: snapshot.boxes,
      after,
      existed: snapshot.existed,
      crowd: this.props.crowd ?? 3,
      parents,
    })
    const timing: KeyframeAnimationOptions = { duration: MOTION_MS, easing: EASING, id: LAYOUT_MOTION }
    for (const { key, dx, dy } of plan.moves) {
      const element = now.get(key)
      if (element === undefined) continue
      this.running.push(
        element.animate([{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }], timing),
      )
    }
    for (const key of plan.enters) {
      const element = now.get(key)
      if (element === undefined) continue
      this.running.push(element.animate(GROW, timing))
    }
    if (this.props.ghosts !== false) {
      for (const key of plan.exits) {
        const element = snapshot.elements.get(key)
        const box = snapshot.boxes.get(key)
        if (element === undefined || box === undefined) continue
        ghost(element, box, view, root)
      }
    }
  }

  override render() {
    const { as, flipKey: _flip, resetKey: _reset, attr: _attr, groups: _groups, crowd: _crowd, ghosts: _ghosts, children, ...rest } =
      this.props
    return createElement(as, { ...rest, ref: this.ref }, children)
  }
}

/** Grows in: fades up while its clip opens downwards. */
const GROW: Keyframe[] = [
  { opacity: 0, clipPath: 'inset(0 0 100% 0)' },
  { opacity: 1, clipPath: 'inset(0 0 0 0)' },
]
/** Shrinks out: the reverse, from where it was. */
const SHRINK: Keyframe[] = [
  { opacity: 1, clipPath: 'inset(0 0 0 0)' },
  { opacity: 0, clipPath: 'inset(0 0 100% 0)' },
]

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** The part of the page the pieces are seen through: the nearest scroller, inside the window. */
function viewOf(root: Element): Box {
  let scroller: Element | null = root.parentElement
  while (scroller !== null) {
    const style = getComputedStyle(scroller)
    if (/(auto|scroll)/.test(style.overflowY + style.overflowX)) break
    scroller = scroller.parentElement
  }
  const outer = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
  if (scroller === null) return outer
  const box = boxOf(scroller)
  const left = Math.max(box.left, 0)
  const top = Math.max(box.top, 0)
  return {
    left,
    top,
    width: Math.max(0, Math.min(box.left + box.width, outer.width) - left),
    height: Math.max(0, Math.min(box.top + box.height, outer.height) - top),
  }
}

/** Whether a piece's group is in view, each group measured once. */
function groupGate(groups: string | undefined, view: Box): (element: Element) => boolean {
  if (groups === undefined) return () => true
  const seen = new Map<Element, boolean>()
  return (element) => {
    const group = element.closest(groups)
    if (group === null) return true
    const known = seen.get(group)
    if (known !== undefined) return known
    const shown = inView(boxOf(group), view, MARGIN)
    seen.set(group, shown)
    return shown
  }
}

/**
 * A copy of a removed piece, where it was, shrinking out — in a fixed layer
 * clipped to the scroller, outside React and taking no clicks.
 *
 * **A row is copied into a table of its own**, with the sheet's column widths:
 * a `tr` on its own is not a row of anything and lays its cells out as it likes.
 */
function ghost(element: Element, box: Box, view: Box, root: Element): void {
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.setAttribute('inert', '')
  layer.dataset.motionGhost = ''
  Object.assign(layer.style, {
    position: 'fixed',
    left: `${String(view.left)}px`,
    top: `${String(view.top)}px`,
    width: `${String(view.width)}px`,
    height: `${String(view.height)}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '5',
  })
  const copy = element.cloneNode(true) as HTMLElement
  // A copy is nobody's anchor: what names a row or a control for the demo's
  // tour, or for a label, stays on the real one.
  for (const named of [copy, ...Array.from(copy.querySelectorAll('[id], [data-tour], [data-row]'))]) {
    named.removeAttribute('id')
    named.removeAttribute('data-tour')
    named.removeAttribute('data-row')
  }
  let piece: HTMLElement = copy
  if (element.tagName === 'TR') {
    const table = root.closest('table')
    const sheet = document.createElement('table')
    sheet.className = table?.className ?? ''
    sheet.style.tableLayout = 'fixed'
    sheet.style.width = table?.style.width ?? `${String(box.width)}px`
    const columns = table?.querySelector(':scope > colgroup')
    if (columns !== null && columns !== undefined) sheet.appendChild(columns.cloneNode(true))
    const body = document.createElement('tbody')
    body.appendChild(copy)
    sheet.appendChild(body)
    piece = sheet
  }
  Object.assign(piece.style, {
    position: 'absolute',
    left: `${String(box.left - view.left)}px`,
    top: `${String(box.top - view.top)}px`,
    width: piece === copy ? `${String(box.width)}px` : piece.style.width,
    height: `${String(box.height)}px`,
    margin: '0',
    background: 'var(--color-background)',
  })
  layer.appendChild(piece)
  document.body.appendChild(layer)
  const animation = piece.animate(SHRINK, { duration: MOTION_MS, easing: EASING, fill: 'forwards', id: LAYOUT_MOTION })
  const done = (): void => layer.remove()
  animation.addEventListener('finish', done)
  animation.addEventListener('cancel', done)
}
