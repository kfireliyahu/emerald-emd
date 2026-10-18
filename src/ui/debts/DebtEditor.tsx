import { useState } from 'react'

import { formatMoney, fromMajorUnits, type CurrencyCode } from '@/core/money.ts'
import { parseISODate, toISODate } from '@/core/time.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import type { FixedExpense } from '@/domain/model/fixed.ts'
import { debtWarnings, validateDebt, type DebtProblem, type DebtWarning } from '@/domain/debt.ts'
import {
  AUTO_TRACK_KINDS,
  DEBT_KINDS,
  type AutoTracking,
  type AutoTrackKind,
  type Debt,
  type DebtKind,
} from '@/domain/model/debt.ts'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'
import {
  DEBT_KIND_LABEL,
  PAYROLL_TRACKING_NOTE,
  TRACK_KIND_HINT,
  TRACK_KIND_LABEL,
} from './labels.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'

/**
 * One thing that is owed.
 *
 * **The tracking mechanism is the consequential field and the form treats it as
 * one.** Picking it decides which ledger rows become payments against this
 * balance — so each option carries a sentence saying what it will actually do,
 * and the ref that goes with it is a different control per kind rather than one
 * text box that means three things. The domain holds the pair as a discriminated
 * union (D-083) and this form is where that shape earns its keep: switching kind
 * replaces the ref rather than leaving the previous kind's string behind.
 *
 * **Payroll is not among the four, and the form says where it went** rather than
 * leaving the user to look for it. A salary-deducted loan is linked from the
 * deduction type, because the link already lives there (migration `012`) and two
 * edges for one relationship can point at different things.
 *
 * **The principal is what outstanding counts down from, not what is left.** The
 * hint says so, because "amount borrowed" and "amount still owed" are the same
 * shape of number and typing the second into the first makes a debt that looks
 * plausible and is wrong by every payment already made.
 */
