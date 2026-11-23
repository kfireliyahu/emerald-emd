/**
 * **A format's rows as an export's bytes, worked out on an open database**
 * (M63 U1, U2; moved here in M63 U4, D-605). The command line, the tool and the
 * desktop app's Settings › Export all work an export out here, so a file the app
 * calls current is the file `emerald-mcp export --check` calls current.
 *
 * Moved out of `src/plugin/exportCommand.ts` rather than copied: the app's
 * renderer has no Node, and what turns a saved request into bytes needs none.
 * The plugin keeps what does — opening a file, reading and writing on disk,
 * holding a path to the document's folder — and hands in its own clock and its
 * own way of naming a format it cannot find (`ExportContext`).
 *
 * Values are shaped by `src/domain/format/export.ts`; filtered by the same
 * `filterQuery` `format_rows` reads, its refusal in the same words.
 */

import type { Database } from 'sql.js'

import { ToolInputError } from '@/core/inputError.ts'
import { err, ok, type Result } from '@/core/result.ts'
import { labelColumn, type ColumnDeclaration, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  NEST_ONE_LEVEL,
  cellValue,
  childrenByParent,
  computedNames,
  exportText,
  exportValue,
  linkableColumn,
  linksBack,
  type ComputedValue,
  type ExportAsk,
  type ExportShape,
  type JsonValue,
  type NestAsk,
  type NestedShape,
} from '@/domain/format/export.ts'
import { currencyKeyOf, idsIn, unitKeyOf, type StoredRow } from '@/domain/format/row.ts'
import { savedExports } from '../packs/exports/saved.ts'
import { derivedOf } from '../repositories/formatDerivedRepository.ts'
import { filterQuery, type FilterRefusal, type RowFilter } from '../repositories/formatFilterRepository.ts'
import { indexOf, foldAggregate } from '../repositories/formatJoinRepository.ts'
import { listFormats } from '../repositories/formatRepository.ts'
import { linkLabels, listRows, readRow, type RowQuery } from '../repositories/formatRowRepository.ts'
import { listUnits } from '../repositories/unitRepository.ts'

/** A format found by name, or the sentence that says why it was not. */
export type Resolved = { readonly declaration: FormatDeclaration } | { readonly refusal: string }

/** What the caller hands in: the day it is asked on, and how it names a format it cannot find. */
export interface ExportContext {
  /** `YYYY-MM-DD`, the asking runtime's day — what a computed column and a window around today read (D-472). */
  readonly on: string
  /** The plugin's `resolve`, which knows to tell a model what to call; `declaredFormat` by default. */
  readonly resolve?: (name: string) => Resolved
}

/** A format this document declares, by name — or a sentence naming the ones it has. */
export function declaredFormat(db: Database, name: string): Resolved {
  const declared = listFormats(db)
  const declaration = declared.find((one) => one.name === name)
  if (declaration !== undefined) return { declaration }
  return {
    refusal:
      declared.length === 0
        ? `This document declares no formats, so it has no ${name}.`
        : `This document has no format called ${name}. It has ${declared.map((one) => one.name).join(', ')}.`,
  }
}

/**
 * The columns a caller asked to see, or every one of them — `format_rows`'
 * reading of `columns` (moved here from `plugin/tools/formats.ts` in M63 U4, so
 * the app's export holds a saved row's columns to the same sentence).
 */
export function chosenColumns(
  declaration: FormatDeclaration,
  args: Readonly<Record<string, unknown>>,
  worked: readonly string[] = [],
): readonly ColumnDeclaration[] {
  const raw = args['columns']
  if (raw === undefined || raw === null) return declaration.columns
  if (!Array.isArray(raw)) throw new ToolInputError('`columns` must be an array of column names.')

  return raw.map((name) => {
    if (typeof name !== 'string') throw new ToolInputError('`columns` must be an array of names.')
    const column = declaration.columns.find((one) => one.name === name)
    if (column === undefined) {
      throw new ToolInputError(
        `${declaration.name} has no column ${name}. It has ` +
          `${declaration.columns.map((one) => one.name).join(', ')}` +
          `${worked.length === 0 ? '' : `, and works out ${worked.join(', ')}`}.`,
      )
    }
    return column
  })
}

