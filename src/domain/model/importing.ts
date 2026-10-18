/**
 * The import mapping and what it produces.
 *
 * Pure TypeScript: no React, no sql.js, no DOM. See docs/04-data-model.md
 * ("Import") and decision log D-013 — the mapping is created and owned by the
 * user, and the app only ever guesses at it.
 */

import type { CurrencyCode, Money } from '@/core/money.ts'
import type { LocalDate, YearMonth } from '@/core/time.ts'

/**
 * What a column means. `date`, `amount` and `merchant` are required before a
 * mapping can be used; everything else is optional, and anything unmapped is
 * ignored but kept in the row's raw cells so a mapping can be improved and the
 * file re-imported.
 *
 * A transaction carries two dates, so this list offers two: `date` is when the
 * purchase happened, `chargeDate` is when it hit the account. A third
 * "original date" role used to sit here for a format that states a purchase
 * date *in addition to* its own transaction date; no known format does, nothing
 * ever read it, and a role the mapper accepts and the parser drops is worse
 * than one that is not offered. Retired in D-036.
 *
 * `debit` and `credit` are the bank pair (חובה / זכות): two columns stating one
 * amount between them, read under `SEPARATE_DEBIT_CREDIT` and ignored under
 * every other convention. They are the two roles that comment was waiting for.
 * A bank statement's value date (תאריך ערך) is `chargeDate` — docs/04 defines
 * that field as "the card billing date, or bank value date" — so it needs no
 * role of its own.
 */
import type { ColumnRoleId } from './columnRoles.ts'

export const COLUMN_ROLES = [
  'date',
  'amount',
  'merchant',
  'debit',
  'credit',
  'chargeDate',
  'currency',
  'originalAmount',
  'originalCurrency',
  'exchangeRate',
  'providerCategory',
  'installmentText',
  'installmentSequence',
  'installmentTotal',
  'cardLast4',
  'reference',
  'balance',
  'note',
] as const

export type ColumnRole = (typeof COLUMN_ROLES)[number]

export const REQUIRED_ROLES = ['date', 'amount', 'merchant'] as const satisfies readonly ColumnRole[]

/**
 * The same three, with the amount split in two. Both halves are required, not
 * just the debit one: a mapping that named only חובה would read every charge
 * correctly and drop every deposit, which is the kind of wrong that looks right.
 */
export const REQUIRED_ROLES_SPLIT = [
  'date',
  'debit',
  'credit',
  'merchant',
] as const satisfies readonly ColumnRole[]

/**
 * How to read the sign of an amount.
 *
 * `SEPARATE_DEBIT_CREDIT` is the bank convention: money out in one column, money
 * in in another, each stated as a magnitude. It was deliberately absent until
 * F06 — it needed two more column roles and a bank statement to test against —
 * and it arrives with them (D-060).
 */
export const AMOUNT_CONVENTIONS = [
  'SIGNED_SINGLE',
  'POSITIVE_IS_CHARGE',
  'SEPARATE_DEBIT_CREDIT',
] as const

/**
 * Derived from the list rather than written twice, the way `COLUMN_ROLES` and
 * `RULE_KINDS` are. The list exists because a caller outside the mapper — the
 * plugin — has to be able to *offer* the conventions rather than only accept
 * one, and a hand-kept copy of three strings is a hand-kept copy that drifts.
 */
export type AmountConvention = (typeof AMOUNT_CONVENTIONS)[number]

/**
 * Which roles a mapping must assign before it can parse anything.
 *
 * **The convention decides, not the roles.** The two could disagree — a mapping
 * could name `debit` while claiming `POSITIVE_IS_CHARGE` — and something has to
 * be authoritative or the parse and the "what is still missing" check answer to
 * different masters. The convention is the stored field docs/04 names, so it
 * wins, and this function is what stops the disagreement from being usable: a
 * mapping whose convention wants two columns it has not been given reports them
 * as missing rather than quietly parsing as something else.
 */
export function requiredRolesFor(convention: AmountConvention): readonly ColumnRole[] {
  return convention === 'SEPARATE_DEBIT_CREDIT' ? REQUIRED_ROLES_SPLIT : REQUIRED_ROLES
}

/** Which component of a numeric date string comes first. Guessed per column from the values. */
export type DateOrder = 'DMY' | 'MDY' | 'YMD'

/**
 * A mapping in the shape the mapper screen edits it. The persisted
 * `ImportMapping` of docs/04 adds identity, naming, a header signature and
 * usage counters; those arrive with the database in step 3.
 */
export interface DraftMapping {
  readonly sheetName: string
  readonly headerRowIndex: number
  readonly dataStartRowIndex: number
  /**
   * Column index → role. A column absent from this map is ignored.
   *
   * **`ColumnRoleId` rather than `ColumnRole` since M19 U1b** (D-213): the map
   * may name a role somebody added to this document because a real file printed
   * a column no release could name (D-208). Nothing breaks downstream because
   * `applyMapping` is **pull-based** — it asks for each role it knows how to
   * read, so a role it has never heard of is simply never asked for, which is
   * what "named, not stored" means here (D-211).
   */
  readonly columnRoles: ReadonlyMap<number, ColumnRoleId>
  readonly amountConvention: AmountConvention
  /** Per date-bearing role, how to read a numeric date string. */
  readonly dateOrders: ReadonlyMap<ColumnRole, DateOrder>
  /**
   * What an amount is denominated in when no `currency` column states it per
   * row. Guessed from the file, and set by the user in the mapper.
   */
  readonly defaultCurrency: CurrencyCode
}

