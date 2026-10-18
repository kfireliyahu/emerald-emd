import { abs, formatMoney, type Money } from '@/core/money.ts'
import { Button } from '@/ui/components/Button.tsx'

/**
 * The reconciliation strip — F04's live `gross − Σ(net-reducing lines) − net`,
 * pinned to the foot of the entry form.
 *
 * It is the one number that tells the user the app has understood their payslip,
 * and it is **never a blocker**. Save stays enabled beside it at any value: a
 * real slip contains items nobody wants to itemize, and an app that refuses the
 * slip is an app arguing with the payroll department.
 *
 * Zero is `positive`, anything else is `negative` — F04's word was "amber", but
 * the palette has no amber and its own comment names "a reconciliation gap" as
 * what `--color-negative` is reserved for (docs/11). The copy carries the rest:
 * the sentence beside a gap says what to do about it, not that something is
 * wrong.
 */
export function ReconciliationStrip({
  delta,
  grossToNet,
  itemized,
  idle,
  onAddDifference,
}: {
  delta: Money
  /** `gross − net`: the difference the slip itself asks to have explained. */
  grossToNet: Money
  /** What the lines currently account for. Named so the two can be compared on sight. */
  itemized: Money
  /** Nothing has been typed yet. A green zero over an empty form is a lie. */
  idle: boolean
  /**
   * Fills the gap with one "Other deduction" line. Absent when there is no
   * "Other deduction" type in the document to write it against.
   */
  onAddDifference: (() => void) | undefined
}) {
  const reconciled = delta.minor === 0
  const over = delta.minor < 0

  if (idle) {
    return (
      <p className="text-ink-tertiary">
        Enter gross and net, and this line will say whether the deductions between them add up.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span
        className={`text-secondary-number tabular-nums ${reconciled ? 'text-positive' : 'text-negative'}`}
        aria-live="polite"
      >
        {/* The magnitude when over: "−₪100.00 more than allowed" reads as two
            minus signs for one fact. The sentence beside it carries the
            direction. */}
        {formatMoney(over ? abs(delta) : delta)}
      </span>

      <span className="text-ink-secondary">
        {reconciled ? (
          <>Reconciled — the lines account for every agora between gross and net.</>
        ) : over ? (
          <>
            more than the {formatMoney(grossToNet)} between gross and net. An employer share typed
            into the employee column is the usual cause.
          </>
        ) : (
          <>
            of the {formatMoney(grossToNet)} between gross and net is not itemized — the lines
            account for {formatMoney(itemized)}.
          </>
        )}
      </span>

      {!reconciled && !over && onAddDifference !== undefined && (
        <Button variant="secondary" size="sm" onClick={onAddDifference}>
          Add the difference as Other deduction
        </Button>
      )}

      <span className="ml-auto text-caption text-ink-tertiary">
        A gap never blocks saving. Net is what your paycheck says it is.
      </span>
    </div>
  )
}