/** A refused filter, as a tool says it: which argument, and why. */
export function filterRefusalText(field: string, declaration: FormatDeclaration, refusal: FilterRefusal): string {
  return refusal.kind === 'NO_COLUMN'
    ? `\`${field}\` names ${refusal.name}, which ${declaration.name} has not got. It has ` +
        `${declaration.columns.map((one) => one.name).join(', ')}.`
    : `\`${field}\`: ${refusal.reason}`
}

/** A `match` and `search` as the `RowQuery` that finds their rows — refused, naming `match`, as `format_rows` refuses it. */
export function filteredQuery(
  db: Database,
  declaration: FormatDeclaration,
  filter: RowFilter,
  declarations: readonly FormatDeclaration[],
  on: string,
): RowQuery {
  const query = filterQuery(db, declaration, filter, declarations, on)
  if (!query.ok) throw new ToolInputError(filterRefusalText('match', declaration, query.error))
  return query.value
}

/** The file's bytes, and what they hold. */
export interface Exported {
  readonly text: string
  readonly rows: number
  readonly format: string
  /** How many rows of each folded-in format went into the file, in the order asked. */
  readonly nested?: readonly { readonly format: string; readonly rows: number }[]
}

/** What a link column goes out as, for each row it names: its label, or the chosen column's value. */
function linkedValues(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: readonly FormatDeclaration[],
  chosen: Readonly<Record<string, string>>,
): ReadonlyMap<string, ReadonlyMap<string, JsonValue>> {
  const labels = linkLabels(db, rows, declaration, formats)
  const out = new Map<string, Map<string, JsonValue>>()
  for (const column of declaration.columns) {
    if (column.type !== 'link' && column.type !== 'links') continue
    const ids = [...new Set(rows.flatMap((row) => idsIn(row.cells[column.name])))]
    const values = new Map<string, JsonValue>()
    const asked = chosen[column.name]
    const target = formats.find((each) => each.name === column.target)
    const shown = asked === undefined || target === undefined ? undefined : target.columns.find((each) => each.name === asked)
    for (const id of ids) {
      if (shown === undefined || target === undefined) {
        const label = labels.get(id)
        if (label !== undefined) values.set(id, label)
        continue
      }
      const linked = readRow(db, target, id)
      values.set(id, linked === undefined ? null : cellValue(shown, linked) ?? null)
    }
    out.set(column.name, values)
  }
  return out
}

/** `--link`'s pairs held to the declaration: a link column, and a column of what it links to. */
function checkedLinks(declaration: FormatDeclaration, formats: readonly FormatDeclaration[], chosen: Readonly<Record<string, string>>): void {
  for (const [name, wanted] of Object.entries(chosen)) {
    const column = declaration.columns.find((each) => each.name === name)
    if (column === undefined || (column.type !== 'link' && column.type !== 'links')) {
      const links = declaration.columns.filter((each) => each.type === 'link' || each.type === 'links').map((each) => each.name)
      throw new ToolInputError(
        `\`link\` names ${name}, which is not a link of ${declaration.name}. ` +
          (links.length === 0 ? `${declaration.name} links to nothing.` : `Its links are ${links.join(', ')}.`),
      )
    }
    const target = formats.find((each) => each.name === column.target)
    const shown = target?.columns.find((each) => each.name === wanted)
    if (target === undefined) throw new ToolInputError(`${name} links to ${column.target ?? 'a format'}, which this document no longer declares.`)
    if (shown === undefined) {
      throw new ToolInputError(`\`link\` asks ${name} as ${wanted}, which ${target.name} has not got. It has ${target.columns.map((each) => each.name).join(', ')}.`)
    }
    if (!linkableColumn(shown)) {
      throw new ToolInputError(
        `\`link\` asks ${name} as ${wanted}, a ${shown.type} column; a link goes out as one value that stands alone — text, a figure, a date, a member — so not money, a quantity or another link.`,
      )
    }
  }
}

/** `columns` and `order` held to a declaration — refused with a sentence naming what it has. */
function checkedColumns(declaration: FormatDeclaration, columns: readonly string[] | undefined, order: string | undefined): void {
  const computed = computedNames(declaration)
  const stored = columns?.filter((name) => !computed.includes(name))
  if (stored !== undefined) chosenColumns(declaration, { columns: stored }, computed)
  if (order !== undefined && !declaration.columns.some((one) => one.name === order) && !computed.includes(order)) {
    throw new ToolInputError(
      `\`order\` names ${order}, which ${declaration.name} has not got. It has ${[...declaration.columns.map((one) => one.name), ...computed].join(', ')}.`,
    )
  }
}

