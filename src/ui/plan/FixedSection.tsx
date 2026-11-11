import { useState } from 'react'

import { formatMoney, type Money } from '@/core/money.ts'
import type { YearMonth } from '@/core/time.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import {
  isChargeMonth,
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
import { Chip } from '@/ui/components/Chip.tsx'
import { ContextMenu } from '@/ui/components/ContextMenu.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { startEdge } from '@/ui/direction.ts'
import { CandidateCard } from '@/ui/fixed/CandidateCard.tsx'
import type { CandidateChoice } from '@/ui/fixed/candidateChoice.ts'
import { CADENCE_LABEL } from '@/ui/fixed/labels.ts'
import { ROLE_LABEL, sourceText } from '@/ui/plan/planLook.ts'
import { BlockHead } from '@/ui/home/parts.tsx'

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
 * Fixed expenses, the top of the Plan page (M28 U7, D-319).
 *
 * **One switch on every row, and it belongs to this plan**: out of net, one
 * share of the split, or ignored. The bill the payslip already took is outside
 * the choice and says so (D-053), because a switch there would invite the one
 * mistake the rule exists to prevent.
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
  candidates,
  windowMonths,
  dismissed,
  onWindow,
  onRole,
  onAdd,
  onEdit,
  onEnd,
  onStop,
  onTrack,
  onNotBill,
  onSuggestAgain,
  form,
}: {
  planName: string
  expenses: readonly FixedExpense[]
  roles: ReadonlyMap<string, FixedRole>
  parts: FixedPlanParts
  categories: readonly Category[]
  actuals: Actuals
  month: YearMonth
  lastComplete: YearMonth
  candidates: readonly FixedExpenseCandidate[]
  windowMonths: number
  dismissed: readonly string[]
  onWindow: (months: number) => void
  onRole: (expense: FixedExpense, role: FixedRole) => void
  onAdd: () => void
  onEdit: (expense: FixedExpense) => void
  onEnd: (expense: FixedExpense) => void
  onStop: (expense: FixedExpense) => void
  /** Track a candidate as it was left on its card — the amount and cadence chosen (M28 F22). */
  onTrack: (candidate: FixedExpenseCandidate, choice: CandidateChoice) => void
  onNotBill: (candidate: FixedExpenseCandidate) => void
  onSuggestAgain: (merchant: string) => void
  /** The add-by-hand / edit form, drawn in place above the table. */
  form?: React.ReactNode
}) {
  const t = useT()
  const dates = useDates()
  const [menu, setMenu] = useState<
    { readonly expense: FixedExpense; readonly at: { readonly x: number; readonly y: number } } | undefined
  >()
  const [confirming, setConfirming] = useState<FixedExpense | undefined>()
  const [showDismissed, setShowDismissed] = useState(false)

  const live = expenses.filter((expense) => expense.isActive)
  const ended = expenses.filter((expense) => !expense.isActive)

  return (
    <section className="flex flex-col gap-3" aria-label={t('plan.fixed.title')} data-guide="plan.fixed">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="m-0 text-[16px] font-medium">{t('plan.fixed.title')}</h2>
          <p className="m-0 mt-0.5 text-caption text-ink-secondary">
            <Phrase text={t('plan.fixed.lead')} parts={{ name: <Bidi>{planName}</Bidi> }} />
          </p>
        </div>
        {form === undefined && (
          <Button variant="primary" size="sm" icon="add" onClick={onAdd}>
            {t('plan.fixed.add')}
          </Button>
        )}
      </div>

      {form}

      {live.length === 0 ? (
        <p className="m-0 border border-dashed border-hairline-strong px-4 py-6 text-center text-ink-secondary">
          {t('plan.fixed.empty')}
        </p>
      ) : (
        <Table
          list={live}
          roles={roles}
          categories={categories}
          actuals={actuals}
          month={month}
          lastComplete={lastComplete}
          onRole={onRole}
          onMenu={(expense, at) => setMenu({ expense, at })}
        />
      )}

      {confirming !== undefined && (
        <div className="fc-pop-enter flex flex-wrap items-center gap-3 bg-surface px-4 py-2">
          <span>
            <Phrase text={t('plan.fixed.stopAsk')} parts={{ name: <Bidi>{confirming.name}</Bidi> }} />
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onStop(confirming)
              setConfirming(undefined)
            }}
          >
            {t('plan.fixed.stop')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(undefined)}>
            {t('plan.fixed.keep')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-x-7 gap-y-1 text-caption text-ink-secondary">
        <Total label={ROLE_LABEL.NET} list={parts.netOffList} />
        <Total label={ROLE_LABEL.SPLIT} list={parts.inSplitList} />
        <Total label={t('plan.fixed.total.alreadyOut')} list={parts.alreadyOutOfNet} />
        <Total label={t('plan.fixed.total.ignored')} list={parts.ignored} />
        {parts.outsideMonth.length > 0 && (
          <span>
            {t('plan.fixed.notRunning', { month: dates.yearMonth(month) })}{' '}
            <b className="font-medium text-ink tabular-nums">{String(parts.outsideMonth.length)}</b>
          </span>
        )}
      </div>

      {ended.length > 0 && (
        <details className="text-caption text-ink-secondary">
          <summary className="cursor-pointer">
            {ended.length === 1 ? t('plan.fixed.endedOne') : t('plan.fixed.endedMany', { n: ended.length })}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {ended.map((expense) => (
              <li key={expense.id} className="flex items-center gap-3">
                <Bidi className="text-ink-secondary">{expense.name}</Bidi>
                <Button variant="ghost" size="sm" onClick={() => onEdit(expense)}>
                  {t('plan.edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(expense)}>
                  {t('plan.fixed.stop')}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {(candidates.length > 0 || dismissed.length > 0) && (
        <div className="border border-hairline bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-2.5">
            <BlockHead
              title={
                candidates.length === 1
                  ? t('plan.fixed.candidatesOne')
                  : t('plan.fixed.candidatesMany', { n: candidates.length })
              }
            />
            <label className="flex items-center gap-2 text-caption text-ink-secondary">
              {t('plan.fixed.lookingAt')}
              <select
                className={`${SELECT} h-7`}
                value={windowMonths}
                onChange={(event) => onWindow(Number(event.target.value))}
                aria-label={t('plan.fixed.window')}
              >
                {WINDOW_MONTH_OPTIONS.map((months) => (
                  <option key={months} value={months}>
                    {t('plan.fixed.windowMonths', { n: months })}
                  </option>
                ))}
              </select>
            </label>
            <span className="ms-auto text-caption text-ink-secondary">
              {t('plan.fixed.startsIgnored')}
            </span>
          </div>
          {candidates.map((candidate) => (
            <CandidateCard
              key={`${candidate.merchantNormalized}-${candidate.currency}`}
              candidate={candidate}
              windowMonths={windowMonths}
              onConfirm={(choice) => onTrack(candidate, choice)}
              onDismiss={() => onNotBill(candidate)}
            />
          ))}
          {dismissed.length > 0 && (
            <div className="px-4 py-2">
              <button
                type="button"
                className="text-caption text-ink-secondary underline-offset-4 hover:underline"
                onClick={() => setShowDismissed((current) => !current)}
              >
                {dismissed.length === 1
                  ? t('plan.fixed.dismissedOne')
                  : t('plan.fixed.dismissedMany', { n: dismissed.length })}
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
        </div>
      )}

      {menu !== undefined && (
        <ContextMenu
          at={menu.at}
          header={{ title: <Bidi>{menu.expense.name}</Bidi>, sub: t('plan.fixed.menuSub', { cadence: CADENCE_LABEL[menu.expense.cadence], amount: formatMoney(monthlyShare(menu.expense)) }) }}
          items={[
            { label: t('plan.fixed.menu.edit'), icon: 'edit', onChoose: () => onEdit(menu.expense) },
            {
              label: t('plan.fixed.menu.ended'),
              icon: 'archive',
              detail: t('plan.fixed.menu.endedDetail'),
              onChoose: () => onEnd(menu.expense),
            },
            {
              label: t('plan.fixed.stop'),
              icon: 'trash',
              detail: t('plan.fixed.menu.stopDetail'),
              onChoose: () => setConfirming(menu.expense),
            },
          ]}
          onClose={() => setMenu(undefined)}
        />
      )}
    </section>
  )
}

function Total({ label, list }: { label: string; list: readonly FixedExpense[] }) {
  const total = list.reduce((running, expense) => running + monthlyShare(expense).minor, 0)
  const currency = list[0]?.expectedAmount.currency
  return (
    <span>
      {label}{' '}
      <b className="font-medium text-ink tabular-nums">
        {currency === undefined ? '—' : formatMoney({ minor: total, currency })}
      </b>
    </span>
  )
}

function Table({
  list,
  roles,
  categories,
  actuals,
  month,
  lastComplete,
  onRole,
  onMenu,
}: {
  list: readonly FixedExpense[]
  roles: ReadonlyMap<string, FixedRole>
  categories: readonly Category[]
  actuals: Actuals
  month: YearMonth
  lastComplete: YearMonth
  onRole: (expense: FixedExpense, role: FixedRole) => void
  onMenu: (expense: FixedExpense, at: { readonly x: number; readonly y: number }) => void
}) {
  const t = useT()
  const dates = useDates()
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px]">
        <thead>
          <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
            <th className="py-2 pe-3 text-start font-medium">{t('plan.fixed.column.name')}</th>
            <th className="px-3 py-2 text-start font-medium">{t('plan.fixed.column.howOften')}</th>
            <th className="px-3 py-2 text-end font-medium">{t('plan.fixed.column.eachCharge')}</th>
            <th className="px-3 py-2 text-end font-medium">{t('plan.fixed.column.aMonth')}</th>
            <th className="px-3 py-2 text-start font-medium">{dates.monthShort(lastComplete)}</th>
            <th className="px-3 py-2 text-start font-medium">{t('plan.fixed.column.does')}</th>
            <th className="w-9 py-2" />
          </tr>
        </thead>
        <tbody>
          {list.map((expense) => {
            const role = roles.get(expense.id) ?? 'IGNORE'
            const slip = expense.matchKind === 'PAYCHECK_DEDUCTION'
            const share = monthlyShare(expense)
            const due = expense.cadence === 'MONTHLY' ? undefined : nextChargeMonth(expense, month)
            const day = expense.dayOfMonthHint
            const variance = monthVariance(expense, actualFor(expense, actuals), lastComplete)
            const outside = outsideMonthReason(expense, month)
            return (
              <tr
                key={expense.id}
                className={`h-[52px] border-b border-hairline ${(role === 'IGNORE' && !slip) || outside !== undefined ? 'text-ink-tertiary' : ''}`}
              >
                <td className="py-2 pe-3">
                  <button
                    type="button"
                    className="block text-start font-medium underline-offset-4 hover:underline"
                    onClick={(event) => {
                      const box = event.currentTarget.getBoundingClientRect()
                      onMenu(expense, startEdge(box))
                    }}
                  >
                    <Bidi>{expense.name}</Bidi>
                  </button>
                  <span className="block text-caption text-ink-secondary">
                    <Bidi>{sourceText(expense, categories)}</Bidi>
                  </span>
                </td>
                <td className="px-3 py-2 text-ink-secondary">
                  {CADENCE_LABEL[expense.cadence]}
                  {expense.amountVariability === 'VARIABLE' && expense.cadence === 'MONTHLY' ? t('plan.fixed.varies') : ''}
                  {due !== undefined && (
                    <span className="block text-caption text-ink-secondary">
                      {t('plan.fixed.next', { month: dates.monthShort(due) })}
                      {day === undefined ? '' : ` ${String(day)}`}
                    </span>
                  )}
                  {due === undefined && isChargeMonth(expense, lastComplete) && expense.cadence !== 'MONTHLY' && (
                    <span className="block text-caption text-ink-secondary">{t('plan.fixed.chargedLastMonth')}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-end">
                  <Amount value={expense.expectedAmount} className="text-ink-secondary" />
                </td>
                <td className="px-3 py-2 text-end">
                  <Amount value={share} />
                  {expense.cadence !== 'MONTHLY' && expense.cadence !== 'IRREGULAR' && (
                    <span className="block text-caption text-ink-secondary">{t('plan.fixed.setAsideEachMonth')}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Last variance={variance} />
                </td>
                <td className="px-3 py-2">
                  {slip ? (
                    <span className="text-ink-secondary">{t('plan.fixed.total.alreadyOut')}</span>
                  ) : (
                    <RoleSwitch name={expense.name} role={role} onPick={(next) => onRole(expense, next)} />
                  )}
                  {outside !== undefined && (
                    <span className="mt-0.5 block text-caption text-ink-secondary">
                      {outside === 'NOT_STARTED'
                        ? expense.startedAt === undefined
                          ? t('plan.fixed.startsLater', { month: dates.yearMonth(month) })
                          : t('plan.fixed.startsAt', {
                              month: dates.yearMonth(month),
                              when: dates.monthShort({ year: expense.startedAt.year, month: expense.startedAt.month }),
                            })
                        : expense.endedAt === undefined
                          ? t('plan.fixed.endedEarlier', { month: dates.yearMonth(month) })
                          : t('plan.fixed.endedAt', {
                              month: dates.yearMonth(month),
                              when: dates.monthShort({ year: expense.endedAt.year, month: expense.endedAt.month }),
                            })}
                    </span>
                  )}
                </td>
                <td className="py-2 text-end">
                  <button
                    type="button"
                    aria-label={t('plan.moreFor', { name: expense.name })}
                    className="size-8 text-ink-secondary hover:text-ink"
                    onClick={(event) => {
                      const box = event.currentTarget.getBoundingClientRect()
                      onMenu(expense, startEdge(box))
                    }}
                  >
                    ⋯
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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

function Last({ variance }: { variance: Variance }) {
  const t = useT()
  if (variance.status === 'NOT_DUE' || variance.status === 'NOT_TRACKED') {
    return <span className="text-ink-tertiary">—</span>
  }
  if (variance.status === 'MISSING') return <Chip problem>{t('plan.fixed.noneYet')}</Chip>
  if (variance.actual === undefined) return <span className="text-ink-tertiary">—</span>
  return <Amount value={variance.actual} className="text-ink-secondary" />
}