export type Direction = 'OUTFLOW' | 'INFLOW' | 'TRANSFER'

export interface DraftInstallment {
  readonly sequence: number
  readonly total: number
  /**
   * The full purchase price, as a magnitude in the transaction's own currency.
   * Absent when the file states only the slice.
   */
  readonly originalTotal?: Money | undefined
  /**
   * Shared by every slice of one purchase. Derived from the row (D-007, and
   * `installmentGroupKey` in `@/domain/installments.ts`), never read from a
   * file — no provider ships a purchase identifier.
   */
  readonly groupKey: string
}

export interface DraftForeignAmount {
  readonly originalAmount: Money
  readonly exchangeRate?: number | undefined
}

/**
 * A parsed row, before it has an account, a category or an id. This is what
 * the mapper previews and what step 3 will turn into a `StagedRow`.
 */
export interface DraftTransaction {
  readonly transactionDate: LocalDate
  readonly chargeDate?: LocalDate | undefined
  readonly amount: Money
  readonly direction: Direction
  readonly merchantRaw: string
  readonly merchantNormalized: string
  readonly providerCategory?: string | undefined
  readonly cardLast4?: string | undefined
  readonly reference?: string | undefined
  readonly note?: string | undefined
  readonly installment?: DraftInstallment | undefined
  readonly foreign?: DraftForeignAmount | undefined
  /** Sheet name and row number, so the review screen can say where this came from. */
  readonly sourceRowRef: string
  /**
   * The holding the row's cash turns into inside its account, and how much of
   * it in millionths (M30 U2) — carried to the transaction as written.
   */
  readonly holdingId?: string | undefined
  readonly quantityMicro?: number | undefined
}

/** A failure scoped to one row. One bad row never aborts the rest of the file. */
export interface RowError {
  readonly role: ColumnRole | undefined
  readonly message: string
}

// --- Staging ---------------------------------------------------------------

/**
 * What one row of a file turned out to be.
 *
 * `DUPLICATE_SIMILAR` and `UPDATED` are declared but not yet produced: both
 * need a second, amount-free key to match on, and docs/04 puts the amount
 * *inside* the natural key, so an amended row currently reads as new. The
 * tension is recorded in docs/08. They are in the type because the review
 * screen's status filter and the schema's CHECK both have to know the full set
 * before the classifier does.
 */
export type StagedRowStatus =
  | 'NEW'
  | 'DUPLICATE_EXACT'
  | 'DUPLICATE_SIMILAR'
  | 'UPDATED'
  | 'PARSE_ERROR'
  | 'SKIPPED'

/**
 * What the user said about a row.
 *
 * `PENDING` is the default for everything, including rows the app is confident
 * about: nothing here is auto-anything (docs/conventions.md). The review
 * screen's bulk "accept all new" is what keeps the common case to one action.
 */
export type UserDecision = 'PENDING' | 'ACCEPT' | 'SKIP' | 'EDIT'

/** Statuses that can become a transaction. Everything else is a row to look at, not to commit. */
export const COMMITTABLE_STATUSES = ['NEW'] as const satisfies readonly StagedRowStatus[]

export function isCommittable(status: StagedRowStatus): boolean {
  return (COMMITTABLE_STATUSES as readonly StagedRowStatus[]).includes(status)
}

/**
 * A row in the staging area: what the file said, what the app made of it, and
 * what the user decided.
 *
 * `transaction` is undefined exactly when the row did not parse — the union is
 * not modelled as a discriminated one because the status carries more
 * information than "parsed or not" and the review screen filters on it.
 */
export interface StagedRow {
  readonly id: string
  readonly sessionId: string
  /** 0-based index into the sheet. Add one for the number the spreadsheet shows. */
  readonly rowIndex: number
  /** The row as the file displayed it, so an error stays readable after the fact. */
  readonly rawCells: readonly string[]
  readonly status: StagedRowStatus
  readonly decision: UserDecision
  readonly errorMessage: string | undefined
  /** The rules engine's guess (F03), written at staging. Becomes a `RULE` assignment on commit. */
  readonly suggestedCategoryId: string | undefined
  /**
   * Which rule made that guess, carried rather than recomputed: the rule set can
   * change between review and commit, and what lands has to be what the user
   * saw (D-038).
   */
  readonly suggestedRuleId: string | undefined
  /** What the user picked in the review screen. Becomes a `MANUAL` assignment on commit. */
  readonly chosenCategoryId: string | undefined
  readonly transaction: DraftTransaction | undefined
  readonly naturalKey: string | undefined
  /**
   * Derived when the row was staged, and carried rather than recomputed at
   * commit, so the figure the user reviewed is the figure that lands.
   */
  readonly billingPeriod: YearMonth | undefined
}
