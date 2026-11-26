import { useState, type ReactNode } from 'react'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import { compareDates, type LocalDate } from '@/core/time.ts'
import { snapshotProblems } from '@/data/repositories/fundRepository.ts'
import { componentSplit, validateSnapshot, type SnapshotProblem } from '@/domain/funds.ts'
import type { FundBalanceSnapshot, ReadDeposit } from '@/domain/model/funds.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { FlowFrame } from '@/ui/components/FlowFrame.tsx'
import { AmountInput, DateInput, FormField, FormGrid, FormGroup, MoreFields, PanelForm, Said } from '@/ui/components/PanelForm.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'

import { DepositRows } from './DepositRows.tsx'

/**
 * **One balance reading, typed off a fund's report** — the first form M64 F3
 * made easy (D-629). The maintainer, 2026-11-26: *"adding readings to funds and
 * such, looks like the old"*. So it asks for what every report leads with — the
 * balance and its date — and says in words what that figure means against the
 * fund's last reading as it is typed; everything else the report may print is
 * one verb further, *More from the report*, grown in place.
 *
 * **The rest keeps the report's order, not the schema's** (docs/f13): what came
 * in, was charged and was earned since the last reading, then the balance broken
 * into its components. Every amount there is optional, and empty means **the
 * report did not say** — not zero; the reconciliation and the fee panel both
 * branch on it, so the form never fills one in helpfully.
 *
 * **The remainder is said while it is typed**: two of the three components in,
 * the form says what is left over, which catches a transposed digit when it is
 * made. `snapshotProblems` is the repository's — the domain's invariants and the
 * pack's `parts` identity — so the form, the tool and `format_rows` cannot
 * disagree about what a valid reading is.
 *
 * Typed by hand it is a `PanelForm` beside the fund (`SnapshotForm`, D-617);
 * read off a stack of reports it is the same fields on a page of their own
 * (`SnapshotEditor`, D-163/D-164), whose grids widen with the page.
 */
export function SnapshotForm({
  initial,
  isNew,
  currency,
  existing,
  fundName,
  onSave,
  onCancel,
}: {
  initial: FundBalanceSnapshot
  isNew: boolean
  currency: CurrencyCode
  /** The fund's other readings — what "one per date" and "since the last" are read against. */
  existing: readonly FundBalanceSnapshot[]
  fundName: string
  onSave: (snapshot: FundBalanceSnapshot) => void
  onCancel: () => void
}) {
  const t = useT()
  const state = useSnapshotDraft(initial, existing, currency)
  return (
    <PanelForm
      save={isNew ? t('wealth.reading.add') : t('wealth.reading.save')}
      canSave={state.problems.length === 0}
      onSave={() => onSave(state.draft)}
      onCancel={onCancel}
      problems={state.problems.filter((problem) => problem !== 'NO_BALANCE').map((problem) => t(PROBLEM[problem]))}
    >
      <SnapshotFields state={state} currency={currency} existing={existing} fundName={fundName} isNew={isNew} />
    </PanelForm>
  )
}

/**
 * The same reading, on a page of its own: a report read from a stack (D-164),
 * with the deposit rows read off it shown before they are saved with it (D-153).
 */
