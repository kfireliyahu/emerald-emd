import { useState } from 'react'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import {
  paymentWarnings,
  draftPrincipalPart,
  validatePayment,
  type PaymentProblem,
  type PaymentWarning,
} from '@/domain/debt.ts'
import type { Debt, DebtPayment } from '@/domain/model/debt.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'

/**
 * One payment, entered by hand.
 *
 * **The interest split is one field, not two.** The model stores the interest
 * and derives the principal (D-083), and this form shows the derived figure
 * while the interest is typed rather than offering a second box: two boxes with
 * an arithmetic relation between them are two things to keep in step, and the
 * one that matters — how much came off what is owed — is the one nobody would
 * check.
 *
 * **An overpayment is a warning, never a refusal.** docs/f08's edge-case table
 * draws the line there: a payment into a closed debt is blocked because the debt
 * is not taking any, and one larger than the balance is allowed because it
 * happens and the bank transfer has already cleared. `validatePayment` and
 * `paymentWarnings` split the same way, and this form only renders what they
 * each say.
 */
export function PaymentEditor({
  initial,
  isNew,
  debts,
  existing,
  currency,
  onSave,
  onCancel,
}: {
  initial: DebtPayment
  isNew: boolean
  debts: readonly Debt[]
  /** Every payment in the document, for the exceeds-the-balance warning. */
  existing: readonly DebtPayment[]
  currency: CurrencyCode
  onSave: (payment: DebtPayment) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [amountText, setAmountText] = useState(() =>
    editableMoney(initial.amount),
  )
  const [interestText, setInterestText] = useState(() =>
    editableMoney(initial.interestPortion),
  )

  const set = (change: Partial<DebtPayment>): void =>
    setDraft((current) => ({ ...current, ...change }))

  const debt = debts.find((one) => one.id === draft.debtId)
  // A draft has no row for the document to work out its principal part on yet.
  const part = draftPrincipalPart(draft.amount, draft.interestPortion)
  const problems = validatePayment(draft, { debt })
  const warnings = debt === undefined ? [] : paymentWarnings({ ...draft, principalPart: part }, debt, existing)

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
        <h1 className="text-title">{isNew ? 'Record a payment' : 'Edit payment'}</h1>
        <p className="mt-1 mb-6 max-w-2xl text-caption text-ink-tertiary">
          What is outstanding comes down by the principal, not by the whole payment. Leave the
          interest empty and the payment counts entirely against what is owed, which is what most
          of them are.
        </p>

        <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Which debt">
            <select
              className={SELECT}
              value={draft.debtId}
              onChange={(event) => set({ debtId: event.target.value })}
            >
              {debts.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                  {one.isClosed ? ' (closed)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="When">
            <input
              type="date"
              className={FIELD}
              value={toISODate(draft.date)}
              onChange={(event) => set({ date: parseISODate(event.target.value) ?? draft.date })}
            />
          </Field>

          <Field label="How much left the account">
            <input
              className={FIELD}
              autoFocus
              inputMode="decimal"
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value)
                const amount = moneyFromText(event.target.value, currency, { magnitude: true }) ?? money(0, currency)
                set({
                  amount,
                  // The interest is denominated with the amount, or the two
                  // could disagree about a currency the column cannot hold.
                  interestPortion: money(draft.interestPortion.minor, amount.currency),
                })
              }}
            />
          </Field>

          <Field
            label="Of which interest"
            hint="optional — leave empty and all of it comes off what is owed"
          >
            <input
              className={FIELD}
              inputMode="decimal"
              value={interestText}
              onChange={(event) => {
                setInterestText(event.target.value)
                set({
                  interestPortion:
                    moneyFromText(event.target.value, draft.amount.currency, { magnitude: true }) ??
                    money(0, draft.amount.currency),
                })
              }}
            />
          </Field>
        </div>

        <p className="mt-4 max-w-3xl text-caption text-ink-tertiary">
          {draft.interestPortion.minor === 0
            ? 'All of it comes off what is owed.'
            : part === undefined
              ? 'The interest is in another currency, so what comes off cannot be said.'
              : `${formatMoney(part)} of this comes off what is owed.`}
        </p>

        <div className="mt-6 grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
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

        {warnings.length > 0 && (
          <div className="mt-4 max-w-3xl rounded-md border border-hairline bg-surface px-4 py-3">
            {warnings.map((warning) => (
              <p key={warning} className="text-caption text-ink-secondary">
                {WARNING_MESSAGE[warning]}
              </p>
            ))}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
            {isNew ? 'Record it' : 'Save'}
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

/** A blank payment against a debt, dated today. */
export function blankPayment(debt: Debt, date: LocalDate): DebtPayment {
  const currency = debt.principalAmount.currency
  return {
    id: 'new',
    debtId: debt.id,
    date,
    amount: money(0, currency),
    interestPortion: money(0, currency),
    principalPart: money(0, currency),
    sourceKind: 'MANUAL',
    sourceRefId: undefined,
    isConfirmed: true,
    note: undefined,
  }
}

const PROBLEM_MESSAGE: Readonly<Record<PaymentProblem, string>> = {
  UNKNOWN_DEBT: 'Pick a debt',
  CLOSED_DEBT: 'That debt is closed. Reopen it to record a payment against it.',
  ZERO_AMOUNT: 'Enter how much was paid',
  NEGATIVE_AMOUNT: 'A payment is a positive amount',
  NEGATIVE_INTEREST: 'Interest cannot be negative',
  INTEREST_EXCEEDS_PAYMENT: 'The interest is more than the payment',
  MIXED_CURRENCY: 'This payment is in a different currency from the debt',
}

const WARNING_MESSAGE: Readonly<Record<PaymentWarning, string>> = {
  EXCEEDS_OUTSTANDING:
    'This is more than what is left. That is allowed — the debt will show as overpaid, and you will be offered the chance to close it.',
}

