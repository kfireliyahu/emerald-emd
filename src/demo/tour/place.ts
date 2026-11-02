/**
 * **Where the ring sits** (M33 U2): the point on the frame's viewport the
 * ring's centre is placed at, from three boxes measured in the same frame —
 * the viewport, the iframe as drawn (scaled in a movie), and the anchor in the
 * app's own pixels. Kept out of `Frame.tsx` so a test can hold it.
 *
 * The ring is placed with the CSS `translate` property and pressed with
 * `scale`, never both in `transform`: CSS applies `translate`, then `scale`,
 * then `transform`, so a press scaling a ring whose position was in
 * `transform` scaled the position too, about the viewport's corner — the
 * ring jumped toward the top-left by a fifth of its distance from it and came
 * back on every click (the jitter found on 2026-10-07).
 *
 * **It travels on the app, not on the viewport** (M33 F2): its position is
 * worked out in the app's own pixels and mapped through the iframe as drawn
 * every frame (`travelled`, `onViewport`), so a pan or a scale moves it with
 * the app, and it lands on its anchor at whatever scale and wherever the crop is.
 */

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Past this, the ring sits this far into a wide anchor rather than at its middle. */
export const INTO_WIDE = 60

export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * The point on an anchor the ring's centre goes to, **in the app's own
 * pixels** — or `undefined` when the anchor measures nothing (a click removed
 * or hid it), so the ring holds where it was rather than flying to the corner.
 */
export function anchorPoint(anchor: Box): Point | undefined {
  if (anchor.width === 0 && anchor.height === 0) return undefined
  return { x: anchor.left + Math.min(anchor.width / 2, INTO_WIDE), y: anchor.top + anchor.height / 2 }
}

/** How far the ring's centre stands off the start of a label it only names, in the app's pixels. */
export const BESIDE = 18

/**
 * **Where the ring rests on a box it names** (M54 F11): a `say` row's ring is
 * read, not pressed, so it rests on what the box holds — `content`, the extent
 * of its text — and beside its label rather than over it: its centre `BESIDE`
 * before the text's start, on its middle. Before, it sat `INTO_WIDE` into the
 * box's own edge, which in a box whose text is centred was empty hairline, and
 * over a short label it hid the label.
 */
export function besidePoint(content: Box): Point | undefined {
  if (content.width === 0 && content.height === 0) return undefined
  return { x: content.left - BESIDE, y: content.top + content.height / 2 }
}

/**
 * The part of `own` its text covers (M54 F11): the union of its text's boxes,
 * kept inside `own` — a truncated label's runs reach past its box — or `own`
 * when it holds no text that measures, as a field or an icon does.
 */
export function contentOf(own: Box, runs: readonly Box[]): Box {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const run of runs) {
    if (run.width === 0 || run.height === 0) continue
    left = Math.min(left, Math.max(run.left, own.left))
    top = Math.min(top, Math.max(run.top, own.top))
    right = Math.max(right, Math.min(run.left + run.width, own.left + own.width))
    bottom = Math.max(bottom, Math.min(run.top + run.height, own.top + own.height))
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : own
}

/** Whether a point on the viewport is inside it: the ring is hidden while its anchor is off it (M54 F11). */
export function onView(viewport: { readonly width: number; readonly height: number }, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= viewport.width && point.y <= viewport.height
}

/**
 * A point in the app's own pixels, on the frame's viewport: through the iframe
 * **as drawn this frame** — scaled to fit, or panned and scaled in a crop, and
 * mid-ease in either. `frame` is the iframe's drawn box and `layoutWidth` its
 * own width, so their ratio is the scale and the box's corner is the pan.
 */
export function onViewport(viewport: Box, frame: Box, layoutWidth: number, point: Point): Point {
  const by = layoutWidth > 0 ? frame.width / layoutWidth : 1
  return { x: frame.left - viewport.left + point.x * by, y: frame.top - viewport.top + point.y * by }
}

/**
 * The ring's centre on the viewport for an anchor at rest — or `undefined`
 * when the anchor measures nothing.
 */
export function ringPoint(viewport: Box, frame: Box, layoutWidth: number, anchor: Box): Point | undefined {
  const point = anchorPoint(anchor)
  return point === undefined ? undefined : onViewport(viewport, frame, layoutWidth, point)
}

/**
 * The frame's `--ease-in-out`, `cubic-bezier(0.65, 0, 0.35, 1)`: the curve a
 * crop's pan takes, so the ring travelling on it arrives with the window.
 */
export function easeInOut(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const curve = (s: number, a: number, b: number): number => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s
  let low = 0
  let high = 1
  for (let step = 0; step < 30; step += 1) {
    const mid = (low + high) / 2
    if (curve(mid, 0.65, 0.35) < t) low = mid
    else high = mid
  }
  return curve((low + high) / 2, 0, 1)
}

/**
 * **Where the ring is, `elapsed` ms into a travel of `travel` ms** (M33 F2), in
 * the app's own pixels: from where it was to where its anchor is now. The ring
 * travels **on the app**, and the frame maps the result through the iframe as
 * drawn that frame (`onViewport`). A CSS transition on the ring's own position
 * could not: every frame the app moved under it — a crop's pan, the scale
 * easing when the paper comes in, a panel sliding — restarted the transition
 * toward a new point, so the ring trailed its anchor by up to a travel and was
 * 30 to 270 px off it when it pressed (measured on the host page, 2026-10-07).
 * At the end of the travel, and after it, this is the anchor exactly.
 */
export function travelled(from: Point, to: Point, elapsed: number, travel: number): Point {
  const k = travel > 0 ? easeInOut(elapsed / travel) : 1
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
}

/** Whether a new point is the same place, to the half pixel: no style write for a ring at rest. */
export function samePlace(a: Point | undefined, b: Point): boolean {
  return a !== undefined && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
}

/** How far the outline stands off the box it is drawn around, in the app's pixels. */
export const LOOK_MARGIN = 4

/**
 * The outline's box (a row's `look`), relative to the viewport's corner, the
 * anchor's box grown by `LOOK_MARGIN` and scaled with the movie — or
 * `undefined` when the anchor measures nothing, so it holds where it was.
 */
export function lookBox(viewport: Box, frame: Box, layoutWidth: number, anchor: Box): Box | undefined {
  if (anchor.width === 0 && anchor.height === 0) return undefined
  const by = layoutWidth > 0 ? frame.width / layoutWidth : 1
  const corner = onViewport(viewport, frame, layoutWidth, { x: anchor.left - LOOK_MARGIN, y: anchor.top - LOOK_MARGIN })
  return {
    left: corner.x,
    top: corner.y,
    width: (anchor.width + 2 * LOOK_MARGIN) * by,
    height: (anchor.height + 2 * LOOK_MARGIN) * by,
  }
}
