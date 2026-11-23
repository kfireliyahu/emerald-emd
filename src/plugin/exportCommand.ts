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
 *
 * The tool `export_format_rows` is the same call from a conversation, and writes
 * only inside the document's folder (`tools/exportRows.ts`).
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath, sep } from 'node:path'

import { err, ok, type Result } from '@/core/result.ts'
import { indexOf, foldAggregate } from '@/data/repositories/formatJoinRepository.ts'
import { derivedOf } from '@/data/repositories/formatDerivedRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { linkLabels, listRows, readRow } from '@/data/repositories/formatRowRepository.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  cellValue,
  computedNames,
  exportText,
  exportValue,
  linkableColumn,
  type ComputedValue,
  type JsonValue,
} from '@/domain/format/export.ts'
import { idsIn, type StoredRow } from '@/domain/format/row.ts'
import { writeAtomically } from '../../electron/bridge.ts'

import { readDocument, type OpenDocument } from './document.ts'
import { askedOn, chosenColumns, filterArgs, resolve } from './tools/formats.ts'
import { ToolInputError } from './tools/tool.ts'

/** What one export asks of a document — the command line's flags and the tool's arguments alike. */
export interface ExportAsk {
  readonly format: string
  readonly match?: Readonly<Record<string, unknown>>
  readonly search?: string
  readonly order?: string
  readonly descending?: boolean
  /** Stored and computed columns to hold; every stored column when absent. */
  readonly columns?: readonly string[]
  /** A link column to the column of the linked format it goes out as, instead of the row's label. */
  readonly link?: Readonly<Record<string, string>>
  readonly ids?: boolean
}

/** The file's bytes, and what they hold. */
export interface Exported {
  readonly text: string
  readonly rows: number
  readonly format: string
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

/**
 * **The export, worked out on an open document** — refused with a sentence when
 * the format or an argument is wrong. Every matching row, in the asked order
 * (the label column by default, as `format_rows`), ties broken by the label
 * column and then the id.
 */
export function exportRows(document: OpenDocument, ask: ExportAsk): Result<Exported, string> {
  const resolved = resolve(document, ask.format)
  if ('refusal' in resolved) return err(resolved.refusal)
  const declaration = resolved.declaration
  try {
    const formats = listFormats(document.db)
    const computed = computedNames(declaration)
    const stored = ask.columns?.filter((name) => !computed.includes(name))
    if (stored !== undefined) chosenColumns(declaration, { columns: stored }, computed)
    const wantedComputed = (ask.columns ?? []).filter((name) => computed.includes(name))

    const order = ask.order ?? labelColumn(declaration)?.name
    if (order !== undefined && !declaration.columns.some((one) => one.name === order) && !computed.includes(order)) {
      throw new ToolInputError(
        `\`order\` names ${order}, which ${declaration.name} has not got. It has ${[...declaration.columns.map((one) => one.name), ...computed].join(', ')}.`,
      )
    }
    const chosen = ask.link ?? {}
    checkedLinks(declaration, formats, chosen)

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

    const value = exportValue(
      {
        declaration,
        ...(ask.columns === undefined ? {} : { columns: ask.columns }),
        linked: linkedValues(document, declaration, rows, formats, chosen),
        computed: figures,
        ids: ask.ids === true,
      },
      rows,
    )
    return ok({ text: exportText(value), rows: rows.length, format: declaration.name })
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

/** The line a check is answered in, and its exit code. */
export function checkAnswer(state: FileState, to: string, exported: Exported): { readonly code: number; readonly line: string } {
  const shown = shownPath(to)
  if (state === 'current') return { code: 0, line: `${shown} is current: ${rowsOf(exported.rows, exported.format)}.` }
  if (state === 'missing') return { code: 1, line: `${shown} is missing; the export would write ${rowsOf(exported.rows, exported.format)}.` }
  return { code: 1, line: `${shown} differs from ${rowsOf(exported.rows, exported.format)} as the document holds them now.` }
}

/** The line a write is told in. */
export function wroteLine(state: FileState, to: string, exported: Exported): string {
  return state === 'current'
    ? `${shownPath(to)} already holds ${rowsOf(exported.rows, exported.format)}; nothing to write.`
    : `Wrote ${rowsOf(exported.rows, exported.format)} to ${shownPath(to)}.`
}

// --- the command line ---------------------------------------------------------

export interface ExportArgs {
  readonly path: string
  readonly to: string
  readonly ask: ExportAsk
  readonly check: boolean
}

const EXPORT_USAGE =
  'Usage: node dist-plugin/server.mjs export <document.emd> --format <name> --to <file.json>\n' +
  '  [--match <column>=<value>]... [--search <text>] [--order <column>] [--descending]\n' +
  '  [--columns a,b] [--link <link column>=<column>]... [--ids] [--check]\n' +
  'Writes every matching row of one format as a JSON array; --check writes nothing and exits 1 when the file is not current.'

/** Reads `export`'s arguments — everything after the word `export`. */
export function parseExportArgs(argv: readonly string[], cwd: string): Result<ExportArgs, string> {
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
  if (format === undefined) return err(`export needs --format, the format whose rows it writes.\n${EXPORT_USAGE}`)
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
    },
  })
}

interface ExportOutput {
  /** What was written, or what a check found: stdout. */
  readonly line: (text: string) => void
  /** Why it could not: stderr. */
  readonly complain: (text: string) => void
}

/** Runs one export; resolves with the exit code. */
export async function runExport(args: ExportArgs, output: ExportOutput): Promise<number> {
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
