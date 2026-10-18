/**
 * What has already been suggested about a merchant, so the same name is not
 * asked about twice.
 *
 * The cache began as the superseded in-app assistant's, where its job was to
 * stop the app paying to
 * ask the same question twice. Reached from a conversation, nobody pays per
 * merchant — but the user pays in attention, which is worse: without this, the
 * backlog hands back the identical forty names next week, including the ten
 * they already said they could not identify, and the conversation starts over.
 *
 * **A memo, not a decision.** Nothing here assigns anything, and nothing here
 * hides a merchant from the backlog. `uncategorized_merchants` shows the note
 * beside the merchant and lets the reader use it — the same choice the app's
 * bulk-categorize screen makes with its "already filed under" hint (D-047):
 * report the evidence, do not act on it.
 *
 * **An `app_setting` key, not a table**, weighed the way D-053, D-065 and D-069
 * weighed theirs and coming out the same way: nothing holds a foreign key to a
 * note, it is keyed on a **normalized merchant string** rather than on a row,
 * and it carries no state beyond what was suggested and when. It *points* at a
 * category id, which does have a row; a category later deleted simply reads as
 * a note with no category, which is how `read` decodes it.
 *
 * Keyed on `merchant_normalized` — the same key `listMerchantGroups` groups on
 * and the rules engine matches on — so the merchant a note is about and the
 * merchant it is shown against are the same set by construction (D-047).
 */

import type { Database } from 'sql.js'

import { readJsonSetting, writeSetting } from './settingsRepository.ts'

const SUGGESTIONS_KEY = 'assistant.merchantSuggestions'

/**
 * The ceiling on the memo. It lives in one JSON value, so it may not grow
 * without bound: past this, the oldest notes are dropped, because a note from
 * four hundred merchants ago is not what stops a conversation repeating itself.
 */
export const SUGGESTIONS_KEPT = 500

export type SuggestionStatus =
  /** Offered and not yet acted on. Say so next time rather than re-deriving it. */
  | 'SUGGESTED'
  /** Offered and refused. Do not offer *this* category again. */
  | 'DECLINED'
  /** Looked at, and nobody could say what it is. A valid answer, not a gap. */
  | 'NO_SUGGESTION'

export interface MerchantSuggestion {
  readonly merchantNormalized: string
  /** Undefined exactly when the status is `NO_SUGGESTION`. */
  readonly categoryId: string | undefined
  readonly status: SuggestionStatus
  /** One line in the assistant's own words, or nothing. Shown, never parsed. */
  readonly note: string | undefined
  /** When it was written, epoch ms. Shown so a stale note is visibly stale. */
  readonly at: number
}

const STATUSES: readonly SuggestionStatus[] = ['SUGGESTED', 'DECLINED', 'NO_SUGGESTION']

export function isSuggestionStatus(value: string): value is SuggestionStatus {
  return (STATUSES as readonly string[]).includes(value)
}

interface Stored {
  readonly c?: unknown
  readonly s?: unknown
  readonly n?: unknown
  readonly at?: unknown
}

function read(db: Database): Map<string, MerchantSuggestion> {
  const stored = readJsonSetting(db, SUGGESTIONS_KEY)
  const merchants = (stored as { merchants?: unknown } | undefined)?.merchants
  if (typeof merchants !== 'object' || merchants === null) return new Map()

  const found = new Map<string, MerchantSuggestion>()
  for (const [merchantNormalized, value] of Object.entries(merchants)) {
    // Defensive like every decoder in this folder: the document is a real
    // SQLite database the user can edit in any tool, and a mangled entry has to
    // read as "no note" rather than throw on the next listing.
    if (typeof value !== 'object' || value === null) continue
    const { c, s, n, at } = value as Stored
    const status = typeof s === 'string' && isSuggestionStatus(s) ? s : undefined
    if (status === undefined) continue
    const categoryId = typeof c === 'string' && c !== '' ? c : undefined
    // A suggestion with no category is not a suggestion; it is the third state.
    if (categoryId === undefined && status !== 'NO_SUGGESTION') continue

    found.set(merchantNormalized, {
      merchantNormalized,
      categoryId: status === 'NO_SUGGESTION' ? undefined : categoryId,
      status,
      note: typeof n === 'string' && n !== '' ? n : undefined,
      at: typeof at === 'number' ? at : 0,
    })
  }
  return found
}

function write(db: Database, notes: ReadonlyMap<string, MerchantSuggestion>, now: number): void {
  // Newest first, then cut: the drop has to be by age, and a Map's insertion
  // order is not it once entries have been rewritten in place.
  const kept = [...notes.values()].sort((a, b) => b.at - a.at).slice(0, SUGGESTIONS_KEPT)

  writeSetting(
    db,
    SUGGESTIONS_KEY,
    JSON.stringify({
      merchants: Object.fromEntries(
        kept.map((suggestion) => [
          suggestion.merchantNormalized,
          {
            ...(suggestion.categoryId === undefined ? {} : { c: suggestion.categoryId }),
            s: suggestion.status,
            ...(suggestion.note === undefined ? {} : { n: suggestion.note }),
            at: suggestion.at,
          },
        ]),
      ),
    }),
    now,
  )
}

/** Merchant → note, which is the shape a listing joins against. */
export function merchantSuggestionMap(db: Database): ReadonlyMap<string, MerchantSuggestion> {
  return read(db)
}

export interface SuggestionInput {
  readonly merchantNormalized: string
  readonly categoryId?: string | undefined
  readonly status: SuggestionStatus
  readonly note?: string | undefined
}

/**
 * Write a batch of notes, replacing whatever each merchant had.
 *
 * Replacing rather than appending: the question is "what do we currently know
 * about this name", and two notes about one merchant would be a coin toss at
 * read time — the same argument `setSettlementAlias` makes (D-069). Returns
 * what was written, so a caller can report the count it actually changed.
 */
export function noteMerchantSuggestions(
  db: Database,
  inputs: readonly SuggestionInput[],
  now: number,
): readonly MerchantSuggestion[] {
  const notes = new Map(read(db))
  const written: MerchantSuggestion[] = []

  for (const input of inputs) {
    const suggestion: MerchantSuggestion = {
      merchantNormalized: input.merchantNormalized,
      categoryId: input.status === 'NO_SUGGESTION' ? undefined : input.categoryId,
      status: input.status,
      note: input.note === undefined || input.note === '' ? undefined : input.note,
      at: now,
    }
    notes.set(suggestion.merchantNormalized, suggestion)
    written.push(suggestion)
  }

  write(db, notes, now)
  return written
}

/**
 * Forget what was suggested about these merchants.
 *
 * Called when a merchant is actually categorized: the note existed to stop the
 * same question being asked again, and the question has now been answered. A
 * note left beside a categorized merchant is worse than no note — it says a
 * decision is still open when it is not.
 */
export function clearMerchantSuggestions(
  db: Database,
  merchants: readonly string[],
  now: number,
): number {
  if (merchants.length === 0) return 0

  const notes = new Map(read(db))
  let cleared = 0
  for (const merchant of merchants) {
    if (notes.delete(merchant)) cleared += 1
  }
  if (cleared === 0) return 0

  write(db, notes, now)
  return cleared
}
