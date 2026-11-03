/**
 * **An input view** — M55 U2, D-533, D-536.
 *
 * A saved view of kind `input` (D-520's table, `format_saved_view`, widened by
 * 066): **its address's columns are the fields it asks, in order, and its
 * exact values are its defaults** — `?columns:charge=merchant,amount&date=today&account=Visa`
 * asks a merchant and an amount, and gives every row it adds today's date and
 * the Visa account. Nothing else is held: no filter, no order, no search.
 *
 * **A default is a fixed value of its column's type or, on a date, a word
 * naming one day** — `today`, `yesterday`, `tomorrow` — kept as the word and
 * worked out the day it is used, as a saved view's `due=today` is (D-528). A
 * word naming a stretch of days (`this week`, `within 7 days`) is a filter's,
 * never a default's: a row is added on one day.
 *
 * **Refused, by one function the screen and the tool share** (`inputViewRefusals`):
 * a required column neither asked nor defaulted, a default its column's type
 * or checks refuse, and a computed column asked or defaulted. Pure, and the
 * domain's: the address is read by `addressFilter.ts` and handed in as a shape.
 */

import { clockRange, parseClockWords, looksLikeClock } from './clock.ts'
import type { ColumnDeclaration, FormatDeclaration } from './declaration.ts'
import { coerceValue, companionKeyOf } from './row.ts'

/** The saved view's kind that asks for rows rather than showing them. */
export const INPUT_KIND = 'input'

/** What an input view holds, read from its address: the fields it asks, in order, and its defaults as written. */
export interface InputShape {
  readonly fields: readonly string[]
  /** Column to the value its address holds it to — a string, or a list or `{not}` a default refuses. */
  readonly defaults: Readonly<Record<string, unknown>>
}

/** The words a date's default may be: each names one day. */
export const ONE_DAY_WORDS = ['today', 'yesterday', 'tomorrow'] as const

/**
 * The day a date's default names, today being `day` (`YYYY-MM-DD`): a word
 * naming one day worked out, a date as itself, and nothing for anything else.
 */
export function dayOfDefault(text: string, day: string): string | undefined {
  const said = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(said)) return said
  const window = parseClockWords(said)
  if (window === undefined || !isOneDay(window.kind)) return undefined
  return clockRange(window, day)?.from
}

/** Whether a window is one day, today or either side of it. */
function isOneDay(kind: string): boolean {
  return kind === 'TODAY' || kind === 'YESTERDAY' || kind === 'TOMORROW'
}

/** A held value as one default: a string, or `true`/`false` — and nothing for a list of several or a `{not}`. */
function oneValue(held: unknown): string | undefined {
  const one = Array.isArray(held) && held.length === 1 ? (held[0] as unknown) : held
  if (typeof one === 'boolean' || typeof one === 'number') return String(one)
  return typeof one === 'string' ? one : undefined
}

/** `12.90 ILS` — a figure and the currency or unit after it, as a money or a quantity's default is written. */
function figureAndUnit(text: string): { readonly figure: string; readonly unit: string } | undefined {
  const found = /^(\S+)\s+(\S+)$/.exec(text.trim())
  return found === null ? undefined : { figure: found[1] ?? '', unit: found[2] ?? '' }
}

/** The names of a format's computed columns: what is worked out from the row, and what is counted over others. */
function computedNames(declaration: FormatDeclaration): ReadonlySet<string> {
  return new Set([...(declaration.derived ?? []).map((each) => each.name), ...declaration.aggregates.map((each) => each.name)])
}

/** Why one column's default is not one, or nothing. */
function defaultRefusal(column: ColumnDeclaration, held: unknown): string | undefined {
  const text = oneValue(held)
  if (text === undefined) return `${column.name}’s default is one value, and ${JSON.stringify(held)} is not.`
  if (column.type === 'date') {
    const window = parseClockWords(text)
    if (window !== undefined || looksLikeClock(text)) {
      if (window !== undefined && isOneDay(window.kind)) return undefined
      return `${column.name}’s default names more than one day (${text}); a date’s default is today, yesterday, tomorrow or a date.`
    }
  }
  const companion = companionKeyOf(column)
  if (companion !== undefined) {
    const split = figureAndUnit(text)
    const what = column.type === 'money' ? 'currency' : 'unit'
    if (split === undefined) return `${column.name}’s default is a figure and its ${what}, as \`12.90 ${column.type === 'money' ? 'ILS' : 'g'}\`; ${text} is not.`
    const coerced = coerceValue(column, split.figure, split.unit)
    return coerced.ok ? undefined : `${column.name}’s default: ${coerced.error}`
  }
  if (column.type === 'boolean' && (text === 'true' || text === 'false')) return undefined
  const coerced = coerceValue(column, text, undefined)
  return coerced.ok ? undefined : `${column.name}’s default: ${coerced.error}`
}

