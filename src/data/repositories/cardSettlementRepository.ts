/**
 * Card settlement links — the bank row that pays a card statement, and the
 * answer the user gives about it once. Migration `015`, docs/04's
 * `CardSettlementLink`, docs/f06 and D-061.
 *
 * Two rules live here and nowhere else:
 *
 * - **Excluding writes both rows.** docs/04's invariant is that an `EXCLUDED`
 *   link's bank transaction is `counted_on_card` — **the settlement's own
 *   column, never the person's `is_excluded_from_stats`** (M36 U04), so taking
 *   a settlement back cannot undo a row somebody left out by hand. It spans two
 *   tables, so nothing in SQL can hold it; `setSettlementDecision` is the one
 *   function that writes a decision, and it writes the column in the same
 *   transaction. There is no setter that can leave the two disagreeing.
 * - **A sync never overwrites an answer.** `syncSettlementLinks` runs on every
 *   import and re-derives what it can — the card, the period, the confidence.
 *   `userDecision` is not derived and is never touched, which is D-009 ("user
 *   overrides win") applied to the one column in this table that is a user's.
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { abs, add, money, type Money } from '@/core/money.ts'
import { toYearMonthString, type YearMonth } from '@/core/time.ts'
import type { MatchConfidence, SettlementDecision, SettlementGroup } from '@/domain/model/banking.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { readJsonSetting, writeSetting } from './settingsRepository.ts'
import { setCountedOnCard } from './transactionRepository.ts'

export interface SettlementLink {
  readonly id: string
  readonly bankTransactionId: string
  readonly cardAccountId: string
  /** `YYYY-MM`, or nothing when no statement total agreed. */
  readonly billingPeriod: string | undefined
  readonly matchConfidence: MatchConfidence
  readonly userDecision: SettlementDecision
}

const SELECT = `SELECT id, bank_transaction AS bank_transaction_id, card_account AS card_account_id,
                       billing_period, match_confidence, user_decision
                  FROM fmt_card_settlement_link
                 WHERE 1 = 1`

export function listSettlementLinks(
  db: Database,
  options: { readonly cardAccountId?: string; readonly decision?: SettlementDecision } = {},
): readonly SettlementLink[] {
  return query(
    db,
    `${SELECT}
       AND (? IS NULL OR card_account = ?)
       AND (? IS NULL OR user_decision = ?)
     ORDER BY billing_period DESC, id`,
    [
      options.cardAccountId ?? null,
      options.cardAccountId ?? null,
      options.decision ?? null,
      options.decision ?? null,
    ],
  ).map(decode)
}

export function findSettlementForTransaction(
  db: Database,
  bankTransactionId: string,
): SettlementLink | undefined {
  return query(db, `${SELECT} AND bank_transaction = ?`, [bankTransactionId]).map(decode)[0]
}

/**
 * One card's charge for one period, with everything the prompt has to show.
 *
 * docs/f06's prompt is a list of *claims* — "Cal ···1234, ₪4,210.55, matches 63
 * transactions totalling ₪4,210.55" — and a claim the user cannot check is worth
 * less than no claim at all. So the corroboration comes back with it: what the
 * bank charged, what that card's statement for the period came to, and how many
 * rows made it up.
 */
export interface SettlementSummary {
  readonly cardAccountId: string
  readonly cardAccountName: string
  readonly last4: string | undefined
  readonly billingPeriod: string | undefined
  readonly matchConfidence: MatchConfidence
  readonly decision: SettlementDecision
  readonly rows: readonly SettlementRow[]
  /** What the bank took. A magnitude. */
  readonly chargedTotal: Money
  /** What the card statement for `billingPeriod` came to, and out of how many rows. */
  readonly statementTotal: Money | undefined
  readonly statementRowCount: number
}

export interface SettlementRow {
  readonly linkId: string
  readonly transactionId: string
  readonly date: string
  readonly amount: Money
  readonly descriptionRaw: string
}

/**
 * The settlements, grouped as they were decided — one card, one month.
 *
 * Grouped here rather than in the screen because the grouping is a domain fact,
 * not a layout one: the split charge reconciles as a group or not at all, and a
 * screen that regrouped by something else would show a number that disagreed
 * with the confidence beside it.
 */
