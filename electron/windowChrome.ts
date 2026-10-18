/**
 * The shape of a window that draws its own title bar (D-130, M9.5).
 *
 * The frame is one decision made in two places: `main.ts` configures the
 * window, and the renderer lays a title bar out inside it. Those two have to
 * agree to the pixel — a bar shorter than the OS's caption buttons clips them,
 * and a bar that starts left of macOS's traffic lights puts the document name
 * underneath them. So the numbers live here, once, and both sides read them.
 *
 * Pure and platform-parameterised, so the agreement is testable in Node rather
 * than discovered by opening the app on the other operating system.
 *
 * Two mechanisms, because the platforms do not offer one:
 *
 * - **macOS** hides the title bar and keeps the traffic lights, positioned by
 *   `trafficLightPosition`. The app leaves room at the inline start.
 * - **Windows and Linux** get a *Window Controls Overlay*: Chromium draws the
 *   caption buttons at the inline end, in colours we hand it, and the page owns
 *   everything to their left. The app leaves room at the inline end — and,
 *   because that width is Chromium's rather than ours, the renderer prefers the
 *   live `titlebar-area` geometry and falls back to `insetEnd` here.
 */

import type { WindowChrome } from './bridge.ts'

/**
 * The bar the app draws, in CSS pixels.
 *
 * Deliberately taller than either platform's own title bar: it carries the
 * document name, the dirty state and the save controls (D-021 makes those
 * permanent context, not a menu), and a 28px strip cannot hold a button.
 */
export const TITLE_BAR_HEIGHT = 40

/** Diameter of a macOS traffic light, and the gap between two of them. */
const TRAFFIC_LIGHT_SIZE = 12
const TRAFFIC_LIGHT_GAP = 8

/** Left of the first traffic light, and right of the last one. */
const TRAFFIC_LIGHT_MARGIN = 14

/**
 * Chromium's caption buttons on Windows at 100% scaling. Only a fallback: the
 * renderer reads `navigator.windowControlsOverlay` when it is there, which is
 * the same number measured rather than assumed.
 */
const CAPTION_BUTTONS_WIDTH = 138

/** True where Chromium draws the caption buttons over the page. */
export function usesControlsOverlay(platform: string): boolean {
  return platform !== 'darwin'
}

export function windowChrome(platform: string): WindowChrome {
  const overlay = usesControlsOverlay(platform)
  return {
    frameless: true,
    height: TITLE_BAR_HEIGHT,
    insetStart: overlay ? 0 : trafficLightsWidth(),
    insetEnd: overlay ? CAPTION_BUTTONS_WIDTH : 0,
  }
}

/** Where the three lights sit, so they are centred in a bar of our height. */
export function trafficLightPosition(): { x: number; y: number } {
  return { x: TRAFFIC_LIGHT_MARGIN, y: Math.round((TITLE_BAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2) }
}

function trafficLightsWidth(): number {
  const lights = TRAFFIC_LIGHT_SIZE * 3 + TRAFFIC_LIGHT_GAP * 2
  return TRAFFIC_LIGHT_MARGIN * 2 + lights
}

/**
 * The caption buttons are painted by Chromium, not by CSS, so the theme has to
 * be handed over as literal colours. These are `surface` and `ink` from
 * `src/ui/theme/tokens.css` — the plane the title bar is drawn on, so the
 * buttons sit *in* the bar rather than on a rectangle of their own.
 *
 * Duplicating two hex values across the process boundary is the cost of the
 * platform drawing them; the test below is what notices when the tokens move.
 */
export function titleBarOverlay(theme: 'light' | 'dark'): {
  color: string
  symbolColor: string
  height: number
} {
  return theme === 'dark'
    ? { color: '#151517', symbolColor: '#f2f2f0', height: TITLE_BAR_HEIGHT }
    : { color: '#f7f7f6', symbolColor: '#111111', height: TITLE_BAR_HEIGHT }
}
