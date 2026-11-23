/**
 * **`export`: a format's rows to a JSON file** (M63 U1, D-601).
 *
 *     node dist-plugin/server.mjs export docs/memory.emd --format decision --to decisions.json
 *
 * Rows left a document only through a model; a project that wanted them for its
 * build opened the `.emd`'s SQLite tables with a script of its own, and could
 * not have read one stored as text. This is the way out D-285 named: the same
 * filters as `format_rows`, every matching row, and the same bytes every time,
 * so a build can run it and `--check` can fail a CI job when the file is stale.
 *
 * - **A subcommand of the one server file**, beside `init` and `watch` — never a
 *   second bin (D-441's reason, D-601).
 * - **The document is opened through `readDocument`**, the one gate every read
 *   tool goes through, so a document stored as text and one stored as SQLite
 *   bytes give the same file.
 * - **Filtered by `format_rows`' own code** — `filterArgs`, `chosenColumns` —
 *   never a copy of it, and **shaped by `src/domain/format/export.ts`**, which the
 *   app's button reuses in the renderer.
 * - **Written atomically**: a temporary file beside it, renamed over it.
 * - **`--check` writes nothing**: 0 when the file holds exactly these bytes, 1
 *   when it differs or is missing, 2 for an argument or a format that is wrong.
 * - **`--nest` folds a child format in** (M63 U2): the rows whose link points at
 *   each exported row, as an array under a key of their own. One spec string —
 *   `keyword.card as=keywords order=position` — so a saved export can hold one
 *   per line (U3) and the tool takes the same string.
 *
 * The tool `export_format_rows` is the same call from a conversation, and writes
 * only inside the document's folder (`tools/exportRows.ts`).
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'

import { err, ok, type Result } from '@/core/result.ts'
import { indexOf, foldAggregate } from '@/data/repositories/formatJoinRepository.ts'
import { derivedOf } from '@/data/repositories/formatDerivedRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { NO_SAVED_EXPORTS, savedExports } from '@/data/packs/exports/saved.ts'
import { linkLabels, listRows, readRow } from '@/data/repositories/formatRowRepository.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  NEST_FORM,
  NEST_ONE_LEVEL,
  cellValue,
  childrenByParent,
  computedNames,
  exportText,
  exportValue,
  linkableColumn,
  linksBack,
  parseNest,
  type ComputedValue,
  type ExportAsk,
  type ExportShape,
  type JsonValue,
  type NestAsk,
  type NestedShape,
} from '@/domain/format/export.ts'
import { currencyKeyOf, idsIn, unitKeyOf, type StoredRow } from '@/domain/format/row.ts'
import { writeAtomically } from '../../electron/bridge.ts'

import { readDocument, type OpenDocument } from './document.ts'
import { askedOn, chosenColumns, filterArgs, resolve } from './tools/formats.ts'
import { ToolInputError } from './tools/tool.ts'

export { NEST_ONE_LEVEL, parseNest, type ExportAsk, type NestAsk }

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
  document: OpenDocument,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: readonly FormatDeclaration[],
  chosen: Readonly<Record<string, string>>,
): ReadonlyMap<string, ReadonlyMap<string, JsonValue>> {
  const labels = linkLabels(document.db, rows, declaration, formats)
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
      const linked = readRow(document.db, target, id)
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
  document: OpenDocument,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: readonly FormatDeclaration[],
  ask: ShapeAsk,
): ExportShape {
  const computed = computedNames(declaration)
  const wantedComputed = (ask.columns ?? []).filter((name) => computed.includes(name))
  const figures = new Map<string, Map<string, ComputedValue>>()
  if (wantedComputed.length > 0) {
    const index = indexOf(formats)
    const units = listUnits(document.db)
    const derived = derivedOf(document.db, declaration, rows, index, units, askedOn())
    const totals = declaration.aggregates.filter((each) => wantedComputed.includes(each.name))
    for (const row of rows) {
      const mine = new Map<string, ComputedValue>()
      for (const each of derived.get(row.id) ?? []) mine.set(each.compiled.declaration.name, each.value)
      for (const total of totals) mine.set(total.name, foldAggregate(document.db, total, row.id, index, units))
      figures.set(row.id, mine)
    }
  }
  return {
    declaration,
    ...(ask.columns === undefined ? {} : { columns: ask.columns }),
    linked: linkedValues(document, declaration, rows, formats, ask.link ?? {}),
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
  document: OpenDocument,
  parent: FormatDeclaration,
  parents: readonly StoredRow[],
  formats: readonly FormatDeclaration[],
  nest: NestAsk,
  ids: boolean,
): { readonly shape: NestedShape; readonly rows: number } {
  const [name = '', named, deeper] = nest.format.split('.')
  if (deeper !== undefined) throw new ToolInputError(NEST_ONE_LEVEL(name))
  const resolved = resolve(document, name)
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
  const rows = listRows(document.db, child, {
    ...(order === undefined ? {} : { order }),
    ...(naming === undefined ? {} : { thenBy: naming }),
    descending: nest.descending ?? false,
  }).filter((row) => idsIn(row.cells[via]).some((id) => wanted.has(id)))
  return {
    shape: {
      as: nest.as ?? child.name,
      shape: shapeOf(document, child, rows, formats, { columns: nest.columns, ids, omit: via }),
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
export function exportRows(document: OpenDocument, ask: ExportAsk): Result<Exported, string> {
  const resolved = resolve(document, ask.format)
  if ('refusal' in resolved) return err(resolved.refusal)
  const declaration = resolved.declaration
  try {
    const formats = listFormats(document.db)
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

    const { query } = filterArgs(
      document.db,
      declaration,
      { ...(ask.match === undefined ? {} : { match: ask.match }), ...(ask.search === undefined ? {} : { search: ask.search }) },
      formats,
    )
    const naming = labelColumn(declaration)?.name
    const rows = listRows(document.db, declaration, {
      ...query,
      ...(order === undefined ? {} : { order }),
      ...(naming === undefined ? {} : { thenBy: naming }),
      descending: ask.descending ?? false,
    })

    const nests = (ask.nest ?? []).map((nest) => nestedOf(document, declaration, rows, formats, nest, ask.ids === true))
    const value = exportValue(
      {
        ...shapeOf(document, declaration, rows, formats, { columns: ask.columns, link: chosen, ids: ask.ids }),
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

/**
 * Opens the document through `readDocument` and exports from it. A refusal —
 * the document's, the format's or an argument's — comes back as its sentence.
 */
