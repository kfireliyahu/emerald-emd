import type { GraphNode, Port } from '@/domain/format/connections.ts'
import { samePort } from '@/domain/format/connections.ts'
import type { GraphPlace } from '@/domain/format/view.ts'

/**
 * Where the bubbles and their endpoints go — M20 U5 (D-233).
 *
 * Separate from the screen because it is arithmetic, and separate from
 * `domain/format/connections.ts` because it is pixels: *if it is about
 * presentation or storage, it is not the domain layer.* The graph's **shape** is
 * the domain's; where it lands on a surface 1,300 pixels wide is this file's.
 *
 * ## The two sides of a bubble mean two different things
 *
 * **The right edge is what this format names; the left edge is what names it.**
 * A column and the *belongs to one…* port are on the right; a row, a figure and
 * the *has many…* port are on the left. So every link runs out of
 * a right edge into a left edge, and a figure runs back into the left edge of
 * the format that reports it — which is why the figure's curve and the link's
 * curve share the link column's dot rather than being drawn as two unrelated
 * lines. They *are* the same connection read in the two directions D-224 allows.
 *
 * ## Rank decides where a bubble starts, and a person decides where it stays
 *
 * A format that names nothing has rank 0 and sits on the right; the most
 * composed format sits on the left. That is still the whole layout for a
 * document nobody has arranged — no force simulation, nothing random — and
 * since M26 U4 (D-291) it is only the *default*: a bubble somebody moved is
 * drawn where they left it, from a place kept in the document beside the
 * declarations, never in them.
 *
 * ## A pack's formats are one bubble until it is opened
 *
 * The ledger is a dozen formats a person did not declare (D-269), and drawn
 * whole they bury the two the person did. So a pack folds into one group,
 * placed by rank like any bubble; opened, its formats are laid out by rank
 * *from where the group stood*, so nothing else on the canvas moves. A
 * connection into a folded format runs to the group's edge.
 */

/** A bubble is one width, whatever is in it: a ragged column of boxes is noise. */
export const BUBBLE_WIDTH = 236
/** The head carries the title and the row port. */
export const HEAD_HEIGHT = 40
export const PORT_HEIGHT = 24
const FOOT = 8
/** A folded pack: a head, and one line saying how many formats are inside. */
export const GROUP_HEIGHT = HEAD_HEIGHT + PORT_HEIGHT + FOOT
const COLUMN_GAP = 132
const ROW_GAP = 32
const MARGIN = 24

export type Side = 'LEFT' | 'RIGHT'

/** One endpoint, placed. */
export interface PlacedPort {
  readonly port: Port
  readonly side: Side
  readonly x: number
  readonly y: number
}

/** One bubble, placed, with every endpoint on it. */
export interface PlacedNode {
  readonly node: GraphNode
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** The bubble itself — a row of this format. On the left edge, in the head. */
  readonly row: PlacedPort
  /** Every other endpoint, in the order the bubble lists them. */
  readonly ports: readonly PlacedPort[]
}

