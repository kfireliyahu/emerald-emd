import { formatMonthShort, toISODate } from '@/core/time.ts'
import { depositTotal } from '@/data/importer/fundReportTemplate.ts'
import type { CurrencyCode, Money } from '@/core/money.ts'
import type { ReadDeposit } from '@/domain/model/funds.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Amount } from '@/ui/components/Amount.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import {
  AmountField,
  DateField,
  MonthField,
  WordField,
} from '@/ui/documents/ReadField.tsx'

/**
 * The deposit table a report printed, as read — shown on the confirm surface and
 * again on the form that saves it (D-153).
 *
 * **One component in two places on purpose.** What a person is asked to check
 * here is a transcription, and the thing that makes a transcription checkable is
 * that it looks the same everywhere it appears; a summary on the confirm screen
 * and a table on the form would mean the row nobody looked at is the row nobody
 * could have looked at.
 *
 * **The salary month is the column to look at and the caption says so.** Every
 * amount on this table is covered by one equation — the rows add up to what the
 * report says was paid in — and the month beside each amount is covered by
 * nothing at all, while being the field every later deposit check is keyed on.
 * That asymmetry is D-138 again, and the surface's job is to name it rather than
 * to let a passing sum reassure someone about a column it never touched.
 *
 * **And on the confirm surface every cell is a field** (M16 U11, D-205). Naming
 * the unchecked column was the whole of what this table could do about it;
 * `onRows` is what it can do now. The two places differ here on purpose and it
 * is the same argument: the correction belongs where the *document* is, and the
 * form that saves the reading no longer has the page beside it.
 */
export function DepositRows({
  rows,
  addUp,
  currency = 'ILS',
  onRows,
}: {
  rows: readonly ReadDeposit[]
  /** Whether the amounts summed to the report's own deposits figure. */
  addUp: boolean | undefined
  /** The currency a figure typed into a blank cell is in. */
  currency?: CurrencyCode
  /** Given only where the page is beside the table: the rows, as typed over. */
  onRows?: ((rows: readonly ReadDeposit[]) => void) | undefined
}) {
  if (rows.length === 0) return null

  /** One row's one field, set or cleared. A blank cell is not a zero. */
  const edit = (index: number, change: (row: ReadDeposit) => ReadDeposit): void => {
    onRows?.(rows.map((row, at) => (at === index ? change(row) : row)))
  }

  const setAmount = (
    index: number,
    part: 'employee' | 'employer' | 'severance',
    amount: Money | undefined,
  ): void => edit(index, (row) => ({ ...row, [part]: amount }))

  return (
    <div>
      <p className="text-label text-ink-tertiary uppercase">
        The deposits this report lists ({rows.length})
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
              <th className="py-2 text-left font-medium">For</th>
              <th className="px-3 py-2 text-left font-medium">Arrived</th>
              <th className="px-3 py-2 text-left font-medium">Employer</th>
              <th className="px-3 py-2 text-right font-medium">Yours</th>
              <th className="px-3 py-2 text-right font-medium">Employer’s</th>
              <th className="px-3 py-2 text-right font-medium">Severance</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              // **Keyed by position and nothing else.** The key used to carry
              // the month and the total, which was stable while the table was
              // read-only and is a remount on every keystroke now that it is
              // not — and a remounted field refills its text from above,
              // swallowing what was being typed.
              <tr key={index} className="border-b border-hairline">
                <td className="py-1 tabular-nums">
                  {onRows === undefined ? (
                    row.salaryMonth === undefined ? (
                      <span className="text-ink-tertiary">not read</span>
                    ) : (
                      formatMonthShort(row.salaryMonth)
                    )
                  ) : (
                    <MonthField
                      value={row.salaryMonth}
                      label={`Deposit ${index + 1}, salary month`}
                      className={`${FIELD} h-7`}
                      onCommit={(salaryMonth) => edit(index, (entry) => ({ ...entry, salaryMonth }))}
                    />
                  )}
                </td>
                <td className="px-3 py-1 tabular-nums text-ink-secondary">
                  {onRows === undefined ? (
                    row.depositDate === undefined ? (
                      '—'
                    ) : (
                      toISODate(row.depositDate)
                    )
                  ) : (
                    <DateField
                      value={row.depositDate}
                      label={`Deposit ${index + 1}, date`}
                      className={`${FIELD} h-7`}
                      onCommit={(depositDate) => edit(index, (entry) => ({ ...entry, depositDate }))}
                    />
                  )}
                </td>
                <td className="px-3 py-1">
                  {onRows === undefined ? (
                    <Bidi>{row.employerName ?? '—'}</Bidi>
                  ) : (
                    <WordField
                      value={row.employerName}
                      label={`Deposit ${index + 1}, employer`}
                      className={`${FIELD} h-7 w-40`}
                      onCommit={(employerName) => edit(index, (entry) => ({ ...entry, employerName }))}
                    />
                  )}
                </td>
                <Cell
                  row={row}
                  part="employee"
                  currency={currency}
                  label={`Deposit ${index + 1}, yours`}
                  onCommit={onRows && ((amount) => setAmount(index, 'employee', amount))}
                />
                <Cell
                  row={row}
                  part="employer"
                  currency={currency}
                  label={`Deposit ${index + 1}, employer’s`}
                  onCommit={onRows && ((amount) => setAmount(index, 'employer', amount))}
                />
                <Cell
                  row={row}
                  part="severance"
                  currency={currency}
                  label={`Deposit ${index + 1}, severance`}
                  onCommit={onRows && ((amount) => setAmount(index, 'severance', amount))}
                />
                {/* Derived and never a field: it is the row's own printed total
                    where the table has one and the three parts added up where it
                    has not, so the place to correct it is whichever part is
                    wrong. */}
                <td className="px-3 py-1 text-right">
                  <Amount value={depositTotal(row, currency)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-caption text-ink-tertiary">
        {addUp === undefined
          ? 'Nothing on the report checks these amounts against a total. '
          : addUp
            ? 'These amounts add up to what the report says was paid in. '
            : 'These amounts do not add up to what the report says was paid in — a row was misread, or one was missed. '}
        <span className="text-ink-secondary">
          The month in the first column is checked by nothing on the page, and it is what every
          later deposit check is keyed on. Read it against the report
          {onRows === undefined ? '.' : ', and type over whatever is wrong.'}
        </span>
      </p>
    </div>
  )
}

/**
 * One part of a deposit: an em dash where the report did not break it down, and
 * a field where the page is beside the table.
 *
 * **A blank cell is not a zero** — the report did not break this deposit down,
 * which is not the same as an employer paying nothing (`FundDeposit`).
 */
function Cell({
  row,
  part,
  currency,
  label,
  onCommit,
}: {
  row: ReadDeposit
  part: 'employee' | 'employer' | 'severance'
  currency: CurrencyCode
  label: string
  onCommit: ((value: Money | undefined) => void) | undefined
}) {
  const value = row[part]
  if (onCommit === undefined) {
    return (
      <td className="px-3 py-1 text-right">
        {value === undefined ? (
          <span className="text-ink-tertiary">—</span>
        ) : (
          <Amount value={value} />
        )}
      </td>
    )
  }
  return (
    <td className="px-3 py-1 text-right">
      <AmountField value={value} currency={currency} label={label} onCommit={onCommit} />
    </td>
  )
}
