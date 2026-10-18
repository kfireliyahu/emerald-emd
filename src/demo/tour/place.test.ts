import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { anchorPoint, easeInOut, INTO_WIDE, LOOK_MARGIN, lookBox, onViewport, ringPoint, samePlace, travelled } from './place.ts'

const viewport = { left: 0, top: 50, width: 1200, height: 700 }

describe('where the ring sits', () => {
  it('centres on a small anchor, in the viewport\'s own coordinates', () => {
    const frame = { left: 0, top: 50, width: 1200, height: 700 }
    expect(ringPoint(viewport, frame, 1200, { left: 100, top: 200, width: 40, height: 20 })).toEqual({ x: 120, y: 210 })
  })

  it('sits a fixed way into a wide anchor rather than at its middle', () => {
    const frame = { left: 0, top: 50, width: 1200, height: 700 }
    expect(ringPoint(viewport, frame, 1200, { left: 100, top: 200, width: 600, height: 30 })).toEqual({
      x: 100 + INTO_WIDE,
      y: 215,
    })
  })

  it('scales the anchor by the movie\'s scale, and offsets by where the iframe is drawn', () => {
    // Laid out at 1100, drawn at 341: a 375-wide movie.
    const frame = { left: 10, top: 60, width: 341, height: 217 }
    const point = ringPoint(viewport, frame, 1100, { left: 220, top: 110, width: 40, height: 20 })
    const by = 341 / 1100
    expect(point?.x).toBeCloseTo(10 + 240 * by)
    expect(point?.y).toBeCloseTo(10 + 120 * by)
  })

  it('holds rather than flying to the corner when the anchor measures nothing', () => {
    const frame = { left: 0, top: 50, width: 1200, height: 700 }
    expect(ringPoint(viewport, frame, 1200, { left: 0, top: 0, width: 0, height: 0 })).toBeUndefined()
  })

  it('writes nothing for a move under half a pixel, so no transition restarts', () => {
    expect(samePlace({ x: 10, y: 10 }, { x: 10.3, y: 9.8 })).toBe(true)
    expect(samePlace({ x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false)
    expect(samePlace(undefined, { x: 0, y: 0 })).toBe(false)
  })
})

describe('where the outline is drawn', () => {
  it('stands off its box by a margin, scaled with the movie', () => {
    const frame = { left: 10, top: 60, width: 550, height: 350 }
    const box = lookBox(viewport, frame, 1100, { left: 100, top: 200, width: 300, height: 40 })
    expect(box).toEqual({
      left: 10 + (100 - LOOK_MARGIN) / 2,
      top: 10 + (200 - LOOK_MARGIN) / 2,
      width: (300 + 2 * LOOK_MARGIN) / 2,
      height: (40 + 2 * LOOK_MARGIN) / 2,
    })
  })

  it('holds when its box measures nothing', () => {
    const frame = { left: 0, top: 50, width: 1200, height: 700 }
    expect(lookBox(viewport, frame, 1200, { left: 0, top: 0, width: 0, height: 0 })).toBeUndefined()
  })
})

describe('a press leaves the ring where it is (the jitter, 2026-10-07)', () => {
  // CSS applies `translate`, then `scale`, then `transform`. A press is a
  // `scale`; with the position in `transform` it scaled the position too, and
  // the ring jumped toward the viewport's corner on every click. Measured in
  // the pane: (500, 300) went to (410, 246) at the press's peak.
  const css = readFileSync(new URL('./frame.css', import.meta.url), 'utf8')
  const frame = readFileSync(new URL('./Frame.tsx', import.meta.url), 'utf8')

  it('places the ring by translate, and never eases its place in CSS (M33 F2)', () => {
    expect(frame).toMatch(/ringElement\.style\.translate =/)
    expect(frame).not.toMatch(/ringElement\.style\.transform =/)
    // A CSS transition on its place chased an app that moved under it.
    expect(css).not.toMatch(/\.tour-ring \{[^}]*transition:[^;]*translate/)
  })

  it('presses by scale, never by transform', () => {
    const press = /@keyframes tour-press \{([^@]*)\}\s*@keyframes/.exec(css)?.[1] ?? ''
    expect(press).toMatch(/scale:/)
    expect(press).not.toMatch(/transform/)
  })
})

describe('the ring lands true when the app is scaled or cropped (M33 F2)', () => {
  // The phone column: a 373-wide viewport under the strip, the app laid out at
  // 1120 and drawn at 0.75, panned 232 by 30 app pixels — the iframe's drawn
  // box starts left of and above the viewport by the pan times the scale.
  const phone = { left: 0, top: 150, width: 373, height: 290 }
  const cropAt = (x: number, y: number) => ({ left: -x * 0.75, top: 150 - y * 0.75, width: 1120 * 0.75, height: 720 * 0.75 })
  const input = { left: 300, top: 80, width: 180, height: 32 }

  it('puts an anchor at the crop scale and offset', () => {
    const point = ringPoint(phone, cropAt(232, 30), 1120, input)
    expect(point?.x).toBeCloseTo((300 + INTO_WIDE - 232) * 0.75)
    expect(point?.y).toBeCloseTo((80 + 16 - 30) * 0.75)
  })

  it('puts the outline at the crop scale and offset, centred on its box', () => {
    const box = lookBox(phone, cropAt(232, 30), 1120, input)
    expect(box).toBeDefined()
    if (box === undefined) return
    expect(box.left + box.width / 2).toBeCloseTo((300 + 90 - 232) * 0.75)
    expect(box.top + box.height / 2).toBeCloseTo((80 + 16 - 30) * 0.75)
  })

  it('beside the paper: the wide figure drawn at 0.671 with no pan', () => {
    const wide = { left: 0, top: 120, width: 753, height: 440 }
    const frame = { left: 0, top: 120, width: 870 * 0.671, height: 656 * 0.671 }
    const point = ringPoint(wide, frame, 870, { left: 500, top: 300, width: 28, height: 28 })
    expect(point?.x).toBeCloseTo(514 * 0.671)
    expect(point?.y).toBeCloseTo(314 * 0.671)
  })

  it('arrives on its anchor at the end of a travel, and stays on it after', () => {
    const from = { x: 40, y: 40 }
    const to = anchorPoint(input) ?? from
    expect(travelled(from, to, 933, 933)).toEqual(to)
    expect(travelled(from, to, 5000, 933)).toEqual(to)
    expect(travelled(from, to, 0, 933)).toEqual(from)
    // Reduced motion: no travel, already there.
    expect(travelled(from, to, 0, 0)).toEqual(to)
  })

  it('travels on the app: mid-pan and mid-travel, it moves with the app under it', () => {
    // The crop pans from (0, 0) to (232, 30) while the ring travels: at every
    // instant the ring is the same app point, so on the viewport it is offset
    // by exactly the pan drawn so far — never left behind by it.
    const from = { x: 120, y: 20 }
    const to = anchorPoint(input) ?? from
    for (const k of [0.1, 0.5, 0.9, 1]) {
      const onApp = travelled(from, to, k * 933, 933)
      const pan = { x: 232 * easeInOut(k), y: 30 * easeInOut(k) }
      const drawn = onViewport(phone, cropAt(pan.x, pan.y), 1120, onApp)
      expect(drawn.x).toBeCloseTo((onApp.x - pan.x) * 0.75)
      expect(drawn.y).toBeCloseTo((onApp.y - pan.y) * 0.75)
    }
    // And when both have arrived, the ring is on its anchor in the window.
    const landed = onViewport(phone, cropAt(232, 30), 1120, travelled(from, to, 933, 933))
    expect(landed).toEqual(ringPoint(phone, cropAt(232, 30), 1120, input))
  })

  it('follows a target that moved under it, and lands on where it went (M39 U2)', () => {
    // A row the last action pushed down slides 28 app pixels into its new
    // place while the ring travels, in a crop: the frame measures the anchor
    // every frame and travels toward where it is now, so the ring lands on the
    // row's new place, never on where it was when the travel began.
    const from = { x: 120, y: 20 }
    const moved = { ...input, top: input.top + 28 }
    const before = anchorPoint(input) ?? from
    const after = anchorPoint(moved) ?? from
    // Half way, the frame aims at the box as measured that frame.
    const mid = travelled(from, after, 466, 933)
    expect(mid.y).toBeGreaterThan(travelled(from, before, 466, 933).y)
    // At the end it is on the moved anchor, at the crop's scale and offset.
    const landed = onViewport(phone, cropAt(232, 30), 1120, travelled(from, after, 933, 933))
    expect(landed).toEqual(ringPoint(phone, cropAt(232, 30), 1120, moved))
    expect(landed.y).toBeCloseTo((80 + 28 + 16 - 30) * 0.75)
    // And the outline is drawn around the box where it is now.
    const box = lookBox(phone, cropAt(232, 30), 1120, moved)
    expect(box?.top).toBeCloseTo((80 + 28 - LOOK_MARGIN - 30) * 0.75)
  })

  it('is measured after the layout has stopped moving, never after a delay (M39 U2)', () => {
    const player = readFileSync(new URL('./player.ts', import.meta.url), 'utf8')
    // Before an anchor and before an outline, the layout's own animations are
    // waited for — and nothing in the runner sleeps a fixed time for the app.
    expect(player.match(/await layoutSettled\(doc, cancelled\)/g)?.length).toBeGreaterThanOrEqual(3)
    const runner = readFileSync(new URL('./runner.ts', import.meta.url), 'utf8')
    expect(runner).toMatch(/closest\('\[inert\]'\)/)
  })

  it('eases as the frame does: still at the ends, half way at the middle', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5)
    expect(easeInOut(0.1)).toBeLessThan(0.05)
    expect(easeInOut(0.9)).toBeGreaterThan(0.95)
  })
})
