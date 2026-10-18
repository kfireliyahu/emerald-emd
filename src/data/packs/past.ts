/**
 * **What a pack declared before, so keeping it again can tell its value from a
 * person's** — M51 U9 (D-491).
 *
 * Keeping a pack the document keeps already adds the columns it grew (D-405)
 * and follows the ones it renamed (D-443). Until this unit it left the rest of
 * what the pack writes as the document held it: a format's notes, and the
 * settings of its views — the board's `taken_by: card`, a ready view's states.
 * So every session that changed the development pack's `unit` or `inbox` edited
 * `docs/memory.emd` by hand to make the drift checks pass, three times in two
 * days.
 *
 * Bringing those along has one hazard: a person may have changed them in their
 * own document — `arrange_views` on a pack's format, or notes they rewrote — and
 * a newer pack must not quietly undo that. The document records nothing about
 * where a value came from, so **the pack records what it declared before**: the
 * fingerprint of every notes text, and every setting each view held, in every
 * build. The rule:
 *
 * - **The document holds a value an earlier build of the pack declared there**
 *   → it is the pack's, and keeping the pack again writes the new one (or takes
 *   the line away, when the pack has dropped it).
 * - **It holds anything else** → it is the person's: kept, and the dry run says
 *   so, naming the pack's value it was kept over.
 *
 * A place the pack never declared a line for until now counts its absence as
 * the pack's earlier value, so a new line is added; a place where the pack has
 * always had a line, and the document has none, was cleared by a person and
 * stays clear.
 *
 * `development/pack.test.ts` fails when the pack declares a value its past does
 * not list, and prints the line to add — which is the one hand edit left, and it
 * is in the pack's own code rather than in somebody's document.
 */

import type { ViewKind } from '@/domain/format/view.ts'

/**
 * What every build of a pack declared — the half of its history keeping it again
 * needs. The current build's values are in it too, so a document that keeps
 * this build is recognised by the next one.
 */
export interface PackPast {
  /** A format's name to the fingerprints (`fingerprint`) of every notes text the pack declared for it. */
  readonly notes: Readonly<Record<string, readonly string[]>>
  /**
   * `format view column` to every setting the pack declared there, `null` for a
   * build that declared the format and had no line for it. A place missing
   * here is one no build declared a line for until the current one.
   */
  readonly views: Readonly<Record<string, readonly (string | null)[]>>
}

/** A notes text as the past lists it: 32-bit FNV-1a, eight hex digits. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Where one view setting lives. */
export interface SettingPlace {
  readonly format: string
  readonly view: ViewKind
  readonly column: string
}

/** A view setting keeping the pack writes: `from` what the document holds, `to` the pack's; either may be none. */
export interface SettingChange extends SettingPlace {
  readonly from: string | undefined
  readonly to: string | undefined
}

/** The key `PackPast.views` uses for a place. */
export function placeKey(place: SettingPlace): string {
  return `${place.format} ${place.view} ${place.column}`
}

/** Whether `held` — none when undefined — is a value some build of the pack declared at `place`. */
export function wasThePacks(past: PackPast, place: SettingPlace, held: string | undefined): boolean {
  const values = past.views[placeKey(place)]
  return values === undefined ? held === undefined : values.includes(held ?? null)
}

/** Whether a document's notes for `format` are notes some build of the pack declared. */
export function notesWereThePacks(past: PackPast, format: string, held: string): boolean {
  return past.notes[format]?.includes(fingerprint(held)) === true
}

/** A change, as the dry run and the Packs screen both say it. */
export function settingPhrase(change: SettingChange, done: boolean): string {
  const where = `${change.format} ${change.view} ${change.column}`
  if (change.to === undefined) return `${done ? 'took' : 'takes'} ${where} off (it was ${change.from ?? 'none'})`
  if (change.from === undefined) return `${done ? 'set' : 'sets'} ${where} to ${change.to}`
  return `${done ? 'changed' : 'changes'} ${where} from ${change.from} to ${change.to}`
}

/** A setting the person chose, kept over the pack's, as both halves say it. */
export function keptPhrase(change: SettingChange): string {
  return `${change.format} ${change.view} ${change.column} is ${change.from ?? 'none'} (the pack’s is ${change.to ?? 'none'})`
}
