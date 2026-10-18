/**
 * Committing an import: pipeline step 14 of
 * docs/f01-card-statement-import.md.
 *
 * The commit reads the staging area rather than a parse held in memory. Every
 * row the user accepted becomes a transaction, in one SQL transaction, so a
 * failure half-way cannot leave half a statement imported.
 *
 * Classification moved to `stage.ts` with the rest of step 10 — by the time
 * anything gets here, every row already knows what it is and what the user
 * said about it.
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { formatMoney } from '@/core/money.ts'
import type { BalanceDivergence } from '@/domain/bankImport.ts'
import { isCommittable } from '@/domain/model/importing.ts'
import { inTransaction } from '../db/database.ts'
import { recordHits } from '../repositories/categoryRuleRepository.ts'
import {
  installmentCandidates,
  syncDiscoveredPayments,
} from '../repositories/debtRepository.ts'
import { setCategoryFromRule, setCategoryManually } from '../repositories/categoryRepository.ts'
import { recordMappingUse } from '../repositories/importMappingRepository.ts'
import { findSession, setSessionStatus } from '../repositories/importSessionRepository.ts'
import { listStagedRows } from '../repositories/stagedRowRepository.ts'
import { insertTransactions } from '../repositories/transactionRepository.ts'
import { suggestTransfers } from '../repositories/transferPairRepository.ts'
import { rescanSettlements } from './settlementScan.ts'

export interface CommitResult {
  readonly sessionId: string
  readonly imported: number
  /** Accepted rows that could not be committed — a duplicate the user accepted anyway. */
  readonly rejected: number
  readonly duplicates: number
  readonly failed: number
  /** Of the imported rows, how many a rule categorized. The rest are uncategorized. */
  readonly categorizedByRule: number
  /**
   * Bank rows now linked to a card statement — including ones committed months
   * ago, if this import is the card statement that finally explains them.
   */
  readonly settlementsLinked: number
  /** Card charges in the bank statement whose card this document does not have. */
  readonly settlementsUnmatched: number
  /**
   * Transfers between two of the person's own accounts this import made
   * suggestable — a row leaving one and the same amount arriving in another
   * within a few days (M30 U3, D-356). Answered on the accounts screen.
   */
  readonly transfersSuggested: number
  /**
   * Repayments this import discovered, awaiting confirmation. docs/f08 runs the
   * merchant, category and installment mechanisms at commit; this is what they
   * found.
   */
  readonly debtPaymentsFound: number
  /** Rows more than one debt claims, which are questions rather than payments. */
  readonly debtPaymentsAmbiguous: number
  /**
   * Split purchases this document could track as debts — the whole set, not
   * only the ones this file introduced. The offer lives on the debts screen
   * (D-086), so this is a count to point at it with, the way
   * `settlementsLinked` points at the accounts screen (D-064).
   */
  readonly splitPurchasesToOffer: number
}

/**
 * The running balance disagreed with the parse, so nothing was imported.
 *
 * docs/f06: a mismatch means a wrong mapping or a parsing bug, and it must block
 * the commit with the first diverging row named. Carrying the divergence on the
 * error rather than only a message is what lets the screen point at the row.
 */
export class BalanceCheckFailedError extends Error {
  constructor(readonly divergence: BalanceDivergence) {
    super(
      `The running balance stops adding up at ${divergence.ref}. The file says ${formatMoney(divergence.stated)} and the parsed amounts reach ${formatMoney(divergence.expected)}.`,
    )
    this.name = 'BalanceCheckFailedError'
  }
}

export interface CommitOptions {
  /**
   * Import anyway despite a failed balance check.
   *
   * Offered rather than absolute, and only behind a second click that says what
   * it means. The check has never been run against a real Israeli bank export
   * (docs/f06), so the first thing it refuses may well be a file shape nobody
   * anticipated rather than a bad parse — and an unoverridable block on a guess
   * this new would be the app being confidently wrong at the user's expense.
   * The default is still refusal, which is what docs/f06 asks for.
   */
  readonly ignoreBalanceCheck?: boolean | undefined
}

/**
 * Turn the accepted rows of a staged session into transactions.
 *
 * Only rows the user accepted *and* that the app classified as committable are
 * written. An accepted duplicate is counted and skipped rather than attempted:
 * the ledger's unique index would refuse it, and taking the whole commit down
 * over a row the user could not have known was a duplicate would be the wrong
 * failure.
 *
 * Refuses outright when the file's own running balance disagreed with the parse.
 * That check is the only self-verification an importer in this app can do, and
 * importing over it would put numbers in the ledger that the file itself says
 * are wrong.
 */
