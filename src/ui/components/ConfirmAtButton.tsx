import { useRef, useState, type ReactNode } from 'react'

import { Button } from '@/ui/components/Button.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'

/**
 * **A delete that cannot be undone asks at the button that asked** (M64 U7,
 * D-619, after D-617's addition): the question is a popover anchored to the
 * icon, naming the thing — *Delete Everyday card?* — never a bar at the foot of
 * the screen. Where an undo can be offered, a screen deletes at once and says
 * *Removed · Undo* instead, and this is not used.
 *
 * Delete has the focus when it opens, so Enter confirms; Esc or a press
 * outside cancels (`useDismiss`), and focus goes back to the icon. The words
 * are the caller's, from its own catalogue.
 */
export function ConfirmAtButton({
  label,
  question,
  cost,
  confirm,
  cancel,
  onConfirm,
}: {
  /** The icon's name: `Delete Everyday card`. */
  readonly label: string
  /** The question, naming the thing: `Delete Everyday card?` */
  readonly question: ReactNode
  /** What it costs, in one sentence. */
  readonly cost?: string | undefined
  readonly confirm: string
  readonly cancel: string
  readonly onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const close = (): void => {
    setOpen(false)
    box.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }
  const dismissKey = useDismiss(open, box, close)

  return (
    <span ref={box} className="relative inline-flex" onKeyDown={dismissKey}>
      <IconAction label={label} tone="negative" onClick={() => setOpen((was) => !was)}>
        <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
      </IconAction>
      {open && (
        <span
          role="alertdialog"
          aria-label={label}
          className="fc-pop-enter absolute end-0 top-full z-40 mt-1 flex w-72 flex-col gap-2 border border-hairline bg-elevated p-3 text-start shadow-pop"
        >
          <span className="font-medium">{question}</span>
          {cost !== undefined && <span className="text-caption text-ink-secondary">{cost}</span>}
          <span className="mt-1 flex items-center gap-2">
            <Button autoFocus variant="secondary" size="sm" onClick={() => { setOpen(false); onConfirm() }}>
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
