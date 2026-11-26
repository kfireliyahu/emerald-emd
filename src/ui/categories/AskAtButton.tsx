import { useRef, useState, type ReactNode } from 'react'

import { type ActionGlyphName } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'

/**
 * **A question that cannot be undone, asked at the button that asked it**
 * (M64 U11, D-617): Categories' Merge into… and a Delete of a category still in
 * use, each of which moves rows for good. The question is a popover anchored to
 * its button, naming the thing — *Merge Groceries into…* — with the one choice
 * it needs (where the rows go) and its verb, never a bar at the foot of the
 * screen. `ConfirmAtButton` is the same idea for a yes or no; this one carries
 * a choice. Esc or a press outside cancels and focus goes back to the button.
 */
export function AskAtButton({
  label,
  icon,
  startOpen = false,
  question,
  children,
  confirm,
  cancel,
  canConfirm,
  onConfirm,
}: {
  readonly label: string
  readonly icon: ActionGlyphName
  /** Opened from elsewhere — the row's menu — rather than by its button. */
  readonly startOpen?: boolean
  readonly question: ReactNode
  /** The choice the question needs. */
  readonly children?: ReactNode
  readonly confirm: string
  readonly cancel: string
  readonly canConfirm: boolean
  readonly onConfirm: () => void
}) {
  const [open, setOpen] = useState(startOpen)
  const box = useRef<HTMLSpanElement>(null)
  const close = (): void => {
    setOpen(false)
    box.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }
  const dismissKey = useDismiss(open, box, close)

  return (
    <span ref={box} className="relative inline-flex" onKeyDown={dismissKey}>
      <Button variant="secondary" size="sm" icon={icon} onClick={() => setOpen((was) => !was)} aria-expanded={open}>
        {label}
      </Button>
      {open && (
        <span
          role="dialog"
          aria-label={label}
          className="fc-pop-enter absolute start-0 top-full z-40 mt-1 flex w-72 flex-col gap-3 border border-hairline bg-elevated p-3 text-start shadow-pop"
        >
          <span className="font-medium">{question}</span>
          {children}
          <span className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!canConfirm}
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              {confirm}
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              {cancel}
            </Button>
          </span>
        </span>
      )}
    </span>
  )
}
