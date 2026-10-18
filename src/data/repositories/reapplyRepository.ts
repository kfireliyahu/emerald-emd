/**
 * Re-apply: gathering the rows the rules may touch, committing what the plan
 * says, and putting it back (F03, "Re-apply"; migration `011`).
 *
 * The decision of *what* would change is `@/domain/reapply.ts`, which is pure.
 * This file is the three things that cannot be: reading the candidates,
 * writing the result in one transaction, and remembering enough to undo it.
 *
 * **Undo exists here and nowhere else in the app.** That is deliberate. A bulk
 * operation over four years of history is the one action a user cannot inspect
 * before agreeing to it and cannot repair by hand afterwards, so it is the one
 * that has to be reversible. Everything else in the app changes one row that is
 * on screen at the time.
 *
 * A run and what it changed are rows of the pack's `reapply_run` and
 * `reapply_change` since M25 U3 (D-275).
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { money } from '@/core/money.ts'
import type { ReapplyCandidate, ReapplyPlan } from '@/domain/reapply.ts'
import { inTransaction, query } from '../db/database.ts'
import { declared, instantOf, millisOf } from '../packs/ledger/tables.ts'
import { UNCATEGORIZED_ID } from './categoryRepository.ts'
import { insertRows, updateRow } from './formatRowRepository.ts'
import { recordHits, unrecordHits } from './categoryRuleRepository.ts'
import { buildTransactionWhere, type TransactionFilter } from './transactionRepository.ts'

export interface ReapplyRun {
  readonly id: string
  /** What the user chose, in the words the panel showed them. */
  readonly scope: string
  readonly changedCount: number
  readonly at: number
}

/**
 * The rows a re-apply is allowed to consider, as the engine needs to see them.
 *
 * Two things this query does that nothing above it should have to remember:
 *
 * - **It excludes `MANUAL` in SQL.** F03's acceptance criterion is that
 *   re-apply never modifies a manually categorized transaction, and the way to
 *   make that true is for such a row never to be in the list at all. A filter
 *   applied later is a filter someone can forget.
 * - **It selects the four facts a rule matches on**, not whole transactions. A
 *   ledger is tens of thousands of rows and a `RuleSubject` is four fields;
 *   there is no reason to build the installment and foreign-amount shapes of
 *   every row in the document to find out that a merchant does not match.
 *
 * The merchant as written comes too, because the preview has to name the rows
 * it is about, and the raw name is the one the user recognises.
 */
export function listReapplyCandidates(
  db: Database,
  filter: TransactionFilter = {},
): readonly (ReapplyCandidate & { readonly merchantRaw: string })[] {
  const where = buildTransactionWhere(filter)

  return query(
    db,
    `SELECT t.id, t.merchant_raw, t.merchant_normalized, t.provider_category,
            t.amount_minor, t.amount_currency AS currency, t.account AS account_id,
            t.category AS category_id
       FROM fmt_transaction t
      WHERE ${where.sql} AND t.category_source <> 'MANUAL'
      ORDER BY COALESCE(t.charge_date, t.transaction_date) DESC, t.rowid DESC`,
    where.params,
  ).map((row) => ({
    id: String(row['id']),
    merchantRaw: String(row['merchant_raw']),
    subject: {
      merchantNormalized: String(row['merchant_normalized']),
      providerCategory:
        row['provider_category'] == null ? undefined : String(row['provider_category']),
      amount: money(Number(row['amount_minor']), String(row['currency'])),
      accountId: String(row['account_id']),
    },
    // The system "Uncategorized" category and no category at all are the same
    // state to a rule, and treating them differently here would make a row
    // parked on it invisible to a re-apply that is meant to fix exactly that.
    categoryId:
      row['category_id'] == null || String(row['category_id']) === UNCATEGORIZED_ID
        ? undefined
        : String(row['category_id']),
  }))
}

/**
 * Write the plan, remembering what each row held first.
 *
 * One transaction around the lot, as F03 requires: a re-apply that failed
 * half-way would leave the ledger in a state no preview ever described.
 *
 * Hits are counted per changed row, which is the same definition an import uses
 * — a rule has fired when a transaction carries its category (D-038) — and they
 * are counted here rather than in the engine, which stays pure.
 */
