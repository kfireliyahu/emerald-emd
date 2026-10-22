/**
 * **Reading a document onto a declared format, from a conversation** — M20 U7,
 * [D-235](../../../docs/09-decision-log.md).
 *
 * The half M19 U5 left out and U6 counted. `IntakePanel` has read a spreadsheet
 * onto a declared format since D-226, and the tool that met it in the same
 * `coerceRow` was the ledger's `import_statement` — which reads onto the pack's
 * transactions table and can never read onto a declared one. So intake had a
 * screen and no tool, and a person whose four hundred lines were in a file could
 * only be told to go and click.
 *
 * These two are the general form of `statement_preview` and `import_statement`.
 * **Nothing here parses anything** — `readWorkbook` reads the file, `readTableOf`
 * hands the engine a rectangle of typed cells, and `guessReading`, `readRows`
 * and `tally` are the same functions the screen calls. What is new is that the
 * caller is a conversation rather than a person in front of a grid, and that
 * changes exactly two things:
 *
 * 1. **The mapping has to be legible in text.** The grid shows a column, the key
 *    it is bound to and six rows of the file all at once; the dry run prints the
 *    same three things as a table, with the header cell beside every binding.
 *    That is not decoration: a remembered reading follows a moved column by its
 *    header cell (M26 F1), and the sample beside the key is how a person sees
 *    that it followed the right one.
 * 2. **A link the caller names has to be checked.** On the screen a fixed link
 *    is a select over rows that exist, so it cannot dangle. A tool takes an id
 *    somebody typed, `REFERENCES` enforces nothing in this app (D-067), and
 *    `insertRows` would write it. So `danglingLinks` runs here and the screen
 *    gets it for free — the same check, arrived at from the side that needs it.
 *    And since M24 U9 (D-261) a column of the file may fill a link by the
 *    target's unique name, which only this side offers yet: the screen's select
 *    still holds a link fixed, and `parity.md` is where that trails.
 *
 * ## Two tools and not three
 *
 * The pack splits the preview from the import because `statement_preview` is
 * read-only and the mapping loop is iterative (D-013). **Here the dry run *is*
 * the preview**: `mutatingCall` opens the document with `PRAGMA query_only`,
 * prints the mapping, the rows and the verdict, and writes nothing until
 * `commit: true`. A third tool saying the same thing with a different
 * annotation is the cost D-095's note warns about — and adding one later is
 * cheap, where removing one is not.
 *
 * ## The proof is the declaration's, and the two counts stay two
 *
 * `tally(declaration, stagedRows(read))` is D-226's sentence: the confirm
 * surface does not verify the import, the document does. **Rows that would not
 * type** and **rows that do not add up** are printed as two counts and neither
 * is folded into the other, because a surface reporting one number for both
 * would be claiming a proof it never ran (D-138).
 */

import { readFile, readdir, stat } from 'node:fs/promises'

import { readTableOf } from '@/data/intake/sheetReading.ts'
import {
  isNoteFileName,
  itemSections,
  itemsFileName,
  itemsHash,
  itemsTable,
  fileLinkCount,
  isHiddenFileName,
  noteIndex,
  noteItems,
  notesDigestText,
  notesTable,
  parseNote,
  type ItemsFrom,
  type Note,
  type ParsedNote,
} from '@/domain/format/notes.ts'
import { isJsonFileName, jsonRowsTables } from '@/domain/format/jsonRows.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import { SEEDED_UNITS } from '@/domain/format/unit.ts'
import { auditWritten, planBatch, writeBatch, type BatchFile } from '@/data/intake/batchReading.ts'
import { rehearse } from '@/data/db/database.ts'
import {
  headerRefuses,
  intakeRequestOf,
  lineCounts,
  planChanges,
  planReading,
  planWrites,
  removableGone,
  type PlannedRereading,
  type ReadingPlan,
} from '@/data/intake/readingPlan.ts'
import {
  isSupportedFileName,
  SUPPORTED_EXTENSIONS,
} from '@/data/importer/sheetTable.ts'
import {
  forgetReader,
  formatsReadFrom,
  listIntakes,
  listReaders,
  recordIntake,
  renameReader,
  supersedeIntake,
  type Intake,
  type RereadCounts,
} from '@/data/repositories/formatIntakeRepository.ts'
import { listFormats, rowCountOf } from '@/data/repositories/formatRepository.ts'
import { formatsNamed, indexOf } from '@/data/repositories/formatJoinRepository.ts'
import { findingSentence, tallySentence, type FormatAudit } from '@/domain/format/audit.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  closeSentence,
  fitReader,
  readerId,
  readerName,
  type CloseWhy,
  type Reader,
} from '@/domain/format/reader.ts'
import {
  guessReading,
  PENDING_HEADER,
  positionRow,
  proseLinkNames,
  stagedRows,
  type DateOrder,
  type ReadResult,
  type ReadTable,
  type Reading,
  type ReadingHeader,
} from '@/domain/format/reading.ts'
import { keySentence } from '@/domain/format/reread.ts'
import { offeredKeysOf, type StoredRow } from '@/domain/format/row.ts'
import { verdictSentence } from '@/domain/format/identity.ts'

import { openDocument, type OpenDocument } from '../document.ts'
import { count, instant, paragraphs, plural, section, table as asTable, verb } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { cutShort, resolveWritable, rowBlock } from './formats.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalNumber,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'
import { readFileOffered, readSheetOffered, sha256Hex } from '../files.ts'

/** Rows that would not type, listed one by one before the list becomes noise. */
const PROBLEM_ROWS = 20

/** Rows printed in full as they would be stored. Enough to catch a wrong column. */
const STORED_ROWS = 3

/** Where a long text is cut in a dry run's rows, and in the mapping's first values (M38 U1). */
const LONG_TEXT = 200
const SAMPLE_TEXT = 60

const DATE_ORDERS: readonly DateOrder[] = ['dmy', 'mdy', 'ymd']

const FILE_PROP = stringProp(
  `Absolute path to the file to read: one of ${SUPPORTED_EXTENSIONS.join(', ')}, a .json file of rows ` +
    '(an array of objects, or an object holding one), a Markdown note (.md), or **a folder of notes** — ' +
    'every .md file in it is one row, and a hidden one (a name starting with a dot) none.',
)

const RECURSIVE_PROP = booleanProp(
  'A folder of notes: its subfolders’ notes too (not a hidden one), with a `folder` column, the path under it.',
)

// --- the file ---------------------------------------------------------------

interface Loaded {
  readonly fileName: string
  readonly hash: string
  readonly sheetName: string
  readonly sheets: readonly string[]
  readonly table: ReadTable
  /** A folder of notes (M34 U7): each note, parsed — one row each. */
  readonly notes?: readonly ParsedNote[]
  /** What the folder held that is not a note, and was not read. */
  readonly skipped?: readonly string[]
  /** The body links that named a file that is not a note — an image — left out and counted (M48 U2). */
  readonly fileLinks?: number
  /**
   * The notes' list items or table rows, read as a table of their own (M38
   * U4): which, under which heading, and the folder the notes' own rows are
   * read from — what each item's `note` names.
   */
  readonly items?: { readonly from: ItemsFrom; readonly under: string | undefined; readonly source: string; readonly units: readonly string[] }
}

/** Notes one call reads, across every folder of it. A vault, not an archive. */
const NOTES_MAX = 5000

/**
 * A Markdown note, or a folder of them, as one table (M34 U7) — `notesTable`
 * over every `.md` file directly in the folder. A folder inside it is a folder
 * of its own, read by naming it — or, with `recursive` (M48 U2), read with it:
 * every note under it, each named by its path and carrying its folder, a
 * hidden folder never entered. Anything else is named as skipped, so every
 * file in the folder is accounted for.
 */
