/**
 * **How a format's columns are shown** — M26 U2, D-289.
 *
 * Presentation, and so never the declaration: a width says nothing about what a
 * column holds. It is kept in the document because widths were asked for
 * per document (2026-10-01), in `format_column_view` beside the format. M26 U6's
 * entry view was meant to go there too and could not — a width is required of
 * every row — so a view's settings are `format_view_column`'s (D-294).
 */

import type { CompiledDerived } from './derived.ts'
import { columnsNamedBy } from './identity.ts'
import { formatDayMonth, formatMonthShort, parseISODate, parseYearMonth } from '@/core/time.ts'

/** One column's width on a format's sheet, in CSS pixels. */
export interface ColumnWidth {
  readonly format: string
  readonly column: string
  readonly width: number
}

/** The bounds `049_column_view` checks, so a drag can never be refused by SQLite. */
export const NARROWEST = 48
export const WIDEST = 1200

/** A dragged width as one the table will take: whole pixels, inside the bounds. */
export function boundedWidth(width: number): number {
  if (!Number.isFinite(width)) return NARROWEST
  return Math.min(WIDEST, Math.max(NARROWEST, Math.round(width)))
}

/**
 * **Where a bubble sits on the connections canvas** — M26 U4.
 *
 * Presentation for the same reason a width is: a position says nothing about
 * what a format holds. A `FORMAT` place is one bubble; a `PACK` place is the
 * one bubble a pack's formats fold into until it is opened (D-269), and moving
 * it moves them all. A format with no place is put where the rank layout puts
 * it, so a document that was never arranged draws exactly as it did.
 */
export interface GraphPlace {
  readonly kind: 'FORMAT' | 'PACK'
  readonly name: string
  readonly x: number
  readonly y: number
}

/** The bounds `050_graph_place` checks: far enough to arrange anything, finite. */
export const FARTHEST = 100_000

/** A dragged coordinate as one the table will take: a whole pixel, inside the bounds. */
export function boundedCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(FARTHEST, Math.max(-FARTHEST, Math.round(value)))
}

/**
 * **The views a format has** — M26 U6, D-294.
 *
 * The sheet is every format's, and the default: it needs nothing kept beyond
 * its widths. The entry is the readable door — one row as one page, its
 * columns as headings over values, each shown the way chosen per format (D-402).
 * **The page's shape is the format's**: no free blocks, nothing on it a column
 * did not put there. That is the line between a view and a workspace. **Its
 * order is the view's** (M26 F2, D-296): a column may be dragged to another
 * place on the page, because order is how a page is read and not what a column
 * holds — and a page nobody arranged runs in the declaration's order.
 *
 * A board (M27 U3, D-301) is the second kind of this one thing, and the
 * roadmap and the page (M27 U4, D-302) the third and fourth — a view, named,
 * that keeps a setting per column (`format_view_column`) — so a new kind is a
 * word added here and a reading of what its settings mean, not a table of its
 * own.
 */
export const VIEW_KINDS = ['entry', 'board', 'roadmap', 'page', 'ready', 'start', 'agenda', 'list'] as const

export type ViewKind = (typeof VIEW_KINDS)[number]

/** One column's setting in one view of one format: for an entry, how it is shown; for a board, its part. */
export interface ViewSetting {
  readonly format: string
  readonly view: ViewKind
  readonly column: string
  readonly setting: string
}

/**
 * **How one column is shown on the entry** — M35 U3, D-402, the approved
 * mockup's "Show as, per column type" (`docs/mockups/m35/entry.html`).
 *
 * Each type has a set of ways, **the first its default** and what the sheet's
 * cell already shows. A way is how the value is drawn, and editing follows from
 * it: a figure is typed where it stands, a bar or a ring opens its figure when
 * pressed, a slider drags, a chip or a menu opens the members, buttons and steps
 * are pressed, a link's name opens its row and a pencil beside it names another.
 *
 * Show as replaced M26 U6's inputs (D-294): `line`, `markdown`, `slider`,
 * `menu`, `buttons` and `chips` kept their words, `date` and `month` are their
 * types' defaults, and `field` and `search` — the figure and the name now —
 * are read as no choice (`RETIRED_WAYS`), so a page arranged before draws as
 * the default rather than refusing the document.
 *
 * Kept per format, beside the declaration (`format_view_column`, view `entry`).
 * **It never reaches the sheet's cells or a board's cards**: a sheet keeps one
 * figure per cell so a column reads down evenly (pick 4).
 */
export type ShowAs =
  | 'line'
  | 'markdown'
  | 'mono'
  | 'figure'
  | 'bar'
  | 'ring'
  | 'slider'
  | 'large'
  | 'written'
  | 'unit'
  | 'date'
  | 'relative'
  | 'both'
  | 'month'
  | 'datetime'
  | 'clock'
  | 'chip'
  | 'menu'
  | 'buttons'
  | 'steps'
  | 'chips'
  | 'tick'
  | 'word'
  | 'name'
  | 'card'
  | 'list'
  | 'cards'

/** What each way is called where somebody picks one. */
export const SHOW_AS_LABEL: Readonly<Record<ShowAs, string>> = {
  line: 'Line',
  markdown: 'Markdown',
  mono: 'Mono',
  figure: 'Figure',
  bar: 'Bar',
  ring: 'Ring',
  slider: 'Slider',
  large: 'Large figure',
  written: 'As written',
  unit: 'In one unit',
  date: 'Date',
  relative: 'Relative',
  both: 'Both',
  month: 'Month',
  datetime: 'Date and time',
  clock: 'Clock',
  chip: 'Chip',
  menu: 'Menu',
  buttons: 'Buttons',
  steps: 'Steps',
  chips: 'Chips',
  tick: 'Tick',
  word: 'Yes or No',
  name: 'Name',
  card: 'Card',
  list: 'List',
  cards: 'Cards',
}

/**
 * What a way means, said beside it in the list — the mockup's examples, and
 * only where the label alone does not say it.
 */
export const SHOW_AS_HINT: Readonly<Partial<Record<ShowAs, string>>> = {
  line: 'one line',
  markdown: 'read as a note',
  mono: 'a code or a reference',
  bar: 'against the largest',
  slider: 'between its bounds',
  unit: 'converted',
  steps: 'the members as a path',
  card: 'its state and line',
}

/**
 * The words M26 U6 kept that Show as retired: the figure was a `field` and the
 * name a `search`. Read as no choice — the type's default — and dropped on the
 * next write, so a document arranged before still opens.
 */
export const RETIRED_WAYS: ReadonlySet<string> = new Set(['field', 'search'])

/** The part of a column a way needs to know: its type and its bounds. */
export interface InputColumn {
  readonly type: string
  readonly minimum?: number | undefined
  readonly maximum?: number | undefined
}

/**
 * The ways a column may be shown, **the default first** — what the sheet's
 * cell already is, so a format nobody arranged draws as it always did. A
 * slider is offered only when both bounds are declared: it has nowhere to run
 * otherwise.
 */
export function waysFor(column: InputColumn): readonly ShowAs[] {
  const bounded = column.minimum !== undefined && column.maximum !== undefined
  switch (column.type) {
    case 'text':
      return ['line', 'markdown', 'mono']
    case 'integer':
    case 'real':
    case 'decimal':
      return bounded ? ['figure', 'bar', 'slider'] : ['figure', 'bar']
    case 'percent':
      return bounded ? ['figure', 'bar', 'ring', 'slider'] : ['figure', 'bar', 'ring']
    case 'money':
      return ['figure', 'large']
    case 'quantity':
      return ['written', 'unit', 'bar']
    case 'date':
      return ['date', 'relative', 'both']
    case 'month':
      return ['month', 'relative']
    case 'instant':
      return ['datetime', 'relative']
    // A time of day is typed, plainly — `9:30`, `21:00` — never spun (D-335).
    case 'time':
      return ['clock']
    case 'enum':
      return ['chip', 'menu', 'buttons', 'steps']
    // Several of a list, as chips (M34 U5, D-398): each a word of the list,
    // taken out by its ×, one more found from what is left.
    case 'enums':
      return ['chips']
    case 'boolean':
      return ['tick', 'word', 'buttons']
    case 'link':
      return ['name', 'card']
    // The members as chips, each found the way a link is (M27 U2, D-300).
    case 'links':
      return ['chips', 'list', 'cards']
    default:
      return ['line']
  }
}

/**
 * The way a column is shown: the one chosen, while its type still offers it,
 * and the default otherwise — so a column whose type changed under a choice,
 * or a word Show as no longer offers, falls back rather than drawing something
 * that no longer fits.
 */
export function wayOf(column: InputColumn, chosen: string | undefined): ShowAs {
  const offered = waysFor(column)
  const picked = offered.find((each) => each === chosen)
  return picked ?? offered[0] ?? 'line'
}

/** Whether a word is a way at all — what a text document's views part is checked by. */
export function isShowAs(word: string): word is ShowAs {
  return Object.hasOwn(SHOW_AS_LABEL, word)
}

/**
 * **What a worked-out column is shown as**: the ways of the type it works out
 * to (D-334), and never editable — money's for money, a percent's for a figure
 * made of percents alone, a figure's otherwise. It has no bounds, so it is never
 * offered a slider.
 */
export function workedOutType(kind: 'MONEY' | 'NUMBER' | 'DATE', percent: boolean): InputColumn {
  if (kind === 'MONEY') return { type: 'money' }
  if (kind === 'DATE') return { type: 'date' }
  return { type: percent ? 'percent' : 'real' }
}

/**
 * **Whether figures made of these columns read as a percent** — every column
 * named is one. A percent is weighed as its fraction (D-333), so a check or a
 * worked-out column over percents alone would otherwise print `0.55` where the
 * person wrote 55%. Anything mixed — a price times a rate — is not a percent
 * and prints as the figure it is.
 */
export function printsAsPercent(
  names: readonly string[],
  columns: readonly { readonly name: string; readonly type: string }[],
): boolean {
  return (
    names.length > 0 &&
    names.every((name) => columns.some((column) => column.name === name && column.type === 'percent'))
  )
}

