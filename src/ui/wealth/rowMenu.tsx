import type { ReactNode } from 'react'

import type { MenuItem } from '@/ui/components/ContextMenu.tsx'
import { startEdge } from '@/ui/direction.ts'
import type { WealthWords } from '@/ui/wealth/words.ts'

/** A row's menu, open: where it opened, what it holds, and the thing it is about. */
export interface Menu {
  readonly at: { readonly x: number; readonly y: number }
  readonly items: readonly MenuItem[]
  readonly title: ReactNode
  readonly sub?: ReactNode
}

/**
 * **A removal that cannot be undone asks where it was asked** (M64 U10, D-617,
 * D-622): Wealth's Delete is a row's menu item, and deleting a fund, a goal or
 * a debt also unaims Plan's buckets and unlinks deduction types, so there is no
 * honest Undo to offer. The question is the same menu again, at the same
 * point — the thing named, what it costs, *Delete* and *Keep it* — never a bar
 * under the table.
 */
export function removeQuestion(at: Menu['at'], question: string, cost: string, words: WealthWords, onDelete: () => void): Menu {
  return {
    at,
    title: question,
    sub: cost,
    items: [
      { label: words.t('wealth.common.delete'), icon: 'trash', onChoose: onDelete },
      { label: words.t('wealth.common.keep'), onChoose: () => undefined },
    ],
  }
}

/** A row's *More*: the three dots that open its one menu, under the button's start edge. */
export function MoreButton({ label, onMenu }: { readonly label: string; readonly onMenu: (at: { x: number; y: number }) => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onMenu(startEdge(event.currentTarget.getBoundingClientRect()))
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="fc-icon-action"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
        <circle cx="3.5" cy="8" r="1.2" />
        <circle cx="8" cy="8" r="1.2" />
        <circle cx="12.5" cy="8" r="1.2" />
      </svg>
    </button>
  )
}