export async function exportFrom(path: string, ask: ExportAsk): Promise<Result<Exported, string>> {
  let answer: Result<Exported, string> | undefined
  const said = await readDocument(path, (document) => {
    answer = exportRows(document, ask)
    return ''
  })
  return answer ?? err(said)
}

/** What a file holds against what an export would write. */
export type FileState = 'current' | 'differs' | 'missing'

export async function fileState(to: string, text: string): Promise<FileState> {
  const held = await readFile(to, 'utf8').catch(() => undefined)
  if (held === undefined) return 'missing'
  return held === text ? 'current' : 'differs'
}

/** Writes the bytes atomically — a temporary file beside it, renamed over it — making its folder if need be. */
export async function writeExport(to: string, text: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  await writeAtomically({ pid: process.pid, writeFile, rename, unlink }, to, new TextEncoder().encode(text))
}

/** A path the way the inbox's `from` writes one: forward slashes, on every platform. */
export function shownPath(path: string): string {
  return sep === '\\' ? path.split('\\').join('/') : path
}

function rowsOf(count: number, format: string): string {
  return `${String(count)} ${count === 1 ? 'row' : 'rows'} of ${format}`
}

/** `3 rows of card` — and `, with 5 rows of keyword folded in` when a nest asked for them. */
function heldIn(exported: Exported): string {
  const folded = (exported.nested ?? []).map((each) => rowsOf(each.rows, each.format))
  const last = folded.at(-1)
  const said = folded.length <= 1 ? last : `${folded.slice(0, -1).join(', ')} and ${last ?? ''}`
  return `${rowsOf(exported.rows, exported.format)}${said === undefined ? '' : `, with ${said} folded in`}`
}