/**
 * **Whether a worked-out figure is a percent** — a figure in no unit whose
 * every column is one (D-402). The entry view and the sheet print it as `55%`
 * rather than the fraction it is weighed as, and it is offered a percent's ways.
 */
export function isPercentWorkedOut(
  compiled: Pick<CompiledDerived, 'type' | 'expanded'>,
  columns: readonly { readonly name: string; readonly type: string }[],
): boolean {
  if (compiled.type.kind !== 'NUMBER' || compiled.type.unit !== undefined) return false
  return printsAsPercent(columnsNamedBy({ left: compiled.expanded, right: { kind: 'NUMBER', value: 0 } }), columns)
}

/** Whether a word names a view this build knows. */
export function isViewKind(word: string): word is ViewKind {
  return (VIEW_KINDS as readonly string[]).includes(word)
}

/**
 * Whether a setting is one this kind of view keeps — what a text document's
 * views part, and a pack's, is checked by. Each kind reads its own words.
 */
export function isViewSetting(view: ViewKind, setting: string): boolean {
  switch (view) {
    case 'entry':
      return readEntrySetting(setting) !== undefined
    case 'board':
      return isBoardPart(setting)
    case 'roadmap':
      return isRoadmapPart(setting)
    case 'page':
      return isPagePart(setting)
    case 'ready':
      return setting === 'waits' || setting === 'line' || readReadyState(setting) !== undefined || readStalls(setting) !== undefined
    case 'start':
      return setting === 'line' || readStartSetting(setting) !== undefined
    case 'agenda':
      return setting === 'date' || setting === 'line' || readAgendaDone(setting) !== undefined
    case 'list':
      return readListSetting(setting) !== undefined
  }
}

/**
 * **The word only one column of a view may hold** (M48 U3): a roadmap runs in
 * one `order`, a ready list waits through one link and reads one enum, and a
 * start view counts one `latest`, and an agenda reads one `date` and one `done` (a board's `lanes` is `setBoardLanes`'s). Setting it on a column
 * takes it off the others, so what is drawn is what was last said rather than
 * the first column in the declaration that still says it. Nothing for a word
 * several columns may hold (`is`, `line`, `under`, `card`).
 */
export function soleWordOf(view: ViewKind, setting: string): string | undefined {
  const word = setting.trim().split(/\s+/)[0] ?? ''
  switch (view) {
    case 'roadmap':
      return word === 'order' ? word : undefined
    case 'ready':
      return word === 'waits' || word === 'ready' || word === 'stalls' ? word : undefined
    case 'start':
      return word === 'latest' ? word : undefined
    case 'agenda':
      return word === 'date' || word === 'done' ? word : undefined
    default:
      return undefined
  }
}

/** The longest word a view keeps for one column — `052_view_column`'s CHECK. */
export const SETTING_LONGEST = 32

/** The words each kind but the entry keeps, for a refusal that names them. */
export const VIEW_PARTS: Readonly<Record<Exclude<ViewKind, 'entry'>, readonly string[]>> = {
  board: ['lanes', 'card'],
  roadmap: ['order', 'line', 'under'],
  page: ['body', 'line'],
  ready: ['waits', 'line', 'ready <member> done <members>', 'stalls <days>'],
  start: ['is <member>', 'latest <count>', 'line'],
  agenda: ['date', 'done <members>', 'line'],
  list: ['group', 'line', 'done <members>'],
}

/**
 * **A board** — M27 U3, D-301.
 *
 * One format's rows as cards in lanes, one lane per member of an enum column.
 * A kind of view like the entry page, kept the same way: per format, a setting
 * per column in `format_view_column`, beside the declaration and never in it.
 * Two words, and nothing else a board keeps:
 *
 * - `lanes` — the enum column the lanes are the members of. A format that
 *   names none is drawn by its first enum, so every format with an enum has a
 *   board whether anyone declared one or not.
 * - `card` — a column shown on each card under its name. **A card shows the
 *   format's name column and the columns that say `card`, and nothing else** —
 *   D-294's line between a view and a workspace: nothing on it a column did not
 *   put there.
 */
export type BoardPart = 'lanes' | 'card'

export function isBoardPart(word: string): word is BoardPart {
  return word === 'lanes' || word === 'card'
}

/** The part of a column a board needs: its name, its type and an enum's members. */
export interface BoardColumn {
  readonly name: string
  readonly type: string
  readonly values?: readonly string[] | undefined
}

/** What a board draws: the column its lanes are, the column a card is named by, and the rest of a card. */
export interface BoardShape<C extends BoardColumn> {
  readonly lanes: C
  readonly name: C | undefined
  readonly cards: readonly C[]
}

/**
 * The board a format draws, or nothing when it has no enum to lay lanes by.
 *
 * The column a setting names as `lanes` while it is still an enum, and the
 * first enum otherwise — so a column retyped under a board falls back rather
 * than drawing lanes of something that has no members, as `wayOf` does.
 */
export function boardOf<C extends BoardColumn>(
  columns: readonly C[],
  settings: ReadonlyMap<string, string>,
): BoardShape<C> | undefined {
  const enums = columns.filter((column) => column.type === 'enum')
  const named = enums.find((column) => settings.get(column.name) === 'lanes')
  const lanes = named ?? enums[0]
  if (lanes === undefined) return undefined
  const name = nameColumnOf(columns)
  return {
    lanes,
    name,
    cards: columns.filter(
      (column) => column !== lanes && column !== name && settings.get(column.name) === 'card',
    ),
  }
}

/** One lane: a member, or `undefined` for the rows that have none, and the rows in it. */
export interface Lane<R> {
  readonly member: string | undefined
  readonly rows: readonly R[]
}

/**
 * The rows into lanes, **one per member in the order they are declared, empty
 * or not** — a lane with nothing in it is still somewhere a card can be moved
 * to. Rows with no value come last, in a lane of their own, and only when there
 * are some: an optional enum's empty is a state a row can be in, and not one a
 * card can be dragged into, because a drag says what a row *is*.
 */
export function lanesOf<R>(
  members: readonly string[],
  rows: readonly R[],
  memberOf: (row: R) => string | undefined,
): readonly Lane<R>[] {
  const lanes: Lane<R>[] = members.map((member) => ({
    member,
    rows: rows.filter((row) => memberOf(row) === member),
  }))
  const none = rows.filter((row) => {
    const member = memberOf(row)
    return member === undefined || !members.includes(member)
  })
  return none.length > 0 ? [...lanes, { member: undefined, rows: none }] : lanes
}

/**
 * **What the entry view keeps for one column** — how it is shown, its place on
 * the page, whether it sits in the header line, or any of them (M26 F2, D-296;
 * M35 U2, D-401; M35 U3, D-402).
 *
 * One `setting` string, because the table keeps one per column and view:
 * `markdown`, `#2`, `header`, or `markdown #2`. A place is where the column
 * comes on the page counting from 1; a column with none comes after every
 * column that has one, in the declaration's order — so a column added after the
 * page was arranged lands at the foot rather than nowhere. `header` puts a
 * column in the line under the title beside the ones its type puts there
 * (`entryLayout`) — what a page's `line` said before the page and the entry
 * were one view.
 *
 * **`hidden` and `new`** (M53 U2, D-517): `hidden` keeps a column off this
 * entry view even when it holds a value — never the title nor a required
 * column, which are drawn whatever the setting says — and `new` marks a column
 * a new entry asks for beside the required ones (M53 U3 reads it). Both are the
 * view's, beside the order: the column stays in the format, the table and
 * every tool.
 */
export interface EntrySetting {
  readonly way?: ShowAs | undefined
  readonly place?: number | undefined
  readonly header?: boolean | undefined
  readonly hidden?: boolean | undefined
  readonly asked?: boolean | undefined
}

/** The word that puts a column in the entry's header line. */
export const HEADER_WORD = 'header'

/** The word that keeps a column off the entry view (M53 U2). */
export const HIDDEN_WORD = 'hidden'

/** The word that has a new entry ask for a column (M53 U2; read by U3). */
export const ASKED_WORD = 'new'

/**
 * A setting back into its parts, or nothing when it is not one the entry view
 * keeps. A retired way (`field`, `search`) is read and kept as no choice.
 */
export function readEntrySetting(setting: string): EntrySetting | undefined {
  const words = setting.trim().split(/\s+/)
  let way: ShowAs | undefined
  let place: number | undefined
  let header: boolean | undefined
  let hidden: boolean | undefined
  let asked: boolean | undefined
  let retired = false
  for (const word of words) {
    const placed = /^#(\d{1,4})$/.exec(word)
    if (placed?.[1] !== undefined && place === undefined && Number(placed[1]) >= 1) {
      place = Number(placed[1])
    } else if (word === HEADER_WORD && header === undefined) {
      header = true
    } else if (word === HIDDEN_WORD && hidden === undefined) {
      hidden = true
    } else if (word === ASKED_WORD && asked === undefined) {
      asked = true
    } else if (isShowAs(word) && way === undefined && !retired) {
      way = word
    } else if (RETIRED_WAYS.has(word) && way === undefined && !retired) {
      retired = true
    } else {
      return undefined
    }
  }
  return way === undefined && place === undefined && header === undefined && hidden === undefined && asked === undefined && !retired
    ? undefined
    : { way, place, header, hidden, asked }
}

/** The parts as one setting, or nothing when there is nothing left to keep. */
export function writeEntrySetting(entry: EntrySetting): string | undefined {
  const words = [
    ...(entry.way === undefined ? [] : [entry.way]),
    ...(entry.place === undefined ? [] : [`#${String(entry.place)}`]),
    ...(entry.header === true ? [HEADER_WORD] : []),
    ...(entry.hidden === true ? [HIDDEN_WORD] : []),
    ...(entry.asked === true ? [ASKED_WORD] : []),
  ]
  return words.length === 0 ? undefined : words.join(' ')
}