async function loadNotes(path: string, folder: boolean, recursive = false): Promise<Loaded> {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
  const notes: Note[] = []
  const skipped: string[] = []
  const walk = async (under: string): Promise<void> => {
    const entries = await readdir(under === '' ? path : `${path}/${under}`, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const at = under === '' ? entry.name : `${under}/${entry.name}`
      if (entry.isFile() && isNoteFileName(entry.name)) {
        if (notes.length >= NOTES_MAX) {
          throw new ToolInputError(`${name} holds more than the ${count(NOTES_MAX)} notes this reads in one call.`)
        }
        notes.push({ file: at, text: await readFile(`${path}/${at}`, 'utf8') })
      } else if (recursive && entry.isDirectory() && !isHiddenFileName(entry.name)) {
        await walk(at)
      } else {
        skipped.push(entry.isDirectory() ? `${at}/` : at)
      }
    }
  }
  try {
    if (folder) {
      await walk('')
    } else {
      notes.push({ file: name, text: await readFile(path, 'utf8') })
    }
  } catch (error) {
    if (error instanceof ToolInputError) throw error
    throw new ToolInputError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (notes.length === 0) {
    throw new ToolInputError(
      `${name} holds no .md note${skipped.length === 0 ? '' : ` — only ${skipped.slice(0, 10).join(', ')}`}. ` +
        (recursive ? '' : 'A folder inside it is read by naming that folder, or with `recursive: true`.'),
    )
  }
  if (notes.length > NOTES_MAX) {
    throw new ToolInputError(`${name} holds ${count(notes.length)} notes, more than the ${count(NOTES_MAX)} this reads in one call.`)
  }
  const parsed = notes.map(parseNote)
  return {
    fileName: folder ? `${name}/` : name,
    hash: sha256Hex(notesDigestText(notes)),
    sheetName: '',
    sheets: [],
    table: notesTable(parsed),
    notes: parsed,
    skipped,
    fileLinks: fileLinkCount(parsed),
  }
}

/**
 * A .json file of rows (M48 U2): an array of objects, or an object holding one
 * — read as a `.csv` is, its keys the header and an array under a key a sheet
 * named by it. Hashed over its bytes, as every file is.
 */
async function loadJsonRows(file: string, sheetName: string | undefined): Promise<Loaded> {
  const { bytes, fileName, hash } = await readFileOffered(file)
  const read = jsonRowsTables(new TextDecoder().decode(bytes))
  if (!read.ok) throw new ToolInputError(`${fileName} is not a file of rows: ${read.reason}.`)
  const sheets = read.tables.map((each) => each.name).filter((each) => each !== '')
  const chosen = sheetName === undefined ? read.tables[0] : read.tables.find((each) => each.name === sheetName)
  if (chosen === undefined) {
    throw new ToolInputError(
      `No array of rows under "${sheetName ?? ''}" in ${fileName}.` +
        (sheets.length === 0 ? ' It is one array, with no keys to choose from.' : ` It has: ${sheets.join(', ')}.`),
    )
  }
  return { fileName, hash, sheetName: chosen.name, sheets, table: chosen.table }
}

/**
 * Every folder of a call, its links resolved against every note the call reads
 * — so a recipe in one folder names an ingredient in another by its title.
 */
function withNotesAcross<T extends { readonly loaded: Loaded }>(asked: readonly T[]): readonly T[] {
  // A folder read for its notes and for its items is one folder of notes.
  const seen = new Set<string>()
  const all = asked.flatMap((each) => {
    const source = each.loaded.items?.source ?? each.loaded.fileName
    if (each.loaded.notes === undefined || seen.has(source)) return []
    seen.add(source)
    return each.loaded.notes
  })
  if (all.length === 0) return asked
  const index = noteIndex(all)
  return asked.map((each) => {
    const { notes, items } = each.loaded
    if (notes === undefined) return each
    const table = items === undefined ? notesTable(notes, index) : itemsTable(notes, items, index)
    return { ...each, loaded: { ...each.loaded, table, fileLinks: fileLinkCount(notes, index) } }
  })
}

/**
 * A folder's items as a file of their own (M38 U4): the same notes, the items
 * table over them, named and hashed as which items they are. An `under` that
 * names no heading an item sits under is refused, naming the ones that do.
 */
function asItems(loaded: Loaded, from: ItemsFrom, under: string | undefined, units: readonly string[]): Loaded {
  const notes = loaded.notes
  if (notes === undefined) {
    throw new ToolInputError(`\`items\` reads a note's list items or table rows, and ${loaded.fileName} is not a note or a folder of them.`)
  }
  const what = from === 'list' ? 'list item' : 'table row'
  const count = notes.reduce((sum, note) => sum + noteItems(note.body, from).length, 0)
  if (count === 0) throw new ToolInputError(`${loaded.fileName} holds no ${what} in any note's body.`)
  if (under !== undefined && notes.every((note) => noteItems(note.body, from, under).length === 0)) {
    const sections = itemSections(notes, from)
    throw new ToolInputError(
      `No ${what} of ${loaded.fileName} is under a heading called ${under}. ` +
        (sections.length === 0 ? 'Its items are under no heading at all.' : `Its items are under ${sections.join(', ')}.`),
    )
  }
  const items = { from, under, source: loaded.fileName, units }
  return {
    ...loaded,
    fileName: itemsFileName(loaded.fileName, from, under),
    hash: itemsHash(loaded.hash, from, under),
    table: itemsTable(notes, items),
    items,
  }
}

/** `items` and `under`, from a call's arguments or one file's entry. */
function itemsFrom(args: Args): { readonly from: ItemsFrom; readonly under: string | undefined } | undefined {
  const raw = args['items']
  if (raw === undefined || raw === null) return undefined
  if (raw !== 'list' && raw !== 'table') {
    throw new ToolInputError('`items` is "list" — a note’s list items — or "table" — the rows of a table in its body.')
  }
  const under = optionalString(args, 'under')
  return { from: raw, under: under === undefined || under.trim() === '' ? undefined : under.trim() }
}

/** The unit symbols the document knows, for an item's `unit` — the seeded ones when it cannot be opened. */
async function documentUnits(path: string): Promise<readonly string[]> {
  const opened = await openDocument(path)
  if (!opened.ok) return SEEDED_UNITS.map((unit) => unit.symbol)
  try {
    return listUnits(opened.value.db).map((unit) => unit.symbol)
  } finally {
    opened.value.db.close()
  }
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The file, as a rectangle of typed cells and a hash.
 *
 * **The hash is of the whole file and the table is of one sheet**, which is the
 * same asymmetry the pack has and it is deliberate on both sides: the narrowest
 * sameness this engine asserts is *the same file* (D-226), and a workbook whose
 * two sheets are two statements is still one file. Reading the second sheet of
 * a file whose first is already in therefore offers to supersede — which is
 * wrong, and is a smaller wrong than an engine inventing what makes two rows
 * the same row. It is in `review.md` rather than fixed here.
 */
async function loadFile(file: string, sheetName: string | undefined, recursive = false): Promise<Loaded> {
  if (isNoteFileName(file)) return loadNotes(file, false)
  if (await isFolder(file)) return loadNotes(file, true, recursive)
  if (isJsonFileName(file)) return loadJsonRows(file, sheetName)
  if (!isSupportedFileName(file)) {
    throw new ToolInputError(
      `Only ${SUPPORTED_EXTENSIONS.join(', ')} and .json files, .md notes and folders of them can be read ` +
        `onto a format; ${file} is not one. A PDF or a photograph is read by you, and written ` +
        'with `record_format_rows`.',
    )
  }

  // The hash is `sha256Hex`, the same digest `hashBytes` computes in the app.
  const { sheet, sheets, fileName, hash } = await readSheetOffered(file, sheetName)
  return {
    fileName,
    hash,
    sheetName: sheet.name,
    sheets,
    table: readTableOf(sheet),
  }
}

// --- the reading ------------------------------------------------------------

/** How the mapping in front of the caller was arrived at. Said in every answer. */
type Source = 'given' | 'remembered' | 'guessed'

interface Resolved {
  readonly reading: Reading
  readonly source: Source
  /** The reader a remembered reading came from, so the answer can name its file. */
  readonly from: Reader | undefined
  /** A column that reader reads is elsewhere in this file, and was followed by name (M26 F1). */
  readonly moved: boolean
  /** The reader that nearly fitted and was not used, and why (M26 F1). */
  readonly close: { readonly reader: Reader; readonly why: CloseWhy } | undefined
}

/**
 * The `columns` argument: column number → key of the format.
 *
 * Checked against `offeredKeysOf`, which is the same list `record_format_rows`
 * offers and the same list the grid's select is built from — one vocabulary,
 * so a key that works in a conversation works in a file (D-226).
 *
 * **`null` maps a column to nothing** (M38 U1): the guess bound a column the
 * person does not want read, and refusing `null` sent a model back with all
 * forty keys to drop one. A key is `null` only for its column.
 */
function columnsFrom(
  args: Args,
  declaration: FormatDeclaration,
): readonly { index: number; key: string | null }[] | undefined {
  const raw = args['columns']
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolInputError('`columns` must be an object of column number → key, or → null to read nothing from it.')
  }

  const known = offeredKeysOf(declaration)
  const bound: { index: number; key: string | null }[] = []
  for (const [at, value] of Object.entries(raw as Record<string, unknown>)) {
    const index = Number(at)
    if (!Number.isInteger(index) || index < 0) {
      throw new ToolInputError(`\`columns\` keys are column numbers; "${at}" is not one.`)
    }
    if (value === null) {
      bound.push({ index, key: null })
      continue
    }
    if (typeof value !== 'string' || !known.includes(value)) {
      throw new ToolInputError(
        `\`columns["${at}"]\` must be one of ${known.join(', ')}, or null to read nothing from it; got "${String(value)}".`,
      )
    }
    bound.push({ index, key: value })
  }
  return bound.sort((a, b) => a.index - b.index)
}

/**
 * The caller's `columns` over the mapping it was shown (M38 U1): a column it
 * names takes that key — off whichever column held it before — a column it
 * maps to `null` reads nothing, and a column it does not name keeps what the
 * dry run showed. A list the file wrote as a list is split as the file joined
 * it, as the guess does.
 */
function overMapping(
  shown: Reading['columns'],
  given: readonly { index: number; key: string | null }[],
  declaration: FormatDeclaration,
  table: ReadTable,
): Reading['columns'] {
  const named = new Set(given.map((each) => each.index))
  const keys = new Set(given.flatMap((each) => (each.key === null ? [] : [each.key])))
  const kept = shown.filter((each) => !named.has(each.index) && !keys.has(each.key))
  const added = given.flatMap((each) => {
    if (each.key === null) return []
    const separator = table.separators?.[each.index]
    const type = declaration.columns.find((column) => column.name === each.key)?.type
    return [
      separator !== undefined && (type === 'enums' || type === 'links')
        ? { index: each.index, key: each.key, separator }
        : { index: each.index, key: each.key },
    ]
  })
  return [...kept, ...added].sort((a, b) => a.index - b.index)
}

/**
 * The `separators` argument: key → what splits one cell of its column into
 * members (M34 U5, D-398). Only an `enums` key is split, and only by what the
 * caller states; `readingProblems` refuses one on any other key.
 */
function separatorsFrom(args: Args, declaration: FormatDeclaration): ReadonlyMap<string, string> | undefined {
  const raw = args['separators']
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolInputError('`separators` must be an object of key → what splits its cells, like { "tags": "," }.')
  }
  const lists = declaration.columns.filter((one) => one.type === 'enums').map((one) => one.name)
  const held = new Map<string, string>()
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!lists.includes(key)) {
      throw new ToolInputError(
        lists.length === 0
          ? `\`separators\` names ${key}, and ${declaration.name} has no column holding several of a list.`
          : `\`separators\` names ${key}, which is not one of ${lists.join(', ')} — the columns holding several of a list.`,
      )
    }
    if (typeof value !== 'string' || value === '') {
      throw new ToolInputError(`\`separators["${key}"]\` must be the text that splits a cell, like ",".`)
    }
    held.set(key, value)
  }
  return held
}

/** The `fixed` argument: a key whose value is the same on every row of this file. */
function fixedFrom(args: Args, declaration: FormatDeclaration): readonly { key: string; value: string }[] | undefined {
  const raw = args['fixed']
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolInputError('`fixed` must be an object of key → value.')
  }

  const known = offeredKeysOf(declaration)
  const held: { key: string; value: string }[] = []
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.includes(key)) {
      throw new ToolInputError(`\`fixed\` names ${key}, which is not one of ${known.join(', ')}.`)
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new ToolInputError(`\`fixed["${key}"]\` must be a string or a number.`)
    }
    held.push({ key, value: String(value) })
  }
  return held
}

/**
 * The `header` argument: the one row of another format this file also writes
 * (M24 U10, D-262). **Cells are positions** — `[row, column]`, a row below zero
 * counting from the file's end — because a model says where the printed total
 * is and code reads it (D-137). The keys are checked by `headerProblems`, which
 * says what is wrong in a sentence rather than here in a throw.
 */
