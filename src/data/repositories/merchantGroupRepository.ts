/**
 * The uncategorized backlog, grouped by merchant — what bulk categorize lists.
 *
 * Two queries, both aggregating in SQL rather than over a loaded array, for the
 * reason D-032 gives about the ledger's total: the list of rows is capped at 500
 * and this is a claim about all of them. A document with four years of history
 * has one row per merchant here, not sixty thousand.
 *
 * The grouping key is `merchant_normalized`, which is the string a rule matches
 * on — so a group and the rule the screen offers to write about it are claims
 * about exactly the same set of rows, by construction rather than by care.
 */

import type { Database } from 'sql.js'

import type {
  CategoryTally,
  GroupTotal,
  MerchantGroup,
  ProviderCategoryTally,
} from '@/domain/merchantGroups.ts'
import { settledCategory, type LabelledMerchant } from '@/domain/suggest.ts'
import { query } from '../db/database.ts'
import { UNCATEGORIZED_ID } from './categoryRepository.ts'
import { buildTransactionWhere, type TransactionFilter } from './transactionRepository.ts'

/**
 * Every merchant with uncategorized rows in it, within a scope.
 *
 * The scope is a `TransactionFilter` — the ledger's own vocabulary, the one
 * re-apply also scopes with (D-045), so "which rows do you mean" has one
 * spelling in the app. `uncategorized` is forced on rather than left to the
 * caller: this screen is the backlog, and a bulk assignment that could reach a
 * category the user picked by hand is a different and much more dangerous tool
 * (D-009).
 */
export function listMerchantGroups(
  db: Database,
  scope: TransactionFilter = {},
): readonly MerchantGroup[] {
  const where = buildTransactionWhere({ ...scope, categoryId: undefined, uncategorized: true })

  // Grouped by the raw spelling as well as the normalized one, so the display
  // name can be the spelling most of the rows actually use. The alternative —
  // taking whichever row an aggregate happened to expose — depends on a SQLite
  // detail rather than on the data.
  const rows = query(
    db,
    `SELECT t.merchant_normalized AS merchant,
            t.merchant_raw AS raw,
            t.amount_currency AS currency,
            COUNT(*) AS n,
            SUM(CASE WHEN t.amount_minor < 0 THEN -t.amount_minor ELSE 0 END) AS outflow,
            SUM(CASE WHEN t.amount_minor > 0 THEN t.amount_minor ELSE 0 END) AS inflow
       FROM fmt_transaction t
      WHERE ${where.sql}
      GROUP BY t.merchant_normalized, t.merchant_raw, t.amount_currency`,
    where.params,
  )

  const settled = settledByMerchant(db, where)
  const providers = providerCategoriesByMerchant(db, where)
  const building = new Map<string, Building>()

  for (const row of rows) {
    const merchant = String(row['merchant'])
    const raw = String(row['raw'])
    const count = Number(row['n'] ?? 0)

    const group = building.get(merchant) ?? {
      merchant,
      count: 0,
      spellings: new Map<string, number>(),
      totals: new Map<string, GroupTotal>(),
    }

    group.count += count
    group.spellings.set(raw, (group.spellings.get(raw) ?? 0) + count)

    const currency = String(row['currency'])
    const total = group.totals.get(currency) ?? { currency, outflowMinor: 0, inflowMinor: 0 }
    group.totals.set(currency, {
      currency,
      outflowMinor: total.outflowMinor + Number(row['outflow'] ?? 0),
      inflowMinor: total.inflowMinor + Number(row['inflow'] ?? 0),
    })

    building.set(merchant, group)
  }

  return [...building.values()].map((group) => ({
    merchantNormalized: group.merchant,
    merchantRaw: commonest(group.spellings),
    count: group.count,
    totals: [...group.totals.values()],
    settled: settled.get(group.merchant) ?? [],
    providerCategories: providers.get(group.merchant) ?? [],
  }))
}

interface Building {
  readonly merchant: string
  count: number
  readonly spellings: Map<string, number>
  readonly totals: Map<string, GroupTotal>
}

/**
 * What the provider called the **uncategorized** rows of each merchant.
 *
 * Scoped by the caller's filter, unlike `settledByMerchant`, and deliberately:
 * that one answers "what have I decided about this shop", which is a question
 * about the merchant, while this one is a fact about the very rows in front of
 * the reader. A heading printed on rows outside the scope would be describing
 * something else.
 *
 * Blank strings are excluded rather than counted as a heading — a file with an
 * empty cell in that column says nothing, and "(37 rows: )" reads as a bug.
 */
function providerCategoriesByMerchant(
  db: Database,
  backlog: { readonly sql: string; readonly params: readonly (string | number | null)[] },
): ReadonlyMap<string, readonly ProviderCategoryTally[]> {
  const rows = query(
    db,
    `SELECT t.merchant_normalized AS merchant,
            t.provider_category AS provider,
            COUNT(*) AS n
       FROM fmt_transaction t
      WHERE ${backlog.sql}
        AND t.provider_category IS NOT NULL
        AND TRIM(t.provider_category) <> ''
      GROUP BY t.merchant_normalized, t.provider_category`,
    backlog.params,
  )

  const byMerchant = new Map<string, ProviderCategoryTally[]>()
  for (const row of rows) {
    const merchant = String(row['merchant'])
    const tallies = byMerchant.get(merchant) ?? []
    tallies.push({ value: String(row['provider']), count: Number(row['n'] ?? 0) })
    byMerchant.set(merchant, tallies)
  }

  // Most common first, ties alphabetical, so the listing is stable across runs.
  for (const tallies of byMerchant.values()) {
    tallies.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  }
  return byMerchant
}

