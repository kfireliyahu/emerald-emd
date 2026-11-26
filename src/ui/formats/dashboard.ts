import type { Database } from 'sql.js'

import { formatMoney, money } from '@/core/money.ts'
import { filterQuery, heldAs, heldText, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { countRows, sumColumn, type RowQuery } from '@/data/repositories/formatRowRepository.ts'
import { savedView, savedViews, viewSettings } from '@/data/repositories/formatViewRepository.ts'
import { nounOf, pluralOf } from '@/domain/format/connections.ts'
import { formatDecimal } from '@/domain/format/decimal.ts'
import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { filterText as ruleText } from '@/domain/format/aggregate.ts'
import { INPUT_KIND } from '@/domain/format/inputView.ts'
import type { RollupDeclaration } from '@/domain/format/rollup.ts'
import {
  BLOCK_GAP,
  BLOCK_HEIGHT_MAX,
  BLOCK_ROW,
  BLOCK_SIZE_MIN,
  listOf,
  sameBlock,
  type DashboardBlock,
  type SavedView,
} from '@/domain/format/view.ts'
import { err, ok, type Result } from '@/core/result.ts'
import { parseClockWords } from '@/domain/format/clock.ts'
import { figureRangeSaying, parseFigureRange } from '@/domain/format/figureRange.ts'
import { translate, type MessageKey } from '@/i18n/catalogue.ts'
import { countKey } from '@/i18n/count.ts'
import type { Translate } from '@/i18n/current.ts'

import { addressView, canonicalAddress, filterAddress, inputShapeOf } from './addressFilter.ts'
import { blockSentence } from './inputBlock.ts'

/**
 * **What a dashboard's blocks say** — M53 U7, D-514, D-521. Pure, and no
 * React: the dashboard's screen and `show_format view:dashboard` read the same
 * words and the same figures from here, so the person and the model are told
 * one thing.
 *
 * A block is a saved view drawn compact in its kind, a rollup's chart, or a
 * headline total — a count of a format's rows, or the sum of one of its number
 * or money columns, under a filter held as an address spells it (a window
 * around today stays the phrase, as a saved view's does).
 */

/**
 * The helpers say their words with a `t` (M64 F36): the screen's, in the
 * language now; left out, English — what `show_format view:dashboard` reads.
 */
const english: Translate = (key, parts) => translate('en', key, parts)

/** The column types a headline total sums: a number or money. */
const SUMMED: ReadonlySet<string> = new Set(['money', 'integer', 'real', 'decimal'])

/** The columns a headline total of this format can sum, in the declaration's order. */
export function summableColumns(declaration: FormatDeclaration): readonly ColumnDeclaration[] {
  return declaration.columns.filter((each) => SUMMED.has(each.type))
}

/** A headline total's figure, as the block draws it. */
export interface Headline {
  /** The figure: `12`, `₪1,240.00`, `₪1,240.00 + $30.00` in two currencies. */
  readonly figure: string
  /** What a plain figure is in — a column's declared unit — drawn small beside it. */
  readonly unit?: string | undefined
  /** How many rows the filter holds. */
  readonly rows: number
  /** How many rows the format has. */
  readonly of: number
}

/** A headline total's filter, read back from its address. */
export function totalFilter(block: Pick<DashboardBlock, 'address'>): RowFilter {
  return addressView(block.address).filter
}

/**
 * **A headline total's figure**, or the sentence why there is none: a count of
 * the rows its filter holds, or the sum of its column over them. Money is
 * summed per currency and never across two (D-003): two currencies are two
 * figures, joined. `today` is what a window around today is around.
 */
export function headline(
  db: Database,
  block: Pick<DashboardBlock, 'format' | 'sum' | 'address'>,
  declarations: readonly FormatDeclaration[],
  today: string,
  t: Translate = english,
): Result<Headline, string> {
  const declaration = declarations.find((each) => each.name === block.format)
  if (declaration === undefined) return err(t('dashboards.said.notDeclared', { format: block.format }))
  const read = filterQuery(db, declaration, totalFilter(block), declarations, today)
  if (!read.ok) {
    return err(
      read.error.kind === 'NO_COLUMN'
        ? t('dashboards.body.noColumn', { format: declaration.title, name: read.error.name })
        : read.error.reason,
    )
  }
  const query: RowQuery = read.value
  const of = countRows(db, declaration)
  const rows = countRows(db, declaration, query)
  if (block.sum === undefined) return ok({ figure: String(rows), rows, of })
  const column = declaration.columns.find((each) => each.name === block.sum)
  if (column === undefined) return err(t('dashboards.body.noColumn', { format: declaration.title, name: block.sum }))
  if (!SUMMED.has(column.type)) return err(t('dashboards.said.notSummed', { column: column.name }))
  const sums = sumColumn(db, declaration, column.name, query)
  if (column.type === 'money') {
    const figures = sums.flatMap((each) => (each.currency === undefined ? [] : [formatMoney(money(each.total, each.currency))]))
    return ok({ figure: figures.length === 0 ? '0' : figures.join(' + '), rows, of })
  }
  const total = sums[0]?.total ?? 0
  const figure =
    column.type === 'decimal'
      ? formatDecimal(Math.round(total), column.scale ?? 0)
      : column.type === 'real'
        ? String(Math.round(total * 100) / 100)
        : String(total)
  return ok({ figure, unit: column.unit, rows, of })
}

/** `of 16 tasks` — under a headline total's figure. */
export function ofText(declaration: FormatDeclaration, of: number, t: Translate = english): string {
  return t(countKey('dashboards.said.of', of), { count: of, ...formatWords(declaration.title) })
}

/** A format's title in a sentence: `{Format}` as declared, `{format}` its noun, `{formats}` its plural (English endings). */
function formatWords(title: string): Record<string, string> {
  return { Format: title, format: nounOf(title), formats: pluralOf(title) }
}

/** What a saved view's filter holds, in the filter's own words, or `every row`. */
export function savedWords(view: SavedView, t: Translate = english): string {
  return filterWords(addressView(view.address).filter, t) || t('dashboards.said.everyRow')
}

/**
 * **What a filter holds, in a line, in the language now** (M64 F36) — the
 * repository's `filterText` (`state is not done, search “bidi”`) with its
 * own words the catalogue's; the columns and the values held stay as the
 * document writes them.
 */
export function filterWords(filter: RowFilter, t: Translate = english): string {
  const held = Object.entries(filter.match ?? {}).map(([name, value]) => heldWords(name, value, t))
  const search = filter.search?.trim() ?? ''
  return [...held, ...(search === '' ? [] : [t('dashboards.filter.search', { search })])].join(t('dashboards.filter.joiner'))
}

/** One column held, as `heldText` says it, in the language now. */
export function heldWords(column: string, value: unknown, t: Translate = english): string {
  if (t === english) return heldText(column, value)
  const clock = typeof value === 'string' ? parseClockWords(value) : undefined
  if (clock !== undefined) return t('dashboards.filter.is', { column, values: String(value).trim().replace(/\s+/g, ' ').toLowerCase() })
  const range = typeof value === 'string' ? parseFigureRange(value) : undefined
  if (range !== undefined) {
    const said = figureRangeSaying(range)
    return t('dashboards.filter.is', { column, values: t(said.key, said.parts) })
  }
  const { values, not } = heldAs(value)
  const words = values.map((each) => heldMember(each, t)).join(t('dashboards.filter.joiner'))
  if (!not && values.length === 1) return t('dashboards.filter.equals', { column, values: words })
  const key: MessageKey =
    values.length > 1
      ? not
        ? 'dashboards.filter.isNotOneOf'
        : 'dashboards.filter.isOneOf'
      : not
        ? 'dashboards.filter.isNot'
        : 'dashboards.filter.is'
  return t(key, { column, values: words })
}

/** One value held: `empty` for nothing, else as the document writes it. */
function heldMember(value: unknown, t: Translate): string {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? t('dashboards.filter.empty') : String(value)
}

/** A saved view's kind in a sentence, capitalised where the language has capitals: `List`. */
function kindWords(kind: string, t: Translate): string {
  const known = ['list', 'table', 'board', 'roadmap', 'page', 'ready', 'start', 'agenda', 'entry', 'input'].includes(kind)
  const word = known ? t(`dashboards.kinds.${kind}` as MessageKey) : kind
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * **The line under a block's title** — what it is and what it reads, in the
 * filter's own words: `List · due is today, by project`, `Rollup · …`,
 * `Count · state is not done`. On the document's dashboard it opens with the
 * format's title, since its blocks may read any format.
 */
export function blockWhat(
  db: Database,
  block: DashboardBlock,
  declarations: readonly FormatDeclaration[],
  withFormat: boolean,
  t: Translate = english,
): string {
  const declaration = declarations.find((each) => each.name === block.format)
  const pre = (what: string): string => (withFormat ? t('dashboards.said.withFormat', { format: declaration?.title ?? block.format, what }) : what)
  if (declaration === undefined) return pre('')
  if (block.kind === 'saved') {
    const view = savedView(db, block.format, block.name)
    if (view === undefined) return pre(t('dashboards.said.savedView'))
    // An input view's line is what it adds, which names the format already (M55 U4, D-535).
    if (view.kind === INPUT_KIND) return blockSentence(declaration, inputShapeOf(view.address, declaration.name), t)
    const kind = kindWords(view.kind, t)
    const group = view.kind === 'list' ? listOf(declaration.columns, viewSettings(db, declaration.name, 'list')).group : undefined
    const words = savedWords(view, t)
    return pre(
      group === undefined
        ? t('dashboards.said.what', { kind, words })
        : t('dashboards.said.whatBy', { kind, words, group: group.name.replace(/_/g, ' ') }),
    )
  }
  if (block.kind === 'rollup') {
    const rollup = (declaration.rollups ?? []).find((each) => each.name === block.name)
    return pre(rollup === undefined ? t('dashboards.said.chart') : rollupSentence(rollup, declaration, t))
  }
  const column = block.sum === undefined ? undefined : declaration.columns.find((each) => each.name === block.sum)
  const kind = block.sum === undefined ? t('dashboards.said.count') : t('dashboards.make.sumOf', { column: (column?.name ?? block.sum).replace(/_/g, ' ') })
  const words = filterWords(totalFilter(block), t) || t('dashboards.make.every', { format: nounOf(declaration.title) })
  return pre(t('dashboards.said.what', { kind, words }))
}

/**
 * **Why a block cannot be drawn**, or nothing: the saved view or the rollup it
 * names is gone. Said on the block, which can still be removed — a block
 * never vanishes without a word.
 */
export function blockGone(
  db: Database,
  block: DashboardBlock,
  declarations: readonly FormatDeclaration[],
  t: Translate = english,
): string | undefined {
  const declaration = declarations.find((each) => each.name === block.format)
  if (declaration === undefined) return t('dashboards.said.notDeclared', { format: block.format })
  if (block.kind === 'saved' && savedView(db, block.format, block.name) === undefined) {
    return t('dashboards.body.noView', { format: declaration.title, name: block.name })
  }
  if (block.kind === 'rollup' && !(declaration.rollups ?? []).some((each) => each.name === block.name)) {
    return t('dashboards.body.noChart', { format: declaration.title, name: rollupWords(block.name) })
  }
  return undefined
}

/**
 * **A rollup's name, as words** — M55 U7, as M53 U3 did for a column's label:
 * `landed_by_month` reads *Landed by month* wherever a person reads it (a
 * block's title, the format's tab, the rail, *Add a block*). Only the words:
 * the declaration, every tool and every key keep the name.
 */
export function rollupWords(name: string): string {
  const words = name.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A block's title as it reads: a chart's rollup in words, a saved view as it was named. */
export function blockTitle(block: Pick<DashboardBlock, 'kind' | 'name'>): string {
  return block.kind === 'rollup' ? rollupWords(block.name) : block.name
}

/**
 * **What a rollup counts, as a sentence** — M55 U7: `count by month of landed
 * and milestone` reads *Count of units by month of landed, per milestone*, the
 * line under a block's title and above its tab's chart, where the rollup's own
 * text in mono stood.
 */
export function rollupSentence(
  rollup: RollupDeclaration,
  declaration: Pick<FormatDeclaration, 'title'>,
  t: Translate = english,
): string {
  const words = (name: string): string => name.replace(/_/g, ' ')
  const what =
    rollup.kind === 'COUNT'
      ? t('dashboards.rollupSaid.count', formatWords(declaration.title))
      : t('dashboards.rollupSaid.of', { kind: t(`dashboards.rollupSaid.kinds.${rollup.kind}`), column: words(rollup.of) })
  const column = rollup.period.truncate
    ? t('dashboards.rollupSaid.monthOf', { column: words(rollup.period.column) })
    : words(rollup.period.column)
  const period =
    rollup.period.fallback === undefined ? column : t('dashboards.rollupSaid.or', { column, fallback: words(rollup.period.fallback) })
  const where = rollup.where.map((each) => words(ruleText(each))).join(t('dashboards.rollupSaid.and'))
  const by = t('dashboards.rollupSaid.by', { what, period })
  const per = rollup.by === undefined ? by : t('dashboards.rollupSaid.per', { sentence: by, by: words(rollup.by) })
  return where === '' ? per : t('dashboards.rollupSaid.where', { sentence: per, where })
}

/** What *Add a block* offers of one format: its saved views and its rollups. */
export interface Offered {
  readonly format: FormatDeclaration
  readonly saved: readonly SavedView[]
  readonly rollups: readonly string[]
}

export function offeredOf(db: Database, declaration: FormatDeclaration): Offered {
  return {
    format: declaration,
    saved: savedViews(db, declaration.name),
    rollups: (declaration.rollups ?? []).map((each) => each.name),
  }
}

/** One condition *Headline total* offers to tick, in the filter's own words. */
export interface Condition {
  readonly words: string
  readonly column: string
  readonly value: unknown
}

/**
 * **The conditions a headline total offers** — each one held value of the
 * format's saved views, then what its list counts as done turned round
 * (`state is not done`), then the windows around today on its dates. One of
 * each spelling, in that order: a total's filter is made of what the format's
 * own views already ask, and of what any list of it would.
 */
export function conditionsOf(db: Database, declaration: FormatDeclaration): readonly Condition[] {
  const found: Condition[] = []
  const add = (column: string, value: unknown): void => {
    const spelled = canonicalAddress(filterAddress({ match: { [column]: value } }))
    if (found.some((each) => canonicalAddress(filterAddress({ match: { [each.column]: each.value } })) === spelled)) return
    found.push({ words: heldText(column, value), column, value })
  }
  for (const view of savedViews(db, declaration.name)) {
    for (const [column, value] of Object.entries(addressView(view.address).filter.match ?? {})) add(column, value)
  }
  const done = listOf(declaration.columns, viewSettings(db, declaration.name, 'list')).done
  if (done !== undefined && done.column.type !== 'boolean') add(done.column.name, { not: [...done.members] })
  for (const column of declaration.columns.filter((each) => each.type === 'date')) {
    add(column.name, 'today')
    add(column.name, 'before today')
    add(column.name, 'within 7 days')
  }
  return found
}

/** The ticked conditions as one filter's address — the later of two on one column standing. */
export function conditionsAddress(ticked: readonly Condition[]): string {
  if (ticked.length === 0) return ''
  return canonicalAddress(filterAddress({ match: Object.fromEntries(ticked.map((each) => [each.column, each.value])) }))
}

/** A block's edge: the right sets its width, the bottom its height, the corner both (M53 F4, D-527). */
export type Edge = 'right' | 'bottom' | 'corner'

/** A size an edge sets: the width, the height, or both — what it leaves out stays as it was. */
export interface BlockSize {
  readonly width?: number | undefined
  readonly height?: number | undefined
}

/** The grid as an edge measures it: its columns now — four, or two on a narrow window — and one column's width in pixels. */
export interface GridMeasure {
  readonly columns: number
  readonly column: number
}

/** A height in pixels, snapped to the grid's rows. */
export function rowsOf(pixels: number): number {
  return Math.min(BLOCK_HEIGHT_MAX, Math.max(BLOCK_SIZE_MIN.height, Math.round((pixels + BLOCK_GAP) / (BLOCK_ROW + BLOCK_GAP))))
}

/**
 * **An edge dragged**: the block's drawn size in pixels and how far the
 * pointer has gone, snapped to the grid's columns and rows — the right edge
 * the width alone, the bottom the height alone, the corner both.
 */
export function snappedSize(
  edge: Edge,
  drawn: { readonly width: number; readonly height: number },
  moved: { readonly x: number; readonly y: number },
  grid: GridMeasure,
): BlockSize {
  return {
    ...(edge === 'bottom'
      ? {}
      : { width: Math.min(grid.columns, Math.max(BLOCK_SIZE_MIN.width, Math.round((drawn.width + moved.x + BLOCK_GAP) / (grid.column + BLOCK_GAP)))) }),
    ...(edge === 'right' ? {} : { height: rowsOf(drawn.height + moved.y) }),
  }
}

/**
 * **An edge moved by an arrow key**: a column or a row at a time, from the
 * size the block has — a height by content counts from the rows it fills now
 * (`drawnHeight`, pixels). Nothing when the key is not one this edge takes.
 */
export function steppedSize(
  edge: Edge,
  key: string,
  size: { readonly width: number; readonly height: number | undefined },
  drawnHeight: number,
  columns: number,
): BlockSize | undefined {
  const across = edge === 'bottom' ? 0 : key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  const along = edge === 'right' ? 0 : key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
  if (across === 0 && along === 0) return undefined
  const rows = size.height ?? rowsOf(drawnHeight)
  return {
    ...(across === 0 ? {} : { width: Math.min(columns, Math.max(BLOCK_SIZE_MIN.width, size.width + across)) }),
    ...(along === 0 ? {} : { height: Math.min(BLOCK_HEIGHT_MAX, Math.max(BLOCK_SIZE_MIN.height, rows + along)) }),
  }
}

/**
 * **A dashboard's blocks with one resized** — what letting go of an edge
 * writes: its width and height as given, what is left out as it was; the
 * same blocks when nothing changed, so nothing is written.
 */
export function blockResized(blocks: readonly DashboardBlock[], block: DashboardBlock, size: BlockSize): readonly DashboardBlock[] {
  const width = size.width ?? block.width
  const height = size.height ?? block.height
  if (width === block.width && height === block.height) return blocks
  const now: DashboardBlock = { ...block, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) }
  return blocks.map((each) => (sameBlock(each, block) ? now : each))
}