function headerFrom(args: Args): ReadingHeader | undefined {
  const raw = args['header']
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolInputError('`header` must be an object: { format, link, cells, fixed }.')
  }
  const given = raw as Record<string, unknown>
  const format = given['format']
  const link = given['link']
  if (typeof format !== 'string' || format === '' || typeof link !== 'string' || link === '') {
    throw new ToolInputError(
      '`header` needs `format` — the format the header row is a row of — and `link`, the ' +
        'column of the format being read that points at it.',
    )
  }

  const cells: { key: string; row: number; index: number }[] = []
  const rawCells = given['cells'] ?? {}
  if (typeof rawCells !== 'object' || rawCells === null || Array.isArray(rawCells)) {
    throw new ToolInputError('`header.cells` must be an object of key → [row, column].')
  }
  for (const [key, at] of Object.entries(rawCells as Record<string, unknown>)) {
    if (
      !Array.isArray(at) ||
      at.length !== 2 ||
      !at.every((each) => typeof each === 'number' && Number.isInteger(each))
    ) {
      throw new ToolInputError(
        `\`header.cells["${key}"]\` must be [row, column], counting from 0; a row below 0 counts ` +
          'from the last row of the file that holds anything, so -1 is the last.',
      )
    }
    cells.push({ key, row: Number(at[0]), index: Number(at[1]) })
  }

  const fixed: { key: string; value: string }[] = []
  const rawFixed = given['fixed'] ?? {}
  if (typeof rawFixed !== 'object' || rawFixed === null || Array.isArray(rawFixed)) {
    throw new ToolInputError('`header.fixed` must be an object of key → value.')
  }
  for (const [key, value] of Object.entries(rawFixed as Record<string, unknown>)) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new ToolInputError(`\`header.fixed["${key}"]\` must be a string or a number.`)
    }
    fixed.push({ key, value: String(value) })
  }

  return { format, link, cells, fixed }
}

function dateOrderFrom(args: Args): DateOrder | undefined {
  const stated = optionalString(args, 'date_order')
  if (stated === undefined) return undefined
  if (!DATE_ORDERS.includes(stated as DateOrder)) {
    throw new ToolInputError(`\`date_order\` must be one of ${DATE_ORDERS.join(', ')}; got "${stated}".`)
  }
  return stated as DateOrder
}

/**
 * The reading this call is about — the ladder, as F17 states it and as the
 * screen draws it.
 *
 * Three rungs: what the caller sent, else a reading this document already has
 * for a file with **exactly** this header, else a guess. The middle rung is
 * `fitReader`'s: the same header cell for cell, with a column that moved
 * followed by its name (M26 F1) and a reader that cannot follow one named and
 * not taken.
 */
/** The notes another file of the same call writes onto a format, by title — where a body link may resolve. */
type Alongside = readonly { readonly format: string; readonly names: ReadonlySet<string> }[]

function resolveReading(
  document: OpenDocument,
  declaration: FormatDeclaration,
  loaded: Loaded,
  args: Args,
  formats: ReturnType<typeof indexOf>,
  alongside: Alongside = [],
  parent?: string,
): Resolved {
  // A body's links are guessed onto the `links` column pointing where they
  // resolve (M38 U2): rows the document holds, or notes another file writes.
  const mentioned = proseLinkNames(loaded.table)
  const into = mentioned.length === 0 ? undefined : formatsNamed(document.db, declaration, mentioned, formats, alongside)
  // A folder's items go back to the format its notes are read onto (M38 U4).
  const guess = guessReading(declaration, loaded.table, formats, into, parent ?? parentInDocument(document, declaration, loaded))
  const headerRow = optionalNumber(args, 'header_row')
  const columns = columnsFrom(args, declaration)
  const fixed = fixedFrom(args, declaration)
  const order = dateOrderFrom(args)
  const header = headerFrom(args)
  const separators = separatorsFrom(args, declaration)

  // Every reader the format has, the one that fits taken — the same
  // `fitReader` the bulk reading screen picks with (M26 U5).
  const fit = fitReader(declaration, listReaders(document.db, declaration.name), loaded.table, formats)
  const exact = fit.kind === 'FITS' ? fit : undefined

  // `columns` is applied over the mapping the caller was shown — the reading
  // this document already has, else the guess — not instead of it (M38 U1).
  const base = exact !== undefined ? exact.reading : guess
  const source: Source = columns !== undefined ? 'given' : exact !== undefined ? 'remembered' : 'guessed'
  // A remembered reading brings its header back with it (U10) — the printed
  // total is where it was, counted from the end — unless the caller sent one.
  const withHeader = header ?? base.header

  return {
    reading: {
      format: declaration.name,
      headerRow: headerRow === undefined ? base.headerRow : Math.max(0, Math.floor(headerRow)),
      dateOrder: order ?? base.dateOrder,
      columns: (columns === undefined ? base.columns : overMapping(base.columns, columns, declaration, loaded.table)).map((each) => {
        const separator = separators?.get(each.key)
        return separator === undefined ? each : { ...each, separator }
      }),
      fixed: fixed ?? base.fixed,
      ...(withHeader === undefined ? {} : { header: withHeader }),
    },
    source,
    from: source === 'remembered' ? exact?.reader : undefined,
    moved: source === 'remembered' && exact?.moved === true,
    close: fit.kind === 'CLOSE' ? { reader: fit.reader, why: fit.why } : undefined,
  }
}

/**
 * The format a folder's items go back to when its notes are not read in the
 * same call (M38 U4): the one this format links to that the folder was read
 * onto before.
 */
function parentInDocument(document: OpenDocument, declaration: FormatDeclaration, loaded: Loaded): string | undefined {
  const source = loaded.items?.source
  if (source === undefined) return undefined
  const read = new Set(formatsReadFrom(document.db, source))
  const targets = [
    ...new Set(
      declaration.columns.flatMap((column) =>
        column.type === 'link' && column.target !== undefined && read.has(column.target) ? [column.target] : [],
      ),
    ),
  ]
  return targets.length === 1 ? targets[0] : undefined
}

/** A folder of notes' own titles, for a link between two of its notes (M38 U4). */
function ownNotes(declaration: FormatDeclaration, loaded: Loaded): Alongside {
  return loaded.notes === undefined || loaded.items !== undefined
    ? []
    : [{ format: declaration.name, names: new Set(loaded.notes.map((note) => note.title)) }]
}

// --- read_onto_format -------------------------------------------------------

/**
 * The plan, which since M26 U5 is `planReading`'s — the bulk reading screen
 * judges a file with the same calls — plus how its reading was arrived at.
 */
interface Plan extends Omit<ReadingPlan, 'blocked'> {
  readonly declaration: FormatDeclaration | undefined
  readonly blocked: string | undefined
  readonly resolved: Resolved | undefined
  readonly existing: number
  /** What the engine would see in the formats written, once they are (M34 U3, D-396). */
  readonly audits: readonly FormatAudit[]
  /** `remove_gone`: take away the rows of a source read again whose line is gone (D-408). */
  readonly removeGone: boolean
}

/** A plan with nothing in it but the reason it is refused. */
function refusedPlan(blocked: string): Plan {
  return {
    declaration: undefined,
    resolved: undefined,
    problems: [],
    dangling: [],
    repeated: [],
    broken: [],
    read: undefined,
    lines: undefined,
    shown: new Map<string, StoredRow>(),
    proof: undefined,
    failing: [],
    header: undefined,
    units: undefined,
    prior: undefined,
    keys: [],
    key: { kind: 'NONE' },
    again: undefined,
    unkeyed: undefined,
    existing: 0,
    audits: [],
    removeGone: false,
    blocked,
  }
}

/** `planReading`'s answer, with how its reading was arrived at. */
function planFrom(
  plan: ReadingPlan,
  declaration: FormatDeclaration,
  resolved: Resolved,
  existing: number,
  removeGone = false,
): Plan {
  if (plan.blocked !== undefined) return refusedPlan(plan.blocked)
  return { ...plan, declaration, blocked: undefined, resolved, existing, audits: [], removeGone }
}

/** `remove_gone`, from a call's arguments or one file's entry. */
function removeGoneFrom(args: Args): boolean {
  return args['remove_gone'] === true
}

function planOf(document: OpenDocument, name: string, loaded: Loaded, args: Args): Plan {
  const found = resolveWritable(document, name)
  if ('refusal' in found) return refusedPlan(found.refusal)

  const declaration = found.declaration
  const formats = indexOf(listFormats(document.db))
  const resolved = resolveReading(document, declaration, loaded, args, formats, ownNotes(declaration, loaded))
  const existing = rowCountOf(document.db, declaration)
  const plan = planReading(document.db, declaration, loaded.table, { name: loaded.fileName, hash: loaded.hash }, resolved.reading, formats)
  // What the engine would see once it is written: the write, rehearsed and
  // taken back (M34 U3, D-396), so it is said before the commit.
  const removeGone = removeGoneFrom(args)
  const file = { name: loaded.fileName, hash: loaded.hash, removeGone }
  const audits = planWrites(plan)
    ? rehearse(document.db, () => {
        recordIntake(
          document.db,
          intakeRequestOf(plan, declaration, resolved.reading, loaded.table, file, Date.now(), formats),
        )
        return auditWritten(document.db, [{ declaration, reading: resolved.reading }], formats)
      })
    : []
  return { ...planFrom(plan, declaration, resolved, existing, removeGone), audits }
}

/**
 * **What is wrong, said without being asked** (M34 U3, D-396): what the engine
 * sees in each format a read wrote — a link left empty where the rest are
 * filled, rows alike in every column, an identity failed or unchecked.
 */
export function auditText(audits: readonly FormatAudit[], once: boolean): string | undefined {
  if (audits.length === 0) return undefined
  const clean = audits.filter((each) => each.findings.length === 0)
  return paragraphs(
    ...audits
      .filter((each) => each.findings.length > 0)
      .map((each) =>
        section(
          `What looks wrong in ${each.title}${once ? ', once this is written' : ''}`,
          each.findings.map((finding) => `- ${findingSentence(finding)}`).join('\n'),
        ),
      ),
    clean.length === 0
      ? undefined
      : `Nothing looks wrong in ${clean.map((each) => each.title).join(', ')}: no link left empty ` +
          'where the rest are filled, no two rows alike, no claim failed or unchecked.',
  )
}

