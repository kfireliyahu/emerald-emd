/**
 * The audit of overrides — docs/04-data-model.md, "Cross-cutting".
 *
 * One row per time the user changed a transaction's category by hand: what it
 * was, where that came from, and what they made it. Migration `010`.
 *
 * It exists to be read, not merely kept. The offer after a correction (F03,
 * "Learning from corrections") asks this table how many times the same merchant
 * has been put in the same category, and that question has no other source —
 * the transaction only remembers its current category, so a habit is invisible
 * without a record of the corrections that formed it.
 *
 * The correction itself still goes through `setCategoryManually`, so the rule
 * that matters most is unchanged: a category the user chose is `MANUAL` and no
 * automation ever revisits it (D-009).
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { money } from '@/core/money.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import type { RuleSubject } from '@/domain/model/rules.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared, instantOf } from '../packs/ledger/tables.ts'
import { setCategoryManually, type CategorySource } from './categoryRepository.ts'
import { deleteRows, insertRows } from './formatRowRepository.ts'

/** One correction, kept: what the row had, and what a person made it. */
function recordOverride(
  db: Database,
  id: string,
  transactionId: string,
  previousCategoryId: string | undefined,
  previousSource: string,
  categoryId: string | undefined,
  now: number,
  overrides: FormatDeclaration = declared(db, 'category_override'),
): void {
  insertRows(
    db,
    overrides,
    [
      {
        transaction: transactionId,
        previous_category: previousCategoryId ?? null,
        previous_source: previousSource,
        new_category: categoryId ?? null,
        at: instantOf(now),
      },
    ],
    [id],
  )
}

/**
 * Why the override happened, in the words F03 would use about it.
 *
 * **Derived, not stored.** docs/04 asks for "the reason kind" and this is it —
 * read off `previous_source` and the two categories, which are the columns that
 * decide it. A column beside them would be a second spelling of one fact, which
 * is the defect D-037 spent three fields avoiding: the derivation can be
 * improved for every row ever written, while a stored label freezes whatever
 * the build that wrote it happened to think.
 */
export type OverrideReason =
  /** The row had no category. The most common one by far, and the weakest signal. */
  | 'FILLED_BLANK'
  /** A rule had answered, and the user disagreed. The signal a rule set learns most from. */
  | 'REPLACED_RULE'
  /** The user changed their own earlier choice. */
  | 'CHANGED_MANUAL'
  /** Something else had answered — an AI suggestion, or a category inherited from a sibling. */
  | 'REPLACED_SUGGESTION'
  /** The category was taken off rather than changed. */
  | 'CLEARED'

export interface CategoryOverride {
  readonly id: string
  readonly transactionId: string
  readonly previousCategoryId: string | undefined
  readonly previousSource: CategorySource
  readonly newCategoryId: string | undefined
  readonly reason: OverrideReason
  readonly at: number
}

/** What a correction was, and what the row it happened to looks like to the engine. */
export interface Correction extends CategoryOverride {
  /** For saying the merchant's name back to the user, bidi marks and all. */
  readonly merchantRaw: string
  /** The corrected row as a rule would see it, so the offer can be decided without a second query. */
  readonly subject: RuleSubject
  /**
   * How many different transactions of this merchant the user has now put in
   * this category by hand, this one included. Undefined when the category was
   * cleared — there is no habit to count.
   */
  readonly corrections: number | undefined
}

export function overrideReason(
  previousCategoryId: string | undefined,
  previousSource: CategorySource,
  newCategoryId: string | undefined,
): OverrideReason {
  if (newCategoryId === undefined) return 'CLEARED'
  if (previousCategoryId === undefined) return 'FILLED_BLANK'
  switch (previousSource) {
    case 'RULE':
      return 'REPLACED_RULE'
    case 'MANUAL':
      return 'CHANGED_MANUAL'
    default:
      return 'REPLACED_SUGGESTION'
  }
}

/**
 * Assign a category by hand from the ledger, and record what it replaced.
 *
 * Returns what happened, so the caller can decide whether there is a rule worth
 * offering — that decision is `offerForCorrection` in `@/domain/learning.ts`,
 * and it is pure. Returns undefined when there is nothing to record: an id that
 * is not in the document, or a category the row already had.
 *
 * Re-picking the category a row already has is not an override. It writes the
 * assignment — the source becomes `MANUAL`, which is a real change and the
 * whole point of confirming a rule's answer — but there is no previous value to
 * audit and no correction to learn from, and counting it would let one row
 * insist three times on its own.
 *
 * One transaction around both writes. Nothing else in the app calls this, so
 * there is no outer transaction for it to nest inside.
 */
