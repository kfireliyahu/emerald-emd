import { useRef, useState, type ReactNode } from 'react'

import { Button } from './Button.tsx'
import { useDismiss } from './useDismiss.ts'

/**
 * **Filter, one button** — M59 U6 (D-582, the pick D-577 settled; *Filter* is a
 * term row). Transactions and By merchant kept a row of filters always in
 * sight — an account, a category, two amounts — before the first row, for a
 * person who had not yet read one statement. They sit behind this now, and the
 * button says how many are on (*Filter · 2*), so a narrowed list is never
 * mistaken for the whole one. It opens under itself and closes as every
 * popover does (`useDismiss`).
 */
export function FilterButton({
  on,
  label = 'Filter',
  align = 'start',
  children,
}: {
  /** How many filters are set; shown on the button when any is. */
  readonly on: number
  readonly label?: string
  /** Which edge of the button the popover lines up with: its start beside search, its end at a header's end. */
  readonly align?: 'start' | 'end'
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const onKeyDown = useDismiss(open, box, () => setOpen(false))
  return (
    <div ref={box} className="relative" onKeyDown={onKeyDown}>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className={on > 0 ? 'text-ink' : ''}
      >
        <span className="tabular-nums">{on > 0 ? `${label} · ${String(on)}` : label}</span>
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`fc-pop-enter absolute top-full ${align === 'end' ? 'right-0' : 'left-0'} z-40 mt-1 flex w-72 flex-col gap-3 border border-hairline bg-elevated p-4 shadow-pop`}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** One filter in the popover: its name over its control. */
export function FilterRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="fc-label text-ink-secondary uppercase">{label}</span>
      {children}
    </div>
  )
}
