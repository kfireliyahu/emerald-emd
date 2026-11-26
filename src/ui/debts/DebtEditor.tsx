import { useState } from 'react'

import { formatMoney, fromMajorUnits, type CurrencyCode } from '@/core/money.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import type { FixedExpense } from '@/domain/model/fixed.ts'
import { debtWarnings, validateDebt, type DebtProblem, type DebtWarning } from '@/domain/debt.ts'
import { AUTO_TRACK_KINDS, DEBT_KINDS, type AutoTracking, type AutoTrackKind, type Debt, type DebtKind } from '@/domain/model/debt.ts'
import { countKey } from '@/i18n/count.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { AmountInput, DateInput, FormField, FormGrid, MoreFields, PanelForm, Said } from '@/ui/components/PanelForm.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'
import { useWealthWords } from '@/ui/wealth/words.ts'

/**
 * One thing that is owed — a `PanelForm` beside the debts (M64 F3, D-629): its
 * name, its kind, what was borrowed and what is paid a month first, said back
 * as a count of payments; how its payments are found, and its dates and notes,
 * each one verb further.
 *
 * **The tracking mechanism is the consequential field and the form treats it as
 * one.** Picking it decides which ledger rows become payments against this
 * balance — so each option carries a sentence saying what it will actually do,
 * and the ref that goes with it is a different control per kind rather than one
 * text box that means three things (D-083): switching kind replaces the ref
 * rather than leaving the previous kind's string behind.
 *
 * **Payroll is not among the four, and the form says where it went**: a
 * salary-deducted loan is linked from the deduction type, because the link
 * already lives there (migration `012`).
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
   * The other debts and the fixed expenses, rather than the warnings themselves:
   * the warnings are about the **draft**, which only this component can see.
   */
  others: readonly Debt[]
  expenses: readonly FixedExpense[]
  currency: CurrencyCode
  onSave: (debt: Debt) => void
  onCancel: () => void
}) {
  const t = useT()
  const words = useWealthWords()
  const [draft, setDraft] = useState(initial)
  const [principalText, setPrincipalText] = useState(() => editableMoney(initial.principalAmount))
  const [monthlyText, setMonthlyText] = useState(() =>
    initial.monthlyPaymentAmount === undefined ? '' : formatMoney(initial.monthlyPaymentAmount, { symbol: false }),
  )
  const [accountText, setAccountText] = useState(() => accounts.find((one) => one.id === initial.linkedAccountId)?.name ?? '')

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
  // An untouched new debt only waits: its name and amount are asked for once something is typed.
  const touched = draft.name !== initial.name || principalText !== editableMoney(initial.principalAmount)
  const shown = isNew && !touched ? problems.filter((problem) => problem !== 'NO_NAME' && problem !== 'NON_POSITIVE_PRINCIPAL') : problems
  const notRecorded = t('wealth.debtForm.notRecorded')

  return (
    <PanelForm
      save={isNew ? t('wealth.debtForm.add') : t('wealth.reading.save')}
      canSave={problems.length === 0}
      onSave={() => onSave(draft)}
      onCancel={onCancel}
      problems={shown.map((problem) => t(PROBLEM[problem]))}
    >
      <FormGrid>
        <FormField label={t('wealth.debtForm.name')}>
          <input className={FIELD} value={draft.name} onChange={(event) => set({ name: event.target.value })} />
        </FormField>
        <FormField label={t('wealth.debtForm.kind')}>
          <ChoiceMenu
            className={`${FIELD} w-full`}
            text={words.debt[draft.kind]}
            choices={DEBT_KINDS.map((kind) => ({ value: kind, label: words.debt[kind] }))}
            onPick={(choice) => set({ kind: choice.value as DebtKind })}
          />
        </FormField>
        <AmountInput
          label={t('wealth.debtForm.borrowed')}
          currency={currency}
          placeholder="0"
          value={principalText}
          onChange={(event) => {
            setPrincipalText(event.target.value)
            set({ principalAmount: moneyFromText(event.target.value, currency, { magnitude: true }) ?? fromMajorUnits(0, currency) })
          }}
        />
        <AmountInput
          label={t('wealth.debtForm.monthly')}
          currency={currency}
          placeholder="0"
          value={monthlyText}
          onChange={(event) => {
            setMonthlyText(event.target.value)
            set({ monthlyPaymentAmount: moneyFromText(event.target.value, currency, { magnitude: true }) })
          }}
        />
      </FormGrid>

      <Said>{debtSaid(draft, t)}</Said>

      <MoreFields
        label={t('wealth.debtForm.found')}
        summary={t(TRACK[draft.tracking.kind].label)}
        initiallyOpen={draft.tracking.kind !== 'NONE'}
      >
        <p className="m-0 text-caption text-ink-secondary">{t('wealth.debtForm.foundLead')}</p>
        <div role="radiogroup" aria-label={t('wealth.debtForm.found')} className="flex flex-col">
          {AUTO_TRACK_KINDS.map((kind) => {
            const chosen = draft.tracking.kind === kind
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => setTrackKind(kind)}
                className={`flex flex-col gap-1 border-b border-hairline py-2 ps-3 text-start transition-colors duration-[var(--duration-micro)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  chosen ? 'border-s-2 border-s-accent bg-accent-soft' : 'border-s-2 border-s-transparent hover:bg-surface'
                }`}
              >
                <span>{t(TRACK[kind].label)}</span>
                <span className="text-caption text-ink-secondary">{t(TRACK[kind].hint)}</span>
              </button>
            )
          })}
        </div>
        <TrackingRef tracking={draft.tracking} categories={categories} onChange={(tracking) => set({ tracking })} t={t} />
        {warnings.length > 0 && <Said>{warnings.map((warning) => t(WARNING[warning])).join(' ')}</Said>}
        <p className="m-0 text-caption text-ink-secondary">{t('wealth.debtForm.payroll')}</p>
      </MoreFields>

      <MoreFields label={t('wealth.debtForm.more')} summary={t('wealth.debtForm.moreSummary')} initiallyOpen={!isNew && (draft.expectedEndDate !== undefined || draft.note !== undefined)}>
        <FormGrid>
          <FormField label={t('wealth.debtForm.opened')}>
            <DateInput value={draft.openedDate} onChange={(date) => set({ openedDate: date ?? draft.openedDate })} />
          </FormField>
          <FormField label={t('wealth.debtForm.ends')}>
            <DateInput value={draft.expectedEndDate} onChange={(date) => set({ expectedEndDate: date ?? undefined })} />
          </FormField>
          <FormField label={t('wealth.debtForm.paidFrom')} hint={t('wealth.debtForm.paidFromHint')} wide>
            <ChoiceMenu
              className={`${FIELD} w-full`}
              text={accountText === '' ? notRecorded : accountText}
              choices={[{ value: '', label: notRecorded }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]}
              onPick={(choice) => {
                setAccountText(choice.value === '' ? '' : choice.label)
                set({ linkedAccountId: choice.value === '' ? undefined : choice.value })
              }}
            />
          </FormField>
          <FormField label={t('wealth.debtForm.note')} wide>
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