export function listSettlementSummaries(
  db: Database,
  options: { readonly decision?: SettlementDecision; readonly cardAccountId?: string } = {},
): readonly SettlementSummary[] {
  const rows = query(
    db,
    `SELECT l.id AS link_id, l.card_account AS card_account_id, l.billing_period, l.match_confidence,
            l.user_decision, a.name AS card_name, a.last4,
            t.id AS tx_id, t.transaction_date, t.amount_minor, t.amount_currency AS currency, t.merchant_raw
       FROM fmt_card_settlement_link l
       JOIN fmt_account a ON a.id = l.card_account
       JOIN fmt_transaction t ON t.id = l.bank_transaction
      WHERE 1 = 1
        AND (? IS NULL OR l.user_decision = ?)
        AND (? IS NULL OR l.card_account = ?)
      ORDER BY a.name, l.billing_period DESC, t.transaction_date`,
    [
      options.decision ?? null,
      options.decision ?? null,
      options.cardAccountId ?? null,
      options.cardAccountId ?? null,
    ],
  )

  const groups = new Map<string, SettlementSummary>()
  for (const row of rows) {
    const cardAccountId = String(row['card_account_id'])
    const billingPeriod = row['billing_period'] == null ? undefined : String(row['billing_period'])
    const key = `${cardAccountId}|${billingPeriod ?? ''}`
    const amount = money(Number(row['amount_minor']), String(row['currency']))

    const entry: SettlementRow = {
      linkId: String(row['link_id']),
      transactionId: String(row['tx_id']),
      date: String(row['transaction_date']),
      amount,
      descriptionRaw: String(row['merchant_raw']),
    }

    const existing = groups.get(key)
    if (existing !== undefined) {
      groups.set(key, {
        ...existing,
        rows: [...existing.rows, entry],
        chargedTotal: add(existing.chargedTotal, abs(amount)),
      })
      continue
    }

    const statement = statementTotalFor(db, cardAccountId, billingPeriod)
    groups.set(key, {
      cardAccountId,
      cardAccountName: String(row['card_name']),
      last4: row['last4'] == null ? undefined : String(row['last4']),
      billingPeriod,
      matchConfidence: String(row['match_confidence']) as MatchConfidence,
      decision: String(row['user_decision']) as SettlementDecision,
      rows: [entry],
      chargedTotal: abs(amount),
      statementTotal: statement?.total,
      statementRowCount: statement?.rowCount ?? 0,
    })
  }

  return [...groups.values()]
}

/** What that card's statement for that period came to, and out of how many rows. */
function statementTotalFor(
  db: Database,
  cardAccountId: string,
  billingPeriod: string | undefined,
): { readonly total: Money; readonly rowCount: number } | undefined {
  if (billingPeriod === undefined) return undefined

  const row = query(
    db,
    `SELECT SUM(amount_minor) AS total, COUNT(*) AS n, amount_currency AS currency
       FROM fmt_transaction
      WHERE account = ? AND billing_period = ?
      GROUP BY amount_currency`,
    [cardAccountId, billingPeriod],
  )[0]
  if (row === undefined) return undefined

  return {
    total: abs(money(Number(row['total']), String(row['currency']))),
    rowCount: Number(row['n'] ?? 0),
  }
}

/**
 * One settlement group's rows, ready to be written.
 *
 * A group is per card per month and may hold several bank rows (docs/f06's
 * split charge), so this is flattened by the caller — each bank row gets its own
 * link, all carrying the group's period and confidence, because the group is how
 * they were *decided* and the row is what carries the money.
 */
export interface SettlementLinkInput {
  readonly bankTransactionId: string
  readonly cardAccountId: string
  readonly billingPeriod: YearMonth | undefined
  readonly matchConfidence: MatchConfidence
  /** The remembered per-card answer, applied to a link the app is creating. */
  readonly decision: SettlementDecision
}

/**
 * Turn a plan's settlement groups into link inputs, given a way to name each
 * row's committed transaction.
 *
 * Rows whose transaction is not in the ledger — skipped in review, or not yet
 * committed — are dropped rather than linked to nothing.
 */
export function linkInputsFor(
  groups: readonly SettlementGroup[],
  transactionIdForRow: (ref: string) => string | undefined,
): readonly SettlementLinkInput[] {
  const inputs: SettlementLinkInput[] = []
  for (const group of groups) {
    for (const row of group.rows) {
      const bankTransactionId = transactionIdForRow(row.ref)
      if (bankTransactionId === undefined) continue
      inputs.push({
        bankTransactionId,
        cardAccountId: group.cardAccountId,
        billingPeriod: group.billingPeriod,
        matchConfidence: group.confidence,
        decision: group.decision,
      })
    }
  }
  return inputs
}

