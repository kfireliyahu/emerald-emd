/**
 * **A formula while somebody is typing it** — M29 F5, D-346.
 *
 * Asked of the worked-out column's field: *"names of columns should be
 * autofilled and highlighted in green or linked."* The field is still a
 * person's input, and what it means is still decided by `identity.ts`'s
 * grammar (D-224, D-137) — nothing here parses arithmetic. This only says,
 * for a line that may not read yet, **where its names are**, which of them
 * the format knows, and what the word under the cursor could become.
 *
 * So it never fails. A half-typed `end - st` is pieces like any other line;
 * the grammar's own refusal is the panel's to say, in its own words.
 */

import type { ColumnType, FormatDeclaration } from './declaration.ts'
import type { FormatDraft } from './draft.ts'
import { isIdentityType } from './identity.ts'
import { DAY_WORDS, isPointType } from './span.ts'
import { TODAY } from './clock.ts'

/** One stretch of a formula, by where it sits in the text. */
export interface FormulaPiece {
  /**
   * `NAME` is a column, a hop or a total; `WORD` is `in`, `via` or a count's `days`; `UNIT` is
   * the symbol after an `in`; `OTHER` is everything else — numbers, operators,
   * brackets, `=` and spaces.
   */
  readonly kind: 'NAME' | 'WORD' | 'UNIT' | 'OTHER'
  readonly text: string
  readonly start: number
  readonly end: number
}

/** A name a formula of this format may use, and what it is — for the list it is picked from. */
export interface FormulaName {
  readonly name: string
  /** `real`, `time`, `money`… or `total` for an aggregate of this format. */
  readonly says: string
}

const NAME_START = /[a-z]/
const NAME_CHARACTER = /[a-z0-9_]/
/** The tokenizer's own unit characters (`identity.ts`), so `µg` is one piece. */
const UNIT_CHARACTER = /[\p{L}\p{N}%°_]/u

/** The formula, cut where the grammar would cut it, and nowhere it would refuse. */
export function formulaPieces(text: string): readonly FormulaPiece[] {
  const pieces: FormulaPiece[] = []
  let other = -1
  const flush = (at: number): void => {
    if (other >= 0 && at > other) pieces.push({ kind: 'OTHER', text: text.slice(other, at), start: other, end: at })
    other = -1
  }
  let afterIn = false
  let at = 0
  while (at < text.length) {
    const character = text[at] ?? ''
    // A digit run is a number, and a letter straight after one is not a name's
    // start — `2x` is the grammar's problem to name, not a column called `x`.
    if (/[0-9]/.test(character)) {
      if (other < 0) other = at
      while (at < text.length && /[0-9.]/.test(text[at] ?? '')) at += 1
      afterIn = false
      // `7 days`, `2 weeks` — the word after a number is a count's, not a name (D-471).
      let word = at
      while (word < text.length && (text[word] ?? '').trim() === '') word += 1
      let end = word
      while (end < text.length && NAME_CHARACTER.test(text[end] ?? '')) end += 1
      if (end > word && DAY_WORDS[text.slice(word, end)] !== undefined && text[end] !== '.') {
        flush(word)
        pieces.push({ kind: 'WORD', text: text.slice(word, end), start: word, end })
        at = end
      }
      continue
    }
    if (afterIn && UNIT_CHARACTER.test(character)) {
      flush(at)
      let end = at
      while (end < text.length && UNIT_CHARACTER.test(text[end] ?? '')) end += 1
      pieces.push({ kind: 'UNIT', text: text.slice(at, end), start: at, end })
      at = end
      afterIn = false
      continue
    }
    if (NAME_START.test(character)) {
      flush(at)
      let end = at
      while (end < text.length && NAME_CHARACTER.test(text[end] ?? '')) end += 1
      // One hop, as the grammar reads it; a second `.` is left where it is.
      if (text[end] === '.' && NAME_START.test(text[end + 1] ?? '')) {
        end += 1
        while (end < text.length && NAME_CHARACTER.test(text[end] ?? '')) end += 1
      }
      const word = text.slice(at, end)
      // `today` is the day a question is asked on (D-472), never a column.
      const keyword = word === 'in' || word === 'via' || word === TODAY
      pieces.push({ kind: keyword ? 'WORD' : 'NAME', text: word, start: at, end })
      afterIn = word === 'in'
      at = end
      continue
    }
    if (other < 0) other = at
    if (character.trim() !== '') afterIn = false
    at += 1
  }
  flush(text.length)
  return pieces
}

