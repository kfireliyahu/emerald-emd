/**
 * **The roadmap, and what names a row, read from the document** — M27 U4,
 * D-302; the page became the entry's in M35 U2 (D-401).
 *
 * Both read links rather than lanes, and both are one hop (D-224): a roadmap
 * folds the rows that name a row, an entry reads what names it. Nothing here is kept — every call reads the rows as
 * they stand, which is what lets M27 U6 move a unit under an open roadmap and
 * have the next render show it.
 *
 * The shapes are `domain/format/view.ts`'s; this file only fetches the rows
 * they say to fetch, and the names of whatever those rows' links point at.
 */

import type { Database } from 'sql.js'

import { labelColumn, type ColumnDeclaration, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { idsIn, readValue, type StoredRow, type StoredValue } from '@/domain/format/row.ts'
import { clockRange } from '@/domain/format/clock.ts'
import {
  agendaDays,
  agendaOf,
  meetWindows,
  type AgendaDay,
  type AgendaShape,
  foldUnder,
  inRoadmapOrder,
  lineShapeOf,
  byName,
  entryLayout,
  entryOrder,
  wayOf,
  linksNaming,
  readyOf,
  readyRows,
  stalledRows,
  roadmapOf,
  startOf,
  startQuestions,
  type Fold,
  type StartShape,
  type ReadyShape,
  type StartQuestion,
  type LineShape,
  type RoadmapShape,
} from '@/domain/format/view.ts'
import { filterQuery, type FilterRefusal, type RowFilter } from './formatFilterRepository.ts'
import { countRows, linkLabels, listRows, readRow, type RowQuery } from './formatRowRepository.ts'
import { entryHeaders, entryInputs, entryPlaces, viewSettings } from './formatViewRepository.ts'

/** One row as a line: the format it is a row of, the row, and what its line shows. */
export interface ViewLine {
  readonly format: FormatDeclaration
  readonly row: StoredRow
  readonly shape: LineShape<ColumnDeclaration>
}

/** The rows of one fold under one row of a roadmap. */
export interface FoldedLines {
  readonly fold: Fold<FormatDeclaration, ColumnDeclaration>
  readonly lines: readonly ViewLine[]
  /** How many fold there before the fold's filter held any back (M37 U5) — `lines.length` when none did. */
  readonly total: number
}

export interface RoadmapData {
  readonly shape: RoadmapShape<FormatDeclaration, ColumnDeclaration>
  /** The format's rows in order, each with every fold's rows that name it. */
  readonly rows: readonly { readonly line: ViewLine; readonly folds: readonly FoldedLines[] }[]
  /** Folded rows naming no row of the roadmap — drawn apart, never dropped. */
  readonly loose: readonly FoldedLines[]
  /** What every link id on the page is called. */
  readonly labels: ReadonlyMap<string, string>
}

/**
 * How many rows of each format a roadmap reads. High on purpose: a roadmap
 * that quietly stopped at a cap would draw a plan with units missing from it.
 */
const ROADMAP_CAP = 20_000

/** A format's roadmap, or nothing when it cannot have one (`roadmapOf`). */
export function roadmapData(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  filter: RowQuery = {},
  /**
   * **What each folded format's rows are held to** (M37 U5), by its name: a
   * milestone shows only its planned units, and says how many of how many.
   */
  folds: ReadonlyMap<string, RowQuery> = new Map(),
): RoadmapData | undefined {
  const settings = (format: string) => viewSettings(db, format, 'roadmap')
  const shape = roadmapOf<ColumnDeclaration, FormatDeclaration>(declaration, declarations, settings)
  if (shape === undefined) return undefined

  const labels = new Map<string, string>()
  const rootRows = listRows(db, declaration, { limit: ROADMAP_CAP })
  // **A filter names the rows drawn, not the ones folded against** (M44 U6):
  // what folds under a row left out is still under a row, so it is not loose.
  const kept = keptIds(db, declaration, filter)
  addLabels(labels, db, rootRows, declaration, declarations)
  const ordered = inRoadmapOrder(rootRows, (row) => numberIn(shape.order, row), (row) => nameOf(shape, row))
  const roots = new Set(ordered.map((row) => row.id))

  const folded = shape.folds.map((fold) => {
    const rows = listRows(db, fold.format, { limit: ROADMAP_CAP })
    addLabels(labels, db, rows, fold.format, declarations)
    const held = keptIds(db, fold.format, folds.get(fold.format.name) ?? {})
    return {
      fold,
      held,
      ...foldUnder(roots, rows, (row) => idsIn(row.cells[fold.through.name]), (row) => nameOf(fold, row)),
    }
  })
  const linesOf = (
    fold: Fold<FormatDeclaration, ColumnDeclaration>,
    held: ReadonlySet<string> | undefined,
    rows: readonly StoredRow[],
  ): FoldedLines => ({
    fold,
    lines: rows.filter((each) => held === undefined || held.has(each.id)).map((each) => ({ format: fold.format, row: each, shape: fold })),
    total: rows.length,
  })

  return {
    shape,
    rows: ordered.filter((row) => kept === undefined || kept.has(row.id)).map((row) => ({
      line: { format: declaration, row, shape },
      folds: folded.map(({ fold, held, under }) => linesOf(fold, held, under.get(row.id) ?? [])),
    })),
    loose: folded
      .filter(({ loose }) => kept === undefined && loose.length > 0)
      .map(({ fold, held, loose }) => linesOf(fold, held, loose))
      .filter((each) => each.lines.length > 0),
    labels,
  }
}

/** The roadmap a format's rows fold under: that format, the link they fold through, and its naming column. */
export interface RoadmapAbove {
  readonly format: FormatDeclaration
  readonly through: ColumnDeclaration
  readonly name: ColumnDeclaration | undefined
}

/**
 * **The roadmap a format without one is drawn in** (M47 U7): the first format
 * whose roadmap folds this one's rows — a unit, which has none of its own, is
 * drawn in its milestone's lane. Nothing when no roadmap folds it.
 */
export function roadmapAbove(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
): RoadmapAbove | undefined {
  const settings = (format: string) => viewSettings(db, format, 'roadmap')
  for (const each of declarations) {
    if (each.name === declaration.name) continue
    const shape = roadmapOf<ColumnDeclaration, FormatDeclaration>(each, declarations, settings)
    const fold = shape?.folds.find((one) => one.format.name === declaration.name)
    if (shape !== undefined && fold !== undefined) return { format: each, through: fold.through, name: shape.name }
  }
  return undefined
}

/**
 * **The rows a filter keeps, by id** — or nothing when it asks for nothing
 * (M44 U6). Read with `listRows`, the one filter every reader uses, so a view
 * that has to read every row to draw any (what folds where, what holds what)
 * shows the rows a `format_rows` with the same filter returns.
 */
function keptIds(db: Database, declaration: FormatDeclaration, filter: RowQuery): ReadonlySet<string> | undefined {
  const { match, search, formats, windows, ranges, today } = filter
  // A window around today and an amount's range hold rows back too (D-472, M37 U4).
  if ((match?.size ?? 0) === 0 && (search ?? '') === '' && (windows?.size ?? 0) === 0 && (ranges?.size ?? 0) === 0) return undefined
  return new Set(
    listRows(db, declaration, {
      ...(match === undefined ? {} : { match }),
      ...(search === undefined ? {} : { search }),
      ...(formats === undefined ? {} : { formats }),
      ...(windows === undefined ? {} : { windows }),
      ...(ranges === undefined ? {} : { ranges }),
      ...(today === undefined ? {} : { today }),
      limit: ROADMAP_CAP,
    }).map((row) => row.id),
  )
}

/** The rows one link column names, or the rows naming this one through it. */
export interface LinkedLines {
  readonly format: FormatDeclaration
  readonly column: ColumnDeclaration
  readonly lines: readonly ViewLine[]
}

/**
 * **What names one row, read for its entry** — M35 U2, D-401. It was the
 * page's (M27 U4, D-302); the page and the entry are one view now, and what a
 * row names is that view's own fields.
 *
 * Every link column, in any format, that names rows of this one has a group —
 * an empty group is an answer, a missing one a question — and each row in it
 * is a line drawn as the entry draws its title (`entryLineShape`). One hop:
 * the rows naming those are on their own entries.
 */
export interface EntryLinks {
  readonly namedBy: readonly LinkedLines[]
  /** What every id this row's links hold, and every row named here, is called. */
  readonly labels: ReadonlyMap<string, string>
}

/** What names one row, or nothing when the format has no row with this id. */
export function entryLinks(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  id: string,
): EntryLinks | undefined {
  const row = readRow(db, declaration, id)
  if (row === undefined) return undefined
  const labels = new Map<string, string>()
  addLabels(labels, db, [row], declaration, declarations)

  const namedBy = linksNaming<ColumnDeclaration, FormatDeclaration>(declarations, declaration.name).map(
    ({ format, column }) => {
      const rows = listRows(db, format, { match: new Map([[column.name, row.id]]) })
      addLabels(labels, db, rows, format, declarations)
      const named = labelColumn(format)
      const sorted = [...rows].sort((a, b) =>
        textIn(named, a).localeCompare(textIn(named, b), undefined, { numeric: true }),
      )
      const shape = entryLineShape(db, format)
      return { format, column, lines: sorted.map((each) => ({ format, row: each, shape })) }
    },
  )
  return { namedBy, labels }
}

/**
 * **The rows this row's own links name**, each as a line its entry draws —
 * what a link shown as a card, and several shown as a list or as cards, need
 * beyond a name: the row's state and its line (M35 U3, D-402). By id; an id no
 * row answers to is left out, and is drawn by its name alone.
 */
export function entryLinked(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  row: StoredRow,
): ReadonlyMap<string, ViewLine> {
  const lines = new Map<string, ViewLine>()
  for (const column of declaration.columns) {
    if ((column.type !== 'link' && column.type !== 'links') || column.target === undefined) continue
    const format = declarations.find((each) => each.name === column.target)
    if (format === undefined) continue
    const shape = entryLineShape(db, format)
    for (const id of idsIn(row.cells[column.name])) {
      const named = readRow(db, format, id)
      if (named !== undefined) lines.set(id, { format, row: named, shape })
    }
  }
  return lines
}

/**
 * A row of this format as a line on another row's entry: its name and state,
 * and under them the title its own entry draws, when that is not its name — a
 * unit is named `M35 U2` and titled by what it does.
 */
export function entryLineShape(db: Database, format: FormatDeclaration): LineShape<ColumnDeclaration> {
  const base = lineShapeOf(format.columns, new Map())
  const chosen = entryInputs(db, format.name)
  const layout = entryLayout(
    entryOrder(format.columns, entryPlaces(db, format.name)),
    (column) => wayOf(column, chosen.get(column.name)),
    entryHeaders(db, format.name),
  )
  const title = layout.title
  return { ...base, lines: title === undefined || title === base.name ? [] : [title] }
}

/** A held row: its line, and the rows still open that it waits on. */
export interface HeldLines {
  readonly line: ViewLine
  readonly by: readonly ViewLine[]
}

export interface ReadyData {
  readonly shape: ReadyShape<ColumnDeclaration>
  /** In a ready member, waiting on nothing still open — what a session can start. */
  readonly ready: readonly ViewLine[]
  /** In a ready member, held up by rows still open. */
  readonly held: readonly HeldLines[]
  /** Being worked and taken longer ago than the view's `stalls` (M51 F4); empty without one, or without a day to count from. */
  readonly stalled: readonly ViewLine[]
  readonly labels: ReadonlyMap<string, string>
}

/**
 * **What is ready** (M27 U5, D-303), or nothing when the format declares no
 * ready view (`readyOf`). Read whole on every call and kept nowhere, as the
 * roadmap is: a unit built a moment ago lets the units waiting on it through on
 * the next render.
 */
export function readyData(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  filter: RowQuery = {},
  asOf?: string,
): ReadyData | undefined {
  const shape = readyOf<ColumnDeclaration>(declaration, viewSettings(db, declaration.name, 'ready'))
  if (shape === undefined) return undefined
  // Every row is read to know what holds what; the filter names which are shown.
  const kept = keptIds(db, declaration, filter)
  const shown = (row: StoredRow): boolean => kept === undefined || kept.has(row.id)
  const rows = listRows(db, declaration, { limit: ROADMAP_CAP })
  const labels = new Map<string, string>()
  addLabels(labels, db, rows, declaration, declarations)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const split = readyRows(
    rows,
    shape.members,
    (row) => row.id,
    (row) => textIn(shape.state, row) || undefined,
    (row) => idsIn(row.cells[shape.waits.name]),
    (row) => nameOf(shape, row),
  )
  const lineOf = (row: StoredRow): ViewLine => ({ format: declaration, row, shape })
  const stalls = shape.stalls
  const stalled =
    stalls === undefined || asOf === undefined
      ? []
      : stalledRows(
          rows,
          shape.members,
          stalls.days,
          asOf,
          (row) => textIn(shape.state, row) || undefined,
          (row) => textIn(stalls.column, row) || undefined,
          (row) => nameOf(shape, row),
        )
  return {
    shape,
    ready: split.ready.filter(shown).map(lineOf),
    held: split.held.filter((each) => shown(each.row)).map((each) => ({
      line: lineOf(each.row),
      // A blocker that is not there is drawn by its id: it holds the row up
      // all the same (`readyRows`).
      by: each.by.map((id) => lineOf(byId.get(id) ?? { id, cells: {} })),
    })),
    stalled: stalled.filter(shown).map(lineOf),
    labels,
  }
}

/**
 * The views a format has, as the tab strip on its sheet offers them (M27 U3-U5; the View menu until M53 U4):
 * the sheet always, a board with an enum, a roadmap when `roadmapOf` finds
 * one, and a ready list when its views declare one. What `show_format` may
 * open the frame on (M41 U2).
 */
export function formatViews(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
): readonly ('sheet' | 'board' | 'list' | 'roadmap' | 'ready')[] {
  const settings = (format: string) => viewSettings(db, format, 'roadmap')
  return [
    'sheet',
    ...(declaration.columns.some((each) => each.type === 'enum') ? (['board'] as const) : []),
    // Every format has a list (M53 U4, D-519).
    'list' as const,
    ...(roadmapOf<ColumnDeclaration, FormatDeclaration>(declaration, declarations, settings) === undefined ? [] : (['roadmap'] as const)),
    ...(readyOf<ColumnDeclaration>(declaration, viewSettings(db, declaration.name, 'ready')) === undefined ? [] : (['ready'] as const)),
  ]
}

/**
 * **What `start_here` draws** (M41 U2): every format with a ready view, and
 * every roadmap those formats' rows fold under — so the development pack's
 * answer is the milestones in order with their units, the open one unfolded,
 * and then what can be started. Chosen by the document's views and by nothing
 * a pack wrote for a screen (M32's line). Empty when the views say neither.
 */
export interface StartPicture {
  /** The formats whose roadmap is drawn, in the document's order. */
  readonly roadmaps: readonly string[]
  /** The formats whose ready list is drawn. */
  readonly ready: readonly string[]
}

export function startPicture(db: Database, declarations: readonly FormatDeclaration[]): StartPicture {
  const ready = declarations
    .filter((each) => readyOf<ColumnDeclaration>(each, viewSettings(db, each.name, 'ready')) !== undefined)
    .map((each) => each.name)
  const settings = (format: string) => viewSettings(db, format, 'roadmap')
  const roadmaps = declarations
    .filter((each) =>
      (roadmapOf<ColumnDeclaration, FormatDeclaration>(each, declarations, settings)?.folds ?? []).some((fold) =>
        ready.includes(fold.format.name),
      ),
    )
    .map((each) => each.name)
  return { roadmaps, ready }
}

/** One start-here answer: the question, the rows that answer it, and how many there are in all. */
export interface StartAnswer {
  readonly question: StartQuestion
  readonly declaration: FormatDeclaration
  readonly lines: readonly ViewLine[]
  /** Every row the question finds, before a `latest` count or the cap. */
  readonly total: number
  /** A ready view's held rows; empty for a start view. */
  readonly held: readonly HeldLines[]
  /** A ready view's stalled rows (M51 F4), and the date they are counted from; empty for a start view. */
  readonly stalled: readonly ViewLine[]
  readonly stalls: { readonly column: ColumnDeclaration; readonly days: number } | undefined
  /** The columns the question already says the value of — not printed again on every line. */
  readonly asked: readonly ColumnDeclaration[]
  readonly labels: ReadonlyMap<string, string>
}

/**
 * How many rows one start view answers with when it asks for no `latest`. The
 * answer is read at the top of every session, so it is short on purpose, and
 * says how many it left out.
 */
export const START_CAP = 25

/**
 * **Every start-here answer a document declares** (M27 U5, D-303): each ready
 * view, then each start view, in `startQuestions`'s order. Empty when the
 * document declares neither — the caller says so, and how to.
 */
export function startHere(db: Database, declarations: readonly FormatDeclaration[], asOf?: string): readonly StartAnswer[] {
  const questions = startQuestions<ColumnDeclaration, FormatDeclaration>(
    declarations,
    (format) => viewSettings(db, format, 'ready'),
    (format) => viewSettings(db, format, 'start'),
  )
  return questions.flatMap((question): StartAnswer[] => {
    const declaration = declarations.find((each) => each.name === question.format)
    if (declaration === undefined) return []
    if (question.kind === 'ready') {
      const ready = readyData(db, declaration, declarations, {}, asOf)
      if (ready === undefined) return []
      return [
        {
          question,
          declaration,
          lines: ready.ready,
          total: ready.ready.length,
          held: ready.held,
          stalled: ready.stalled,
          stalls: ready.shape.stalls,
          asked: [ready.shape.state],
          labels: ready.labels,
        },
      ]
    }
    const shape = startOf(declaration.columns, viewSettings(db, declaration.name, 'start'))
    if (shape === undefined) return []
    const found = listRows(db, declaration, { match: startMatch(shape), limit: ROADMAP_CAP })
    const latest = shape.latest
    const sorted =
      latest === undefined
        ? [...found].sort((a, b) => byName(nameOf(shape, a), nameOf(shape, b)))
        : [...found].sort((a, b) => {
            const x = orderedValue(latest.column, a)
            const y = orderedValue(latest.column, b)
            if (x !== y) {
              if (x === undefined) return 1
              if (y === undefined) return -1
              return x < y ? 1 : -1
            }
            return byName(nameOf(shape, b), nameOf(shape, a))
          })
    const shown = sorted.slice(0, latest?.count ?? START_CAP)
    const labels = new Map<string, string>()
    addLabels(labels, db, shown, declaration, declarations)
    return [
      {
        question,
        declaration,
        lines: shown.map((row) => ({ format: declaration, row, shape })),
        total: found.length,
        held: [],
        stalled: [],
        stalls: undefined,
        asked: shape.is.map((each) => each.column),
        labels,
      },
    ]
  })
}

/**
 * **How many rows a format's start view finds** (M36 U06) — the count a screen
 * shows for the same question `start_here` answers, so the two cannot disagree:
 * Home's waiting list reads its transfers, settlements and payments to confirm
 * here. Nothing when the document declares no start view on the format, which
 * is the caller's to say rather than a zero.
 */
export function startCount(db: Database, declaration: FormatDeclaration): number | undefined {
  const shape = startOf(declaration.columns, viewSettings(db, declaration.name, 'start'))
  if (shape === undefined) return undefined
  return countRows(db, declaration, { match: startMatch(shape) })
}

/** A start view's `is` settings as a match: an enum's member, or a boolean as it is stored. */
function startMatch(shape: StartShape<ColumnDeclaration>): ReadonlyMap<string, StoredValue> {
  return new Map(
    shape.is.map((each) => [
      each.column.name,
      each.column.type === 'boolean' ? (each.member === 'true' ? 1 : 0) : each.member,
    ] as const),
  )
}

/** A date, a month or a number, as something that sorts — an ISO date sorts as text. */
function orderedValue(column: ColumnDeclaration, row: StoredRow): string | number | undefined {
  const value = readValue(column, row)
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

function addLabels(
  into: Map<string, string>,
  db: Database,
  rows: readonly StoredRow[],
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
): void {
  for (const [id, label] of linkLabels(db, rows, declaration, declarations)) into.set(id, label)
  // A row's own name, so a line can be named by the same map as a link to it.
  const named = labelColumn(declaration)
  for (const row of rows) {
    const text = textIn(named, row)
    if (text !== '') into.set(row.id, text)
  }
}

function numberIn(column: ColumnDeclaration, row: StoredRow): number | undefined {
  const value = readValue(column, row)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nameOf(shape: LineShape<ColumnDeclaration>, row: StoredRow): string {
  return textIn(shape.name, row) || row.id
}

function textIn(column: ColumnDeclaration | undefined, row: StoredRow): string {
  if (column === undefined) return ''
  const value = readValue(column, row)
  return typeof value === 'string' ? value : ''
}

/**
 * **The agenda** — M49 U3, D-473: every dated format's rows on one list of
 * days from today, and above today the rows a format says it still owes.
 *
 * **Its filter is `filterQuery`'s, format by format** — the one reading
 * `format_rows`, `show_format` and the screens make — so the agenda and
 * `format_rows assignment match:{due: "within 14 days"}` cannot disagree about
 * which assignments are due. On the agenda **`date` names each format's own
 * agenda date** (`date is within 14 days` holds the assignments by `due` and
 * the exams by `on`); any other column holds the formats that have it, and a
 * format that has not got it is left off and said to be. The clock is the
 * caller's, as it is for every question (D-472).
 */
export const AGENDA_DATE = 'date'

/** How many rows of one format the agenda reads ahead — a long list, and it says how many it left. */
export const AGENDA_CAP = 500

/** One row on the agenda: its line, the day it is on, and whether that day is behind it. */
export interface AgendaLine extends ViewLine {
  readonly date: string
  readonly overdue: boolean
}

/** A format the agenda reads, by which date, and how many of its rows it left past the cap. */
export interface AgendaFormat {
  readonly declaration: FormatDeclaration
  readonly shape: AgendaShape<ColumnDeclaration>
  readonly more: number
}

export interface AgendaData {
  /** The day it was asked on, `YYYY-MM-DD`. */
  readonly today: string
  /** Every format on it, in the document's order. */
  readonly formats: readonly AgendaFormat[]
  /** Rows before today not finished, earliest first — only of formats that say what finished is. */
  readonly overdue: readonly AgendaLine[]
  /** Today and every day after it that has a row. */
  readonly days: readonly AgendaDay<AgendaLine>[]
  /** The formats a filter left off, each with why. */
  readonly left: readonly { readonly format: FormatDeclaration; readonly reason: string }[]
  readonly labels: ReadonlyMap<string, string>
}

/** Every format a document puts on its agenda, each with the shape it is read by. */
export function agendaFormats(
  db: Database,
  declarations: readonly FormatDeclaration[],
): readonly { readonly declaration: FormatDeclaration; readonly shape: AgendaShape<ColumnDeclaration> }[] {
  return declarations.flatMap((declaration) => {
    const shape = agendaOf(declaration.columns, viewSettings(db, declaration.name, 'agenda'))
    return shape === undefined ? [] : [{ declaration, shape }]
  })
}

/**
 * **The agenda as it stands today** (`today` is `YYYY-MM-DD`, the asking
 * runtime's). Read whole on every call and kept nowhere, as the roadmap is.
 * `only` keeps the formats whose agenda date was chosen — what `start_here`
 * asks of, since a first date by default may be when a thing happened.
 */
export function agendaData(
  db: Database,
  declarations: readonly FormatDeclaration[],
  today: string,
  filter: RowFilter = {},
  only?: 'chosen',
): AgendaData {
  const yesterday = clockRange({ kind: 'BEFORE' }, today)?.through
  const labels = new Map<string, string>()
  const formats: AgendaFormat[] = []
  const left: { format: FormatDeclaration; reason: string }[] = []
  const ahead: AgendaLine[] = []
  const overdue: AgendaLine[] = []
  const order = new Map(declarations.map((each, index) => [each.name, index]))
  for (const { declaration, shape } of agendaFormats(db, declarations)) {
    if (only === 'chosen' && !shape.chosen) continue
    const date = shape.date.name
    const match = Object.fromEntries(
      Object.entries(filter.match ?? {}).map(([name, value]) => [name === AGENDA_DATE ? date : name, value] as const),
    )
    const read = filterQuery(db, declaration, { ...filter, match }, declarations, today)
    if (!read.ok) {
      left.push({ format: declaration, reason: leftReason(declaration, read.error) })
      continue
    }
    const query = read.value
    const asked = query.windows?.get(date) ?? {}
    const windows = (range: { from?: string | undefined; through?: string | undefined }): RowQuery | undefined => {
      const met = meetWindows(asked, range)
      return met === undefined ? undefined : { ...query, windows: new Map([...(query.windows ?? []), [date, met]]), order: date }
    }
    const lineOf = (row: StoredRow, late: boolean): AgendaLine => ({
      format: declaration,
      row,
      shape,
      date: textIn(shape.date, row),
      overdue: late,
    })
    const later = windows({ from: today })
    let more = 0
    if (later !== undefined) {
      const rows = listRows(db, declaration, { ...later, limit: AGENDA_CAP })
      more = Math.max(0, countRows(db, declaration, later) - rows.length)
      addLabels(labels, db, rows, declaration, declarations)
      ahead.push(...rows.map((row) => lineOf(row, false)))
    }
    const done = shape.done
    const earlier = done === undefined || yesterday === undefined ? undefined : windows({ through: yesterday })
    if (done !== undefined && earlier !== undefined) {
      const rows = listRows(db, declaration, { ...earlier, limit: ROADMAP_CAP }).filter((row) => !isDone(done, row))
      addLabels(labels, db, rows, declaration, declarations)
      overdue.push(...rows.map((row) => lineOf(row, true)))
    }
    formats.push({ declaration, shape, more })
  }
  const tie = (a: AgendaLine, b: AgendaLine): number =>
    (order.get(a.format.name) ?? 0) - (order.get(b.format.name) ?? 0) || byName(nameOf(a.shape, a.row), nameOf(b.shape, b.row))
  return {
    today,
    formats,
    overdue: [...overdue].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : tie(a, b))),
    days: agendaDays(ahead, (line) => line.date || undefined, tie),
    left,
    labels,
  }
}

/** Whether a row is finished, by the agenda's `done`: an enum's member, or a boolean as it is stored. */
function isDone(done: NonNullable<AgendaShape<ColumnDeclaration>['done']>, row: StoredRow): boolean {
  const cell = row.cells[done.column.name]
  if (done.column.type === 'boolean') return cell !== null && cell !== undefined && done.members.includes(cell === 1 ? 'true' : 'false')
  return typeof cell === 'string' && done.members.includes(cell)
}

/** Why a filter left a format off the agenda, in a line. */
function leftReason(declaration: FormatDeclaration, refusal: FilterRefusal): string {
  return refusal.kind === 'NO_COLUMN' ? `${declaration.name} has no column ${refusal.name}.` : refusal.reason
}
