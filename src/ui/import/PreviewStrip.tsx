import { abs, add, formatMoney, zero, type Money } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import type { ParsedRow, ParseSummary } from '@/data/importer/apply.ts'
import type { ColumnRole, DraftTransaction } from '@/domain/model/importing.ts'
import { Amount } from '@/ui/components/Amount.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { useT } from '@/i18n/current.ts'
import { fillNodes } from '@/i18n/nodes.tsx'
import { labelFor, useRoleLabels } from './roleLabel.ts'

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
  const t = useT()
  const labels = useRoleLabels()
  if (missingRoles.length > 0) {
    return (
      <Panel>
        <p className="text-ink-secondary">
          {t('reading.preview.setAs', { roles: missingRoles.map((role) => labelFor(labels, role)).join(t('reading.preview.and')) })}
        </p>
      </Panel>
    )
  }

  if (transactions.length === 0) {
    return (
      <Panel>
        <p className="text-ink-secondary">
          {t('reading.preview.nothing')}{' '}
          {summary.errors > 0 ? t('reading.preview.allFailed') : t('reading.preview.checkHeader')}
        </p>
      </Panel>
    )
  }

  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-ink-secondary">
          {t('reading.preview.parsed', { count: summary.parsed })}
          {summary.errors > 0 && <span className="text-negative">{t('reading.preview.failed', { count: summary.errors })}</span>}
          {summary.skipped > 0 && <span>{t('reading.preview.skipped', { count: summary.skipped })}</span>}
        </span>
        {/* Compare this against the total the statement prints for itself. */}
        <span className="text-ink-secondary">
          {fillNodes(t('reading.preview.total'), {
            amount: <span className="tabular-nums text-ink">{formatMoney(total)}</span>,
          })}
        </span>
      </div>

      <table className="mt-2 w-full">
        <tbody>
          {transactions.map((transaction, index) => (
            <tr key={index} className="border-t border-hairline">
              <td className="py-1 pe-4 tabular-nums whitespace-nowrap text-ink-secondary">
                {toISODate(transaction.transactionDate)}
              </td>
              <td className="w-full py-1 pe-4">
                <Bidi>{transaction.merchantRaw}</Bidi>
                {transaction.installment !== undefined && (
                  <Tag>
                    {transaction.installment.sequence}/{transaction.installment.total}
                  </Tag>
                )}
                {transaction.foreign !== undefined && <Tag>{t('reading.preview.foreign')}</Tag>}
                {transaction.providerCategory !== undefined && (
                  <span className="ms-2 text-ink-secondary">
                    <Bidi>{transaction.providerCategory}</Bidi>
                  </span>
                )}
              </td>
              <td className="py-1 text-end whitespace-nowrap">
                <Amount value={transaction.amount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {firstError?.outcome.kind === 'error' && (
        <p className="mt-2 border-t border-hairline pt-2 text-ink-secondary">
          <span className="text-negative">{t('reading.preview.row', { row: firstError.rowIndex + 1 })}</span>{' '}
          <Bidi>{firstError.outcome.errors.map((error) => error.message).join('; ')}</Bidi>
          {summary.errors > 1 && <span>{t('reading.preview.more', { count: summary.errors - 1 })}</span>}
          {/* **A row that does not read can be skipped from this read** (M55 U9,
              D-540) — a printed total line, say: counted as skipped, never
              written, and nothing kept in the reader. */}
          {onSkip !== undefined && (
            <>
              {' '}
              <TextAction onClick={() => onSkip(firstError.rowIndex, true)}>{t('reading.preview.skip')}</TextAction>
            </>
          )}
        </p>
      )}

      {leftOut.length > 0 && (
        <p className="mt-2 border-t border-hairline pt-2 text-ink-secondary">
          {t('reading.preview.skippedFrom')}{' '}
          {leftOut.map((row, at) => (
            <span key={row.rowIndex}>
              {at > 0 && ', '}
              <span className="tabular-nums">{t('reading.preview.rowAt', { row: row.rowIndex + 1 })}</span>
              {onSkip !== undefined && (
                <>
                  {' '}
                  <TextAction onClick={() => onSkip(row.rowIndex, false)}>{t('reading.preview.putBack')}</TextAction>
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
  return <span className="fc-state ms-2 align-middle">{children}</span>
}
