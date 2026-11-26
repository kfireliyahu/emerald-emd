import { useLayoutEffect, useReducer, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

import { useT } from '@/i18n/current.ts'
import { pageIsRtl } from '@/ui/direction.ts'
import { clampWidth, draggedWidth, keyedWidth, setPanelWidth, usePanelWidth, type PanelBounds, type PanelKind } from '@/ui/usePanelWidth.ts'

/**
 * **The handle on a side panel's inner edge** (M64 F69, D-644): drag it with the
 * mouse, or focus it and move it with ← and → (a separator that says its
 * width), and a double-click puts the panel back to its default width. It sits
 * on the panel's inline start, so in Hebrew the mirrored edge is the one that
 * drags. The width is remembered per kind of panel (`usePanelWidth.ts`).
 *
 * The panel draws itself at `--fc-panel-width` (`panelWidthStyle`); while the
 * mouse drags, the handle writes that property straight onto the panel, so a
 * move costs one layout and no render, and the width is kept once, on release.
 * **A dragged width never animates** (*A layout reshapes, a dragged width does
 * not*): the panel has no transition on its width, and the drag adds none.
 */
export function PanelEdge({
  kind,
  panel,
  fallback,
  bounds,
}: {
  readonly kind: PanelKind
  /** The panel this is the edge of: it must be positioned, so the handle can sit on its edge. */
  readonly panel: RefObject<HTMLElement | null>
  /** The panel's default width, for the value said before anything is dragged. */
  readonly fallback: number
  /** The floor and the ceiling now, given the panel (its room may be what the ceiling is a share of). */
  readonly bounds: (panel: HTMLElement | null) => PanelBounds
}) {
  const t = useT()
  const stored = usePanelWidth(kind)
  // The bounds are measured from the panel's room, which exists only once it is
  // drawn, and change with the window: measured again after the first paint and
  // on every resize, so the separator says the floor and the ceiling there are.
  const [, remeasure] = useReducer((n: number) => n + 1, 0)
  useLayoutEffect(() => {
    remeasure()
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [])
  const limits = bounds(panel.current)
  const now = clampWidth(stored ?? fallback, limits)

  const drag = (event: PointerEvent<HTMLDivElement>): void => {
    const element = panel.current
    if (event.button !== 0 || element === null) return
    event.preventDefault()
    const handle = event.currentTarget
    const start = Math.round(element.getBoundingClientRect().width)
    const from = event.clientX
    const rtl = pageIsRtl()
    const room = bounds(element)
    let width = start
    handle.setPointerCapture(event.pointerId)
    document.documentElement.classList.add('fc-resizing')
    const move = (next: globalThis.PointerEvent): void => {
      width = draggedWidth(start, next.clientX - from, rtl, room)
      element.style.setProperty('--fc-panel-width', `${String(width)}px`)
    }
    const done = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', done)
      handle.removeEventListener('pointercancel', done)
      document.documentElement.classList.remove('fc-resizing')
      // A press that moved nothing — half of a double-click — keeps nothing.
      if (width !== start) setPanelWidth(kind, width)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', done)
    handle.addEventListener('pointercancel', done)
  }

  const key = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyedWidth(now, event.key, pageIsRtl(), bounds(panel.current), event.shiftKey)
    if (next === undefined) return
    event.preventDefault()
    setPanelWidth(kind, next)
  }

  const reset = (): void => {
    panel.current?.style.removeProperty('--fc-panel-width')
    setPanelWidth(kind, undefined)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('chrome.kit.panelWidth')}
      aria-valuenow={now}
      aria-valuemin={limits.min}
      aria-valuemax={Math.max(limits.min, Math.round(limits.max))}
      aria-valuetext={t('chrome.kit.panelWidthValue', { width: String(now) })}
      title={t('chrome.kit.panelWidthTitle')}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={key}
      onDoubleClick={reset}
      className="fc-panel-edge"
    />
  )
}
