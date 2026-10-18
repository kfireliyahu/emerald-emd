import { useState } from 'react'

import { formatMoney, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import { monthlyShare, validateFixedExpense, type FixedExpenseProblem } from '@/domain/fixedExpenses.ts'
import {
  AMOUNT_VARIABILITIES,
  CADENCES,
  CYCLE_MONTHS,
  FIXED_EXPENSE_MATCH_KINDS,
  type AmountVariability,
  type Cadence,
  type FixedExpense,
  type FixedExpenseMatchKind,
  type FixedRole,
} from '@/domain/model/fixed.ts'
import type { DeductionType } from '@/domain/model/paycheck.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'
import {
  CADENCE_LABEL,
  MATCH_KIND_LABEL,
  MATCH_REF_LABEL,
  VARIABILITY_LABEL,
} from '@/ui/fixed/labels.ts'
import { RoleSwitch } from '@/ui/plan/FixedSection.tsx'
import { today } from '@/ui/today.ts'

/**
 * One fixed expense, added or edited — docs/f09's fixed expense editor.
 *
 * **Text lives here, `Money` lives in the draft**, the same split D-050 made in
 * the paycheck editor, and the amount is read by the importer's own
 * `parseAmountText` so a figure pasted off a bill works.
 *
 * The draft *is* a `FixedExpense`, so the form asks the domain the same
 * question the repository will: `validateFixedExpense` decides what cannot be
 * saved, and the editor has no opinion of its own. What it does add is one
 * defaulting rule — picking a non-monthly cadence fills in a start date if
 * there isn't one, because that field stops being optional the moment the
 * expense has a cycle to be counted from.
 */
export function FixedExpenseEditor({
  initial,
  isNew,
  initialRole,
  planName,
  currency,
  categories,
  deductionTypes,
  matchedHistory,
  onSave,
  onCancel,
}: {
  initial: FixedExpense
  isNew: boolean
  /** What it does to the plan on screen; a new one starts out of net (D-053). */
  initialRole: FixedRole
  planName: string
  currency: CurrencyCode
  categories: readonly Category[]
  deductionTypes: readonly DeductionType[]
  /** The charges this expense has actually matched, newest first. Empty for a new one. */
  matchedHistory: readonly { readonly date: string; readonly amount: Money }[]
  onSave: (expense: FixedExpense, role: FixedRole) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [role, setRole] = useState<FixedRole>(initialRole)
  const [amountText, setAmountText] = useState(() => editableMoney(initial.expectedAmount))
  const [merchantText, setMerchantText] = useState(() => initial.matchRef ?? '')

  const set = (change: Partial<FixedExpense>): void =>
    setDraft((current) => ({ ...current, ...change }))

  /**
   * Changing the cadence can make the start date required, so it fills one in
   * rather than letting the user hit a refusal they did not cause.
   */
  const setCadence = (cadence: Cadence): void =>
    setDraft((current) => ({
      ...current,
      cadence,
      startedAt:
        current.startedAt ?? (CYCLE_MONTHS[cadence] > 1 ? firstOfThisMonth() : undefined),
    }))

  const problems = validateFixedExpense(draft)
  const normalized = normalizeMerchant(merchantText)
  const share = monthlyShare(draft)

  return (
    <form
      className="fc-view-enter flex flex-col border border-hairline bg-surface"
      aria-label={isNew ? 'New bill' : 'Edit bill'}
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length === 0) onSave(draft, role)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-4 py-2.5">
        <span className="text-[16px] font-medium">
          {isNew ? 'New bill' : 'Edit bill'}
        </span>
        <span className="ml-auto text-caption text-ink-secondary">
          Escape closes this. Nothing is written to your document until you save it.
        </span>
      </div>

      <div className="px-4 py-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="Rent"
              aria-label="Name"
              className={`${FIELD} w-56`}
              autoFocus={isNew}
            />
          </Field>

          <Field label="Amount" hint="the whole charge, not a monthly share">
            <input
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value)
                set({ expectedAmount: moneyFromText(event.target.value, currency, { magnitude: true }) ?? zero(currency) })
              }}
              placeholder="0.00"
              aria-label="Expected amount"
              className={`${FIELD} w-32 text-right tabular-nums`}
            />
          </Field>

          <Field label="How often">
            <select
              value={draft.cadence}
              onChange={(event) => setCadence(event.target.value as Cadence)}
              aria-label="Cadence"
              className={`${SELECT} w-40`}
            >
              {CADENCES.map((cadence) => (
                <option key={cadence} value={cadence}>
                  {CADENCE_LABEL[cadence]}
                </option>
              ))}
            </select>
          </Field>

          {/* The amortized figure, shown the moment the two fields that make it
              are set — docs/f09 asks for both numbers on screen so the monthly
              average never reads as a claim about a bill. */}
          {CYCLE_MONTHS[draft.cadence] > 1 && (
            <p className="text-caption text-ink-secondary">
              {formatMoney(draft.expectedAmount)} every {CYCLE_MONTHS[draft.cadence]} months —{' '}
              <span className="text-ink tabular-nums">{formatMoney(share)}</span> a month in the
              plan, with the real charge shown in its own month.
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Amount behaviour" hint="decides when a change is worth flagging">
            <select
              value={draft.amountVariability}
              onChange={(event) =>
                set({ amountVariability: event.target.value as AmountVariability })
              }
              aria-label="Amount behaviour"
              className={`${SELECT} w-40`}
            >
              {AMOUNT_VARIABILITIES.map((variability) => (
                <option key={variability} value={variability}>
                  {VARIABILITY_LABEL[variability]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Category">
            <div className="w-56">
              <CategoryPicker
                categories={categories}
                value={draft.categoryId}
                onChange={(categoryId) => set({ categoryId })}
                label="Category"
              />
            </div>
          </Field>

          <label className="flex items-center gap-2 pb-2 select-none">
            <input
              type="checkbox"
              checked={draft.isDiscretionary}
              onChange={(event) => set({ isDiscretionary: event.target.checked })}
            />
            <span>
              I could cut this
              <span className="ml-2 text-caption text-ink-tertiary">
                fixed and necessary are different things
              </span>
            </span>
          </label>
        </div>

        {draft.matchKind !== 'PAYCHECK_DEDUCTION' && (
          <div className="mt-4 flex flex-col gap-1">
            <span className="text-caption text-ink-secondary">
              What it does to <Bidi>{planName}</Bidi>
            </span>
            <RoleSwitch name={draft.name === '' ? 'this expense' : draft.name} role={role} onPick={setRole} />
          </div>
        )}

        <h3 className="m-0 mt-6 mb-2 text-[13px] font-medium">How it is recognized</h3>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Matched by">
            <select
              value={draft.matchKind}
              onChange={(event) =>
                set({ matchKind: event.target.value as FixedExpenseMatchKind, matchRef: undefined })
              }
              aria-label="Matched by"
              className={`${SELECT} w-64`}
            >
              {FIXED_EXPENSE_MATCH_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {MATCH_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </Field>

          {draft.matchKind === 'MERCHANT_PATTERN' && (
            <Field
              label={MATCH_REF_LABEL.MERCHANT_PATTERN}
              hint={
                normalized === '' || normalized === merchantText
                  ? 'as it appears on the statement'
                  : <>matched as <Bidi>{normalized}</Bidi></>
              }
            >
              <input
                value={merchantText}
                onChange={(event) => {
                  setMerchantText(event.target.value)
                  set({ matchRef: normalizeMerchant(event.target.value) })
                }}
                aria-label="Merchant"
                dir="auto"
                className={`${FIELD} w-56`}
              />
            </Field>
          )}

          {draft.matchKind === 'CATEGORY' && (
            <Field label={MATCH_REF_LABEL.CATEGORY}>
              <div className="w-56">
                <CategoryPicker
                  categories={categories}
                  value={draft.matchRef}
                  onChange={(categoryId) => set({ matchRef: categoryId })}
                  label="Matched category"
                />
              </div>
            </Field>
          )}

          {draft.matchKind === 'PAYCHECK_DEDUCTION' && (
            <Field
              label={MATCH_REF_LABEL.PAYCHECK_DEDUCTION}
              hint="already out of net — never subtracted from a plan again"
            >
              <select
                value={draft.matchRef ?? ''}
                onChange={(event) => set({ matchRef: event.target.value || undefined })}
                aria-label="Deduction type"
                className={`${SELECT} w-56`}
              >
                <option value="">Choose…</option>
                {deductionTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <h3 className="m-0 mt-6 mb-2 text-[13px] font-medium">When</h3>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field
            label="Started"
            hint={
              CYCLE_MONTHS[draft.cadence] > 1
                ? 'the months it charges in are counted from here'
                : 'optional'
            }
          >
            <input
              type="date"
              value={draft.startedAt === undefined ? '' : toISODate(draft.startedAt)}
              onChange={(event) => set({ startedAt: parseISODate(event.target.value) })}
              aria-label="Started"
              className={`${FIELD} w-40 tabular-nums`}
            />
          </Field>

          <Field label="Ended" hint="a cancelled subscription stops being projected">
            <input
              type="date"
              value={draft.endedAt === undefined ? '' : toISODate(draft.endedAt)}
              onChange={(event) => set({ endedAt: parseISODate(event.target.value) })}
              aria-label="Ended"
              className={`${FIELD} w-40 tabular-nums`}
            />
          </Field>

          <Field label="Usual day" hint="optional">
            <input
              type="number"
              min={1}
              max={31}
              value={draft.dayOfMonthHint ?? ''}
              onChange={(event) =>
                set({
                  dayOfMonthHint:
                    event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
              aria-label="Usual day of month"
              className={`${FIELD} w-24 tabular-nums`}
            />
          </Field>

          <label className="flex items-center gap-2 pb-2 select-none">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) => set({ isActive: event.target.checked })}
            />
            Still active
          </label>
        </div>

        {matchedHistory.length > 0 && (
          <>
            <h3 className="m-0 mt-6 mb-2 text-[13px] font-medium">What it has matched</h3>
            <table className="max-w-md">
              <tbody>
                {matchedHistory.map((charge) => (
                  <tr key={`${charge.date}-${charge.amount.minor}`} className="border-b border-hairline">
                    <td className="w-32 py-1.5 pr-6 text-ink-secondary tabular-nums">
                      {charge.date}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(charge.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" icon={isNew ? 'add' : 'check'} type="submit" disabled={problems.length > 0}>
            {isNew ? 'Add bill' : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>

          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {problems.map((problem) => (
              <span key={problem}>{PROBLEM_MESSAGE[problem]}</span>
            ))}
            {unreadable(amountText) && <span>The amount is not a number</span>}
          </span>
        </div>

        {draft.matchKind === 'MANUAL_ONLY' && (
          <p className="mt-3 max-w-2xl text-caption text-ink-secondary">
            Nothing in the ledger will be matched to this, so it will never show a variance or a
            missing payment. That is the right choice for something the app cannot see — an annual
            premium paid by direct debit from an account you have not imported.
          </p>
        )}
      </div>
    </form>
  )
}

const PROBLEM_MESSAGE: Readonly<Record<FixedExpenseProblem, string>> = {
  NO_NAME: 'Give it a name',
  NEGATIVE_AMOUNT: 'Enter what it costs, without the minus',
  MISSING_MATCH_REF: 'Choose what it is matched against',
  ENDED_BEFORE_STARTED: 'It cannot end before it started',
  ANCHOR_REQUIRED: 'A non-monthly expense needs a start date to count its months from',
}

/** The first of this month as a default anchor: a cadence is about months, not days. */
function firstOfThisMonth(): LocalDate {
  const now = today()
  return { year: now.year, month: now.month, day: 1 }
}

function unreadable(text: string): boolean {
  return text.trim() !== '' && parseAmountText(text) === undefined
}