/**
 * Nothing would be written: a refused document, a broken reading, no row that
 * types — or a source read again with nothing changed in it (D-408).
 */
function writesNothing(plan: Plan): boolean {
  if (
    plan.blocked !== undefined ||
    plan.problems.length > 0 ||
    plan.dangling.length > 0 ||
    plan.repeated.length > 0 ||
    headerRefuses(plan)
  ) {
    return true
  }
  if (plan.again !== undefined) return !planChanges(plan, plan.removeGone)
  return (plan.read?.rows ?? []).every((row) => row.cells === undefined)
}

/** At most this many rows named under each heading of a read again. */
const AGAIN_NAMED = 20

/**
 * **A source read before, read again** (M38 U3, D-408): what this read changes,
 * adds and finds gone, each row named — the dry run's answer in place of
 * *what would be written*, since most of the file is already in.
 */
function againText(plan: Plan, again: PlannedRereading): string {
  const title = plan.declaration?.title ?? ''
  const named = (row: { readonly key: string; readonly name: string | undefined }): string =>
    row.name === undefined || row.name === row.key ? `“${row.key}”` : `“${row.name}” (${row.key})`
  const listed = <T,>(rows: readonly T[], line: (row: T) => string): string =>
    rows.slice(0, AGAIN_NAMED).map((row) => `- ${line(row)}`).join('\n') +
    (rows.length > AGAIN_NAMED ? `\n- and ${count(rows.length - AGAIN_NAMED)} more` : '')
  const removable = new Set(removableGone(again))
  const removing = plan.removeGone ? removable.size : 0
  const changes = planChanges(plan, plan.removeGone)
  // A file not read before whose lines a unique column finds in rows already
  // there — last month's export, or typed by hand (M50 U3).
  const found = `${plural(again.elsewhere, 'line')} ${verb(again.elsewhere, 'names a row', 'name rows')} ${title} already holds ${keySentence(again.key)}`
  return paragraphs(
    section(
      again.readBefore ? 'Read before — what this read changes' : `Already in ${title} — what this read changes`,
      (again.readBefore
        ? `**${again.from}** was read onto ${title} before, each line found again ${keySentence(again.key)}` +
          (again.elsewhere === 0 ? '. ' : `, and ${found} from another file or by hand. `)
        : `**${again.from}** was not read onto ${title} before, but ${found}: each is that row, not a second one. `) +
        `This read changes ${plural(again.changed.length, 'row')}, adds ${count(again.added.length)}, and finds ` +
        `${count(again.same)} as ${verb(again.same, 'it was', 'they were')}` +
        (again.gone.length === 0 ? '.' : `; ${count(again.gone.length)} ${verb(again.gone.length, 'row has', 'rows have')} no line any more.`) +
        (changes
          ? ''
          : again.readBefore
            ? ' **Nothing has changed since the last read**, so there is nothing to write.'
            : ' **Every line is already there as the file says it**, so there is nothing to write.'),
    ),
    again.changed.length === 0
      ? undefined
      : `**Changed**, written over with what the file says now:\n${listed(again.changed, (row) => `${named(row)}: ${row.columns.join(', ')}`)}`,
    again.added.length === 0
      ? undefined
      : `**Added**:\n${listed(again.added, (key) => `“${key}”`)}`,
    again.edited.length === 0
      ? undefined
      : `**Changed in the document since the last read**, so left as ${verb(again.edited.length, 'it is', 'they are')} — a ` +
        `value somebody typed is never written over by a read:\n${listed(again.edited, named)}`,
    again.gone.length === 0
      ? undefined
      : `**Gone from the file**, ${plan.removeGone ? 'taken away on commit' : 'kept'}:\n` +
        listed(again.gone, (row) =>
          `${named(row)}${again.linked.has(row.rowId) ? ' — another row links to it, so it stays' : ''}`,
        ) +
        (plan.removeGone || removable.size === 0
          ? ''
          : `\n\nNothing is removed unasked. Send \`remove_gone: true\` to take ${removable.size === 1 ? 'it' : `these ${count(removable.size)}`} away.`),
    removing === 0 ? undefined : `${plural(removing, 'row')} will be taken away.`,
  )
}

/** A read again, written: its counts in a sentence (D-408). */
function againWritten(counts: RereadCounts): string {
  return (
    `${plural(counts.changed, 'row')} changed, ${count(counts.added)} added, ${count(counts.same)} as ${verb(counts.same, 'it was', 'they were')}` +
    (counts.edited === 0 ? '' : `, ${count(counts.edited)} left as changed in the document`) +
    (counts.removed === 0 ? '' : `, ${count(counts.removed)} taken away as gone`) +
    (counts.gone === 0 ? '' : `, ${count(counts.gone)} gone from the file and kept`) +
    '.'
  )
}

function sourceLine(plan: Plan): string {
  const resolved = plan.resolved
  if (resolved === undefined) return ''
  switch (resolved.source) {
    case 'given':
      return (
        'The reader below is your `columns` over the one shown before: a column you named takes ' +
        'its key, one you sent as null reads nothing, and one you did not name kept its key.'
      )
    case 'remembered':
      return (
        'The reader below is the one this document already used for ' +
        `**${resolved.from === undefined ? 'a file' : readerName(resolved.from)}**, whose header is the same as this one` +
        (resolved.moved
          ? ' **in a different order** — every column it reads was followed to where its header ' +
            'cell is in this file. Check the sample beside each key before you commit.'
          : '.')
      )
    default:
      return paragraphs(
        resolved.close === undefined
          ? undefined
          : `The reader for **${readerName(resolved.close.reader)}** was not used: ${closeSentence(resolved.close.why)}`,
        'The reader below is a **guess** and nothing more. Check it with the user, ' +
          'and send `columns` to correct whatever it got wrong.',
      )
  }
}

/**
 * The mapping, with the file's own header and a sample value beside every key.
 *
 * This is the grid said in text, and the sample is the part that matters: a
 * binding printed as `amount → 3` is unreadable, and `column 3 "סכום" → amount,
 * e.g. 12,000.00` is a wrong column somebody can see.
 */
function mappingText(loaded: Loaded, plan: Plan): string {
  const resolved = plan.resolved
  const declaration = plan.declaration
  if (resolved === undefined || declaration === undefined) return ''

  const reading = resolved.reading
  const header = loaded.table.rows[reading.headerRow] ?? []
  const bound = new Map(
    reading.columns.map((each) => [
      each.index,
      each.separator === undefined ? each.key : `${each.key}, split by "${each.separator}"`,
    ]),
  )

  const sampleOf = (index: number): string => {
    for (let line = reading.headerRow + 1; line < loaded.table.rows.length; line += 1) {
      const cell = loaded.table.rows[line]?.[index]
      if (cell !== undefined && cell.kind !== 'empty') return cutShort(cell.text, SAMPLE_TEXT)
    }
    return '-'
  }

  const rows = Array.from({ length: loaded.table.columnCount }, (_, index) => [
    String(index),
    header[index]?.text ?? '-',
    bound.get(index) ?? '(ignored)',
    sampleOf(index),
  ])

  const unbound = offeredKeysOf(declaration).filter(
    (key) => !reading.columns.some((each) => each.key === key) &&
      !reading.fixed.some((each) => each.key === key),
  )

  return paragraphs(
    section('The reader', asTable(['Column', 'Header cell', 'Key', 'First value'], rows)),
    reading.fixed.length === 0
      ? undefined
      : asTable(
          ['Fixed for the whole file', 'Value'],
          reading.fixed.map((each) => [each.key, each.value]),
        ),
    unbound.length === 0
      ? undefined
      : `Nothing fills ${unbound.join(', ')}. A column of the file can, with \`columns\`, or one ` +
        'value for every row can, with `fixed` — a currency the whole export is in, a unit it is ' +
        'measured in, or the one row every line of it belongs to.',
  )
}

/**
 * A folder's head line: how many notes, what was not a note, and the format
 * (M34 U7). Every file in the folder is accounted for — read as a row, or
 * named here as skipped.
 */
function notesHead(loaded: Loaded, declaration: FormatDeclaration, plan: Plan): string {
  const items = loaded.items
  if (items !== undefined) {
    const rows = Math.max(0, loaded.table.rows.length - 1)
    return (
      `**${loaded.fileName}** — ${plural(rows, items.from === 'list' ? 'item' : 'table row')} from ` +
      `${plural(loaded.notes?.length ?? 0, 'note')}, one row each, each named by its note and place. Columns are ` +
      '`note` (the file it sits in, which fills the link to that note’s row), `section` (the heading it is under), ' +
      '`position`, then ' +
      (items.from === 'list'
        ? '`item` as written, `checked` for a task item, `figure` and `unit` (a leading figure and a unit this ' +
          'document knows), `link` (the first note it links to) and `text` (the words left).'
        : 'the table’s own header cells.') +
      ` Onto **${declaration.title}** (\`${declaration.name}\`), which holds ${plural(plan.existing, 'row')}.`
    )
  }
  const skipped = loaded.skipped ?? []
  const fileLinks = loaded.fileLinks ?? 0
  const nested = loaded.notes?.some((note) => note.folder !== '') === true
  return (
    `**${loaded.fileName}** — ${plural(loaded.notes?.length ?? 0, 'note')}, one row each` +
    (skipped.length === 0
      ? ''
      : `; ${plural(skipped.length, 'other file')} not read (${skipped.slice(0, 10).join(', ')}` +
        `${skipped.length > 10 ? ', …' : ''})`) +
    (fileLinks === 0
      ? ''
      : `; ${plural(fileLinks, 'body link')} to a file that is not a note (an image, a PDF) left out`) +
    '. Columns are `title` (the frontmatter’s, else the file name), `file`, ' +
    (nested ? '`folder` (its path under the one read), ' : '') +
    'each frontmatter ' +
    'key, `inline tags` when a body writes `#tags`, `body links` when it links to a note, and ' +
    '`body`, whole; a link is read from `[[name]]` or `[text](file.md)` as the title of the note ' +
    'it names, and a body link that names no row is left out and named, never a refusal. ' +
    `Onto **${declaration.title}** (\`${declaration.name}\`), which holds ${plural(plan.existing, 'row')}.`
  )
}

