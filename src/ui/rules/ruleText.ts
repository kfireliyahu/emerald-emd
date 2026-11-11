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
import type { MessageKey } from '@/i18n/catalogue.ts'
import { tNow } from '@/i18n/words.ts'

/**
 * The currencies offered for an amount bound and for the test box.
 *
 * The same short list as the mapper's, and for the same reason: these are what
 * an Israeli statement is denominated in, and a select of 180 codes is a worse
 * way to pick one of five.
 */
export const CURRENCY_CHOICES: readonly CurrencyCode[] = ['ILS', 'USD', 'EUR', 'GBP', 'CHF', 'JPY']

export const KIND_WORD: Readonly<Record<RuleKind, MessageKey>> = {
  EXACT_MERCHANT: 'rules.kind.EXACT_MERCHANT',
  CONTAINS: 'rules.kind.CONTAINS',
  REGEX: 'rules.kind.REGEX',
  PROVIDER_CATEGORY: 'rules.kind.PROVIDER_CATEGORY',
  AMOUNT_RANGE: 'rules.kind.AMOUNT_RANGE',
  ACCOUNT: 'rules.kind.ACCOUNT',
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
  if (amountMin !== undefined) return tNow('rules.amountFrom', { amount: formatMoney(amountMin) })
  if (amountMax !== undefined) return tNow('rules.amountUpTo', { amount: formatMoney(amountMax) })
  return undefined
}

/** An account as the pickers name it: the nickname, and the card digits when it has them. */
export function accountLabel(account: Account): string {
  return account.last4 === undefined ? account.name : `${account.name} ·${account.last4}`
}

/**
 * **What `validateRule` refuses, in the language now** (M60 U5, D-590). The
 * domain says it in English (`src/domain/categorization.ts`), which the plugin
 * reads too; a screen asks for it by the message it gave. One the table does
 * not know — the regex engine's own complaint — is shown as it came.
 */
const PROBLEM_WORD: Readonly<Record<string, MessageKey>> = {
  'Pick a category to assign': 'rules.problems.pickCategory',
  'This kind of rule needs something to match on': 'rules.problems.needsPattern',
  'An amount rule needs a minimum or a maximum': 'rules.problems.amountNeedsBound',
  'An account rule needs an account': 'rules.problems.accountNeedsAccount',
  'The two bounds are in different currencies': 'rules.problems.currencies',
  'The minimum is above the maximum': 'rules.problems.minAboveMax',
}

export function problemWords(message: string): string {
  const key = PROBLEM_WORD[message]
  if (key !== undefined) return tNow(key)
  const long = /^Pattern is longer than (\d+) characters$/.exec(message)
  return long === null ? message : tNow('rules.problems.tooLong', { n: long[1] ?? '' })
}
