import { useState, type ReactNode } from 'react'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { makePlace, NEW_PLACE_KINDS } from '@/data/repositories/goalWhereRepository.ts'
import type { Holding, HoldingPlace, SavingDeposit, SavingGoal } from '@/domain/model/savings.ts'
import {
  DEPOSIT_MODES,
  modeOf,
  signedAmount,
  sourceKindFor,
  type DepositMode,
} from '@/domain/depositEntry.ts'
import {
  depositWarnings,
  validateDeposit,
  type DepositProblem,
  type DepositWarning,
} from '@/domain/savings.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'
import { NewByName, SelectOrNew } from '@/ui/components/SelectOrNew.tsx'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'
import { NEW_KIND_LABEL } from '@/ui/savings/WherePicker.tsx'

/**
 * Every way a savings balance can change, as one form with six modes.
 *
 * **The sign is a mode, not a minus the user types.** A withdrawal is stored as
 * a negative deposit, which is what keeps a balance a single sum (docs/f07), but
 * asking someone to express "I took ₪2,000 out" by typing a minus in front of an
 * amount is how a deposit gets recorded as a withdrawal at two in the morning.
 * The payslip form made the same call about its two amount columns (D-048).
 *
 * **A withdrawal has to say why**, which is the price of modelling it as a
 * negative: without the note there is nothing on the row to distinguish a
 * withdrawal from a correction, and a balance that dropped for no recorded
 * reason is the kind of thing that makes people stop trusting the number.
 *
 * **Taking out more than the balance is allowed, and says so.** docs/f07 is
 * explicit: the user's records may simply be incomplete, and an app that argues
 * with something that already happened is worse than one that notes it.
 *
 * **Moving between holdings is not a contribution**, and the third mode exists
 * so it cannot be recorded as one. It writes two legs that net to zero, so the
 * goal's balance is untouched and only the liquid/locked split moves — which
 * since D-175 can happen *inside* one place, when cash goes into the deposit at
 * the same bank.
 *
 * **The last three modes are the same argument again** (D-081). Money that was
 * already there when tracking started, and money the market added or took away,
 * are both really in the balance and neither is money the user set aside. As
 * `MANUAL` rows — which is all this form could offer before — a ₪200,000 opening
 * balance would report as the best savings month of someone's life. So the mode
 * picks the `sourceKind`, the same way it picks the sign, and a gain and a loss
 * are two modes rather than one field where a minus decides which.
 */
export type DepositDraft =
  | { readonly kind: 'ENTRY'; readonly deposit: SavingDeposit }
  | {
      readonly kind: 'TRANSFER'
      readonly goalId: string
      readonly date: LocalDate
      readonly amount: Money
      readonly fromHoldingId: string
      readonly toHoldingId: string
      readonly note: string | undefined
    }


