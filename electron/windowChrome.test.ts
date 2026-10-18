import { describe, expect, it } from 'vitest'

import {
  TITLE_BAR_HEIGHT,
  titleBarOverlay,
  trafficLightPosition,
  usesControlsOverlay,
  windowChrome,
} from './windowChrome.ts'

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
   * tokens move and the buttons stay behind.
   */
  it('paints the caption buttons in the same plane the bar is drawn on', () => {
    expect(titleBarOverlay('light')).toMatchObject({ color: '#f7f7f6', symbolColor: '#111111' })
    expect(titleBarOverlay('dark')).toMatchObject({ color: '#151517', symbolColor: '#f2f2f0' })
  })
})