export interface SyncResult {
  readonly created: number
  /** Links whose card, period or confidence changed because the ledger did. */
  readonly updated: number
  /** Links whose `userDecision` was left alone. Always all of the answered ones. */
  readonly answersKept: number
  /**
   * Links whose row has stopped being a settlement, soft-deleted. Zero unless
   * the caller said which rows it scanned — a link cannot be judged stale
   * against a reading that never looked at it.
   */
  readonly dropped: number
}

/**
 * Reconcile the stored links against a freshly derived reading of the ledger.
 *
 * This is what makes docs/f06's "order of import must not matter" true of the
 * stored half as well as the derived half. A settlement matched at `MEDIUM`
 * because no statement had been imported becomes `HIGH` with a billing period
 * the moment the card statement lands, and a row that was not a settlement at
 * all becomes one — without asking again about anything already answered.
 *
 * **`userDecision` is never written here.** A link the user excluded stays
 * excluded even if the re-derivation now reads it differently; the decision was
 * about the money, and the money has not moved. Only `setSettlementDecision`
 * changes an answer.
 */
export function syncSettlementLinks(
  db: Database,
  inputs: readonly SettlementLinkInput[],
  _now: number,
  scope?: { readonly scannedBankTransactionIds: readonly string[] },
): SyncResult {
  let created = 0
  let updated = 0
  let answersKept = 0
  let dropped = 0

  inTransaction(db, () => {
    const links = declared(db, 'card_settlement_link')
    for (const input of inputs) {
      const existing = findSettlementForTransaction(db, input.bankTransactionId)
      const period = input.billingPeriod === undefined ? null : toYearMonthString(input.billingPeriod)

      if (existing === undefined) {
        insertRows(
          db,
          links,
          [
            {
              bank_transaction: input.bankTransactionId,
              card_account: input.cardAccountId,
              billing_period: period,
              match_confidence: input.matchConfidence,
              user_decision: input.decision,
            },
          ],
          [newId()],
        )
        created += 1
        // A link created carrying the remembered answer still has to make the
        // ledger agree with it, or an auto-excluded settlement counts as
        // spending until someone opens the screen.
        if (input.decision === 'EXCLUDED') setCountedOnCard(db, input.bankTransactionId, true)
        continue
      }

      if (existing.userDecision !== 'PENDING') answersKept += 1

      const unchanged =
        existing.cardAccountId === input.cardAccountId &&
        (existing.billingPeriod ?? null) === period &&
        existing.matchConfidence === input.matchConfidence
      if (unchanged) continue

      updateRow(db, links, existing.id, {
        card_account: input.cardAccountId,
        billing_period: period,
        match_confidence: input.matchConfidence,
      })
      updated += 1
    }

    // A row that has stopped being a settlement loses its link. Scoped to the
    // rows this scan actually read, because a link outside the window was not
    // considered and must not be dropped for not appearing.
    //
    // This became reachable when the user gained a way to *take back* an answer
    // about which merchant pays a card (D-069). Before that a link could only
    // go stale if a card account was deleted; now it is an ordinary action, and
    // a stale link would keep a row out of every total with nothing on screen
    // to explain why.
    const kept = new Set(inputs.map((input) => input.bankTransactionId))
    for (const id of scope?.scannedBankTransactionIds ?? []) {
      if (kept.has(id)) continue
      const existing = findSettlementForTransaction(db, id)
      if (existing === undefined) continue

      // The settlement's answer goes with it, and the person's never does:
      // M36 U01 stopped clearing `is_excluded_from_stats` here because it
      // could not tell a settlement's from a hand answer, and since U04 the
      // settlement's is a column of its own (`counted_on_card`).
      setCountedOnCard(db, id, false)
      deleteRows(db, links, [existing.id], allDeclared(db))
      dropped += 1
    }
  })

  return { created, updated, answersKept, dropped }
}

/**
 * Answer the prompt for one settlement — the only way a decision is written.
 *
 * Excluding sets `counted_on_card` on the bank row and keeping clears it,
 * both in the same transaction as the link, which is docs/04's invariant held in
 * the one place it can be. The link survives either answer, so the settlement
 * stays visible in the bank's cash-flow view and still drills through to the
 * card statement — docs/f06 is explicit that excluding must not hide the row.
 *
 * `PENDING` is accepted and un-excludes: it is "put this back to unanswered",
 * which is what reversing a per-card setting has to be able to do.
 */
