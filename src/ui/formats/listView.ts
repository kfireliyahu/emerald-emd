import type { Database } from 'sql.js'

import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { linkLabels, listRows, type RowQuery } from '@/data/repositories/formatRowRepository.ts'
import { labelColumn, type ColumnDeclaration, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { readValue, type StoredRow } from '@/domain/format/row.ts'
import { heldExactly } from '@/domain/format/inputView.ts'
import { blankDraft, type RowDraft } from '@/domain/format/rowDraft.ts'
import {
  dueBucket,
  dueText,
  entryDefaults,
  entryLabel,
  inDueOrder,
  isTicked,
  listGroups,
  listOf,
  withArticle,
  type ListGroup,
  type ListShape,
} from '@/domain/format/view.ts'
import { valueText } from '@/ui/formats/entryList.ts'

/**
 * **The list, as the screen draws it** — M53 U4, D-519: one format's rows as
 * lines in groups, read once per change of the rows. The same picture draws
 * the list view (`#/formats/<name>/list`) and, narrow, the list beside an open
 * entry (`EntryList`), so the two are one list in two widths and its settings
 * hold in both. Pure, and no React.
 */

/** One value on a row's line. */
export type LineCell =
  | { readonly kind: 'chips'; readonly column: string; readonly members: readonly string[] }
  | { readonly kind: 'member'; readonly column: string; readonly member: string }
  | { readonly kind: 'date'; readonly column: string; readonly text: string; readonly late: boolean; readonly long: string }
  | { readonly kind: 'text'; readonly column: string; readonly text: string; readonly link: boolean }

/** One row as a line of the list. */
export interface ListLine {
  readonly id: string
  readonly row: StoredRow
  /**
   * What the line is known by across writes — its name, made unique — never
   * its id: a text document renews ids on every write (D-247), and a line
   * keyed by one would forget it was just ticked.
   */
  readonly key: string
  readonly title: string
  readonly ticked: boolean
  /** The value of the column that ticks a row, as stored — what an untick goes back to. */
  readonly value: string | undefined
  readonly cells: readonly LineCell[]
}

/** The list of one format: its shape, its groups, and what its group's link rows are called. */
export interface ListPicture {
  readonly shape: ListShape<ColumnDeclaration>
  readonly groups: readonly ListGroup<ListLine>[]
  /** A link's rows by id → name, for the group a row is added in and its placeholder. */
  readonly names: ReadonlyMap<string, string>
}

/** How many rows a link group offers before the list stops naming them. */
const TARGETS = 200

/** A stored value as text: an enum's member, a link's id, a date, `true`. */
function stored(column: ColumnDeclaration, row: StoredRow): string | undefined {
  const value = readValue(column, row)
  if (typeof value === 'string') return value === '' ? undefined : value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return undefined
}

/** Every row the query holds, as the list's groups. */
export function listPicture(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  query: RowQuery,
  settings: ReadonlyMap<string, string>,
  day: string,
): ListPicture {
  const shape = listOf(declaration.columns, settings)
  // In the order asked, else the name's — then, within a group, by the due when one is said (M54 F2).
  const rows = listRows(db, declaration, query.order === undefined && shape.name !== undefined ? { ...query, order: shape.name.name } : query)
  const labels = linkLabels(db, rows, declaration, declarations)
  const untitled = `Untitled ${declaration.title.toLowerCase()}`
  const seen = new Map<string, number>()
  const lines = rows.map((row): ListLine => {
    const named = shape.name === undefined ? '' : valueText(shape.name, row, labels).trim()
    const title = named === '' ? untitled : named
    const times = seen.get(title) ?? 0
    seen.set(title, times + 1)
    const value = shape.done === undefined ? undefined : stored(shape.done.column, row)
    const ticked = isTicked(shape.done, value)
    return {
      id: row.id,
      row,
      key: times === 0 ? title : `${title}\u0000${String(times)}`,
      title,
      ticked,
      value,
      // Late only by the date a row is due by (M54 F2, D-532): any other date is its day.
      cells: shape.shown.flatMap((column) => cellOf(column, row, labels, day, ticked || column !== shape.due)),
    }
  })
  // A link's rows, in that format's order, each a group even while empty.
  const target = shape.group?.type === 'link' ? declarations.find((each) => each.name === shape.group?.target) : undefined
  const named = target === undefined ? undefined : labelColumn(target)
  const targets =
    target === undefined
      ? []
      : listRows(db, target, { ...(named === undefined ? {} : { order: named.name }), limit: TARGETS }).map((row) => {
          const said = named === undefined ? '' : valueText(named, row, new Map()).trim()
          return { id: row.id, name: said === '' ? row.id : said }
        })
  const due = shape.due
  const ordered = due === undefined ? lines : inDueOrder(lines, (line) => stored(due, line.row))
  const groups = listGroups(shape, ordered, (line, column) => stored(column, line.row), day, targets)
  return { shape, groups, names: new Map(targets.map((each) => [each.id, each.name])) }
}

function cellOf(
  column: ColumnDeclaration,
  row: StoredRow,
  labels: ReadonlyMap<string, string>,
  day: string,
  /** Ticked, or not the due: a past date is only its day. */
  ticked: boolean,
): LineCell[] {
  const value = readValue(column, row)
  if (column.type === 'enums') {
    return Array.isArray(value) && value.length > 0 ? [{ kind: 'chips', column: column.name, members: value }] : []
  }
  if (column.type === 'enum') {
    return typeof value === 'string' && value !== '' ? [{ kind: 'member', column: column.name, member: value }] : []
  }
  if (column.type === 'date' && typeof value === 'string' && value !== '') {
    const said = dueText(value, day, ticked)
    return said === undefined ? [] : [{ kind: 'date', column: column.name, text: said.text, late: said.late, long: value }]
  }
  const text = valueText(column, row, labels)
  return text === '' ? [] : [{ kind: 'text', column: column.name, text, link: column.type === 'link' }]
}

/**
 * The rows in the order the list draws them — each group's open rows, then its
 * ticked ones — which the entry's ↑ ↓ walks when the list is beside it.
 */
export function listOrder(picture: ListPicture): readonly ListLine[] {
  return picture.groups.flatMap((group) =>
    group.ticked ? group.rows : [...group.rows.filter((line) => !line.ticked), ...group.rows.filter((line) => line.ticked)],
  )
}

/** The values the address's filter holds exactly, as a row added under it takes them: `due:today`, `state:next`. */
export function filterImplies(
  declaration: FormatDeclaration,
  filter: RowFilter,
  day: string,
): Readonly<Record<string, string>> {
  // The domain's since M55 U2 (D-536): the one defaults rule reads it too.
  return heldExactly(declaration, filter.match, day)
}

/** What a row added in place starts as, and the words its line's placeholder names. */
export interface QuickAdd {
  /** The draft with every value but the title — what entry/new opens with when it cannot be written. */
  readonly draft: RowDraft
  /** The placeholder: *Add a task · inbox, Garden shed*. */
  readonly placeholder: string
  /** The required columns nothing fills, besides the title. */
  readonly missing: readonly string[]
}

/**
 * **Quick add** (the mockup's (e)): the group's value, the address filter's
 * exact values, and a required enum's first member when nothing implies one
 * (U3's `entryDefaults`) — every one named in the placeholder, so nothing is
 * taken silently. A required column it still cannot fill is `missing`, and the
 * row opens on entry/new instead of being written.
 */
export function quickAdd(
  declaration: FormatDeclaration,
  shape: ListShape<ColumnDeclaration>,
  implies: Readonly<Record<string, string>>,
  filter: RowFilter,
  day: string,
  names: ReadonlyMap<string, string>,
  previous?: StoredRow | undefined,
  currency?: string | undefined,
  input: Readonly<Record<string, string>> = {},
  /** The default input view's asked fields (M55 U4): typed on the line, so neither named nor missing. */
  asked: readonly string[] = [],
): QuickAdd {
  // The one defaults rule (M55 U2, D-536): the default input view's, the
  // address's exact values, a first member — and the group typed in over all.
  const defaults = entryDefaults(declaration.columns, new Set(Object.keys(implies)), {
    input,
    address: filterImplies(declaration, filter, day),
  })
  const set = { ...defaults, ...implies }
  const draft: Record<string, string> = { ...blankDraft(declaration, previous, currency), ...set }
  // What the line types: the view's asked fields where it has some, else the title.
  const typed = (column: ColumnDeclaration): boolean => (asked.length > 0 ? asked.includes(column.name) : column === shape.name)
  const words = declaration.columns.flatMap((column) => {
    const value = set[column.name]
    if (value === undefined || value === '' || typed(column)) return []
    const label = column.name.replace(/_/g, ' ')
    if (column.type === 'enum') return [value.replace(/_/g, ' ')]
    if (column.type === 'link') return [names.get(value) ?? value]
    if (column.type === 'date') return [`${label} ${dueText(value, day, false)?.text ?? value}`]
    if (column.type === 'boolean') return [value === 'true' ? label : `not ${label}`]
    return [value]
  })
  const one = withArticle(declaration.title.toLowerCase())
  return {
    draft,
    placeholder: words.length === 0 ? `Add ${one}` : `Add ${one} · ${words.join(', ')}`,
    missing: declaration.columns
      .filter((column) => column.required && !typed(column) && (draft[column.name] ?? '').trim() === '')
      .map((column) => column.name),
  }
}

/** One field on quick add's line: its column, its small label, and what it starts holding. */
export interface QuickField {
  readonly column: ColumnDeclaration
  readonly label: string
  readonly start: string
}

/**
 * **Quick add's fields** (M55 U4, D-533, U1's brief §6): the default input
 * view's asked fields in its order, each starting at what `quickAdd`'s draft
 * holds — the view's default, or the group's value over it — a link by its
 * row's name, as a person types it. Nothing is parsed from the text.
 */
export function quickFieldsOf(
  declaration: FormatDeclaration,
  asked: readonly string[],
  draft: RowDraft,
  names: ReadonlyMap<string, string>,
): readonly QuickField[] {
  return asked.flatMap((name) => {
    const column = declaration.columns.find((each) => each.name === name)
    if (column === undefined) return []
    const held = draft[name] ?? ''
    return [{ column, label: entryLabel(column), start: column.type === 'link' ? (names.get(held) ?? held) : held }]
  })
}

/**
 * The group a row holding this value lands in — where a new entry's draft is
 * drawn in the list beside it, before it is written.
 */
export function groupKeyOf(shape: ListShape<ColumnDeclaration>, value: string | undefined, day: string): string {
  const column = shape.group
  const held = value === undefined || value.trim() === '' ? undefined : value.trim()
  if (column === undefined) return 'all'
  if (column.type === 'date') return `date:${dueBucket(held, day)}`
  if (column.type === 'link') return `link:${held ?? ''}`
  return `member:${held !== undefined && (column.values ?? []).includes(held) ? held : ''}`
}
