/**
 * What a merchant probably is, learned from what the user already filed — the
 * **nearest-neighbour suggestion** M6.5 raised and M11 took (docs/08 C10).
 *
 * It needs no model, no network and no key, and it is a better first occupant of
 * M11's review surface than anything remote: every suggestion is the user's own
 * past decision, quoted back with the name it came from. `il-core.json` files
 * what it recognises deterministically at import (D-122); this only ever sees
 * the rows the pack failed to file, which is what makes it the pack's junior
 * partner rather than a competitor.
 *
 * **The rule this file keeps: a suggestion names the row it learned from.**
 * Categorization is always explainable ([conventions](../../docs/conventions.md)),
 * and an unexplained proposal is exactly the "silent inference the user didn't
 * ask for" docs/08 lists as a risk. So a suggestion carries its neighbour, and
 * the surface prints it: *because you filed שופרסל דיל here*.
 *
 * **Nothing here writes, and nothing here is a rule.** A suggestion accepted
 * assigns a category to the rows of one merchant, exactly as picking it by hand
 * does — and the rule offer that already follows a manual assignment follows
 * this one too, unchanged. Turning a similarity into a stored rule without
 * being asked is the thing D-009 forbids.
 *
 * Pure TypeScript: no React, no sql.js, no DOM.
 */

/** One merchant the user has already filed, and where they filed it. */
export interface LabelledMerchant {
  readonly merchantNormalized: string
  readonly categoryId: string
  /** How many rows of this merchant carry that category. Strength, not proof. */
  readonly count: number
}

export interface MerchantSuggestion {
  readonly merchantNormalized: string
  readonly categoryId: string
  /** The merchant this was learned from, which the surface says out loud. */
  readonly neighbour: string
  /** 0 to 1. How alike the two names are, by the measure below. */
  readonly score: number
  /**
   * Whether this one is ticked when the batch is offered.
   *
   * The line between "accept these together" and "look at this one" — D-092's
   * rule that a batch is **one accept with the doubtful rows surfaced**, applied
   * to a proposal whose confidence is a number rather than a proof.
   */
  readonly confident: boolean
}

/**
 * Below this, two names are not the same shop.
 *
 * Measured against the shape of Israeli statement lines, which is why it is not
 * higher: `שופרסל דיל רמת גן` and `שופרסל אקספרס הרצליה` share **one token of
 * three**, and that one token is the whole of the information. A threshold
 * strict enough to demand two would reject most of the real pairs this exists
 * for.
 */
const SUGGEST_AT = 0.34

/** And above this, it is offered ticked in the batch rather than merely offered. */
const CONFIDENT_AT = 0.6

/** A token shorter than this carries no information about which shop this is. */
const MIN_TOKEN = 2

/**
 * What a token counts for when it is the name of a **payment processor** rather
 * than of a shop.
 *
 * Not a market list, which is the point: statements write `PAYPAL *STEAM` with a
 * star precisely because the thing before it is not the merchant. That is a
 * formatting convention this app can read, so the token before a star is
 * discounted rather than named — and two charges that agree only on their
 * processor stop looking like two charges at one shop.
 */
const PROCESSOR_WEIGHT = 0.25

/**
 * Tokens that appear in half the merchant names in the country.
 *
 * Not a market list to be grown — it is a handful of words whose presence in
 * *both* names says nothing, and they are here rather than in the rulepack
 * because they are about the *similarity measure*, not about categories. A
 * shared `בע"מ` is not evidence that two shops are one shop.
 */
const NOISE = new Set(['בעמ', 'בע"מ', 'LTD', 'INC', 'THE', 'ישראל'])

/**
 * The suggestions for a backlog, best first.
 *
 * One per merchant at most: the strongest neighbour wins, and a tie goes to the
 * neighbour the user has filed more rows against — a name they have decided
 * about forty times is a better teacher than one they decided about once.
 *
 * A merchant that already has settled rows of its own is **not** suggested for:
 * the screen has a stronger hint for it (the user's own decisions on that exact
 * name), and offering a weaker guess beside a stronger one is noise.
 */
