import { useState } from 'react'

import { formatMoney, type Money } from '@/core/money.ts'
import type { YearMonth } from '@/core/time.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import {
  monthVariance,
  monthlyShare,
  nextChargeMonth,
  outsideMonthReason,
  WINDOW_MONTH_OPTIONS,
  type FixedPlanParts,
  type Variance,
} from '@/domain/fixedExpenses.ts'
import {
  FIXED_ROLES,
  type FixedExpense,
  type FixedExpenseCandidate,
  type FixedRole,
} from '@/domain/model/fixed.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Amount } from '@/ui/components/Amount.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { EmptyState } from '@/ui/components/WaitingList.tsx'
import { CandidateCard } from '@/ui/fixed/CandidateCard.tsx'
import type { CandidateChoice } from '@/ui/fixed/candidateChoice.ts'
import { ROLE_LABEL, sourceText } from '@/ui/plan/planLook.ts'

/** A choice on a row of data: text at rest, its box only under the pointer or the keyboard (M64 U9). */
const QUIET_CHOICE =
  'h-8 cursor-pointer border border-transparent bg-transparent px-2 hover:border-hairline-strong focus-visible:border-accent'

/** What really left in the month the table is about, by each of the two things a bill is matched on. */
export interface Actuals {
  readonly byMerchant: ReadonlyMap<string, Money>
  readonly byCategory: ReadonlyMap<string, Money>
}

function actualFor(expense: FixedExpense, actuals: Actuals): Money | undefined {
  if (expense.matchRef === undefined) return undefined
  if (expense.matchKind === 'MERCHANT_PATTERN') return actuals.byMerchant.get(expense.matchRef)
  if (expense.matchKind === 'CATEGORY') return actuals.byCategory.get(expense.matchRef)
  return undefined
}

/**
 * **Bills, on Plan** (M28 U7, D-319; redesigned M64 U9, D-621): what each bill
 * does to the plan, a row each — its name, what it comes to a month, what it
 * was charged in the month the plan is held against, and the one choice, out
 * of net, part of the split or ignored, changed in place on its line. The bill
 * the payslip already took is outside the choice and says so (D-053).
 *
 * Everything else a bill has — how often, each charge, how it is recognised,
 * that it ended, that it stops being tracked — is its form, beside the page:
 * the name opens it. What looks like a bill and is not tracked yet waits in
 * the page's strip, never here.
 */