export function DebtEditor({
  initial,
  isNew,
  accounts,
  categories,
  others,
  expenses,
  currency,
  onSave,
  onCancel,
}: {
  initial: Debt
  isNew: boolean
  accounts: readonly Account[]
  categories: readonly Category[]
  /**
   * The other debts and the fixed expenses, rather than the warnings themselves.
   *
   * The warnings are about the **draft**, which only this component can see, so
   * a caller computing them would be answering a question about the debt as it
   * was when the form opened — and the one moment they matter is while a pattern
   * is being typed into a box another debt already watches.
   */
  others: readonly Debt[]
  expenses: readonly FixedExpense[]
  currency: CurrencyCode
  onSave: (debt: Debt) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [principalText, setPrincipalText] = useState(() =>
    editableMoney(initial.principalAmount),
  )
  const [monthlyText, setMonthlyText] = useState(() =>
    initial.monthlyPaymentAmount === undefined
      ? ''
      : formatMoney(initial.monthlyPaymentAmount, { symbol: false }),
  )

  const set = (change: Partial<Debt>): void => setDraft((current) => ({ ...current, ...change }))

  /**
   * Switching kind builds a fresh ref rather than carrying the old one across.
   * A category id left in a merchant pattern would match nothing; a merchant
   * pattern left in a category id would match everything filed under a category
   * that does not exist. Both are silent.
   */
  const setTrackKind = (kind: AutoTrackKind): void => set({ tracking: blankTracking(kind) })

  const problems = validateDebt(draft)
  const warnings = debtWarnings(draft, others, expenses)

  return (
    <form
      className="fc-view-enter h-full overflow-auto"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length > 0) return
        onSave(draft)
      }}
    >
      <div className="px-6 py-6">
        <h1 className="text-title">{isNew ? 'Add a debt' : 'Edit debt'}</h1>
        <p className="mt-1 mb-6 max-w-2xl text-caption text-ink-tertiary">
          A debt has no stored balance. What is outstanding is the amount borrowed minus the
          payments recorded against it, so the useful thing to get right is how those payments are
          found.
        </p>

        <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={FIELD}
              autoFocus
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>

          <Field label="What kind">
            <select
              className={SELECT}
              value={draft.kind}
              onChange={(event) => set({ kind: event.target.value as DebtKind })}
            >
              {DEBT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {DEBT_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Amount borrowed" hint="the original sum, not what is left today">
            <input
              className={FIELD}
              inputMode="decimal"
              value={principalText}
              onChange={(event) => {
                setPrincipalText(event.target.value)
                set({
                  principalAmount:
                    moneyFromText(event.target.value, currency, { magnitude: true }) ?? fromMajorUnits(0, currency),
                })
              }}
            />
          </Field>

          <Field label="Expected monthly payment" hint="optional — projects a debt with no history">
            <input
              className={FIELD}
              inputMode="decimal"
              value={monthlyText}
              onChange={(event) => {
                setMonthlyText(event.target.value)
                set({ monthlyPaymentAmount: moneyFromText(event.target.value, currency, { magnitude: true }) })
              }}
            />
          </Field>

          <Field label="Taken out on">
            <input
              type="date"
              className={FIELD}
              value={toISODate(draft.openedDate)}
              onChange={(event) =>
                set({ openedDate: parseISODate(event.target.value) ?? draft.openedDate })
              }
            />
          </Field>

          <Field label="Expected to end" hint="optional">
            <input
              type="date"
              className={FIELD}
              value={draft.expectedEndDate === undefined ? '' : toISODate(draft.expectedEndDate)}
              onChange={(event) =>
                set({ expectedEndDate: parseISODate(event.target.value) ?? undefined })
              }
            />
          </Field>
        </div>

        <h2 className="mt-8 text-heading">How its payments are found</h2>
        <p className="mt-1 mb-3 max-w-2xl text-caption text-ink-tertiary">
          Whatever this finds is offered for confirmation before it counts as agreed — nothing here
          is applied silently. {PAYROLL_TRACKING_NOTE}
        </p>

        <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {AUTO_TRACK_KINDS.map((kind) => {
            const chosen = draft.tracking.kind === kind
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setTrackKind(kind)}
                className={`rounded-md border px-4 py-3 text-left transition-colors duration-[var(--duration-micro)] ${
                  chosen ? 'border-accent bg-accent-soft' : 'border-hairline hover:border-hairline-strong'
                }`}
              >
                <span>{TRACK_KIND_LABEL[kind]}</span>
                <p className="mt-1 text-caption text-ink-tertiary">{TRACK_KIND_HINT[kind]}</p>
              </button>
            )
          })}
        </div>

        <div className="mt-4 max-w-3xl">
          <TrackingRef
            tracking={draft.tracking}
            categories={categories}
            onChange={(tracking) => set({ tracking })}
          />
        </div>

        {warnings.length > 0 && (
          <div className="mt-4 max-w-3xl rounded-md border border-hairline bg-surface px-4 py-3">
            {warnings.map((warning) => (
              <p key={warning} className="text-caption text-ink-secondary">
                {WARNING_MESSAGE[warning]}
              </p>
            ))}
          </div>
        )}

        <div className="mt-8 grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Paid from" hint="which account the money leaves — for your reference only">
            <select
              className={SELECT}
              value={draft.linkedAccountId ?? ''}
              onChange={(event) =>
                set({ linkedAccountId: event.target.value === '' ? undefined : event.target.value })
              }
            >
              <option value="">Not recorded</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>

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

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
            {isNew ? 'Add debt' : 'Save'}
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

/**
 * The one control the chosen mechanism needs, and nothing else on screen.
 *
 * A merchant pattern is text, a category is the ledger's own picker, and an
 * installment group is a key the user should almost never type — so that one
 * says where it normally comes from instead of pretending to be a field like
 * the others.
 */
