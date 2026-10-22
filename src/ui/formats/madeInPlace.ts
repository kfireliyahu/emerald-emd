import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import { inTransaction } from '@/data/db/database.ts'
import { heldAs, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { savedView, saveView, setDashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import { parseClockWords } from '@/domain/format/clock.ts'
import {
  DECLARATION_LANGUAGE,
  declarationProblems,
  type ColumnDeclaration,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { parseFigureRange } from '@/domain/format/figureRange.ts'
import { declarationChangeRefusal } from '@/domain/format/owner.ts'
import { parseRollup, type RollupDeclaration } from '@/domain/format/rollup.ts'
import { sameBlock, savedAddress, savedNameRefusal, SAVED_ADDRESS_LONGEST, type DashboardBlock } from '@/domain/format/view.ts'

import { summableColumns } from './dashboard.ts'

/**
 * **A dashboard makes the view or the chart it needs in place** — M53 F2,
 * D-525, amending D-521. *Add a block* offers *New view* and *New chart*
 * beside the saved views and rollups already there, and each is made and
 * placed in one step: a saved view and its block, or a rollup declared on its
 * format and its chart's block.
 *
 * **No new write**: a view is saved by `saveView` (D-520, `arrange_views
 * view:saved`), a rollup declared by `adoptFormat` over the format with it
 * added (the format's own edit, and `extend_format rollups`), and a block placed
 * by `setDashboardBlocks` (`arrange_views view:dashboard`). Here they are judged
 * first and written together, so a refusal writes neither.
 */

/** The kinds *New view* makes: a list, a table or a board (the maintainer, 2026-10-22). */
export const MADE_KINDS = ['list', 'table', 'board'] as const

export type MadeKind = (typeof MADE_KINDS)[number]

/** A view being made: of which format, in which kind, holding which address, under which name. */
export interface ViewMade {
  readonly dashboard: string | undefined
  readonly format: string
  readonly kind: MadeKind
  readonly name: string
  /** The filter, order and columns as the address spells them — `?due=today&order:due=ascending`. */
  readonly address: string
}

/** Why a view cannot be made and placed as asked, or nothing. */
export function viewRefusal(
  db: Database,
  declaration: FormatDeclaration,
  blocks: readonly DashboardBlock[],
  made: ViewMade,
): string | undefined {
  const refused = savedNameRefusal(made.name)
  if (refused !== undefined) return refused
  // A name taken is refused here, never written over: *Save this view* offers
  // the replace, and a view picked from the list is placed as it stands.
  if (savedView(db, made.format, made.name) !== undefined) {
    return `${declaration.title} has a saved view called ${made.name} already — pick it from the list, or call this one something else.`
  }
  if (blocks.some((each) => sameBlock(each, made))) return `A block here is called ${made.name} already.`
  if (savedAddress(made.address).length > SAVED_ADDRESS_LONGEST) {
    return `A saved view keeps at most ${String(SAVED_ADDRESS_LONGEST)} characters of address.`
  }
  return undefined
}

/** The block a made view is placed as. */
export function viewBlock(made: ViewMade): DashboardBlock {
  return { dashboard: made.dashboard, format: made.format, kind: 'saved', name: made.name, address: '' }
}

/**
 * **Save the view and place it, together** — the saved view (D-520), then the
 * dashboard's blocks with its own at the end. Both or neither.
 */
export function makeView(db: Database, blocks: readonly DashboardBlock[], made: ViewMade): void {
  inTransaction(db, () => {
    saveView(db, { format: made.format, name: made.name, kind: made.kind, address: made.address })
    setDashboardBlocks(db, made.dashboard, [...blocks, viewBlock(made)])
  })
}

/* ------------------------------------------------------------- the chart */

/** A chart being made: a count or a sum, by month of which column, per which link, under which filter. */
export interface ChartMade {
  readonly dashboard: string | undefined
  readonly format: string
  /** The number or money column summed; absent is a count of the rows. */
  readonly sum: string | undefined
  /** The date column whose month a row falls in — or a month column, read as it is. */
  readonly period: string | undefined
  /** A link column the figure is per, as well as per month. */
  readonly by: string | undefined
  readonly filter: RowFilter
  /** What the person called it: `Done by month`. */
  readonly name: string
}

/** The columns a chart's month comes from: a date's month, or a month column. */
export function periodColumns(declaration: FormatDeclaration): readonly ColumnDeclaration[] {
  return declaration.columns.filter((each) => each.type === 'date' || each.type === 'month')
}

/** The links a chart's figure may be per. */
export function linkColumns(declaration: FormatDeclaration): readonly ColumnDeclaration[] {
  return declaration.columns.filter((each) => each.type === 'link')
}

/** The columns a chart's filter can hold: a rollup's filter is an enum's, a yes-or-no's or a date's window. */
export function chartFilterColumns(declaration: FormatDeclaration): readonly ColumnDeclaration[] {
  return declaration.columns.filter((each) => each.type === 'enum' || each.type === 'boolean' || each.type === 'date')
}

/**
 * The name a rollup is declared under, from what the person typed:
 * `Done by month` is `done_by_month`. A name with nothing left once folded —
 * Hebrew, say — is kept as typed, so the declaration says why it will not do.
 */
export function rollupName(words: string): string {
  const folded = words
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return folded === '' ? words.trim() : folded
}

/** A member as a rollup's filter writes it: quoted when it holds a space, a comma or a quote. */
function memberWord(value: string): string {
  return /[\s,"]/.test(value) ? `"${value.replace(/"/g, '')}"` : value
}

/** Whether a held value is the empty cell. */
function isEmptyHeld(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * **A filter as a rollup's `where`** — `state is done and due is within 14
 * days` — or why it cannot be one. A rollup's filter (D-260) holds an enum to
 * its members, a yes-or-no, a cell empty or not, and a date to a window around
 * today (D-472); it searches nothing and holds no range.
 */
export function chartWhere(filter: RowFilter): Result<string, string> {
  if ((filter.search?.trim() ?? '') !== '') {
    return err('A chart’s filter does not search: hold a column to its values instead.')
  }
  const parts: string[] = []
  for (const [column, value] of Object.entries(filter.match ?? {})) {
    if (typeof value === 'string' && parseClockWords(value) !== undefined) {
      parts.push(`${column} is ${value.trim().replace(/\s+/g, ' ').toLowerCase()}`)
      continue
    }
    if (typeof value === 'string' && parseFigureRange(value) !== undefined) {
      return err(`A chart’s filter holds no range, and ${column} is held to one.`)
    }
    const { values, not } = heldAs(value)
    const turned = not ? 'not ' : ''
    const empties = values.filter(isEmptyHeld)
    const members = values
      .filter((each) => !isEmptyHeld(each))
      .map((each) => (each === true || each === 1 || each === '1' ? 'true' : each === false || each === 0 || each === '0' ? 'false' : String(each)))
    if (empties.length > 0 && members.length > 0) {
      return err(`A chart’s filter holds ${column} empty or to its values, not both at once.`)
    }
    if (empties.length > 0) parts.push(`${column} is ${turned}empty`)
    else if (members.length === 1) parts.push(`${column} is ${turned}${memberWord(members[0] ?? '')}`)
    else if (members.length > 1) parts.push(`${column} is ${turned}one of ${members.map(memberWord).join(', ')}`)
  }
  return ok(parts.join(' and '))
}

/** The rollup a chart declares — `count by month of done_on where state is done` — or why none. */
export function chartRollup(declaration: FormatDeclaration, made: ChartMade): Result<RollupDeclaration, string> {
  if (made.sum !== undefined && !summableColumns(declaration).some((each) => each.name === made.sum)) {
    return err(`${declaration.title} has no number or money column called ${made.sum}.`)
  }
  const period = periodColumns(declaration).find((each) => each.name === made.period)
  if (period === undefined) {
    return err(
      periodColumns(declaration).length === 0
        ? `${declaration.title} has no date or month column, so a chart of it has no months to be by.`
        : 'Say which date the month is of.',
    )
  }
  const where = chartWhere(made.filter)
  if (!where.ok) return where
  const text = [
    made.sum === undefined ? 'count' : `sum of ${made.sum}`,
    'by',
    period.type === 'date' ? `month of ${period.name}` : period.name,
    ...(made.by === undefined ? [] : ['and', made.by]),
    ...(where.value === '' ? [] : ['where', where.value]),
  ].join(' ')
  return parseRollup(rollupName(made.name), text)
}

/** A chart judged and ready to write: the format with its rollup added, and the chart's block. */
export interface ChartPlan {
  readonly after: FormatDeclaration
  readonly rollup: RollupDeclaration
  readonly block: DashboardBlock
}

/**
 * **A chart, judged as the format's own edit is** — the declaration with the
 * rollup added, checked against the other formats and the units as
 * `extend_format` checks it, and a pack's format kept as the pack declared it.
 */
export function chartPlan(
  db: Database,
  declarations: readonly FormatDeclaration[],
  blocks: readonly DashboardBlock[],
  made: ChartMade,
): Result<ChartPlan, string> {
  const before = declarations.find((each) => each.name === made.format)
  if (before === undefined) return err(`${made.format} is not declared here any more.`)
  const rollup = chartRollup(before, made)
  if (!rollup.ok) return rollup
  if (blocks.some((each) => each.format === before.name && each.name === rollup.value.name)) {
    return err(`A block here is called ${rollup.value.name} already.`)
  }
  const after: FormatDeclaration = {
    ...before,
    language: DECLARATION_LANGUAGE,
    rollups: [...(before.rollups ?? []), rollup.value],
  }
  const problems = declarationProblems(
    after,
    declarations.filter((each) => each.name !== before.name),
    listUnits(db),
  )
  if (problems.length > 0) return err(problems.map((each) => each.message).join(' '))
  const owned = declarationChangeRefusal(before, after)
  if (owned !== undefined) return err(owned)
  return ok({
    after,
    rollup: rollup.value,
    block: { dashboard: made.dashboard, format: before.name, kind: 'rollup', name: rollup.value.name, address: '' },
  })
}

/**
 * **Declare the rollup and place its chart, together** — `adoptFormat` over
 * the format with it added, then the dashboard's blocks with its chart at the
 * end. Both or neither: a document that stopped agreeing between the plan and
 * now throws its refusal, and nothing is written.
 */
export function makeChart(db: Database, blocks: readonly DashboardBlock[], plan: ChartPlan): void {
  inTransaction(db, () => {
    const adopted = adoptFormat(db, plan.after, Date.now())
    if (adopted.refusals.length > 0) throw new Error(adopted.refusals.map((each) => each.detail).join(' '))
    setDashboardBlocks(db, plan.block.dashboard, [...blocks, plan.block])
  })
}
