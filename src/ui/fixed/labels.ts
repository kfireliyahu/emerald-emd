import type {
  AmountVariability,
  Cadence,
  FixedExpenseMatchKind,
} from '@/domain/model/fixed.ts'
import { tNow } from '@/i18n/words.ts'

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
  get MONTHLY() {
    return tNow('plan.fixed.cadence.MONTHLY')
  },
  get BIMONTHLY() {
    return tNow('plan.fixed.cadence.BIMONTHLY')
  },
  get QUARTERLY() {
    return tNow('plan.fixed.cadence.QUARTERLY')
  },
  get YEARLY() {
    return tNow('plan.fixed.cadence.YEARLY')
  },
  get IRREGULAR() {
    return tNow('plan.fixed.cadence.IRREGULAR')
  },
}

export const MATCH_KIND_LABEL: Readonly<Record<FixedExpenseMatchKind, string>> = {
  get MERCHANT_PATTERN() {
    return tNow('plan.fixed.matchKind.MERCHANT_PATTERN')
  },
  get CATEGORY() {
    return tNow('plan.fixed.matchKind.CATEGORY')
  },
  get PAYCHECK_DEDUCTION() {
    return tNow('plan.fixed.matchKind.PAYCHECK_DEDUCTION')
  },
  get MANUAL_ONLY() {
    return tNow('plan.fixed.matchKind.MANUAL_ONLY')
  },
}

/** What each match kind asks for in `matchRef`, shown as the field's own label. */
export const MATCH_REF_LABEL: Readonly<Record<FixedExpenseMatchKind, string>> = {
  get MERCHANT_PATTERN() {
    return tNow('plan.fixed.matchRef.MERCHANT_PATTERN')
  },
  get CATEGORY() {
    return tNow('plan.fixed.matchRef.CATEGORY')
  },
  get PAYCHECK_DEDUCTION() {
    return tNow('plan.fixed.matchRef.PAYCHECK_DEDUCTION')
  },
  MANUAL_ONLY: '',
}

export const VARIABILITY_LABEL: Readonly<Record<AmountVariability, string>> = {
  get FIXED() {
    return tNow('plan.fixed.variability.FIXED')
  },
  get VARIABLE() {
    return tNow('plan.fixed.variability.VARIABLE')
  },
}