export function commitSession(
  db: Database,
  sessionId: string,
  now: number,
  options: CommitOptions = {},
): CommitResult {
  const session = findSession(db, sessionId)
  if (session === undefined) throw new Error(`No import session ${sessionId}`)

  const check = session.balanceCheck
  if (check?.kind === 'DIVERGED' && options.ignoreBalanceCheck !== true) {
    throw new BalanceCheckFailedError(check.at)
  }

  const accepted = listStagedRows(db, sessionId, { decision: 'ACCEPT' })
  const committable = accepted.filter(
    (row) => isCommittable(row.status) && row.transaction !== undefined,
  )

  const counts = { imported: 0, rejected: accepted.length - committable.length }
  /** One entry per transaction a rule categorized, so a rule that fired twice counts twice. */
  const firedRuleIds: string[] = []

  inTransaction(db, () => {
    const written = committable.flatMap((row) => {
      const transaction = row.transaction
      if (transaction === undefined) return []
      return [{ row, transaction, id: newId() }]
    })
    insertTransactions(
      db,
      written.map(({ row, transaction, id }) => ({
        id,
        accountId: session.accountId,
        transactionDate: transaction.transactionDate,
        chargeDate: transaction.chargeDate,
        billingPeriod: row.billingPeriod,
        amount: transaction.amount,
        direction: transaction.direction,
        merchantRaw: transaction.merchantRaw,
        merchantNormalized: transaction.merchantNormalized,
        providerCategory: transaction.providerCategory,
        cardLast4: transaction.cardLast4,
        reference: transaction.reference,
        note: transaction.note,
        installment:
          transaction.installment === undefined
            ? undefined
            : { ...transaction.installment, originalTotal: transaction.installment.originalTotal },
        foreign:
          transaction.foreign === undefined
            ? undefined
            : {
                amount: transaction.foreign.originalAmount,
                exchangeRate: transaction.foreign.exchangeRate,
              },
        naturalKey: row.naturalKey ?? '',
        importSessionId: sessionId,
        sourceRowRef: transaction.sourceRowRef,
        holdingId: transaction.holdingId,
        quantityMicro: transaction.quantityMicro,
      })),
      now,
    )

    for (const { row, id } of written) {
      // A category picked in the review is a manual assignment and is recorded
      // as one, so no rule, re-import or AI pass may ever overwrite it (D-009).
      // It also wins outright over whatever a rule suggested: the user looked at
      // this row and said otherwise.
      if (row.chosenCategoryId !== undefined) {
        setCategoryManually(db, id, row.chosenCategoryId, now)
      } else if (row.suggestedCategoryId !== undefined && row.suggestedRuleId !== undefined) {
        setCategoryFromRule(db, id, row.suggestedCategoryId, row.suggestedRuleId, now)
        firedRuleIds.push(row.suggestedRuleId)
      }

      counts.imported += 1
    }

    // Hits are counted here rather than at staging: a rule has fired when a
    // transaction carries its category, not when a row that may yet be skipped
    // was matched. Re-staging the same file would otherwise inflate the very
    // figure the "this rule never fires" view exists to make trustworthy.
    recordHits(db, firedRuleIds, now)

    setSessionStatus(db, sessionId, 'COMMITTED', now)

    // Usage is counted on the commit, not when the mapper opened: a mapping
    // that was looked at and abandoned was not used.
    if (session.mappingId !== undefined) recordMappingUse(db, session.mappingId, now, session.accountId)
  })

  // After the commit, not inside it. Two reasons, and the second is the one that
  // matters: `syncSettlementLinks` opens its own transaction and SQLite will not
  // nest one; and a settlement scan that failed must not take an import that
  // succeeded down with it — the rows are in the ledger and the scan can be run
  // again, which is the whole point of it being a re-derivation.
  //
  // It runs after **every** commit, card or bank. docs/f06 asks for a rescan
  // when a card statement lands after the bank statement it explains; running
  // it unconditionally is what makes "order of import must not matter" a
  // property of the pipeline rather than a case someone has to spot (D-060).
  const scan = rescanSettlements(db, now)

  // And the debts, for the same two reasons and in the same place. docs/f08 runs
  // the merchant, category and installment mechanisms "at import commit, and on
  // demand via rescan", and running it unconditionally is what makes that a
  // property of the pipeline rather than a case someone has to remember: a
  // statement imported before the debt was created is found by the next scan,
  // whichever import triggers it.
  const debts = syncDiscoveredPayments(db, now)

  // And the transfers between the person's own accounts (M30 U3, D-356), after
  // the settlements so a bank line that pays a card is never offered as one:
  // the broker's statement may land before or after the bank's, and either
  // order suggests the same pair.
  const transfers = suggestTransfers(db)

  return {
    sessionId,
    imported: counts.imported,
    rejected: counts.rejected,
    duplicates: session.rowCountDuplicate,
    failed: session.rowCountFailed,
    categorizedByRule: firedRuleIds.length,
    settlementsLinked: scan.created,
    settlementsUnmatched: scan.unmatched,
    transfersSuggested: transfers,
    debtPaymentsFound: debts.created,
    debtPaymentsAmbiguous: debts.ambiguous,
    splitPurchasesToOffer: installmentCandidates(db).length,
  }
}
