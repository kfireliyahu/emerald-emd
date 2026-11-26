import { abs, formatMoney, type Money } from '@/core/money.ts'
import { useT } from '@/i18n/current.ts'
import { Said } from '@/ui/components/PanelForm.tsx'

/**
 * **Whether the slip adds up, said in words as it is typed** — F04's live
 * `gross − Σ(net-reducing lines) − net`, which was a strip pinned to the foot
 * of a page and is now the form's `Said` sentence under the figures it reads
 * (M64 F14, D-630; the maintainer: "the reconciliation said in words as you
 * type").
 *
 * It is the one sentence that tells the user the app has understood their
 * payslip, and it is **never a blocker**: Save stays enabled beside it at any
 * value — a real slip contains items nobody wants to itemize, and an app that
 * refuses the slip is an app arguing with the payroll department. So it is a
 * sentence in `ink-secondary` and no colour: a gap is said, not flagged
 * (*Figures are ink*; the problems that do stop a save are `PanelForm`'s).
 * Over, the gap is said as a magnitude: "−₪100 more than" reads as two minus
 * signs for one fact.
 */
export function ReconciliationSaid({
  delta,
  grossToNet,
  itemized,
  idle,
  lines,
  onAddDifference,
}: {
  delta: Money
  /** `gross − net`: the difference the slip itself asks to have explained. */
  grossToNet: Money
  /** What the lines currently account for. Named so the two can be compared on sight. */
  itemized: Money
  /** Nothing has been typed yet. "Adds up" over an empty form is a lie. */
  idle: boolean
  /** How many lines the slip has: with none, the gap is the slip not itemized, not a mistake. */
  lines: number
  /**
   * Fills the gap with one "Other deduction" line. Absent when there is no
   * "Other deduction" type in the document to write it against.
   */
  onAddDifference: (() => void) | undefined
}) {
  const t = useT()
  if (idle) return <Said>{t('paychecks.entry.saidIdle')}</Said>
  const between = formatMoney(grossToNet)
  if (delta.minor === 0) return <Said>{t('paychecks.entry.saidExact', { between })}</Said>
  if (lines === 0) return <Said>{t('paychecks.entry.saidNoLines', { between })}</Said>
  if (delta.minor < 0) return <Said>{t('paychecks.entry.saidOver', { gap: formatMoney(abs(delta)), between })}</Said>
  return (
    <Said>
      {t('paychecks.entry.saidUnder', { gap: formatMoney(delta), between, itemized: formatMoney(itemized) })}
      {onAddDifference !== undefined && (
        <>
          {' '}
          <button type="button" className="fc-text-action" onClick={onAddDifference}>
            {t('paychecks.entry.addDifference', { gap: formatMoney(delta) })}
          </button>
        </>
      )}
    </Said>
  )
}