export function setSettlementDecision(
  db: Database,
  linkId: string,
  decision: SettlementDecision,
  now: number,
): void {
  inTransaction(db, () => applyDecision(db, linkId, decision, now))
}

/**
 * Answer for every *unanswered* settlement of one card — the prompt's "Exclude
 * these" and "Keep them" buttons, which act on a group rather than a row.
 *
 * One transaction around the whole batch, not one per link: `inTransaction`
 * issues a real `BEGIN`, which SQLite refuses to nest, and half an answered
 * group is not a state this app should be able to reach anyway.
 */
export function decideAllForCard(
  db: Database,
  cardAccountId: string,
  decision: SettlementDecision,
  now: number,
): number {
  return decide(db, listSettlementLinks(db, { cardAccountId, decision: 'PENDING' }), decision, now)
}

/**
 * Answer for **every** settlement of one card, answered or not — the account
 * screen's per-card control.
 *
 * The difference from `decideAllForCard` is the whole point of having two: the
 * prompt is answering questions it just asked, so it must not overwrite an
 * answer given elsewhere; the account screen's control *is* the answer for this
 * card, so changing it has to move what it claims to describe. Setting it to
 * `PENDING` puts the settlements back in the prompt and un-excludes them, which
 * is what makes docs/f06's "reversible from the account screen" true rather than
 * a sentence about one column.
 */
export function decideForCard(
  db: Database,
  cardAccountId: string,
  decision: SettlementDecision,
  now: number,
): number {
  return decide(db, listSettlementLinks(db, { cardAccountId }), decision, now)
}

function decide(
  db: Database,
  links: readonly SettlementLink[],
  decision: SettlementDecision,
  now: number,
): number {
  inTransaction(db, () => {
    for (const link of links) applyDecision(db, link.id, decision, now)
  })
  return links.length
}

/** The two writes docs/04's invariant binds together. Always inside a transaction. */
function applyDecision(
  db: Database,
  linkId: string,
  decision: SettlementDecision,
  _now: number,
): void {
  const link = query(db, `${SELECT} AND id = ?`, [linkId]).map(decode)[0]
  if (link === undefined) return

  updateRow(db, declared(db, 'card_settlement_link'), linkId, { user_decision: decision })
  setCountedOnCard(db, link.bankTransactionId, decision === 'EXCLUDED')
}

function decode(row: Record<string, unknown>): SettlementLink {
  return {
    id: String(row['id']),
    bankTransactionId: String(row['bank_transaction_id']),
    cardAccountId: String(row['card_account_id']),
    billingPeriod: row['billing_period'] == null ? undefined : String(row['billing_period']),
    matchConfidence: String(row['match_confidence']) as MatchConfidence,
    userDecision: String(row['user_decision']) as SettlementDecision,
  }
}

/** Where "count the charge as spending" lives: bank row ids, as a map to true (M31 U1). */
export const COUNTED_CHARGES_KEY = 'settlements.counted_charges'

/** The bank rows somebody said to count as spending although no card statement matches them. */
export function countedCardCharges(db: Database): ReadonlySet<string> {
  const stored = readJsonSetting(db, COUNTED_CHARGES_KEY) ?? {}
  return new Set(Object.entries(stored).filter(([, value]) => value === true).map(([id]) => id))
}

/**
 * Answers docs/f06's loud case without its statement: a card charge in the bank
 * for a card this document has no statement of, counted as the spending it
 * stands for. The row already counts — nothing excluded it — so this stores the
 * answer and moves no figure; the question stops being asked about these rows.
 * A statement read later still makes them a settlement to answer (M31 U1).
 * `counted: false` takes it back.
 */
export function countCardCharges(
  db: Database,
  bankTransactionIds: readonly string[],
  counted: boolean,
  now: number,
): void {
  const stored = { ...(readJsonSetting(db, COUNTED_CHARGES_KEY) ?? {}) }
  for (const id of bankTransactionIds) {
    if (counted) stored[id] = true
    else delete stored[id]
  }
  writeSetting(db, COUNTED_CHARGES_KEY, JSON.stringify(stored), now)
}
