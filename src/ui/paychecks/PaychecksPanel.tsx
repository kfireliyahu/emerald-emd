import type { ReactNode } from 'react'

import type { CurrencyCode, Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { compareYearMonths, toISODate, toYearMonthString, type LocalDate, type YearMonth } from '@/core/time.ts'
import { salaryQuestions, type SalaryDecision, type SalaryGroup } from '@/domain/bankImport.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import type { SalaryBank } from '@/domain/model/statistics.ts'
import {
  effectiveTaxRateBasisPoints,
  employerTotal,
  grossToNetSteps,
  isTaxType,
  payrollSavings,
  savingsRateBasisPoints,
  slipParts,
  totalCompensation,
  totalsByType,
  unresolvedLineIds,
  yearToDate,
} from '@/domain/paycheck.ts'
import { salaryBankWords } from '@/domain/salaryBank.ts'
import { salaryProblem } from '@/domain/statistics.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { kitMoney } from '@/ui/charts/kit.ts'
import { Button } from '@/ui/components/Button.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState } from '@/ui/components/WaitingList.tsx'
import { WhereItWent } from '@/ui/paychecks/WhereItWent.tsx'

/** What the Paychecks panel holds: the paycheck in full, one part of it, the bank's answers, or a delete to undo. */
export type PaycheckPanel =
  | { readonly kind: 'slip' | 'tax' | 'saved' | 'other' | 'net' | 'bank' }
  | { readonly kind: 'deleted'; readonly period: YearMonth }

/**
 * **Paychecks' detail, beside the month** (M64 U8, D-620): what moved off the
 * page to sit one click behind what it explains — the slip in full behind its
 * gross (and a row of All paychecks), the taxes by deduction behind Taxes, the
 * fund lines and where they pay into behind Funds, where the net went behind
 * the net. The panel keeps its kind while the months page, so it speaks of the
 * paycheck open.
 */
export function PaychecksPanel({
  panel,
  entry,
  entries,
  types,
  bank,
  groups,
  currency,
  onEdit,
  onDelete,
  onUndo,
  onDecide,
  onClose,
}: {
  readonly panel: PaycheckPanel
  readonly entry: PaycheckWithLines | undefined
  readonly entries: readonly PaycheckWithLines[]
  readonly types: readonly DeductionType[]
  readonly bank: SalaryBank | undefined
  readonly groups: readonly SalaryGroup[]
  readonly currency: CurrencyCode
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly onUndo: () => void
  readonly onDecide: (group: SalaryGroup, decision: SalaryDecision) => void
  readonly onClose: () => void
}) {
  const t = useT()
  const dates = useDates()

  if (panel.kind === 'deleted') {
    // The delete is done; the note stays where it happened, with its undo.
    return (
      <SidePanel kicker={dates.yearMonth(panel.period)} title={t('paychecks.panel.slip')} onClose={onClose}>
        <p className="m-0 flex flex-wrap items-baseline gap-x-3">
          <span>{t('paychecks.panel.deleted', { month: dates.monthName(panel.period) })}</span>
          <button type="button" className="fc-text-action" onClick={onUndo} title={t('paychecks.list.undoTitle')}>
            {t('paychecks.list.undo')}
          </button>
        </p>
      </SidePanel>
    )
  }
  if (panel.kind === 'bank') {
    return (
      <SidePanel title={t('paychecks.panel.bank')} onClose={onClose}>
        <p className="m-0 text-ink-secondary">{t('paychecks.waiting.bankWhy')}</p>
        <BankQuestions groups={groups} onDecide={onDecide} />
      </SidePanel>
    )
  }
  if (entry === undefined) return null

  const kicker = dates.yearMonth(entry.paycheck.period)
  const parts = slipParts(entry, types)
  const byId = new Map(types.map((type) => [type.id, type]))
  const name = (id: string | undefined): ReactNode => {
    const type = id === undefined ? undefined : byId.get(id)
    return type === undefined ? t('paychecks.panel.goneType') : <Bidi>{type.name}</Bidi>
  }

  switch (panel.kind) {
    case 'slip':
      return (
        <SidePanel kicker={kicker} title={t('paychecks.panel.slip')} onClose={onClose}>
          <Slip entry={entry} types={types} bank={bank} onEdit={onEdit} onDelete={onDelete} />
        </SidePanel>
      )
    case 'tax': {
      const period = entry.paycheck.period
      // The year so far, up to the paycheck open: a later month's tax is not *so far*.
      const year = entries.filter(
        (one) => one.paycheck.period.year === period.year && compareYearMonths(one.paycheck.period, period) <= 0,
      )
      const month = totalsByType([entry], types, isTaxType, currency)
      const sofar = new Map(totalsByType(year, types, isTaxType, currency).map((one) => [one.deductionTypeId, one.employee]))
      const total = yearToDate(year, period.year, types, currency)
      const rate = effectiveTaxRateBasisPoints(entry, types)
      return (
        <SidePanel kicker={kicker} title={t('paychecks.parts.tax')} onClose={onClose}>
          <HeadlineFigure
            label={t('paychecks.parts.tax')}
            value={parts.tax}
            change={rate === undefined ? undefined : t('paychecks.panel.taxRate', { rate: formatPercent(rate) })}
            empty={t('paychecks.panel.taxesEmpty')}
          />
          {month.length === 0 ? (
            <EmptyState say={t('paychecks.panel.taxesEmpty')} />
          ) : (
            <Lines
              head={[t('paychecks.panel.deduction'), t('paychecks.panel.thisMonth'), t('paychecks.panel.yearSoFar', { year: String(period.year) })]}
              rows={month.map((one) => ({ key: one.deductionTypeId, name: name(one.deductionTypeId), amounts: [one.employee, sofar.get(one.deductionTypeId)] }))}
              total={{ name: t('paychecks.parts.tax'), amounts: [parts.tax, total.tax] }}
            />
          )}
          <p className="m-0 text-ink-secondary">
            {t(countKey('paychecks.panel.taxesYear', total.paychecks), { year: String(period.year), tax: kitMoney(total.tax), count: total.paychecks })}
          </p>
        </SidePanel>
      )
    }
    case 'saved': {
      const funds = totalsByType([entry], types, (type) => type.countsAsSaving, currency)
      return (
        <SidePanel kicker={kicker} title={t('paychecks.parts.saved')} onClose={onClose}>
          {funds.length === 0 ? (
            <EmptyState say={t('paychecks.panel.fundsEmpty')} />
          ) : (
            <Lines
              head={[t('paychecks.panel.deduction'), t('paychecks.panel.you'), t('paychecks.panel.employerSide')]}
              rows={funds.map((one) => ({ key: one.deductionTypeId, name: name(one.deductionTypeId), amounts: [one.employee, one.employer] }))}
              total={{ name: t('paychecks.parts.saved'), amounts: [payrollSavings(entry, types).employee, payrollSavings(entry, types).employer] }}
            />
          )}
          <h3 className="m-0 mt-2 text-heading font-medium">{t('paychecks.panel.paysInto')}</h3>
          <WhereItWent period={entry.paycheck.period} half="payroll" />
        </SidePanel>
      )
    }
    case 'other': {
      const steps = grossToNetSteps(entry, types).filter(
        (step) =>
          step.kind === 'UNEXPLAINED' ||
          (step.kind === 'DEDUCTION' && !isOtherExcluded(byId.get(step.deductionTypeId ?? ''))),
      )
      return (
        <SidePanel kicker={kicker} title={t('paychecks.parts.other')} onClose={onClose}>
          {steps.length === 0 ? (
            <EmptyState say={t('paychecks.panel.otherEmpty')} />
          ) : (
            <Lines
              head={[t('paychecks.panel.deduction'), t('paychecks.panel.thisMonth')]}
              rows={steps.map((step, index) => ({
                key: step.lineId ?? `step-${String(index)}`,
                name: step.kind === 'UNEXPLAINED' ? t('paychecks.panel.unexplained') : name(step.deductionTypeId),
                amounts: [step.isAddBack ? { ...step.amount, minor: -step.amount.minor } : step.amount],
              }))}
              total={{ name: t('paychecks.parts.other'), amounts: [parts.other] }}
            />
          )}
        </SidePanel>
      )
    }
    case 'net':
      return (
        <SidePanel kicker={kicker} title={t('paychecks.panel.netWent')} onClose={onClose}>
          <HeadlineFigure label={t('paychecks.parts.net')} value={entry.paycheck.net} change={t('paychecks.month.netHow')} empty={t('paychecks.month.flowEmpty')} />
          <BankLine bank={bank} />
          <WhereItWent period={entry.paycheck.period} half="split" />
        </SidePanel>
      )
  }
}

/** Taxes and funds have panels of their own; *other* is what is left beside them. */
function isOtherExcluded(type: DeductionType | undefined): boolean {
  return type !== undefined && (isTaxType(type) || type.countsAsSaving)
}

/** A small table of a panel: a name and its amounts, numbers right, a total under a rule. */
function Lines({
  head,
  rows,
  total,
}: {
  readonly head: readonly string[]
  readonly rows: readonly { readonly key: string; readonly name: ReactNode; readonly amounts: readonly (Money | undefined)[] }[]
  readonly total?: { readonly name: string; readonly amounts: readonly (Money | undefined)[] } | undefined
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-hairline text-label text-ink-secondary uppercase">
          {head.map((one, index) => (
            <th key={one} className={`h-8 font-medium ${index === 0 ? 'text-start' : 'ps-4 text-end'}`}>
              {one}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="h-10 border-b border-hairline">
            <td className="min-w-0">{row.name}</td>
            {row.amounts.map((amount, index) => (
              <td key={index} className="ps-4 text-end tabular-nums">
                <span dir="ltr">{amount === undefined ? '—' : kitMoney(amount)}</span>
              </td>
            ))}
          </tr>
        ))}
        {total !== undefined && (
          <tr className="h-10 border-t border-ink font-medium">
            <td>{total.name}</td>
            {total.amounts.map((amount, index) => (
              <td key={index} className="ps-4 text-end tabular-nums">
                <span dir="ltr">{amount === undefined ? '—' : kitMoney(amount)}</span>
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  )
}

/**
 * **The paycheck in full** — docs/f04's detail, as the panel's: when and by
 * whom, gross to net line by line, and what the employer put in beside it. The
 * employer's side is **separate on purpose**: that money never touched net.
 */
function Slip({
  entry,
  types,
  bank,
  onEdit,
  onDelete,
}: {
  readonly entry: PaycheckWithLines
  readonly types: readonly DeductionType[]
  readonly bank: SalaryBank | undefined
  readonly onEdit: () => void
  readonly onDelete: () => void
}) {
  const t = useT()
  const dates = useDates()
  const { paycheck } = entry
  const byId = new Map(types.map((type) => [type.id, type]))
  const steps = grossToNetSteps(entry, types).filter((step) => step.kind === 'DEDUCTION' || step.kind === 'UNEXPLAINED')
  const employerLines = entry.lines.filter((line) => line.employerAmount !== undefined)
  const orphaned = unresolvedLineIds(entry, types)
  const taxRate = effectiveTaxRateBasisPoints(entry, types)
  const savedRate = savingsRateBasisPoints(entry, types)

  return (
    <>
      <p className="m-0 text-ink-secondary">
        {t('paychecks.panel.paid', { date: dates.dayMonth(paycheck.paymentDate) })}
        {paycheck.employerName !== undefined && (
          <>
            {' '}
            <Phrase text={t('paychecks.panel.by')} parts={{ employer: <Bidi>{paycheck.employerName}</Bidi> }} />
          </>
        )}
      </p>
      {paycheck.isIrregular && <p className="m-0 text-ink-secondary">{t('paychecks.panel.bonus')}</p>}
      <BankLine bank={bank} />

      <table className="w-full border-collapse">
        <tbody>
          <tr className="h-10 border-b border-hairline">
            <td>{t('paychecks.parts.gross')}</td>
            <td className="ps-4 text-end tabular-nums"><span dir="ltr">{kitMoney(paycheck.gross)}</span></td>
          </tr>
          {steps.map((step, index) => {
            const type = step.deductionTypeId === undefined ? undefined : byId.get(step.deductionTypeId)
            return (
              <tr key={step.lineId ?? `step-${String(index)}`} className="h-10 border-b border-hairline">
                <td className="min-w-0">
                  {step.kind === 'UNEXPLAINED' ? (
                    <span>
                      <span aria-hidden className="me-1.5 inline-block size-2 rounded-full bg-negative" />
                      {t('paychecks.panel.unexplained')}
                    </span>
                  ) : (
                    <span className="flex flex-col items-start">
                      {type === undefined ? t('paychecks.panel.goneType') : <Bidi>{type.name}</Bidi>}
                      {type?.hebrewName !== undefined && type.hebrewName !== type.name && (
                        <Bidi className="text-caption text-ink-secondary">{type.hebrewName}</Bidi>
                      )}
                    </span>
                  )}
                </td>
                <td className="ps-4 text-end text-ink-secondary tabular-nums">
                  <span dir="ltr">{`${step.isAddBack ? '+' : '−'}${kitMoney(step.amount)}`}</span>
                </td>
              </tr>
            )
          })}
          <tr className="h-10 border-t border-ink font-medium">
            <td>{t('paychecks.parts.net')}</td>
            <td className="ps-4 text-end tabular-nums"><span dir="ltr">{kitMoney(paycheck.net)}</span></td>
          </tr>
        </tbody>
      </table>
      {orphaned.length > 0 && (
        <p className="m-0 text-ink-secondary">
          <span aria-hidden className="me-1.5 inline-block size-2 rounded-full bg-negative" />
          {t(countKey('paychecks.panel.orphaned', orphaned.length), { count: orphaned.length })}
        </p>
      )}

      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
        <dt className="text-ink-secondary">{t('paychecks.panel.compensation')}</dt>
        <dd className="m-0 text-end tabular-nums"><span dir="ltr">{kitMoney(totalCompensation(entry))}</span></dd>
        <dt className="text-ink-secondary">{t('paychecks.parts.tax')}</dt>
        <dd className="m-0 text-end tabular-nums">{taxRate === undefined ? '—' : t('paychecks.panel.taxRate', { rate: formatPercent(taxRate) })}</dd>
        <dt className="text-ink-secondary">{t('paychecks.panel.savedBoth')}</dt>
        <dd className="m-0 text-end tabular-nums"><span dir="ltr">{kitMoney(payrollSavings(entry, types).total)}</span></dd>
        {savedRate !== undefined && (
          <>
            <dt className="sr-only">{t('paychecks.panel.savedBoth')}</dt>
            <dd className="col-span-2 m-0 text-end text-caption text-ink-secondary">{t('paychecks.panel.savedRate', { rate: formatPercent(savedRate) })}</dd>
          </>
        )}
      </dl>

      <h3 className="m-0 mt-2 text-heading font-medium">{t('paychecks.panel.employer')}</h3>
      {employerLines.length === 0 ? (
        <EmptyState say={t('paychecks.panel.employerNone')} />
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {employerLines.map((line) => {
              const type = byId.get(line.deductionTypeId)
              return (
                <tr key={line.id} className="h-10 border-b border-hairline">
                  <td className="min-w-0">
                    <span className="flex flex-col items-start">
                      {type === undefined ? t('paychecks.panel.goneType') : <Bidi>{type.name}</Bidi>}
                      <span className="text-caption text-ink-secondary">
                        {type?.countsAsSaving === true ? t('paychecks.panel.yours') : t('paychecks.panel.notYours')}
                      </span>
                    </span>
                  </td>
                  <td className="ps-4 text-end tabular-nums">
                    <span dir="ltr">{line.employerAmount === undefined ? '—' : kitMoney(line.employerAmount)}</span>
                  </td>
                </tr>
              )
            })}
            <tr className="h-10 border-t border-ink font-medium">
              <td>{t('paychecks.panel.employerTotal')}</td>
              <td className="ps-4 text-end tabular-nums"><span dir="ltr">{kitMoney(employerTotal(entry))}</span></td>
            </tr>
          </tbody>
        </table>
      )}

      {paycheck.note !== undefined && (
        <p className="m-0 text-ink-secondary">
          <Bidi>{paycheck.note}</Bidi>
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" icon="edit" onClick={onEdit}>
          {t('paychecks.panel.edit')}
        </Button>
        <span className="flex-1" />
        {/* Deletes at once, with Undo where it happened — never a confirmation (D-617's addition). */}
        <IconAction label={t('paychecks.panel.delete', { month: dates.yearMonth(paycheck.period) })} tone="negative" onClick={onDelete}>
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
        </IconAction>
      </div>
    </>
  )
}

/** What the bank says about the paycheck open: quiet when it agrees, a red dot and the words when it does not. */
export function BankLine({ bank }: { readonly bank: SalaryBank | undefined }) {
  if (bank === undefined) return null
  const words = { money: kitMoney, date: (day: LocalDate) => toISODate(day) }
  return (
    <p className="m-0 text-caption text-ink-secondary">
      {salaryProblem(bank) && <span aria-hidden className="me-1.5 inline-block size-2 rounded-full bg-negative" />}
      {salaryBankWords(bank, words)}
    </p>
  )
}

/**
 * What landed in the bank against what the payslips say — docs/f06's step 12,
 * as answers in the panel. **The paycheck is authoritative and the deposit is
 * the duplicate**, so what an answer excludes is the bank row; and a
 * disagreement stays on the list after it is answered, because "do not count
 * this twice" and "these two figures differ" are two questions.
 */
function BankQuestions({
  groups,
  onDecide,
}: {
  readonly groups: readonly SalaryGroup[]
  readonly onDecide: (group: SalaryGroup, decision: SalaryDecision) => void
}) {
  const t = useT()
  const dates = useDates()
  const questions = salaryQuestions(groups)
  if (questions.length === 0) return <EmptyState say={t('paychecks.panel.bankAnswered')} />
  const words = { money: kitMoney, date: (day: LocalDate) => toISODate(day) }
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {questions.map((group) => (
        <li key={toYearMonthString(group.period)} className="flex flex-col gap-1 border-b border-hairline py-3">
          <span className="font-medium">{dates.yearMonth(group.period)}</span>
          {group.verdict === 'NO_PAYCHECK' && <span className="tabular-nums">{t('paychecks.panel.landed', { amount: kitMoney(group.total) })}</span>}
          <span className="text-ink-secondary">
            <span aria-hidden className="me-1.5 inline-block size-2 rounded-full bg-negative" />
            {group.verdict === 'DIFFERS' &&
              group.difference !== undefined &&
              group.paycheckPeriod !== undefined &&
              `${salaryBankWords(
                {
                  kind: 'DIFFERS',
                  landed: group.total,
                  landedOn: group.rows[group.rows.length - 1]?.date ?? group.rows[0]!.date,
                  count: group.rows.length,
                  difference: group.difference,
                },
                words,
              )} · ${t('paychecks.panel.says', { month: dates.yearMonth(group.paycheckPeriod), amount: group.net === undefined ? '' : kitMoney(group.net) })}`}
            {group.verdict === 'NO_PAYCHECK' && salaryBankWords({ kind: 'NO_SLIP' }, words)}
            {group.rows.length > 1 && ` · ${t(countKey('paychecks.panel.deposits', group.rows.length), { count: group.rows.length })}`}
          </span>
          {group.verdict === 'DIFFERS' && (
            <span className="flex flex-wrap items-baseline gap-x-3 text-caption text-ink-secondary">
              {group.decision === 'COUNTED' ? t('paychecks.panel.counted') : t('paychecks.panel.notCounted')}
              <button
                type="button"
                className="fc-text-action"
                onClick={() => onDecide(group, group.decision === 'COUNTED' ? 'PENDING' : 'COUNTED')}
              >
                {group.decision === 'COUNTED' ? t('paychecks.panel.change') : t('paychecks.panel.countIt')}
              </button>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
