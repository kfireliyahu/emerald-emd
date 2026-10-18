/**
 * **The currencies a money cell offers, each with its sign** — M29 F3, D-344.
 *
 * Asked for: *"currency should have a dropdown with search and the icons of
 * the coins."* The sign is text — `₪`, `$`, `€` — bundled here, so nothing is
 * fetched to draw one and the app still works with the network off.
 *
 * **A list to choose from, not a list of what is allowed.** A money column's
 * currency is any three letters (its `CHECK` is on the code's shape), so a code
 * this list has not got is still taken when typed; the list is what makes the
 * common ones one pick away. Left out on purpose: the codes whose minor unit
 * the engine does not yet know (`core/money.ts` keeps two places for any it
 * does not name, so a dinar of three would be stored wrongly by a factor) —
 * they are still typed, and still stored by the same rule as before.
 *
 * Imports nothing but `Result`.
 */

import { err, ok, type Result } from '@/core/result.ts'

export interface Currency {
  /** ISO 4217, upper case: `ILS`. */
  readonly code: string
  /** The sign it is written with: `₪`. */
  readonly sign: string
  /** In English: `Israeli new shekel`. */
  readonly name: string
}

/** The shekel first — the app's first user's — and then roughly by how often each is met. */
export const CURRENCIES: readonly Currency[] = [
  { code: 'ILS', sign: '₪', name: 'Israeli new shekel' },
  { code: 'USD', sign: '$', name: 'US dollar' },
  { code: 'EUR', sign: '€', name: 'Euro' },
  { code: 'GBP', sign: '£', name: 'Pound sterling' },
  { code: 'JPY', sign: '¥', name: 'Japanese yen' },
  { code: 'CHF', sign: 'Fr', name: 'Swiss franc' },
  { code: 'CAD', sign: 'C$', name: 'Canadian dollar' },
  { code: 'AUD', sign: 'A$', name: 'Australian dollar' },
  { code: 'NZD', sign: 'NZ$', name: 'New Zealand dollar' },
  { code: 'CNY', sign: '¥', name: 'Chinese yuan' },
  { code: 'HKD', sign: 'HK$', name: 'Hong Kong dollar' },
  { code: 'SGD', sign: 'S$', name: 'Singapore dollar' },
  { code: 'TWD', sign: 'NT$', name: 'New Taiwan dollar' },
  { code: 'KRW', sign: '₩', name: 'South Korean won' },
  { code: 'INR', sign: '₹', name: 'Indian rupee' },
  { code: 'THB', sign: '฿', name: 'Thai baht' },
  { code: 'MYR', sign: 'RM', name: 'Malaysian ringgit' },
  { code: 'IDR', sign: 'Rp', name: 'Indonesian rupiah' },
  { code: 'PHP', sign: '₱', name: 'Philippine peso' },
  { code: 'SEK', sign: 'kr', name: 'Swedish krona' },
  { code: 'NOK', sign: 'kr', name: 'Norwegian krone' },
  { code: 'DKK', sign: 'kr', name: 'Danish krone' },
  { code: 'ISK', sign: 'kr', name: 'Icelandic króna' },
  { code: 'PLN', sign: 'zł', name: 'Polish złoty' },
  { code: 'CZK', sign: 'Kč', name: 'Czech koruna' },
  { code: 'HUF', sign: 'Ft', name: 'Hungarian forint' },
  { code: 'RON', sign: 'lei', name: 'Romanian leu' },
  { code: 'BGN', sign: 'лв', name: 'Bulgarian lev' },
  { code: 'UAH', sign: '₴', name: 'Ukrainian hryvnia' },
  { code: 'RUB', sign: '₽', name: 'Russian ruble' },
  { code: 'GEL', sign: '₾', name: 'Georgian lari' },
  { code: 'KZT', sign: '₸', name: 'Kazakhstani tenge' },
  { code: 'TRY', sign: '₺', name: 'Turkish lira' },
  { code: 'AED', sign: 'د.إ', name: 'UAE dirham' },
  { code: 'SAR', sign: '﷼', name: 'Saudi riyal' },
  { code: 'BHD', sign: '.د.ب', name: 'Bahraini dinar' },
  { code: 'KWD', sign: 'د.ك', name: 'Kuwaiti dinar' },
  { code: 'TND', sign: 'د.ت', name: 'Tunisian dinar' },
  { code: 'EGP', sign: 'E£', name: 'Egyptian pound' },
  { code: 'MAD', sign: 'DH', name: 'Moroccan dirham' },
  { code: 'ZAR', sign: 'R', name: 'South African rand' },
  { code: 'NGN', sign: '₦', name: 'Nigerian naira' },
  { code: 'KES', sign: 'KSh', name: 'Kenyan shilling' },
  { code: 'BRL', sign: 'R$', name: 'Brazilian real' },
  { code: 'MXN', sign: 'MX$', name: 'Mexican peso' },
  { code: 'ARS', sign: 'AR$', name: 'Argentine peso' },
  { code: 'COP', sign: 'COL$', name: 'Colombian peso' },
]

const BY_CODE: ReadonlyMap<string, Currency> = new Map(CURRENCIES.map((each) => [each.code, each]))

/** The listed currency with this code, in any case — or nothing for one the list has not got. */
export function currencyOf(code: string): Currency | undefined {
  return BY_CODE.get(code.trim().toUpperCase())
}

/**
 * A currency as somebody typed or picked it, to the code a row stores: three
 * letters, any case, listed or not. A sign is not a code — `$` is five
 * currencies — so it is refused with the codes it could mean.
 */
export function parseCurrency(typed: string): Result<string, string> {
  const text = typed.trim()
  if (/^[A-Za-z]{3}$/.test(text)) return ok(text.toUpperCase())
  const signed = CURRENCIES.filter((each) => each.sign === text)
  if (signed.length > 0) {
    return err(`"${text}" is the sign of ${signed.map((each) => each.code).join(', ')} — pick the code.`)
  }
  return err(`"${typed}" is not a currency. A currency is its three-letter code, such as ILS.`)
}
