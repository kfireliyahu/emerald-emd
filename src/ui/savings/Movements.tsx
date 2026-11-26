import { Fragment, useEffect, useRef, useState } from 'react'

import { money, type CurrencyCode } from '@/core/money.ts'
import { toYearMonthString, yearMonthOf } from '@/core/time.ts'
import { addDeposit, deleteDeposit } from '@/data/repositories/savingsRepository.ts'
import type { DepositSourceKind, Holding, HoldingPlace, SavingDeposit } from '@/domain/model/savings.ts'
import { isContribution } from '@/domain/savings.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { kitMoney } from '@/ui/charts/kit.ts'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { EmptyState } from '@/ui/components/WaitingList.tsx'
import { isDefaultTransferNote } from '@/ui/savings/labels.ts'
import { useWealthWords } from '@/ui/wealth/words.ts'

/**
 * **Every movement toward a goal, newest first, with a subtotal per month**
 * (M28 U8; a view of Goals, M64 U10 gave it the catalogue's words and an Undo).
 *
 * The subtotal is the month's **net**: a withdrawal shows against the deposits
 * beside it, because "what did I actually put away in June" is the question.
 *
 * **Delete deletes at once and says so where it happened** (D-617): the row
 * becomes *Deleted · Undo* for a few seconds, and Ctrl+Z brings it back — the
 * movement, or both halves of a move, written again as they were.
 */
