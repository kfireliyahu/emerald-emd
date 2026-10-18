import type { BasisKind } from '@/domain/model/plan.ts'

/**
 * What the splitter vocabulary is called on screen.
 *
 * Here rather than generated from the identifiers, for the reason `ROLE_LABEL`
 * and the fixed-expense labels exist: `AVERAGE_LAST_N` reads as "Average of the
 * last few months", which is the phrase the user recognizes, and no amount of
 * title-casing gets there from the enum.
 */
export const BASIS_LABEL: Readonly<Record<BasisKind, string>> = {
  LAST_PAYCHECK: 'My last paycheck',
  AVERAGE_LAST_N: 'Average of the last few months',
  SPECIFIC_PAYCHECK: 'One particular paycheck',
  CUSTOM_AMOUNT: 'An amount I type',
}
