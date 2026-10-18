/**
 * **Transfers between two of your own accounts** (M30 U3, D-356) — the pairs,
 * the scan that suggests them, and the one function that answers them.
 *
 * The bank↔card settlement (`cardSettlementRepository.ts`) generalised to any
 * two accounts that are not cards: a row leaving one and a row arriving in the
 * other, the same amount within a few days (`matchTransfers`). A suggestion is
 * `PENDING`; the person answers it once:
 *
 * - **`PAIRED`** — one transfer, so neither end is income or spending. The end
 *   on an ordinary account is *moved* (`movedCondition`): money that left the
 *   person's spending for something they own, counted in *saved* once. The end
 *   on an account with holdings (D-354) is the same money arriving there,
 *   and is in no flow at all (`heldCondition`), as a buy inside it is (D-355)
 *   — or *saved* would count the transfer in and take it straight back out.
 * - **`NOT_PAIRED`** — two rows that only looked like one. Both stay what they
 *   were, and neither is suggested again: a row is in one pair at most, which
 *   the format's two uniques hold.
 *
 * **A rescan never overwrites an answer and never re-asks one** (D-009): rows
 * already in a pair, answered or not, are not read again.
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { money, type Money } from '@/core/money.ts'
import { parseISODate } from '@/core/time.ts'
import { matchTransfers, type TransferRow } from '@/domain/transferPairs.ts'
import { inTransaction, query } from '../db/database.ts'
import { countsCondition } from './movedRepository.ts'
import { declared } from '../packs/ledger/tables.ts'
import { insertRows, updateRow } from './formatRowRepository.ts'

export type TransferDecision = 'PAIRED' | 'NOT_PAIRED' | 'PENDING'

export const TRANSFER_DECISIONS: readonly TransferDecision[] = ['PAIRED', 'NOT_PAIRED', 'PENDING']

/** One end of a transfer, as a screen or a tool shows it. */
export interface TransferEnd {
  readonly transactionId: string
  readonly accountId: string
  readonly accountName: string
  readonly date: string
  readonly amount: Money
  readonly descriptionRaw: string
}

export interface TransferPair {
  readonly id: string
  readonly decision: TransferDecision
  readonly out: TransferEnd
  readonly in: TransferEnd
}

const ENDS = `SELECT p.id, p.user_decision,
                     o.id AS out_id, o.account AS out_account, oa.name AS out_account_name,
                     o.transaction_date AS out_date, o.amount_minor AS out_minor,
                     o.amount_currency AS out_currency, o.merchant_raw AS out_raw,
                     i.id AS in_id, i.account AS in_account, ia.name AS in_account_name,
                     i.transaction_date AS in_date, i.amount_minor AS in_minor,
                     i.amount_currency AS in_currency, i.merchant_raw AS in_raw
                FROM fmt_transfer_pair p
                JOIN fmt_transaction o ON o.id = p.out_transaction
                JOIN fmt_account oa ON oa.id = o.account
                JOIN fmt_transaction i ON i.id = p.in_transaction
                JOIN fmt_account ia ON ia.id = i.account`

/** The pairs, newest first; by answer, or the one a transaction is an end of. */
export function listTransferPairs(
  db: Database,
  options: { readonly decision?: TransferDecision; readonly transactionId?: string } = {},
): readonly TransferPair[] {
  return query(
    db,
    `${ENDS}
      WHERE (? IS NULL OR p.user_decision = ?)
        AND (? IS NULL OR p.out_transaction = ? OR p.in_transaction = ?)
      ORDER BY o.transaction_date DESC, p.id`,
    [
      options.decision ?? null,
      options.decision ?? null,
      options.transactionId ?? null,
      options.transactionId ?? null,
      options.transactionId ?? null,
    ],
  ).map(decode)
}

/** The pair a transaction is an end of, answered or not. */
export function transferPairFor(db: Database, transactionId: string): TransferPair | undefined {
  return listTransferPairs(db, { transactionId })[0]
}

export function findTransferPair(db: Database, pairId: string): TransferPair | undefined {
  return query(db, `${ENDS} WHERE p.id = ?`, [pairId]).map(decode)[0]
}

/**
 * The rows a transfer could be made of: on an account that is not a card (a
 * card's bill is a settlement, D-060), counted in the statistics, naming no
 * holding (a buy is not a transfer, D-355), not a bank line already paying a
 * card, and in no pair yet.
 */
function eligibleRows(db: Database): readonly TransferRow[] {
  return query(
    db,
    `SELECT t.id, t.account, t.transaction_date, t.amount_minor, t.amount_currency AS currency
       FROM fmt_transaction t JOIN fmt_account a ON a.id = t.account
      WHERE a.kind <> 'CREDIT_CARD'
        AND ${countsCondition('t')}
        AND t.holding IS NULL
        AND t.amount_minor <> 0
        AND t.id NOT IN (SELECT bank_transaction FROM fmt_card_settlement_link)
        AND t.id NOT IN (SELECT out_transaction FROM fmt_transfer_pair)
        AND t.id NOT IN (SELECT in_transaction FROM fmt_transfer_pair)
      ORDER BY t.transaction_date, t.id`,
  ).flatMap((row) => {
    const date = parseISODate(String(row['transaction_date']))
    if (date === undefined) return []
    return [
      {
        id: String(row['id']),
        accountId: String(row['account']),
        date,
        amountMinor: Number(row['amount_minor']),
        currency: String(row['currency']),
      },
    ]
  })
}

/**
 * Suggest every transfer the ledger now holds and no pair names yet — after
 * every commit, as the settlement scan runs, so the order two statements are
 * imported in does not matter. Writes `PENDING` suggestions and nothing else;
 * returns how many it made.
 */
export function suggestTransfers(db: Database): number {
  const matches = matchTransfers(eligibleRows(db))
  if (matches.length === 0) return 0
  inTransaction(db, () => {
    insertRows(
      db,
      declared(db, 'transfer_pair'),
      matches.map((match) => ({
        out_transaction: match.outId,
        in_transaction: match.inId,
        user_decision: 'PENDING',
      })),
      matches.map(() => newId()),
    )
  })
  return matches.length
}

/**
 * Answer pairs — the only way a decision is written. A batch is one
 * transaction, so a list of answers lands whole. An unknown id is skipped and
 * left out of the count; the screen and the tool name pairs they just read.
 */
export function setTransferDecisions(
  db: Database,
  answers: readonly { readonly pairId: string; readonly decision: TransferDecision }[],
): number {
  if (answers.length === 0) return 0
  const pairs = declared(db, 'transfer_pair')
  let written = 0
  inTransaction(db, () => {
    for (const answer of answers) {
      if (updateRow(db, pairs, answer.pairId, { user_decision: answer.decision })) written += 1
    }
  })
  return written
}

function decode(row: Record<string, unknown>): TransferPair {
  const end = (side: 'out' | 'in'): TransferEnd => ({
    transactionId: String(row[`${side}_id`]),
    accountId: String(row[`${side}_account`]),
    accountName: String(row[`${side}_account_name`]),
    date: String(row[`${side}_date`]),
    amount: money(Number(row[`${side}_minor`]), String(row[`${side}_currency`])),
    descriptionRaw: String(row[`${side}_raw`]),
  })
  return {
    id: String(row['id']),
    decision: String(row['user_decision']) as TransferDecision,
    out: end('out'),
    in: end('in'),
  }
}