/** The line a check is answered in, and its exit code. */
export function checkAnswer(state: FileState, to: string, exported: Exported): { readonly code: number; readonly line: string } {
  const shown = shownPath(to)
  if (state === 'current') return { code: 0, line: `${shown} is current: ${heldIn(exported)}.` }
  if (state === 'missing') return { code: 1, line: `${shown} is missing; the export would write ${heldIn(exported)}.` }
  return { code: 1, line: `${shown} differs from ${heldIn(exported)} as the document holds them now.` }
}

/** The line a write is told in. */
export function wroteLine(state: FileState, to: string, exported: Exported): string {
  return state === 'current'
    ? `${shownPath(to)} already holds ${heldIn(exported)}; nothing to write.`
    : `Wrote ${heldIn(exported)}${(exported.nested ?? []).length > 0 ? ',' : ''} to ${shownPath(to)}.`
}

// --- the command line ---------------------------------------------------------

export interface ExportArgs {
  readonly path: string
  readonly to: string
  readonly ask: ExportAsk
  readonly check: boolean
}

/** `export <document.emd>` alone: every saved export it lists (M63 U3). */
export interface SavedArgs {
  readonly path: string
  readonly check: boolean
  readonly saved: true
}

const EXPORT_USAGE =
  'Usage: node dist-plugin/server.mjs export <document.emd> [--check]\n' +
  '  writes every saved export the document lists (the exports pack\'s `export` rows); or one export:\n' +
  '       node dist-plugin/server.mjs export <document.emd> --format <name> --to <file.json>\n' +
  '  [--match <column>=<value>]... [--search <text>] [--order <column>] [--descending]\n' +
  '  [--columns a,b] [--link <link column>=<column>]... [--ids] [--check]\n' +
  '  [--nest "<child>[.<link>] [as=<key>] [order=<column>] [descending] [columns=a,b]"]...\n' +
  'Writes every matching row of one format as a JSON array; --check writes nothing and exits 1 when a file is not current.'