export function correctCategory(
  db: Database,
  transactionId: string,
  categoryId: string | undefined,
  now: number,
): Correction | undefined {
  const row = query(
    db,
    `SELECT category AS category_id, category_source, merchant_raw, merchant_normalized,
            provider_category, amount_minor, amount_currency AS currency, account AS account_id
       FROM fmt_transaction
      WHERE id = ?`,
    [transactionId],
  )[0]
  if (row === undefined) return undefined

  const previousCategoryId = row['category_id'] == null ? undefined : String(row['category_id'])
  const previousSource = String(row['category_source']) as CategorySource
  const unchanged = previousCategoryId === categoryId

  const subject: RuleSubject = {
    merchantNormalized: String(row['merchant_normalized']),
    providerCategory: row['provider_category'] == null ? undefined : String(row['provider_category']),
    amount: money(Number(row['amount_minor']), String(row['currency'])),
    accountId: String(row['account_id']),
  }

  const id = newId()
  inTransaction(db, () => {
    if (!unchanged) {
      recordOverride(db, id, transactionId, previousCategoryId, previousSource, categoryId, now)
    }
    setCategoryManually(db, transactionId, categoryId, now)
  })

  if (unchanged) return undefined

  return {
    id,
    transactionId,
    previousCategoryId,
    previousSource,
    newCategoryId: categoryId,
    reason: overrideReason(previousCategoryId, previousSource, categoryId),
    at: now,
    merchantRaw: String(row['merchant_raw']),
    subject,
    corrections:
      categoryId === undefined
        ? undefined
        : countCorrections(db, subject.merchantNormalized, categoryId),
  }
}

/**
 * What a bulk assignment did, and whether there is one merchant to offer a rule
 * about.
 *
 * `subject` and `merchantRaw` are present **only when every row that changed
 * shares one normalized merchant**, which is exactly the distinction the two
 * callers need. A group on the bulk categorize screen always does, so it always
 * gets the offer. A selection on the ledger might be forty rows of one shop or
 * forty rows of forty shops, and "always categorize these as Groceries?" is not
 * a question that can be asked about the second.
 */
export interface BulkCorrection {
  /** Rows whose category actually moved. Re-picking what a row already had is not a change. */
  readonly changed: number
  readonly merchantNormalized: string | undefined
  readonly merchantRaw: string | undefined
  /**
   * One changed row as a rule would see it, when they share a merchant.
   *
   * The merchant is the group's and is what any offered rule would claim; the
   * amount and the account are one representative row's, because a group does
   * not have one of either. That only matters for deciding "does a rule already
   * say this", and a rule narrowed by an amount band or an account is precisely
   * the case where that is a question about a row rather than about a merchant.
   */
  readonly subject: RuleSubject | undefined
  /** As `Correction.corrections`, and undefined when the category was cleared. */
  readonly corrections: number | undefined
  /**
   * What each changed row was before, and the override that recorded it — what
   * `undoCorrections` needs to put the batch back (M28 U6, D-315).
   */
  readonly filed: readonly FiledRow[]
}

/** One row a bulk correction changed, as it was. */
export interface FiledRow {
  readonly transactionId: string
  readonly overrideId: string
  readonly previousCategoryId: string | undefined
  readonly previousSource: string
}

/**
 * Assign one category to many rows by hand, and record every one of them.
 *
 * One transaction around the whole batch: thirty-four rows either all move or
 * none do, which is the same promise an import commit makes. `correctCategory`
 * is not called in a loop because each call opens its own transaction, and
 * because the useful answer for a batch is one summary rather than thirty-four.
 *
 * Every row still goes through `setCategoryManually`, so the batch is `MANUAL`
 * and permanent exactly like a row categorized one at a time (D-009) — and every
 * row still gets its own `category_override`, because the audit is per row and a
 * batch is not one event that happened to thirty-four transactions, it is
 * thirty-four events the user caused at once.
 */
