/**
 * Turning the app's own shapes into text a conversation can read.
 *
 * Prose and markdown tables rather than JSON, for the reason `document_info`
 * gives: the consumer is a conversation, and F14's thesis is that Claude does
 * the reasoning there rather than in code here.
 *
 * **Nothing here prettifies a user's string.** A merchant name comes out
 * exactly as it went in, with no bidi marks, no trimming and no case change —
 * because the name Claude reads here is the name it will hand back to
 * `assign_category` in tier 2, and a name that made a round trip through a
 * cosmetic transform would silently match nothing (D-094). The app's `Bidi`
 * component is a DOM concern and has no business in this layer.
 */

import { instantDay } from '@/core/instant.ts'
import { formatMoney, type Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { groupThousands, plural as countedNoun } from '@/core/text.ts'
import { toISODate, toYearMonthString, type LocalDate, type YearMonth } from '@/core/time.ts'

export function money(amount: Money | undefined): string {
  return amount === undefined ? '—' : formatMoney(amount)
}

export function date(value: LocalDate | undefined): string {
  return value === undefined ? '—' : toISODate(value)
}

/** A stored instant as the day it fell on. `last_used_at`, `at`, `committed_at`. */
export function instant(value: number | undefined): string {
  return value === undefined ? '—' : instantDay(value)
}

export function period(value: YearMonth): string {
  return toYearMonthString(value)
}

export function percent(basisPoints: number | undefined): string {
  return formatPercent(basisPoints)
}

/** `1,204`. Counts are not money, but they are still easier to read grouped. */
export function count(value: number): string {
  return groupThousands(String(value))
}

/**
 * A count with its noun, agreeing in number.
 *
 * "1 transactions" is a small thing that reads as carelessness in the sentence
 * a user checks most often — the one saying how much of their ledger is about
 * to change.
 */
export function plural(value: number, noun: string, many?: string): string {
  return countedNoun(value, noun, many, count)
}

/**
 * The verb that has to agree with a `plural` count — `has`/`have`, `is`/`are`.
 *
 * The other half of the same carelessness: "1 fund have no reading" is a
 * sentence a user reads in the answer that is about to change their document,
 * and a count is rarely the last word in one.
 */
export function verb(value: number, singular: string, many: string): string {
  return value === 1 ? singular : many
}

/**
 * One cell of a markdown table.
 *
 * A pipe in a merchant name would end the column early and a newline would end
 * the row, so both are neutralized — the only two transforms in this file, and
 * they exist because the table format demands them rather than because the
 * string was untidy.
 */
function cell(value: string): string {
  // `'\|'` is `'|'` — an unknown escape in a string literal, not in a regex —
  // so this replaced a pipe with itself from M7 until D-217, and every table
  // that ever carried one came out with a column too many. Found by an enum's
  // members, which are joined with a pipe by their nature; a merchant name
  // containing one would have found it first if any had.
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const head = `| ${headers.join(' | ')} |`
  const rule = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
  return [head, rule, ...body].join('\n')
}

/**
 * What a capped list must say about itself.
 *
 * Every list tool here caps, and a capped list that does not say so is the
 * failure `summarizeTransactions` exists to prevent one layer down: "the
 * largest charge" quietly becoming "the largest of the fifty I showed you".
 * The total always comes from an uncapped count.
 *
 * **The noun is singular and this agrees with the count** (M22 U1). It used to
 * be interpolated as given, so six callers passed a plural and read "1
 * accounts" on the day a document held one, and the seventh passed a singular
 * and read "10 row" on every other day. `plural` was already here, written for
 * exactly this carelessness one layer down.
 */
export function capNote(shown: number, total: number, noun: string, max: number, many?: string): string {
  if (shown >= total) return `${plural(total, noun, many)}.`
  return (
    `Showing ${count(shown)} of ${plural(total, noun, many)}. ` +
    `Narrow the filter, or raise \`limit\` (maximum ${count(max)}).`
  )
}

/** A heading with a blank line under it, so sections stay legible in a chat. */
export function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`
}

export function paragraphs(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part !== '').join('\n\n')
}
