import { formatMoney, fromMajorUnits, type CurrencyCode, type Money } from '@/core/money.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'

/**
 * What a person typed into a money field, as `Money` — or nothing, for a field
 * left empty or holding something that is not a figure.
 *
 * `magnitude` takes the figure without its sign, for the fields where a minus
 * is a slip of the keyboard rather than a meaning: a debt, a payment, a goal, a
 * fixed expense, a payslip line. A fund snapshot and a deposit keep it — a
 * severance withdrawal and a losing quarter are figures a report prints with a
 * minus.
 */
export function moneyFromText(
  text: string,
  currency: CurrencyCode,
  options?: { readonly magnitude?: boolean },
): Money | undefined {
  const parsed = parseAmountText(text)
  if (parsed === undefined) return undefined
  return fromMajorUnits(options?.magnitude === true ? Math.abs(parsed) : parsed, currency)
}

/**
 * An amount as a money field starts out: digits and separators, no symbol.
 *
 * Nothing, or zero, is an empty field — the placeholder says what goes there —
 * unless `zero` says how a recorded zero reads. `unsigned` drops a minus, for a
 * field whose direction is chosen beside it.
 */
export function editableMoney(
  amount: Money | undefined,
  options?: { readonly zero?: string; readonly unsigned?: boolean },
): string {
  if (amount === undefined) return ''
  if (amount.minor === 0) return options?.zero ?? ''
  const text = formatMoney(amount, { symbol: false })
  return options?.unsigned === true ? text.replace('-', '') : text
}