export function FixedSection({
  planName,
  expenses,
  roles,
  parts,
  categories,
  actuals,
  month,
  lastComplete,
  onRole,
  onAdd,
  onOpen,
  onEnded,
}: {
  readonly planName: string
  readonly expenses: readonly FixedExpense[]
  readonly roles: ReadonlyMap<string, FixedRole>
  readonly parts: FixedPlanParts
  readonly categories: readonly Category[]
  readonly actuals: Actuals
  readonly month: YearMonth
  readonly lastComplete: YearMonth
  readonly onRole: (expense: FixedExpense, role: FixedRole) => void
  readonly onAdd: () => void
  readonly onOpen: (expense: FixedExpense) => void
  /** Open the bills that ended. */
  readonly onEnded: () => void
}) {
  const t = useT()
  const dates = useDates()
  const live = expenses.filter((expense) => expense.isActive)
  const ended = expenses.filter((expense) => !expense.isActive)

  return (
    <section className="flex flex-col gap-3" aria-labelledby="plan-bills" data-guide="plan.fixed">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="plan-bills" className="m-0 text-heading font-medium">
            {t('plan.fixed.title')}
          </h2>
          <p className="m-0 text-ink-secondary">
            <Phrase text={t('plan.fixed.lead')} parts={{ name: <Bidi>{planName}</Bidi> }} />
          </p>
        </div>
        <Button variant="secondary" icon="add" onClick={onAdd}>
          {t('plan.fixed.add')}
        </Button>
      </div>

      {live.length === 0 ? (
        <EmptyState say={t('plan.fixed.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse" data-block>
            <thead>
              <tr className="h-8 border-b border-hairline text-caption text-ink-secondary">
                <th className="pe-3 text-start font-normal">{t('plan.fixed.column.name')}</th>
                <th className="px-3 text-end font-normal">{t('plan.fixed.column.aMonth')}</th>
                <th className="px-3 text-end font-normal">{dates.monthShort(lastComplete)}</th>
                <th className="ps-3 text-start font-normal">{t('plan.fixed.column.does')}</th>
              </tr>
            </thead>
            <tbody>
              {live.map((expense) => {
                const role = roles.get(expense.id) ?? 'IGNORE'
                const slip = expense.matchKind === 'PAYCHECK_DEDUCTION'
                const due = expense.cadence === 'MONTHLY' ? undefined : nextChargeMonth(expense, month)
                const outside = outsideMonthReason(expense, month)
                const quiet = (role === 'IGNORE' && !slip) || outside !== undefined
                return (
                  <tr key={expense.id} className="h-10 border-b border-hairline hover:bg-surface">
                    <td className="py-2 pe-3">
                      <button
                        type="button"
                        className={`block text-start font-medium underline-offset-4 hover:underline ${quiet ? 'text-ink-secondary' : ''}`}
                        onClick={() => onOpen(expense)}
                      >
                        <Bidi>{expense.name}</Bidi>
                      </button>
                      {!(expense.matchKind === 'MERCHANT_PATTERN' && expense.matchRef?.toLowerCase() === expense.name.toLowerCase()) && (
                        <span className="block text-caption text-ink-secondary">
                          <Bidi>{sourceText(expense, categories)}</Bidi>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Amount value={monthlyShare(expense)} className={quiet ? 'text-ink-secondary' : ''} />
                      {due !== undefined && (
                        <span className="block text-caption text-ink-secondary">{t('plan.fixed.next', { month: dates.monthShort(due) })}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Last variance={monthVariance(expense, actualFor(expense, actuals), lastComplete)} />
                    </td>
                    <td className="py-2 ps-3">
                      {slip ? (
                        <span className="text-ink-secondary">{t('plan.fixed.total.alreadyOut')}</span>
                      ) : (
                        <ChoiceMenu
                          text={ROLE_LABEL[role]}
                          choices={FIXED_ROLES.map((each) => ({ value: each, label: ROLE_LABEL[each] }))}
                          onPick={(choice) => onRole(expense, choice.value as FixedRole)}
                          aria-label={t('plan.fixed.roleLabel', { name: expense.name })}
                          className={QUIET_CHOICE}
                        />
                      )}
                      {outside !== undefined && (
                        <span className="block text-caption text-ink-secondary">
                          {outside === 'NOT_STARTED' ? t('plan.fixed.startsLater', { month: dates.yearMonth(month) }) : t('plan.fixed.endedEarlier', { month: dates.yearMonth(month) })}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-caption text-ink-secondary">
        <Total label={ROLE_LABEL.NET} list={parts.netOffList} />
        <Total label={ROLE_LABEL.SPLIT} list={parts.inSplitList} />
        <Total label={t('plan.fixed.total.ignored')} list={parts.ignored} />
        {ended.length > 0 && (
          <button type="button" className="fc-text-action ms-auto" onClick={onEnded}>
            {ended.length === 1 ? t('plan.fixed.endedOne') : t('plan.fixed.endedMany', { n: ended.length })}
          </button>
        )}
      </p>
    </section>
  )
}

function Total({ label, list }: { readonly label: string; readonly list: readonly FixedExpense[] }) {
  const total = list.reduce((running, expense) => running + monthlyShare(expense).minor, 0)
  const currency = list[0]?.expectedAmount.currency
  if (currency === undefined) return null
  return (
    <span>
      {label} <b className="font-medium text-ink tabular-nums">{formatMoney({ minor: total, currency })}</b>
    </span>
  )
}

function Last({ variance }: { readonly variance: Variance }) {
  const t = useT()
  if (variance.status === 'MISSING') return <span className="text-negative">{t('plan.fixed.noneYet')}</span>
  if (variance.status === 'NOT_DUE' || variance.status === 'NOT_TRACKED' || variance.actual === undefined) {
    return <span className="text-ink-secondary">—</span>
  }
  return <Amount value={variance.actual} className="text-ink-secondary" />
}

/**
 * **A bill's own actions, under its form** (M64 U9): that it ended, which keeps
 * its history, and that it stops being tracked, which cannot be undone and so
 * asks first — right under the button that asked, naming the bill.
 */
export function BillActions({
  expense,
  onEnd,
  onStop,
}: {
  readonly expense: FixedExpense
  readonly onEnd: () => void
  readonly onStop: () => void
}) {
  const t = useT()
  const [asking, setAsking] = useState(false)
  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
      <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {expense.isActive && (
          <button type="button" className="fc-text-action" title={t('plan.fixed.menu.endedDetail')} onClick={onEnd}>
            {t('plan.fixed.menu.ended')}
          </button>
        )}
        <button type="button" className="fc-text-action ms-auto" aria-expanded={asking} onClick={() => setAsking(true)}>
          {t('plan.fixed.stop')}
        </button>
      </span>
      {asking && (
        <div role="alertdialog" aria-label={t('plan.fixed.stop')} className="fc-pop-enter flex flex-col gap-3 border border-hairline-strong px-4 py-3"
          onKeyDown={(event) => {
            // Esc takes back the question, never the panel it was asked in.
            if (event.key === 'Escape') {
              event.preventDefault()
              setAsking(false)
            }
          }}
        >
          <span>
            <Phrase text={t('plan.fixed.stopAsk')} parts={{ name: <Bidi>{expense.name}</Bidi> }} />
          </span>
          <span className="flex gap-3">
            <Button variant="secondary" size="sm" onClick={onStop}>
              {t('plan.fixed.stop')}
            </Button>
            <Button variant="ghost" size="sm" autoFocus onClick={() => setAsking(false)}>
              {t('plan.fixed.keep')}
            </Button>
          </span>
        </div>
      )}
    </div>
  )
}

/** The bills that ended, beside the page: each opens its form again. */
export function EndedBills({
  ended,
  onOpen,
}: {
  readonly ended: readonly FixedExpense[]
  readonly onOpen: (expense: FixedExpense) => void
}) {
  return (
    <ul className="m-0 list-none p-0">
      {ended.map((expense) => (
        <li key={expense.id} className="border-b border-hairline py-2">
          <button type="button" className="text-start underline-offset-4 hover:underline" onClick={() => onOpen(expense)}>
            <Bidi>{expense.name}</Bidi>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * **What looks like a bill, beside the page** (M64 U9): every charge that
 * repeats and is not tracked, each with *Track it* and *Not a bill*, the
 * window it was found in, and the merchants already said not to be bills.
 */
export function Candidates({
  candidates,
  windowMonths,
  dismissed,
  onWindow,
  onTrack,
  onNotBill,
  onSuggestAgain,
}: {
  readonly candidates: readonly FixedExpenseCandidate[]
  readonly windowMonths: number
  readonly dismissed: readonly string[]
  readonly onWindow: (months: number) => void
  readonly onTrack: (candidate: FixedExpenseCandidate, choice: CandidateChoice) => void
  readonly onNotBill: (candidate: FixedExpenseCandidate) => void
  readonly onSuggestAgain: (merchant: string) => void
}) {
  const t = useT()
  const [showDismissed, setShowDismissed] = useState(false)
  return (
    <>
      <label className="flex flex-wrap items-center gap-2 text-ink-secondary">
        {t('plan.fixed.lookingAt')}
        <ChoiceMenu
          text={t('plan.fixed.windowMonths', { n: windowMonths })}
          choices={WINDOW_MONTH_OPTIONS.map((months) => ({ value: String(months), label: t('plan.fixed.windowMonths', { n: months }) }))}
          onPick={(choice) => onWindow(Number(choice.value))}
          aria-label={t('plan.fixed.window')}
        />
      </label>
      <p className="m-0 text-caption text-ink-secondary">{t('plan.fixed.startsIgnored')}</p>
      {candidates.length === 0 ? (
        <EmptyState say={t('plan.fixed.noCandidates')} />
      ) : (
        <div className="flex flex-col border border-hairline">
          {candidates.map((candidate) => (
            <CandidateCard
              key={`${candidate.merchantNormalized}-${candidate.currency}`}
              candidate={candidate}
              windowMonths={windowMonths}
              onConfirm={(choice) => onTrack(candidate, choice)}
              onDismiss={() => onNotBill(candidate)}
            />
          ))}
        </div>
      )}
      {dismissed.length > 0 && (
        <div>
          <button type="button" className="fc-text-action" aria-expanded={showDismissed} onClick={() => setShowDismissed((current) => !current)}>
            {dismissed.length === 1 ? t('plan.fixed.dismissedOne') : t('plan.fixed.dismissedMany', { n: dismissed.length })}
          </button>
          {showDismissed && (
            <ul className="fc-pop-enter m-0 mt-2 flex list-none flex-col gap-1 p-0">
              {dismissed.map((merchant) => (
                <li key={merchant} className="flex items-center gap-3">
                  <Bidi className="text-ink-secondary">{merchant}</Bidi>
                  <Button variant="ghost" size="sm" onClick={() => onSuggestAgain(merchant)}>
                    {t('plan.fixed.suggestAgain')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

/** Three buttons that are one choice. A radio group, because that is what it is. */
export function RoleSwitch({
  name,
  role,
  onPick,
}: {
  name: string
  role: FixedRole
  onPick: (role: FixedRole) => void
}) {
  const t = useT()
  return (
    <div role="radiogroup" aria-label={t('plan.fixed.roleLabel', { name })} className="inline-flex">
      {FIXED_ROLES.map((each, index) => {
        const on = each === role
        return (
          <button
            key={each}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(each)}
            className={[
              'h-7 whitespace-nowrap border px-2.5 text-caption transition-colors duration-[var(--duration-micro)]',
              index === 0 ? '' : '-ms-px',
              on
                ? each === 'IGNORE'
                  ? 'relative z-[1] border-ink-tertiary bg-surface text-ink-secondary'
                  : 'relative z-[1] border-accent bg-accent-soft text-ink'
                : 'border-hairline-strong text-ink-secondary hover:text-ink',
            ].join(' ')}
          >
            {ROLE_LABEL[each]}
          </button>
        )
      })}
    </div>
  )
}
