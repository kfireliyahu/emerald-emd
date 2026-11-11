import { useRef, useState } from 'react'

import { useDismiss } from '@/ui/components/useDismiss.ts'

/** What the format's + makes. */
export type PlusPick = 'input' | 'view' | 'chart'

/**
 * **The format's +** — M55 U3, D-535 (U1's brief §6): one place to make a
 * format's views, at the end of its tab strip after the rollups and before
 * Dashboard's hairline. Its menu: *New input view* — only where a row can be
 * written — then *New view* and *New chart*, the forms Add a block has
 * (D-525), saved without placing a block.
 */
export function FormatPlus({ input, onPick }: { readonly input: boolean; readonly onPick: (pick: PlusPick) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const dismissKey = useDismiss(open, box, () => setOpen(false))
  const items: readonly { readonly pick: PlusPick; readonly label: string }[] = [
    ...(input ? [{ pick: 'input' as const, label: 'New input view' }] : []),
    { pick: 'view', label: 'New view' },
    { pick: 'chart', label: 'New chart' },
  ]
  return (
    <span ref={box} className="relative inline-flex shrink-0 items-center" onKeyDown={dismissKey}>
      <button
        type="button"
        aria-label="New view of this format"
        title="New view of this format"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`fc-icon-action ${open ? 'bg-surface text-ink' : ''}`}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="New"
          className="fc-pop-enter absolute top-full start-0 z-30 mt-1 flex w-48 flex-col border border-hairline-strong bg-elevated py-1 shadow-[var(--shadow-pop)]"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            const all = [...(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))]
            const at = all.indexOf(document.activeElement as HTMLElement)
            all[(at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus()
          }}
        >
          {items.map((item, at) => (
            <button
              key={item.pick}
              type="button"
              role="menuitem"
              autoFocus={at === 0}
              onClick={() => {
                setOpen(false)
                onPick(item.pick)
              }}
              className="flex h-8 items-center px-3 text-start text-body text-ink hover:bg-surface focus-visible:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