/** A pack's formats as one bubble — or, opened, where that bubble stood. */
export interface PlacedGroup {
  readonly pack: string
  /** Its formats, in the order the document lists them. */
  readonly members: readonly string[]
  readonly open: boolean
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Placement {
  /** Every bubble drawn — which leaves out the formats of a folded pack. */
  readonly nodes: readonly PlacedNode[]
  /** Every pack, folded or open. */
  readonly groups: readonly PlacedGroup[]
  readonly width: number
  readonly height: number
}

/** What a canvas knows beyond the graph's shape (D-291). */
export interface CanvasOptions {
  /** The pack that owns each format a pack owns (D-269). */
  readonly packOf?: ReadonlyMap<string, string>
  /** The packs a person has opened. Every other pack is folded. */
  readonly opened?: ReadonlySet<string>
  /** Where a person left things. Anything without a place is placed by rank. */
  readonly places?: readonly GraphPlace[]
}

/** Which edge of the bubble an endpoint sits on. See the head of this file. */
export function sideOf(port: Port): Side {
  switch (port.kind) {
    case 'COLUMN':
    case 'NEW_LINK':
      return 'RIGHT'
    case 'ROW':
    case 'FIGURE':
    case 'NEW_FIGURE':
      return 'LEFT'
  }
}

/** The height of a bubble, which is fixed by how many endpoints it has. */
function heightOf(node: GraphNode): number {
  return HEAD_HEIGHT + node.ports.length * PORT_HEIGHT + FOOT
}

/**
 * Rank into lanes: the deepest rank leftmost, each lane stacked top to bottom
 * in the order given. The layout every canvas starts from.
 */
function lanes<T>(
  items: readonly T[],
  rank: (item: T) => number,
  height: (item: T) => number,
): readonly { readonly x: number; readonly y: number }[] {
  const deepest = items.reduce((most, each) => Math.max(most, rank(each)), 0)
  const nextY = new Map<number, number>()
  return items.map((item) => {
    const lane = deepest - rank(item)
    const y = nextY.get(lane) ?? MARGIN
    nextY.set(lane, y + height(item) + ROW_GAP)
    return { x: MARGIN + lane * (BUBBLE_WIDTH + COLUMN_GAP), y }
  })
}

/** One bubble at a point, with every endpoint on it. */
function placeNode(node: GraphNode, x: number, y: number): PlacedNode {
  const at = (port: Port, centre: number): PlacedPort => ({
    port,
    side: sideOf(port),
    x: sideOf(port) === 'RIGHT' ? x + BUBBLE_WIDTH : x,
    y: centre,
  })
  return {
    node,
    x,
    y,
    width: BUBBLE_WIDTH,
    height: heightOf(node),
    row: at(node.row.port, y + HEAD_HEIGHT / 2),
    ports: node.ports.map((each, index) =>
      at(each.port, y + HEAD_HEIGHT + index * PORT_HEIGHT + PORT_HEIGHT / 2),
    ),
  }
}

type Item =
  | { readonly kind: 'FORMAT'; readonly node: GraphNode }
  | { readonly kind: 'PACK'; readonly pack: string; readonly members: readonly GraphNode[] }

export function placeGraph(nodes: readonly GraphNode[], options: CanvasOptions = {}): Placement {
  const packOf = options.packOf ?? new Map<string, string>()
  const opened = options.opened ?? new Set<string>()
  const saved = new Map((options.places ?? []).map((each) => [`${each.kind}:${each.name}`, each]))

  // A pack is one item, where its first format would have been.
  const items: Item[] = []
  for (const node of nodes) {
    const pack = packOf.get(node.name)
    if (pack === undefined) {
      items.push({ kind: 'FORMAT', node })
    } else if (!items.some((each) => each.kind === 'PACK' && each.pack === pack)) {
      items.push({ kind: 'PACK', pack, members: nodes.filter((each) => packOf.get(each.name) === pack) })
    }
  }
  const defaults = lanes(
    items,
    (item) =>
      item.kind === 'FORMAT'
        ? item.node.rank
        : item.members.reduce((most, each) => Math.max(most, each.rank), 0),
    (item) => (item.kind === 'FORMAT' ? heightOf(item.node) : GROUP_HEIGHT),
  )

  const placed: PlacedNode[] = []
  const groups: PlacedGroup[] = []
  items.forEach((item, index) => {
    const start = defaults[index] ?? { x: MARGIN, y: MARGIN }
    if (item.kind === 'FORMAT') {
      const own = saved.get(`FORMAT:${item.node.name}`) ?? start
      placed.push(placeNode(item.node, own.x, own.y))
      return
    }
    const anchor = saved.get(`PACK:${item.pack}`) ?? start
    const open = opened.has(item.pack)
    groups.push({
      pack: item.pack,
      members: item.members.map((each) => each.name),
      open,
      x: anchor.x,
      y: anchor.y,
      width: BUBBLE_WIDTH,
      height: GROUP_HEIGHT,
    })
    if (!open) return
    // Opened: laid out by rank among themselves, from where the group stood.
    const inside = lanes(item.members, (each) => each.rank, heightOf)
    item.members.forEach((member, at) => {
      const spot = inside[at]
      const own =
        saved.get(`FORMAT:${member.name}`) ??
        (spot === undefined
          ? anchor
          : { x: anchor.x + (spot.x - MARGIN), y: anchor.y + (spot.y - MARGIN) })
      placed.push(placeNode(member, own.x, own.y))
    })
  })

  const drawn = [...placed, ...groups.filter((each) => !each.open)]
  return {
    nodes: placed,
    groups,
    width: drawn.reduce((most, each) => Math.max(most, each.x + each.width), 0) + MARGIN,
    height: drawn.reduce((most, each) => Math.max(most, each.y + each.height), 0) + MARGIN,
  }
}

/** The folded group a format is drawn inside, if it is in one. */
export function foldedInto(placement: Placement, format: string): PlacedGroup | undefined {
  return placement.groups.find((each) => !each.open && each.members.includes(format))
}

/** Where one endpoint ended up, or nothing if it is not on the graph. */
export function anchorOf(placement: Placement, port: Port): PlacedPort | undefined {
  // A connection into a folded pack runs to the group's own edge.
  const group = foldedInto(placement, port.format)
  if (group !== undefined) {
    const side = sideOf(port)
    return {
      port,
      side,
      x: side === 'RIGHT' ? group.x + group.width : group.x,
      y: group.y + HEAD_HEIGHT / 2,
    }
  }
  for (const node of placement.nodes) {
    if (samePort(node.row.port, port)) return node.row
    const found = node.ports.find((each) => samePort(each.port, port))
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * The curve between two endpoints.
 *
 * The control points leave each end *outwards from its own edge*, which is what
 * makes a connection that runs backwards across the screen — a link re-pointed
 * at something to its left — draw as a legible S rather than as a straight line
 * through both bubbles.
 */
export function pathBetween(from: PlacedPort, to: PlacedPort): string {
  const reach = Math.max(48, Math.abs(to.x - from.x) * 0.5)
  const one = from.side === 'RIGHT' ? from.x + reach : from.x - reach
  const other = to.side === 'RIGHT' ? to.x + reach : to.x - reach
  return `M ${from.x} ${from.y} C ${one} ${from.y}, ${other} ${to.y}, ${to.x} ${to.y}`
}

/**
 * The endpoint nearest a point, within a radius — the drop test.
 *
 * A drag is resolved against the endpoints' own coordinates rather than against
 * whatever element the pointer happens to be over, because a curve, a label and
 * a bubble all sit between a finger and the dot it is aiming at. The radius is
 * generous on purpose: a dot is 10 pixels across and a person is not.
 *
 * **The whole bubble is a drop target, row by row**, and that is not a nicety.
 * A dot sits on one edge of a bubble 236 pixels wide, so a person dropping a
 * figure onto *the `recipe` column* aims at the words and lands 180 pixels from
 * the dot. The first version of this only tested the dots and the head, and the
 * gesture the ordering problem is answered by — drop a figure on the column
 * that gathers it — was the one that silently did nothing.
 */
export function nearestPort(
  placement: Placement,
  x: number,
  y: number,
  within = 28,
): Port | undefined {
  let best: { port: Port; distance: number } | undefined
  for (const node of placement.nodes) {
    for (const candidate of [node.row, ...node.ports]) {
      const distance = Math.hypot(candidate.x - x, candidate.y - y)
      if (distance > within) continue
      if (best === undefined || distance < best.distance) best = { port: candidate.port, distance }
    }
  }
  if (best !== undefined) return best.port

  for (const node of placement.nodes) {
    if (x < node.x || x > node.x + node.width) continue
    if (y < node.y || y > node.y + node.height) continue
    if (y <= node.y + HEAD_HEIGHT) return node.row.port
    const index = Math.floor((y - node.y - HEAD_HEIGHT) / PORT_HEIGHT)
    return node.ports[index]?.port ?? node.row.port
  }
  return undefined
}
