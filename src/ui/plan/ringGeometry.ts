/**
 * The plan's bar and its ring are **one shape at two values of `t`** (M28 U7b,
 * D-320): every segment is an outline of sampled points, and each point has a
 * place on the bar and a place on the ring. Moving a point between the two is
 * the whole animation — the segments bend, nothing cross-fades.
 *
 * Pure arithmetic and no DOM, so it is testable in Node (the suite has no
 * jsdom). Display geometry only: no figure printed anywhere comes from here.
 */

export interface RingDims {
  /** The drawing's width: the bar spans it, the ring is centred in it. */
  readonly width: number
  /** The bar's top edge and its thickness. */
  readonly barTop: number
  readonly barHeight: number
  /** The ring's centre, outer radius and inner radius. */
  readonly cx: number
  readonly cy: number
  readonly outer: number
  readonly inner: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** Where a fraction of the whole sits on the ring. 0 is 12 o'clock, clockwise. */
export function ringPoint(fraction: number, radius: number, dims: RingDims): Point {
  const angle = -Math.PI / 2 + fraction * 2 * Math.PI
  return { x: dims.cx + radius * Math.cos(angle), y: dims.cy + radius * Math.sin(angle) }
}

/** Where it sits on the bar: `edge` 0 is the top edge, 1 the bottom. */
export function barPoint(fraction: number, edge: 0 | 1, dims: RingDims): Point {
  return { x: fraction * dims.width, y: dims.barTop + edge * dims.barHeight }
}

/** A point between the bar's place and the ring's, `t` 0 (bar) to 1 (ring). */
export function morphPoint(fraction: number, edge: 0 | 1, t: number, dims: RingDims): Point {
  const a = barPoint(fraction, edge, dims)
  const b = ringPoint(fraction, edge === 0 ? dims.outer : dims.inner, dims)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Samples along an edge: enough that the ring reads as round, never fewer than 2. */
export function samplesFor(from: number, to: number): number {
  return Math.max(2, Math.ceil(Math.abs(to - from) * 120))
}

/** The segment's outer edge from `from` to `to` (fractions of the whole), at `t`. */
export function edgePoints(from: number, to: number, edge: 0 | 1, t: number, dims: RingDims): Point[] {
  const count = samplesFor(from, to)
  const points: Point[] = []
  for (let i = 0; i <= count; i++) points.push(morphPoint(from + ((to - from) * i) / count, edge, t, dims))
  return points
}

const trace = (points: readonly Point[], move: boolean): string =>
  points
    .map((point, index) => `${index === 0 && move ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

/** The closed outline of one segment, between two fractions of the whole. */
export function segmentPath(from: number, to: number, t: number, dims: RingDims): string {
  const outer = edgePoints(from, to, 0, t, dims)
  const inner = edgePoints(to, from, 1, t, dims)
  return `${trace(outer, true)} ${trace(inner, false)} Z`
}

/** Only the outer edge — the segment's coloured "top border". */
export function topPath(from: number, to: number, t: number, dims: RingDims): string {
  return trace(edgePoints(from, to, 0, t, dims), true)
}

/** The straight line a divider or a tick makes across the ring (or bar) at a fraction. */
export function crossPath(fraction: number, t: number, dims: RingDims): string {
  const a = morphPoint(fraction, 0, t, dims)
  const b = morphPoint(fraction, 1, t, dims)
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} L${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

/** The ring's fixed layout inside a square of side `size`. */
export function ringDims(size: number, width: number, barTop: number, barHeight: number): RingDims {
  const outer = size / 2 - 4
  return { width, barTop, barHeight, cx: width / 2, cy: size / 2, outer, inner: outer * 0.6 }
}

/**
 * Where on the whole (0..1) a pointer is, measured round the ring's centre —
 * 0 at 12 o'clock, clockwise.
 */
export function fractionAt(dx: number, dy: number): number {
  const turn = (Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI)
  return ((turn % 1) + 1) % 1
}

/**
 * **A drag round a circle has a seam at the top**, where 0.999 is next to 0.001.
 * Choose the representative of `raw` (mod 1) nearest the divider's previous
 * place, so crossing 12 o'clock continues rather than jumps; the caller clamps
 * to 0..1 and the domain clamps to the neighbours.
 */
export function unwrapFraction(raw: number, previous: number): number {
  let value = raw
  while (value - previous > 0.5) value -= 1
  while (value - previous < -0.5) value += 1
  return value
}

/** The morph's pace: docs/11's ease-in-out for movement between two states. */
export function easeInOut(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
}

export const MORPH_MS = 350