function TrackingRef({
  tracking,
  categories,
  onChange,
}: {
  tracking: AutoTracking
  categories: readonly Category[]
  onChange: (tracking: AutoTracking) => void
}) {
  switch (tracking.kind) {
    case 'NONE':
      return null
    case 'MERCHANT_PATTERN':
      return (
        <Field
          label="Merchant contains"
          hint="matched the way a category rule matches: spacing and punctuation are ignored"
        >
          <input
            className={`${FIELD} max-w-md`}
            dir="auto"
            value={tracking.pattern}
            onChange={(event) => onChange({ kind: 'MERCHANT_PATTERN', pattern: event.target.value })}
          />
        </Field>
      )
    case 'CATEGORY':
      return (
        <div className="flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">Category</span>
          <div className="max-w-md">
            <CategoryPicker
              categories={categories}
              value={tracking.categoryId === '' ? undefined : tracking.categoryId}
              onChange={(categoryId) =>
                onChange({ kind: 'CATEGORY', categoryId: categoryId ?? '' })
              }
              label="Which category counts as a repayment"
            />
          </div>
        </div>
      )
    case 'CARD_INSTALLMENT_GROUP':
      return (
        <Field
          label="Installment group"
          hint="normally filled in for you by promoting a split purchase from the ledger"
        >
          <input
            className={`${FIELD} max-w-md font-mono`}
            value={tracking.groupKey}
            onChange={(event) =>
              onChange({ kind: 'CARD_INSTALLMENT_GROUP', groupKey: event.target.value })
            }
          />
        </Field>
      )
  }
}

/** A blank tracking of the given kind — never the previous kind's ref. */
function blankTracking(kind: AutoTrackKind): AutoTracking {
  switch (kind) {
    case 'NONE':
      return { kind: 'NONE' }
    case 'MERCHANT_PATTERN':
      return { kind, pattern: '' }
    case 'CATEGORY':
      return { kind, categoryId: '' }
    case 'CARD_INSTALLMENT_GROUP':
      return { kind, groupKey: '' }
  }
}

/** A blank debt to open the editor on. */
export function blankDebt(currency: CurrencyCode, openedDate: Debt['openedDate']): Debt {
  return {
    id: 'new',
    name: '',
    kind: 'BANK_LOAN',
    principalAmount: fromMajorUnits(0, currency),
    openedDate,
    expectedEndDate: undefined,
    monthlyPaymentAmount: undefined,
    linkedAccountId: undefined,
    tracking: { kind: 'NONE' },
    isClosed: false,
    note: undefined,
  }
}

const PROBLEM_MESSAGE: Readonly<Record<DebtProblem, string>> = {
  NO_NAME: 'Give it a name',
  NON_POSITIVE_PRINCIPAL: 'Enter what was borrowed',
  NEGATIVE_MONTHLY_PAYMENT: 'A monthly payment cannot be negative',
  EMPTY_TRACKING_REF: 'Fill in what this should match, or choose to enter payments yourself',
  PATTERN_TOO_LONG: 'That pattern is too long to match on',
  ENDS_BEFORE_IT_STARTS: 'The end date is before the start date',
  MIXED_CURRENCY: 'The monthly payment is in a different currency from the amount borrowed',
}

/**
 * Both of these describe a document that is allowed. docs/f08 warns at save time
 * rather than refusing, and the app behaves correctly meanwhile: the row becomes
 * a question rather than two payments, and the obligation is left out of the
 * plan's total rather than subtracted twice.
 */
const WARNING_MESSAGE: Readonly<Record<DebtWarning, string>> = {
  TRACKING_SHARED_WITH_ANOTHER_DEBT:
    'Another debt is watching the same thing. Rows both of them match will be sent to review with a choice of debt rather than counted against either.',
  TRACKING_SHARED_WITH_FIXED_EXPENSE:
    'A bill is watching the same thing. This debt will be left out of the plan’s total, because that money has already been subtracted once.',
}

