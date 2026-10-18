/**
 * What the savings vocabulary is called on screen.
 *
 * Here rather than title-cased from the identifier, for the reason
 * `funds/labels.ts` exists: `EARMARKED` is "for something specific" and
 * `FROM_PAYCHECK_DEDUCTION` is "from a payslip", and neither survives a
 * mechanical transformation of its enum name.
 *
 * The Hebrew is in the hint, never the label. UI copy is English
 * (docs/conventions), and the Hebrew is what the user's bank calls the thing —
 * which is exactly what someone naming a holding needs beside the English word.
 */

import type {
  DepositSourceKind,
  HoldingKind,
  HoldingPlaceKind,
  SavingDeposit,
} from '@/domain/model/savings.ts'

export const PLACE_KIND_LABEL: Readonly<Record<HoldingPlaceKind, string>> = {
  CHECKING: 'Current account',
  DEPOSIT: 'Fixed deposit',
  // Investments — what an account with holdings keeps, and what a place kept by
  // hand may hold too, so it is not called an account (M36 U12, D-389).
  INVESTMENT: 'Investments',
  CASH: 'Cash',
  OTHER: 'Other',
}

export const PLACE_KIND_HEBREW: Readonly<Record<HoldingPlaceKind, string>> = {
  CHECKING: 'עו"ש',
  DEPOSIT: 'פק"מ',
  INVESTMENT: 'תיק השקעות',
  CASH: 'מזומן',
  OTHER: 'אחר',
}

/** What form the money takes (D-175). A place is where; this is what. */
export const HOLDING_KIND_LABEL: Readonly<Record<HoldingKind, string>> = {
  CASH: 'Cash',
  DEPOSIT: 'Fixed deposit',
  FUND: 'Fund',
  TRACK: 'Investment track',
  SECURITY: 'A security',
  OTHER: 'Other',
}

export const HOLDING_KIND_HEBREW: Readonly<Record<HoldingKind, string>> = {
  CASH: 'מזומן / עו"ש',
  DEPOSIT: 'פק"מ',
  FUND: 'קרן',
  TRACK: 'מסלול השקעה',
  SECURITY: 'נייר ערך',
  OTHER: 'אחר',
}

/**
 * **How the balance is known** — the money map's third column (D-176).
 *
 * Each is a sentence about where the number came from rather than a label for a
 * kind of account, because that is the distinction that decides whether the app
 * can ever tell the user their figure is out of date.
 */
/** The map's third column when nobody has ever confirmed the figure. */
export const NEVER_CONFIRMED = 'never checked'

export const SOURCE_LABEL: Readonly<Record<DepositSourceKind, string>> = {
  MANUAL: 'Entered by hand',
  FROM_TRANSACTION: 'From a transaction',
  FROM_PAYCHECK_DEDUCTION: 'From a paycheck',
  FROM_PLAN: 'From a split plan',
  OPENING_BALANCE: 'Was already there',
  GROWTH: 'Growth, not a deposit',
}

/**
 * The note `recordTransfer` writes when the user gave none.
 *
 * Both movement lists drop it, because a row that already says "moved between
 * places" and then prints "Moved between holdings" beside it reads as two
 * facts rather than one. The repository still writes it, so a movement is never
 * a bare row in a file opened somewhere else.
 */
export const DEFAULT_TRANSFER_NOTE = 'Moved between holdings'

/**
 * Only today's wording: the one migration 024 left on older transfers is no
 * longer recognized, since there is no old-file handling (M45 F1).
 */
export function isDefaultTransferNote(deposit: SavingDeposit): boolean {
  return (
    deposit.transferGroupKey !== undefined &&
    deposit.note === DEFAULT_TRANSFER_NOTE
  )
}