/** A row's own line of the file — or a note's file name — as the person can go and look at it. */
function problemRows(read: ReadResult, table?: ReadTable): string {
  const failed = read.rows.filter((row) => row.cells === undefined)
  if (failed.length === 0) return ''
  const named = table?.rowNames !== undefined
  const items = table?.keyedBy !== undefined
  return paragraphs(
    section(
      `${plural(failed.length, items ? 'item' : named ? 'note' : 'row')} would not be read`,
      asTable(
        [items ? 'Item' : named ? 'Note' : 'Line', 'Why'],
        failed
          .slice(0, PROBLEM_ROWS)
          .map((row) => [
            table?.rowNames?.[row.line] ?? String(row.line + 1),
            cutShort(row.problem ?? 'It did not type.', LONG_TEXT * 2),
          ]),
      ),
    ),
    failed.length > PROBLEM_ROWS ? `…and ${count(failed.length - PROBLEM_ROWS)} more.` : undefined,
    '**They are left where they are.** Fix the reader or the file and read it again — reading ' +
      'the same file twice offers to take back what it wrote the first time.',
  )
}

/**
 * The body links that named no row, by note (M38 U2) — left out of the rows
 * and said here, since a link in prose is a mention and not a refusal.
 */
function unlinkedText(read: ReadResult, table?: ReadTable): string | undefined {
  const left = read.rows.flatMap((row) =>
    row.cells === undefined ? [] : (row.unlinked ?? []).map((each) => ({ line: row.line, each })),
  )
  if (left.length === 0) return undefined
  return paragraphs(
    section(
      `${plural(left.length, 'body link')} ${verb(left.length, 'names', 'name')} no row, and ${verb(left.length, 'is', 'are')} left out`,
      asTable(
        ['Note', 'Link', 'Why'],
        left
          .slice(0, PROBLEM_ROWS)
          .map(({ line, each }) => [table?.rowNames?.[line] ?? String(line + 1), each.name, each.reason]),
      ),
    ),
    left.length > PROBLEM_ROWS ? `…and ${count(left.length - PROBLEM_ROWS)} more.` : undefined,
    'Each note is still read. Add the row a link names and read the folder again to fill it.',
  )
}

/**
 * What the format says has to add up, over rows that do not exist yet.
 *
 * **The two counts are separate and neither is folded into the other** (D-138):
 * *would not be read* is a fact about reading the file, *does not add up* is a
 * fact about what it says, and one number for both would be a proof nobody ran.
 */
function proofText(plan: Plan): string {
  const declaration = plan.declaration
  const proof = plan.proof
  if (declaration === undefined || proof === undefined) return ''

  if (declaration.identities.length === 0) {
    return (
      'This format makes no claim, so there is ' +
      'nothing to check these rows against beyond their types.'
    )
  }
  return paragraphs(
    section(
      'What this format claims',
      `${count(proof.proved)} proved · ${count(proof.failed)} failed · ` +
        `${count(proof.unchecked)} unchecked, over the rows above, **before one of them exists**.`,
    ),
    plan.failing.length === 0
      ? undefined
      : asTable(
          ['Line', 'What it fails'],
          plan.failing.slice(0, PROBLEM_ROWS).map((each) => [each.id.replace(/^line /, ''), each.sentences.join(' ')]),
        ),
    plan.failing.length > PROBLEM_ROWS ? `…and ${count(plan.failing.length - PROBLEM_ROWS)} more.` : undefined,
    'That verdict is the declaration’s and not this tool’s: nothing here verifies the import, ' +
      'the document does. `unchecked` is the ordinary answer for a row with nothing in a column ' +
      'a claim names, and a row a claim fails on is still written — a label whose macros ' +
      'come to 61.6 against a printed 62 is a real label.',
  )
}

function priorText(plan: Plan): string | undefined {
  const prior = plan.prior
  if (prior === undefined) return undefined
  return (
    `**This exact file was read on ${instant(prior.readAt)} and wrote ` +
    `${plural(prior.rowCount, 'row')}.** Reading it again adds to them. Call ` +
    `\`supersede_reading\` with \`reading: "${prior.id}"\` first if what you want is to replace ` +
    'them — it takes back exactly those rows and no others.'
  )
}

function describePlan(loaded: Loaded, plan: Plan): string {
  if (plan.blocked !== undefined) return plan.blocked
  const declaration = plan.declaration
  const resolved = plan.resolved
  if (declaration === undefined || resolved === undefined) return 'No format resolved.'

  const head = loaded.notes !== undefined
    ? notesHead(loaded, declaration, plan)
    : `**${loaded.fileName}** — ${loaded.sheetName === '' ? 'its rows' : `sheet \`${loaded.sheetName}\``}` +
    `${loaded.sheets.length > 1 ? ` of ${count(loaded.sheets.length)} (${loaded.sheets.join(', ')})` : ''}, ` +
    `${plural(loaded.table.rows.length, 'line')}, header on line ` +
    // **Both numbers, because they are not the same number.** A person counts
    // lines from one and `header_row` counts from zero, and a caller that read
    // "line 9" and sent 9 would map the first row of data as the header — a
    // mis-parse with nothing visibly wrong with it.
    `${count(resolved.reading.headerRow + 1)} (\`header_row: ${count(resolved.reading.headerRow)}\`), ` +
    `dates read as ${resolved.reading.dateOrder}. ` +
    `Onto **${declaration.title}** (\`${declaration.name}\`), which holds ` +
    `${plural(plan.existing, 'row')}.`

  if (plan.problems.length > 0) {
    return paragraphs(
      head,
      sourceLine(plan),
      section(
        'This reading will not run',
        asTable(
          ['Key', 'Why'],
          plan.problems.map((problem) => [problem.key ?? '(the reading)', problem.message]),
        ),
      ),
      mappingText(loaded, plan),
      '**Nothing was read.** The fault is in the reader rather than in four hundred rows, ' +
        'which is why it is said once and here.',
    )
  }

  if (plan.broken.length > 0) {
    return paragraphs(
      head,
      section(
        'A line breaks a row constraint',
        plan.broken.slice(0, 20).map((each) => `- ${each}`).join('\n') +
          (plan.broken.length > 20 ? `\n- and ${String(plan.broken.length - 20)} more` : ''),
      ),
      mappingText(loaded, plan),
      '**Nothing was read.** A reading is written whole or not at all. A line that breaks a ' +
        'rule the format declares is a line the reader read wrongly or a rule that is wrong, ' +
        'and neither is something to write past.',
    )
  }

  if (plan.repeated.length > 0) {
    return paragraphs(
      head,
      section(
        'A unique column would repeat a value',
        plan.repeated.map((each) => `- ${each}`).join('\n'),
      ),
      mappingText(loaded, plan),
      '**Nothing was read.** A reading is written whole or not at all, and these lines would ' +
        'hold a value another row already holds. If the file is a corrected export of one read ' +
        'before, `supersede_reading` takes the first reading back.',
    )
  }

  if (plan.dangling.length > 0) {
    return paragraphs(
      head,
      section('A link points at nothing', plan.dangling.join(' ')),
      mappingText(loaded, plan),
      '**Nothing was read.** A `fixed` link names one row that every line of this file belongs ' +
        'to, so it has to name a row that exists — by its id, or by its name when that is ' +
        'unique. `format_rows` on the format it points at lists them.',
    )
  }

  if (headerRefuses(plan)) {
    const header = plan.header
    return paragraphs(
      head,
      section(
        'The header row will not read',
        header?.read.problem ?? header?.dangling.join(' ') ?? 'It did not type.',
      ),
      mappingText(loaded, plan),
      headerText(loaded, plan),
      '**Nothing was read.** Every line belongs to the header row, so lines whose header did ' +
        'not read have nothing to belong to. Point `header.cells` at the right cell, or fix the ' +
        'value in `header.fixed`.',
    )
  }

  const read = plan.read
  if (read === undefined) return 'Nothing was read.'
  const typed = read.rows.filter((row) => row.cells !== undefined)
  const again = plan.again
  // A read again shows only the rows it writes: the changed and the added.
  const staged = stagedRows(read).filter(
    (_, at) => again === undefined || again.update[at] === true || again.matched[at] === undefined,
  )

  return paragraphs(
    head,
    sourceLine(plan),
    mappingText(loaded, plan),
    again !== undefined
      ? againText(plan, again)
      : section(
      'What would be written',
      `${plural(typed.length, 'row')}` +
        `${typed.length === 0 ? '. **Nothing types**, so there is nothing to write.' : '.'}` +
        // Every line accounted for (M34 U3, D-396), so none is dropped quietly.
        (plan.lines === undefined ? '' : ` Every line of the file: ${tallySentence(plan.lines)}`) +
        // Nothing to find a row by, said once and nothing guessed (M50 U3, D-224).
        (plan.unkeyed === undefined || typed.length === 0 ? '' : ` ${plan.unkeyed}`),
    ),
    staged.length === 0
      ? undefined
      : staged
          .slice(0, STORED_ROWS)
          .map((row) => rowBlock(declaration, plan.shown.get(row.id) ?? row, plan.units, undefined, undefined, LONG_TEXT))
          .join('\n\n'),
    staged.length > STORED_ROWS
      ? `…and ${count(staged.length - STORED_ROWS)} more, each read the same way. Every value ` +
        'above is what would be stored, after the declaration’s own types, bounds and units were ' +
        'applied to what the file says.'
      : undefined,
    headerText(loaded, plan),
    problemRows(read, loaded.table),
    unlinkedText(read, loaded.table),
    proofText(plan),
    headerProofText(plan),
    priorText(plan),
    auditText(plan.audits, true),
  )
}

/**
 * The header row as it would be stored, with the cell each key came from.
 *
 * The position and the text the file shows there, side by side — `row -1,
 * column 0: 19000.00₪` — because a position is only checkable beside what is at
 * it, and the one wrong answer that parses is the cell next door.
 */