/**
 * **Why an input view cannot be kept, every reason at once** — the screen and
 * `arrange_views` both ask this before `saveView` (D-533). Empty when it can.
 */
export function inputViewRefusals(declaration: FormatDeclaration, shape: InputShape): readonly string[] {
  const reasons: string[] = []
  const computed = computedNames(declaration)
  const named = (name: string): ColumnDeclaration | undefined => declaration.columns.find((each) => each.name === name)
  const has = declaration.columns.map((each) => each.name).join(', ')
  const seen = new Set<string>()
  for (const field of shape.fields) {
    if (computed.has(field)) reasons.push(`${field} is worked out, so an input view cannot ask it.`)
    else if (named(field) === undefined) reasons.push(`${declaration.name} has no column ${field}; it has ${has}.`)
    else if (seen.has(field)) reasons.push(`${field} is asked twice.`)
    seen.add(field)
  }
  for (const [name, held] of Object.entries(shape.defaults)) {
    const column = named(name)
    if (computed.has(name)) reasons.push(`${name} is worked out, so it takes no default.`)
    else if (column === undefined) reasons.push(`${declaration.name} has no column ${name} to give a default; it has ${has}.`)
    else {
      const refusal = defaultRefusal(column, held)
      if (refusal !== undefined) reasons.push(refusal)
    }
  }
  for (const column of declaration.columns) {
    if (!column.required || seen.has(column.name) || Object.hasOwn(shape.defaults, column.name)) continue
    reasons.push(`${declaration.title} needs ${column.name}, and this view neither asks it nor gives it a default.`)
  }
  return reasons
}

/**
 * **An input view's defaults as a draft holds them** — the strings a field
 * starts at, keyed as a row is offered (a money's currency beside it, under
 * its companion key), with a date's word worked out on `day`. A default the
 * view could not have kept is left out rather than guessed at.
 */
export function inputDraft(
  declaration: FormatDeclaration,
  defaults: Readonly<Record<string, unknown>>,
  day: string,
): Readonly<Record<string, string>> {
  const draft: Record<string, string> = {}
  for (const [name, held] of Object.entries(defaults)) {
    const column = declaration.columns.find((each) => each.name === name)
    const text = oneValue(held)
    if (column === undefined || text === undefined) continue
    const companion = companionKeyOf(column)
    if (companion !== undefined) {
      const split = figureAndUnit(text)
      if (split === undefined) continue
      draft[name] = split.figure
      draft[companion] = split.unit
    } else if (column.type === 'date') {
      const date = dayOfDefault(text, day)
      if (date !== undefined) draft[name] = date
    } else if (column.type === 'enum') {
      const member = (column.values ?? []).find((each) => each.toLowerCase() === text.trim().toLowerCase())
      if (member !== undefined) draft[name] = member
    } else draft[name] = text
  }
  return draft
}

/**
 * **What an address holds a new row to** (M53 U4's `filterImplies`, moved
 * here for D-536's one defaults rule): each column held to exactly one value
 * a row could take — an enum's member, a date or a word naming one day, a
 * yes or no, a link's or a text's words. A window, a range or several values
 * imply nothing.
 */
export function heldExactly(
  declaration: FormatDeclaration,
  match: Readonly<Record<string, unknown>> | undefined,
  day: string,
): Readonly<Record<string, string>> {
  const implied: Record<string, string> = {}
  for (const [name, held] of Object.entries(match ?? {})) {
    const column = declaration.columns.find((each) => each.name === name)
    const one = Array.isArray(held) && held.length === 1 ? (held[0] as unknown) : held
    if (column === undefined) continue
    if (typeof one === 'boolean' && column.type === 'boolean') {
      implied[name] = String(one)
      continue
    }
    if (typeof one !== 'string' || one.trim() === '') continue
    const said = one.trim()
    if (column.type === 'enum') {
      const member = (column.values ?? []).find((each) => each.toLowerCase() === said.toLowerCase())
      if (member !== undefined) implied[name] = member
    } else if (column.type === 'date') {
      const date = dayOfDefault(said, day)
      if (date !== undefined) implied[name] = date
    } else if (column.type === 'boolean') {
      if (said === 'true' || said === 'false') implied[name] = said
    } else if (column.type === 'link' || column.type === 'text') {
      implied[name] = said
    }
  }
  return implied
}