export function correctCategories(
  db: Database,
  transactionIds: readonly string[],
  categoryId: string | undefined,
  now: number,
): BulkCorrection {
  const empty: BulkCorrection = {
    changed: 0,
    merchantNormalized: undefined,
    merchantRaw: undefined,
    subject: undefined,
    corrections: undefined,
    filed: [],
  }
  if (transactionIds.length === 0) return empty

  const changed: { readonly id: string; readonly row: Record<string, unknown> }[] = []

  for (const id of transactionIds) {
    const row = query(
      db,
      `SELECT category AS category_id, category_source, merchant_raw, merchant_normalized,
              provider_category, amount_minor, amount_currency AS currency, account AS account_id
         FROM fmt_transaction
        WHERE id = ?`,
      [id],
    )[0]
    if (row === undefined) continue

    const previousCategoryId = row['category_id'] == null ? undefined : String(row['category_id'])
    if (previousCategoryId === categoryId) continue
    changed.push({ id, row })
  }

  if (changed.length === 0) return empty

  const filed: FiledRow[] = []
  inTransaction(db, () => {
    const overrides = declared(db, 'category_override')
    for (const { id, row } of changed) {
      const previousCategoryId = row['category_id'] == null ? undefined : String(row['category_id'])
      const overrideId = newId()
      recordOverride(db, overrideId, id, previousCategoryId, String(row['category_source']), categoryId, now, overrides)
      setCategoryManually(db, id, categoryId, now)
      filed.push({ transactionId: id, overrideId, previousCategoryId, previousSource: String(row['category_source']) })
    }
  })

  const first = changed[0]?.row
  const merchants = new Set(changed.map(({ row }) => String(row['merchant_normalized'])))
  const oneMerchant = merchants.size === 1 && first !== undefined

  const merchantNormalized = oneMerchant ? String(first['merchant_normalized']) : undefined

  return {
    changed: changed.length,
    merchantNormalized,
    merchantRaw: oneMerchant ? String(first['merchant_raw']) : undefined,
    subject:
      oneMerchant && merchantNormalized !== undefined
        ? {
            merchantNormalized,
            providerCategory:
              first['provider_category'] == null ? undefined : String(first['provider_category']),
            amount: money(Number(first['amount_minor']), String(first['currency'])),
            accountId: String(first['account_id']),
          }
        : undefined,
    corrections:
      categoryId === undefined || merchantNormalized === undefined
        ? undefined
        : countCorrections(db, merchantNormalized, categoryId),
    filed,
  }
}

/**
 * Take a bulk correction back: the rows as they were, and the audit of it gone.
 *
 * **For a filing made a moment ago** (the By merchant screen's Undo), which is
 * why it restores the category and the source and not a rule that had answered:
 * the rows it is for were uncategorized, and an uncategorized row has no rule to
 * lose. The overrides are deleted rather than counter-written, because
 * `countCorrections` counts them towards offering a rule and a filing that was
 * taken back is not a habit. A row somebody has moved on since is left alone —
 * undoing must never overwrite a newer decision (D-009).
 */
export function undoCorrections(
  db: Database,
  filed: readonly FiledRow[],
  filedAs: string | undefined,
): number {
  const restored: string[] = []
  inTransaction(db, () => {
    for (const row of filed) {
      const now = query(db, 'SELECT category FROM fmt_transaction WHERE id = ?', [row.transactionId])[0]
      if (now === undefined) continue
      // Moved on since: a newer decision wins.
      if ((now['category'] == null ? undefined : String(now['category'])) !== filedAs) continue
      db.run(
        `UPDATE fmt_transaction SET category = ?, category_source = ?, matched_rule = NULL WHERE id = ?`,
        [
          row.previousCategoryId ?? null,
          row.previousCategoryId === undefined ? 'NONE' : row.previousSource,
          row.transactionId,
        ],
      )
      restored.push(row.overrideId)
    }
    if (restored.length > 0) {
      deleteRows(db, declared(db, 'category_override'), restored, allDeclared(db))
    }
  })
  return restored.length
}

/**
 * How many different transactions of one merchant the user has corrected into
 * one category — F03's "the same merchant to the same category three times".
 *
 * Distinct transactions, not overrides: a row talked into a category and back
 * out of it twice is one person changing their mind about one charge, and
 * counting the changes would let a single row reach the third-repeat prompt on
 * its own.
 *
 * The merchant is joined rather than stored on the override (see migration
 * 010). It is compared in the normalized form, which is the form a rule would
 * match — so what is counted is what the offered rule would have covered.
 */
export function countCorrections(
  db: Database,
  merchantNormalized: string,
  categoryId: string,
): number {
  const rows = query(
    db,
    `SELECT COUNT(DISTINCT o."transaction") AS n
       FROM fmt_category_override o
       JOIN fmt_transaction t ON t.id = o."transaction"
      WHERE o.new_category = ? AND t.merchant_normalized = ?`,
    [categoryId, merchantNormalized],
  )
  return Number(rows[0]?.['n'] ?? 0)
}
