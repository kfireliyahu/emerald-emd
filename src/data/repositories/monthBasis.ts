/**
 * **The day a row counts on, written once** (D-607, M64 U1).
 *
 * Every figure that says what a month came to — Home, Year, the comparisons,
 * the category breakdown, the ledger's month totals, `month_summary` and
 * `year_summary` — asks this file which month a row is in, so a change to the
 * basis changes them all together and none can disagree.
 *
 * **A card purchase counts in the month it was bought**, not the month its bill
 * was charged (which D-006 chose, and D-607 reversed for spending): a month read
 * as *October* shows October's shopping beside October's rent and payslip, not
 * September's. A row's own `transaction_date` is the purchase's day — a card
 * statement repeats it on every slice of an installment and varies only the
 * charge date (docs/04's `originalDate`).
 *
 * **An installment counts one payment a month from the purchase**: slice *k* of
 * *n* in the purchase's month plus *k − 1*, on the same day of the month, or the
 * month's last day when it is shorter. D-607 left installments unasked, and this
 * is its default — the other reading, the whole price in the purchase's month,
 * is one line here.
 */

/** `t.` for an alias, nothing for the bare table. */
const prefixOf = (alias: string): string => (alias === '' ? '' : `${alias}.`)

/** The ISO day a row counts on, for spending, income and saving alike. */
export function spentOn(alias = ''): string {
  const p = prefixOf(alias)
  const date = `${p}transaction_date`
  const later = `(COALESCE(${p}installment_sequence, 1) - 1)`
  return `(CASE WHEN COALESCE(${p}installment_sequence, 1) > 1 AND COALESCE(${p}installment_total, 1) > 1
    THEN MIN(
      date(${date}, 'start of month', '+' || ${later} || ' months', '+' || (CAST(substr(${date}, 9, 2) AS INTEGER) - 1) || ' days'),
      date(${date}, 'start of month', '+' || (${later} + 1) || ' months', '-1 day'))
    ELSE ${date} END)`
}

/** The `YYYY-MM` a row counts in: the month of `spentOn`. */
export function spentIn(alias = ''): string {
  return `substr(${spentOn(alias)}, 1, 7)`
}

/**
 * **The day money left the account** — a card row's charge date, falling back to
 * the row's own date. Not a month's figures: what reads a bill, a statement or a
 * payment reads this (a statement's months, a debt's paid slices, a recurring
 * charge's cadence), because those are about the account, not the purchase.
 */
export function chargedOn(alias = ''): string {
  const p = prefixOf(alias)
  return `COALESCE(${p}charge_date, ${p}transaction_date)`
}

/** The `YYYY-MM` of the statement a row came on: its billing period, else its charge month. */
export function billedIn(alias = ''): string {
  const p = prefixOf(alias)
  return `COALESCE(${p}billing_period, substr(${chargedOn(alias)}, 1, 7))`
}