export function commitReapply(
  db: Database,
  plan: ReapplyPlan,
  scope: string,
  now: number,
): ReapplyRun | undefined {
  if (plan.changes.length === 0) return undefined

  const id = newId()

  inTransaction(db, () => {
    insertRows(db, declared(db, 'reapply_run'), [{ scope, changed: plan.changes.length, at: instantOf(now) }], [id])
    const before: Record<string, string | null>[] = []

    for (const change of plan.changes) {
      // Read the row's own record of where its category came from rather than
      // trusting the plan: the plan knows what the category *was*, and the
      // undo has to restore the source and the rule beside it.
      const held = query(
        db,
        `SELECT category, category_source, matched_rule FROM fmt_transaction WHERE id = ?`,
        [change.rowId],
      )[0]
      if (held === undefined) continue

      before.push({
        run: id,
        transaction: change.rowId,
        previous_category: held['category'] == null ? null : String(held['category']),
        previous_source: String(held['category_source']),
        previous_rule: held['matched_rule'] == null ? null : String(held['matched_rule']),
      })

      db.run(
        `UPDATE fmt_transaction
            SET category = ?, category_source = 'RULE', matched_rule = ?
          WHERE id = ? AND category_source <> 'MANUAL'`,
        [change.to, change.ruleId, change.rowId],
      )
    }

    // What each row held, in one write of the pack's table.
    insertRows(db, declared(db, 'reapply_change'), before)
    recordHits(db, plan.changes.map((change) => change.ruleId), now)
  })

  return { id, scope, changedCount: plan.changes.length, at: now }
}

/**
 * The run that can still be taken back, if there is one.
 *
 * The newest one that has not been undone, and only that one. Undoing an older
 * run would restore rows to a state a later run has already moved on from, and
 * "a single undo entry" (F03) is the honest size of this feature.
 */
export function undoableRun(db: Database): ReapplyRun | undefined {
  const row = query(
    db,
    `SELECT id, scope, changed, at
       FROM fmt_reapply_run
      WHERE undone IS NULL
      ORDER BY at DESC, rowid DESC
      LIMIT 1`,
  )[0]
  if (row === undefined) return undefined

  return {
    id: String(row['id']),
    scope: String(row['scope']),
    changedCount: Number(row['changed'] ?? 0),
    at: millisOf(row['at']) ?? 0,
  }
}

/**
 * Put a run back, and say how many rows actually moved.
 *
 * **A row the user has touched since is left alone.** The restore is conditional
 * on the row still being a `RULE` assignment: if it says `MANUAL`, the user has
 * categorized it by hand since the re-apply ran, and D-009 outranks this undo
 * exactly as it outranks the re-apply itself. So the count returned can be
 * smaller than the run's, and that is the truth rather than a failure.
 *
 * The hits the run counted are given back for the same reason they were counted:
 * the "this rule never fires" view is only worth having if the number under it
 * is true.
 */
export function undoReapply(db: Database, runId: string, now: number): number {
  const changes = query(
    db,
    `SELECT c."transaction" AS transaction_id, c.previous_category AS previous_category_id,
            c.previous_source, c.previous_rule AS previous_rule_id,
            t.category_source AS current_source, t.matched_rule AS current_rule_id
       FROM fmt_reapply_change c
       JOIN fmt_transaction t ON t.id = c."transaction"
      WHERE c.run = ?`,
    [runId],
  )

  let restored = 0
  const giveBack: string[] = []

  inTransaction(db, () => {
    for (const change of changes) {
      if (String(change['current_source']) !== 'RULE') continue

      db.run(
        `UPDATE fmt_transaction
            SET category = ?, category_source = ?, matched_rule = ?
          WHERE id = ?`,
        [
          change['previous_category_id'] == null ? null : String(change['previous_category_id']),
          String(change['previous_source']),
          change['previous_rule_id'] == null ? null : String(change['previous_rule_id']),
          String(change['transaction_id']),
        ],
      )

      restored += 1
      if (change['current_rule_id'] != null) giveBack.push(String(change['current_rule_id']))
    }

    unrecordHits(db, giveBack)
    updateRow(db, declared(db, 'reapply_run'), runId, { undone: instantOf(now) })
  })

  return restored
}