export function Movements({
  deposits,
  goals,
  holdings,
  places,
  currency,
  write,
  onEdit,
}: {
  readonly deposits: readonly SavingDeposit[]
  readonly goals: readonly { readonly id: string; readonly name: string }[]
  readonly holdings: readonly Holding[]
  readonly places: readonly HoldingPlace[]
  readonly currency: CurrencyCode
  readonly write: (work: (database: import('sql.js').Database, now: number) => void) => boolean
  readonly onEdit: (deposit: SavingDeposit) => void
}) {
  const t = useT()
  const words = useWealthWords()
  const [goalFilter, setGoalFilter] = useState<string>('')
  // Filters on the **place**, not the holding: "show me what is at the bank" is
  // the question people ask of a movement list, and a picker with three rows
  // called "Cash" answers a different one.
  const [placeFilter, setPlaceFilter] = useState<string>('')
  const [deleted, setDeleted] = useState<Deleted | undefined>()

  const undo = (): void => {
    if (deleted === undefined) return
    const back = deleted
    setDeleted(undefined)
    write((database, now) => {
      for (const one of back.rows) {
        addDeposit(
          database,
          {
            goalId: one.goalId,
            date: one.date,
            amount: one.amount,
            holdingId: one.holdingId,
            sourceKind: one.sourceKind,
            sourceRefId: one.sourceRefId,
            transferGroupKey: one.transferGroupKey,
            note: one.note,
          },
          now,
        )
      }
    })
  }
  const undoRef = useRef(undo)
  undoRef.current = undo
  // Ctrl+Z undoes the last delete, and the note goes after a few seconds, as anywhere else.
  useEffect(() => {
    if (deleted === undefined) return
    const fade = window.setTimeout(() => setDeleted(undefined), UNDO_MS)
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(fade)
      window.removeEventListener('keydown', onKey)
    }
  }, [deleted])

  const remove = (deposit: SavingDeposit): void => {
    const rows = deposit.transferGroupKey === undefined ? [deposit] : deposits.filter((one) => one.transferGroupKey === deposit.transferGroupKey)
    if (write((database, now) => deleteDeposit(database, deposit.id, now))) setDeleted({ at: deposit.id, period: periodOf(deposit), rows })
  }

  const placeOf = new Map(holdings.map((holding) => [holding.id, holding.holdingPlaceId]))
  const shown = deposits.filter(
    (deposit) => (goalFilter === '' || deposit.goalId === goalFilter) && (placeFilter === '' || placeOf.get(deposit.holdingId) === placeFilter),
  )

  if (deposits.length === 0 && deleted === undefined) {
    return <EmptyState say={t('wealth.goals.movements.empty')} />
  }

  const months = new Map<string, SavingDeposit[]>()
  for (const deposit of shown) months.set(periodOf(deposit), [...(months.get(periodOf(deposit)) ?? []), deposit])
  // A month whose only movement was just deleted keeps its place, so its Undo stays where it was.
  if (deleted !== undefined && !months.has(deleted.period)) months.set(deleted.period, [])

  const goalChoices = [{ value: '', label: t('wealth.goals.movements.everyGoal') }, ...goals.map((goal) => ({ value: goal.id, label: goal.name }))]
  const placeChoices = [{ value: '', label: t('wealth.goals.movements.everywhere') }, ...places.map((place) => ({ value: place.id, label: place.name }))]
  const sources: Readonly<Record<DepositSourceKind, string>> = {
    MANUAL: t('wealth.goals.movements.source.MANUAL'),
    FROM_TRANSACTION: t('wealth.goals.movements.source.FROM_TRANSACTION'),
    FROM_PAYCHECK_DEDUCTION: t('wealth.goals.movements.source.FROM_PAYCHECK_DEDUCTION'),
    FROM_PLAN: t('wealth.goals.movements.source.FROM_PLAN'),
    OPENING_BALANCE: t('wealth.goals.movements.source.OPENING_BALANCE'),
    GROWTH: t('wealth.goals.movements.source.GROWTH'),
  }
  const sourceWord = (kind: DepositSourceKind): string => sources[kind]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChoiceField
          text={goalChoices.find((one) => one.value === goalFilter)?.label ?? ''}
          choices={goalChoices}
          filter={false}
          readOnly
          aria-label={t('wealth.goals.movements.goal')}
          onText={() => undefined}
          onPick={(choice) => setGoalFilter(choice.value)}
          className={`${FIELD} w-52`}
        />
        <ChoiceField
          text={placeChoices.find((one) => one.value === placeFilter)?.label ?? ''}
          choices={placeChoices}
          filter={false}
          readOnly
          aria-label={t('wealth.goals.movements.place')}
          onText={() => undefined}
          onPick={(choice) => setPlaceFilter(choice.value)}
          className={`${FIELD} w-52`}
        />
        <span className="text-caption text-ink-secondary tabular-nums">{t(countKey('wealth.goals.movements.count', shown.length), { count: shown.length })}</span>
      </div>

      <table className="w-full border-collapse">
        <tbody>
          {[...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([period, rows]) => {
            const net = rows.reduce((running, row) => running + row.amount.minor, 0)
            // Once an opening balance or a market gain is among them the net stops
            // answering "what did I put away", so the month says both (D-081).
            const paidIn = rows.filter(isContribution).reduce((running, row) => running + row.amount.minor, 0)
            const [year = 0, month = 1] = period.split('-').map(Number)
            return (
              <Fragment key={period}>
                <tr className="border-b border-hairline text-caption text-ink-secondary">
                  <th colSpan={3} className="h-8 pt-4 text-start font-medium">
                    {words.dates.yearMonth({ year, month })}
                  </th>
                  <th colSpan={2} className="h-8 pt-4 text-end font-medium tabular-nums">
                    {paidIn === net
                      ? t('wealth.goals.movements.net', { amount: kitMoney(money(net, currency)) })
                      : t('wealth.goals.movements.netPaidIn', { amount: kitMoney(money(net, currency)), paidIn: kitMoney(money(paidIn, currency)) })}
                  </th>
                </tr>
                {deleted?.period === period && (
                  <tr className="fc-pop-enter border-b border-hairline">
                    <td colSpan={5} className="h-10 text-ink-secondary">
                      <span className="me-3">{t(countKey('wealth.goals.movements.deleted', deleted.rows.length), { count: deleted.rows.length })}</span>
                      <button type="button" className="fc-text-action" onClick={undo} title={t('wealth.goals.movements.undoTitle')}>
                        {t('wealth.common.undo')}
                      </button>
                    </td>
                  </tr>
                )}
                {rows.map((deposit) => {
                  const goal = goals.find((one) => one.id === deposit.goalId)
                  const holding = holdings.find((one) => one.id === deposit.holdingId)
                  const place = places.find((one) => one.id === holding?.holdingPlaceId)
                  const isTransfer = deposit.transferGroupKey !== undefined
                  return (
                    <tr key={deposit.id} className="border-b border-hairline">
                      <td className="h-10 w-24 pe-3 text-ink-secondary tabular-nums">{words.dates.dayMonth(deposit.date)}</td>
                      <td className="h-10 pe-3">
                        {goal === undefined ? t('wealth.goals.movements.goneGoal') : <Bidi>{goal.name}</Bidi>}
                        {deposit.note !== undefined && !isDefaultTransferNote(deposit) && (
                          <span className="ms-2 text-caption text-ink-secondary">
                            <Bidi>{deposit.note}</Bidi>
                          </span>
                        )}
                      </td>
                      <td className="h-10 pe-3 text-caption text-ink-secondary">
                        {place === undefined ? t('wealth.goals.movements.nowhere') : <Bidi>{place.name}</Bidi>}
                        {isTransfer ? ` · ${t('wealth.goals.movements.moved')}` : deposit.sourceKind === 'MANUAL' ? '' : ` · ${sourceWord(deposit.sourceKind)}`}
                      </td>
                      <td className="h-10 pe-3 text-end whitespace-nowrap tabular-nums">{kitMoney(deposit.amount)}</td>
                      <td className="h-10 w-1 text-end whitespace-nowrap">
                        {/* A generated deposit is not editable here: it is what a payslip says, and the payslip is where it changes. */}
                        {deposit.sourceKind === 'MANUAL' && !isTransfer && (
                          <button type="button" className="fc-text-action me-3" onClick={() => onEdit(deposit)}>
                            {t('wealth.common.edit')}
                          </button>
                        )}
                        <button type="button" className="fc-text-action" onClick={() => remove(deposit)}>
                          {isTransfer ? t('wealth.goals.movements.deleteBoth') : t('wealth.common.delete')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** How long *Deleted · Undo* stays where the movement was. */
const UNDO_MS = 8000

interface Deleted {
  readonly at: string
  readonly period: string
  /** What the delete took: the movement, or both halves of a move. */
  readonly rows: readonly SavingDeposit[]
}

function periodOf(deposit: SavingDeposit): string {
  return toYearMonthString(yearMonthOf(deposit.date))
}