function headerText(loaded: Loaded, plan: Plan): string | undefined {
  const header = plan.resolved?.reading.header
  const read = plan.header
  if (header === undefined) return undefined
  const rows = [
    ...header.cells.map((each) => {
      const row = positionRow(loaded.table, each.row)
      const cell = row === undefined ? undefined : loaded.table.rows[row]?.[each.index]
      return [
        each.key,
        `row ${String(each.row)}${row !== undefined && row !== each.row ? ` (line ${String(row + 1)})` : ''}, column ${String(each.index)}`,
        cell === undefined || cell.kind === 'empty' ? '(empty)' : cell.text,
      ]
    }),
    ...header.fixed.map((each) => [each.key, 'fixed for the file', each.value]),
  ]
  return paragraphs(
    section(
      `The header row, one row of ${header.format}`,
      asTable(['Key', 'From', 'The file shows'], rows),
    ),
    read?.read.cells === undefined
      ? undefined
      : `Every line's \`${header.link}\` will point at it — shown above as ${PENDING_HEADER}, ` +
        'because it is written first, in the same transaction, and has no id until then.',
  )
}

/** What the header format says has to add up — the printed total against the lines. */
function headerProofText(plan: Plan): string | undefined {
  const header = plan.header
  if (header === undefined || header.read.cells === undefined) return undefined
  if (header.verdicts.length === 0) {
    return (
      `${header.declaration.title} makes no claim, so the header row is ` +
      'written and not checked against its lines. An aggregate over them and a claim ' +
      '(`lines_total = printed_total`) is what makes it a check.'
    )
  }
  return section(
    `What ${header.declaration.title} claims`,
    header.verdicts
      .map((each) => `- ${verdictSentence(each.identity, each.verdict)}`)
      .join('\n') +
      '\n\nOver the lines above, **before one of them exists** — and like a line a claim ' +
      'fails on, a header that fails is still written: a statement whose lines miss its printed ' +
      'total is a real statement, and the failure is what the person needs to see.',
  )
}

function applyPlan(document: OpenDocument, loaded: Loaded, plan: Plan): string {
  if (plan.blocked !== undefined) return plan.blocked
  const declaration = plan.declaration
  const resolved = plan.resolved
  const read = plan.read
  if (declaration === undefined || resolved === undefined || read === undefined) {
    return describePlan(loaded, plan)
  }
  if (
    plan.problems.length > 0 ||
    plan.dangling.length > 0 ||
    plan.repeated.length > 0 ||
    plan.broken.length > 0 ||
    headerRefuses(plan)
  ) {
    return describePlan(loaded, plan)
  }

  const rows = stagedRows(read).map((row) => row.cells)
  if (rows.length === 0) return describePlan(loaded, plan)
  // A source read again with nothing changed in it writes nothing (D-408).
  if (plan.again !== undefined && !planChanges(plan, plan.removeGone)) return describePlan(loaded, plan)

  const formats = indexOf(listFormats(document.db))
  const intake = recordIntake(
    document.db,
    intakeRequestOf(
      plan,
      declaration,
      resolved.reading,
      loaded.table,
      { name: loaded.fileName, hash: loaded.hash, removeGone: plan.removeGone },
      Date.now(),
      formats,
    ),
  )

  const failed = read.rows.filter((row) => row.cells === undefined).length

  return paragraphs(
    intake.again === undefined
      ? `**${plural(intake.rowCount, 'row')} written from ${loaded.fileName}** onto ` +
        `${declaration.title}, which now holds ` +
        `${plural(rowCountOf(document.db, declaration), 'row')}.`
      : (plan.again?.readBefore === false
          ? `**${loaded.fileName} read** onto ${declaration.title}, its lines found ${keySentence(plan.again.key)}: `
          : `**${loaded.fileName} read again** onto ${declaration.title}: `) +
        `${againWritten(intake.again)} ` +
        `${declaration.title} now holds ${plural(rowCountOf(document.db, declaration), 'row')}.`,
    plan.header === undefined || intake.headerRowId === undefined
      ? undefined
      : `**And one row of ${plan.header.declaration.title}**, \`${intake.headerRowId}\`, which every ` +
        'one of those rows points at.',
    failed === 0
      ? undefined
      : `${plural(failed, 'row')} ${verb(failed, 'was', 'were')} left where ${verb(failed, 'it is', 'they are')} — ` +
        'the lines and the reasons are in the dry run above.',
    plan.lines === undefined ? undefined : `Every line of the file: ${tallySentence(plan.lines)}`,
    unlinkedText(read, loaded.table),
    proofText(plan),
    headerProofText(plan),
    auditText(auditWritten(document.db, [{ declaration, reading: resolved.reading }], formats), false),
    intake.again !== undefined || plan.key.kind !== 'NONE'
      ? `The document remembers which row each line of ${loaded.fileName} is, under the reading ` +
        `\`${intake.id}\`, so reading it again updates them, adds what is new and names what is gone.`
      : `The document remembers which rows came from that file, under the reading \`${intake.id}\`. ` +
        '`supersede_reading` takes exactly those rows back and keeps the reader, so reading a ' +
        'corrected export is one call rather than a cleanup' +
        (intake.headerRowId === undefined ? '.' : ', and it takes the header row back with them.'),
  )
}

// --- many files in one call (M34 U2, D-395) ---------------------------------

/** Files one call reads. A folder of exports, not an archive. */
const FILES_MAX = 50

/** One file of the call, with the format it goes onto and its own mapping arguments. */
interface Asked {
  readonly loaded: Loaded
  readonly format: string
  readonly args: Args
}

/** What the call asked for: one file from the top-level arguments, or each of `files`. */
async function askedFrom(args: Args): Promise<readonly Asked[]> {
  const files = args['files']
  // An item's unit is one the document knows (M38 U4), so it is asked once.
  const entries = Array.isArray(files) ? (files as unknown[]) : [args]
  const wantsItems = entries.some((each) => typeof each === 'object' && each !== null && (each as Args)['items'] != null)
  const units = wantsItems ? await documentUnits(requireString(args, 'path')) : []
  const load = async (one: Args): Promise<Loaded> => {
    const loaded = await loadFile(requireString(one, 'file'), optionalString(one, 'sheet'), one['recursive'] === true)
    const items = itemsFrom(one)
    return items === undefined ? loaded : asItems(loaded, items.from, items.under, units)
  }
  if (files === undefined || files === null) {
    const format = requireString(args, 'format')
    return withNotesAcross([{ loaded: await load(args), format, args }])
  }
  if (args['file'] !== undefined || args['format'] !== undefined) {
    throw new ToolInputError(
      'Send `files`, or `format` and `file` for one file — not both. In `files`, each entry names its own.',
    )
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new ToolInputError('`files` must be a list of `{ file, format }`, with at least one in it.')
  }
  if (files.length > FILES_MAX) {
    throw new ToolInputError(`${String(files.length)} files is more than the ${String(FILES_MAX)} this reads in one call.`)
  }
  const loaded = await Promise.all(
    files.map(async (each: unknown) => {
      if (typeof each !== 'object' || each === null || Array.isArray(each)) {
        throw new ToolInputError('Each entry of `files` is an object: `{ file, format }`, and any columns it needs.')
      }
      const one = each as Args
      const format = requireString(one, 'format')
      return { loaded: await load(one), format, args: one }
    }),
  )
  return withNotesAcross(loaded)
}

interface Batch {
  /** Each file's plan, at its position in `files`. */
  readonly plans: readonly Plan[]
  /** Positions in `files`, in the order they are read. */
  readonly order: readonly number[]
  /** What `writeBatch` takes: the files that resolved, in the order given. */
  readonly files: readonly BatchFile[]
  /** What the engine would see once the lot is written (M34 U3, D-396). */
  readonly audits: readonly FormatAudit[]
}

function batchOf(document: OpenDocument, asked: readonly Asked[]): Batch {
  const formats = indexOf(listFormats(document.db))
  const plans: Plan[] = []
  const ready: { at: number; declaration: FormatDeclaration; resolved: Resolved; existing: number }[] = []
  const found = asked.map((one) => resolveWritable(document, one.format))
  // Every folder of notes the call reads, by the titles it writes onto its format.
  const written = asked.flatMap((one, at) => {
    const each = found[at]
    return each === undefined || 'refusal' in each || one.loaded.notes === undefined || one.loaded.items !== undefined
      ? []
      : [{ at, format: each.declaration.name, names: new Set(one.loaded.notes.map((note) => note.title)) }]
  })
  for (const [at, one] of asked.entries()) {
    const each = found[at]
    if (each === undefined) continue
    if ('refusal' in each) {
      plans[at] = refusedPlan(each.refusal)
      continue
    }
    const declaration = each.declaration
    // A file's own notes count too: a link between two notes of one folder is
    // filled (M38 U4). A folder's items go back to the format its notes are
    // read onto in this call.
    const items = one.loaded.items
    const notesAt = items === undefined ? -1 : asked.findIndex((other, k) => k !== at && other.loaded.items === undefined && other.loaded.fileName === items.source)
    const notesFormat = notesAt === -1 ? undefined : found[notesAt]
    const parent = notesFormat === undefined || 'refusal' in notesFormat ? undefined : notesFormat.declaration.name
    ready.push({
      at,
      declaration,
      resolved: resolveReading(document, declaration, one.loaded, one.args, formats, written, parent),
      existing: rowCountOf(document.db, declaration),
    })
  }

  const files: BatchFile[] = ready.map((each) => {
    const loaded = asked[each.at]?.loaded
    const one = asked[each.at]
    return {
      name: loaded?.fileName ?? '',
      hash: loaded?.hash ?? '',
      table: loaded?.table ?? { rows: [], columnCount: 0 },
      declaration: each.declaration,
      reading: each.resolved.reading,
      removeGone: one === undefined ? false : removeGoneFrom(one.args),
    }
  })
  const planned = planBatch(document.db, files, formats, Date.now())
  for (const [k, each] of ready.entries()) {
    const plan = planned.plans[k]
    plans[each.at] =
      plan === undefined
        ? refusedPlan('Not read.')
        : planFrom(plan, each.declaration, each.resolved, each.existing, files[k]?.removeGone === true)
  }
  const order = planned.order.flatMap((k) => (ready[k] === undefined ? [] : [ready[k].at]))
  const refused = asked.flatMap((_, at) => (ready.some((each) => each.at === at) ? [] : [at]))
  return { plans, order: [...order, ...refused], files, audits: planned.audits }
}

/** Every file may be written — the batch is written whole or not at all. */
function batchRefuses(batch: Batch): boolean {
  return batch.plans.some((plan) => !planWrites(plan))
}

