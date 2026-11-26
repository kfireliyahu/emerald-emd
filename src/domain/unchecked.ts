import type { CurrencyCode } from '@/core/money.ts'

/**
 * **Why a check of a holding could not run** — a code, never a sentence (M64 F38).
 *
 * A check is three answers and never a silent fourth (D-149), and the third,
 * `UNCHECKED`, says why. It used to say so in English, made here in the domain,
 * so a Hebrew screen showed an English reason beside its Hebrew verdict. The
 * domain hands back what is so, with the figures the sentence needs, and each
 * reader says it in its own words: the screen through the catalogue
 * (`wealth.unchecked`), a conversation through the plugin's `uncheckedText`.
 *
 * `OTHER` carries a reason the engine already gave in its own words — a declared
 * sum or identity that could not be judged — which neither reader rewrites.
 */
export type Unchecked =
  /** No reading of what the holding cost has been recorded yet. */
  | { readonly code: 'NO_COST_RECORDED' }
  /** The reading (or the statement's table) printed no cost. */
  | { readonly code: 'NO_COST_PRINTED' }
  /** Some of the holding's rows are in another currency, and a cost basis is one figure. */
  | { readonly code: 'OTHER_CURRENCY_ROWS'; readonly rows: number }
  /** What was printed is in one currency and the rows it is checked against in another. */
  | { readonly code: 'CURRENCY_MISMATCH'; readonly printed: CurrencyCode; readonly rows: CurrencyCode }
  /** The reading printed no quantity. */
  | { readonly code: 'NO_QUANTITY_PRINTED' }
  /** A row that names the holding has no quantity. */
  | { readonly code: 'ROW_WITHOUT_QUANTITY' }
  /** The reading printed no price. */
  | { readonly code: 'NO_PRICE_PRINTED' }
  /** The reading printed a price and no quantity. */
  | { readonly code: 'PRICE_WITHOUT_QUANTITY' }
  /** The document declares no price check on a reading. */
  | { readonly code: 'NO_PRICE_CHECK' }
  /** The account has no rows to run a balance over. */
  | { readonly code: 'NO_ACCOUNT_ROWS' }
  /** An account's own cash has no quantity, cost or price. */
  | { readonly code: 'CASH_HAS_NONE' }
  /** The engine's own reason, as it gave it. */
  | { readonly code: 'OTHER'; readonly reason: string }