export function SnapshotEditor({
  initial,
  isNew,
  currency,
  existing,
  fundName,
  deposits,
  progress,
  saveLabel,
  leaveLabel,
  onSave,
  onCancel,
}: {
  initial: FundBalanceSnapshot
  isNew: boolean
  currency: CurrencyCode
  existing: readonly FundBalanceSnapshot[]
  fundName: string
  /**
   * The deposit rows that will be saved with this reading (D-153) — shown,
   * because the same button writes them, and a form that saves rows it never
   * showed keeps "nothing is written without a human action" in the letter only.
   */
  deposits?: readonly ReadDeposit[] | undefined
  /** Where this reading's document sits in a stack being read (D-164). */
  progress?: ReactNode
  /** What the save button says when saving is not the end of anything: *Save and read the next*. */
  saveLabel?: string | undefined
  /** Where leaving goes, when it is not the fund: the stack of reports (`FlowFrame` names where it goes). */
  leaveLabel?: string | undefined
  onSave: (snapshot: FundBalanceSnapshot) => void
  onCancel: () => void
}) {
  const t = useT()
  const state = useSnapshotDraft(initial, existing, currency)
  const { problems, draft } = state
  return (
    <FlowFrame
      title={isNew ? t('wealth.reading.addTitle') : t('wealth.reading.editTitle')}
      leaveLabel={leaveLabel ?? t('wealth.reading.back')}
      onLeave={onCancel}
      {...(progress === undefined ? {} : { actions: progress })}
      onSubmit={() => {
        if (problems.length === 0) onSave(draft)
      }}
      footer={
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
            {saveLabel ?? (isNew ? t('wealth.reading.add') : t('wealth.reading.save'))}
          </Button>
          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {problems.map((problem) => (
              <span key={problem}>{t(PROBLEM[problem])}</span>
            ))}
          </span>
        </div>
      }
    >
      <div className="@container max-w-3xl px-6 py-6">
        <div className="flex flex-col gap-5">
          <SnapshotFields
            state={state}
            currency={currency}
            existing={existing}
            fundName={fundName}
            isNew={isNew}
            open={deposits !== undefined && deposits.length > 0}
          />
          {deposits !== undefined && deposits.length > 0 && (
            <div className="flex flex-col gap-1">
              <DepositRows rows={deposits} addUp={undefined} />
              <p className="m-0 text-caption text-ink-secondary">{t('wealth.reading.depositsKept')}</p>
            </div>
          )}
        </div>
      </div>
    </FlowFrame>
  )
}

interface SnapshotState {
  readonly draft: FundBalanceSnapshot
  readonly texts: Texts
  readonly problems: readonly FormProblem[]
  readonly set: (change: Partial<FundBalanceSnapshot>) => void
  readonly setTotal: (text: string) => void
  readonly setAmount: (field: AmountField, text: string) => void
}

function useSnapshotDraft(initial: FundBalanceSnapshot, existing: readonly FundBalanceSnapshot[], currency: CurrencyCode): SnapshotState {
  const [draft, setDraft] = useState(initial)
  const [texts, setTexts] = useState<Texts>(() => initialTexts(initial))
  // The parts against the total are the pack's identity (D-280), so the
  // document's declaration judges them; without one, the invariants alone.
  const db = useDocumentStore((state) => state.db)
  const domain = db === undefined ? validateSnapshot(draft, existing) : snapshotProblems(db, draft, existing).problems
  // A balance is the one figure a reading cannot be without: empty is not zero here either.
  const typed = texts.totalBalance.trim()
  const balance: readonly FormProblem[] = typed === '' ? ['NO_BALANCE'] : moneyFromText(typed, currency) === undefined ? ['BALANCE_NOT_A_NUMBER'] : []
  const problems = [...balance, ...domain]
  return {
    draft,
    texts,
    problems,
    set: (change) => setDraft((current) => ({ ...current, ...change })),
    setTotal: (text) => {
      setTexts((current) => ({ ...current, totalBalance: text }))
      setDraft((current) => ({ ...current, totalBalance: moneyFromText(text, currency) ?? money(0, currency) }))
    },
    // One handler for every other amount: the text is kept, the parse is stored.
    setAmount: (field, text) => {
      setTexts((current) => ({ ...current, [field]: text }))
      setDraft((current) => ({ ...current, [field]: moneyFromText(text, currency) }))
    },
  }
}

