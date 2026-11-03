import { abs, add, formatMoney, zero, type Money } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import type { ParsedRow, ParseSummary } from '@/data/importer/apply.ts'
import type { ColumnRole, DraftTransaction } from '@/domain/model/importing.ts'
import { Amount } from '@/ui/components/Amount.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { labelFor, ROLE_LABEL } from './roleLabel.ts'

/**
 * The live preview: what the mapping currently produces.
 *
 * This is load-bearing rather than decorative. Correctness depends on the user
 * mapping the columns correctly (D-013), so the preview and the total are the
 * two things that let them see they got it right before anything is committed.
 */
export function PreviewStrip({
  transactions,
  summary,
  total,
  missingRoles,
  firstError,
  leftOut = [],
  onSkip,
}: {
  transactions: readonly DraftTransaction[]
  summary: ParseSummary
  total: Money
  missingRoles: readonly ColumnRole[]
  firstError: ParsedRow | undefined
  /** The rows skipped from this read (M55 U9, D-540). */
  leftOut?: readonly ParsedRow[]
  /** Skip a row that did not read from this read, or take it back. */
  onSkip?: ((rowIndex: number, skip: boolean) => void) | undefined
}) {
  if (missingRoles.length > 0) {
    return (
      <Panel>
        <p className="text-ink-secondary">
          Set a column as {missingRoles.map((role) => labelFor(ROLE_LABEL, role)).join(' and ')} to see the
          transactions it reads.
        </p>
      </Panel>
    )
  }

  if (transactions.length === 0) {
    return (
      <Panel>
        <p className="text-ink-secondary">
          Nothing read with these columns.{' '}
          {summary.errors > 0
            ? 'Every row failed — the columns are probably assigned to the wrong roles.'
            : 'Check that the header row is right.'}
        </p>
      </Panel>
    )
  }

  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-ink-secondary">
          {summary.parsed} parsed
          {summary.errors > 0 && <span className="text-negative"> · {summary.errors} failed</span>}
          {summary.skipped > 0 && <span> · {summary.skipped} skipped</span>}
        </span>
        {/* Compare this against the total the statement prints for itself. */}
        <span className="text-ink-secondary">
          total <span className="tabular-nums text-ink">{formatMoney(total)}</span>
        </span>
      </div>

      <table className="mt-2 w-full">
        <tbody>
          {transactions.map((transaction, index) => (
            <tr key={index} className="border-t border-hairline">
              <td className="py-1 pr-4 tabular-nums whitespace-nowrap text-ink-secondary">
                {toISODate(transaction.transactionDate)}
              </td>
              <td className="w-full py-1 pr-4">
                <Bidi>{transaction.merchantRaw}</Bidi>
                {transaction.installment !== undefined && (
                  <Tag>
                    {transaction.installment.sequence}/{transaction.installment.total}
                  </Tag>
                )}
                {transaction.foreign !== undefined && <Tag>foreign</Tag>}
                {transaction.providerCategory !== undefined && (
                  <span className="ml-2 text-ink-secondary">
                    <Bidi>{transaction.providerCategory}</Bidi>
                  </span>
                )}
              </td>
              <td className="py-1 text-right whitespace-nowrap">
                <Amount value={transaction.amount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {firstError?.outcome.kind === 'error' && (
        <p className="mt-2 border-t border-hairline pt-2 text-ink-secondary">
          <span className="text-negative">Row {firstError.rowIndex + 1}</span>{' '}
          <Bidi>{firstError.outcome.errors.map((error) => error.message).join('; ')}</Bidi>
          {summary.errors > 1 && <span> · and {summary.errors - 1} more</span>}
          {/* **A row that does not read can be skipped from this read** (M55 U9,
              D-540) — a printed total line, say: counted as skipped, never
              written, and nothing kept in the reader. */}
          {onSkip !== undefined && (
            <>
              {' '}
              <TextAction onClick={() => onSkip(firstError.rowIndex, true)}>Skip</TextAction>
            </>
          )}
        </p>
      )}

      {leftOut.length > 0 && (
        <p className="mt-2 border-t border-hairline pt-2 text-ink-secondary">
          Skipped from this read:{' '}
          {leftOut.map((row, at) => (
            <span key={row.rowIndex}>
              {at > 0 && ', '}
              <span className="tabular-nums">row {row.rowIndex + 1}</span>
              {onSkip !== undefined && (
                <>
                  {' '}
                  <TextAction onClick={() => onSkip(row.rowIndex, false)}>Put back</TextAction>
                </>
              )}
            </span>
          ))}
        </p>
      )}
    </Panel>
  )
}

export function totalOf(transactions: readonly DraftTransaction[], currency: string): Money {
  return transactions.reduce((running, transaction) => add(running, abs(transaction.amount)), zero(currency))
}

function TextAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={onClick}>
      {children}
    </button>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="fc-pop-enter border-t border-hairline px-6 py-3">{children}</div>
}

/** *A chip is text and a dot* (D-531): no border, no radius — the shared `.fc-state`. */
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="fc-state ml-2 align-middle">{children}</span>
}
