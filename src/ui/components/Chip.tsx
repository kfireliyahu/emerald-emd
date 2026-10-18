import type { ReactNode } from 'react'

/**
 * Metadata beside a name: text with a small dot, no pill and no border.
 *
 * docs/11 is specific about this. A filled badge competes with the row it
 * annotates, and a screen with four of them reads as a dashboard. Colour is
 * reserved for a problem — one thing per screen worth acting on, and it is the
 * only thing wearing red.
 *
 * Promoted here on the third copy (the mappings screen, the accounts screen),
 * which is where the first two had started to drift.
 */
export function Chip({ children, problem = false }: { children: ReactNode; problem?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 text-caption ${
        problem ? 'text-negative' : 'text-ink-tertiary'
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${problem ? 'bg-negative' : 'bg-ink-tertiary'}`}
      />
      {children}
    </span>
  )
}
