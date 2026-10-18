import { describe, expect, it } from 'vitest'
import { BESIDE_WIDTH, CROP_HEIGHT, CROP_MARGIN, CROP_SCALE, cropAt, LAYOUT_LEAST, layoutOf, MOVIE_BELOW, RING_ROOM } from './layout.ts'
import { MOVIE_SPEED, startingSpeed } from './player.ts'

describe('how the app is laid out in the frame (M33 U3)', () => {
  it('is laid out at the frame’s own width when the frame is wide enough', () => {
    expect(layoutOf(1280, 600, false)).toEqual({ scale: 1, movie: false, width: 1280, height: 600, beside: 0 })
  })

  it('never narrower than LAYOUT_LEAST: a narrower frame draws it scaled, and the height follows', () => {
    const layout = layoutOf(LAYOUT_LEAST * 0.75, 300, false)
    expect(layout.scale).toBe(0.75)
    expect(layout.width).toBe(LAYOUT_LEAST)
    expect(layout.height).toBe(400)
  })

  it('lays the app out no narrower beside the paper: both are drawn smaller instead', () => {
    const wide = layoutOf(1400, 600, true)
    expect(wide).toMatchObject({ scale: 1, width: 1400 - BESIDE_WIDTH, beside: BESIDE_WIDTH })
    const host = layoutOf(1038, 600, true)
    expect(host.width).toBe(LAYOUT_LEAST)
    expect(host.scale).toBeCloseTo(1038 / (LAYOUT_LEAST + BESIDE_WIDTH))
    expect(host.beside).toBe(Math.round(BESIDE_WIDTH * host.scale))
    // Without the paper a frame as wide as the app is drawn at its own size.
    expect(layoutOf(LAYOUT_LEAST, 600, false).scale).toBe(1)
  })

  it('is a movie below the threshold and only there (P6)', () => {
    expect(layoutOf(MOVIE_BELOW, 400, false).movie).toBe(false)
    expect(layoutOf(MOVIE_BELOW - 1, 400, false).movie).toBe(true)
    // A 768 tablet with a margin either side, as the host page has it, can still take over.
    expect(layoutOf(719, 400, false).movie).toBe(false)
  })

  it('is a crop below the threshold: laid out as on a laptop, drawn at a size a phone reads (M33 F1)', () => {
    const phone = layoutOf(375, 240, true)
    expect(phone).toEqual({ scale: CROP_SCALE, movie: true, width: LAYOUT_LEAST, height: CROP_HEIGHT, beside: 0 })
    expect(13 * phone.scale).toBeGreaterThanOrEqual(9.5)
  })
})

describe('where a crop’s window sits (M33 F1)', () => {
  const app = { width: 1120, height: 720 }
  const viewport = { width: 375, height: 240 }
  const window = { width: 375 / CROP_SCALE, height: 240 / CROP_SCALE }

  it('centres a box that fits', () => {
    const at = cropAt({ left: 500, top: 300, width: 100, height: 30 }, app, viewport, CROP_SCALE)
    expect(at.x + window.width / 2).toBeCloseTo(550, 0)
    expect(at.y + window.height / 2).toBeCloseTo(315, 0)
  })

  it('keeps the start of a box wider than the window: a row is read from its first cell', () => {
    const at = cropAt({ left: 200, top: 100, width: 904, height: 36 }, app, viewport, CROP_SCALE)
    expect(at.x).toBe(200 - CROP_MARGIN)
  })

  it('never goes past the app’s edges', () => {
    expect(cropAt({ left: 0, top: 0, width: 20, height: 20 }, app, viewport, CROP_SCALE)).toEqual({ x: 0, y: 0 })
    const far = cropAt({ left: 1100, top: 700, width: 20, height: 20 }, app, viewport, CROP_SCALE)
    expect(far).toEqual({ x: Math.round(1120 - window.width), y: Math.round(720 - window.height) })
  })

  it('places the box clear of a card over the window’s right side, and the app’s edge no further than the card (M33 F4)', () => {
    const box = { left: 500, top: 300, width: 100, height: 30 }
    const at = cropAt(box, app, viewport, CROP_SCALE, undefined, 135)
    expect(at.x + (375 - 135) / CROP_SCALE / 2).toBeCloseTo(550, 0)
    // A box at the app's right edge: the window passes it by what the card covers, so the box is beside the card.
    const open = (375 - 135) / CROP_SCALE
    const edge = cropAt({ left: 1060, top: 300, width: 40, height: 30 }, app, viewport, CROP_SCALE, undefined, 135)
    expect(edge.x).toBe(Math.round(1120 - open))
    expect(cropAt({ left: 1060, top: 300, width: 40, height: 30 }, app, viewport, CROP_SCALE).x).toBe(Math.round(1120 - window.width))
  })

  it('stays where it was with nothing to look at', () => {
    expect(cropAt(undefined, app, viewport, CROP_SCALE, { x: 40, y: 50 })).toEqual({ x: 40, y: 50 })
  })

  it('keeps the ring in the window when it goes past the outline it holds (M33 F4)', () => {
    // A panel outlined from x 216, and the ring on a button right of and under what the outline's window shows.
    const panel = { left: 216, top: 186, width: 700, height: 500 }
    const ring = { x: 848, y: 600 }
    const at = cropAt(panel, app, viewport, CROP_SCALE, undefined, 0, ring)
    expect(ring.x).toBeLessThanOrEqual(at.x + window.width - RING_ROOM)
    expect(ring.y).toBeLessThanOrEqual(at.y + window.height - RING_ROOM)
    // Moved only as far as the ring needs, and a ring already in view moves nothing.
    expect(at.x).toBe(Math.round(ring.x + RING_ROOM - window.width))
    const inside = { x: 300, y: 260 }
    expect(cropAt(panel, app, viewport, CROP_SCALE, undefined, 0, inside)).toEqual(cropAt(panel, app, viewport, CROP_SCALE))
  })
})

describe('a crop starts at 0.75x (M33 F2)', () => {
  it('plays a crop at 0.75x and anything wider at 1x, until the visitor picks', () => {
    expect(startingSpeed(undefined, true)).toBe(MOVIE_SPEED)
    expect(MOVIE_SPEED).toBe(0.75)
    expect(startingSpeed(undefined, false)).toBe(1)
  })

  it('a speed the visitor picked wins, on a phone or not', () => {
    expect(startingSpeed(1, true)).toBe(1)
    expect(startingSpeed(1.5, false)).toBe(1.5)
  })
})
