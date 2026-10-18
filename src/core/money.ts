/**
 * Money — minor units plus a currency code. Never a float.
 *
 * Decision log D-003. Floating-point money produces off-by-an-agora errors
 * that surface in aggregates, where they are hardest to trace and most
 * damaging to trust. Every amount in this app is an integer of agorot (or the
 * equivalent minor unit) and the currency it is denominated in.
 *
 * The one sanctioned crossing from float to Money is `fromMajorUnits`, which
 * exists because spreadsheet cells hand us `421.05` and there is nothing else
 * to do with it. Everything downstream of that call is integer arithmetic.
 */

import { groupThousands } from './text.ts'

/** ISO 4217, uppercase. */
export type CurrencyCode = string

export interface Money {
  /** Signed. Negative is money out. See D-004. */
  readonly minor: number
  readonly currency: CurrencyCode
}

/**
 * Minor-unit digits per currency, defaulting to 2. A short table rather than a
 * constant, because ILS is not the only currency a card statement contains.
 */
export const MINOR_DIGITS_BY_CURRENCY: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  TND: 3,
}

export function minorUnitDigits(currency: CurrencyCode): number {
  return MINOR_DIGITS_BY_CURRENCY[currency.toUpperCase()] ?? 2
}

export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Money must be a whole number of minor units, got ${minor}`)
  }
  return { minor, currency: currency.toUpperCase() }
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency)
}

/**
 * The float boundary. Rounds half-up at the currency's precision.
 *
 * `421.05 * 100` is `42104.999999999996` in IEEE 754; rounding is not optional
 * here, it is the whole point. Call this once, at the edge, on a value that
 * came from outside — never on the result of arithmetic we did ourselves.
 */
export function fromMajorUnits(value: number, currency: CurrencyCode): Money {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot make Money from ${value}`)
  }
  const scale = 10 ** minorUnitDigits(currency)
  return money(Math.round(value * scale), currency)
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot combine ${a.currency} with ${b.currency} without an explicit rate`)
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minor + b.minor, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minor - b.minor, a.currency)
}

export function negate(a: Money): Money {
  return money(-a.minor, a.currency)
}

export function abs(a: Money): Money {
  return money(Math.abs(a.minor), a.currency)
}

export function sum(amounts: readonly Money[], currency: CurrencyCode): Money {
  return amounts.reduce((total, amount) => add(total, amount), zero(currency))
}

export function isNegative(a: Money): boolean {
  return a.minor < 0
}

export function equals(a: Money, b: Money): boolean {
  return a.minor === b.minor && a.currency === b.currency
}

/** Negative, zero or positive, for sorting. Throws across currencies. */
export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b)
  return a.minor - b.minor
}

const SYMBOLS: Readonly<Record<string, string>> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
}

export function currencySymbol(currency: CurrencyCode): string {
  return SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `
}

/**
 * `-421.05` — a plain decimal, for a machine rather than a person.
 *
 * `formatMoney` is for the screen: it groups thousands and leads with ₪, and
 * neither survives a spreadsheet's number parser. This is the other half —
 * point separator, no grouping, no symbol, minus leading — which is what a CSV
 * cell has to hold for the column to add up on the other side.
 *
 * Exact by construction: the minor units are already an integer, so the decimal
 * point is inserted into their digits rather than arrived at by dividing. No
 * float touches this, which is the whole of D-003 at the one boundary where the
 * value is leaving the app.
 */
export function toDecimalString(amount: Money): string {
  const digits = minorUnitDigits(amount.currency)
  const magnitude = String(Math.abs(amount.minor)).padStart(digits + 1, '0')
  const whole = magnitude.slice(0, magnitude.length - digits)
  const fraction = digits === 0 ? '' : `.${magnitude.slice(magnitude.length - digits)}`

  return `${amount.minor < 0 ? '-' : ''}${whole}${fraction}`
}

/**
 * `toDecimalString` backwards, and the only inverse of it there is.
 *
 * **Not `fromMajorUnits(Number(text))`**, which is the obvious way to write this
 * and is a float boundary in a place that does not need one. The text came out
 * of this app rather than out of a person, so its digits are already the minor
 * units with a point pushed into them — and pushing the point back out is string
 * work. `Math.round(x * 100)` recovers the same integer for every amount anybody
 * has, and stops recovering it somewhere above `2^53` minor units; the reason
 * not to rely on that is not the size of the error, it is that D-003 says the
 * money path has no float in it and a serializer promising exactness is the last
 * place to spend the exception.
 *
 * Refuses rather than rounds. A cell with more fraction digits than the currency
 * has is a value this app did not write, and quietly dropping the last digit is
 * how a figure changes without anybody being told (D-138).
 */
export function fromDecimalString(text: string, currency: CurrencyCode): Money | undefined {
  const matched = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(text.trim())
  if (matched === null) return undefined

  const [, sign = '', whole = '', fraction = ''] = matched
  const digits = minorUnitDigits(currency)
  if (fraction.length > digits) return undefined

  const minor = Number(`${whole}${fraction.padEnd(digits, '0')}`)
  if (!Number.isSafeInteger(minor)) return undefined
  // `-0` is not a minus nought here: `-0.00` and `0.00` are the same amount and
  // the negation would otherwise hand back a value that fails an equality test
  // against the one it was written from.
  return money(sign === '-' && minor !== 0 ? -minor : minor, currency)
}

/**
 * `₪1,234.56` — symbol leading, minus leading, thousands separated.
 * Display only. Never parse the output of this back into a Money.
 */
export function formatMoney(amount: Money, options?: { readonly symbol?: boolean }): string {
  const digits = minorUnitDigits(amount.currency)
  const scale = 10 ** digits
  const negative = amount.minor < 0
  const magnitude = Math.abs(amount.minor)

  const whole = Math.floor(magnitude / scale)
  const fraction = magnitude % scale

  const groupedWhole = groupThousands(String(whole))
  const body = digits === 0 ? groupedWhole : `${groupedWhole}.${String(fraction).padStart(digits, '0')}`
  const symbol = options?.symbol === false ? '' : currencySymbol(amount.currency)

  return `${negative ? '-' : ''}${symbol}${body}`
}