/** Reads `export`'s arguments — everything after the word `export`. */
export function parseExportArgs(argv: readonly string[], cwd: string): Result<ExportArgs | SavedArgs, string> {
  let path: string | undefined
  let format: string | undefined
  let to: string | undefined
  let search: string | undefined
  let order: string | undefined
  let columns: string[] | undefined
  let descending = false
  let ids = false
  let check = false
  const match = new Map<string, string[]>()
  const link: Record<string, string> = {}
  const nest: NestAsk[] = []
  const pairOf = (flag: string, pair: string | undefined, example: string): Result<readonly [string, string], string> => {
    const equals = pair?.indexOf('=') ?? -1
    if (pair === undefined || equals <= 0) return err(`${flag} takes column=value, as in ${flag} ${example}.\n${EXPORT_USAGE}`)
    return ok([pair.slice(0, equals), pair.slice(equals + 1)] as const)
  }
  for (let at = 0; at < argv.length; at += 1) {
    const word = argv[at] as string
    const [flag, inline] = word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined]
    const value = (): string | undefined => inline ?? argv[(at += 1)]
    const needed = (what: string): Result<string, string> => {
      const given = value()
      return given === undefined || given === '' ? err(`${flag} needs ${what}.\n${EXPORT_USAGE}`) : ok(given)
    }
    if (flag === '--format' || flag === '--to' || flag === '--search' || flag === '--order' || flag === '--columns') {
      const given = needed(flag === '--format' ? "a format's name" : flag === '--to' ? 'a file to write' : flag === '--columns' ? 'column names, a,b' : 'a value')
      if (!given.ok) return given
      if (flag === '--format') format = given.value
      else if (flag === '--to') to = resolvePath(cwd, given.value)
      else if (flag === '--search') search = given.value
      else if (flag === '--order') order = given.value
      else columns = given.value.split(',').map((each) => each.trim()).filter((each) => each !== '')
    } else if (flag === '--match') {
      const pair = pairOf(flag, value(), 'state=planned')
      if (!pair.ok) return pair
      match.set(pair.value[0], [...(match.get(pair.value[0]) ?? []), pair.value[1]])
    } else if (flag === '--link') {
      const pair = pairOf(flag, value(), 'milestone=ref')
      if (!pair.ok) return pair
      link[pair.value[0]] = pair.value[1]
    } else if (flag === '--nest') {
      const given = needed(`a nest, ${NEST_FORM}`)
      if (!given.ok) return given
      const parsed = parseNest(given.value)
      if (!parsed.ok) return err(`${parsed.error}\n${EXPORT_USAGE}`)
      nest.push(parsed.value)
    } else if (flag === '--descending' || flag === '--ids' || flag === '--check') {
      if (inline !== undefined) return err(`${flag} takes no value.\n${EXPORT_USAGE}`)
      if (flag === '--descending') descending = true
      else if (flag === '--ids') ids = true
      else check = true
    } else if (flag.startsWith('--')) {
      return err(`export does not know ${flag}.\n${EXPORT_USAGE}`)
    } else if (path === undefined) {
      path = resolvePath(cwd, word)
    } else {
      return err(`export takes one document; ${word} is a second.\n${EXPORT_USAGE}`)
    }
  }
  if (path === undefined) return err(`export needs a document.\n${EXPORT_USAGE}`)
  if (format === undefined) {
    // **No --format: every saved export the document lists** (M63 U3, D-601).
    const asked = [
      to === undefined ? undefined : '--to',
      match.size > 0 ? '--match' : undefined,
      search === undefined ? undefined : '--search',
      order === undefined ? undefined : '--order',
      descending ? '--descending' : undefined,
      columns === undefined ? undefined : '--columns',
      Object.keys(link).length > 0 ? '--link' : undefined,
      ids ? '--ids' : undefined,
      nest.length > 0 ? '--nest' : undefined,
    ].filter((each) => each !== undefined)
    if (asked.length > 0) {
      return err(
        `${asked.join(', ')} ${asked.length === 1 ? 'goes' : 'go'} with --format; without it, export writes every saved export the document lists.\n${EXPORT_USAGE}`,
      )
    }
    return ok({ path, check, saved: true })
  }
  if (to === undefined) return err(`export needs --to, the file it writes.\n${EXPORT_USAGE}`)
  return ok({
    path,
    to,
    check,
    ask: {
      format,
      ...(match.size === 0 ? {} : { match: Object.fromEntries([...match].map(([key, values]) => [key, values.length === 1 ? values[0] : values])) }),
      ...(search === undefined ? {} : { search }),
      ...(order === undefined ? {} : { order }),
      ...(descending ? { descending } : {}),
      ...(columns === undefined ? {} : { columns }),
      ...(Object.keys(link).length === 0 ? {} : { link }),
      ...(ids ? { ids } : {}),
      ...(nest.length === 0 ? {} : { nest }),
    },
  })
}

interface ExportOutput {
  /** What was written, or what a check found: stdout. */
  readonly line: (text: string) => void
  /** Why it could not: stderr. */
  readonly complain: (text: string) => void
}