/**
 * What the *categorized* rows of these same merchants are already in.
 *
 * Deliberately not scoped by the caller's filter. "What have I put Shufersal in
 * before" is a question about the merchant, and answering it only from July
 * would withhold the answer for the sake of a consistency nobody asked for. The
 * subquery restricts it to merchants that are actually in the backlog, so the
 * result stays the size of the screen rather than the size of the ledger.
 */
function settledByMerchant(
  db: Database,
  backlog: { readonly sql: string; readonly params: readonly (string | number | null)[] },
): ReadonlyMap<string, readonly CategoryTally[]> {
  const rows = query(
    db,
    `SELECT x.merchant_normalized AS merchant, x.category AS category, COUNT(*) AS n
       FROM fmt_transaction x
      WHERE x.category IS NOT NULL
        AND x.category <> ?
        AND x.merchant_normalized IN (
              SELECT t.merchant_normalized FROM fmt_transaction t WHERE ${backlog.sql}
            )
      GROUP BY x.merchant_normalized, x.category`,
    [UNCATEGORIZED_ID, ...backlog.params],
  )

  const byMerchant = new Map<string, CategoryTally[]>()
  for (const row of rows) {
    const merchant = String(row['merchant'])
    const tallies = byMerchant.get(merchant) ?? []
    tallies.push({ categoryId: String(row['category']), count: Number(row['n'] ?? 0) })
    byMerchant.set(merchant, tallies)
  }
  return byMerchant
}

/** The spelling most of the group's rows use; ties go to the alphabetically first. */
function commonest(spellings: ReadonlyMap<string, number>): string {
  let best = ''
  let bestCount = -1
  for (const [spelling, count] of spellings) {
    if (count > bestCount || (count === bestCount && spelling < best)) {
      best = spelling
      bestCount = count
    }
  }
  return best
}

/**
 * The uncategorized rows of one merchant, as ids — what a group assignment
 * writes to.
 *
 * Resolved at the moment the button is pressed rather than carried along with
 * the group, so what is assigned is what is on screen: an import committed in
 * another tab cannot add rows to a decision the user already made.
 */
export function merchantGroupIds(
  db: Database,
  merchantNormalized: string,
  scope: TransactionFilter = {},
): readonly string[] {
  const where = buildTransactionWhere({ ...scope, categoryId: undefined, uncategorized: true })
  return query(
    db,
    `SELECT t.id FROM fmt_transaction t
      WHERE ${where.sql} AND t.merchant_normalized = ?`,
    [...where.params, merchantNormalized],
  ).map((row) => String(row['id']))
}

/**
 * Every merchant the user has already filed, and where — what
 * `suggestFromHistory` learns from (D-151).
 *
 * **Only merchants filed one way count.** A shop the user has put in two
 * categories is a shop that genuinely sells two things, and teaching a
 * neighbour the more frequent reading would propagate a coin flip. That is
 * `settledCategory`'s rule and it is applied here so the caller cannot forget
 * it.
 *
 * The uncategorized placeholder is excluded for `settledByMerchant`'s reason:
 * it is the absence of a decision wearing a category's clothes.
 */
export function labelledMerchants(db: Database): readonly LabelledMerchant[] {
  const rows = query(
    db,
    `SELECT t.merchant_normalized AS merchant, t.category AS category, COUNT(*) AS n
       FROM fmt_transaction t
      WHERE t.category IS NOT NULL
        AND t.category <> ?
      GROUP BY t.merchant_normalized, t.category`,
    [UNCATEGORIZED_ID],
  )

  const byMerchant = new Map<string, { categoryId: string; count: number }[]>()
  for (const row of rows) {
    const merchant = String(row['merchant'])
    const tallies = byMerchant.get(merchant) ?? []
    tallies.push({ categoryId: String(row['category']), count: Number(row['n'] ?? 0) })
    byMerchant.set(merchant, tallies)
  }

  const labelled: LabelledMerchant[] = []
  for (const [merchant, tallies] of byMerchant) {
    const categoryId = settledCategory(tallies)
    if (categoryId === undefined) continue
    labelled.push({
      merchantNormalized: merchant,
      categoryId,
      count: tallies[0]?.count ?? 0,
    })
  }
  return labelled
}

/**
 * The merchants that took money out of a bank account — the only ones that can
 * be paying a card (M28 F3). One query for the whole screen, so each row can
 * offer *This pays a card* without a lookup of its own.
 */
export function bankMerchants(db: Database): ReadonlySet<string> {
  return new Set(
    query(
      db,
      `SELECT DISTINCT t.merchant_normalized AS merchant
         FROM fmt_transaction t
         JOIN fmt_account a ON a.id = t.account
        WHERE a.kind = 'BANK' AND t.amount_minor < 0`,
    ).map((row) => String(row['merchant'])),
  )
}