export function DepositEditor({
  initial,
  isNew,
  goals,
  holdings,
  places,
  existing,
  currency,
  onSave,
  onCancel,
}: {
  initial: SavingDeposit
  isNew: boolean
  goals: readonly SavingGoal[]
  /** Where money can land. **Money always lands in a holding** (D-175). */
  holdings: readonly Holding[]
  /** Only to say which place each holding is at, in the picker's label. */
  places: readonly HoldingPlace[]
  /** Every deposit of the goal — what "more than the balance" is judged against. */
  existing: readonly SavingDeposit[]
  currency: CurrencyCode
  onSave: (draft: DepositDraft) => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<DepositMode>(() => modeOf(initial))
  const [draft, setDraft] = useState(initial)
  const [toHoldingId, setToHoldingId] = useState<string>(
    () =>
      holdings.find((holding) => holding.id !== initial.holdingId)?.id ?? initial.holdingId,
  )

  // "Bank Hapoalim · Fixed deposit". The place alone stopped being an answer to
  // "where does this money sit" when one place could hold several things, and
  // the holding alone would list three rows called "Cash".
  const holdingLabel = (holding: Holding): string => {
    const place = places.find((one) => one.id === holding.holdingPlaceId)
    return place === undefined ? holding.name : `${place.name} · ${holding.name}`
  }
  const holdingOptions = holdings.map((holding) => (
    <option key={holding.id} value={holding.id}>
      {holdingLabel(holding)}
    </option>
  ))
  // A holding is a place holding one thing, as the goal form's *+ New…* makes it (M31 U6).
  const newHolding = (done: (id: string | undefined) => void): ReactNode => (
    <NewByName
      noun="holding"
      kinds={NEW_PLACE_KINDS.map((kind) => [kind, NEW_KIND_LABEL[kind]] as const)}
      make={(db, name, kind, now) => makePlace(db, { kind: kind ?? 'CASH_AT_HOME', name }, now)}
      done={done}
    />
  )
  const [amountText, setAmountText] = useState(() =>
    editableMoney(initial.amount, { unsigned: true }),
  )

  const set = (change: Partial<SavingDeposit>): void =>
    setDraft((current) => ({ ...current, ...change }))

  const magnitude = Math.abs(moneyFromText(amountText, currency)?.minor ?? 0)
  const signed = signedAmount(mode, magnitude, currency)
  // The kind follows the mode only on a new movement. An edit keeps what was
  // stored — `updateDeposit` does not write the column, and a form that
  // pretended otherwise would disagree with the row it saved.
  const candidate: SavingDeposit = {
    ...draft,
    amount: signed,
    sourceKind: isNew ? sourceKindFor(mode) : draft.sourceKind,
  }

  const goal = goals.find((one) => one.id === candidate.goalId)
  const problems =
    mode === 'TRANSFER'
      ? transferProblems(candidate, toHoldingId, magnitude)
      : validateDeposit(candidate, { goal, holdings })
  // Only a withdrawal can overdraw a goal in a way worth mentioning. A loss that
  // takes the balance negative is a records problem of a different kind, and the
  // withdrawal wording ("your records may just be missing a deposit") would be
  // the wrong sentence about it.
  const warnings = mode === 'WITHDRAWAL' ? depositWarnings(candidate, existing) : []

  return (
    <form
      className="fc-view-enter h-full overflow-auto"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length > 0) return
        onSave(
          mode === 'TRANSFER'
            ? {
                kind: 'TRANSFER',
                goalId: candidate.goalId,
                date: candidate.date,
                amount: money(magnitude, currency),
                fromHoldingId: candidate.holdingId,
                toHoldingId: toHoldingId,
                note: candidate.note,
              }
            : { kind: 'ENTRY', deposit: candidate },
        )
      }}
    >
      <div className="px-6 py-6">
        <h1 className="text-title">{isNew ? 'Record a movement' : 'Edit deposit'}</h1>

        {isNew && (
          <div className="mt-4 flex flex-wrap gap-2">
            {DEPOSIT_MODES.map((one) => (
              <button
                key={one}
                type="button"
                onClick={() => setMode(one)}
                className={`rounded-md border px-3 py-1 transition-colors duration-[var(--duration-micro)] ${
                  mode === one
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline text-ink-secondary hover:border-hairline-strong'
                }`}
              >
                {MODE_LABEL[one]}
              </button>
            ))}
          </div>
        )}

        <p className="mt-2 mb-6 max-w-2xl text-caption text-ink-tertiary">{MODE_HINT[mode]}</p>

        <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Goal">
            <select
              className={SELECT}
              value={candidate.goalId}
              onChange={(event) => {
                const picked = goals.find((one) => one.id === event.target.value)
                set({
                  goalId: event.target.value,
                  // Following the goal's own default is the whole point of the
                  // field; a holding the user has already picked by hand is left
                  // alone only because this fires on a deliberate goal change.
                  holdingId: picked?.defaultHoldingId ?? candidate.holdingId,
                })
              }}
            >
              {goals.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                  {one.isClosed ? ' (closed)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Amount">
            <input
              className={FIELD}
              inputMode="decimal"
              autoFocus
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
            />
          </Field>

          <Field label="Date">
            <input
              type="date"
              className={FIELD}
              value={toISODate(candidate.date)}
              onChange={(event) => set({ date: parseISODate(event.target.value) ?? candidate.date })}
            />
          </Field>

          <Field label={mode === 'TRANSFER' ? 'Out of' : 'Where the money is'}>
            <SelectOrNew
              aria-label={mode === 'TRANSFER' ? 'Out of' : 'Where the money is'}
              value={candidate.holdingId}
              onChange={(holdingId) => set({ holdingId })}
              placeholder="Pick one"
              newForm={newHolding}
            >
              {holdingOptions}
            </SelectOrNew>
          </Field>

          {mode === 'TRANSFER' && (
            <Field label="Into">
              <SelectOrNew
                aria-label="Into"
                value={toHoldingId}
                onChange={setToHoldingId}
                placeholder="Pick one"
                newForm={newHolding}
              >
                {holdingOptions}
              </SelectOrNew>
            </Field>
          )}

          <Field
            label={mode === 'WITHDRAWAL' ? 'Why' : 'Note'}
            hint={
              mode === 'WITHDRAWAL'
                ? 'required — what the money went on'
                : mode === 'LOSS'
                  ? 'optional — a loss says why by being one'
                  : 'optional'
            }
          >
            <textarea
              className={`${FIELD_MULTILINE} min-h-8`}
              value={candidate.note ?? ''}
              onChange={(event) =>
                set({ note: event.target.value.trim() === '' ? undefined : event.target.value })
              }
            />
          </Field>
        </div>

        {warnings.length > 0 && (
          <p className="mt-4 max-w-2xl text-caption text-ink-secondary">
            {warnings.map((warning) => WARNING_MESSAGE[warning]).join(' ')}
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
            {isNew ? MODE_ACTION[mode] : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>

          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {problems.map((problem) => (
              <span key={problem}>{PROBLEM_MESSAGE[problem]}</span>
            ))}
          </span>
        </div>
      </div>
    </form>
  )
}

/** A blank movement to open the editor on, dated today and placed where the goal says. */
export function blankDeposit(
  goal: SavingGoal | undefined,
  holdings: readonly Holding[],
  date: LocalDate,
  currency: CurrencyCode,
): SavingDeposit {
  return {
    id: 'new',
    goalId: goal?.id ?? '',
    date,
    amount: money(0, currency),
    holdingId: goal?.defaultHoldingId ?? holdings[0]?.id ?? '',
    sourceKind: 'MANUAL',
    sourceRefId: undefined,
    transferGroupKey: undefined,
    note: undefined,
  }
}

/**
 * A transfer's own rules, which are not a deposit's.
 *
 * It needs somewhere to come from and somewhere else to go, and it does not need
 * a reason — nothing left the savings. The two-legs-net-to-zero invariant is
 * `validateTransfer`'s and is guaranteed here by construction: one magnitude
 * produces both legs.
 */
function transferProblems(
  deposit: SavingDeposit,
  toHoldingId: string,
  magnitude: number,
): readonly FormProblem[] {
  const problems: FormProblem[] = []
  if (deposit.goalId === '') problems.push('UNKNOWN_GOAL')
  if (magnitude === 0) problems.push('ZERO_AMOUNT')
  if (deposit.holdingId === toHoldingId) problems.push('SAME_HOLDING')
  return problems
}

type FormProblem = DepositProblem | 'SAME_HOLDING'

const PROBLEM_MESSAGE: Readonly<Record<FormProblem, string>> = {
  UNKNOWN_GOAL: 'Pick a goal',
  ZERO_AMOUNT: 'Enter an amount',
  CLOSED_GOAL: 'That goal is closed. Reopen it first, or pick another.',
  UNKNOWN_HOLDING: 'Pick what the money is held in',
  WITHDRAWAL_WITHOUT_REASON: 'Say what the money went on',
  MIXED_CURRENCY: "That is not the currency the goal's target is in",
  SAME_HOLDING: 'Moving money to where it already is would change nothing',
}

const WARNING_MESSAGE: Readonly<Record<DepositWarning, string>> = {
  WITHDRAWAL_EXCEEDS_BALANCE:
    'That is more than this goal has recorded, which will leave it negative. Saved anyway — your records may just be missing a deposit.',
}

const MODE_LABEL: Readonly<Record<DepositMode, string>> = {
  DEPOSIT: 'Money in',
  WITHDRAWAL: 'Money out',
  TRANSFER: 'Moved between holdings',
  OPENING: 'Already there',
  GAIN: 'It grew',
  LOSS: 'It fell',
}

const MODE_ACTION: Readonly<Record<DepositMode, string>> = {
  DEPOSIT: 'Add deposit',
  WITHDRAWAL: 'Record withdrawal',
  TRANSFER: 'Record the move',
  OPENING: 'Record the opening balance',
  GAIN: 'Record the gain',
  LOSS: 'Record the loss',
}

const MODE_HINT: Readonly<Record<DepositMode, string>> = {
  DEPOSIT: 'Money added to a goal.',
  WITHDRAWAL: 'Money taken out. Stored as a negative deposit, so the balance stays one sum.',
  TRANSFER:
    'The same money in a different form — out of one holding, into another. Two entries that cancel out, so the goal keeps its balance and only what you can reach changes.',
  OPENING:
    'What was already sitting there on the day you started tracking. It counts towards the balance and towards the goal, and it is never counted as money you saved that month — date it when you began.',
  GAIN:
    'Interest, dividends or a rise in what the holding is worth. In the balance, out of the savings rate: the market did this, not you.',
  LOSS:
    'A fall in what the holding is worth. Recorded as its own thing rather than as a withdrawal, because nothing was spent.',
}

