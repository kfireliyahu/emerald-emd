/**
 * **The input view's form, as words and lists** — M55 U3, D-533, D-535, U1's
 * brief (`docs/mockups/m55-u1/brief.md`). Pure: what the page draws from an
 * input view's shape, and the small edits Fields makes to that shape.
 *
 * The form asks its fields in the view's order; a required column the view
 * neither asks nor sets (the format gained it after the view was saved) is
 * asked last, marked needed; what it sets without asking is the *Adds as*
 * line.
 */

import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { dayOfDefault, defaultRefusal, ONE_DAY_WORDS, type InputShape } from '@/domain/format/inputView.ts'
import { entryLabel } from '@/domain/format/view.ts'

/** One value an input view sets without asking it: its column and the default as written. */
export interface InputSet {
  readonly column: ColumnDeclaration
  readonly text: string
}

/** What the form draws: the fields asked, the required ones it lacks, and what it sets. */
export interface InputForm {
  readonly asked: readonly ColumnDeclaration[]
  /** Required, neither asked nor set: asked last on the form, and said once above it. */
  readonly lacking: readonly ColumnDeclaration[]
  readonly sets: readonly InputSet[]
}

/** A held default as the one string it is — `['Visa']` is `Visa` — or nothing. */
export function defaultText(held: unknown): string | undefined {
  const one = Array.isArray(held) && held.length === 1 ? (held[0] as unknown) : held
  if (typeof one === 'string' || typeof one === 'number' || typeof one === 'boolean') return String(one)
  return undefined
}

export function inputFormOf(declaration: FormatDeclaration, shape: InputShape): InputForm {
  const column = (name: string): ColumnDeclaration | undefined => declaration.columns.find((each) => each.name === name)
  const asked = shape.fields.flatMap((name) => column(name) ?? [])
  const lacking = declaration.columns.filter(
    (each) => each.required && !shape.fields.includes(each.name) && !Object.hasOwn(shape.defaults, each.name),
  )
  const sets = declaration.columns.flatMap((each) => {
    if (shape.fields.includes(each.name) || !Object.hasOwn(shape.defaults, each.name)) return []
    const text = defaultText(shape.defaults[each.name])
    return text === undefined ? [] : [{ column: each, text }]
  })
  return { asked, lacking, sets }
}

/** *account Visa · date today* — the *Adds as* line's words, or empty when it sets nothing. */
export function addsAsWords(sets: readonly InputSet[]): string {
  return sets.map((each) => `${entryLabel(each.column)} ${each.text}`).join(' · ')
}

/** The word a date's default is, when it is one — `today` — so the field can say it after the day. */
export function dayWordOf(column: ColumnDeclaration, held: unknown): string | undefined {
  if (column.type !== 'date') return undefined
  const text = defaultText(held)?.trim().toLowerCase()
  return ONE_DAY_WORDS.find((word) => word === text)
}

/** The sentence a range word earns as a date's default (U1 §5). */
export const ONE_DAY = 'A default names one day: today, yesterday, tomorrow or a date.'

/** Why one default cell is refused, at its row in Fields — or nothing. Empty is no default. */
export function defaultCellRefusal(column: ColumnDeclaration, text: string): string | undefined {
  if (text.trim() === '') return undefined
  if (column.type === 'date') return dayOfDefault(text, '2000-01-01') === undefined ? ONE_DAY : undefined
  return defaultRefusal(column, text)
}

/** *This view does not ask amount, which every card charge needs.* */
export function lackingSentence(declaration: FormatDeclaration, column: ColumnDeclaration): string {
  return `This view does not ask ${entryLabel(column)}, which every ${declaration.title.toLowerCase()} needs`
}

/** A new input view's name: the format's title, or *Card charge 2* when that is taken. */
export function inputViewName(declaration: FormatDeclaration, taken: readonly string[]): string {
  const lower = new Set(taken.map((each) => each.toLowerCase()))
  if (!lower.has(declaration.title.toLowerCase())) return declaration.title
  let at = 2
  while (lower.has(`${declaration.title} ${String(at)}`.toLowerCase())) at += 1
  return `${declaration.title} ${String(at)}`
}

/** A new input view, before anything is changed: every required column asked, in the format's order. */
export function draftShape(declaration: FormatDeclaration): InputShape {
  return { fields: declaration.columns.filter((each) => each.required).map((each) => each.name), defaults: {} }
}

/** Ask a column (at the end) or stop asking it. */
export function withAsked(shape: InputShape, name: string, ask: boolean): InputShape {
  const fields = shape.fields.filter((each) => each !== name)
  return { ...shape, fields: ask ? [...fields, name] : fields }
}

/** Give a column a default, or take it away with an empty one. */
export function withDefault(shape: InputShape, name: string, text: string): InputShape {
  const { [name]: _gone, ...rest } = shape.defaults
  return { ...shape, defaults: text.trim() === '' ? rest : { ...rest, [name]: text.trim() } }
}

/** Move an asked field a step, or onto another's place. */
export function withMoved(shape: InputShape, name: string, to: number): InputShape {
  const from = shape.fields.indexOf(name)
  if (from < 0 || to < 0 || to >= shape.fields.length || to === from) return shape
  const fields = shape.fields.filter((each) => each !== name)
  fields.splice(to, 0, name)
  return { ...shape, fields }
}

/** Fields' rows: the asked ones in their order, then the rest in the format's. */
export function fieldsRows(declaration: FormatDeclaration, shape: InputShape): readonly ColumnDeclaration[] {
  const asked = shape.fields.flatMap((name) => declaration.columns.find((each) => each.name === name) ?? [])
  return [...asked, ...declaration.columns.filter((each) => !shape.fields.includes(each.name))]
}

/** *Kept: 2 rows link to it.* — an Undo refused because other rows name the one just added. */
export function keptSentence(count: number): string {
  return count === 1 ? 'Kept: 1 row links to it.' : `Kept: ${String(count)} rows link to it.`
}