function describeBatch(asked: readonly Asked[], batch: Batch): string {
  const rows = batch.order.map((at, step) => {
    const plan = batch.plans[at]
    const counts = plan === undefined ? { typed: 0, failed: 0 } : lineCounts(plan)
    return [
      String(step + 1),
      asked[at]?.loaded.fileName ?? '',
      plan?.declaration?.title ?? asked[at]?.format ?? '',
      plan !== undefined && planWrites(plan) ? count(counts.typed) : 'refused',
      count(counts.failed),
    ]
  })
  const refused = batch.order.filter((at) => {
    const plan = batch.plans[at]
    return plan === undefined || !planWrites(plan)
  })
  const typed = batch.plans.reduce((sum, plan) => sum + lineCounts(plan).typed, 0)

  return paragraphs(
    section(
      `${plural(asked.length, 'file')}, read in the order their links need`,
      asTable(['Read', 'File', 'Onto', 'Rows', 'Lines refused'], rows),
    ),
    refused.length > 0
      ? `**Nothing will be written.** The files are written whole or not at all, and ` +
          `${refused.map((at) => asked[at]?.loaded.fileName ?? '').join(', ')} ` +
          'cannot be — each says why below.'
      : `**${plural(typed, 'row')} from ${plural(asked.length, 'file')}**, each file read after the ` +
          'ones its links point into, so a line can name a row from a file above it. A line ' +
          'refused is named under its file, by line; the rest of that file is written.',
    ...batch.order.map((at) => {
      const one = asked[at]
      const plan = batch.plans[at]
      return one === undefined || plan === undefined ? undefined : `---\n\n${describePlan(one.loaded, plan)}`
    }),
    batch.audits.length === 0 ? undefined : `---\n\n${auditText(batch.audits, true) ?? ''}`,
  )
}

function applyBatch(document: OpenDocument, asked: readonly Asked[], batch: Batch): string {
  if (batchRefuses(batch)) return describeBatch(asked, batch)
  const formats = indexOf(listFormats(document.db))
  const written = writeBatch(document.db, batch.files, formats, Date.now())
  if (written.intakes.some((each) => each === undefined)) {
    return paragraphs('**Nothing was written.** Between the preview and now, this document stopped agreeing.', describeBatch(asked, batch))
  }
  const rows = written.order.map((k) => {
    const intake = written.intakes[k]
    const plan = written.plans[k]
    return [
      batch.files[k]?.name ?? '',
      batch.files[k]?.declaration.title ?? '',
      count(intake?.rowCount ?? 0),
      count(plan === undefined ? 0 : lineCounts(plan).failed),
      `\`${intake?.id ?? ''}\``,
    ]
  })
  const total = written.intakes.reduce((sum, each) => sum + (each?.rowCount ?? 0), 0)
  return paragraphs(
    `**${plural(total, 'row')} written from ${plural(written.intakes.length, 'file')}**, in this order:`,
    asTable(['File', 'Onto', 'Rows written', 'Lines refused', 'Reading'], rows),
    ...written.order.map((k) => {
      const lines = written.plans[k]?.lines
      return lines === undefined ? undefined : `${batch.files[k]?.name ?? ''}: ${tallySentence(lines)}`
    }),
    ...written.order.map((k) => {
      const again = written.intakes[k]?.again
      return again === undefined ? undefined : `${batch.files[k]?.name ?? ''}: ${againWritten(again)}`
    }),
    ...written.order.map((k) => {
      const read = written.plans[k]?.read
      return read === undefined ? undefined : unlinkedText(read, batch.files[k]?.table)
    }),
    auditText(written.audits, false),
    'A refused line is left where it is — the dry run named each one. `supersede_reading` with a ' +
      'reading above takes back exactly what that file wrote, and keeps its reader.',
  )
}