/** Runs one export, or every saved one; resolves with the exit code. */
export async function runExport(args: ExportArgs | SavedArgs, output: ExportOutput): Promise<number> {
  if ('saved' in args) {
    const run = await runSaved(args.path, args.check)
    if (!run.ok) {
      output.complain(run.error)
      return 2
    }
    for (const each of run.value.outcomes) (each.state === 'refused' ? output.complain : output.line)(each.line)
    return run.value.code
  }
  const exported = await exportFrom(args.path, args.ask)
  if (!exported.ok) {
    output.complain(exported.error)
    return 2
  }
  const state = await fileState(args.to, exported.value.text)
  if (args.check) {
    const answer = checkAnswer(state, args.to, exported.value)
    output.line(answer.line)
    return answer.code
  }
  if (state !== 'current') await writeExport(args.to, exported.value.text)
  output.line(wroteLine(state, args.to, exported.value))
  return 0
}

// --- every saved export (M63 U3) ----------------------------------------------

/**
 * `file` against the document's folder: the path to write, or `undefined` when
 * it leaves that folder. A saved export's file is always relative to it — on
 * the command line too, unlike `--to` — and the tool's `to` is held to it
 * (D-601), so a document someone sends cannot make either write anywhere else.
 */
export function withinFolder(documentPath: string, file: string): string | undefined {
  const folder = dirname(resolvePath(documentPath))
  const target = resolvePath(folder, file)
  const inside = relative(folder, target)
  return inside === '' || inside.startsWith('..') || isAbsolute(inside) ? undefined : target
}

/** What became of one saved export, and the line that says so. */
export interface SavedOutcome {
  /** As the row holds it. */
  readonly file: string
  readonly state: 'written' | FileState | 'refused'
  readonly line: string
}

/** Every saved export's outcome, in file order, and the exit code they make. */
export interface SavedRun {
  readonly outcomes: readonly SavedOutcome[]
  /** 0 all written or current; 1 a check found one stale or missing; 2 one was refused. */
  readonly code: number
}

/**
 * **Writes — or, with `check`, checks — every saved export a document lists**
 * (M63 U3, D-601): the rows of the exports pack's `export` format, each worked
 * out as `exportRows` works out one. A file outside the document's folder, a
 * format or column the document has not got, or a row that cannot be read is
 * reported and the others carry on; the run then exits 2. A document with none
 * is refused with `NO_SAVED_EXPORTS`, which names the pack.
 */
export async function runSaved(path: string, check: boolean): Promise<Result<SavedRun, string>> {
  let worked: Result<readonly { readonly file: string; readonly exported: Result<Exported, string> }[], string> | undefined
  const said = await readDocument(path, (document) => {
    const saved = savedExports(document.db)
    worked = saved.ok
      ? ok(saved.value.map((each) => ({ file: each.file, exported: each.ask.ok ? exportRows(document, each.ask.value) : each.ask })))
      : saved
    return ''
  })
  if (worked === undefined) return err(said)
  if (!worked.ok) return worked
  if (worked.value.length === 0) return err(NO_SAVED_EXPORTS)

  const folder = shownPath(dirname(resolvePath(path)))
  const outcomes: SavedOutcome[] = []
  for (const { file, exported } of worked.value) {
    const refused = (why: string): SavedOutcome => ({ file, state: 'refused', line: `${file} was ${check ? 'not checked' : 'not written'}: ${why}` })
    const to = withinFolder(path, file)
    if (to === undefined) {
      outcomes.push(refused(`it is outside ${folder}, and a saved export writes only inside the document's folder and the folders under it.`))
      continue
    }
    if (!exported.ok) {
      outcomes.push(refused(exported.error))
      continue
    }
    const state = await fileState(to, exported.value.text)
    if (check) {
      outcomes.push({ file, state, line: checkAnswer(state, to, exported.value).line })
      continue
    }
    if (state !== 'current') await writeExport(to, exported.value.text)
    outcomes.push({ file, state: state === 'current' ? 'current' : 'written', line: wroteLine(state, to, exported.value) })
  }
  const refusedAny = outcomes.some((each) => each.state === 'refused')
  const stale = outcomes.some((each) => each.state === 'differs' || each.state === 'missing')
  return ok({ outcomes, code: refusedAny ? 2 : stale ? 1 : 0 })
}
