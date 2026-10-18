import { useState } from 'react'

import { currencySymbol, formatMoney, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { createCategory } from '@/data/repositories/categoryRepository.ts'
import type { HoldingPutIn } from '@/data/repositories/goalDepositRepository.ts'
import type { GoalAnswer, WhereAnswer, WhereChoice } from '@/data/repositories/goalWhereRepository.ts'
import type { SavingGoal } from '@/domain/model/savings.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { moneyFromText } from '@/ui/components/moneyText.ts'
import { NEW_CHOICE, NewByName } from '@/ui/components/SelectOrNew.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { CostBasis } from './CostBasis.tsx'
import { dayMonth, WherePicker } from './WherePicker.tsx'

/** A Money moved category the fold can read a goal's deposits from. */
export interface FoldCategory {
  readonly id: string
  readonly path: string
  /** Another goal already reads it: that goal's name. */
  readonly takenBy: string | undefined
}

/**
 * **A goal asks one question: where is the money** (M30 F3, the approved mockup,
 * `docs/mockups/m30-f3/goal-form.html`).
 *
 * Its name, and where the money is; **the answer decides the rest**. A bank
 * account, a broker's cash or a place kept by hand asks *how much of it is already
 * there*; a holding a broker's rows buy is followed by its rows, and what it is worth
 * shows before saving; **+ New…** makes a place without leaving the form. A Money
 * moved category is the advanced choice, folded away. Everything is one write
 * (`saveGoalAnswer`), so Cancel leaves nothing behind.
 *
 * **Under a bank account's answer, one tick** (M30 F4, D-364): *Transfers into it are
 * for this goal*. Off by default, because a main account receives transfers that are
 * not for a goal; ticked, every confirmed transfer arriving there is a deposit. It and
 * the fold's category are one source: choosing one clears the other.
 *
 * **What a goal is for is not asked** (M36 U11): an Emergency goal became an ordinary
 * goal (M36 U09, its months went to the cushion), so the kind drove nothing a person
 * sees. A goal keeps the kind it had; a new one is `EARMARKED`, as `blankGoal` says.
 */
export function GoalEditor({
  initial,
  isNew,
  choices,
  categories,
  initialCategoryId,
  initialTransfers = false,
  putInOf,
  currency,
  asOf,
  problem,
  onSave,
  onCancel,
}: {
  initial: SavingGoal
  isNew: boolean
  /** Every answer to *Where is the money?*, from `whereChoices`. */
  choices: readonly WhereChoice[]
  categories: readonly FoldCategory[]
  /** The category that feeds the goal now, when one does. */
  initialCategoryId: string | undefined
  /** The transfers into its account feed the goal now (M30 F4). */
  initialTransfers?: boolean
  /** What a holding's rows put in, and whether that is its cost (D-357). */
  putInOf: (holdingId: string) => HoldingPutIn
  currency: CurrencyCode
  asOf: LocalDate
  /** Why the last save was refused, from the write. */
  problem: string | undefined
  onSave: (answer: GoalAnswer) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [targetText, setTargetText] = useState(() =>
    initial.targetAmount === undefined ? '' : formatMoney(initial.targetAmount, { symbol: false }),
  )
  const [targetDate, setTargetDate] = useState(initial.targetDate)
  const [note, setNote] = useState(initial.note ?? '')
  const [where, setWhere] = useState<WhereAnswer>(
    initial.defaultHoldingId === undefined ? undefined : { kind: 'HOLDING', holdingId: initial.defaultHoldingId },
  )
  const [alreadyText, setAlreadyText] = useState('')
  const [categoryId, setCategoryId] = useState(initialCategoryId)
  const [transfersIn, setTransfersIn] = useState(initialTransfers)
  const [makingCategory, setMakingCategory] = useState(false)
  const [categoryText, setCategoryText] = useState(
    categories.find((one) => one.id === initialCategoryId)?.path ?? NO_CATEGORY,
  )

  const pickCategory = (id: string | undefined, label: string): void => {
    setCategoryId(id)
    setCategoryText(label)
    if (id !== undefined) setTransfersIn(false)
  }

  const saveWord = isNew ? 'Add goal' : 'Save'
  const chosen = where?.kind === 'HOLDING' ? choices.find((one) => one.holdingId === where.holdingId) : undefined
  const way = where === undefined ? undefined : where.kind === 'NEW' ? 'ALREADY_THERE' : chosen?.way
  // The money already there is asked when the place is new to the goal: a goal
  // already there has its deposits on its drawer.
  const asks =
    way === 'ALREADY_THERE' &&
    (isNew || where?.kind === 'NEW' || (where?.kind === 'HOLDING' && where.holdingId !== initial.defaultHoldingId))
  const follows = way === 'FOLLOWS_ROWS' && categoryId === undefined
  // Only a bank account's answer can count the transfers into it.
  const bankAnswer = where?.kind === 'HOLDING' && chosen?.group.kind === 'BANK' ? chosen : undefined
  const countsTransfers = bankAnswer !== undefined && transfersIn && bankAnswer.transfersReadBy === undefined

  const target = moneyFromText(targetText, currency, { magnitude: true })
  const already = asks ? moneyFromText(alreadyText, currency, { magnitude: true }) : undefined
  const category = categories.find((one) => one.id === categoryId)

  const local: string[] = []
  if (name.trim() === '') local.push('Give it a name')
  if (targetText.trim() !== '' && target === undefined) local.push('Type the target as a number')
  if (asks && alreadyText.trim() !== '' && already === undefined) local.push('Type how much is there as a number')
  if (category?.takenBy !== undefined) local.push(`${category.takenBy} already reads ${category.path}`)

  const save = (): void => {
    if (local.length > 0) return
    onSave({
      ...(isNew ? {} : { goalId: initial.id }),
      name,
      // What a goal is for is asked no more: it drove nothing a person sees (M36 U11).
      kind: initial.kind,
      targetAmount: target,
      targetDate,
      note,
      where,
      alreadyThere: already === undefined || already.minor === 0 ? undefined : { amount: already, date: asOf },
      categoryId,
      transfersIn: countsTransfers,
    })
  }

  return (
    <form
      className="fc-view-enter h-full overflow-auto"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="max-w-3xl px-6 py-6">
        <h1 className="text-title">{isNew ? 'Add a goal' : 'Edit goal'}</h1>
        <p className="mt-1 mb-6 text-caption text-ink-tertiary">
          Its name, and where the money is. The rest follows from that.
        </p>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Name">
              <input className={FIELD} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>

          <Field label="Target amount" hint="optional — open-ended goals are fine">
            <input
              className={`${FIELD} tabular-nums`}
              inputMode="decimal"
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
            />
          </Field>

          <Field label="By when" hint="drives the how-much-a-month figure">
            <input
              type="date"
              className={`${FIELD} tabular-nums`}
              value={targetDate === undefined ? '' : toISODate(targetDate)}
              onChange={(event) => setTargetDate(parseISODate(event.target.value) ?? undefined)}
            />
          </Field>
        </div>

        <div className="mt-6 flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">Where is the money?</span>
          <WherePicker
            choices={choices}
            value={where}
            saveWord={saveWord}
            onChange={(next) => {
              setWhere(next)
              setAlreadyText('')
              setTransfersIn(
                initialTransfers && next?.kind === 'HOLDING' && next.holdingId === initial.defaultHoldingId,
              )
            }}
          />
        </div>

        {asks && (
          <div className="fc-pop-enter mt-2.5 flex flex-col gap-2 border-l-2 border-hairline-strong py-1 pl-4">
            <label htmlFor="already-there">How much of it is already there?</label>
            <span className="flex w-56 items-baseline gap-2 border-b border-hairline-strong pb-1 focus-within:border-b-2 focus-within:border-accent focus-within:pb-[3px]">
              <span className="text-[18px] text-ink-secondary">{currencySymbol(currency)}</span>
              <input
                id="already-there"
                inputMode="decimal"
                value={alreadyText}
                onChange={(event) => setAlreadyText(event.target.value)}
                placeholder="0.00"
                className="min-w-0 flex-1 border-0 bg-transparent text-[22px] font-medium tabular-nums outline-none placeholder:text-ink-tertiary"
              />
            </span>
            <AlreadyThere chosen={chosen} isNewPlace={where?.kind === 'NEW'} already={already} asOf={asOf} />
          </div>
        )}

        {bankAnswer !== undefined && (
          <TransfersIn
            account={bankAnswer}
            goalName={name.trim() === '' ? 'this goal' : name.trim()}
            checked={countsTransfers}
            onChange={(next) => {
              setTransfersIn(next)
              // One source: ticking it is the answer's own way, so the fold's category goes.
              if (next) {
                setCategoryId(undefined)
                setCategoryText(NO_CATEGORY)
              }
            }}
          />
        )}

        {follows && chosen !== undefined && <Follows chosen={chosen} fed={putInOf(chosen.holdingId)} />}

        <details className="group mt-5" open={initialCategoryId !== undefined}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-ink-secondary [&::-webkit-details-marker]:hidden">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="transition-transform group-open:rotate-90">
              <path d="M3.5 2l3 3-3 3" />
            </svg>
            Find its deposits another way
          </summary>
          <div className="mt-2.5 flex flex-col gap-2 border border-hairline bg-surface px-3.5 py-3">
            <span className="text-label text-ink-tertiary uppercase">Read them from a category</span>
            <>
                <ChoiceField
                  readOnly
                  filter={false}
                  className={FIELD}
                  text={categoryText}
                  aria-label="Read them from a category"
                  choices={[
                    { value: '', label: NO_CATEGORY },
                    ...categories.map((one) => ({
                      value: one.id,
                      label: one.path,
                      detail: one.takenBy === undefined ? undefined : `${one.takenBy} reads it`,
                    })),
                    { value: NEW_CHOICE, label: '+ New…' },
                  ]}
                  onText={setCategoryText}
                  onPick={(choice) => {
                    if (choice.value === NEW_CHOICE) {
                      setMakingCategory(true)
                      return
                    }
                    setMakingCategory(false)
                    pickCategory(choice.value === '' ? undefined : choice.value, choice.label)
                  }}
                />
                {makingCategory && (
                  // A Money moved category, made here and chosen (M31 U6).
                  <NewByName
                    noun="Money moved category"
                    make={(db, categoryName, _kind, now) => createCategory(db, { name: categoryName, kind: 'SAVING' }, now)}
                    done={(id, categoryName) => {
                      setMakingCategory(false)
                      if (id !== undefined) pickCategory(id, categoryName ?? '')
                    }}
                  />
                )}
                <p className="m-0 text-caption text-ink-secondary">
                  {way === 'FOLLOWS_ROWS' && chosen !== undefined ? (
                    <>
                      Instead of the rows that bought or sold <Bidi>{chosen.name}</Bidi>. One source only, so nothing
                      counts twice.
                    </>
                  ) : countsTransfers && bankAnswer !== undefined ? (
                    <>
                      Instead of the transfers into <Bidi>{bankAnswer.name}</Bidi>. One source only, so nothing counts
                      twice.
                    </>
                  ) : (
                    <>
                      Every transaction you categorize under it is a deposit into{' '}
                      <Bidi>{name.trim() === '' ? 'this goal' : name.trim()}</Bidi>, read from the bank. One source
                      only, so nothing counts twice.
                    </>
                  )}
                </p>
            </>
          </div>
        </details>

        <div className="mt-5 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <Field label="Note">
            <textarea className={`${FIELD_MULTILINE} min-h-8`} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" icon="check" type="submit" disabled={local.length > 0}>
            {saveWord}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {[...local, ...(problem === undefined ? [] : [problem])].map((one) => (
              <span key={one}>{one}</span>
            ))}
          </span>
        </div>
      </div>
    </form>
  )
}

const NO_CATEGORY = 'Not from a category'

/** Under *How much of it is already there?*: what it will be counted as, and what stays free. */
function AlreadyThere({
  chosen,
  isNewPlace,
  already,
  asOf,
}: {
  chosen: WhereChoice | undefined
  isNewPlace: boolean
  already: Money | undefined
  asOf: LocalDate
}) {
  const on = dayMonth(toISODate(asOf))
  const figure = chosen?.figure
  const byHand = isNewPlace || chosen?.group.kind === 'BY_HAND'
  const left = figure?.kind === 'ON' && already !== undefined ? figure.amount.minor - already.minor : undefined
  return (
    <>
      <p className="m-0 max-w-[58ch] text-caption text-ink-secondary">
        Counted as <b className="font-medium text-ink">Was already there</b>, on {on}.
        {byHand ? (
          ' No statement says what is in it, so you add to it from the goal, as today.'
        ) : left !== undefined && left >= 0 && figure?.kind === 'ON' && chosen !== undefined ? (
          <>
            {' '}
            The other <b className="font-medium text-ink tabular-nums">{formatMoney(money(left, figure.amount.currency))}</b> in{' '}
            <Bidi>{chosen.name}</Bidi> stays free.
          </>
        ) : null}
      </p>
      {left !== undefined && left < 0 && figure?.kind === 'ON' && chosen !== undefined && (
        <p className="m-0 text-caption text-flow-tax">
          More than <Bidi>{chosen.name}</Bidi>’s {formatMoney(figure.amount)} on its last statement.
        </p>
      )}
    </>
  )
}

/**
 * Under a bank account's answer (M30 F4): whether the transfers arriving there are this
 * goal's. Off by default; another goal already counting them leaves it shown, and off.
 */
function TransfersIn({
  account,
  goalName,
  checked,
  onChange,
}: {
  account: WhereChoice
  goalName: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const taken = account.transfersReadBy
  return (
    <div className="mt-2.5 flex flex-col gap-1 border-l-2 border-hairline-strong py-1 pl-4">
      <label className={`flex items-center gap-2 select-none ${taken === undefined ? '' : 'text-ink-tertiary'}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={taken !== undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          Transfers into <Bidi>{account.name}</Bidi> are for this goal
        </span>
      </label>
      <p className="m-0 max-w-[58ch] text-caption text-ink-secondary">
        {taken !== undefined ? (
          <>
            They already count for <Bidi>{taken}</Bidi>. One goal per account, so a transfer is never counted twice.
          </>
        ) : checked ? (
          <>
            Every transfer you confirm arriving in <Bidi>{account.name}</Bidi> is a deposit into <Bidi>{goalName}</Bidi>,
            and one leaving it a withdrawal. What was already there covers the ones before it.
          </>
        ) : (
          <>Leave it off when the account also takes money that is not for this goal, like a salary.</>
        )}
      </p>
    </div>
  )
}

/** A holding bought by rows: the goal follows them, and what it is worth shows now. */
function Follows({ chosen, fed }: { chosen: WhereChoice; fed: HoldingPutIn }) {
  const figure = chosen.figure
  const at = chosen.group.kind === 'HELD' ? chosen.group.placeName : undefined
  return (
    <div className="mt-2.5 flex flex-col gap-2 border-l-2 border-hairline-strong py-1 pl-4">
      <span>
        Follows the rows that bought or sold <Bidi>{chosen.name}</Bidi>
      </span>
      <p className="m-0 text-caption text-ink-secondary">
        {figure?.kind === 'ON' ? (
          <>
            Worth <b className="font-medium text-ink tabular-nums">{formatMoney(figure.amount)}</b> by its reading of{' '}
            {dayMonth(figure.on)}
          </>
        ) : (
          'No reading of it yet'
        )}{' '}
        · put in <b className="font-medium text-ink tabular-nums">{formatMoney(fed.putIn)}</b>
      </p>
      <CostBasis fed={fed} />
      <p className="m-0 text-caption text-ink-secondary">
        The transfer that brought the cash to {at === undefined ? 'it' : <Bidi>{at}</Bidi>} is not a deposit: it is the
        same money.
      </p>
    </div>
  )
}

/** A blank goal to open the editor on. */
export function blankGoal(): SavingGoal {
  return {
    id: 'new',
    name: '',
    targetAmount: undefined,
    targetDate: undefined,
    kind: 'EARMARKED',
    defaultHoldingId: undefined,
    isClosed: false,
    priority: 0,
    note: undefined,
  }
}

