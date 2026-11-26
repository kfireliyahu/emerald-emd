/**
 * What the debt vocabulary is called, for the two screens outside Wealth's details
 * that still say it in English: the promotion panel that offers a split purchase as
 * a debt, and the review of payments the app found. Wealth's own screens say every
 * debt word through the `wealth` catalogue area (M64 F3, F26), and the rest of this
 * file went with them.
 */

import type { AutoTrackKind, PaymentSourceKind } from '@/domain/model/debt.ts'

export const TRACK_KIND_LABEL: Readonly<Record<AutoTrackKind, string>> = {
  NONE: 'I will enter payments myself',
  MERCHANT_PATTERN: 'Charges from a merchant',
  CATEGORY: 'Anything in a category',
  CARD_INSTALLMENT_GROUP: 'The slices of one split purchase',
}

export const PAYMENT_SOURCE_LABEL: Readonly<Record<PaymentSourceKind, string>> = {
  MANUAL: 'Entered by hand',
  TRANSACTION: 'From a transaction',
  PAYCHECK: 'From a paycheck',
  INSTALLMENT_SLICE: 'A slice of a split purchase',
  FROM_PLAN: 'From a split plan',
}
