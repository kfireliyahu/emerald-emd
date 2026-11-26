import { afterEach, describe, expect, it, vi } from 'vitest'

import { clampWidth, draggedWidth, keyedWidth, PANEL_BIG_STEP, PANEL_STEP, panelWidth, panelWidthStyle, setPanelWidth } from './usePanelWidth.ts'

/**
 * **A side panel's width is the reader's to drag** (M64 F69, D-644): the edge
 * widens toward the page, mirrored in Hebrew; the arrows move it the way they
 * point; it stays between the floor and the ceiling; and the width is a
 * preference of the machine, remembered, and forgotten by a double-click.
 */

const bounds = { min: 360, max: 800 }

describe('the panel edge', () => {
  it('widens toward the page: leftward in English, rightward in Hebrew', () => {
    expect(draggedWidth(420, -100, false, bounds)).toBe(520)
    expect(draggedWidth(420, 100, false, bounds)).toBe(360)
    expect(draggedWidth(420, 100, true, bounds)).toBe(520)
    expect(draggedWidth(420, -40, true, bounds)).toBe(380)
  })

  it('stops at the floor and the ceiling, and the floor wins in a window too narrow for both', () => {
    expect(draggedWidth(420, -1000, false, bounds)).toBe(800)
    expect(draggedWidth(420, 1000, false, bounds)).toBe(360)
    expect(clampWidth(500, { min: 360, max: 300 })).toBe(360)
  })

  it('moves with the arrows the way they point, further with Shift, and to either end with Home and End', () => {
    expect(keyedWidth(420, 'ArrowLeft', false, bounds)).toBe(420 + PANEL_STEP)
    expect(keyedWidth(420, 'ArrowRight', false, bounds)).toBe(420 - PANEL_STEP)
    // In Hebrew the panel is on the left, so ← takes its edge away from the page.
    expect(keyedWidth(420, 'ArrowLeft', true, bounds)).toBe(420 - PANEL_STEP)
    expect(keyedWidth(420, 'ArrowRight', true, bounds)).toBe(420 + PANEL_STEP)
    expect(keyedWidth(420, 'ArrowLeft', false, bounds, true)).toBe(420 + PANEL_BIG_STEP)
    expect(keyedWidth(420, 'Home', false, bounds)).toBe(360)
    expect(keyedWidth(420, 'End', true, bounds)).toBe(800)
    expect(keyedWidth(420, 'ArrowUp', false, bounds)).toBeUndefined()
    expect(keyedWidth(420, 'Enter', false, bounds)).toBeUndefined()
  })
})

describe('the remembered width', () => {
  afterEach(() => {
    setPanelWidth('side', undefined)
    vi.unstubAllGlobals()
  })

  it('is kept on the machine per kind of panel, and a reset forgets it', () => {
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => kept.set(key, value),
      removeItem: (key: string) => kept.delete(key),
    })
    expect(panelWidth('side')).toBeUndefined()
    setPanelWidth('side', 612.4)
    expect(panelWidth('side')).toBe(612)
    expect(kept.get('fc-panel-width.side')).toBe('612')
    // The wealth lists' pane keeps a width of its own.
    expect(panelWidth('pane')).toBeUndefined()
    setPanelWidth('side', undefined)
    expect(panelWidth('side')).toBeUndefined()
    expect(kept.has('fc-panel-width.side')).toBe(false)
  })

  it('still applies for the session where there is nowhere to keep it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    setPanelWidth('side', 500)
    expect(panelWidth('side')).toBe(500)
  })

  it('reaches the panel as a custom property, so nothing stored leaves the stylesheet’s default', () => {
    expect(panelWidthStyle(undefined)).toBeUndefined()
    expect(panelWidthStyle(480)).toEqual({ '--fc-panel-width': '480px' })
  })
})
