import type {
  AmountVariability,
  Cadence,
  FixedExpenseMatchKind,
} from '@/domain/model/fixed.ts'

/**
 * What the fixed-expense vocabulary is called on screen.
 *
 * Here rather than generated from the identifiers, for the reason `ROLE_LABEL`
 * exists in the import folder: `PAYCHECK_DEDUCTION` reads as "Taken from my
 * payslip", which is the sentence the user recognizes, and no amount of
 * title-casing gets there from the enum.
 *
 * UI copy is English even though the data is Hebrew (docs/conventions.md).
 */
export const CADENCE_LABEL: Readonly<Record<Cadence, string>> = {
  MONTHLY: 'Monthly',
  BIMONTHLY: 'Every 2 months',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
  IRREGULAR: 'Irregular',
}

export const MATCH_KIND_LABEL: Readonly<Record<FixedExpenseMatchKind, string>> = {
  MERCHANT_PATTERN: 'A merchant on my statement',
  CATEGORY: 'Everything in a category',
  PAYCHECK_DEDUCTION: 'Taken from my paycheck',
  MANUAL_ONLY: 'Nothing — I track it myself',
}

/** What each match kind asks for in `matchRef`, shown as the field's own label. */
export const MATCH_REF_LABEL: Readonly<Record<FixedExpenseMatchKind, string>> = {
  MERCHANT_PATTERN: 'Merchant',
  CATEGORY: 'Category',
  PAYCHECK_DEDUCTION: 'Deduction type',
  MANUAL_ONLY: '',
}

export const VARIABILITY_LABEL: Readonly<Record<AmountVariability, string>> = {
  FIXED: 'Same every time',
  VARIABLE: 'Varies',
}
