import { useState } from 'react'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { snapshotProblems } from '@/data/repositories/fundRepository.ts'
import { componentSplit, validateSnapshot, type SnapshotProblem } from '@/domain/funds.ts'
import type { FundBalanceSnapshot, ReadDeposit } from '@/domain/model/funds.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { FlowFrame } from '@/ui/components/FlowFrame.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'

import { DepositRows } from './DepositRows.tsx'

/**
 * One balance reading, transcribed from a fund report.
 *
 * **The field order is the report's order, not the schema's** (docs/f13). A
 * fund statement leads with the period and the balance, then what came in, what
 * was charged and what was earned over that period, and breaks the balance into
 * its components last. Typing it should be top-to-bottom with no hunting, which
 * is the difference between a screen someone uses twice a year and one they use
 * once.
 *
 * **The remainder is shown while it is being typed.** As soon as two of the
 * three components are entered, the form says what is left over — which is how
 * a transposed digit is caught at the moment it is made rather than in a total
 * six months later. `snapshotProblems` is the repository's — the domain's
 * invariants and the pack's `parts` identity — so the form, the tool and
 * `format_rows` cannot disagree about what a valid reading is.
 *
 * Every amount below the balance is optional, and left empty means **the report
 * did not say** — not zero. That distinction is what the reconciliation and the
 * fee panel both branch on, so the form never fills one in helpfully.
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
  /** The fund's other readings — what "one per date" is checked against. */
  existing: readonly FundBalanceSnapshot[]
  fundName: string
  /**
   * The deposit rows that will be saved with this reading (D-153).
   *
   * Shown rather than merely carried: they are written by the same button that
   * writes the reading, and a form that saves nine rows it never showed anyone
   * would be exactly the "nothing is written without a human action" rule kept
   * in the letter and broken in the spirit.
   */
  deposits?: readonly ReadDeposit[] | undefined
  /** Where this reading's document sits in a stack being read (D-164). */
  progress?: React.ReactNode
  /**
   * What the save button says when saving is not the end of anything — "Save
   * and read the next" rather than "Add reading", because a button that says it
   * adds a reading and then puts another document on the screen has told the
   * truth and still surprised somebody.
   */
  saveLabel?: string | undefined
  /**
   * Where leaving goes, when it is not the fund.
   *
   * Inside a batch it is the stack of reports, not the fund — `FlowFrame`'s
   * rule is one way out that **names where it goes**, and a form reached from
   * the sixth of eight documents does not go back to the same place a form
   * reached from the Add reading button does.
   */
  leaveLabel?: string | undefined
  onSave: (snapshot: FundBalanceSnapshot) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [texts, setTexts] = useState<Texts>(() => initialTexts(initial))

  const set = (change: Partial<FundBalanceSnapshot>): void =>
    setDraft((current) => ({ ...current, ...change }))

  /** One handler for every amount: the text is kept, the parse is stored. */
  const setAmount = (field: AmountField, text: string): void => {
    setTexts((current) => ({ ...current, [field]: text }))
    setDraft((current) => ({ ...current, [field]: moneyFromText(text, currency) }))
  }

  // The parts against the total are the pack's identity (D-280), so the
  // document's declaration judges them; without one, the invariants alone.
  const db = useDocumentStore((state) => state.db)
  const problems =
    db === undefined ? validateSnapshot(draft, existing) : snapshotProblems(db, draft, existing).problems
  const split = componentSplit(draft)
  const statedComponents = [
    draft.employeeComponent,
    draft.employerComponent,
    draft.severanceComponent,
  ].filter((amount) => amount !== undefined).length

  return (
    <FlowFrame
      title={isNew ? 'Add a reading' : 'Edit reading'}
      leaveLabel={leaveLabel ?? 'Back to the fund'}
      onLeave={onCancel}
      {...(progress === undefined ? {} : { actions: progress })}
      onSubmit={() => {
        if (problems.length === 0) onSave(draft)
      }}
      footer={
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
            {saveLabel ?? (isNew ? 'Add reading' : 'Save')}
          </Button>

          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {problems.map((problem) => (
              <span key={problem}>{PROBLEM_MESSAGE[problem]}</span>
            ))}
          </span>
        </div>
      }
    >
      <div className="px-6 py-6">
        <p className="mb-6 max-w-2xl text-caption text-ink-tertiary">
          {fundName} · copy the figures across in the order your report prints them. Anything the
          report does not state, leave empty — empty means "not stated", which is not the same as
          zero.
        </p>

        {/* The columns are unchanged, and that is the point (D-163). Tailwind's
            `sm:`/`lg:` are *viewport* queries, so this grid was already three
            and two columns wide inside a 30rem pane — 372px of content split
            three ways, which is about 100px for a field holding ₪1,234,567.
            What the flow needed was not a different grid, it was the window. */}
        <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="As of" hint="the date the report is dated">
            <input
              type="date"
              className={FIELD}
              value={toISODate(draft.asOfDate)}
              onChange={(event) =>
                set({ asOfDate: parseISODate(event.target.value) ?? draft.asOfDate })
              }
            />
          </Field>

          <Field label="Total balance" hint="the headline figure">
            <input
              className={FIELD}
              inputMode="decimal"
              autoFocus
              value={texts.totalBalance}
              onChange={(event) => {
                setTexts((current) => ({ ...current, totalBalance: event.target.value }))
                set({ totalBalance: moneyFromText(event.target.value, currency) ?? money(0, currency) })
              }}
            />
          </Field>
        </div>

        <h2 className="mt-8 mb-2 text-label text-ink-tertiary uppercase">
          Since the previous reading
        </h2>
        <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
          <Field label="Deposits" hint="what the fund says it received">
            <input
              className={FIELD}
              inputMode="decimal"
              value={texts.depositsSincePrevious}
              onChange={(event) => setAmount('depositsSincePrevious', event.target.value)}
            />
          </Field>

          <Field label="Fees charged" hint="what it took in management fees">
            <input
              className={FIELD}
              inputMode="decimal"
              value={texts.feesChargedSincePrevious}
              onChange={(event) => setAmount('feesChargedSincePrevious', event.target.value)}
            />
          </Field>

          <Field label="Return" hint="as the report prints it">
            <input
              className={FIELD}
              inputMode="decimal"
              value={texts.returnSincePrevious}
              onChange={(event) => setAmount('returnSincePrevious', event.target.value)}
            />
          </Field>
        </div>

        <h2 className="mt-8 mb-2 text-label text-ink-tertiary uppercase">
          Broken down, if the report does
        </h2>
        <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
          <Field label="Employee" hint="תגמולי עובד">
            <input
              className={FIELD}
              inputMode="decimal"
              value={texts.employeeComponent}
              onChange={(event) => setAmount('employeeComponent', event.target.value)}
            />
          </Field>

          <Field label="Employer" hint="תגמולי מעסיק">
            <input
              className={FIELD}
              inputMode="decimal"
              value={texts.employerComponent}
              onChange={(event) => setAmount('employerComponent', event.target.value)}
            />
          </Field>

          <Field label="Severance" hint="פיצויים — withdrawn on different terms">
            <input
              className={FIELD}
              inputMode="decimal"
              value={texts.severanceComponent}
              onChange={(event) => setAmount('severanceComponent', event.target.value)}
            />
          </Field>
        </div>

        {statedComponents > 0 && (
          <p className="mt-2 max-w-2xl text-caption text-ink-tertiary tabular-nums">
            {split.isComplete
              ? split.unattributed.minor === 0
                ? 'The three add up to the balance exactly.'
                : `The three are ${formatMoney(split.unattributed)} away from the balance.`
              : `${formatMoney(split.unattributed)} of the balance is not in the components entered so far.`}
          </p>
        )}

        <div className="mt-8 grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">

          <Field label="Note">
            <textarea
              className={`${FIELD_MULTILINE} min-h-8`}
              value={draft.note ?? ''}
              onChange={(event) =>
                set({ note: event.target.value.trim() === '' ? undefined : event.target.value })
              }
            />
          </Field>
        </div>

        {deposits !== undefined && deposits.length > 0 && (
          <div className="mt-8 max-w-3xl">
            <DepositRows rows={deposits} addUp={undefined} />
            <p className="mt-1 text-caption text-ink-tertiary">
              These are saved with this reading, and deleting the reading deletes them.
            </p>
          </div>
        )}

      </div>
    </FlowFrame>
  )
}

/** A blank reading, dated today, to open the editor on. */
export function blankSnapshot(
  fundAccountId: string,
  asOfDate: LocalDate,
  currency: CurrencyCode,
): FundBalanceSnapshot {
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

const PROBLEM_MESSAGE: Readonly<Record<SnapshotProblem, string>> = {
  NEGATIVE_BALANCE: 'A balance cannot be negative',
  COMPONENTS_DISAGREE: 'The three components do not add up to the balance',
  MIXED_CURRENCY: 'Every figure has to be in the same currency',
  DUPLICATE_DATE: 'This fund already has a reading for that date',
}


type AmountField =
  | 'employeeComponent'
  | 'employerComponent'
  | 'severanceComponent'
  | 'depositsSincePrevious'
  | 'feesChargedSincePrevious'
  | 'returnSincePrevious'

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

