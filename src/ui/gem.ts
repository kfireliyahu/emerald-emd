/**
 * The mark, cut into the pieces the indicator assembles (M28 U4).
 *
 * The same paths as `emerald.svg`, in its order: the eight outer facets, the
 * eight inner ones, then the core and its two glints. `gem.test.ts` reads the
 * file and fails when the two drift, so the indicator is always the mark and
 * never a drawing of it.
 *
 * Each facet carries the direction it flies in from: away from the centre of
 * the 64-unit box, along the line through its own centroid, a little over half
 * the distance. What the eye reads is the gem coming apart along its own cuts.
 */
export interface Facet {
  readonly d: string
  readonly fill: string
  /** Where it sits when it is out, in the mark's own units. */
  readonly dx: number
  readonly dy: number
}

const OUTWARD = 0.55

const PIECES: readonly (readonly [string, string])[] = [
  ['M12.3441 14.9647L21.5169 5.79187L25.0113 11.9071L18.4593 18.4591L12.3441 14.9647Z', '#6EE7B7'],
  ['M21.5168 5.79187H42.4832L38.9888 11.9071H25.0112L21.5168 5.79187Z', '#34D399'],
  ['M42.4832 5.79187L51.656 14.9647L45.5408 18.4591L38.9888 11.9071L42.4832 5.79187Z', '#12BC86'],
  ['M51.656 14.9647V49.0351L45.5408 45.5407V18.4591L51.656 14.9647Z', '#068C66'],
  ['M51.656 49.0353L42.4832 58.2081L38.9888 52.0929L45.5408 45.5409L51.656 49.0353Z', '#033A2B'],
  ['M42.4832 58.208H21.5168L25.0112 52.0928H38.9888L42.4832 58.208Z', '#05604A'],
  ['M21.5169 58.2081L12.3441 49.0353L18.4593 45.5409L25.0113 52.0929L21.5169 58.2081Z', '#0BA277'],
  ['M12.3441 49.0351V14.9647L18.4593 18.4591V45.5407L12.3441 49.0351Z', '#28CE95'],
  ['M18.4592 18.4591L25.0112 11.9071L28.5056 17.5855L24.1376 21.9535L18.4592 18.4591Z', '#A7F3D0'],
  ['M25.0112 11.9071H38.9888L35.4944 17.5855H28.5056L25.0112 11.9071Z', '#6EE7B7'],
  ['M38.9888 11.9071L45.5408 18.4591L39.8624 21.9535L35.4944 17.5855L38.9888 11.9071Z', '#34D399'],
  ['M45.5408 18.4591V45.5407L39.8624 42.0463V21.9535L45.5408 18.4591Z', '#0BA277'],
  ['M45.5408 45.5407L38.9888 52.0927L35.4944 46.4143L39.8624 42.0463L45.5408 45.5407Z', '#04503C'],
  ['M38.9888 52.0927H25.0112L28.5056 46.4143H35.4944L38.9888 52.0927Z', '#077A5B'],
  ['M25.0112 52.0927L18.4592 45.5407L24.1376 42.0463L28.5056 46.4143L25.0112 52.0927Z', '#12BC86'],
  ['M18.4592 45.5407V18.4591L24.1376 21.9535V42.0463L18.4592 45.5407Z', '#4ADEB0'],
]

export const CORE = 'M24.1376 21.9536L28.5056 17.5856H35.4944L39.8624 21.9536V42.0464L35.4944 46.4144H28.5056L24.1376 42.0464V21.9536Z'
export const GLINTS: readonly (readonly [string, number])[] = [
  ['M27.1952 20.2062H35.9312L35.0576 21.735H26.3216L27.1952 20.2062Z', 0.5],
  ['M36.8048 20.6431H38.552L37.6784 21.9535H35.9312L36.8048 20.6431Z', 0.3],
]

/** The corners of a path made of M, L, H, V and Z, which is all the mark uses. */
export function corners(d: string): readonly (readonly [number, number])[] {
  const points: [number, number][] = []
  let x = 0
  let y = 0
  for (const [, command, args] of d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
    const values = (args ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (command === 'M' || command === 'L') {
      x = values[0] ?? x
      y = values[1] ?? y
    } else if (command === 'H') {
      x = values[0] ?? x
    } else if (command === 'V') {
      y = values[0] ?? y
    } else {
      continue
    }
    points.push([x, y])
  }
  return points
}

function outward(d: string): { dx: number; dy: number } {
  const points = corners(d)
  const cx = points.reduce((sum, [px]) => sum + px, 0) / points.length
  const cy = points.reduce((sum, [, py]) => sum + py, 0) / points.length
  return { dx: round((cx - 32) * OUTWARD), dy: round((cy - 32) * OUTWARD) }
}

const round = (value: number): number => Math.round(value * 10) / 10

export const FACETS: readonly Facet[] = PIECES.map(([d, fill]) => ({ d, fill, ...outward(d) }))
