import { useState, type ReactNode } from 'react'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'
import { makePlace, NEW_PLACE_KINDS } from '@/data/repositories/goalWhereRepository.ts'
import type { Holding, HoldingPlace, SavingDeposit, SavingGoal } from '@/domain/model/savings.ts'
import { DEPOSIT_MODES, modeOf, signedAmount, sourceKindFor, type DepositMode } from '@/domain/depositEntry.ts'
import { depositWarnings, validateDeposit, type DepositProblem, type DepositWarning } from '@/domain/savings.ts'
import { useT } from '@/i18n/current.ts'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { AmountInput, DateInput, FormField, FormGrid, MoreFields, PanelForm, Said } from '@/ui/components/PanelForm.tsx'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'
import { NEW_CHOICE, NewByName } from '@/ui/components/SelectOrNew.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { useWealthWords } from '@/ui/wealth/words.ts'

/**
 * Every way a savings balance can change, as one form with six modes — a
 * `PanelForm` beside the goals (M64 F3, D-629): the kind, the amount, the goal
 * and where the money is first, what the kind means said under them, and the
 * date and a note only if wanted (a withdrawal asks why up front).
 *
 * **The sign is a mode, not a minus the user types.** A withdrawal is stored as
 * a negative deposit, which is what keeps a balance a single sum (docs/f07), but
 * asking someone to express "I took ₪2,000 out" by typing a minus in front of an
 * amount is how a deposit gets recorded as a withdrawal at two in the morning.
 * The payslip form made the same call about its two amount columns (D-048).
 *
 * **A withdrawal has to say why**, which is the price of modelling it as a
 * negative: without the note there is nothing on the row to distinguish a
 * withdrawal from a correction.
 *
 * **Taking out more than the balance is allowed, and says so.** docs/f07 is
 * explicit: the user's records may simply be incomplete, and an app that argues
 * with something that already happened is worse than one that notes it.
 *
 * **Moving between holdings is not a contribution**, and the third mode exists
 * so it cannot be recorded as one. It writes two legs that net to zero, so the
 * goal's balance is untouched and only the liquid/locked split moves — which
 * since D-175 can happen *inside* one place.
 *
 * **The last three modes are the same argument again** (D-081). Money already
 * there when tracking started, and money the market added or took away, are
 * really in the balance and neither is money the user set aside, so the mode
 * picks the `sourceKind`, the same way it picks the sign.
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
  const t = useT()
  const words = useWealthWords()
  const [mode, setMode] = useState<DepositMode>(() => modeOf(initial))
  const [draft, setDraft] = useState(initial)
  const [toHoldingId, setToHoldingId] = useState<string>(
    () => holdings.find((holding) => holding.id !== initial.holdingId)?.id ?? initial.holdingId,
  )

  // "Bank Hapoalim · Fixed deposit". The place alone stopped being an answer to
  // "where does this money sit" when one place could hold several things, and
  // the holding alone would list three rows called "Cash".
  const holdingLabel = (holding: Holding): string => {
    const place = places.find((one) => one.id === holding.holdingPlaceId)
    return place === undefined ? holding.name : `${place.name} · ${holding.name}`
  }
  // A holding is a place holding one thing, as the goal form's *+ New…* makes it (M31 U6).
  const newHolding = (done: (id: string | undefined) => void): ReactNode => (
    <NewByName
      noun={t('wealth.movementForm.holdingNoun')}
      kinds={NEW_PLACE_KINDS.map((kind) => [kind, words.newPlace[kind]] as const)}
      make={(db, name, kind, now) => makePlace(db, { kind: kind ?? 'CASH_AT_HOME', name }, now)}
      done={done}
    />
  )
  const [amountText, setAmountText] = useState(() => editableMoney(initial.amount, { unsigned: true }))

  const set = (change: Partial<SavingDeposit>): void => setDraft((current) => ({ ...current, ...change }))

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
  const problems = mode === 'TRANSFER' ? transferProblems(candidate, toHoldingId, magnitude) : validateDeposit(candidate, { goal, holdings })
  // Only a withdrawal can overdraw a goal in a way worth mentioning; a loss that
  // takes the balance negative is a records problem of a different kind.
  const warnings = mode === 'WITHDRAWAL' ? depositWarnings(candidate, existing) : []
  // An untouched form only waits: the amount and the why are asked for once something is typed.
  const shown =
    amountText.trim() === '' ? problems.filter((problem) => problem !== 'ZERO_AMOUNT' && problem !== 'WITHDRAWAL_WITHOUT_REASON') : problems
  const goalName = (one: SavingGoal): string => (one.isClosed ? t('wealth.movementForm.closedGoal', { name: one.name }) : one.name)
  const why = mode === 'WITHDRAWAL'
  const setNote = (text: string): void => set({ note: text.trim() === '' ? undefined : text })

  return (
    <PanelForm
      save={isNew ? t(ACTION[mode]) : t('wealth.reading.save')}
      canSave={problems.length === 0}
      onSave={() =>
        onSave(
          mode === 'TRANSFER'
            ? {
                kind: 'TRANSFER',
                goalId: candidate.goalId,
                date: candidate.date,
                amount: money(magnitude, currency),
                fromHoldingId: candidate.holdingId,
                toHoldingId,
                note: candidate.note,
              }
            : { kind: 'ENTRY', deposit: candidate },
        )
      }
      onCancel={onCancel}
      problems={shown.map((problem) => t(PROBLEM[problem]))}
    >
      {isNew && (
        <div role="group" aria-label={t('wealth.movementForm.kind')} className="flex flex-wrap gap-2">
          {DEPOSIT_MODES.map((one) => (
            <button
              key={one}
              type="button"
              aria-pressed={mode === one}
              onClick={() => setMode(one)}
              className={`h-8 border px-3 text-caption transition-colors duration-[var(--duration-micro)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                mode === one ? 'border-accent bg-accent-soft text-ink' : 'border-hairline-strong text-ink-secondary hover:text-ink'
              }`}
            >
              {t(LABEL[one])}
            </button>
          ))}
        </div>
      )}

      <FormGrid>
        <AmountInput
          label={t('wealth.movementForm.amount')}
          currency={currency}
          placeholder="0"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
        />
        <FormField label={t('wealth.movementForm.goal')}>
          <ChoiceMenu
            className={`${FIELD} w-full`}
            text={goal === undefined ? '' : goalName(goal)}
            choices={goals.map((one) => ({ value: one.id, label: goalName(one) }))}
            onPick={(choice) => {
              const picked = goals.find((one) => one.id === choice.value)
              // Following the goal's own default is the whole point of the field;
              // a holding picked by hand is left alone only because this fires on
              // a deliberate goal change.
              set({ goalId: choice.value, holdingId: picked?.defaultHoldingId ?? candidate.holdingId })
            }}
          />
        </FormField>
        <FormField label={mode === 'TRANSFER' ? t('wealth.movementForm.outOf') : t('wealth.movementForm.where')}>
          <HoldingChoice label={mode === 'TRANSFER' ? t('wealth.movementForm.outOf') : t('wealth.movementForm.where')} value={candidate.holdingId} onChange={(holdingId) => set({ holdingId })} holdings={holdings} labelOf={holdingLabel} newHolding={newHolding} />
        </FormField>
        {mode === 'TRANSFER' && (
          <FormField label={t('wealth.movementForm.into')}>
            <HoldingChoice label={t('wealth.movementForm.into')} value={toHoldingId} onChange={setToHoldingId} holdings={holdings} labelOf={holdingLabel} newHolding={newHolding} />
          </FormField>
        )}
        {why && (
          <FormField label={t('wealth.movementForm.why')} hint={t('wealth.movementForm.whyHint')} wide>
            <textarea className={`${FIELD_MULTILINE} min-h-16`} value={candidate.note ?? ''} onChange={(event) => setNote(event.target.value)} />
          </FormField>
        )}
      </FormGrid>

      <Said>
        {t(HINT[mode])}
        {warnings.length > 0 && ` ${warnings.map((warning) => t(WARNING[warning])).join(' ')}`}
      </Said>

      <MoreFields
        label={why ? t('wealth.movementForm.moreDate') : t('wealth.movementForm.more')}
        summary={t('wealth.movementForm.moreSummary', { date: words.dates.dayMonth(candidate.date) })}
        initiallyOpen={!isNew}
      >
        <FormGrid>
          <FormField label={t('wealth.movementForm.date')}>
            <DateInput value={candidate.date} onChange={(date) => set({ date: date ?? candidate.date })} />
          </FormField>
          {!why && (
            <FormField label={t('wealth.movementForm.note')} hint={mode === 'LOSS' ? t('wealth.movementForm.lossNoteHint') : undefined} wide>
              <textarea className={`${FIELD_MULTILINE} min-h-16`} value={candidate.note ?? ''} onChange={(event) => setNote(event.target.value)} />
            </FormField>
          )}
        </FormGrid>
      </MoreFields>
    </PanelForm>
  )
}

/**
 * Where the money is, chosen from the holdings — the app's menu, never the
 * platform's select — and **+ New…** at its end making a holding in place
 * (*Make it in place*), which comes back chosen.
 */