export const readOntoFormatTool: PluginTool = {
  definition: {
    name: 'read_onto_format',
    title: 'Read a file onto a declared format',
    description:
      'Read what the user already keeps onto a declared format: any .csv, .xlsx (or .xls) or .json of rows, a file ' +
      'row per table row; or **a folder of Markdown notes**, a note per row: `title`, `file`, ' +
      'each frontmatter key, `inline tags`, `body links` and `body`, with a link read from `[[name]]` or ' +
      '`[text](file.md)`; a body link naming no row is left out and named, the note still read; a hidden file is not read; ' +
      'links between notes of one folder are filled; `items` reads list items or table rows onto another format, each linked to its note. ' +
      '**Dry-runs by default**: the reader with each key\u2019s header cell and first value, the ' +
      'rows as stored, the rows that would not type and why, and **what the format claims, ' +
      'checked before a row exists**. Writes on `commit: true`. Keys come from `formats`. ' +
      '**The user maps the columns; this only guesses** — show the reader, correct it with ' +
      '`columns`. `fixed` gives a key one value for the file (a currency, a unit, the row every ' +
      'line belongs to). A column fills a `link` only by the exact unique name of its row, and ' +
      'a line naming none is refused; a link is guessed only from a header that names it. `header` writes the file\u2019s ' +
      'total, period or card as one row of another format that every line links to. ' +
      '**A source read again updates its rows** by note file name, and any file by a unique column (so a later ' +
      'export updates what an earlier one wrote): changed, added ' +
      'and gone named; gone kept unless `remove_gone`. `supersede_reading` takes a reading back. **Several ' +
      'files in one call**: `files`, each `{ file, format }` with its own columns — read in the ' +
      'order their links need, so a line names a row from a file above it; one dry run for the ' +
      'lot, written whole or not at all.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format to read onto, by name. Not with `files`.'),
        file: FILE_PROP,
        files: {
          type: 'array',
          description:
            'Instead of `format` and `file`: each `{ file, format }`, plus that file’s own columns.',
          items: { type: 'object', additionalProperties: true },
        },
        sheet: stringProp('Which sheet, or key of a .json object; defaults to the first.'),
        recursive: RECURSIVE_PROP,
        header_row: numberProp(
          'Force the header row, from 0, when the guess is wrong — exports often have a preamble.',
        ),
        date_order: stringProp(
          `How a written date is ordered: one of ${DATE_ORDERS.join(', ')}. Inferred from the ` +
            'file when omitted.',
        ),
        columns: {
          type: 'object',
          description:
            'Column number → key of the format, from what the user confirmed, or → null to read ' +
            'nothing from that column. Applied over the reader the dry run showed, so send only ' +
            'what changes; a column not named keeps its key. Omit to take the guess, or the ' +
            'reading this document already has for a file with this header.',
        },
        fixed: {
          type: 'object',
          description:
            'Key → one value for every row of this file. A currency for a `money` column, a ' +
            'unit for a `quantity` one, or the row a `link` points at, by id or unique name.',
        },
        separators: {
          type: 'object',
          description:
            'Key → what splits one cell into several members, for a column holding several of a ' +
            'list (`enums`): `{ "tags": "," }` reads `vegan, quick` as two. Never guessed; without ' +
            'one a cell is one member, and a member off the list refuses its line by name.',
        },
        header: {
          type: 'object',
          description:
            '`{ format, link, cells, fixed }`: the one row of another format this file writes and ' +
            'every line links to through `link`. `cells` is key → [row, column], **a position, ' +
            'never a value**, from 0; a negative row counts up from the last row with anything ' +
            '(a total under the lines is `[-1, 0]`). An aggregate and a claim there check it.',
        },
        items: stringProp(
          '"list" or "table": a folder’s list items or table rows as rows of `format`, each linked to its ' +
            'note’s row (read the notes in the same `files`, or before).',
        ),
        under: stringProp('With `items`: only those under this heading.'),
        remove_gone: booleanProp(
          'Read again: remove rows whose line is gone (else named, kept). Per file in `files`.',
        ),
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const asked = await askedFrom(args)
    if (args['files'] !== undefined && args['files'] !== null) {
      const batch: Mutation<Batch> = {
        refuses: batchRefuses,
        // A read of many lines keeps a named copy first (M34 U6, D-399).
        copyBefore: (plan) => ({
          what: asked.length === 1 ? `reading ${asked[0]?.loaded.fileName ?? ''}` : `reading ${asked.length} files`,
          rows: plan.plans.reduce((sum, each) => sum + lineCounts(each).typed, 0),
        }),
        plan: (document) => batchOf(document, asked),
        describe: (plan) => describeBatch(asked, plan),
        apply: (document, plan) => applyBatch(document, asked, plan),
      }
      return mutatingCall(path, args['commit'] === true, batch)
    }
    const name = asked[0]?.format ?? ''
    const loaded = asked[0]?.loaded
    if (loaded === undefined) throw new ToolInputError('Name a `file` to read.')

    const mutation: Mutation<Plan> = {
      refuses: writesNothing,
      copyBefore: (plan) => ({ what: `reading ${loaded.fileName}`, rows: lineCounts(plan).typed }),
      plan: (document) => planOf(document, name, loaded, args),
      describe: (plan) => describePlan(loaded, plan),
      apply: (document, plan) => applyPlan(document, loaded, plan),
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

// --- supersede_reading ------------------------------------------------------

interface SupersedePlan {
  readonly declaration: FormatDeclaration | undefined
  readonly blocked: string | undefined
  readonly intakes: readonly Intake[]
  readonly chosen: Intake | undefined
  readonly unknown: string | undefined
}

function supersedeMutation(name: string, id: string | undefined): Mutation<SupersedePlan> {
  return {
    // Listing what a format has read is the whole of a call with no `reading`,
    // and it writes nothing — so it must not invite a commit, and must not take
    // a copy of the document to say so (D-217, D-220).
    refuses: (plan) =>
      plan.blocked !== undefined ||
      plan.unknown !== undefined ||
      plan.chosen === undefined ||
      plan.chosen.rowCount === 0,
    // Taking back a large reading is a large removal (D-399).
    copyBefore: (plan) =>
      plan.chosen === undefined
        ? undefined
        : { what: `taking back ${plan.chosen.fileName}`, rows: plan.chosen.rowCount },

    plan: (document) => {
      const found = resolveWritable(document, name)
      if ('refusal' in found) {
        return {
          declaration: undefined,
          blocked: found.refusal,
          intakes: [],
          chosen: undefined,
          unknown: undefined,
        }
      }
      const intakes = listIntakes(document.db, found.declaration.name)
      const chosen = id === undefined ? undefined : intakes.find((one) => one.id === id)
      return {
        declaration: found.declaration,
        blocked: undefined,
        intakes,
        chosen,
        unknown: id !== undefined && chosen === undefined ? id : undefined,
      }
    },

    describe: (plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      const declaration = plan.declaration
      if (declaration === undefined) return 'No format resolved.'

      if (plan.intakes.length === 0) {
        return `No file has been read onto ${declaration.title}. There is nothing to take back.`
      }

      const listing = asTable(
        ['Reading', 'File', 'Read on', 'Rows it still has'],
        plan.intakes.map((one) => [
          one.id,
          one.fileName,
          instant(one.readAt),
          one.rowCount === 0 ? 'none — already superseded' : count(one.rowCount),
        ]),
      )

      if (plan.unknown !== undefined) {
        return paragraphs(
          `${declaration.title} has no reading \`${plan.unknown}\`. It has:`,
          listing,
        )
      }

      if (plan.chosen === undefined) {
        return paragraphs(
          `Every file read onto **${declaration.title}**, most recent first.`,
          listing,
          'Call this again with `reading` set to one of those ids to take back what it wrote. ' +
            '**The rows go and the reader stays**, so reading a corrected export is one call ' +
            'rather than a fresh reader.',
        )
      }

      if (plan.chosen.rowCount === 0) {
        return paragraphs(
          `The reading of **${plan.chosen.fileName}** has no rows left — it was superseded ` +
            'already, and its reader is kept so the file can be read again.',
          listing,
        )
      }

      return paragraphs(
        `**${plural(plan.chosen.rowCount, 'row')} would be taken out of ${declaration.title}** — ` +
          `exactly the rows ${plan.chosen.fileName} wrote on ${instant(plan.chosen.readAt)}, and ` +
          'no others' +
          (plan.chosen.reading.header === undefined
            ? '.'
            : ` — and the one row of ${plan.chosen.reading.header.format} it wrote as their header.`),
        'The reader that read that file **stays**. Removing rows and forgetting how to read a ' +
          'document are two different acts, and supersede → correct the file → read it again is ' +
          'the ordinary flow.',
        'A row somebody has since corrected by hand goes with the rest: the document records ' +
          'which rows that file wrote, not which of them are still as it left them.',
      )
    },

    apply: (document, plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      const declaration = plan.declaration
      const chosen = plan.chosen
      if (declaration === undefined || chosen === undefined) return 'Nothing was taken back.'

      const removed = supersedeIntake(
        document.db,
        chosen.id,
        declaration,
        indexOf(listFormats(document.db)),
      )
      return paragraphs(
        `**${plural(removed, 'row')} taken out of ${declaration.title}**, which now holds ` +
          `${plural(rowCountOf(document.db, declaration), 'row')}.`,
        removed === chosen.rowCount
          ? undefined
          : `The reading wrote ${plural(chosen.rowCount, 'row')}; ${count(removed)} were still ` +
            'there. The rest had been removed by hand already, and the count above is what ' +
            'actually happened.',
        `The reader for ${chosen.fileName} is kept. Read the corrected file with ` +
          '`read_onto_format` and it will be recognised by its header.',
        chosen.reading.header === undefined
          ? undefined
          : `The header row it wrote into ${chosen.reading.header.format} went with them.`,
      )
    },
  }
}

export const supersedeReadingTool: PluginTool = {
  definition: {
    name: 'supersede_reading',
    title: 'Take back what one file wrote',
    description:
      'Take back the rows one file wrote onto a declared format — **exactly those rows and no ' +
      'others**. Called with no `reading`, it lists every file read onto the format with when, ' +
      'and how many rows each still has. **Dry-runs by default** and writes nothing until ' +
      '`commit: true`. **The reader is kept** (forgetting one is `readers`), so supersede → ' +
      'correct the file → read it again is one call each. This is how a file read twice stops ' +
      'being two copies; a file is matched by its bytes, never row by row.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name.'),
        reading: stringProp(
          'The reading to take back, by id. Omit to list what this format has read.',
        ),
        commit: booleanProp('Do it. Omit or false for the dry run.'),
      },
      required: ['path', 'format'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const name = requireString(args, 'format')
    return mutatingCall(
      path,
      args['commit'] === true,
      supersedeMutation(name, optionalString(args, 'reading')),
    )
  },
}

// --- readers ----------------------------------------------------------------

interface ReadersPlan {
  readonly declaration: FormatDeclaration | undefined
  readonly blocked: string | undefined
  readonly readers: readonly Reader[]
  readonly renames: readonly { readonly reader: Reader; readonly name: string }[]
  readonly forgets: readonly Reader[]
  readonly unknown: readonly string[]
}

interface ReaderChanges {
  readonly rename: readonly { readonly reader: string; readonly name: string }[]
  readonly forget: readonly string[]
}

function readerChangesFrom(args: Args): ReaderChanges {
  const rename = args['rename'] ?? []
  const forget = args['forget'] ?? []
  if (!Array.isArray(rename)) throw new ToolInputError('`rename` must be a list of `{ reader, name }`.')
  if (!Array.isArray(forget)) throw new ToolInputError('`forget` must be a list of reader ids.')
  return {
    rename: rename.map((each: unknown) => {
      if (typeof each !== 'object' || each === null) {
        throw new ToolInputError('Every `rename` entry is `{ reader, name }`.')
      }
      const entry = each as Record<string, unknown>
      const reader = entry['reader']
      const name = entry['name']
      if (typeof reader !== 'string' || typeof name !== 'string') {
        throw new ToolInputError('Every `rename` entry is `{ reader, name }`, both text.')
      }
      return { reader, name }
    }),
    forget: forget.map((each: unknown) => {
      if (typeof each !== 'string') throw new ToolInputError('`forget` is a list of reader ids, as text.')
      return each
    }),
  }
}

/**
 * Name or forget a format's readers — the sheet's two icons, from a
 * conversation (M26 F1, D-227/D-234). Called with nothing to change it lists
 * them, with the id a conversation names one by: a name is neither required
 * nor unique, and the file it last read can be the same for two layouts.
 */
function readersMutation(name: string, changes: ReaderChanges): Mutation<ReadersPlan> {
  const changing = changes.rename.length + changes.forget.length > 0
  const mutation: Mutation<ReadersPlan> = {
    // A call with nothing to change is the listing, and writes nothing.
    refuses: (plan) => plan.blocked !== undefined || plan.unknown.length > 0 || !changing,

    plan: (document) => {
      const found = resolveWritable(document, name)
      if ('refusal' in found) {
        return {
          declaration: undefined,
          blocked: found.refusal,
          readers: [],
          renames: [],
          forgets: [],
          unknown: [],
        }
      }
      const readers = listReaders(document.db, found.declaration.name)
      const byId = new Map(readers.map((each) => [readerId(each), each]))
      const unknown = [...changes.rename.map((each) => each.reader), ...changes.forget].filter(
        (id) => !byId.has(id),
      )
      return {
        declaration: found.declaration,
        blocked: undefined,
        readers,
        renames: changes.rename.flatMap((each) => {
          const reader = byId.get(each.reader)
          return reader === undefined ? [] : [{ reader, name: each.name.trim() }]
        }),
        forgets: changes.forget.flatMap((id) => {
          const reader = byId.get(id)
          return reader === undefined ? [] : [reader]
        }),
        unknown,
      }
    },

    describe: (plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      const declaration = plan.declaration
      if (declaration === undefined) return 'No format resolved.'
      if (plan.readers.length === 0) {
        return (
          `${declaration.title} has no readers yet. A reader is made the first time a file is ` +
          'read onto it with `read_onto_format`.'
        )
      }
      const listing = asTable(
        ['Reader', 'Name', 'Files it has read', 'Last read'],
        plan.readers.map((each) => [
          readerId(each),
          readerName(each) + (each.name === undefined ? ' (the file it last read)' : ''),
          each.files.join(', '),
          instant(each.lastReadAt),
        ]),
      )
      if (plan.unknown.length > 0) {
        return paragraphs(
          `${declaration.title} has no reader ${plan.unknown.map((each) => `\`${each}\``).join(', ')}. It has:`,
          listing,
        )
      }
      if (!changing) {
        return paragraphs(
          `The readers of **${declaration.title}** — one per kind of file it has been read from, newest first.`,
          listing,
          'Send `rename: [{ reader, name }]` to name one (an empty name goes back to the file it ' +
            'last read), or `forget: [reader]` to stop offering one. **Forgetting a reader takes ' +
            'nothing back**: the rows it wrote stay, and `supersede_reading` can still remove them.',
        )
      }
      return paragraphs(
        ...plan.renames.map(
          (each) =>
            `The reader for **${readerName(each.reader)}** would be ` +
            (each.name === '' ? 'named by the file it last read again.' : `named **${each.name}**.`),
        ),
        ...plan.forgets.map(
          (each) =>
            `The reader for **${readerName(each)}** would be forgotten: a file with its header is ` +
            'no longer read by it, and reading one makes a new reader. The rows it wrote stay.',
        ),
      )
    },

    apply: (document, plan) => {
      const declaration = plan.declaration
      if (declaration === undefined || plan.blocked !== undefined || plan.unknown.length > 0 || !changing) {
        // `commit: true` on a call that changes nothing answers as the dry run does.
        return mutation.describe(plan)
      }
      for (const each of plan.renames) {
        renameReader(document.db, declaration.name, each.reader.signature, each.name)
      }
      for (const each of plan.forgets) forgetReader(document.db, declaration.name, each.signature)
      return paragraphs(
        plan.renames.length === 0 ? undefined : `${plural(plan.renames.length, 'reader')} renamed.`,
        plan.forgets.length === 0
          ? undefined
          : `${plural(plan.forgets.length, 'reader')} forgotten. Nothing they wrote was taken back.`,
      )
    },
  }
  return mutation
}

export const readersTool: PluginTool = {
  definition: {
    name: 'readers',
    title: 'A format’s readers',
    description:
      'List a declared format’s readers — one per kind of file it has read — or name and ' +
      'forget them. Dry-runs until `commit: true`. Forgetting takes back no row.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The format, by name.'),
        rename: {
          type: 'array',
          description: '`{ reader, name }`, by id; an empty name restores the file’s.',
          items: { type: 'object' },
        },
        forget: { type: 'array', description: 'Reader ids.', items: { type: 'string' } },
        commit: booleanProp('Do it. Omit or false for the dry run.'),
      },
      required: ['path', 'format'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const name = requireString(args, 'format')
    return mutatingCall(path, args['commit'] === true, readersMutation(name, readerChangesFrom(args)))
  },
}
