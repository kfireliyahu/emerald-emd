/**
 * Installment grouping — the link that ties this month's slice to the purchase
 * it came from.
 *
 * D-007 counts the slice charged in the period, not the purchase, and stores
 * the group link so a purchase-basis view can be added later. That link is the
 * whole reason this file exists: a statement states the merchant, the original
 * date and the full price on every slice, and once the file is gone there is no
 * way to work out that March's ₪100 and April's ₪100 were one ₪1,200 sofa.
 *
 * The key is **derived, never read from the file**. No provider ships a
 * purchase identifier, so the only thing every slice of one purchase agrees on
 * is what the purchase was: merchant, when it happened, how much it cost. See
 * docs/04-data-model.md, "Installment".
 *
 * Plain functions over plain values: no React, no sql.js, no DOM
 * (docs/conventions.md).
 */

import type { Money } from '@/core/money.ts'
import { toISODate, type LocalDate } from '@/core/time.ts'

/**
 * What one slice knows about the purchase behind it.
 *
 * `originalDate` is the purchase date, which is the row's own transaction date:
 * a slice repeats the date of the purchase and varies only its charge date, and
 * the importer has no other date to offer (D-036). `originalTotal` is what the
 * file said the whole purchase cost, and is absent when the file states only
 * the slice.
 */
export interface InstallmentPurchase {
  /** The merchant after `normalizeMerchant`, so a branch number cannot split a group. */
  readonly merchantNormalized: string
  readonly originalDate: LocalDate
  readonly originalTotal: Money | undefined
  /** How many payments the purchase was split into — the "12" of "3 of 12". */
  readonly paymentCount: number
}

/** Separates the fields of a key. A unit separator cannot occur in a merchant name. */
const SEPARATOR = '\u001f'

/**
 * The key every slice of one purchase shares.
 *
 * Ordered date · price · merchant rather than merchant first, so the two
 * generated fields stay in fixed positions and a merchant name carrying
 * anything odd cannot be mistaken for one of them.
 *
 * The price is compared by magnitude: the sign of an amount is a convention the
 * importer applies (D-004), and a group must not split because one file wrote
 * its charges positive and the next wrote them negative.
 *
 * When the file states no original total, the payment count stands in for it.
 * That is weaker — two purchases at one merchant on one day, both split twelve
 * ways, collide — but it still groups the slices of an ordinary purchase, and
 * inventing a total by multiplying the slice would be a number the file never
 * said.
 */
export function installmentGroupKey(purchase: InstallmentPurchase): string {
  const { merchantNormalized, originalDate, originalTotal, paymentCount } = purchase

  const price =
    originalTotal === undefined
      ? `x${paymentCount}`
      : `${Math.abs(originalTotal.minor)}${originalTotal.currency}`

  return [toISODate(originalDate), price, merchantNormalized].join(SEPARATOR)
}
