import { useEffect, useRef, type ReactNode } from 'react'

import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { PanelEdge } from '@/ui/components/PanelEdge.tsx'
import { panelWidthStyle, usePanelWidth, type PanelBounds } from '@/ui/usePanelWidth.ts'

/**
 * **Detail opens beside the page** (M64 U4, D-614 from A, D-615): a figure's
 * breakdown or a category's rows in a panel at the inline end, so the screen
 * it came from stays where it was. Wide enough (1360px and over) it is a
 * column of the page's own grid that grows its room; narrower, it floats over
 * the page with the one soft shadow (`.fc-side-panel`, tokens.css). The way
 * out is its Close or Esc (from inside a field, the first Esc leaves the
 * field), and focus goes back to what opened it. Opening
 * another panel replaces this one's content (*a panel replaced by another is
 * not a close*). A screen keeps what is open in its own state, so a panel can
 * stay open while the month it explains pages.
 *
 * **Its width is the reader's** (M64 F69, D-644): the inner edge is a handle
 * (`PanelEdge`) that drags, steps with the arrow keys and goes back to 420px on
 * a double-click; the width is remembered for every side panel, across
 * restarts, on this machine — between a floor where a form still works and a
 * ceiling of half the window, so the page behind it stays readable.
 */
export function SidePanel({
  kicker,
  title,
  onClose,
  children,
}: {
  /** What it is a detail of: the month. */
  readonly kicker?: string | undefined
  readonly title: ReactNode
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  const t = useT()
  const close = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const opener = useRef<Element | null>(null)
  const width = usePanelWidth('side')
  useEffect(() => {
    opener.current = document.activeElement
    close.current?.focus({ preventScroll: true })
    // **Focus goes back to what opened what is shown now** (M64 F2): a panel
    // replaced by another stays mounted, so the opener is the last thing
    // outside it that had the focus, not only the first.
    const outside = (event: FocusEvent): void => {
      if (event.target instanceof Element && panel.current !== null && !panel.current.contains(event.target)) opener.current = event.target
    }
    document.addEventListener('focusin', outside)
    return () => {
      document.removeEventListener('focusin', outside)
      const back = opener.current
      if (back instanceof HTMLElement && document.contains(back)) back.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      // **Esc in a field leaves the field first** (M64 F2), the way a desktop
      // app's does: the panel keeps what was typed and the focus, and the
      // next Esc closes it.
      const at = document.activeElement
      if (at instanceof HTMLElement && panel.current?.contains(at) === true && isField(at)) {
        panel.current.focus({ preventScroll: true })
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-labelledby="fc-side-panel-title"
      className="fc-side-panel fc-pop-enter outline-none"
      style={panelWidthStyle(width)}
    >
      <PanelEdge kind="side" panel={panel} fallback={SIDE_PANEL_WIDTH} bounds={sidePanelBounds} />
      {/* The body scrolls, not the panel, so the edge stays where it is while the rows scroll past. */}
      <div className="fc-side-panel-body">
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 id="fc-side-panel-title" className="m-0 text-heading">
              {title}
            </h2>
            {/* Under the title, never a label above it (D-614 dropped Home's eyebrow). */}
            {kicker !== undefined && (
              <span className="text-caption text-ink-secondary">
                <Bidi>{kicker}</Bidi>
              </span>
            )}
          </div>
          <button ref={close} type="button" onClick={onClose} aria-label={t('chrome.kit.close')} title={t('chrome.kit.closeTitle')} className="fc-icon-action">
            <ActionGlyph name="close" />
          </button>
        </header>
        <div className="mt-4 flex flex-col gap-4">{children}</div>
      </div>
    </aside>
  )
}

/** The width a side panel opens at before anything is dragged — `.fc-side-panel`'s default in tokens.css. */
const SIDE_PANEL_WIDTH = 420

const SIDE_PANEL_FLOOR = 360

/**
 * **The floor and the ceiling** (D-644): 360px, where a `PanelForm`'s fields,
 * its amounts and its two buttons still sit in one column without crowding;
 * and half the window, so the page the panel explains stays readable beside
 * it or behind it. tokens.css guards the same two (`min-width`, `max-width`)
 * for a window narrowed after the drag.
 */
function sidePanelBounds(): PanelBounds {
  const half = typeof window === 'undefined' ? SIDE_PANEL_WIDTH : Math.floor(window.innerWidth / 2)
  return { min: SIDE_PANEL_FLOOR, max: Math.max(SIDE_PANEL_FLOOR, half) }
}

/** Buttons and boxes are pressed, not typed in: Esc on one closes the panel. */
const PRESSED = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'])

/** A place text is typed or a value chosen in: where the first Esc only leaves it. */
function isField(element: HTMLElement): boolean {
  if (element.isContentEditable || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  return element instanceof HTMLInputElement && !PRESSED.has(element.type)
}
