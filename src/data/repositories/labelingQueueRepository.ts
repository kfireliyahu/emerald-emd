/**
 * The labeling queue's one piece of state: the counterparties the user chose not
 * to name. docs/f06 ("The labeling queue") and D-065.
 *
 * Everything else the queue needs already exists. Grouping by counterparty, one
 * decision covering every past and future occurrence, and the rule offered
 * afterwards are `listMerchantGroups` and `offerForCorrection` — the bulk
 * categorize screen D-047 built, which turns out to be this feature with a
 * different name. What F06 asks for and M2 did not build is **skip as a
 * first-class outcome**: a name the user declined to label has to stop being
 * asked about, and has to stay findable.
 *
 * **An `app_setting` key, not a table**, weighed exactly as D-053 weighed the
 * fixed-expense dismissal and coming out the same way: nothing holds a foreign
 * key to a skip, it carries no state beyond membership and when it was added,
 * and it is keyed on a normalized merchant string rather than on anything with
 * an id. This is the case where D-061's argument for a column does *not* apply —
 * there is no row for it to belong to.
 */

import type { Database } from 'sql.js'

import type { MerchantGroup } from '@/domain/merchantGroups.ts'

import { listMerchantGroups } from './merchantGroupRepository.ts'
import { readJsonSetting, writeSetting } from './settingsRepository.ts'
import type { TransactionFilter } from './transactionRepository.ts'

const SKIP_KEY = 'labeling.skipped'

/**
 * Merchant → when it was skipped.
 *
 * The timestamp is what lets the Skipped section say "skipped in June" rather
 * than listing names with no way to tell an old decision from this morning's.
 */
export function readSkipped(db: Database): ReadonlyMap<string, number> {
  const stored = readJsonSetting(db, SKIP_KEY)
  const merchants = (stored as { merchants?: unknown } | undefined)?.merchants
  if (typeof merchants !== 'object' || merchants === null) return new Map()

  const found = new Map<string, number>()
  for (const [merchant, at] of Object.entries(merchants)) {
    if (typeof at === 'number') found.set(merchant, at)
  }
  return found
}

export function skipMerchant(db: Database, merchantNormalized: string, now: number): void {
  const merchants = Object.fromEntries(readSkipped(db))
  merchants[merchantNormalized] = now
  writeSetting(db, SKIP_KEY, JSON.stringify({ merchants }), now)
}

/**
 * Put a skipped name back in the queue.
 *
 * docs/f06: skipping is a decision, not a deletion. Nothing is lost by it and
 * the way back is one click, which is what makes "skip" cheap enough to be the
 * honest answer to "I do not know what this is".
 */
export function unskipMerchant(db: Database, merchantNormalized: string, now: number): void {
  const merchants = Object.fromEntries(readSkipped(db))
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete merchants[merchantNormalized]
  writeSetting(db, SKIP_KEY, JSON.stringify({ merchants }), now)
}

/** Skip every name currently in the queue — docs/f06's "skippable in one action". */
export function skipAll(db: Database, merchants: readonly string[], now: number): number {
  const stored = Object.fromEntries(readSkipped(db))
  let added = 0
  for (const merchant of merchants) {
    if (stored[merchant] !== undefined) continue
    stored[merchant] = now
    added += 1
  }
  writeSetting(db, SKIP_KEY, JSON.stringify({ merchants: stored }), now)
  return added
}

/**
 * **By merchant's queue, as one reading** (M28 F16): every merchant with
 * uncategorized rows in the scope, split into the ones still waiting and the
 * ones the user skipped. The screen lists `waiting` and says *nothing left*
 * when it is empty; the guide's step is done on exactly that, so the two read
 * one function and cannot disagree. They did once: the step counted a skipped
 * shop's rows as unfiled while the screen, rightly, had stopped asking (D-065).
 */
export function merchantQueue(
  db: Database,
  scope: TransactionFilter = {},
): { readonly waiting: readonly MerchantGroup[]; readonly skipped: readonly MerchantGroup[] } {
  const skipped = readSkipped(db)
  const all = listMerchantGroups(db, scope)
  return {
    waiting: all.filter((group) => !skipped.has(group.merchantNormalized)),
    skipped: all.filter((group) => skipped.has(group.merchantNormalized)),
  }
}