function HoldingChoice({
  label,
  value,
  onChange,
  holdings,
  labelOf,
  newHolding,
}: {
  label: string
  value: string
  onChange: (id: string) => void
  holdings: readonly Holding[]
  labelOf: (holding: Holding) => string
  newHolding: (done: (id: string | undefined) => void) => ReactNode
}) {
  const t = useT()
  const [making, setMaking] = useState(false)
  const chosen = holdings.find((holding) => holding.id === value)
  return (
    <span className="flex min-w-0 flex-col gap-2">
      <ChoiceMenu
        className={`${FIELD} w-full`}
        aria-label={label}
        text={chosen === undefined ? t('wealth.movementForm.pick') : labelOf(chosen)}
        choices={[...holdings.map((holding) => ({ value: holding.id, label: labelOf(holding) })), { value: NEW_CHOICE, label: t('chrome.components.newChoice') }]}
        onPick={(choice) => {
          if (choice.value === NEW_CHOICE) {
            setMaking(true)
            return
          }
          setMaking(false)
          onChange(choice.value)
        }}
      />
      {making &&
        newHolding((id) => {
          setMaking(false)
          if (id !== undefined) onChange(id)
        })}
    </span>
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
function transferProblems(deposit: SavingDeposit, toHoldingId: string, magnitude: number): readonly FormProblem[] {
  const problems: FormProblem[] = []
  if (deposit.goalId === '') problems.push('UNKNOWN_GOAL')
  if (magnitude === 0) problems.push('ZERO_AMOUNT')
  if (deposit.holdingId === toHoldingId) problems.push('SAME_HOLDING')
  return problems
}

type FormProblem = DepositProblem | 'SAME_HOLDING'

const PROBLEM = {
  UNKNOWN_GOAL: 'wealth.movementForm.problem.UNKNOWN_GOAL',
  ZERO_AMOUNT: 'wealth.movementForm.problem.ZERO_AMOUNT',
  CLOSED_GOAL: 'wealth.movementForm.problem.CLOSED_GOAL',
  UNKNOWN_HOLDING: 'wealth.movementForm.problem.UNKNOWN_HOLDING',
  WITHDRAWAL_WITHOUT_REASON: 'wealth.movementForm.problem.WITHDRAWAL_WITHOUT_REASON',
  MIXED_CURRENCY: 'wealth.movementForm.problem.MIXED_CURRENCY',
  SAME_HOLDING: 'wealth.movementForm.problem.SAME_HOLDING',
} as const satisfies Record<FormProblem, string>

const WARNING = {
  WITHDRAWAL_EXCEEDS_BALANCE: 'wealth.movementForm.warning.WITHDRAWAL_EXCEEDS_BALANCE',
} as const satisfies Record<DepositWarning, string>

const LABEL = {
  DEPOSIT: 'wealth.movementForm.mode.DEPOSIT',
  WITHDRAWAL: 'wealth.movementForm.mode.WITHDRAWAL',
  TRANSFER: 'wealth.movementForm.mode.TRANSFER',
  OPENING: 'wealth.movementForm.mode.OPENING',
  GAIN: 'wealth.movementForm.mode.GAIN',
  LOSS: 'wealth.movementForm.mode.LOSS',
} as const satisfies Record<DepositMode, string>

const ACTION = {
  DEPOSIT: 'wealth.movementForm.action.DEPOSIT',
  WITHDRAWAL: 'wealth.movementForm.action.WITHDRAWAL',
  TRANSFER: 'wealth.movementForm.action.TRANSFER',
  OPENING: 'wealth.movementForm.action.OPENING',
  GAIN: 'wealth.movementForm.action.GAIN',
  LOSS: 'wealth.movementForm.action.LOSS',
} as const satisfies Record<DepositMode, string>

const HINT = {
  DEPOSIT: 'wealth.movementForm.hint.DEPOSIT',
  WITHDRAWAL: 'wealth.movementForm.hint.WITHDRAWAL',
  TRANSFER: 'wealth.movementForm.hint.TRANSFER',
  OPENING: 'wealth.movementForm.hint.OPENING',
  GAIN: 'wealth.movementForm.hint.GAIN',
  LOSS: 'wealth.movementForm.hint.LOSS',
} as const satisfies Record<DepositMode, string>
