import { useEffect, useRef, type ReactNode } from 'react'

import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'

/**
 * **Detail opens beside the page** (M64 U4, D-614 from A, D-615): a figure's
 * breakdown or a category's rows in a panel at the inline end, so the screen
 * it came from stays where it was. Wide enough (1360px and over) it is a
 * column of the page's own grid that grows its room; narrower, it floats over
 * the page with the one soft shadow (`.fc-side-panel`, tokens.css). The way
 * out is its Close or Esc, and focus goes back to what opened it. Opening
 * another panel replaces this one's content (*a panel replaced by another is
 * not a close*). A screen keeps what is open in its own state, so a panel can
 * stay open while the month it explains pages.
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
  const opener = useRef<Element | null>(null)
  useEffect(() => {
    opener.current = document.activeElement
    close.current?.focus({ preventScroll: true })
    return () => {
      const back = opener.current
      if (back instanceof HTMLElement && document.contains(back)) back.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <aside aria-labelledby="fc-side-panel-title" className="fc-side-panel fc-pop-enter">
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
    </aside>
  )
}
