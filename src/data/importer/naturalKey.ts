/**
 * The dedupe key. Importing the same statement twice must produce the same
 * ledger as importing it once — docs/05 lists that as an invariant worth
 * testing, and docs/13 lists it as a thing you cannot skip.
 *
 * Composed per docs/04-data-model.md: transaction date, absolute amount,
 * normalized merchant, installment sequence, and a collision counter.
 *
 * The counter is what makes two identical coffees on the same day work. Within
 * one file, the Nth row with an otherwise-identical key gets counter N — so
 * re-importing that same file reproduces exactly the same keys, and the second
 * coffee stays a second coffee rather than becoming a duplicate of the first.
 */

import { plainBytes } from '@/core/bytes.ts'
import { abs } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import type { DraftTransaction } from '@/domain/model/importing.ts'

function baseKey(transaction: DraftTransaction): string {
  const amount = abs(transaction.amount)
  const installment = transaction.installment === undefined ? '' : String(transaction.installment.sequence)
  return [
    toISODate(transaction.transactionDate),
    `${amount.minor}${amount.currency}`,
    transaction.merchantNormalized,
    installment,
  ].join('')
}

/**
 * Keys for a whole file at once, because the collision counter is only
 * meaningful relative to the other rows in that file. Order matters and must
 * be the file's own row order.
 */
export function assignNaturalKeys(transactions: readonly DraftTransaction[]): readonly string[] {
  const seen = new Map<string, number>()

  return transactions.map((transaction) => {
    const base = baseKey(transaction)
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    return `${base}${occurrence}`
  })
}

/** A stable fingerprint of the file's bytes: "you already imported this exact file". */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', plainBytes(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
