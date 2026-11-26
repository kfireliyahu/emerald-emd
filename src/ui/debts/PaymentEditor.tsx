import { useState } from 'react'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'
import { paymentWarnings, draftPrincipalPart, validatePayment, type PaymentProblem, type PaymentWarning } from '@/domain/debt.ts'
import type { Debt, DebtPayment } from '@/domain/model/debt.ts'
import { useT } from '@/i18n/current.ts'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { AmountInput, DateInput, FormField, FormGrid, MoreFields, PanelForm, Said } from '@/ui/components/PanelForm.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'
import { useWealthWords } from '@/ui/wealth/words.ts'

/**
 * One payment, entered by hand — a `PanelForm` beside the debts (M64 F3,
 * D-629): which debt and how much first, what comes off what is owed said under
 * it, and the interest, the date and a note only if wanted.
 *
 * **The interest split is one field, not two.** The model stores the interest
 * and derives the principal (D-083), and this form says the derived figure
 * while the interest is typed rather than offering a second box: two boxes with
 * an arithmetic relation between them are two things to keep in step.
 *
 * **An overpayment is a warning, never a refusal.** docs/f08 draws the line
 * there: a payment into a closed debt is blocked because the debt is not taking
 * any, and one larger than the balance is allowed because it happens and the
 * transfer has already cleared. `validatePayment` and `paymentWarnings` split
 * the same way, and this form only renders what they each say.
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
  const t = useT()
  const words = useWealthWords()
  const [draft, setDraft] = useState(initial)
  const [amountText, setAmountText] = useState(() => editableMoney(initial.amount))
  const [interestText, setInterestText] = useState(() => editableMoney(initial.interestPortion))

  const set = (change: Partial<DebtPayment>): void => setDraft((current) => ({ ...current, ...change }))

  const debt = debts.find((one) => one.id === draft.debtId)
  // A draft has no row for the document to work out its principal part on yet.
  const part = draftPrincipalPart(draft.amount, draft.interestPortion)
  const problems = validatePayment(draft, { debt })
  const warnings = debt === undefined ? [] : paymentWarnings({ ...draft, principalPart: part }, debt, existing)
  const shown = amountText.trim() === '' ? problems.filter((problem) => problem !== 'ZERO_AMOUNT') : problems
  const debtName = (one: Debt): string => (one.isClosed ? t('wealth.paymentForm.closedDebt', { name: one.name }) : one.name)

  const said =
    draft.amount.minor === 0
      ? t('wealth.paymentForm.saidEmpty')
      : draft.interestPortion.minor === 0
        ? t('wealth.paymentForm.saidAll', { amount: formatMoney(draft.amount) })
        : part === undefined
          ? t('wealth.paymentForm.saidOther')
          : t('wealth.paymentForm.saidPart', { part: formatMoney(part), amount: formatMoney(draft.amount), interest: formatMoney(draft.interestPortion) })

  return (
    <PanelForm
      save={isNew ? t('wealth.paymentForm.add') : t('wealth.reading.save')}
      canSave={problems.length === 0}
      onSave={() => onSave(draft)}
      onCancel={onCancel}
      problems={shown.map((problem) => t(PROBLEM[problem]))}
    >
      <FormGrid>
        <AmountInput
          label={t('wealth.paymentForm.amount')}
          currency={currency}
          placeholder="0"
          value={amountText}
          onChange={(event) => {
            setAmountText(event.target.value)
            const amount = moneyFromText(event.target.value, currency, { magnitude: true }) ?? money(0, currency)
            // The interest is denominated with the amount, or the two could
            // disagree about a currency the column cannot hold.
            set({ amount, interestPortion: money(draft.interestPortion.minor, amount.currency) })
          }}
        />
        <FormField label={t('wealth.paymentForm.debt')}>
          <ChoiceMenu
            className={`${FIELD} w-full`}
            text={debt === undefined ? '' : debtName(debt)}
            choices={debts.map((one) => ({ value: one.id, label: debtName(one) }))}
            onPick={(choice) => set({ debtId: choice.value })}
          />
        </FormField>
      </FormGrid>

      <Said>
        {said}
        {warnings.length > 0 && ` ${warnings.map((warning) => t(WARNING[warning])).join(' ')}`}
      </Said>

      <MoreFields
        label={t('wealth.paymentForm.more')}
        summary={t('wealth.paymentForm.moreSummary', { date: words.dates.dayMonth(draft.date) })}
        initiallyOpen={!isNew && (draft.interestPortion.minor !== 0 || draft.note !== undefined)}
      >
        <FormGrid>
          <FormField label={t('wealth.paymentForm.interest')} hint={t('wealth.paymentForm.interestHint')}>
            <input
              className={`${FIELD} text-end tabular-nums`}
              inputMode="decimal"
              dir="ltr"
              value={interestText}
              onChange={(event) => {
                setInterestText(event.target.value)
                set({
                  interestPortion: moneyFromText(event.target.value, draft.amount.currency, { magnitude: true }) ?? money(0, draft.amount.currency),
                })
              }}
            />
          </FormField>
          <FormField label={t('wealth.paymentForm.when')}>
            <DateInput value={draft.date} onChange={(date) => set({ date: date ?? draft.date })} />
          </FormField>
          <FormField label={t('wealth.paymentForm.note')} wide>
            <textarea
              className={`${FIELD_MULTILINE} min-h-16`}
              value={draft.note ?? ''}
              onChange={(event) => set({ note: event.target.value.trim() === '' ? undefined : event.target.value })}
            />
          </FormField>
        </FormGrid>
      </MoreFields>
    </PanelForm>
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

const PROBLEM = {
  UNKNOWN_DEBT: 'wealth.paymentForm.problem.UNKNOWN_DEBT',
  CLOSED_DEBT: 'wealth.paymentForm.problem.CLOSED_DEBT',
  ZERO_AMOUNT: 'wealth.paymentForm.problem.ZERO_AMOUNT',
  NEGATIVE_AMOUNT: 'wealth.paymentForm.problem.NEGATIVE_AMOUNT',
  NEGATIVE_INTEREST: 'wealth.paymentForm.problem.NEGATIVE_INTEREST',
  INTEREST_EXCEEDS_PAYMENT: 'wealth.paymentForm.problem.INTEREST_EXCEEDS_PAYMENT',
  MIXED_CURRENCY: 'wealth.paymentForm.problem.MIXED_CURRENCY',
} as const satisfies Record<PaymentProblem, string>

const WARNING = {
  EXCEEDS_OUTSTANDING: 'wealth.paymentForm.warning.EXCEEDS_OUTSTANDING',
} as const satisfies Record<PaymentWarning, string>
