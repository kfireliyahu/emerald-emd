/**
 * Which merchant pays which card, as the **user** told the app. D-069.
 *
 * The escape hatch for the two ways settlement detection misses, both of which
 * leave real double-counting on screen with nothing the app can do about it on
 * its own:
 *
 * 1. **The bank's wording is in no keyword list.** `CLASS_KEYWORDS` covers what
 *    real statements have been seen to say, and a bank that writes its card
 *    charge as something generic produces an ordinary outflow.
 * 2. **The row names no card and matches no total.** A charge with no last-4 in
 *    it, for a period whose statement is not in the ledger, has nothing to
 *    attribute it by.
 *
 * The user can see the answer at a glance in both cases. This is where they put
 * it, and it is read by `readSettlementPlan` — so one answer fixes the ledger,
 * the pending queue and every future import at once, because they are all the
 * same re-derivation (D-060, D-062).
 *
 * **An `app_setting` key, not a table**, weighed as D-053 and D-065 weighed
 * theirs and coming out the same way: nothing holds a foreign key to an alias,
 * it carries no state beyond the pairing and when it was made, and it is keyed
 * on a **normalized merchant string** — which has no row for D-061's
 * column argument to attach to. It *points* at an account id, which does have a
 * row; a card that is later deleted simply stops matching, which
 * `planBankImport` handles by falling back to ordinary classification.
 *
 * Keyed on the normalized merchant rather than on a transaction, so one answer
 * covers every past and future occurrence — the key `listMerchantGroups` and the
 * rules engine already group on, which is what makes the rows the user answered
 * about and the rows the answer covers the same set by construction (D-047).
 */

import type { Database } from 'sql.js'

import { readJsonSetting, writeSetting } from './settingsRepository.ts'

const ALIAS_KEY = 'settlement.aliases'

export interface SettlementAlias {
  readonly merchantNormalized: string
  readonly cardAccountId: string
  /** When the user said so. Shown so an old answer is distinguishable from today's. */
  readonly at: number
}

function read(db: Database): Map<string, SettlementAlias> {
  const stored = readJsonSetting(db, ALIAS_KEY)
  const merchants = (stored as { merchants?: unknown } | undefined)?.merchants
  if (typeof merchants !== 'object' || merchants === null) return new Map()

  const found = new Map<string, SettlementAlias>()
  for (const [merchantNormalized, value] of Object.entries(merchants)) {
    // Defensive, as every decoder here is: a `.emd` file is a real
    // SQLite database the user can open in any tool, and a mangled entry reads
    // as no alias rather than throwing on the ledger's first render.
    if (typeof value !== 'object' || value === null) continue
    const { card, at } = value as { card?: unknown; at?: unknown }
    if (typeof card !== 'string' || card === '') continue
    found.set(merchantNormalized, {
      merchantNormalized,
      cardAccountId: card,
      at: typeof at === 'number' ? at : 0,
    })
  }
  return found
}

/** The shape `planBankImport` takes: merchant → card account id. */
export function settlementAliasMap(db: Database): ReadonlyMap<string, string> {
  return new Map([...read(db).values()].map((alias) => [alias.merchantNormalized, alias.cardAccountId]))
}

export function findSettlementAlias(
  db: Database,
  merchantNormalized: string,
): SettlementAlias | undefined {
  return read(db).get(merchantNormalized)
}

/**
 * Say that this merchant's rows pay this card.
 *
 * Re-stating it with a different card replaces the answer rather than adding a
 * second: a merchant pays one card, and two answers about one merchant would be
 * a coin toss at read time.
 */
export function setSettlementAlias(
  db: Database,
  merchantNormalized: string,
  cardAccountId: string,
  now: number,
): void {
  const merchants = Object.fromEntries(
    [...read(db).values()].map((alias) => [
      alias.merchantNormalized,
      { card: alias.cardAccountId, at: alias.at },
    ]),
  )
  merchants[merchantNormalized] = { card: cardAccountId, at: now }
  writeSetting(db, ALIAS_KEY, JSON.stringify({ merchants }), now)
}

/**
 * Take it back.
 *
 * The rows revert to whatever the app makes of them on its own, and any link
 * the alias produced is dropped by the next rescan — which runs after every
 * commit and is what the screens read (D-062). Nothing about the transactions
 * themselves is rewritten, because nothing about them was ever changed: a
 * settlement is derived, and only the user's answer about *counting* it is
 * stored (D-060).
 */
export function clearSettlementAlias(
  db: Database,
  merchantNormalized: string,
  now: number,
): void {
  const remaining = [...read(db).values()].filter(
    (alias) => alias.merchantNormalized !== merchantNormalized,
  )
  writeSetting(
    db,
    ALIAS_KEY,
    JSON.stringify({
      merchants: Object.fromEntries(
        remaining.map((alias) => [alias.merchantNormalized, { card: alias.cardAccountId, at: alias.at }]),
      ),
    }),
    now,
  )
}