/**
 * **What was typed, said back**: the amount borrowed, and at the monthly payment
 * how many payments that is — before interest, which the words say, because a
 * count that ignored it without saying so would be a promise.
 */
function debtSaid(draft: Debt, t: Translate): string {
  const borrowed = draft.principalAmount
  if (borrowed.minor <= 0) return t('wealth.debtForm.saidEmpty')
  const monthly = draft.monthlyPaymentAmount
  if (monthly === undefined || monthly.minor <= 0 || monthly.currency !== borrowed.currency) {
    return t('wealth.debtForm.saidBorrowed', { amount: formatMoney(borrowed) })
  }
  const count = Math.ceil(borrowed.minor / monthly.minor)
  return t(countKey('wealth.debtForm.saidPayments', count), { amount: formatMoney(borrowed), monthly: formatMoney(monthly), count })
}

/**
 * The one control the chosen mechanism needs, and nothing else on screen. A
 * merchant pattern is text, a category is the ledger's own picker, and an
 * installment group is a key the user should almost never type — so that one
 * says where it normally comes from.
 */
function TrackingRef({
  tracking,
  categories,
  onChange,
  t,
}: {
  tracking: AutoTracking
  categories: readonly Category[]
  onChange: (tracking: AutoTracking) => void
  t: Translate
}) {
  switch (tracking.kind) {
    case 'NONE':
      return null
    case 'MERCHANT_PATTERN':
      return (
        <FormField label={t('wealth.debtForm.merchant')} hint={t('wealth.debtForm.merchantHint')}>
          <input
            className={FIELD}
            dir="auto"
            value={tracking.pattern}
            onChange={(event) => onChange({ kind: 'MERCHANT_PATTERN', pattern: event.target.value })}
          />
        </FormField>
      )
    case 'CATEGORY':
      return (
        <div className="flex flex-col gap-1">
          <span className="text-label text-ink-secondary uppercase">{t('wealth.debtForm.category')}</span>
          <CategoryPicker
            categories={categories}
            value={tracking.categoryId === '' ? undefined : tracking.categoryId}
            onChange={(categoryId) => onChange({ kind: 'CATEGORY', categoryId: categoryId ?? '' })}
            label={t('wealth.debtForm.categoryLabel')}
          />
        </div>
      )
    case 'CARD_INSTALLMENT_GROUP':
      return (
        <FormField label={t('wealth.debtForm.group')} hint={t('wealth.debtForm.groupHint')}>
          <input
            className={`${FIELD} font-mono`}
            value={tracking.groupKey}
            onChange={(event) => onChange({ kind: 'CARD_INSTALLMENT_GROUP', groupKey: event.target.value })}
          />
        </FormField>
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

const TRACK = {
  NONE: { label: 'wealth.debtForm.track.NONE', hint: 'wealth.debtForm.trackHint.NONE' },
  MERCHANT_PATTERN: { label: 'wealth.debtForm.track.MERCHANT_PATTERN', hint: 'wealth.debtForm.trackHint.MERCHANT_PATTERN' },
  CATEGORY: { label: 'wealth.debtForm.track.CATEGORY', hint: 'wealth.debtForm.trackHint.CATEGORY' },
  CARD_INSTALLMENT_GROUP: { label: 'wealth.debtForm.track.CARD_INSTALLMENT_GROUP', hint: 'wealth.debtForm.trackHint.CARD_INSTALLMENT_GROUP' },
} as const satisfies Record<AutoTrackKind, { label: string; hint: string }>

const PROBLEM = {
  NO_NAME: 'wealth.debtForm.problem.NO_NAME',
  NON_POSITIVE_PRINCIPAL: 'wealth.debtForm.problem.NON_POSITIVE_PRINCIPAL',
  NEGATIVE_MONTHLY_PAYMENT: 'wealth.debtForm.problem.NEGATIVE_MONTHLY_PAYMENT',
  EMPTY_TRACKING_REF: 'wealth.debtForm.problem.EMPTY_TRACKING_REF',
  PATTERN_TOO_LONG: 'wealth.debtForm.problem.PATTERN_TOO_LONG',
  ENDS_BEFORE_IT_STARTS: 'wealth.debtForm.problem.ENDS_BEFORE_IT_STARTS',
  MIXED_CURRENCY: 'wealth.debtForm.problem.MIXED_CURRENCY',
} as const satisfies Record<DebtProblem, string>

/**
 * Both of these describe a document that is allowed. docs/f08 warns at save time
 * rather than refusing, and the app behaves correctly meanwhile: the row becomes
 * a question rather than two payments, and the obligation is left out of the
 * plan's total rather than subtracted twice.
 */
const WARNING = {
  TRACKING_SHARED_WITH_ANOTHER_DEBT: 'wealth.debtForm.warning.TRACKING_SHARED_WITH_ANOTHER_DEBT',
  TRACKING_SHARED_WITH_FIXED_EXPENSE: 'wealth.debtForm.warning.TRACKING_SHARED_WITH_FIXED_EXPENSE',
} as const satisfies Record<DebtWarning, string>
