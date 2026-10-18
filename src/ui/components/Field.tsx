import type { ReactNode } from 'react'

import { Bidi } from '@/ui/Bidi.tsx'

/**
 * A labelled input in one of the money editors — debts, payments, goals,
 * funds, fund snapshots, deposits, payslips and fixed expenses (M45 F1), and a
 * format's column questions (M45 F2): the label above, the field, and a hint
 * under it when there is one.
 *
 * The label is isolated with `Bidi` always, which five of the nine copies this
 * replaced forgot: a label can carry a name that came out of a document. So is
 * the hint (M45 F2), which the first cut printed raw while the fixed-expense
 * editor passed a merchant through it.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label text-ink-tertiary uppercase">
        <Bidi>{label}</Bidi>
      </span>
      {children}
      {hint !== undefined && hint !== null && hint !== '' && (
        <span className="text-caption text-ink-tertiary">
          <Bidi>{hint}</Bidi>
        </span>
      )}
    </label>
  )
}