function SnapshotFields({
  state,
  currency,
  existing,
  fundName,
  isNew,
  open = false,
}: {
  state: SnapshotState
  currency: CurrencyCode
  existing: readonly FundBalanceSnapshot[]
  fundName: string
  isNew: boolean
  /** Opened from the start: a report read with its deposit rows. */
  open?: boolean
}) {
  const t = useT()
  const dates = useDates()
  const { draft, texts, set, setTotal, setAmount } = state
  const split = componentSplit(draft)
  const stated = AMOUNT_FIELDS.filter((field) => draft[field] !== undefined).length
  const statedComponents = [draft.employeeComponent, draft.employerComponent, draft.severanceComponent].filter(
    (amount) => amount !== undefined,
  ).length

  return (
    <>
      <FormGrid>
        <AmountInput
          label={t('wealth.reading.balance')}
          currency={currency}
          placeholder="0"
          value={texts.totalBalance}
          onChange={(event) => setTotal(event.target.value)}
        />
        <FormField label={t('wealth.reading.asOf')} hint={t('wealth.reading.asOfHint')}>
          <DateInput value={draft.asOfDate} onChange={(date) => set({ asOfDate: date ?? draft.asOfDate })} />
        </FormField>
      </FormGrid>

      <Said>{balanceSaid(draft, existing, fundName, texts.totalBalance.trim() === '', t, dates)}</Said>

      <MoreFields
        label={t('wealth.reading.more')}
        summary={stated === 0 ? t('wealth.reading.moreSummary') : t(countKey('wealth.reading.moreStated', stated), { count: stated })}
        initiallyOpen={open || (!isNew && stated > 0) || draft.note !== undefined}
      >
        <p className="m-0 text-caption text-ink-secondary">{t('wealth.reading.emptyIsNotZero')}</p>
        <FormGroup title={t('wealth.reading.since')}>
          <FormGrid columns={3}>
            <FormField label={t('wealth.reading.deposits')} hint={t('wealth.reading.depositsHint')}>
              <AmountText value={texts.depositsSincePrevious} onText={(text) => setAmount('depositsSincePrevious', text)} />
            </FormField>
            <FormField label={t('wealth.reading.fees')} hint={t('wealth.reading.feesHint')}>
              <AmountText value={texts.feesChargedSincePrevious} onText={(text) => setAmount('feesChargedSincePrevious', text)} />
            </FormField>
            <FormField label={t('wealth.reading.return')} hint={t('wealth.reading.returnHint')}>
              <AmountText value={texts.returnSincePrevious} onText={(text) => setAmount('returnSincePrevious', text)} />
            </FormField>
          </FormGrid>
        </FormGroup>

        <FormGroup title={t('wealth.reading.brokenDown')}>
          <FormGrid columns={3}>
            <FormField label={t('wealth.reading.employee')} hint={t('wealth.reading.employeeHint')}>
              <AmountText value={texts.employeeComponent} onText={(text) => setAmount('employeeComponent', text)} />
            </FormField>
            <FormField label={t('wealth.reading.employer')} hint={t('wealth.reading.employerHint')}>
              <AmountText value={texts.employerComponent} onText={(text) => setAmount('employerComponent', text)} />
            </FormField>
            <FormField label={t('wealth.reading.severance')} hint={t('wealth.reading.severanceHint')}>
              <AmountText value={texts.severanceComponent} onText={(text) => setAmount('severanceComponent', text)} />
            </FormField>
          </FormGrid>
          {statedComponents > 0 && (
            <Said>
              {split.isComplete
                ? split.unattributed.minor === 0
                  ? t('wealth.reading.partsExact')
                  : t('wealth.reading.partsAway', { amount: formatMoney(split.unattributed) })
                : t('wealth.reading.partsSoFar', { amount: formatMoney(split.unattributed) })}
            </Said>
          )}
        </FormGroup>

        <FormField label={t('wealth.reading.note')}>
          <textarea
            className={`${FIELD_MULTILINE} min-h-16`}
            value={draft.note ?? ''}
            onChange={(event) => set({ note: event.target.value.trim() === '' ? undefined : event.target.value })}
          />
        </FormField>
      </MoreFields>
    </>
  )
}

/** One of the optional amounts: a plain field, tabular, its text kept as typed. */
function AmountText({ value, onText }: { value: string; onText: (text: string) => void }) {
  return <input className={`${FIELD} min-w-0 text-end tabular-nums`} inputMode="decimal" dir="ltr" value={value} onChange={(event) => onText(event.target.value)} />
}

/**
 * **The balance, said against the last reading** — what the figure typed means
 * the moment it is typed: up or down since the reading before this date, or the
 * first one the fund has. A figure off by a digit reads as a jump nobody expects.
 */
