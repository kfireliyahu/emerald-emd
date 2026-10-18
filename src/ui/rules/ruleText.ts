/**
 * How a rule reads in English.
 *
 * One map, used by the kind select, by the rules list and by the test box's
 * explanation, so a rule is described the same way wherever it is described.
 * The strings are lowercase because they are sentence fragments — the list
 * reads "merchant contains שופרסל", not "Merchant Contains".
 */

import { formatMoney, type CurrencyCode } from '@/core/money.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import type { RuleConditions, RuleKind } from '@/domain/model/rules.ts'

/**
 * The currencies offered for an amount bound and for the test box.
 *
 * The same short list as the mapper's, and for the same reason: these are what
 * an Israeli statement is denominated in, and a select of 180 codes is a worse
 * way to pick one of five.
 */
export const CURRENCY_CHOICES: readonly CurrencyCode[] = ['ILS', 'USD', 'EUR', 'GBP', 'CHF', 'JPY']

export const KIND_PHRASE: Readonly<Record<RuleKind, string>> = {
  EXACT_MERCHANT: 'merchant is exactly',
  CONTAINS: 'merchant contains',
  REGEX: 'merchant matches',
  PROVIDER_CATEGORY: 'provider category is',
  AMOUNT_RANGE: 'any amount in range',
  ACCOUNT: 'everything on one account',
}

/** What to type, in the words of the kind that will read it. */
export const PATTERN_PLACEHOLDER: Readonly<Record<RuleKind, string>> = {
  EXACT_MERCHANT: 'שופרסל דיל',
  CONTAINS: 'פז',
  REGEX: '^paypal',
  PROVIDER_CATEGORY: 'סופרמרקט',
  AMOUNT_RANGE: '',
  ACCOUNT: '',
}

/**
 * The amount band in words, or nothing when the rule states none.
 *
 * "from" and "up to" rather than "over" and "under": the engine compares with
 * `<` and `>` on the magnitudes, so a charge of exactly ₪100 is inside a band
 * that starts at ₪100.
 */
export function amountText(conditions: RuleConditions): string | undefined {
  const { amountMin, amountMax } = conditions
  if (amountMin !== undefined && amountMax !== undefined) {
    return `${formatMoney(amountMin)}–${formatMoney(amountMax)}`
  }
  if (amountMin !== undefined) return `from ${formatMoney(amountMin)}`
  if (amountMax !== undefined) return `up to ${formatMoney(amountMax)}`
  return undefined
}

/** An account as the pickers name it: the nickname, and the card digits when it has them. */
export function accountLabel(account: Account): string {
  return account.last4 === undefined ? account.name : `${account.name} ·${account.last4}`
}
