/**
 * What the fund vocabulary is called on screen.
 *
 * Here rather than generated from the identifier, for the reason `roleLabel.ts`
 * exists: `PROVIDENT_FOR_INVESTMENT` is "provident fund for investment" and
 * `MANAGERS_INSURANCE` is "managers' insurance", and neither survives a
 * title-case of its enum name.
 *
 * The Hebrew is in the hint, not the label. UI copy is English (docs/conventions)
 * and the Hebrew is what the fund's own report prints — which is exactly what a
 * user transcribing one needs to see beside the English word.
 */

import type { DepositStatus } from '@/domain/funds.ts'
import type { FundStatus, FundType } from '@/domain/model/funds.ts'

export const FUND_TYPE_LABEL: Readonly<Record<FundType, string>> = {
  PENSION: 'Pension fund',
  STUDY_FUND: 'Study fund',
  PROVIDENT: 'Provident fund',
  MANAGERS_INSURANCE: "Managers' insurance",
  PROVIDENT_FOR_INVESTMENT: 'Provident fund for investment',
}

export const FUND_TYPE_HEBREW: Readonly<Record<FundType, string>> = {
  PENSION: 'קרן פנסיה',
  STUDY_FUND: 'קרן השתלמות',
  PROVIDENT: 'קופת גמל',
  MANAGERS_INSURANCE: 'ביטוח מנהלים',
  PROVIDENT_FOR_INVESTMENT: 'קופת גמל להשקעה',
}

export const FUND_STATUS_LABEL: Readonly<Record<FundStatus, string>> = {
  ACTIVE: 'Active',
  DORMANT: 'Dormant',
  CLOSED: 'Closed',
}

/**
 * The one sentence docs/f13 asks the deposit check to produce, per verdict.
 *
 * Short enough to sit on a card. The figures go beside it rather than inside it,
 * so the same wording serves the chip on the funds screen and the row on the
 * deposit-check screen.
 */
export const DEPOSIT_STATUS_LABEL: Readonly<Record<DepositStatus, string>> = {
  WITHIN_TOLERANCE: 'Deposits match your paychecks',
  DEPOSITS_MISSING: 'Deposits are missing',
  DEPOSITS_EXCEED_PAYSLIPS: 'More arrived than your paychecks show',
  ACKNOWLEDGED: 'Gap checked and explained',
}