function balanceSaid(
  draft: FundBalanceSnapshot,
  existing: readonly FundBalanceSnapshot[],
  fundName: string,
  blank: boolean,
  t: Translate,
  dates: DateWords,
): ReactNode {
  if (blank) return t('wealth.reading.saidEmpty')
  const amount = formatMoney(draft.totalBalance)
  const on = dayOf(draft.asOfDate, dates)
  const before = existing
    .filter((one) => one.id !== draft.id && compareDates(one.asOfDate, draft.asOfDate) < 0)
    .sort((a, b) => compareDates(b.asOfDate, a.asOfDate))[0]
  if (before === undefined) {
    return <Phrase text={t('wealth.reading.saidFirst')} parts={{ amount, on, fund: <Bidi>{fundName}</Bidi> }} />
  }
  const change = draft.totalBalance.minor - before.totalBalance.minor
  const previous = dayOf(before.asOfDate, dates)
  if (change === 0) return t('wealth.reading.saidSame', { amount, on, previous })
  const by = formatMoney(money(Math.abs(change), draft.totalBalance.currency))
  return t(change > 0 ? 'wealth.reading.saidUp' : 'wealth.reading.saidDown', { amount, on, by, previous })
}

/** A reading's day, with its year: readings are months and years apart. */
function dayOf(date: LocalDate, dates: DateWords): string {
  return `${dates.dayMonth(date)} ${String(date.year)}`
}

/** A blank reading, dated today, to open the editor on. */
export function blankSnapshot(fundAccountId: string, asOfDate: LocalDate, currency: CurrencyCode): FundBalanceSnapshot {
  return {
    id: 'new',
    fundAccountId,
    asOfDate,
    totalBalance: money(0, currency),
    employeeComponent: undefined,
    employerComponent: undefined,
    severanceComponent: undefined,
    depositsSincePrevious: undefined,
    feesChargedSincePrevious: undefined,
    returnSincePrevious: undefined,
    depositGapAcknowledged: false,
    note: undefined,
  }
}

/** Why a reading cannot be saved, by the domain's word for it. */
type FormProblem = SnapshotProblem | 'NO_BALANCE' | 'BALANCE_NOT_A_NUMBER'

const PROBLEM = {
  NO_BALANCE: 'wealth.reading.problem.NO_BALANCE',
  BALANCE_NOT_A_NUMBER: 'wealth.reading.problem.BALANCE_NOT_A_NUMBER',
  NEGATIVE_BALANCE: 'wealth.reading.problem.NEGATIVE_BALANCE',
  COMPONENTS_DISAGREE: 'wealth.reading.problem.COMPONENTS_DISAGREE',
  MIXED_CURRENCY: 'wealth.reading.problem.MIXED_CURRENCY',
  DUPLICATE_DATE: 'wealth.reading.problem.DUPLICATE_DATE',
} as const satisfies Record<FormProblem, string>

const AMOUNT_FIELDS = [
  'depositsSincePrevious',
  'feesChargedSincePrevious',
  'returnSincePrevious',
  'employeeComponent',
  'employerComponent',
  'severanceComponent',
] as const

type AmountField = (typeof AMOUNT_FIELDS)[number]

type Texts = Record<AmountField | 'totalBalance', string>

function initialTexts(snapshot: FundBalanceSnapshot): Texts {
  return {
    // A blank reading opens with an empty box rather than a literal 0 to type
    // over. It round-trips: an empty balance parses back to zero, which is what
    // the column requires and what `validateSnapshot` then judges.
    totalBalance: editableMoney(snapshot.totalBalance),
    employeeComponent: editableMoney(snapshot.employeeComponent, { zero: '0' }),
    employerComponent: editableMoney(snapshot.employerComponent, { zero: '0' }),
    severanceComponent: editableMoney(snapshot.severanceComponent, { zero: '0' }),
    depositsSincePrevious: editableMoney(snapshot.depositsSincePrevious, { zero: '0' }),
    feesChargedSincePrevious: editableMoney(snapshot.feesChargedSincePrevious, { zero: '0' }),
    returnSincePrevious: editableMoney(snapshot.returnSincePrevious, { zero: '0' }),
  }
}
