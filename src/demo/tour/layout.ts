/**
 * **How the app is laid out inside the frame** (M33 U3), from the frame's own
 * width and the height left under the strip — kept out of `Frame.tsx` so a test
 * can hold it, and so the check lays the app out the way a visitor gets it.
 *
 * **Down to `MOVIE_BELOW`, one rule**: the app is laid out at least
 * `LAYOUT_LEAST` wide — and the paper beside it on top of that, while it
 * shows — and both are drawn scaled to fit when the frame is narrower. The
 * height follows the same scale, so the app always fills what the strip
 * leaves, whatever the embed's height.
 *
 * **Below it, a crop** (M33 F1, D-415): a movie — watched, never taken over
 * (P6) — that no longer draws the whole app shrunk, which at 375 was a third of
 * its size and unreadable (2026-10-07). The app is still laid out
 * at desktop width and height, and the frame shows a window of it at
 * `CROP_SCALE` around where the action is (`cropAt`), panning between steps.
 */

/**
 * The narrowest the app is laid out at; narrower frames draw it scaled.
 * Measured (M33 F1): the receipt's sheet is 904 px of fixed columns — the row
 * number, the four the tour declares, `holds`, the row icons and the `+` — and
 * the app beside it is the **200 px** sidebar, expanded because the tour clicks
 * a format under Formats, plus the 10 px scrollbar of the screen. U3 had 960,
 * from a 56 px rail the demo never shows: the sheet scrolled sideways in a
 * 760 screen, the `+` and the row icons sat off its edge, and opening the row
 * scrolled the shop column away while the band over the sheet wrapped its
 * button onto a second line (the overlaps found on 2026-10-07).
 */
export const LAYOUT_LEAST = 1120

/**
 * P6: below this frame width, a movie, drawn as a crop. 690 rather than U2's
 * 720, so a 768-wide tablet with a margin either side (a 719 frame on the host
 * page) can still take it over.
 */
export const MOVIE_BELOW = 690

/**
 * The picture beside the app (a receipt being typed in), in the app's own
 * pixels: the app gives up this much width while it shows, so the sheet and the
 * paper sit side by side and neither covers the other. In a crop it is a small
 * card in the corner instead (`frame.css`), since the window is on the sheet.
 */
export const BESIDE_WIDTH = 260

/**
 * The crop's scale: the app's 13 px text at 9.75 px, which a phone reads, and a
 * window 497 app pixels wide in the host page's 375 column — wide enough for
 * what a charge's row holds, its date, merchant and amount (466 px of text),
 * which is the first thing the tour outlines. At 0.8 the amount was cut.
 */
export const CROP_SCALE = 0.75

/** How tall the app is laid out in a crop: a laptop's window, so it lays out as on one. */
export const CROP_HEIGHT = 720

/** What a crop keeps between a box too big for the window and the window's edge, in app pixels. */
export const CROP_MARGIN = 16

/** How far inside the window's edge a crop keeps the ring's centre, in app pixels: the whole ring and a margin. */
export const RING_ROOM = 2 * CROP_MARGIN

export interface AppLayout {
  /** Drawn size over laid-out size; 1 at or above `LAYOUT_LEAST`. */
  readonly scale: number
  /** Watched, never taken over (P6) — and drawn as a crop. */
  readonly movie: boolean
  /** The app iframe's own width and height, before it is scaled. */
  readonly width: number
  readonly height: number
  /** The picture's drawn width, or 0 when there is none or it is a card in a crop's corner. */
  readonly beside: number
}

export function layoutOf(frameWidth: number, viewportHeight: number, beside: boolean): AppLayout {
  const width = Math.max(1, frameWidth)
  if (width < MOVIE_BELOW) {
    return {
      scale: CROP_SCALE,
      movie: true,
      width: LAYOUT_LEAST,
      height: Math.round(Math.max(CROP_HEIGHT, Math.max(0, viewportHeight) / CROP_SCALE)),
      beside: 0,
    }
  }
  const scale = Math.min(1, width / (LAYOUT_LEAST + (beside ? BESIDE_WIDTH : 0)))
  const laidOut = width / scale
  return {
    scale,
    movie: false,
    width: Math.round(laidOut - (beside ? BESIDE_WIDTH : 0)),
    height: Math.round(Math.max(0, viewportHeight) / scale),
    beside: beside ? Math.round(BESIDE_WIDTH * scale) : 0,
  }
}

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Area {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * **Where a crop's window sits on the app** (M33 F1): its top-left corner, in
 * the app's own pixels. The window is the viewport's size over `scale`; the box
 * the eye should be on is centred in it, or, when it is wider or taller than the
 * window (a whole sheet row), its start is kept in view a margin from the edge,
 * so a row is read from its first cell. Never past the app's own edges, except
 * under what holds the window's right: `held` is viewport pixels there that
 * something covers (the paper's card), the box is placed in what is left, and
 * the app's right edge may come to the card's edge so a box at it is not under
 * the card (M33 F4). With no box it stays where it was.
 *
 * **The ring wins** (M33 F4): `ring` is where the ring is going, and the window
 * moves as little as it takes to hold it `RING_ROOM` inside its edge. An
 * outline was held while the ring went on to the next click — the ledger
 * tour's Write button, right of and under the panel it outlines — and a window
 * kept on the outline alone left the ring off the phone
 * (2026-10-07). A row that acts lets go of the outline now (M33 F6); the ring
 * still wins wherever both are on screen.
 */
export function cropAt(
  box: Area | undefined,
  app: Size,
  viewport: Size,
  scale: number,
  was: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
  held = 0,
  ring?: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  if (box === undefined || (box.width === 0 && box.height === 0)) return was
  const window = { width: viewport.width / scale, height: viewport.height / scale }
  const open = Math.max(1, window.width - held / scale)
  const along = (start: number, size: number, room: number, whole: number, point?: number): number => {
    let at = size + 2 * CROP_MARGIN > room ? start - CROP_MARGIN : start + size / 2 - room / 2
    if (point !== undefined) at = Math.min(Math.max(at, point + RING_ROOM - room), point - RING_ROOM)
    return Math.round(Math.min(Math.max(0, at), Math.max(0, whole - room)))
  }
  return {
    x: along(box.left, box.width, open, app.width, ring?.x),
    y: along(box.top, box.height, window.height, app.height, ring?.y),
  }
}
