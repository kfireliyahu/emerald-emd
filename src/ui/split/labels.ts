import type { BasisKind } from '@/domain/model/plan.ts'
import { tNow } from '@/i18n/words.ts'

/**
 * What the splitter vocabulary is called on screen.
 *
 * Here rather than generated from the identifiers, for the reason `ROLE_LABEL`
 * and the fixed-expense labels exist: `AVERAGE_LAST_N` reads as "Average of the
 * last few months", which is the phrase the user recognizes, and no amount of
 * title-casing gets there from the enum.
 */
export const BASIS_LABEL: Readonly<Record<BasisKind, string>> = {
  get LAST_PAYCHECK() {
    return tNow('plan.basisKind.LAST_PAYCHECK')
  },
  get AVERAGE_LAST_N() {
    return tNow('plan.basisKind.AVERAGE_LAST_N')
  },
  get SPECIFIC_PAYCHECK() {
    return tNow('plan.basisKind.SPECIFIC_PAYCHECK')
  },
  get CUSTOM_AMOUNT() {
    return tNow('plan.basisKind.CUSTOM_AMOUNT')
  },
}
