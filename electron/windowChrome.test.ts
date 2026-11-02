import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  TITLE_BAR_HEIGHT,
  titleBarOverlay,
  trafficLightPosition,
  usesControlsOverlay,
  windowBackground,
  windowChrome,
} from './windowChrome.ts'

/**
 * A colour token as `tokens.css` declares it: the first declaration is the
 * light theme's, and the one in the `:root[data-theme="dark"]` block that
 * declares it is the dark theme's.
 */
function token(name: string, theme: 'light' | 'dark'): string {
  const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'theme', 'tokens.css'), 'utf8')
  const declaration = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i')
  if (theme === 'light') return css.match(declaration)?.[1]?.toLowerCase() ?? 'missing'
  for (const block of css.split(':root[data-theme="dark"]').slice(1)) {
    const found = block.slice(0, block.indexOf('}')).match(declaration)?.[1]
    if (found !== undefined) return found.toLowerCase()
  }
  return 'missing'
}

/**
 * The frame is one agreement held in two processes (D-130): `main.ts` builds
 * the window from these numbers and the renderer lays its title bar out
 * against the same ones. What is worth testing is not arithmetic — it is that
 * neither side can end up drawing over the platform's own buttons.
 */

describe('the window chrome', () => {
  it('leaves room at the start on macOS and at the end everywhere else', () => {
    const mac = windowChrome('darwin')
    expect(mac.insetStart).toBeGreaterThan(0)
    expect(mac.insetEnd).toBe(0)

    for (const platform of ['win32', 'linux']) {
      const other = windowChrome(platform)
      expect(other.insetStart).toBe(0)
      expect(other.insetEnd).toBeGreaterThan(0)
    }
  })

  it('reserves the same height the bar is drawn at, on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(windowChrome(platform).height).toBe(TITLE_BAR_HEIGHT)
      expect(windowChrome(platform).frameless).toBe(true)
    }
    expect(titleBarOverlay('light').height).toBe(TITLE_BAR_HEIGHT)
    expect(titleBarOverlay('dark').height).toBe(TITLE_BAR_HEIGHT)
  })

  it('only claims an overlay where Chromium draws one', () => {
    expect(usesControlsOverlay('darwin')).toBe(false)
    expect(usesControlsOverlay('win32')).toBe(true)
    expect(usesControlsOverlay('linux')).toBe(true)
  })

  it('keeps the traffic lights inside the bar rather than above it', () => {
    const { x, y } = trafficLightPosition()
    expect(x).toBeGreaterThan(0)
    expect(y).toBeGreaterThan(0)
    // The lights are 12px tall; both edges have to clear the bar.
    expect(y + 12).toBeLessThanOrEqual(TITLE_BAR_HEIGHT)
    // Centred, so the bar can grow without the lights sliding to one edge.
    expect(y).toBe(TITLE_BAR_HEIGHT - 12 - y)
  })

  it('leaves the traffic lights room to their right, not just their left', () => {
    // Otherwise the document name starts on top of the close button.
    expect(windowChrome('darwin').insetStart).toBeGreaterThan(trafficLightPosition().x + 12 * 3)
  })

  /**
   * The caption buttons are painted by Chromium from literal colours, so these
   * two hexes are a copy of `--color-surface` and `--color-ink` living on the
   * other side of the process boundary. Nothing but a test notices when the
   * tokens move and the buttons stay behind — so it reads the tokens (M54 F7).
   */
  it('paints the caption buttons in the same plane the bar is drawn on', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(titleBarOverlay(theme)).toMatchObject({ color: token('surface', theme), symbolColor: token('ink', theme) })
    }
  })

  /** The first paint, and Help's text windows (M54 F7): the page's background, read from the tokens. */
  it('shows the page background before the page paints', () => {
    for (const theme of ['light', 'dark'] as const) expect(windowBackground(theme)).toBe(token('background', theme))
  })
})