/**
 * **A text reads as markdown** when nobody chose how to show it and any value
 * of it holds a line break, runs past a line (M35 U2, D-401), or carries inline
 * markdown — `**bold**`, a `[link](to)`, or a line that starts as a heading, a
 * list or a quote (M35 U3, D-402) — which is where raw `###` and `**` used to
 * show. **A code span is not markdown enough**: a backtick is how a title
 * quotes a name (`money`, `[text](file.md)`), and a title read as a note would
 * stop being the title. Single `*` and `_` are left out for the same reason
 * — a product and a snake_case name.
 */
export const LONG_TEXT = 120

const INLINE_MARKDOWN = /\*\*[^*\s][^*]*\*\*|__[^_\s][^_]*__|\[[^\]\n]+\]\([^)\s]+\)|^(?:#{1,6}|[-*+]|>|\d+\.)\s/

export function readsAsMarkdown(values: readonly string[]): boolean {
  return values.some(
    (value) =>
      value.includes('\n') || value.length > LONG_TEXT || INLINE_MARKDOWN.test(value.replace(/`[^`\n]*`/g, '')),
  )
}

/**
 * The way a column is shown on the entry: the one chosen, while its type
 * offers it; markdown for a text that reads as it and nobody chose for; the
 * type's default otherwise.
 */
export function entryWayOf(column: InputColumn, chosen: string | undefined, markdown: boolean): ShowAs {
  const offered = waysFor(column)
  const picked = offered.find((each) => each === chosen)
  if (picked !== undefined) return picked
  return markdown && offered.includes('markdown') ? 'markdown' : (offered[0] ?? 'line')
}

/** The types the header line takes by themselves: a word, a day, a yes, one row named. */
const HEADER_TYPES: ReadonlySet<string> = new Set([
  'enum',
  'enums',
  'boolean',
  'date',
  'month',
  'time',
  'instant',
  'link',
])

/** The types drawn as figures in the entry's grid. */
const FIGURE_TYPES: ReadonlySet<string> = new Set(['integer', 'real', 'decimal', 'percent', 'money', 'quantity'])

/**
 * **One row's entry, in its parts** — M35 U2, D-401, the approved direction A.
 *
 * - `title` — the first text column drawn as a line, in the view's order (D-296).
 * - `header` — the line under it: every word, day, yes-or-no and single link,
 *   and any column the view says `header` of.
 * - `figures` — the number columns, as a grid, with the verdicts under them.
 * - `texts` — the rest of the text, each under its name.
 * - `links` — the columns naming several rows, in the column on the right
 *   above what names this row.
 *
 * Every column is in exactly one part, in the view's order.
 */
export interface EntryLayout<C> {
  readonly title: C | undefined
  readonly header: readonly C[]
  readonly figures: readonly C[]
  readonly texts: readonly C[]
  readonly links: readonly C[]
}

export function entryLayout<C extends InputColumn & { readonly name: string }>(
  ordered: readonly C[],
  wayOfColumn: (column: C) => ShowAs,
  headers: ReadonlySet<string>,
): EntryLayout<C> {
  const title = ordered.find(
    (column) => column.type === 'text' && !headers.has(column.name) && wayOfColumn(column) === 'line',
  )
  const rest = ordered.filter((column) => column !== title)
  const inHeader = (column: C): boolean => headers.has(column.name) || HEADER_TYPES.has(column.type)
  return {
    title,
    header: rest.filter(inHeader),
    figures: rest.filter((column) => !inHeader(column) && FIGURE_TYPES.has(column.type)),
    texts: rest.filter(
      (column) => !inHeader(column) && !FIGURE_TYPES.has(column.type) && column.type !== 'links',
    ),
    links: rest.filter((column) => !inHeader(column) && column.type === 'links'),
  }
}

/**
 * The columns in the entry view's order: those with a place by it, then the
 * rest in the declaration's order. Ties — two columns given one place by a hand
 * edit — keep the declaration's order between them rather than refusing.
 */
export function entryOrder<T extends { readonly name: string }>(
  columns: readonly T[],
  places: ReadonlyMap<string, number>,
): readonly T[] {
  return columns
    .map((column, at) => ({ column, at, place: places.get(column.name) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.place - b.place || a.at - b.at)
    .map((each) => each.column)
}

/**
 * **A column's label on the entry, as words** — M53 U3, D-518, U1's approved
 * mockup: `done_on` reads "done on", and a suffix naming the column's own unit
 * is dropped, so `estimate_h` (in h) reads "estimate" with its h on the value.
 * Only the label: the column keeps its name in the table and every tool.
 */
export function entryLabel(column: { readonly name: string; readonly unit?: string | undefined }): string {
  const { name, unit } = column
  const suffix = unit === undefined || unit === '' ? '' : `_${unit.toLowerCase()}`
  const bare = suffix !== '' && name.length > suffix.length && name.toLowerCase().endsWith(suffix)
    ? name.slice(0, -suffix.length)
    : name
  return bare.replace(/_/g, ' ')
}

/** A word with the article a sentence on the screen puts before it: "a task", "an ingredient". */
export function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`
}

/**
 * **What a new entry starts holding** — M53 U3, D-518 (U1's choice e): every
 * required enum that nothing implies, at its first member, so a new task is
 * `inbox` and a person need not open a menu to be allowed to Add. **A default
 * the view applies, never a value a model makes** (D-137): it is drawn in its
 * field from the start, and an entry given nothing else is still untouched.
 * `implied` names the columns something else already sets — U4's quick add,
 * from the group it is typed in.
 */
export function entryDefaults(
  columns: readonly { readonly name: string; readonly type: string; readonly required: boolean; readonly values: readonly string[] }[],
  implied: ReadonlySet<string> = new Set(),
): Readonly<Record<string, string>> {
  const defaults: Record<string, string> = {}
  for (const column of columns) {
    const first = column.values[0]
    if (column.type === 'enum' && column.required && first !== undefined && !implied.has(column.name)) {
      defaults[column.name] = first
    }
  }
  return defaults
}

/**
 * **Why a new entry cannot be added yet, in one line** — M53 U3, D-518: the
 * first required column that holds nothing, said in the negative as the
 * mockup says it — "A task needs a title." — and nothing when every one holds.
 */
export function entryNeeds(
  one: string,
  columns: readonly { readonly name: string; readonly unit?: string | undefined; readonly required: boolean }[],
  holds: (name: string) => boolean,
): string | undefined {
  const missing = columns.find((column) => column.required && !holds(column.name))
  if (missing === undefined) return undefined
  const subject = withArticle(one.toLowerCase())
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} needs ${withArticle(entryLabel(missing))}.`
}

/** What the entry draws of a layout, and what its foot offers — `entryShown`. */
export interface EntryShown<C> {
  /** The line under the title — with the figures, when two or fewer sit in it. */
  readonly header: readonly C[]
  readonly figures: readonly C[]
  readonly texts: readonly C[]
  readonly links: readonly C[]
  /** The Empty line: every column not drawn and not hidden, in the view's order. */
  readonly empty: readonly C[]
  /** How many columns the view hides — "N hidden" — whether they hold a value or not. */
  readonly hidden: number
}

/**
 * **What an entry draws, and what it offers instead** — M53 U3, D-518, U1's
 * approved mockup (`docs/mockups/m53-u1/tasks.html`, its `entryBody`).
 *
 * A column is drawn when it holds a value, when it is required (and says it is
 * needed), when it was opened from the Empty line or is being typed in, and —
 * on a new entry — when the view asks for it (`asked`, U2's *New entry* tick).
 * A hidden column is not drawn even holding a value, unless "N hidden" was
 * pressed (`revealed`). Every other column is a name on the Empty line.
 *
 * **Two figures or fewer, with nothing claiming them as a grid** (`grid`: a
 * check under them, a worked-out figure beside them, or a way that needs the
 * room), sit in the line under the title rather than a part of their own — a
 * lone "3 h" no longer gets a section.
 */
export function entryShown<C extends { readonly name: string; readonly required: boolean }>(
  /** The columns in the view's order, which the Empty line keeps. */
  ordered: readonly C[],
  layout: EntryLayout<C>,
  ask: {
    readonly holds: (column: C) => boolean
    readonly hidden: (column: C) => boolean
    /** Opened from the Empty line, or being typed in: drawn until it is left empty. */
    readonly opened: ReadonlySet<string>
    /** On a new entry, the columns the view asks for; nothing on one that exists. */
    readonly asked: ReadonlySet<string> | undefined
    readonly revealed: boolean
    /** Whether the figures part is claimed as a grid, given the figures drawn. */
    readonly grid: (figures: readonly C[]) => boolean
  },
): EntryShown<C> {
  const drawn = (column: C): boolean =>
    ask.hidden(column)
      ? ask.revealed
      : ask.holds(column) ||
        column.required ||
        ask.opened.has(column.name) ||
        (ask.asked?.has(column.name) ?? false)
  const header = layout.header.filter(drawn)
  const figures = layout.figures.filter(drawn)
  const inLine = figures.length > 0 && figures.length <= 2 && !ask.grid(figures)
  const rest = ordered.filter((column) => column !== layout.title)
  return {
    // The line keeps the view's order: its own columns, then the figures.
    header: inLine ? [...header, ...figures] : header,
    figures: inLine ? [] : figures,
    texts: layout.texts.filter(drawn),
    links: layout.links.filter(drawn),
    empty: rest.filter((column) => !drawn(column) && !ask.hidden(column)),
    hidden: rest.filter(ask.hidden).length,
  }
}

/**
 * **A column moved within its part** (M53 U2): `part` is the names of one part
 * of the entry (`entryLayout`) in the view's order, and the column at `from` in
 * it goes to `to` in it. The part's columns keep the places in the whole order
 * they held between them, so the title and every other part stay where they
 * were — a text moved up never jumps above the title and becomes it.
 */
export function movedWithin(
  names: readonly string[],
  part: readonly string[],
  from: number,
  to: number,
): readonly string[] {
  const moved = movedTo(part, from, to)
  if (moved === part) return names
  const slots = new Set(part)
  let next = 0
  return names.map((name) => (slots.has(name) ? (moved[next++] ?? name) : name))
}

/** Names with the one at `from` moved to `to` — what a drag or a move button asks for. */
export function movedTo(names: readonly string[], from: number, to: number): readonly string[] {
  if (from === to || from < 0 || to < 0 || from >= names.length || to >= names.length) return names
  const next = [...names]
  const [taken] = next.splice(from, 1)
  if (taken === undefined) return names
  next.splice(to, 0, taken)
  return next
}

/**
 * **The roadmap and the page** — M27 U4, D-302.
 *
 * Two more kinds of the one thing, and both read links rather than lanes: the
 * roadmap is *rows of X in order, with the Ys that name each*, and the page is
 * *one row, with what it names and what names it*. Both are one hop (D-224):
 * a page shows the next step of a chain and never walks it, and a roadmap
 * folds the rows that name a row and not the rows that name those.
 *
 * Neither keeps anything but settings, so both re-render from the document on
 * every revision and hold no copy of their own — which is what M27 U6 needs of
 * the roadmap when a session moves a unit while it is open.
 */

/**
 * What a roadmap keeps, per column of the format it is set on:
 *
 * - `order` — the number column the rows run in. A format naming none runs by
 *   its first number column, so a roadmap needs nothing declared to exist.
 * - `under` — on a link column of *another* format: that format's rows fold
 *   under the row the link names. When no format says `under` toward a
 *   roadmap, every format linking to it folds, in the document's order.
 * - `line` — a column shown on a row's line after its name, on the roadmap's
 *   own rows and on the rows folded under them.
 */
export type RoadmapPart = 'order' | 'line' | 'under'

export function isRoadmapPart(word: string): word is RoadmapPart {
  return word === 'order' || word === 'line' || word === 'under'
}

/**
 * What a page kept, per column: `body` and `line`. **Retired by M35 U2**
 * (D-401): the page and the entry are one view, a body is the entry's
 * `markdown` and a line its `header`. The words are still read, so a document
 * that holds them opens; nothing draws them.
 */
export type PagePart = 'body' | 'line'

export function isPagePart(word: string): word is PagePart {
  return word === 'body' || word === 'line'
}

/** The part of a column a link view needs: a board's, and where a link points. */
export interface LinkViewColumn extends BoardColumn {
  readonly target?: string | undefined
}

/** The part of a format a link view needs: its name and its columns. */
export interface ViewFormat<C extends LinkViewColumn> {
  readonly name: string
  readonly columns: readonly C[]
}

/** Settings of one view kind, by format name: column name to its word. */
export type SettingsOf = (format: string) => ReadonlyMap<string, string>

const NUMBERS: ReadonlySet<string> = new Set(['integer', 'real', 'decimal'])

/** The columns a roadmap may run in: its number columns, the first of them by default. */
export function orderColumns<C extends BoardColumn>(columns: readonly C[]): readonly C[] {
  return columns.filter((column) => NUMBERS.has(column.type))
}

function isLink(type: string): boolean {
  return type === 'link' || type === 'links'
}

/** One link column of one format. */
export interface LinkPath<F, C> {
  readonly format: F
  readonly column: C
}

/**
 * Every link column, in any format, that names rows of `target` — in the
 * document's order of formats and then of columns. A format's own link to
 * itself is among them (a decision's `supersedes`).
 */
export function linksNaming<C extends LinkViewColumn, F extends ViewFormat<C>>(
  formats: readonly F[],
  target: string,
): readonly LinkPath<F, C>[] {
  return formats.flatMap((format) =>
    format.columns
      .filter((column) => isLink(column.type) && column.target === target)
      .map((column) => ({ format, column })),
  )
}

/** How one format's rows are drawn as a line: its name, its state (its first enum), and its `line` columns. */
/**
 * **The column a row is called by**: the first text column, or — for a format
 * with none, a timesheet's day — its first date or month (M33 F7). A day worked
 * is known by the day, and a row named by its id in another format's *Links
 * here* is a row nobody can read.
 */
export function nameColumnOf<C extends BoardColumn>(columns: readonly C[]): C | undefined {
  return (
    columns.find((column) => column.type === 'text') ??
    columns.find((column) => column.type === 'date' || column.type === 'month')
  )
}

export interface LineShape<C> {
  readonly name: C | undefined
  readonly state: C | undefined
  readonly lines: readonly C[]
}

/**
 * A format's rows as lines. The state is the first enum, as a board's lanes
 * default to; the lines are the columns saying `line`, leaving out the name,
 * the state, and whatever the view already shows another way.
 */
export function lineShapeOf<C extends BoardColumn>(
  columns: readonly C[],
  settings: ReadonlyMap<string, string>,
  leaving: readonly C[] = [],
): LineShape<C> {
  const name = nameColumnOf(columns)
  const state = columns.find((column) => column.type === 'enum')
  return {
    name,
    state,
    lines: columns.filter(
      (column) =>
        column !== name && column !== state && !leaving.includes(column) && settings.get(column.name) === 'line',
    ),
  }
}

/** The rows folded under a roadmap's rows: one format, through one of its links. */
export interface Fold<F, C> extends LineShape<C> {
  readonly format: F
  readonly through: C
}

/** What a roadmap draws. */
export interface RoadmapShape<F, C> extends LineShape<C> {
  readonly order: C
  readonly folds: readonly Fold<F, C>[]
}

/**
 * The roadmap a format draws, or nothing when it has no number to run in or
 * nothing names its rows — a roadmap with nothing under it is the sheet,
 * sorted. A format's link to itself never folds: a row drawn under a row of
 * its own list is a chain, and a chain is the page's to show one step of.
 */
export function roadmapOf<C extends LinkViewColumn, F extends ViewFormat<C>>(
  format: F,
  formats: readonly F[],
  settings: SettingsOf,
): RoadmapShape<F, C> | undefined {
  const own = settings(format.name)
  const numbers = orderColumns(format.columns)
  const order = numbers.find((column) => own.get(column.name) === 'order') ?? numbers[0]
  if (order === undefined) return undefined
  const naming = linksNaming<C, F>(formats, format.name).filter((each) => each.format.name !== format.name)
  const said = naming.filter((each) => settings(each.format.name).get(each.column.name) === 'under')
  const folds = (said.length > 0 ? said : naming).map(({ format: child, column }) => ({
    format: child,
    through: column,
    ...lineShapeOf(child.columns, settings(child.name), [column]),
  }))
  if (folds.length === 0) return undefined
  return { order, folds, ...lineShapeOf(format.columns, own, [order]) }
}

/**
 * Rows in a roadmap's order: by the number, rows with none last, ties by name
 * the way a person counts.
 */
export function inRoadmapOrder<R>(
  rows: readonly R[],
  numberOf: (row: R) => number | undefined,
  nameOf: (row: R) => string,
): readonly R[] {
  return [...rows].sort((a, b) => {
    const x = numberOf(a)
    const y = numberOf(b)
    if (x !== y) {
      if (x === undefined) return 1
      if (y === undefined) return -1
      return x - y
    }
    return byName(nameOf(a), nameOf(b))
  })
}

/** Names compared as a person counts them: `M27 U2` before `M27 U10`. */
export function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Folded rows grouped under the row each names, in name order. A row naming
 * none of the roadmap's rows is kept apart rather than dropped, so a roadmap
 * never draws fewer rows than its formats hold.
 */
export function foldUnder<R>(
  roots: ReadonlySet<string>,
  rows: readonly R[],
  idsOf: (row: R) => readonly string[],
  nameOf: (row: R) => string,
): { readonly under: ReadonlyMap<string, readonly R[]>; readonly loose: readonly R[] } {
  const under = new Map<string, R[]>()
  const loose: R[] = []
  for (const row of [...rows].sort((a, b) => byName(nameOf(a), nameOf(b)))) {
    const named = idsOf(row).filter((id) => roots.has(id))
    if (named.length === 0) loose.push(row)
    for (const id of named) under.set(id, [...(under.get(id) ?? []), row])
  }
  return { under, loose }
}

/**
 * **What is ready** — M27 U5, D-303.
 *
 * The rows of one format that are waiting to be started and wait on nothing
 * still open: a unit `planned` whose `blocks` names only units that are built
 * or dropped. A kind of view like the others, kept per column in
 * `format_view_column`, and three words:
 *
 * - `waits` — on a link (or links) column into the format's own rows: the rows
 *   this one waits on. A format naming none waits through its first such link.
 * - `ready <members> done <members>` — on an enum: the members a row is ready
 *   *from*, and the members that mean a row no longer holds anything up.
 *   Written rather than guessed, because nothing in `planned, built, dropped`
 *   says that `dropped` is finished — and a member added later (`in_progress`)
 *   holds a row up until somebody says it does not, which is the safe way round.
 * - `line` — a column shown on a row's line, as a roadmap's are.
 * - `stalls <days>` — on a date (M51 F4): when a row was taken. A row in a
 *   member that is neither ready nor done — being worked — whose date is more
 *   than that many days ago, or that has none, is listed as stalled: a session
 *   that died leaves its unit `in_progress` for ever, and nothing else says so.
 *
 * **A row named that is not there holds a row up**: a link to a missing row is
 * refused at the write, so one found here is a document somebody edited by hand,
 * and a row it holds up is shown as held rather than quietly ready.
 */
export interface ReadyState {
  readonly ready: readonly string[]
  readonly done: readonly string[]
}

/** `ready planned done built dropped` into its two lists — or nothing, when it is not one. */
export function readReadyState(setting: string): ReadyState | undefined {
  const words = setting.split(/[\s,]+/).filter((word) => word !== '')
  const split = words.indexOf('done')
  if (words[0] !== 'ready' || split < 2 || split === words.length - 1) return undefined
  const ready = words.slice(1, split)
  const done = words.slice(split + 1)
  if ([...ready, ...done].some((word) => word === 'ready' || word === 'done')) return undefined
  if (ready.some((word) => done.includes(word))) return undefined
  return { ready, done }
}

/** The most days a `stalls` waits — a year; a claim older than that is stalled by any measure. */
export const STALLS_MAX = 365

/** `stalls 1` into its days — or nothing, when it is not one. */
export function readStalls(setting: string): number | undefined {
  const [word, value, ...rest] = setting.trim().split(/\s+/)
  if (word !== 'stalls' || value === undefined || rest.length > 0 || !/^\d+$/.test(value)) return undefined
  const days = Number(value)
  return days >= 1 && days <= STALLS_MAX ? days : undefined
}

/** What a ready view draws. */
export interface ReadyShape<C> extends LineShape<C> {
  readonly state: C
  readonly waits: C
  readonly members: ReadyState
  /** The date a row was taken on, and how many days past it a row being worked is stalled. */
  readonly stalls: { readonly column: C; readonly days: number } | undefined
}

/**
 * The ready view a format draws, or nothing: it needs an enum that says which
 * members are ready and which are done, and a link into its own rows to wait
 * through. Members the enum does not have are left out, and a setting left with
 * none is no setting — so an enum whose members changed under a view falls back
 * to no view rather than to a list of rows nothing can be in.
 */
export function readyOf<C extends LinkViewColumn>(
  format: ViewFormat<C>,
  settings: ReadonlyMap<string, string>,
): ReadyShape<C> | undefined {
  let found: { state: C; members: ReadyState } | undefined
  for (const column of format.columns) {
    if (column.type !== 'enum' || found !== undefined) continue
    const written = readReadyState(settings.get(column.name) ?? '')
    if (written === undefined) continue
    const values = column.values ?? []
    const members = {
      ready: written.ready.filter((each) => values.includes(each)),
      done: written.done.filter((each) => values.includes(each)),
    }
    if (members.ready.length > 0 && members.done.length > 0) found = { state: column, members }
  }
  if (found === undefined) return undefined
  const own = format.columns.filter((column) => isLink(column.type) && column.target === format.name)
  const waits = own.find((column) => settings.get(column.name) === 'waits') ?? own[0]
  if (waits === undefined) return undefined
  const line = lineShapeOf(format.columns, settings, [found.state, waits])
  const dated = format.columns.find((column) => column.type === 'date' && readStalls(settings.get(column.name) ?? '') !== undefined)
  const days = dated === undefined ? undefined : readStalls(settings.get(dated.name) ?? '')
  const stalls = dated === undefined || days === undefined ? undefined : { column: dated, days }
  return { ...line, state: found.state, waits, members: found.members, stalls }
}

/** Whole days from one ISO date to another, or nothing when either is not one. */
function daysBetween(from: string, to: string): number | undefined {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? undefined : Math.round((b - a) / 86_400_000)
}

/**
 * The rows being worked — in a member neither ready nor done — whose date is
 * more than `days` before `today`, or missing, in name order (M51 F4). A row
 * with no date is stalled: nobody can say it is not, and the date is the only
 * thing that would.
 */
export function stalledRows<R>(
  rows: readonly R[],
  members: ReadyState,
  days: number,
  today: string,
  stateOf: (row: R) => string | undefined,
  dateOf: (row: R) => string | undefined,
  nameOf: (row: R) => string,
): readonly R[] {
  return rows
    .filter((row) => {
      const state = stateOf(row)
      if (state === undefined || members.ready.includes(state) || members.done.includes(state)) return false
      const date = dateOf(row)
      const since = date === undefined ? undefined : daysBetween(date, today)
      return since === undefined || since > days
    })
    .sort((a, b) => byName(nameOf(a), nameOf(b)))
}

/** A row that would be ready but for the rows it waits on that are still open. */
export interface Held<R> {
  readonly row: R
  /** The rows holding it up, by id, in the order its link names them. */
  readonly by: readonly string[]
}

/**
 * The rows in a ready member split into those that wait on nothing open and
 * those held, each in name order. **A row naming itself holds itself up** — it
 * cannot be written (`selfLinks`), and one that was, by hand, is shown held by
 * itself rather than read as ready.
 */
export function readyRows<R>(
  rows: readonly R[],
  members: ReadyState,
  idOf: (row: R) => string,
  stateOf: (row: R) => string | undefined,
  waitsOn: (row: R) => readonly string[],
  nameOf: (row: R) => string,
): { readonly ready: readonly R[]; readonly held: readonly Held<R>[] } {
  const byId = new Map(rows.map((row) => [idOf(row), row]))
  const open = (id: string): boolean => {
    const row = byId.get(id)
    if (row === undefined) return true
    const state = stateOf(row)
    return state === undefined || !members.done.includes(state)
  }
  const ready: R[] = []
  const held: Held<R>[] = []
  const candidates = rows
    .filter((row) => {
      const state = stateOf(row)
      return state !== undefined && members.ready.includes(state)
    })
    .sort((a, b) => byName(nameOf(a), nameOf(b)))
  for (const row of candidates) {
    const by = waitsOn(row).filter(open)
    if (by.length === 0) ready.push(row)
    else held.push({ row, by })
  }
  return { ready, held }
}

/**
 * **Where a conversation starts** — M27 U5, D-303.
 *
 * A `start` view is one question a pack wants answered first about one of its
 * formats, and `start_here` answers every one a document declares in a call.
 * Kept like the other views, and three words:
 *
 * - `is <member>` — on an enum: only rows at that member (`state: is open`);
 *   on a boolean, `is true` or `is false` (`is_confirmed: is false`, M36 U06) —
 *   an empty boolean is neither, so a row nobody answered is not counted as no.
 * - `latest <count>` — on a date, a month or a number: that many rows, the
 *   latest first.
 * - `line` — a column shown on a row's line.
 *
 * It is a question and not a query: a filter of one member and a count, over
 * one format, and nothing to join — the plugin's rule (D-095) is that there is
 * no general query, and this is not one by construction.
 */
export type StartSetting =
  | { readonly kind: 'is'; readonly member: string }
  | { readonly kind: 'latest'; readonly count: number }

/** The most rows a `latest` asks for — a start-here answer is read whole, every session. */
export const LATEST_MAX = 50

export function readStartSetting(setting: string): StartSetting | undefined {
  const [word, value, ...rest] = setting.trim().split(/\s+/)
  if (rest.length > 0 || value === undefined) return undefined
  if (word === 'is') return { kind: 'is', member: value }
  if (word === 'latest' && /^\d+$/.test(value)) {
    const count = Number(value)
    return count >= 1 && count <= LATEST_MAX ? { kind: 'latest', count } : undefined
  }
  return undefined
}

const ORDERED: ReadonlySet<string> = new Set(['date', 'month', 'integer', 'real', 'decimal', 'percent', 'time'])

/** What a start view asks of its format. */
export interface StartShape<C> extends LineShape<C> {
  /** Enum columns and the member each must be at. */
  readonly is: readonly { readonly column: C; readonly member: string }[]
  /** The column the latest rows are counted by, and how many. */
  readonly latest: { readonly column: C; readonly count: number } | undefined
}

/**
 * The start view a format declares, or nothing when it declares none. An `is`
 * naming a member its enum has not got, or a `latest` on a column that has no
 * order, is left out rather than trusted — a question about a member nobody can
 * be in would answer *none* and mean nothing.
 */
export function startOf<C extends BoardColumn>(
  columns: readonly C[],
  settings: ReadonlyMap<string, string>,
): StartShape<C> | undefined {
  if (settings.size === 0) return undefined
  const is: { column: C; member: string }[] = []
  let latest: { column: C; count: number } | undefined
  for (const column of columns) {
    const setting = readStartSetting(settings.get(column.name) ?? '')
    if (setting?.kind === 'is' && isMemberOf(column, setting.member)) {
      is.push({ column, member: setting.member })
    }
    if (setting?.kind === 'latest' && ORDERED.has(column.type) && latest === undefined) {
      latest = { column, count: setting.count }
    }
  }
  const asked = [...is.map((each) => each.column), ...(latest === undefined ? [] : [latest.column])]
  const line = lineShapeOf(columns, settings, asked)
  if (asked.length === 0 && line.lines.length === 0) return undefined
  return { ...line, is, latest }
}

/** Whether `is <member>` asks something of this column: a member its enum has, or `true`/`false` of a boolean. */
function isMemberOf(column: BoardColumn, member: string): boolean {
  if (column.type === 'boolean') return member === 'true' || member === 'false'
  return column.type === 'enum' && (column.values ?? []).includes(member)
}

/** One question a document's views answer first: what it asks, and the call that lists it whole. */
export interface StartQuestion {
  readonly format: string
  readonly kind: 'ready' | 'start'
  /** What the answer is, in a line: `state is open`, `the 5 latest by date`. */
  readonly what: string
  /** The `format_rows` call that lists the same rows whole, or nothing when only `start_here` can. */
  readonly call: string | undefined
}

/**
 * The questions a set of formats and their views asks, **ready views first**
 * (what to do next is the question a session opens with), then every start view
 * in the order of the formats' names. What `start_here` answers and what
 * `CLAUDE.md`'s *Ask the document* table is written from — one list, so the
 * table cannot say a thing the tool does not do.
 */
export function startQuestions<C extends LinkViewColumn, F extends ViewFormat<C>>(
  formats: readonly F[],
  ready: SettingsOf,
  start: SettingsOf,
): readonly StartQuestion[] {
  const sorted = [...formats].sort((a, b) => byName(a.name, b.name))
  const readies = sorted.flatMap((format): StartQuestion[] => {
    const shape = readyOf(format, ready(format.name))
    if (shape === undefined) return []
    return [
      {
        format: format.name,
        kind: 'ready',
        what:
          `${shape.state.name} is ${shape.members.ready.join(' or ')}, and nothing in ${shape.waits.name} ` +
          `is still open (open is anything but ${shape.members.done.join(' or ')})`,
        call: undefined,
      },
    ]
  })
  const starts = sorted.flatMap((format): StartQuestion[] => {
    const shape = startOf(format.columns, start(format.name))
    if (shape === undefined) return []
    const latest = shape.latest
    const what = [
      ...(latest === undefined ? [] : [`the ${String(latest.count)} latest by ${latest.column.name}`]),
      ...shape.is.map((each) => `${each.column.name} is ${each.member}`),
    ].join(', ')
    const match =
      shape.is.length === 0
        ? ''
        : ` match:{${shape.is.map((each) => `${each.column.name}:${each.member}`).join(', ')}}`
    const order =
      latest === undefined ? '' : ` order:${latest.column.name} descending:true limit:${String(latest.count)}`
    return [
      {
        format: format.name,
        kind: 'start',
        what: what === '' ? 'every row' : what,
        call: `format_rows ${format.name}${match}${order}`,
      },
    ]
  })
  return [...readies, ...starts]
}

/**
 * **The one unit a quantity column is shown in** when it is shown *in one
 * unit* (D-402): the unit the column declares, if it does; otherwise the unit
 * most of its rows are in, the first seen on a tie — so a column measured in
 * hours reads in hours, and the odd row in minutes is converted to them.
 */
export function oneUnitOf(declared: string | undefined, units: readonly string[]): string | undefined {
  if (declared !== undefined && declared !== '') return declared
  const counts = new Map<string, number>()
  for (const unit of units) {
    if (unit !== '') counts.set(unit, (counts.get(unit) ?? 0) + 1)
  }
  let best: string | undefined
  let most = 0
  for (const [unit, count] of counts) {
    if (count > most) {
      best = unit
      most = count
    }
  }
  return best
}

const DAY_WORDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** `2026-10-09` as days from the epoch, or nothing when it is not a date. */
function dayCount(date: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (parts === null) return undefined
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const count = Date.UTC(year, month - 1, day) / 86_400_000
  return Number.isInteger(count) ? count : undefined
}

/** `2026-10` as months from year zero, or nothing when it is not a month. */
function monthCount(month: string): number | undefined {
  const period = parseYearMonth(month)
  return period === undefined ? undefined : period.year * 12 + period.month - 1
}

/** A date as the entry's *Date* reads it — `Fri 9 Oct 2026` — or the text as it came. */
export function dayText(date: string): string {
  const count = dayCount(date)
  const day = parseISODate(date)
  if (count === undefined || day === undefined) return date
  const weekday = DAY_WORDS[(((count + 4) % 7) + 7) % 7] ?? ''
  return `${weekday} ${formatDayMonth(day)} ${String(day.year)}`
}

/** A month as the entry's *Month* reads it — `Oct 2026` — or the text as it came. */
export function monthText(month: string): string {
  const period = parseYearMonth(month)
  return period === undefined ? month : formatMonthShort(period)
}

/**
 * A date against today, as a person says it: `today`, `tomorrow`, `in 3 days`,
 * `2 weeks ago`, `in 4 months`. Nothing when either is not a date. Today is an
 * argument: nothing in `domain/` reads the clock.
 */
export function relativeDay(date: string, today: string): string | undefined {
  const then = dayCount(date)
  const now = dayCount(today)
  if (then === undefined || now === undefined) return undefined
  const days = then - now
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  const span = Math.abs(days)
  const said =
    span < 14
      ? `${String(span)} days`
      : span < 60
        ? `${String(Math.round(span / 7))} weeks`
        : span < 730
          ? `${String(Math.round(span / 30.44))} months`
          : `${String(Math.round(span / 365.25))} years`
  return days > 0 ? `in ${said}` : `${said} ago`
}

/** A month against today's: `this month`, `next month`, `3 months ago`. */
export function relativeMonth(month: string, today: string): string | undefined {
  const then = monthCount(month)
  const now = monthCount(today.slice(0, 7))
  if (then === undefined || now === undefined) return undefined
  const months = then - now
  if (months === 0) return 'this month'
  if (months === 1) return 'next month'
  if (months === -1) return 'last month'
  const span = Math.abs(months)
  const said = span < 24 ? `${String(span)} months` : `${String(Math.round(span / 12))} years`
  return months > 0 ? `in ${said}` : `${said} ago`
}

/**
 * **The agenda** — M49 U3, D-473.
 *
 * Every format the document holds that has a date, its rows on one list of
 * days from today, and — where a format says what finished is — the rows it
 * still owes above today, overdue. It is the step beyond a calendar per format
 * (M32 U7's candidate): a study planner's assignments, exams and study
 * blocks are three formats and one week, and a person reads them as one.
 *
 * A view like the others — kept per column in `format_view_column`, read on
 * every revision, holding nothing of its own — and three words:
 *
 * - `date` — on a date column: the day a row is on the agenda by. A format
 *   naming none is on it by its first date column, so the agenda needs nothing
 *   declared to exist; **a format with no date column is not on it**.
 * - `done <members>` — on the state's enum (`done handed_in dropped`), or
 *   `done true` on a boolean: what finished is. **Only then is anything before
 *   today drawn**: a date in the past is when a thing happened unless the format
 *   says it was owed, and a row owed and not finished is overdue.
 * - `line` — a column shown on a row's line, as everywhere.
 *
 * Today is an argument, as everywhere in `domain/` (D-472): a question may read
 * the clock, and the agenda is a question.
 */
export type AgendaPart = 'date' | 'line'

/**
 * `done handed_in dropped` into its members — or nothing, when it is not one.
 * Only the first word is the keyword, so a member may be called `done` itself
 * (`done done dropped`), and commas between members read as spaces (M42 F11).
 */
export function readAgendaDone(setting: string): readonly string[] | undefined {
  const [word, ...members] = setting.split(/[\s,]+/).filter((each) => each !== '')
  if (word !== 'done' || members.length === 0) return undefined
  return [...new Set(members)]
}

/** What one format puts on the agenda. */
export interface AgendaShape<C> extends LineShape<C> {
  /** The date a row is on the agenda by. */
  readonly date: C
  /** Whether the format's views chose it — not merely its first date — which `start_here` asks only of. */
  readonly chosen: boolean
  /** The column that says a row is finished, and the members that say it — or nothing, and nothing is overdue. */
  readonly done: { readonly column: C; readonly members: readonly string[] } | undefined
}

/**
 * The agenda a format is on, or nothing when it has no date. A `date` on a
 * column that is not one, or a `done` naming members its column has not got,
 * is left out rather than trusted, as the other views leave theirs.
 */
export function agendaOf<C extends BoardColumn>(
  columns: readonly C[],
  settings: ReadonlyMap<string, string>,
): AgendaShape<C> | undefined {
  const dates = columns.filter((column) => column.type === 'date')
  const chosen = dates.find((column) => settings.get(column.name) === 'date')
  const date = chosen ?? dates[0]
  if (date === undefined) return undefined
  let done: { column: C; members: readonly string[] } | undefined
  for (const column of columns) {
    const members = readAgendaDone(settings.get(column.name) ?? '')
    if (members === undefined || done !== undefined) continue
    const kept = members.filter((member) => isMemberOf(column, member))
    if (kept.length > 0) done = { column, members: kept }
  }
  const line = lineShapeOf(columns, settings, [date])
  return { ...line, date, chosen: chosen !== undefined, done }
}

/** One day of the agenda and the rows on it. */
export interface AgendaDay<R> {
  readonly date: string
  readonly rows: readonly R[]
}

/**
 * Rows into days, earliest first; within a day by `tie` — the format's place
 * in the document, then the row's name — so a day reads the same on every
 * render. A row whose date is not a day is left out: it is on no day.
 */
export function agendaDays<R>(
  rows: readonly R[],
  dateOf: (row: R) => string | undefined,
  tie: (a: R, b: R) => number,
): readonly AgendaDay<R>[] {
  const days = new Map<string, R[]>()
  for (const row of rows) {
    const date = dateOf(row)
    if (date === undefined || dayCount(date) === undefined) continue
    const day = days.get(date)
    if (day === undefined) days.set(date, [row])
    else day.push(row)
  }
  return [...days.keys()].sort().map((date) => ({ date, rows: [...(days.get(date) ?? [])].sort(tie) }))
}

/**
 * The window a filter's own and the agenda's meet in — both ends taken, ISO
 * days comparing as text — or nothing when they do not meet at all.
 */
export function meetWindows(
  a: { readonly from?: string | undefined; readonly through?: string | undefined },
  b: { readonly from?: string | undefined; readonly through?: string | undefined },
): { readonly from?: string | undefined; readonly through?: string | undefined } | undefined {
  const from = a.from === undefined ? b.from : b.from === undefined ? a.from : a.from > b.from ? a.from : b.from
  const through =
    a.through === undefined ? b.through : b.through === undefined ? a.through : a.through < b.through ? a.through : b.through
  if (from !== undefined && through !== undefined && from > through) return undefined
  return { from, through }
}


/**
 * **The list** — M53 U4, D-519, from U1's approved mockup
 * (`docs/mockups/m53-u1/tasks.html`).
 *
 * Any format's rows as one line each: a tick, the name, and the line's
 * columns — grouped by one column, its ticked rows folded at each group's
 * foot. A view like the others, kept per column in `format_view_column`, and
 * three words a column may hold **together**, as the entry's do, because one
 * column can be both what the list groups by and on its line:
 *
 * - `group` — on an enum (a group per member), a link (a group per row it may
 *   name, in that format's order, then *No …*) or a date (Late, Today,
 *   Tomorrow, In the next 7 days, Later, No … date). None by default.
 * - `line` — a column after the name. Nobody choosing gives the default line:
 *   the first list of members, the first link and the first date (*tags,
 *   project, due*), a date always last because it is read right-aligned.
 * - `done <members>` — last, as the agenda's: what ticks a row, an enum's
 *   members or `done true` on a boolean. **Nobody choosing gives no tick**
 *   (M53 F1, D-524, amending D-519's guess of the first enum's last member):
 *   a list ticks only where a person, a conversation or a pack's `views.md`
 *   said what done is, and is plain lines everywhere else.
 *
 * Ticking writes the first `done` member; unticking the member the row held
 * before, else the first that is not done (`tickValue`). Today is an argument.
 */
export interface ListSetting {
  readonly group: boolean
  readonly line: boolean
  readonly done?: readonly string[] | undefined
}

/** `group line done finished dropped` into its words — or nothing, when it is not a list's setting. */
export function readListSetting(setting: string): ListSetting | undefined {
  const words = setting.split(/[\s,]+/).filter((each) => each !== '')
  if (words.length === 0) return undefined
  let group = false
  let line = false
  for (let at = 0; at < words.length; at++) {
    const word = words[at]
    if (word === 'done') {
      const members = [...new Set(words.slice(at + 1))]
      return members.length === 0 ? undefined : { group, line, done: members }
    }
    if (word === 'group' && !group) group = true
    else if (word === 'line' && !line) line = true
    else return undefined
  }
  return { group, line }
}

/** A list's setting as the table keeps it, or nothing when it holds no word. */
export function writeListSetting(setting: ListSetting): string | undefined {
  const words = [
    ...(setting.group ? ['group'] : []),
    ...(setting.line ? ['line'] : []),
    ...(setting.done !== undefined && setting.done.length > 0 ? ['done', ...setting.done] : []),
  ]
  return words.length === 0 ? undefined : words.join(' ')
}

/** Whether a list may group by this column: an enum, one link, or a date. */
export function listGroupable(column: BoardColumn): boolean {
  return column.type === 'enum' || column.type === 'link' || column.type === 'date'
}

/** What a list draws of a format. */
export interface ListShape<C> {
  readonly name: C | undefined
  /** The column the groups come from, or nothing for one list. */
  readonly group: C | undefined
  /** What ticks a row, as a setting said it — or nothing, and there is no tick (D-524). */
  readonly done: { readonly column: C; readonly members: readonly string[] } | undefined
  /** The line's columns, as chosen or by default — the group's among them. */
  readonly lines: readonly C[]
  /** Whether a setting chose the line rather than the default. */
  readonly lineChosen: boolean
  /** The line as drawn: without the column the rows are grouped by, a date last. */
  readonly shown: readonly C[]
  /** The date rows are in the order of within a group: the line's first date, else the format's. */
  readonly due: C | undefined
}

/** The list a format draws. Every format has one; a word its column cannot hold is left out, as the other views leave theirs. */
export function listOf<C extends BoardColumn>(columns: readonly C[], settings: ReadonlyMap<string, string>): ListShape<C> {
  const name = nameColumnOf(columns)
  const read = (column: C): ListSetting | undefined => readListSetting(settings.get(column.name) ?? '')
  const group = columns.find((column) => read(column)?.group === true && listGroupable(column))
  let done: { column: C; members: readonly string[] } | undefined
  for (const column of columns) {
    const members = read(column)?.done
    if (members === undefined || done !== undefined) continue
    const kept = members.filter((member) => isMemberOf(column, member))
    if (kept.length > 0 && (column.type !== 'boolean' || kept.length === 1)) done = { column, members: kept }
  }
  const chosen = columns.filter((column) => column !== name && read(column)?.line === true)
  const fallback = [
    columns.find((column) => column.type === 'enums'),
    columns.find((column) => column.type === 'link'),
    columns.find((column) => column.type === 'date'),
  ].filter((column): column is C => column !== undefined && column !== name && column !== done?.column)
  const picked = chosen.length > 0 ? chosen : fallback
  const isDate = (column: C): boolean => column.type === 'date'
  const lines = [...picked.filter((column) => !isDate(column)), ...picked.filter(isDate)]
  return {
    name,
    group,
    done,
    lines,
    lineChosen: chosen.length > 0,
    shown: lines.filter((column) => column !== group),
    due: lines.find(isDate) ?? columns.find(isDate),
  }
}

/** Whether a row holding this value is ticked. */
export function isTicked(done: { readonly members: readonly string[] } | undefined, value: string | undefined): boolean {
  return done !== undefined && value !== undefined && done.members.includes(value)
}

/**
 * **What a tick writes** (the mockup's (d)): the first done member, or `true`;
 * and an untick the member the row held before the tick, else the first member
 * that is not done — or `false` on a boolean.
 */
export function tickValue(
  done: { readonly column: BoardColumn; readonly members: readonly string[] },
  ticking: boolean,
  before?: string,
): string {
  if (ticking) return done.members[0] ?? 'true'
  if (done.column.type === 'boolean') return 'false'
  const values = done.column.values ?? []
  if (before !== undefined && values.includes(before) && !done.members.includes(before)) return before
  return values.find((each) => !done.members.includes(each)) ?? values[0] ?? ''
}

/** A column's member as a person reads it: `in_progress` as *in progress*, a boolean's `true` as *yes*. */
function memberWords(column: BoardColumn, member: string): string {
  if (column.type === 'boolean') return member === 'true' ? 'yes' : 'no'
  return member.replace(/_/g, ' ')
}

/**
 * **What a tick says it sets** — M53 F1, D-524: the list's header (*Ticking
 * marks state done*), and a circle's hover and accessible name — *Mark done*
 * on an open row, *Undo: back to open* on a ticked one, naming the member an
 * untick writes (`tickValue`, from what the row held when it is known).
 */
export function tickWords(
  done: { readonly column: BoardColumn; readonly members: readonly string[] },
  before?: string,
): { readonly header: string; readonly mark: string; readonly undo: string } {
  const column = done.column.name.replace(/_/g, ' ')
  const on = memberWords(done.column, tickValue(done, true))
  const back = memberWords(done.column, tickValue(done, false, before))
  return done.column.type === 'boolean'
    ? { header: `Ticking marks ${column} ${on}`, mark: `Mark ${column} ${on}`, undo: `Undo: back to ${column} ${back}` }
    : { header: `Ticking marks ${column} ${on}`, mark: `Mark ${on}`, undo: `Undo: back to ${back}` }
}

/** Where a date falls against today, as the list groups by a date. */
export type DueBucket = 'late' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'

/** The bucket a date is in — `none` for no date, or text that is not one. */
export function dueBucket(date: string | undefined, today: string): DueBucket {
  const then = date === undefined ? undefined : dayCount(date)
  const now = dayCount(today)
  if (then === undefined || now === undefined) return 'none'
  const days = then - now
  return days < 0 ? 'late' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? 'week' : 'later'
}

/** The day so many days after this one, as ISO — or nothing when it is not a date. */
export function dayAfter(date: string, days: number): string | undefined {
  const count = dayCount(date)
  return count === undefined ? undefined : new Date((count + days) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * **A due as the list reads it** (the mockup's (b)): `today`, `tomorrow`,
 * `Sat, in 2 days` within a week, then `5 Nov` (with the year when it is not
 * this one). An open row before today is late — `yesterday`, `3 days late` —
 * the one thing on the line drawn in colour; a ticked one is only its date.
 */
export function dueText(
  date: string,
  today: string,
  ticked: boolean,
): { readonly text: string; readonly late: boolean } | undefined {
  const then = dayCount(date)
  const now = dayCount(today)
  const day = parseISODate(date)
  const year = parseISODate(today)?.year
  if (then === undefined || now === undefined || day === undefined) return undefined
  const days = then - now
  const short = day.year === year ? formatDayMonth(day) : `${formatDayMonth(day)} ${String(day.year)}`
  if (days < 0) {
    return ticked ? { text: short, late: false } : { text: days === -1 ? 'yesterday' : `${String(-days)} days late`, late: true }
  }
  if (days === 0) return { text: 'today', late: false }
  if (days === 1) return { text: 'tomorrow', late: false }
  if (days < 7) return { text: `${DAY_WORDS[(((then + 4) % 7) + 7) % 7] ?? ''}, in ${String(days)} days`, late: false }
  return { text: short, late: false }
}

/** One group of a list: its head, its rows, and the values a row added in it takes. */
export interface ListGroup<R> {
  readonly key: string
  /** The head's words; empty for the one group of a list not grouped. */
  readonly name: string
  /** An enum's member, for the head's dot. */
  readonly member?: string | undefined
  readonly rows: readonly R[]
  /**
   * What a row added here holds — the member, the link's row, the day — or
   * nothing when the group is not one value (Late, In the next 7 days, Later),
   * and so has no quick add.
   */
  readonly implies: Readonly<Record<string, string>> | undefined
  /** The group of ticked rows, last, when the list is grouped by what ticks a row. */
  readonly ticked: boolean
}

const DATE_GROUPS: readonly { readonly bucket: DueBucket; readonly name: string; readonly days?: number }[] = [
  { bucket: 'late', name: 'Late' },
  { bucket: 'today', name: 'Today', days: 0 },
  { bucket: 'tomorrow', name: 'Tomorrow', days: 1 },
  { bucket: 'week', name: 'In the next 7 days' },
  { bucket: 'later', name: 'Later' },
]

/**
 * The rows into the list's groups (the mockup's (c)). An enum's members in
 * their order — the done ones last when they are what ticks a row — then the
 * rows with none, when there are some; a link's rows in `targets`' order, then
 * *No …*; a date's buckets, a bucket that is not one value left out while it
 * holds nothing. Ungrouped, one group holding every row.
 */
export function listGroups<C extends BoardColumn, R>(
  shape: ListShape<C>,
  rows: readonly R[],
  valueOf: (row: R, column: C) => string | undefined,
  today: string,
  targets: readonly { readonly id: string; readonly name: string }[] = [],
): readonly ListGroup<R>[] {
  const column = shape.group
  if (column === undefined) return [{ key: 'all', name: '', rows, implies: {}, ticked: false }]
  const label = column.name.replace(/_/g, ' ')
  const of = (row: R): string | undefined => {
    const value = valueOf(row, column)
    return value === undefined || value === '' ? undefined : value
  }
  if (column.type === 'date') {
    const groups: ListGroup<R>[] = DATE_GROUPS.map((each) => {
      const day = each.days === undefined ? undefined : dayAfter(today, each.days)
      return {
        key: `date:${each.bucket}`,
        name: each.name,
        rows: rows.filter((row) => dueBucket(of(row), today) === each.bucket),
        implies: day === undefined ? undefined : { [column.name]: day },
        ticked: false,
      }
    })
    groups.push({
      key: 'date:none',
      name: /date$/i.test(label) ? `No ${label}` : `No ${label} date`,
      rows: rows.filter((row) => dueBucket(of(row), today) === 'none'),
      implies: {},
      ticked: false,
    })
    return groups.filter((group) => group.rows.length > 0 || group.implies !== undefined)
  }
  if (column.type === 'link') {
    const known = new Set(targets.map((each) => each.id))
    return [
      ...targets.map((target) => ({
        key: `link:${target.id}`,
        name: target.name,
        rows: rows.filter((row) => of(row) === target.id),
        implies: { [column.name]: target.id },
        ticked: false,
      })),
      {
        key: 'link:',
        name: `No ${label}`,
        rows: rows.filter((row) => {
          const value = of(row)
          return value === undefined || !known.has(value)
        }),
        implies: {},
        ticked: false,
      },
    ]
  }
  const members = column.values ?? []
  const ticks = shape.done?.column === column ? shape.done.members : []
  const ordered = [...members.filter((each) => !ticks.includes(each)), ...members.filter((each) => ticks.includes(each))]
  const groups: ListGroup<R>[] = ordered.map((member) => ({
    key: `member:${member}`,
    name: member.replace(/_/g, ' '),
    member,
    rows: rows.filter((row) => of(row) === member),
    implies: { [column.name]: member },
    ticked: ticks.includes(member),
  }))
  const none = rows.filter((row) => {
    const value = of(row)
    return value === undefined || !members.includes(value)
  })
  if (none.length === 0) return groups
  const at = groups.findIndex((group) => group.ticked)
  const loose: ListGroup<R> = { key: 'member:', name: `No ${label}`, rows: none, implies: {}, ticked: false }
  return at === -1 ? [...groups, loose] : [...groups.slice(0, at), loose, ...groups.slice(at)]
}

/** Rows earliest due first, the undated after, each tie in the order it came — the list's order within a group. */
export function inDueOrder<R>(rows: readonly R[], dueOf: (row: R) => string | undefined): readonly R[] {
  const keyed = rows.map((row, at) => ({ row, at, day: dayCount(dueOf(row) ?? '') }))
  keyed.sort((a, b) => {
    if (a.day !== b.day) return a.day === undefined ? 1 : b.day === undefined ? -1 : a.day - b.day
    return a.at - b.at
  })
  return keyed.map((each) => each.row)
}

/**
 * **A saved view** — M53 U5, D-514, D-520.
 *
 * A format's filter, order, columns and kind under a name: what a view's
 * address already holds (`?due=today&state!=done&order:due=ascending`), and
 * which of the format's views draws it, kept so a person can open it again from
 * the rail and a conversation can draw it by name. **Not a format**: a view is
 * how to look at the rows, never rows of its own (D-514).
 *
 * Its own table, `format_saved_view` (063), rather than more rows of
 * `format_view_column`: a view setting is one word of at most 32 characters
 * for one column, and an address is a sentence about the whole format.
 *
 * **The address is kept as it is spelled**, so a window around today stays the
 * phrase — `due=today`, `due=within+7+days` — and is worked out on the day it
 * is opened, never the day it was saved. What the spelling means is
 * `addressFilter.ts`'s, and what a filter means is `filterQuery`'s: this file
 * only keeps the words.
 *
 * Named per format: `task` / `Due today` is what a dashboard (M53 U7) points at.
 */
export const SAVED_KINDS = ['table', 'board', 'list', 'roadmap', 'ready'] as const

export type SavedKind = (typeof SAVED_KINDS)[number]

export interface SavedView {
  readonly format: string
  readonly name: string
  readonly kind: SavedKind
  /** The address's query as the address spells it — `?due=today` — or empty for every row. */
  readonly address: string
}

/** The longest name a saved view takes — `063_saved_view`'s CHECK. */
export const SAVED_NAME_LONGEST = 60

/** The longest address a saved view keeps — `063_saved_view`'s CHECK. */
export const SAVED_ADDRESS_LONGEST = 2000

export function isSavedKind(word: string): word is SavedKind {
  return (SAVED_KINDS as readonly string[]).includes(word)
}

/**
 * Why a name cannot be a saved view's, or nothing. A name is said in a
 * sentence and drawn in the rail, so it is one line, and it never opens with a
 * `?` — a model passing an address where a name goes is told so rather than
 * keeping a view called `?state=open`. A view kind's own word is the view
 * itself (`show_format view:list`), so it cannot be a saved view's name too.
 */
export function savedNameRefusal(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed === '') return 'A saved view needs a name.'
  if (trimmed !== name) return 'A saved view’s name does not start or end with a space.'
  if (/[\r\n]/.test(name)) return 'A saved view’s name is one line.'
  if (name.length > SAVED_NAME_LONGEST) return `A saved view’s name is at most ${String(SAVED_NAME_LONGEST)} characters.`
  if (name.startsWith('?')) return 'A saved view’s name is words, not an address.'
  const word = name.toLowerCase()
  if (isSavedKind(word) || word === 'sheet' || word === 'agenda' || word === 'entry' || word === DASHBOARD_VIEW) {
    return `${name} is a view’s own name; a saved view is called something else.`
  }
  return undefined
}

/** An address as a saved view keeps it: empty, or the query with its `?`. */
export function savedAddress(address: string): string {
  const trimmed = address.trim()
  if (trimmed === '' || trimmed === '?') return ''
  return trimmed.startsWith('?') ? trimmed : `?${trimmed}`
}

/**
 * **A dashboard** — M53 U7, D-514, D-521.
 *
 * An ordered set of blocks and nothing else: a saved view drawn compact in its
 * kind, a rollup's chart, or a headline total — a count of a format's rows, or
 * the sum of one of its number or money columns, under a filter as
 * `format_rows` takes it. **Never a free block** (D-514): no text, no embed.
 * One per format (`dashboard` is its name) and one for the document
 * (`dashboard` absent), whose blocks may read any format. Not a format, and
 * presentation, so never the declaration.
 *
 * Kept in `format_dashboard_block` (064), a row per block in its order; a text
 * document writes each under `### <format> dashboard` in its views part, the
 * document's under `### Document dashboard`. A saved view and a rollup are
 * pointed at by name; a headline total lives only on its dashboard, so its
 * figure, column and filter are the block's own.
 */
export const BLOCK_KINDS = ['saved', 'rollup', 'total'] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]

export interface DashboardBlock {
  /** The format whose dashboard it is on, or absent for the document's. */
  readonly dashboard: string | undefined
  /** The format the block reads — always its dashboard's, on a format's. */
  readonly format: string
  readonly kind: BlockKind
  /** The saved view's name, the rollup's, or the headline total's own. */
  readonly name: string
  /** A headline total's column summed; absent is a count of the rows. */
  readonly sum?: string | undefined
  /** A headline total's filter as the address spells it (`?state!=done`), or empty for every row. */
  readonly address: string
}

/** The word `show_format` and `arrange_views` take for a dashboard, and a format's route ends in. */
export const DASHBOARD_VIEW = 'dashboard'

/** Its heading's first word in a text document's views part for the document's own: no format is capitalised. */
export const DOCUMENT_DASHBOARD = 'Document'

/** The longest name a block takes — `064_dashboard_block`'s CHECK, as a saved view's. */
export const BLOCK_NAME_LONGEST = 60

export function isBlockKind(word: string): word is BlockKind {
  return (BLOCK_KINDS as readonly string[]).includes(word)
}

/** Why a name cannot be a headline total's, or nothing — one line, trimmed, at most 60 characters. */
export function totalNameRefusal(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed === '') return 'A headline total needs a name.'
  if (trimmed !== name) return 'A headline total’s name does not start or end with a space.'
  if (/[\r\n]/.test(name)) return 'A headline total’s name is one line.'
  if (name.length > BLOCK_NAME_LONGEST) return `A headline total’s name is at most ${String(BLOCK_NAME_LONGEST)} characters.`
  return undefined
}

/** Whether two blocks are one: the same format's thing under the same name. */
export function sameBlock(a: Pick<DashboardBlock, 'format' | 'name'>, b: Pick<DashboardBlock, 'format' | 'name'>): boolean {
  return a.format === b.format && a.name === b.name
}

/**
 * **A block named in a sentence** — a conversation's `order` and `remove`:
 * its name, or `<format>/<name>` where two formats' blocks on the document's
 * dashboard share one. The block, or why none.
 */
export function blockNamed(
  blocks: readonly DashboardBlock[],
  said: string,
): { readonly block: DashboardBlock } | { readonly reason: string } {
  const named = blocks.filter((each) => each.name === said)
  if (named.length === 1 && named[0] !== undefined) return { block: named[0] }
  if (named.length > 1) {
    return { reason: `${String(named.length)} blocks are called ${said}; say which: ${named.map((each) => `${each.format}/${each.name}`).join(', ')}.` }
  }
  const slash = said.indexOf('/')
  if (slash > 0) {
    const format = said.slice(0, slash)
    const name = said.slice(slash + 1)
    const found = blocks.find((each) => each.format === format && each.name === name)
    if (found !== undefined) return { block: found }
  }
  return {
    reason:
      blocks.length === 0
        ? `Nothing is on this dashboard, so nothing is called ${said}.`
        : `No block here is called ${said}; it has ${blocks.map((each) => each.name).join(', ')}.`,
  }
}

/** Blocks with one moved to stand at `to` — its place after the move. */
export function blockMoved(blocks: readonly DashboardBlock[], from: number, to: number): readonly DashboardBlock[] {
  const moving = blocks[from]
  if (moving === undefined || to < 0 || to >= blocks.length || from === to) return blocks
  const rest = blocks.filter((_, at) => at !== from)
  return [...rest.slice(0, to), moving, ...rest.slice(to)]
}

/** Blocks with one dropped in front of another — or at the end, before nothing. */
export function blockDropped(
  blocks: readonly DashboardBlock[],
  moving: DashboardBlock,
  before: DashboardBlock | undefined,
): readonly DashboardBlock[] {
  if (before !== undefined && sameBlock(moving, before)) return blocks
  const rest = blocks.filter((each) => !sameBlock(each, moving))
  const at = before === undefined ? rest.length : rest.findIndex((each) => sameBlock(each, before))
  return at === -1 ? blocks : [...rest.slice(0, at), moving, ...rest.slice(at)]
}

/** Blocks in the order named first — every name one of them — and the rest after, as they stood. */
export function blocksInOrder(blocks: readonly DashboardBlock[], first: readonly DashboardBlock[]): readonly DashboardBlock[] {
  const rest = blocks.filter((each) => !first.some((one) => sameBlock(one, each)))
  return [...first, ...rest]
}