interface ShapeAsk {
  readonly columns?: readonly string[] | undefined
  readonly link?: Readonly<Record<string, string>>
  readonly ids?: boolean | undefined
  readonly omit?: string
}

/** One format's rows as the shaping wants them: their links' values and the computed columns asked for. */
function shapeOf(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: readonly FormatDeclaration[],
  ask: ShapeAsk,
  on: string,
): ExportShape {
  const computed = computedNames(declaration)
  const wantedComputed = (ask.columns ?? []).filter((name) => computed.includes(name))
  const figures = new Map<string, Map<string, ComputedValue>>()
  if (wantedComputed.length > 0) {
    const index = indexOf(formats)
    const units = listUnits(db)
    const derived = derivedOf(db, declaration, rows, index, units, on)
    const totals = declaration.aggregates.filter((each) => wantedComputed.includes(each.name))
    for (const row of rows) {
      const mine = new Map<string, ComputedValue>()
      for (const each of derived.get(row.id) ?? []) mine.set(each.compiled.declaration.name, each.value)
      for (const total of totals) mine.set(total.name, foldAggregate(db, total, row.id, index, units))
      figures.set(row.id, mine)
    }
  }
  return {
    declaration,
    ...(ask.columns === undefined ? {} : { columns: ask.columns }),
    linked: linkedValues(db, declaration, rows, formats, ask.link ?? {}),
    computed: figures,
    ids: ask.ids === true,
    ...(ask.omit === undefined ? {} : { omit: ask.omit }),
  }
}

/** Every key a parent's object can hold, so a nest's `as` cannot take one of them. */
function keysOf(declaration: FormatDeclaration): Set<string> {
  const keys = new Set<string>(['id'])
  for (const column of declaration.columns) {
    keys.add(column.name)
    if (column.type === 'money') keys.add(currencyKeyOf(column))
    if (column.type === 'quantity') keys.add(unitKeyOf(column))
  }
  for (const name of computedNames(declaration)) for (const key of [name, `${name}_currency`, `${name}_unit`]) keys.add(key)
  return keys
}

/** The link back a nest follows: the one `child` has to `parent`'s format, or the one its `child.link` names. */
function linkBack(child: FormatDeclaration, parent: FormatDeclaration, formats: readonly FormatDeclaration[], named: string | undefined): string {
  const backs = linksBack(formats, child.name, parent.name)
  if (named !== undefined) {
    if (backs.includes(named)) return named
    const column = child.columns.find((each) => each.name === named)
    throw new ToolInputError(
      `\`nest\` names ${child.name}.${named}, ${column === undefined ? `and ${child.name} has no column ${named}` : `which is not a link to ${parent.name}`}. ` +
        (backs.length === 0
          ? `${child.name} has no link to ${parent.name}.`
          : `Its links to ${parent.name}: ${backs.map((each) => `${child.name}.${each}`).join(', ')}.`),
    )
  }
  const [only, second] = backs
  if (only === undefined) {
    throw new ToolInputError(
      `\`nest\` names ${child.name}, which has no link to ${parent.name}, so none of its rows point at one. ` +
        'A nest folds in the rows of a format that links to the one exported.',
    )
  }
  if (second !== undefined) {
    throw new ToolInputError(
      `${child.name} links to ${parent.name} through ${backs.length === 2 ? 'two' : String(backs.length)} columns, ${backs.join(' and ')}; ` +
        `say which its rows are folded in by: ${backs.map((each) => `${child.name}.${each}`).join(' or ')}.`,
    )
  }
  return only
}