export function suggestFromHistory(
  backlog: readonly { readonly merchantNormalized: string; readonly hasSettled: boolean }[],
  history: readonly LabelledMerchant[],
): readonly MerchantSuggestion[] {
  if (history.length === 0) return []

  const prepared = history.map((entry) => ({
    entry,
    tokens: nameTokens(entry.merchantNormalized),
  }))

  const suggestions: MerchantSuggestion[] = []

  for (const group of backlog) {
    if (group.hasSettled) continue

    const tokens = nameTokens(group.merchantNormalized)
    if (tokens.size === 0) continue

    let best: { entry: LabelledMerchant; score: number } | undefined

    for (const candidate of prepared) {
      // A name is not its own neighbour, and an exact repeat is not a
      // *suggestion* — it is the settled hint, which the caller already has.
      if (candidate.entry.merchantNormalized === group.merchantNormalized) continue

      const score = similarity(tokens, candidate.tokens)
      if (score < SUGGEST_AT) continue
      if (best === undefined || score > best.score) {
        best = { entry: candidate.entry, score }
        continue
      }
      if (score === best.score && candidate.entry.count > best.entry.count) {
        best = { entry: candidate.entry, score }
      }
    }

    if (best === undefined) continue
    suggestions.push({
      merchantNormalized: group.merchantNormalized,
      categoryId: best.entry.categoryId,
      neighbour: best.entry.merchantNormalized,
      score: best.score,
      confident: best.score >= CONFIDENT_AT,
    })
  }

  return [...suggestions].sort((a, b) => b.score - a.score)
}

/**
 * How alike two names are: **weighted containment, plus a credit for the chain**.
 *
 * Two decisions, and the second was made after the first got the answer
 * backwards. Containment — the shared weight over the *smaller* name's weight —
 * rather than the intersection over the union, because a chain's branches carry
 * long location suffixes and a set measure punishes exactly those: `שופרסל דיל
 * רמת גן` against `שופרסל אקספרס הרצליה` is one token in six by union and one in
 * three by containment, and the second is the honest reading.
 *
 * The **chain credit** is for agreeing on the first meaningful word, which in
 * this market is where the chain's name is. It is what separates two branches of
 * one shop from two shops behind one payment processor: `PAYPAL *STEAM` and
 * `PAYPAL *SPOTIFY` agree only on a discounted token and their first *real*
 * words differ, so they come out below the line that offers a suggestion at all.
 */
export function similarity(
  one: ReadonlyMap<string, number>,
  other: ReadonlyMap<string, number>,
): number {
  if (one.size === 0 || other.size === 0) return 0

  let shared = 0
  for (const [token, weight] of one) {
    const twin = other.get(token)
    if (twin !== undefined) shared += Math.min(weight, twin)
  }

  const smaller = Math.min(totalWeight(one), totalWeight(other))
  if (smaller === 0) return 0

  const chain = firstStrong(one) !== undefined && firstStrong(one) === firstStrong(other) ? 0.3 : 0
  return Math.min(1, shared / smaller + chain)
}

function totalWeight(tokens: ReadonlyMap<string, number>): number {
  let total = 0
  for (const weight of tokens.values()) total += weight
  return total
}

/**
 * The words of a name and what each is worth.
 *
 * Every token holding a digit goes, which is the same rule `labelOf` applies to
 * a payslip line and for the same reason: a branch number, a store number and a
 * card's last four are all data about *this* row rather than about the shop.
 * Everything before a star is discounted — see `PROCESSOR_WEIGHT`.
 */
export function nameTokens(name: string): ReadonlyMap<string, number> {
  const tokens = new Map<string, number>()
  const starred = name.includes('*')
  let seenStar = false

  for (const raw of name.split(/([*])|[\s\-–—/,.|]+/)) {
    if (raw === undefined) continue
    if (raw === '*') {
      seenStar = true
      continue
    }
    const token = raw.trim()
    if (token.length < MIN_TOKEN) continue
    if (/[0-9]/.test(token)) continue
    if (NOISE.has(token)) continue

    const weight = starred && !seenStar ? PROCESSOR_WEIGHT : 1
    tokens.set(token, Math.max(tokens.get(token) ?? 0, weight))
  }
  return tokens
}

/** The first token that is not a discounted processor — where a chain's name is. */
function firstStrong(tokens: ReadonlyMap<string, number>): string | undefined {
  for (const [token, weight] of tokens) if (weight === 1) return token
  return undefined
}

/**
 * The one category a merchant's settled rows agree on, or nothing.
 *
 * Used to turn a tally of what the user filed into the single answer this file
 * learns from. **A merchant the user has filed two ways teaches nothing**: it is
 * a shop that genuinely sells two things, and picking the more frequent one
 * would propose that reading to every neighbour it has.
 */
export function settledCategory(
  tallies: readonly { readonly categoryId: string; readonly count: number }[],
): LabelledMerchant['categoryId'] | undefined {
  if (tallies.length !== 1) return undefined
  return tallies[0]?.categoryId
}
