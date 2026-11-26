import { useState } from 'react'

import { formatMoney, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { monthsBetween, parseISODate, yearMonthOf, type LocalDate } from '@/core/time.ts'
import { createCategory } from '@/data/repositories/categoryRepository.ts'
import type { HoldingPutIn } from '@/data/repositories/goalDepositRepository.ts'
import type { GoalAnswer, WhereAnswer, WhereChoice } from '@/data/repositories/goalWhereRepository.ts'
import type { SavingGoal } from '@/domain/model/savings.ts'
import { countKey } from '@/i18n/count.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { moneyFromText } from '@/ui/components/moneyText.ts'
import { AmountInput, DateInput, FormField, FormGrid, MoreFields, PanelForm, Said } from '@/ui/components/PanelForm.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { NEW_CHOICE, NewByName } from '@/ui/components/SelectOrNew.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { useWealthWords } from '@/ui/wealth/words.ts'
import { CostBasis } from './CostBasis.tsx'
import { WherePicker } from './WherePicker.tsx'

/** A Money moved category the fold can read a goal's deposits from. */
export interface FoldCategory {
  readonly id: string
  readonly path: string
  /** Another goal already reads it: that goal's name. */
  readonly takenBy: string | undefined
}

/**
 * **A goal asks one question: where is the money** (M30 F3, the approved mockup,
 * `docs/mockups/m30-f3/goal-form.html`) — a `PanelForm` beside the goals since
 * M64 F3 (D-629).
 *
 * Its name, where the money is, and — if it has one — what it is for and by
 * when, said back as a sum a month; **the answer to *where* decides the rest**.
 * A bank account, a broker's cash or a place kept by hand asks *how much of it
 * is already there*; a holding a broker's rows buy is followed by its rows, and
 * what it is worth shows before saving; **+ New…** makes a place without leaving
 * the form. A Money moved category is the advanced choice, folded away with the
 * note. Everything is one write (`saveGoalAnswer`), so Cancel leaves nothing.
 *
 * **Under a bank account's answer, one tick** (M30 F4, D-364): *Transfers into it
 * are for this goal*. Off by default, because a main account receives transfers
 * that are not for a goal. It and the fold's category are one source: choosing
 * one clears the other.
 *
 * **What a goal is for is not asked** (M36 U11): a goal keeps the kind it had;
 * a new one is `EARMARKED`, as `blankGoal` says.
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
  const t = useT()
  const { dates } = useWealthWords()
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
  const noCategory = t('wealth.goalForm.noCategory')
  const [categoryText, setCategoryText] = useState(categories.find((one) => one.id === initialCategoryId)?.path ?? noCategory)

  const pickCategory = (id: string | undefined, label: string): void => {
    setCategoryId(id)
    setCategoryText(label)
    if (id !== undefined) setTransfersIn(false)
  }

  const saveWord = isNew ? t('wealth.goalForm.add') : t('wealth.reading.save')
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
  const goalName = name.trim() === '' ? t('wealth.goalForm.thisGoal') : name.trim()

  const local: string[] = []
  if (name.trim() === '' && name !== initial.name) local.push(t('wealth.goalForm.nameIt'))
  if (targetText.trim() !== '' && target === undefined) local.push(t('wealth.goalForm.targetNumber'))
  if (asks && alreadyText.trim() !== '' && already === undefined) local.push(t('wealth.goalForm.alreadyNumber'))
  if (category?.takenBy !== undefined) local.push(t('wealth.goalForm.categoryTaken', { name: category.takenBy, category: category.path }))
  const canSave = local.length === 0 && name.trim() !== ''

  const save = (): void => {
    if (!canSave) return
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
    <PanelForm save={saveWord} canSave={canSave} onSave={save} onCancel={onCancel} problems={[...local, ...(problem === undefined ? [] : [problem])]}>
      <FormField label={t('wealth.goalForm.name')}>
        <input className={FIELD} value={name} onChange={(event) => setName(event.target.value)} />
      </FormField>

      <div className="flex flex-col gap-1">
        <span className="text-label text-ink-secondary uppercase">{t('wealth.goalForm.where')}</span>
        <WherePicker
          choices={choices}
          value={where}
          saveWord={saveWord}
          onChange={(next) => {
            setWhere(next)
            setAlreadyText('')
            setTransfersIn(initialTransfers && next?.kind === 'HOLDING' && next.holdingId === initial.defaultHoldingId)
          }}
        />
      </div>

      {asks && (
        <div className="fc-pop-enter flex flex-col gap-2 border-s-2 border-hairline-strong ps-4">
          <AmountInput
            label={t('wealth.goalForm.already')}
            currency={currency}
            placeholder="0"
            value={alreadyText}
            onChange={(event) => setAlreadyText(event.target.value)}
          />
          <AlreadyThere chosen={chosen} isNewPlace={where?.kind === 'NEW'} already={already} asOf={asOf} t={t} dates={dates} />
        </div>
      )}

      {bankAnswer !== undefined && (
        <TransfersIn
          account={bankAnswer}
          goalName={goalName}
          checked={countsTransfers}
          t={t}
          onChange={(next) => {
            setTransfersIn(next)
            // One source: ticking it is the answer's own way, so the fold's category goes.
            if (next) {
              setCategoryId(undefined)
              setCategoryText(noCategory)
            }
          }}
        />
      )}

      {follows && chosen !== undefined && <Follows chosen={chosen} fed={putInOf(chosen.holdingId)} t={t} dates={dates} />}

      <FormGrid>
        <AmountInput
          label={t('wealth.goalForm.target')}
          currency={currency}
          placeholder={t('wealth.goalForm.targetNone')}
          value={targetText}
          onChange={(event) => setTargetText(event.target.value)}
        />
        <FormField label={t('wealth.goalForm.byWhen')}>
          <DateInput value={targetDate} onChange={(date) => setTargetDate(date ?? undefined)} />
        </FormField>
      </FormGrid>
      <Said>{targetSaid(target, already, targetDate, asOf, t, dates)}</Said>

      <MoreFields
        label={t('wealth.goalForm.more')}
        summary={t('wealth.goalForm.moreSummary')}
        initiallyOpen={initialCategoryId !== undefined || (initial.note ?? '') !== ''}
      >
        <div className="flex flex-col gap-2">
          <span className="text-label text-ink-secondary uppercase">{t('wealth.goalForm.fromCategory')}</span>
          <ChoiceField
            readOnly
            filter={false}
            className={FIELD}
            text={categoryText}
            aria-label={t('wealth.goalForm.fromCategory')}
            choices={[
              { value: '', label: noCategory },
              ...categories.map((one) => ({
                value: one.id,
                label: one.path,
                detail: one.takenBy === undefined ? undefined : t('wealth.goalForm.readBy', { name: one.takenBy }),
              })),
              { value: NEW_CHOICE, label: t('chrome.components.newChoice') },
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
              noun={t('wealth.goalForm.categoryNoun')}
              make={(db, categoryName, _kind, now) => createCategory(db, { name: categoryName, kind: 'SAVING' }, now)}
              done={(id, categoryName) => {
                setMakingCategory(false)
                if (id !== undefined) pickCategory(id, categoryName ?? '')
              }}
            />
          )}
          <p className="m-0 text-caption text-ink-secondary">
            {way === 'FOLLOWS_ROWS' && chosen !== undefined ? (
              <Phrase text={t('wealth.goalForm.insteadOfRows')} parts={{ name: <Bidi>{chosen.name}</Bidi> }} />
            ) : countsTransfers && bankAnswer !== undefined ? (
              <Phrase text={t('wealth.goalForm.insteadOfTransfers')} parts={{ name: <Bidi>{bankAnswer.name}</Bidi> }} />
            ) : (
              <Phrase text={t('wealth.goalForm.categoryReads')} parts={{ goal: <Bidi>{goalName}</Bidi> }} />
            )}
          </p>
        </div>
        <FormField label={t('wealth.goalForm.note')}>
          <textarea className={`${FIELD_MULTILINE} min-h-16`} value={note} onChange={(event) => setNote(event.target.value)} />
        </FormField>
      </MoreFields>
    </PanelForm>
  )
}

/**
 * **The target, said as a sum a month**: what is left to the date (less what is
 * already there), spread over
 * the months until it — the figure the goal's line on Plan will ask for, said
 * before saving rather than discovered after.
 */
function targetSaid(target: Money | undefined, already: Money | undefined, due: LocalDate | undefined, asOf: LocalDate, t: Translate, dates: DateWords): string {
  if (target === undefined || target.minor === 0) return t('wealth.goalForm.saidOpen')
  if (due === undefined) return t('wealth.goalForm.saidNoDate', { amount: formatMoney(target) })
  const months = monthsBetween(yearMonthOf(asOf), yearMonthOf(due))
  const when = dates.yearMonth(yearMonthOf(due))
  if (months <= 0) return t('wealth.goalForm.saidPast', { amount: formatMoney(target), when })
  const left = Math.max(0, target.minor - (already?.minor ?? 0))
  const monthly = money(Math.ceil(left / months), target.currency)
  return t(countKey('wealth.goalForm.saidMonthly', months), { amount: formatMoney(target), when, monthly: formatMoney(monthly), count: months })
}

/** Under *How much of it is already there?*: what it will be counted as, and what stays free. */
function AlreadyThere({
  chosen,
  isNewPlace,
  already,
  asOf,
  t,
  dates,
}: {
  chosen: WhereChoice | undefined
  isNewPlace: boolean
  already: Money | undefined
  asOf: LocalDate
  t: Translate
  dates: DateWords
}) {
  const on = dates.dayMonth(asOf)
  const figure = chosen?.figure
  const byHand = isNewPlace || chosen?.group.kind === 'BY_HAND'
  const left = figure?.kind === 'ON' && already !== undefined ? figure.amount.minor - already.minor : undefined
  return (
    <>
      <p className="m-0 text-caption text-ink-secondary">
        {t('wealth.goalForm.countedAs', { on })}{' '}
        {byHand ? (
          t('wealth.goalForm.byHand')
        ) : left !== undefined && left >= 0 && figure?.kind === 'ON' && chosen !== undefined ? (
          <Phrase
            text={t('wealth.goalForm.staysFree')}
            parts={{ amount: <b className="font-medium text-ink tabular-nums">{formatMoney(money(left, figure.amount.currency))}</b>, name: <Bidi>{chosen.name}</Bidi> }}
          />
        ) : null}
      </p>
      {left !== undefined && left < 0 && figure?.kind === 'ON' && chosen !== undefined && (
        <p className="m-0 text-caption text-ink">
          <Phrase text={t('wealth.goalForm.moreThanThere')} parts={{ name: <Bidi>{chosen.name}</Bidi>, amount: formatMoney(figure.amount) }} />
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
  t,
}: {
  account: WhereChoice
  goalName: string
  checked: boolean
  onChange: (next: boolean) => void
  t: Translate
}) {
  const taken = account.transfersReadBy
  return (
    <div className="flex flex-col gap-1 border-s-2 border-hairline-strong ps-4">
      <label className={`flex items-center gap-2 select-none ${taken === undefined ? '' : 'text-ink-secondary'}`}>
        <input type="checkbox" checked={checked} disabled={taken !== undefined} onChange={(event) => onChange(event.target.checked)} />
        <span>
          <Phrase text={t('wealth.goalForm.transfersIn')} parts={{ name: <Bidi>{account.name}</Bidi> }} />
        </span>
      </label>
      <p className="m-0 text-caption text-ink-secondary">
        {taken !== undefined ? (
          <Phrase text={t('wealth.goalForm.transfersTaken')} parts={{ name: <Bidi>{taken}</Bidi> }} />
        ) : checked ? (
          <Phrase text={t('wealth.goalForm.transfersOn')} parts={{ name: <Bidi>{account.name}</Bidi>, goal: <Bidi>{goalName}</Bidi> }} />
        ) : (
          t('wealth.goalForm.transfersOff')
        )}
      </p>
    </div>
  )
}

/** A holding bought by rows: the goal follows them, and what it is worth shows now. */
function Follows({ chosen, fed, t, dates }: { chosen: WhereChoice; fed: HoldingPutIn; t: Translate; dates: DateWords }) {
  const figure = chosen.figure
  const at = chosen.group.kind === 'HELD' ? chosen.group.placeName : undefined
  const on = figure?.kind === 'ON' ? parseISODate(figure.on) : undefined
  return (
    <div className="flex flex-col gap-2 border-s-2 border-hairline-strong ps-4">
      <span>
        <Phrase text={t('wealth.goalForm.follows')} parts={{ name: <Bidi>{chosen.name}</Bidi> }} />
      </span>
      <p className="m-0 text-caption text-ink-secondary tabular-nums">
        {figure?.kind === 'ON'
          ? t('wealth.goalForm.worth', { amount: formatMoney(figure.amount), on: on === undefined ? figure.on : dates.dayMonth(on), putIn: formatMoney(fed.putIn) })
          : t('wealth.goalForm.notRead', { putIn: formatMoney(fed.putIn) })}
      </p>
      <CostBasis fed={fed} />
      <p className="m-0 text-caption text-ink-secondary">
        {at === undefined ? t('wealth.goalForm.sameMoney') : <Phrase text={t('wealth.goalForm.sameMoneyAt')} parts={{ at: <Bidi>{at}</Bidi> }} />}
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