/** One child format folded into the exported rows — refused with a sentence when it cannot be. */
function nestedOf(
  db: Database,
  parent: FormatDeclaration,
  parents: readonly StoredRow[],
  formats: readonly FormatDeclaration[],
  nest: NestAsk,
  ids: boolean,
  context: Required<ExportContext>,
): { readonly shape: NestedShape; readonly rows: number } {
  const [name = '', named, deeper] = nest.format.split('.')
  if (deeper !== undefined) throw new ToolInputError(NEST_ONE_LEVEL(name))
  const resolved = context.resolve(name)
  if ('refusal' in resolved) throw new ToolInputError(resolved.refusal)
  const child = resolved.declaration
  const via = linkBack(child, parent, formats, named)
  if (nest.columns?.includes(via) === true) {
    throw new ToolInputError(
      `\`nest\` asks ${child.name} for ${via}, its link back to ${parent.name}; it is left out of each row folded in, since the row it is folded into is that row.`,
    )
  }
  const order = nest.order ?? labelColumn(child)?.name
  checkedColumns(child, nest.columns, order)
  const naming = labelColumn(child)?.name
  const wanted = new Set(parents.map((row) => row.id))
  const rows = listRows(db, child, {
    ...(order === undefined ? {} : { order }),
    ...(naming === undefined ? {} : { thenBy: naming }),
    descending: nest.descending ?? false,
  }).filter((row) => idsIn(row.cells[via]).some((id) => wanted.has(id)))
  return {
    shape: {
      as: nest.as ?? child.name,
      shape: shapeOf(db, child, rows, formats, { columns: nest.columns, ids, omit: via }, context.on),
      children: childrenByParent(via, rows),
    },
    rows: rows.length,
  }
}

/**
 * **The export, worked out on an open document** — refused with a sentence when
 * the format or an argument is wrong. Every matching row, in the asked order
 * (the label column by default, as `format_rows`), ties broken by the label
 * column and then the id; each nest's rows folded in after the row's own keys.
 */
export function exportRows(db: Database, ask: ExportAsk, given: ExportContext): Result<Exported, string> {
  const context: Required<ExportContext> = { on: given.on, resolve: given.resolve ?? ((name) => declaredFormat(db, name)) }
  const resolved = context.resolve(ask.format)
  if ('refusal' in resolved) return err(resolved.refusal)
  const declaration = resolved.declaration
  try {
    const formats = listFormats(db)
    const order = ask.order ?? labelColumn(declaration)?.name
    checkedColumns(declaration, ask.columns, order)
    const chosen = ask.link ?? {}
    checkedLinks(declaration, formats, chosen)
    const taken = keysOf(declaration)
    for (const nest of ask.nest ?? []) {
      const key = nest.as ?? nest.format.split('.')[0] ?? ''
      if (taken.has(key)) {
        throw new ToolInputError(
          `\`nest\` would fold ${nest.format} in as ${key}, a key each ${declaration.name} already has; give it another with as.`,
        )
      }
      taken.add(key)
    }

    const search = ask.search?.trim() === '' ? undefined : ask.search
    const query = filteredQuery(
      db,
      declaration,
      { ...(ask.match === undefined ? {} : { match: { ...ask.match } }), ...(search === undefined ? {} : { search }) },
      formats,
      context.on,
    )
    const naming = labelColumn(declaration)?.name
    const rows = listRows(db, declaration, {
      ...query,
      ...(order === undefined ? {} : { order }),
      ...(naming === undefined ? {} : { thenBy: naming }),
      descending: ask.descending ?? false,
    })

    const nests = (ask.nest ?? []).map((nest) => nestedOf(db, declaration, rows, formats, nest, ask.ids === true, context))
    const value = exportValue(
      {
        ...shapeOf(db, declaration, rows, formats, { columns: ask.columns, link: chosen, ids: ask.ids }, context.on),
        nested: nests.map((each) => each.shape),
      },
      rows,
    )
    return ok({
      text: exportText(value),
      rows: rows.length,
      format: declaration.name,
      ...(nests.length === 0 ? {} : { nested: nests.map((each) => ({ format: each.shape.shape.declaration.name, rows: each.rows })) }),
    })
  } catch (error) {
    if (error instanceof ToolInputError) return err(error.message)
    throw error
  }
}

/** One saved export worked out: its file as the row holds it, and its bytes or why there are none. */
export interface SavedExportText {
  readonly file: string
  readonly exported: Result<Exported, string>
}

/**
 * **Every saved export a document lists, worked out** (M63 U3, U4): the rows of
 * the exports pack's `export` format, each turned into bytes as `exportRows`
 * turns one, a row that cannot be read keeping its sentence. Where the file
 * goes is the caller's: the command line and the shell each hold it to the
 * document's folder themselves.
 */
export function savedExportTexts(db: Database, context: ExportContext): Result<readonly SavedExportText[], string> {
  const saved = savedExports(db)
  if (!saved.ok) return saved
  return ok(saved.value.map((each) => ({ file: each.file, exported: each.ask.ok ? exportRows(db, each.ask.value, context) : each.ask })))
}
