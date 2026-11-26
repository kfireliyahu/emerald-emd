import type { CSSProperties } from 'react'

import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import { createStore, type Store } from '@/state/store.ts'

/**
 * **A side panel's width is the reader's to drag** (M64 F69, D-644). The
 * maintainer, 2026-11-26: *"i wanna make the sidebars that opened able to
 * change width by the user to read easily."* So a panel's inner edge is a
 * handle (`PanelEdge`), and the width it is dragged to is remembered across
 * restarts — a preference of this copy of the app, like the theme and the
 * sidebar (D-115, D-130), never a fact kept in the document.
 *
 * **One width per kind of panel, not one per panel**: every `SidePanel` opens at
 * the width the last one was dragged to, and the wealth lists' pane (a fund, a
 * goal, a debt) at its own — the reader sets how wide they like to read once,
 * not again for every figure they open. Nothing stored is the panel's own
 * default, and a double-click on the edge forgets the width again.
 */

/** The panels that keep a width: the kit's `SidePanel`, and `ListDetail`'s pane. */
export type PanelKind = 'side' | 'pane'

/** What an arrow key moves the edge by: two steps of the 8px scale. */
export const PANEL_STEP = 16
/** What Shift and an arrow move it by. */
export const PANEL_BIG_STEP = 64

/** The narrowest and widest a panel may be dragged, in CSS pixels, at the moment. */
export interface PanelBounds {
  readonly min: number
  readonly max: number
}

const key = (kind: PanelKind): string => `fc-panel-width.${kind}`

function read(kind: PanelKind): number | undefined {
  const raw = readPreference(key(kind))
  const width = raw === undefined ? Number.NaN : Number(raw)
  // Nothing stored, or something that is not a width: the panel's default.
  return Number.isFinite(width) && width > 0 ? Math.round(width) : undefined
}

const stores = new Map<PanelKind, Store<number | undefined>>()

function store(kind: PanelKind): Store<number | undefined> {
  let found = stores.get(kind)
  if (found === undefined) {
    found = createStore(read(kind))
    stores.set(kind, found)
  }
  return found
}

/** The width a kind of panel was dragged to, or `undefined` for its default. */
export function panelWidth(kind: PanelKind): number | undefined {
  return store(kind).get()
}

/** Remember a dragged width, or forget it with `undefined` (back to the default). */
export function setPanelWidth(kind: PanelKind, width: number | undefined): void {
  const next = width === undefined ? undefined : Math.round(width)
  writePreference(key(kind), next === undefined ? undefined : String(next))
  store(kind).set(next)
}

/** The dragged width in a component, which draws again when it changes. */
export function usePanelWidth(kind: PanelKind): number | undefined {
  return store(kind).use()
}

/**
 * The panel's `style`: the dragged width as `--fc-panel-width`, which its CSS
 * reads with its default beside it — so nothing stored leaves the default, and
 * the floor and ceiling stay the stylesheet's guards when the window narrows.
 */
export function panelWidthStyle(width: number | undefined): CSSProperties | undefined {
  return width === undefined ? undefined : ({ '--fc-panel-width': `${String(width)}px` } as CSSProperties)
}

/** A width held between the floor and the ceiling; the floor wins when the window is too narrow for both. */
export function clampWidth(width: number, bounds: PanelBounds): number {
  return Math.round(Math.max(bounds.min, Math.min(width, bounds.max)))
}

/**
 * The width after the edge was dragged `dx` pixels across the screen. The edge
 * is the panel's inline start, the side facing the page, so dragging toward the
 * page widens it: leftward in English, rightward in Hebrew, where it is mirrored.
 */
export function draggedWidth(start: number, dx: number, rtl: boolean, bounds: PanelBounds): number {
  return clampWidth(start + (rtl ? dx : -dx), bounds)
}

/**
 * The width after a key on the focused edge, or `undefined` for a key it does
 * not take. ← and → move the edge the way they point — so ← widens in English
 * and narrows in Hebrew, where the panel is on the left — Shift moves it
 * further, and Home and End take it to the narrowest and the widest.
 */
export function keyedWidth(now: number, pressed: string, rtl: boolean, bounds: PanelBounds, big = false): number | undefined {
  if (pressed === 'Home') return clampWidth(bounds.min, bounds)
  if (pressed === 'End') return clampWidth(bounds.max, bounds)
  const physical = pressed === 'ArrowRight' ? 1 : pressed === 'ArrowLeft' ? -1 : 0
  if (physical === 0) return undefined
  const step = big ? PANEL_BIG_STEP : PANEL_STEP
  return draggedWidth(now, physical * step, rtl, bounds)
}
