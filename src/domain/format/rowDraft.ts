/**
 * A row of a declared format while it is being typed — M20 U1 (D-227).
 *
 * **Every field is the text it was typed as**, which is the same choice
 * `draft.ts` made for a declaration being written and for the same reason: a
 * form that parses on every keystroke cannot represent `-` on the way to `-3`,
 * and a number field holding `undefined` because the user cleared it is a field
 * that has lost what they did. The draft is text; `coerceRow` is the only thing
 * that turns text into cells, and it is the one the plugin already goes through
 * (D-217).
 *
 * That is the whole of what makes this unit's screen and `record_format_rows`
 * the same write: the form does not check anything. It collects strings, hands
 * them to the engine's own coercion, and prints the sentence that comes back.
 * **A second implementation of "is this a valid date" is how a screen and a tool
 * come to disagree about a document** — which is the divergence M20's parity
 * rule was written about.
 *
 * ## Why a whole row goes in, on an edit as much as on an add
 *
 * `coerceEdit` exists for a caller that names three columns out of thirty and
 * means *leave the rest*. **A form is not that caller**: it shows every column,
 * so it writes every column. The ninth instance of D-138 in this project was an
 * edit form that showed six fields and wrote two, and the shape that prevents it
 * is that what is displayed and what is written come off one object.
 */

import { toDecimalString } from '@/core/money.ts'

import {
  isListType,
  type ColumnDeclaration,
  type FormatDeclaration,
} from './declaration.ts'
import {
  companionKeyOf,
  isList,
  offeredKeysOf,
  readValue,
  type StoredRow,
} from './row.ts'
import { stringListOf } from './stringList.ts'

/**
 * One row being typed: an offered key to the text in its field.
 *
 * Keyed by *offered* key rather than by column, so `price` and `price_currency`
 * are two entries — the same two words `record_format_rows` takes, which is
 * what lets the draft be handed to `coerceRow` unchanged.
 */
export type RowDraft = Readonly<Record<string, string>>

/**
 * An empty row, with the two kinds of companion carried over from a row that is
 * already there.
 *
 * **A currency and a unit are carried; nothing else is.** Every row of a format
 * is usually in the same currency and a form that makes you type `ILS` thirty
 * times is a form people stop using — but a *figure* copied from the last row
 * is a value nobody entered, sitting in a field that looks like they did. The
 * line is the one D-137 draws for a model and it holds for a form: the shape of
 * an answer may be offered, the answer may not.
 */
export function blankDraft(
  declaration: FormatDeclaration,
  previous?: StoredRow | undefined,
  currency?: string | undefined,
): RowDraft {
  const draft: Record<string, string> = {}
  for (const key of offeredKeysOf(declaration)) draft[key] = ''

  for (const column of declaration.columns) {
    const companion = companionKeyOf(column)
    if (companion === undefined) continue
    const carried = previous?.cells[companion]
    if (typeof carried === 'string' && carried !== '') draft[companion] = carried
    // **The document's currency, when no row above says one** (M29 F3,
    // D-344): offered as every carried currency is — a companion, written only
    // beside a figure (`offeredOf`), so it never makes an empty row a row.
    else if (column.type === 'money' && currency !== undefined && currency !== '') draft[companion] = currency
  }
  return draft
}

/**
 * A row that is already stored, as the text a form would show for it.
 *
 * **`money` comes back as major units** — the one field whose stored form and
 * typed form genuinely differ, because the column is two cells of minor units
 * and a code and the person typed `12.90`. `toDecimalString` is the inverse of
 * the `fromMajorUnits` on the way in, and it is exact: both sides are integers
 * and a decimal point, and no float is involved in either direction.
 */
export function draftOfRow(declaration: FormatDeclaration, row: StoredRow): RowDraft {
  const draft: Record<string, string> = {}
  for (const column of declaration.columns) {
    const value = readValue(column, row)
    draft[column.name] = fieldText(column, value)
    const companion = companionKeyOf(column)
    if (companion === undefined) continue
    const beside = row.cells[companion]
    draft[companion] = typeof beside === 'string' ? beside : ''
  }
  return draft
}

/** The text a field shows for a value the table already holds. */
function fieldText(column: ColumnDeclaration, value: ReturnType<typeof readValue>): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  // A list's ids, as the JSON list a form keeps them in (M27 U2, D-300).
  if (isList(value)) return draftOfMembers(value)
  if ('minor' in value) return toDecimalString(value)
  // A quantity's figure and its unit are two fields, and this is the figure.
  if ('amount' in value) return String(value.amount)
  // Unreachable; the union above is exhaustive. Named rather than cast, so a
  // tenth type in the language arrives here as an empty field somebody notices
  // rather than as a compile that quietly kept working.
  void column
  return ''
}

/**
 * The draft as something to hand to `coerceRow` — **and the one place the form
 * takes anything back out**.
 *
 * `blankDraft` carries a currency and a unit forward so nobody types `ILS`
 * thirty times, and that carry has a sharp edge: `coerceMoney` and
 * `coerceQuantity` both treat *one half given and the other blank* as a
 * mistake, which it is when a caller wrote it. **A companion the form filled in
 * for you is not something you wrote.** Left alone, carrying `ILS` into a new
 * row would make an optional money column refuse until a price was typed —
 * turning a convenience into a required field, which is the opposite of what it
 * is for.
 *
 * So: a companion is offered only when the figure beside it is. Nothing else is
 * touched, and in particular nothing is trimmed, normalised or guessed — what
 * goes to the engine is what is in the fields.
 */
export function offeredOf(
  declaration: FormatDeclaration,
  draft: RowDraft,
): Readonly<Record<string, string | readonly string[]>> {
  const offered: Record<string, string | readonly string[]> = {}
  for (const column of declaration.columns) {
    const value = draft[column.name] ?? ''
    // A list is offered as one (M27 U2, D-300): the members a form picked, or
    // the one name typed or pasted into it, which resolves like any other.
    offered[column.name] = isListType(column.type) ? (membersOfDraft(value) ?? value) : value
    const companion = companionKeyOf(column)
    if (companion === undefined) continue
    offered[companion] = value.trim() === '' ? '' : (draft[companion] ?? '')
  }
  return offered
}

/** One field changed, leaving the rest of the row exactly as it was. */
export function withField(draft: RowDraft, key: string, text: string): RowDraft {
  return { ...draft, [key]: text }
}

/**
 * Whether anything here has been typed at all.
 *
 * What *Add* is disabled on, and it is asked of `offeredOf`'s answer rather
 * than of the draft: a currency the form carried forward on its own is not
 * something the person typed, so a row holding only that is still an empty row.
 *
 * It matters because `coerceRow` refuses an all-blank row only when the format
 * has a required column. A format with none would otherwise take a row of
 * nothing — a row nobody meant, about which no message would be useful, because
 * nothing is wrong with it.
 */
export function isEmpty(draft: Readonly<Record<string, string | readonly string[]>>): boolean {
  return Object.values(draft).every((text) => (typeof text === 'string' ? text.trim() === '' : text.length === 0))
}

/**
 * A `links` field's text — the JSON list of the ids it holds, `""` for none
 * (M27 U2, D-300). A list rather than names joined by a comma, because a name
 * may hold one; the field draws the members by name.
 */
export function draftOfMembers(ids: readonly string[]): string {
  return ids.length === 0 ? '' : JSON.stringify(ids)
}

/** The ids a `links` field holds, or nothing when its text is not a list. */
export function membersOfDraft(text: string): readonly string[] | undefined {
  return text.trim() === '' ? [] : stringListOf(text)
}
