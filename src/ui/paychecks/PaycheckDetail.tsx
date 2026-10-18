import { formatMoney } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { formatYearMonth, toISODate } from '@/core/time.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import {
  effectiveTaxRateBasisPoints,
  employerTotal,
  grossToNetSteps,
  payrollSavings,
  reconciliationDelta,
  savingsRateBasisPoints,
  totalCompensation,
  unresolvedLineIds,
} from '@/domain/paycheck.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Amount } from '@/ui/components/Amount.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { typeLabel } from '@/ui/paychecks/DeductionTypeSelect.tsx'
import { Waterfall } from '@/ui/paychecks/Waterfall.tsx'

/**
 * One payslip, read rather than typed — docs/f04's paycheck detail.
 *
 * Three blocks, in the order the questions get asked: what reached the bank,
 * where the difference went (the waterfall), and what the employer put in
 * beside it. The employer block is **separate on purpose**: that money never
 * touched net, and mixing it into the same column as the deductions is the
 * mistake this screen exists to prevent.
 */
export function PaycheckDetail({
  entry,
  types,
  onEdit,
  onBack,
}: {
  entry: PaycheckWithLines
  types: readonly DeductionType[]
  onEdit: () => void
  onBack: () => void
}) {
  const { paycheck } = entry
  const byId = new Map(types.map((type) => [type.id, type]))

  const steps = grossToNetSteps(entry, types)
  const delta = reconciliationDelta(entry, types)
  const savings = payrollSavings(entry, types)
  const employer = employerTotal(entry)
  const employerLines = entry.lines.filter((line) => line.employerAmount !== undefined)
  const orphaned = unresolvedLineIds(entry, types)

  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2">
        <span className="font-medium tabular-nums">{formatYearMonth(paycheck.period)}</span>
        {paycheck.employerName !== undefined && (
          <Bidi className="text-ink-secondary">{paycheck.employerName}</Bidi>
        )}
        <span className="text-ink-secondary tabular-nums">
          paid {toISODate(paycheck.paymentDate)}
        </span>
        {paycheck.isIrregular && (
          <span className="text-caption text-ink-tertiary">
            bonus month — averages leave it out
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back to the list
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Figure label="Net" hint="what reached the bank">
            <span className="text-hero tabular-nums">{formatMoney(paycheck.net)}</span>
          </Figure>
          <Figure label="Gross">
            <span className="text-secondary-number tabular-nums">{formatMoney(paycheck.gross)}</span>
          </Figure>
          <Figure label="Total compensation" hint="gross plus the employer's side">
            <span className="text-secondary-number tabular-nums">
              {formatMoney(totalCompensation(entry))}
            </span>
          </Figure>
          <Figure label="Effective tax" hint="tax, national insurance and health, over gross">
            <span className="text-secondary-number tabular-nums">
              {formatPercent(effectiveTaxRateBasisPoints(entry, types))}
            </span>
          </Figure>
          <Figure label="Saved" hint="pension, study fund and severance, both sides">
            <span className="text-secondary-number tabular-nums">
              {formatMoney(savings.total)}
            </span>
            <span className="text-caption text-ink-tertiary">
              {formatPercent(savingsRateBasisPoints(entry, types))} of total compensation
            </span>
          </Figure>
        </div>

        <h2 className="mt-8 mb-2 text-label text-ink-tertiary uppercase">Gross to net</h2>
        <Waterfall steps={steps} types={types} />

        {delta.minor !== 0 && (
          <p className="mt-2 max-w-3xl text-caption text-ink-secondary">
            {delta.minor > 0 ? (
              <>
                {formatMoney(delta)} of this paycheck is not itemized. The steps still reach the net —
                that row is the part the deductions do not account for.
              </>
            ) : (
              <>
                The lines add up to {formatMoney(delta, { symbol: true }).replace('-', '')} more
                than gross minus net allows. An employer share entered in the employee column is
                the usual cause.
              </>
            )}{' '}
            <button type="button" className="underline underline-offset-2" onClick={onEdit}>
              Open the paycheck
            </button>
            .
          </p>
        )}

        {orphaned.length > 0 && (
          <p className="mt-2 max-w-3xl text-caption text-negative">
            {orphaned.length === 1 ? 'One line names' : `${orphaned.length} lines name`} a deduction
            type that is no longer in this document, so {orphaned.length === 1 ? 'it is' : 'they are'}{' '}
            counted as not itemized rather than guessed at.
          </p>
        )}

        <h2 className="mt-8 mb-2 text-label text-ink-tertiary uppercase">
          What the employer put in
        </h2>
        {employerLines.length === 0 ? (
          <p className="max-w-3xl text-ink-secondary">
            Nothing recorded on the employer's side. Pension, study fund and severance usually have
            one — it never touches net, and it is money you own.
          </p>
        ) : (
          <table className="max-w-3xl">
            <tbody>
              {employerLines.map((line) => {
                const type = byId.get(line.deductionTypeId)
                return (
                  <tr key={line.id} className="border-b border-hairline">
                    <td className="w-48 py-1.5 pr-6 text-ink-secondary">
                      <Bidi>{type === undefined ? 'Unknown deduction' : typeLabel(type)}</Bidi>
                    </td>
                    <td className="w-32 py-1.5 pr-6 text-right">
                      {line.employerAmount !== undefined && <Amount value={line.employerAmount} />}
                    </td>
                    <td className="py-1.5 text-caption text-ink-tertiary">
                      {type?.countsAsSaving === true ? 'yours, accruing' : 'not out of your net'}
                    </td>
                  </tr>
                )
              })}
              <tr>
                <td className="py-1.5 pr-6 font-medium">Employer total</td>
                <td className="py-1.5 pr-6 text-right font-medium">
                  <Amount value={employer} />
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        )}

        {paycheck.note !== undefined && (
          <p className="mt-8 max-w-3xl text-ink-secondary">
            <Bidi>{paycheck.note}</Bidi>
          </p>
        )}
      </div>
    </div>
  )
}

function Figure({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label text-ink-tertiary uppercase">{label}</span>
      {children}
      {hint !== undefined && <span className="text-caption text-ink-tertiary">{hint}</span>}
    </div>
  )
}

