/**
 * **A transfer between two of your own accounts is one pair** (M30 U3, D-356).
 *
 * The bank↔card settlement reads a card's last four digits and a statement
 * total out of the bank line (D-060). A transfer to a broker has neither: the
 * broker's deposit line carries a date, an amount and a cut-off source text,
 * and no reference. So the match is the two facts both ends do carry — **the
 * same amount, one row leaving and one arriving, on two different accounts,
 * within a few days** — and it is only ever a suggestion the person answers.
 *
 * A row that is the same kind of thing and is not a transfer — a referral bonus
 * paid into the broker — has no row leaving another account to pair with, and
 * stays unpaired. That is the whole of the rule, and why it needs no keyword.
 *
 * Pure: the rows come in, the pairs go out, and which rows are eligible (not a
 * card's, not already answered) is the caller's to say.
 */

import { daysBetween, type LocalDate } from '@/core/time.ts'

/**
 * How far apart the two ends may be, in days. A transfer made on a Thursday
 * reaches a broker on the Sunday; four covers that and a bank holiday's lag,
 * and no further — a wider window pairs the rent with somebody's repayment.
 */
export const TRANSFER_WINDOW_DAYS = 4

export interface TransferRow {
  readonly id: string
  readonly accountId: string
  readonly date: LocalDate
  /** Signed, in minor units: negative left the account, positive arrived. */
  readonly amountMinor: number
  readonly currency: string
}

export interface TransferMatch {
  readonly outId: string
  readonly inId: string
  /** Days between the two ends, never negative. */
  readonly daysApart: number
}

/**
 * Every pair the rows make, each row in one pair at most.
 *
 * Closest first: when one row leaving could be either of two arriving, the one
 * nearer in date is the pair, and the other stays a row of its own. Ties go by
 * date and then id, so the same document always suggests the same pairs.
 */
export function matchTransfers(rows: readonly TransferRow[]): readonly TransferMatch[] {
  const arriving = new Map<string, TransferRow[]>()
  for (const row of rows) {
    if (row.amountMinor <= 0) continue
    const key = keyOf(row.currency, row.amountMinor)
    const list = arriving.get(key)
    if (list === undefined) arriving.set(key, [row])
    else list.push(row)
  }

  const candidates: { out: TransferRow; in: TransferRow; daysApart: number }[] = []
  for (const out of rows) {
    if (out.amountMinor >= 0) continue
    for (const into of arriving.get(keyOf(out.currency, -out.amountMinor)) ?? []) {
      if (into.accountId === out.accountId) continue
      const daysApart = Math.abs(daysBetween(out.date, into.date))
      if (daysApart <= TRANSFER_WINDOW_DAYS) candidates.push({ out, in: into, daysApart })
    }
  }

  candidates.sort(
    (a, b) =>
      a.daysApart - b.daysApart ||
      daysBetween(b.out.date, a.out.date) ||
      a.out.id.localeCompare(b.out.id) ||
      a.in.id.localeCompare(b.in.id),
  )

  const used = new Set<string>()
  const matches: TransferMatch[] = []
  for (const candidate of candidates) {
    if (used.has(candidate.out.id) || used.has(candidate.in.id)) continue
    used.add(candidate.out.id)
    used.add(candidate.in.id)
    matches.push({ outId: candidate.out.id, inId: candidate.in.id, daysApart: candidate.daysApart })
  }
  return matches
}

function keyOf(currency: string, minor: number): string {
  return `${currency}|${String(minor)}`
}