/** What the word under the cursor could become, and the stretch it would replace. */
export interface Completion {
  readonly from: number
  readonly to: number
  readonly options: readonly FormulaName[]
}

/**
 * The names the word the cursor is in could be finished as.
 *
 * Nothing for an empty word — a list on every space is noise — nor for a word
 * that is already a whole name nothing else begins with, nor for a unit after
 * `in`, which is not a name at all. Names that begin with what was typed come
 * first, then names that have it after a `_` or a `.`.
 */
export function completionAt(
  text: string,
  caret: number,
  names: readonly FormulaName[],
  most = 8,
): Completion | undefined {
  const piece = formulaPieces(text).find(
    (each) => (each.kind === 'NAME' || each.kind === 'WORD') && each.start < caret && caret <= each.end,
  )
  if (piece === undefined) return undefined
  const typed = text.slice(piece.start, caret)
  const starting = names.filter((each) => each.name.startsWith(typed))
  const inside = names.filter(
    (each) =>
      !each.name.startsWith(typed) &&
      (each.name.includes(`_${typed}`) || each.name.includes(`.${typed}`)),
  )
  const options = [...starting, ...inside].slice(0, most)
  if (options.length === 0) return undefined
  if (options.length === 1 && options[0]?.name === piece.text) return undefined
  return { from: piece.start, to: piece.end, options }
}

/** The text with a completion taken, and where the cursor lands. */
export function completed(
  text: string,
  completion: Pick<Completion, 'from' | 'to'>,
  name: string,
): { readonly text: string; readonly caret: number } {
  return {
    text: text.slice(0, completion.from) + name + text.slice(completion.to),
    caret: completion.from + name.length,
  }
}

/**
 * Every name a worked-out column or an identity of this draft may use.
 *
 * Its own figures and points, one hop through each `link` to the figures and
 * points of what it names (D-224), and its own totals. A text, an enum or a
 * boolean column is not here: naming one is a problem the grammar says, and
 * the field marks it as one before then.
 */
export function formulaNames(
  draft: Pick<FormatDraft, 'name' | 'columns' | 'aggregates'>,
  others: readonly Pick<FormatDeclaration, 'name' | 'columns'>[],
): readonly FormulaName[] {
  const usable = (type: ColumnType): boolean => isIdentityType({ type }) || isPointType(type)
  const own = draft.columns
    .filter((each) => each.name.trim() !== '' && usable(each.type))
    .map((each) => ({ name: each.name.trim(), says: each.type as string }))
  const hops = draft.columns.flatMap((link) => {
    if (link.type !== 'link' || link.target.trim() === '' || link.name.trim() === '') return []
    const target =
      link.target.trim() === draft.name.trim()
        ? { columns: draft.columns.map((each) => ({ name: each.name.trim(), type: each.type })) }
        : others.find((each) => each.name === link.target.trim())
    return (target?.columns ?? [])
      .filter((each) => each.name !== '' && usable(each.type))
      .map((each) => ({ name: `${link.name.trim()}.${each.name}`, says: `${each.type as string} of ${link.target.trim()}` }))
  })
  const totals = draft.aggregates
    .filter((each) => each.name.trim() !== '')
    .map((each) => ({ name: each.name.trim(), says: 'total' }))
  const seen = new Set<string>()
  return [...own, ...hops, ...totals].filter((each) => {
    if (seen.has(each.name)) return false
    seen.add(each.name)
    return true
  })
}
