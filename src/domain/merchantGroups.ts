/**
 * The uncategorized backlog, one row per merchant — what the bulk categorize
 * screen works through.
 *
 * The grouping itself is a SQL question and lives in the repository, for the
 * reason D-032 gives about filtering: the answer has to be about every row, not
 * about the 500 the ledger happened to load. What is here is the part that is a
 * judgement rather than a query — what order to put the groups in, and what the
 * merchant's own history suggests the answer is.
 *
 * Plain functions over plain values: no React, no sql.js, no DOM
 * (docs/conventions.md). The repository builds these; nothing here reads a
 * database.
 */

/** One currency's worth of a group. Never added to another — there is no rate (D-003). */
export interface GroupTotal {
  readonly currency: string
  readonly outflowMinor: number
  readonly inflowMinor: number
}

/** How many of this merchant's *already categorized* rows sit in one category. */
export interface CategoryTally {
  readonly categoryId: string
  readonly count: number
}

/**
 * A heading the provider printed on this merchant's rows, and how many rows
 * carry it.
 *
 * The provider's own category is not the user's taxonomy and must never be
 * treated as one — but it is the strongest hint that exists for a merchant
 * nobody has ever filed, and D-080 already makes it something a rule can match
 * on. Several are possible: a card issuer can file the same shop under two
 * headings across a year, and collapsing that to one would invent a certainty
 * the file does not have.
 */
export interface ProviderCategoryTally {
  readonly value: string
  readonly count: number
}

/**
 * One merchant with uncategorized rows behind it.
 *
 * Keyed on `merchantNormalized`, which is the string rules match on — so a group
 * and the rule the screen offers to write about it are claims about exactly the
 * same set of rows. `merchantRaw` is only for showing the user a name they
 * recognise, and is the spelling most of the group's rows use: branch numbers
 * vary, and picking the most common is less startling than picking whichever
 * came back first.
 */
export interface MerchantGroup {
  readonly merchantNormalized: string
  readonly merchantRaw: string
  /** Uncategorized rows only. This is a backlog, not a report. */
  readonly count: number
  readonly totals: readonly GroupTotal[]
  /**
   * What the user has already put *other* rows of this merchant into.
   *
   * The strongest available hint about what this group should be, and it is the
   * user's own past decisions rather than a guess — which is why the screen
   * shows the count beside it rather than pre-selecting anything. Empty for a
   * merchant that has never been categorized.
   */
  readonly settled: readonly CategoryTally[]
  /**
   * What the **provider** called these rows, most common first.
   *
   * Empty where the file carried no such column — most bank statements — and
   * that emptiness is information: it says the hint is absent, not that the
   * merchant is uncategorizable.
   */
  readonly providerCategories: readonly ProviderCategoryTally[]
}

export type GroupOrder = 'COUNT' | 'AMOUNT' | 'NAME'

/**
 * The biggest outflow this group has **in any one currency**.
 *
 * Not the sum of its currencies: adding 200 agorot to 200 cents needs an
 * exchange rate this document does not have, and pretending minor units are
 * interchangeable is the error D-003 exists to prevent. A group's weight for
 * ordering is therefore the largest single-currency figure in it, which is a
 * real number about real money even when the group has two.
 */
export function groupWeight(group: MerchantGroup): number {
  return group.totals.reduce((most, total) => Math.max(most, total.outflowMinor), 0)
}

/**
 * The category most of this merchant's settled rows are in, or nothing.
 *
 * No threshold and no confidence score. The screen shows the count next to the
 * name — "14 of 20 already Groceries" — and lets the user read it, which is more
 * honest than a cutoff that would silently withhold the hint at 49% and offer it
 * at 51%. Ties break on the category id so the same document always gives the
 * same answer.
 */
export function dominantCategory(group: MerchantGroup): CategoryTally | undefined {
  let best: CategoryTally | undefined
  for (const tally of group.settled) {
    if (best === undefined || tally.count > best.count) best = tally
    else if (tally.count === best.count && tally.categoryId < best.categoryId) best = tally
  }
  return best
}

/** How many of this merchant's rows already have a category. */
export function settledCount(group: MerchantGroup): number {
  return group.settled.reduce((total, tally) => total + tally.count, 0)
}

/**
 * The groups in the order the screen lists them. Never mutates the input.
 *
 * `COUNT` is the default because the backlog is work and the biggest group is
 * the most work removed by one decision. `AMOUNT` is the other question people
 * actually ask of an uncategorized pile — "what is the expensive stuff I have
 * not looked at". `NAME` is for going back to something.
 *
 * Every order falls through to the normalized merchant, so the list is stable:
 * two merchants with the same count must not swap places between renders.
 */
export function orderGroups(
  groups: readonly MerchantGroup[],
  order: GroupOrder,
): readonly MerchantGroup[] {
  return [...groups].sort((a, b) => {
    const primary =
      order === 'COUNT'
        ? b.count - a.count
        : order === 'AMOUNT'
          ? groupWeight(b) - groupWeight(a)
          : a.merchantNormalized.localeCompare(b.merchantNormalized)

    if (primary !== 0) return primary
    return a.merchantNormalized < b.merchantNormalized
      ? -1
      : a.merchantNormalized > b.merchantNormalized
        ? 1
        : 0
  })
}
