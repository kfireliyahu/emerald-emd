/**
 * What a FLIP does, decided with no DOM so it can be tested (M39 U1).
 *
 * *First, Last, Invert, Play*: measure every keyed piece before a change and
 * after it, put each one back where it was with a transform, and let the
 * transform go. The pieces themselves are laid out once, by the browser, in
 * their new places — nothing animates `top` or `height`, so a sheet of five
 * hundred rows lays out once per change and not once per frame.
 */

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface FlipPlan {
  /** Present before and after, somewhere else: played back from where it was. */
  readonly moves: readonly { readonly key: string; readonly dx: number; readonly dy: number }[]
  /** New since the last measure: grows into place. */
  readonly enters: readonly string[]
  /** Gone since the last measure: shrinks out of where it was. */
  readonly exits: readonly string[]
}

const NOTHING: FlipPlan = { moves: [], enters: [], exits: [] }

/**
 * Less than half a pixel is a rounding difference, not a move — and a move that
 * small would cost an animation per row on every change for nothing visible.
 */
const STILL = 0.5

/**
 * The plan for one change.
 *
 * `before` is what was measured before the change — the pieces in view — and
 * `after` is every one of those still there, wherever it went, plus whatever is
 * in view now. `existed` is every key there was before, measured or not: a row
 * scrolled up into view by a removal above it is not new, and a row pushed out
 * of view by an insertion is not gone.
 *
 * **A crowd is a list being replaced, not a row being made** (D-167's
 * rule, which `useChanges` keeps too): more than `crowd` pieces entering or leaving at once — a search
 * narrowing a sheet, a document reloaded under it — and nothing animates at
 * all, moves included, because the moves would be a whole table rearranging
 * itself and that is the decorative case docs/11 rules out.
 *
 * `parents` names, for a piece nested inside another keyed piece, the one it
 * is inside: a cell's move is measured on the page, and the row it sits in is
 * already being played back by its own delta, so the cell plays only what is
 * its own.
 */
export function planFlip({
  before,
  after,
  existed,
  crowd,
  parents = new Map(),
}: {
  before: ReadonlyMap<string, Box>
  after: ReadonlyMap<string, Box>
  existed: ReadonlySet<string>
  crowd: number
  parents?: ReadonlyMap<string, string>
}): FlipPlan {
  const enters = [...after.keys()].filter((key) => !existed.has(key))
  const exits = [...before.keys()].filter((key) => !after.has(key))
  if (enters.length + exits.length > crowd) return NOTHING

  const delta = new Map<string, { dx: number; dy: number }>()
  for (const [key, last] of after) {
    const first = before.get(key)
    if (first === undefined) continue
    delta.set(key, { dx: first.left - last.left, dy: first.top - last.top })
  }
  const moves: { key: string; dx: number; dy: number }[] = []
  for (const [key, own] of delta) {
    const parent = parents.get(key)
    const carried = parent === undefined ? undefined : delta.get(parent)
    const dx = own.dx - (carried?.dx ?? 0)
    const dy = own.dy - (carried?.dy ?? 0)
    if (Math.abs(dx) >= STILL || Math.abs(dy) >= STILL) moves.push({ key, dx, dy })
  }
  return { moves, enters, exits }
}

/**
 * Whether a box is worth measuring: inside the part of the scroller you can
 * see, or within one margin of it — a row just below the edge slides up into
 * view when one above it goes, and should not pop. Everything further away
 * changes place unseen, so a five-hundred-row sheet animates the thirty you can
 * see and not the rest.
 */
export function inView(box: Box, view: Box, margin: number): boolean {
  return (
    box.top + box.height >= view.top - margin &&
    box.top <= view.top + view.height + margin &&
    box.left + box.width >= view.left - margin &&
    box.left <= view.left + view.width + margin
  )
}
