/**
 * **A document as text — deterministic, complete, and both ways** (M22 U4,
 * D-244).
 *
 * ## Why this exists
 *
 * Git cannot diff or merge a `.emd`. It is 784KB of binary a commit, and
 * changing one row moved 3,522 bytes scattered through it — nothing a person can
 * review, and nothing two people can merge. Everything M22 opens (a pack of
 * these formats, a second repo, an ADR store somebody else trusts) dies on that
 * one fact, so this is the unit the rest waits behind.
 *
 * **The unit is the serializer, not the file it writes to** (D-244). A generated
 * `.md` beside the document and a git clean/smudge filter over it are the same
 * work plumbed two ways, and the choice between them may differ for this repo
 * and for a stranger's. So this file produces *parts* — a name and a text — and
 * says nothing about where they go. `joinParts` folds them into one text for a
 * caller that wants one file; a caller that wants a folder writes them as they
 * are.
 *
 * ## The three properties, and what each one costs
 *
 * **Complete.** The text alone rebuilds the declared half of a document, so the
 * binary is never the only home for anything. That is the declarations, every
 * row of every declared table, and the units — which are rows in the document
 * and not a constant (D-223), so a `tbsp` somebody corrected to 20 ml has to be
 * in here or every recipe changes by a fifth on the way back.
 *
 * **Deterministic.** The same content always writes the same bytes. An unstable
 * order would make every commit a fake diff and git *worse* than the markdown it
 * replaced. Everything ordered here is ordered by something the text itself
 * carries — formats by name, rows by their label and then by their own rendered
 * body — and **never by the row id**, which is why the id is not written at all:
 * an order that depended on a value the text does not hold would not survive its
 * own round trip.
 *
 * **Logical, never byte-level.** Two SQLite files with identical content differ
 * in bytes — page layout, freelists, vacuum state — so a clean filter that
 * hashed the file would report a change every time nothing happened.
 *
 * ## The two decisions worth arguing with
 *
 * **A link is written as the name of the row it points at, not its id** (D-241).
 * `supersedes: D-232` is reviewable and `supersedes:
 * 0c0af4de-6da3-4935-9201-54246964ddca` is not, and a diff nobody can read is
 * the whole problem this file was opened to solve. The cost is real and is paid
 * as a refusal rather than a guess: a format that is pointed at must have a text
 * column to be named by, its rows' names must be filled in, and no two of them
 * may be the same. A document that breaks one of those is **refused with the
 * format and the name in the message**, because the alternative is text that
 * reads back pointing somewhere else.
 *
 * **The row id is not written, and is therefore not preserved.** An id is a
 * generated surrogate with no meaning outside the file; what a row *is* is its
 * name, and every pointer in the text is by name. Reading a document back mints
 * fresh ids and rewires the links to match — which is why `readDocument` hands
 * back links as labels and leaves resolving them to the half that can write
 * (`formatDocumentRepository.ts`). The property that matters holds either way:
 * **text → document → text is byte-identical**, which is what a clean filter
 * needs and what stops a checkout from showing a diff nobody made.
 *
 * ## The shape
 *
 * One part per format, and it is a `.format.md` — `artefact.ts`'s file, whole
 * and unchanged, with a `## rows` section after it. That is deliberate reuse
 * rather than tidiness: `artefact.write` is already the deterministic,
 * round-trippable text of a *declaration*, in its own words and for this exact
 * reason, and **U4 is that same thing for rows**. A declaration serialized two
 * ways would be two things to keep in step.
 *
 * A row is a block, not a table row, and that is not a style choice. A markdown
 * pipe table cannot hold a newline in a cell — `artefact.ts` flattens them,
 * which is fine for a column note somebody typed on one line and is data loss
 * for a `text` column holding a paragraph. A block of `key: value` lines also
 * diffs one field at a time, where a table row diffs the whole record.
 *
 * ## What it does not cover, said plainly
 *
 * **The declared half only.** The ledger's thirty tables are not here, and
 * cannot be: `src/domain/format/` imports nothing from the pack and nothing in
 * the pack imports it (D-221), which is the property the engine is named after.
 * So *"the text alone rebuilds the document"* is true of a document that is
 * declarations and rows — `docs/memory.emd` is exactly one — and false of one
 * carrying a ledger. D-214 is what closes that gap, by leaving no non-`fmt_`
 * table to miss.
 */

import { fromDecimalString, toDecimalString, money, type CurrencyCode } from '@/core/money.ts'
import { err, ok, type Result } from '@/core/result.ts'

import {
  ARTEFACT_EXTENSION,
  parse as parseArtefact,
  read as readArtefact,
  write as writeArtefact,
} from './artefact.ts'
import {
  declarationRejection,
  isLinkType,
  labelColumn,
  moneyColumnNames,
  quantityColumnNames,
  type FormatDeclaration,
} from './declaration.ts'
import { formatDecimal } from './decimal.ts'
import { parseWeekday, weekdayText } from './clock.ts'
import { parseCurrency } from './currency.ts'
import { formatStoredPercent } from './percent.ts'
import {
  boundedCoordinate,
  boundedWidth,
  waysFor,
  readEntrySetting,
  writeEntrySetting,
  isBlockKind,
  isSavedKind,
  isViewKind,
  isViewSetting,
  savedAddress,
  savedNameRefusal,
  SAVED_KINDS,
  BLOCK_KINDS,
  blockSizeRefusal,
  DOCUMENT_DASHBOARD,
  totalNameRefusal,
  VIEW_PARTS,
  type ColumnWidth,
  type GraphPlace,
  type SavedView,
  type DashboardBlock,
  type ViewSetting,
} from './view.ts'
import { coerceValue, idsIn, offeredKeysOf, type StoredRow, type StoredValue } from './row.ts'
import {
  DIMENSIONS,
  SEEDED_UNITS,
  unitRejection,
  type Dimension,
  type UnitOrigin,
  type UnitRow,
  type UnitTable,
} from './unit.ts'
import { stringListOf } from './stringList.ts'

/** One format and every row it has. */
export interface FormatContent {
  readonly declaration: FormatDeclaration
  readonly rows: readonly StoredRow[]
}

/** A document's declared half, which is everything this file can see. */
export interface DocumentContent {
  readonly units: UnitTable
  readonly formats: readonly FormatContent[]
  /** Which rows are a pack's, and which a person removed (M24 U12, D-264). */
  readonly seeds?: readonly SeedRecord[]
  /** How wide a person made a sheet's columns (M26 U2, D-289). */
  readonly widths?: readonly ColumnWidth[]
  /** Where a person moved the bubbles on the connections canvas (M26 U4, D-291). */
  readonly places?: readonly GraphPlace[]
  /** What each view keeps per column — how an entry shows each (M26 U6, D-294; D-402). */
  readonly views?: readonly ViewSetting[]
  /** A format's filter, order, columns and kind under a name (M53 U5, D-514, D-520). */
  readonly saved?: readonly SavedView[]
  /** Each dashboard's blocks, in order — a format's and the document's (M53 U7, D-521). */
  readonly dashboards?: readonly DashboardBlock[]
  /** The currency a new money figure is in until a row says otherwise (M29 F3, D-344). */
  readonly currency?: string | undefined
  /** The day a week starts on, `sunday`, when the document chose one (M53 F6, D-528). */
  readonly weekStart?: string | undefined
  /** What was read in, and which rows each read wrote (M38 U3, D-408). */
  readonly readings?: readonly IntakeContent[]
  /** The names a person gave readers (M26 F1). */
  readonly readerNames?: readonly ReaderNameRecord[]
  /** The day each format last changed, `YYYY-MM-DD`, for those that carry a mark (M47 U5, D-462). */
  readonly changed?: ReadonlyMap<string, string>
}

/**
 * One key of a reading: filled by a column of the file, or by one value for
 * every row — a line's key, or a header row's cell (`row` and `index`).
 */
export interface ReadingBinding {
  readonly key: string
  readonly row?: number | undefined
  readonly index?: number | undefined
  readonly fixed?: string | undefined
  readonly separator?: string | undefined
}

/** A file read in, as `format_intake` holds it — less its id, which is derived (D-408). */
export interface ReadingFields {
  readonly format: string
  readonly file: string
  readonly hash: string
  readonly signature: string
  readonly readAt: number
  readonly headerRow: number
  readonly dateOrder: string
  readonly rowCount: number
  readonly headerFormat?: string | undefined
  readonly headerLink?: string | undefined
  /** The header in the file's own order, as the JSON the document keeps it in. */
  readonly headerCells?: string | undefined
  readonly forgotten: boolean
  readonly columns: readonly ReadingBinding[]
  readonly header: readonly ReadingBinding[]
}

/** One row a reading wrote: in a header's format when `format` says so, its line's key, its mark. */
interface ReadingRowFields {
  readonly format?: string | undefined
  readonly key?: string | undefined
  readonly written?: string | undefined
}

/** A reading as a document holds it: each row it wrote by the row's id. */
export interface IntakeContent extends ReadingFields {
  readonly rows: readonly (ReadingRowFields & { readonly id: string })[]
}

/**
 * **A row named the way the text can name it** (D-408): by what it is called
 * and which of the rows called that it is, in the order the text writes them.
 * The text holds no ids (D-245), and a row's name alone may repeat.
 */
export interface RowRef {
  readonly name: string
  /** 1 for the first row of that name in the text, 2 for the second. */
  readonly n: number
}

/** A reading as the text holds it: each row it wrote by a `RowRef`. */
export interface ReadingRecord extends ReadingFields {
  readonly rows: readonly (ReadingRowFields & { readonly row: RowRef })[]
}

/** A name a person gave a reader, by the header it was made for. */
export interface ReaderNameRecord {
  readonly format: string
  readonly signature: string
  readonly name: string
}

/**
 * A seeded row is the pack's while `SEEDED`; `REMOVED` is one a person took
 * away, which a reseed does not bring back. A row a person edited has no record.
 */
export type SeedState = 'SEEDED' | 'REMOVED'

/** One of a pack's rows, by its format and the name it is seeded under (D-264). */
export interface SeedRecord {
  readonly format: string
  readonly key: string
  readonly state: SeedState
}

/**
 * One file's worth of text, and what it would be called.
 *
 * A name rather than a path: where these go is the plumbing decision this unit
 * deliberately does not make (D-244).
 */
export interface DocumentPart {
  readonly name: string
  readonly text: string
}

/**
 * A row as the text has it: **no id, and every link by the name it points at.**
 *
 * The pair to `StoredRow`, and the difference between them is the whole of what
 * this file decided. Resolving a name back to an id needs to write — the ids do
 * not exist until the rows do — so it is the repository's job and not this
 * one's, which is also what keeps `src/domain/` free of sql.js.
 */
export interface ParsedRow {
  /** Every stored cell except the link columns, coerced as the declaration says. */
  readonly cells: Readonly<Record<string, StoredValue>>
  /**
   * Link column name → the *name* of the row it points at, or for a `links`
   * column the names of every row it lists, in order (M27 U2, D-300).
   */
  readonly links: Readonly<Record<string, string | readonly string[]>>
}

export interface ParsedFormat {
  readonly declaration: FormatDeclaration
  readonly rows: readonly ParsedRow[]
}

export interface ParsedDocument {
  readonly units: UnitTable
  readonly formats: readonly ParsedFormat[]
  readonly seeds: readonly SeedRecord[]
  readonly widths: readonly ColumnWidth[]
  readonly places: readonly GraphPlace[]
  readonly views: readonly ViewSetting[]
  readonly saved: readonly SavedView[]
  readonly dashboards: readonly DashboardBlock[]
  readonly currency: string | undefined
  readonly weekStart: string | undefined
  readonly readings: readonly ReadingRecord[]
  readonly readerNames: readonly ReaderNameRecord[]
  /** Format name to the day it last changed (M47 U5, D-462); a format the text gives none is absent. */
  readonly changed: ReadonlyMap<string, string>
}

/** What the units part is called, when there is one. */
export const UNITS_PART = 'units.md'

/** What the seeds part is called, when a pack has seeded anything (D-264). */
export const SEEDS_PART = 'seeds.md'

/**
 * What the views part is called, when a sheet's columns were sized (D-289) or
 * an entry's inputs chosen (D-294).
 */
export const VIEWS_PART = 'views.md'

/** What the canvas part is called, when a bubble was moved (D-291). */
export const GRAPH_PART = 'graph.md'

/** What the document's own settings are called, when it has one — its currency (D-344) and week start (D-528). */
export const SETTINGS_PART = 'settings.md'

/** What the record of what was read in is called, when anything was (M38 U3, D-408). */
export const READINGS_PART = 'readings.md'

/**
 * What the record of when each format last changed is called, when any carries
 * a mark (M47 U5, D-462). Its own part rather than a line in each format's, so
 * a build that predates it reads the document and only loses the dates.
 */
export const CHANGED_PART = 'changed.md'

/** The line that separates a format's declaration from its rows. */
const ROWS_MARKER = '## rows'

/** What a part's name is written as, when the parts are folded into one text. */
const PART_MARKER = '<!-- emerald:'

/**
 * A document's declared half as text, or one sentence saying why not.
 *
 * **One sentence, naming the thing.** Same rule `artefact.read` keeps and for
 * the same reason: this is read by a person whose commit just failed, and the
 * second problem is not useful until the first is fixed.
 */
export function writeDocument(content: DocumentContent): Result<readonly DocumentPart[], string> {
  const formats = [...content.formats].sort((a, b) =>
    a.declaration.name < b.declaration.name ? -1 : a.declaration.name > b.declaration.name ? 1 : 0,
  )

  const labels = labelIndexOf(formats)
  if (!labels.ok) return labels

  const parts: DocumentPart[] = []

  // Written only when the document disagrees with the constant, which is the
  // usual case of *nothing*: twenty-five rows of `kg is a thousand grams` at the
  // top of every serialized document would be noise in the one place this file
  // is trying to make readable, and they are recoverable from `SEEDED_UNITS`
  // exactly. A unit somebody added or corrected is not, so the moment one
  // exists the whole table is written rather than a diff against the seed —
  // a partial table would need a merge rule, and there is no merge rule that is
  // obviously right.
  if (!sameUnits(content.units, SEEDED_UNITS)) {
    parts.push({ name: UNITS_PART, text: writeUnits(content.units) })
  }

  for (const format of formats) {
    const text = writeFormat(format.declaration, format.rows, labels.value)
    if (!text.ok) return text
    parts.push({ name: `${format.declaration.name}${ARTEFACT_EXTENSION}`, text: text.value })
  }

  // **Only when a pack has seeded something**, which no document has yet: the
  // record is what keeps a removed seed removed and a corrected one the pack's,
  // and a text read back without it would hand every seed to the person.
  if (content.seeds !== undefined && content.seeds.length > 0) {
    parts.push({ name: SEEDS_PART, text: writeSeeds(content.seeds) })
  }

  // **Only the widths of columns that still exist.** A width is kept beside the
  // declaration, not in it, so a column renamed or dropped can leave one behind
  // — read by nobody, and not worth a line in a file somebody diffs.
  const shown = (content.widths ?? []).filter((each) =>
    formats.some(
      (format) =>
        format.declaration.name === each.format &&
        format.declaration.columns.some((column) => column.name === each.column),
    ),
  )
  // The same rule for a view's settings, and one more: a way the column's
  // type no longer offers draws as the default, so it is not worth a line
  // either — though the column's place on the page still is (D-296).
  const kept = (content.views ?? []).flatMap((each) => {
    const declaration = formats.find((format) => format.declaration.name === each.format)?.declaration
    // A worked-out column is shown too (D-402), by the ways of what it works
    // out to — any of a money's, a percent's or a figure's, since which of
    // them it is takes compiling the expression.
    const worked = (declaration?.derived ?? []).some((candidate) => candidate.name === each.column)
    const column =
      declaration?.columns.find((candidate) => candidate.name === each.column) ??
      (worked && each.view === 'entry' ? { type: 'percent' as const } : undefined)
    if (column === undefined) return []
    // A board's words are kept as they are (M27 U3, D-301): one that names a
    // column no longer an enum falls back when it is drawn, as an input does.
    // So are a roadmap's and a page's (M27 U4, D-302) — and they must not fall
    // through to the entry's reading, where `line` is an input and `order` is
    // nothing, which once dropped every word but `line` on a save.
    if (each.view !== 'entry') return isViewSetting(each.view, each.setting) ? [each] : []
    const entry = readEntrySetting(each.setting)
    if (entry === undefined) return []
    const way = entry.way !== undefined && waysFor(column).includes(entry.way) ? entry.way : undefined
    const setting = writeEntrySetting({ ...entry, way })
    return setting === undefined ? [] : [{ ...each, setting }]
  })
  // A saved view goes with its format; an address naming a column that has
  // gone is still the person's, and is drawn with a sentence saying so.
  const saved = (content.saved ?? []).filter((each) => formats.some((format) => format.declaration.name === each.format))
  // A dashboard's block goes with the format it reads and the one it is on.
  const declared = (name: string | undefined): boolean =>
    name === undefined || formats.some((format) => format.declaration.name === name)
  const dashboards = (content.dashboards ?? []).filter((each) => declared(each.dashboard) && declared(each.format))
  if (shown.length > 0 || kept.length > 0 || saved.length > 0 || dashboards.length > 0) {
    parts.push({ name: VIEWS_PART, text: writeWidths(shown, kept, saved, dashboards) })
  }

  // The same rule for a place: a format that has gone, or a pack that owns
  // nothing here any more, has nothing on the canvas to answer to.
  const placed = (content.places ?? []).filter((each) =>
    formats.some((format) =>
      each.kind === 'FORMAT'
        ? format.declaration.name === each.name
        : format.declaration.owner?.pack === each.name,
    ),
  )
  if (placed.length > 0) parts.push({ name: GRAPH_PART, text: writePlaces(placed) })

  // Only when one was chosen: a document that never kept money says nothing.
  if (content.currency !== undefined || content.weekStart !== undefined) {
    parts.push({ name: SETTINGS_PART, text: writeSettings({ currency: content.currency, weekStart: content.weekStart }) })
  }

  // **What was read in** (M38 U3, D-408) — once the text could not carry it, a
  // read into a text document could not be saved at all. Each row a reading
  // wrote by its name and place, since the text holds no ids; a row deleted
  // since has no line, and is no row of the reading.
  const readings = content.readings ?? []
  if (readings.length > 0 || (content.readerNames ?? []).length > 0) {
    const refs = new Map<string, ReadonlyMap<string, RowRef>>()
    const refsOf = (name: string): ReadonlyMap<string, RowRef> => {
      const known = refs.get(name)
      if (known !== undefined) return known
      const format = formats.find((each) => each.declaration.name === name)
      const made = format === undefined ? new Map<string, RowRef>() : rowRefsOf(format.declaration, format.rows, labels.value)
      refs.set(name, made)
      return made
    }
    const records = readings.map((reading): ReadingRecord => ({
      ...reading,
      rows: reading.rows.flatMap((row) => {
        const ref = refsOf(row.format ?? reading.format).get(row.id)
        return ref === undefined ? [] : [{ format: row.format, key: row.key, written: row.written, row: ref }]
      }),
    }))
    parts.push({ name: READINGS_PART, text: writeReadings(records, content.readerNames ?? []) })
  }

  // **When each format last changed** (M47 U5, D-462) — a day, not an instant,
  // so two writes to one format on one day are one line's diff, and only the
  // formats this document still declares.
  const marked = [...(content.changed ?? [])].filter(([name]) =>
    formats.some((format) => format.declaration.name === name),
  )
  if (marked.length > 0) parts.push({ name: CHANGED_PART, text: writeChanged(new Map(marked)) })

  return ok(parts)
}

/**
 * Every row of a format by the `RowRef` the text names it with: its name, and
 * which of that name it is in the order `writeFormat` writes the rows.
 */
function rowRefsOf(
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  labels: ReadonlyMap<string, string>,
): ReadonlyMap<string, RowRef> {
  const blocks = sortedBlocks(declaration, rows, labels)
  if (!blocks.ok) return new Map()
  const naming = labelColumn(declaration)
  const seen = new Map<string, number>()
  const refs = new Map<string, RowRef>()
  for (const block of blocks.value) {
    const label = naming === undefined ? undefined : block.row.cells[naming.name]
    const name = typeof label === 'string' ? label : ''
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    refs.set(block.row.id, { name, n })
  }
  return refs
}

/**
 * The same, for the rows as the text read them back — in the text's order,
 * which is the order `rowRefsOf` counted in. A repository pairs each with the
 * id the row was written under.
 */
export function parsedRowRefs(declaration: FormatDeclaration, rows: readonly ParsedRow[]): readonly RowRef[] {
  const naming = labelColumn(declaration)
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const label = naming === undefined ? undefined : row.cells[naming.name]
    const name = typeof label === 'string' ? label : ''
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return { name, n }
  })
}

/**
 * Text back into a document's declared half, or one sentence saying why not.
 *
 * **Every declaration is parsed before any is checked** (M29 F1, D-336). A
 * link is checked against the format it points at and an aggregate against the
 * format it folds, and the two point opposite ways: `shift.person` names
 * `person` while `person.total_hours` folds `shift`. A reader that checked
 * each part as it went, against only the parts already read, waited on each
 * for the other — so a document the app had saved would not open, which is
 * the worst thing a document app can do. Checked against the whole set, a
 * cycle is just a document; a link or a fold naming a format that is not there
 * is still refused, in the sentence the declaration's own check writes.
 *
 * The formats come back in **link order** — a link's target before the format
 * that names it, where there is one — because that is the order a person reads
 * a document in and the order `applyDocument` adopts them. Two formats that
 * link to each other have no such order and keep the parts' own.
 */
export function readDocument(parts: readonly DocumentPart[]): Result<ParsedDocument, string> {
  const unitsPart = parts.find((part) => part.name === UNITS_PART)
  const units = unitsPart === undefined ? ok(SEEDED_UNITS) : readUnits(unitsPart.text)
  if (!units.ok) return units

  const seedsPart = parts.find((part) => part.name === SEEDS_PART)
  const seeds = seedsPart === undefined ? ok([]) : readSeeds(seedsPart.text)
  if (!seeds.ok) return seeds

  const viewsPart = parts.find((part) => part.name === VIEWS_PART)
  const views = viewsPart === undefined ? ok({ widths: [], views: [], saved: [], dashboards: [] }) : readViews(viewsPart.text)
  if (!views.ok) return views

  const graphPart = parts.find((part) => part.name === GRAPH_PART)
  const places = graphPart === undefined ? ok([]) : readPlaces(graphPart.text)
  if (!places.ok) return places

  const settingsPart = parts.find((part) => part.name === SETTINGS_PART)
  const settings = settingsPart === undefined ? ok<DocumentSettings>({}) : readSettings(settingsPart.text)
  if (!settings.ok) return settings

  const changedPart = parts.find((part) => part.name === CHANGED_PART)
  const changed = changedPart === undefined ? ok(new Map<string, string>()) : readChanged(changedPart.text)
  if (!changed.ok) return changed

  const readingsPart = parts.find((part) => part.name === READINGS_PART)
  const readings = readingsPart === undefined ? ok({ readings: [], readerNames: [] }) : readReadings(readingsPart.text)
  if (!readings.ok) return readings

  const pending = parts.filter((part) => part.name.endsWith(ARTEFACT_EXTENSION))
  if (pending.length === 0) return err('The document has no formats in it.')

  // Every declaration's shape first, so the check below sees all of them.
  const parsed: { readonly part: DocumentPart; readonly split: SplitFormat; readonly declaration: FormatDeclaration }[] = []
  for (const part of pending) {
    const split = splitFormat(part.text)
    if (!split.ok) return err(`${part.name}: ${split.error}`)
    const declaration = parseArtefact(split.value.declaration)
    if (!declaration.ok) return err(`${part.name}: ${declaration.error}`)
    parsed.push({ part, split: split.value, declaration: declaration.value })
  }

  const declarations = parsed.map((each) => each.declaration)
  const done: ParsedFormat[] = []
  for (const { part, split, declaration } of parsed) {
    const rejection = declarationRejection(
      declaration,
      declarations.filter((each) => each.name !== declaration.name),
      units.value,
    )
    if (rejection !== undefined) return err(`${part.name}: ${rejection}`)
    const rows = readRows(declaration, split, units.value)
    if (!rows.ok) return err(`${part.name}: ${rows.error}`)
    done.push({ declaration, rows: rows.value })
  }

  return ok({
    units: units.value,
    formats: inLinkOrder(done),
    seeds: seeds.value,
    widths: views.value.widths,
    places: places.value,
    views: views.value.views,
    saved: views.value.saved,
    dashboards: views.value.dashboards,
    currency: settings.value.currency,
    weekStart: settings.value.weekStart,
    readings: readings.value.readings,
    readerNames: readings.value.readerNames,
    changed: changed.value,
  })
}

/**
 * A link's target before the format naming it, where there is such an order;
 * otherwise the order they came in. A format naming itself waits on nothing.
 */
function inLinkOrder(formats: readonly ParsedFormat[]): readonly ParsedFormat[] {
  const left = [...formats]
  const placed: ParsedFormat[] = []
  const isPlaced = (name: string): boolean => placed.some((each) => each.declaration.name === name)
  while (left.length > 0) {
    const ready = left.findIndex(({ declaration }) =>
      declaration.columns.every(
        (column) =>
          !isLinkType(column.type) ||
          column.target === undefined ||
          column.target === declaration.name ||
          isPlaced(column.target) ||
          !left.some((each) => each.declaration.name === column.target),
      ),
    )
    placed.push(...left.splice(ready === -1 ? 0 : ready, 1))
  }
  return placed
}

/**
 * One format: `artefact.ts`'s file with its rows after it.
 *
 * `labels` answers *what is the row with this id called* for every link in the
 * document — built once by `writeDocument`, because a link may point into a
 * format this call knows nothing about.
 */
export function writeFormat(
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  labels: ReadonlyMap<string, string>,
): Result<string, string> {
  const artefact = writeArtefact(declaration)
  if (artefact.split('\n').some((line) => line.trim() === ROWS_MARKER)) {
    return err(
      `The notes on ${declaration.name} contain a line saying "${ROWS_MARKER}", which is the line ` +
        'that separates a declaration from its rows. Reword it.',
    )
  }

  const sorted = sortedBlocks(declaration, rows, labels)
  if (!sorted.ok) return sorted
  const blocks = sorted.value

  return ok(
    [
      artefact.trimEnd(),
      '',
      ROWS_MARKER,
      ...blocks.flatMap((block) => ['', `### ${block.heading}`.trimEnd(), ...block.body]),
      '',
    ].join('\n'),
  )
}

/** A row rendered as its block, with the row it came from. */
interface RowBlock {
  readonly heading: string
  readonly body: readonly string[]
  readonly row: StoredRow
}

/**
 * A format's rows as blocks, in the order the text writes them: **by what the
 * text says and never by the id**, which the text does not carry. The name
 * first because that is the order a person reading the file expects; the
 * rendered body as the tiebreak because two rows with the same name still have
 * to land somewhere, and a tiebreak that is not in the text would not survive
 * the round trip it exists to make stable.
 */
function sortedBlocks(
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  labels: ReadonlyMap<string, string>,
): Result<readonly RowBlock[], string> {
  const blocks: RowBlock[] = []
  for (const row of rows) {
    const block = writeRow(declaration, row, labels)
    if (!block.ok) return block
    blocks.push({ ...block.value, row })
  }
  blocks.sort((a, b) => {
    const byHeading = compareText(a.heading, b.heading)
    return byHeading === 0 ? compareText(a.body.join('\n'), b.body.join('\n')) : byHeading
  })
  return ok(blocks)
}

/** One format's text back into a declaration and its rows. */
export function readFormat(
  text: string,
  units: UnitTable = SEEDED_UNITS,
  neighbours: readonly FormatDeclaration[] = [],
): Result<ParsedFormat, string> {
  const split = splitFormat(text)
  if (!split.ok) return split

  const declaration = readArtefact(split.value.declaration, units, neighbours)
  if (!declaration.ok) return declaration

  const rows = readRows(declaration.value, split.value, units)
  return rows.ok ? ok({ declaration: declaration.value, rows: rows.value }) : rows
}

/** One format's text, cut at its rows marker. */
interface SplitFormat {
  /** Everything above the marker: what `artefact.ts` reads. */
  readonly declaration: string
  readonly lines: readonly string[]
  /** The marker's line index; the rows begin after it. */
  readonly at: number
}

function splitFormat(text: string): Result<SplitFormat, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const markers = lines.flatMap((line, index) => (line.trim() === ROWS_MARKER ? [index] : []))

  if (markers.length === 0) {
    return err(`No "${ROWS_MARKER}" line, which is what separates a declaration from its rows.`)
  }
  if (markers.length > 1) {
    return err(
      `Two "${ROWS_MARKER}" lines, at ${String(markers[0] ?? 0 + 1)} and ` +
        `${String((markers[1] ?? 0) + 1)}. A format has one.`,
    )
  }
  const at = markers[0] ?? 0
  return ok({ declaration: lines.slice(0, at).join('\n'), lines, at })
}

function readRows(
  declaration: FormatDeclaration,
  split: SplitFormat,
  units: UnitTable,
): Result<readonly ParsedRow[], string> {
  const rows: ParsedRow[] = []
  for (const block of blocksIn(split.lines, split.at + 1)) {
    if (!block.ok) return block
    const row = readRow(declaration, block.value, units)
    if (!row.ok) return row
    rows.push(row.value)
  }
  return ok(rows)
}

/**
 * The parts folded into one text, for a caller that wants one file.
 *
 * An HTML comment, so a rendered view of the file shows the documents and not
 * the seams. Refused rather than escaped when a part already contains one: a
 * separator that can appear inside a part is a separator that splits the wrong
 * file one day, and there is nothing here worth that.
 */
export function joinParts(parts: readonly DocumentPart[]): Result<string, string> {
  for (const part of parts) {
    if (part.text.split('\n').some((line) => line.trimStart().startsWith(PART_MARKER))) {
      return err(
        `${part.name} contains a line beginning "${PART_MARKER}", which is the line that ` +
          'separates one part of a document from the next. Reword it.',
      )
    }
  }
  return ok(parts.map((part) => `${PART_MARKER} ${part.name} -->\n${part.text}`).join('\n'))
}

/** One text back into the parts it was folded from. */
export function splitParts(text: string): Result<readonly DocumentPart[], string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const parts: DocumentPart[] = []
  let name: string | undefined
  let body: string[] = []

  const close = (): void => {
    if (name !== undefined) parts.push({ name, text: `${body.join('\n').replace(/\n+$/, '')}\n` })
  }

  for (const line of lines) {
    const marked = /^\s*<!--\s*emerald:\s*(\S+)\s*-->\s*$/.exec(line)
    if (marked === null) {
      if (name !== undefined) body.push(line)
      continue
    }
    close()
    name = marked[1] ?? ''
    body = []
  }
  close()

  if (parts.length === 0) {
    return err(`No "${PART_MARKER} …" line, so this text holds no parts of a document.`)
  }
  return ok(parts)
}

/**
 * What every row that anything points at is called.
 *
 * Built across the whole document rather than per format, because an id is
 * unique document-wide and a map per link column would be the same entries under
 * more keys — the arrangement `linkLabels` already settled on.
 *
 * **Only the formats something points at**, which is what makes the three
 * refusals below bearable: a format nobody links to may have no text column, or
 * repeat itself, and nothing about the text depends on it.
 */
function labelIndexOf(formats: readonly FormatContent[]): Result<ReadonlyMap<string, string>, string> {
  const pointedAt = new Set(
    formats.flatMap((format) =>
      format.declaration.columns.flatMap((column) =>
        isLinkType(column.type) && column.target !== undefined ? [column.target] : [],
      ),
    ),
  )

  const labels = new Map<string, string>()
  for (const format of formats) {
    if (!pointedAt.has(format.declaration.name)) continue

    const naming = labelColumn(format.declaration)
    if (naming === undefined) {
      return err(
        `Something points at ${format.declaration.name}, which has no text column, so a link to ` +
          'one of its rows has no name to be written as. Give it one.',
      )
    }

    const seen = new Set<string>()
    for (const row of format.rows) {
      const label = row.cells[naming.name]
      if (typeof label !== 'string' || label.trim() === '') {
        return err(
          `A row of ${format.declaration.name} has no ${naming.name}, which is what a link to it ` +
            'would be written as. Fill it in, or nothing can point at that row by name.',
        )
      }
      if (seen.has(label)) {
        return err(
          `Two rows of ${format.declaration.name} have ${naming.name} "${label}". A link is ` +
            'written as that name, so the two cannot be told apart. Make them different.',
        )
      }
      seen.add(label)
      labels.set(row.id, label)
    }
  }
  return ok(labels)
}

/** One row as its heading and its `key: value` lines. */
function writeRow(
  declaration: FormatDeclaration,
  row: StoredRow,
  labels: ReadonlyMap<string, string>,
): Result<{ readonly heading: string; readonly body: readonly string[] }, string> {
  // **The name is the heading and is not written twice.** A row whose name
  // appeared in both would be a row whose two copies can disagree after a merge,
  // and the one thing this file sells is a shape that cannot drift.
  const naming = labelColumn(declaration)
  const label = naming === undefined ? null : row.cells[naming.name]
  const heading = typeof label === 'string' ? writeScalar(label) : ''

  const body: string[] = []
  for (const column of declaration.columns) {
    if (column.name === naming?.name) continue

    if (column.type === 'money') {
      const names = moneyColumnNames(column)
      const minor = row.cells[names.minor]
      const currency = row.cells[names.currency]
      if (typeof minor !== 'number' || typeof currency !== 'string') continue
      body.push(`${column.name}: ${toDecimalString(money(minor, currency))}`)
      body.push(`${names.currency}: ${currency}`)
      continue
    }

    if (column.type === 'quantity') {
      const names = quantityColumnNames(column)
      const amount = row.cells[names.amount]
      const unit = row.cells[names.unit]
      if (typeof amount !== 'number' || typeof unit !== 'string' || unit === '') continue
      body.push(`${column.name}: ${String(amount)}`)
      body.push(`${names.unit}: ${writeScalar(unit)}`)
      continue
    }

    const cell = row.cells[column.name]
    if (cell === null || cell === undefined) continue

    // **Several names, as a JSON list** (M27 U2, D-300): `blocks: ["M27 U1",
    // "M27 U3"]`. A list rather than names split on a comma, because a name
    // may hold a comma and the text has to give back exactly what it was
    // given. An empty list is no line, as an empty link is.
    if (column.type === 'links') {
      const ids = idsIn(cell)
      if (ids.length === 0) continue
      const names: string[] = []
      for (const id of ids) {
        const named = labels.get(id)
        if (named === undefined) {
          return err(
            `A row of ${declaration.name} has ${column.name} listing a row of ` +
              `${column.target ?? 'another format'} that is not in the document. Take it out of the ` +
              'list, or put the row back.',
          )
        }
        names.push(named)
      }
      body.push(`${column.name}: ${JSON.stringify(names)}`)
      continue
    }
    // **Several of a list, as a JSON list of its members** (M34 U5, D-398):
    // `tags: ["vegan", "quick"]`, written the way a `links` list is and for its
    // reason — a member may hold a comma. An empty list is no line.
    if (column.type === 'enums') {
      const members = idsIn(cell)
      if (members.length > 0) body.push(`${column.name}: ${JSON.stringify(members)}`)
      continue
    }
    if (typeof cell !== 'string' && typeof cell !== 'number') continue

    if (column.type === 'link') {
      if (typeof cell !== 'string') continue
      const named = labels.get(cell)
      if (named === undefined) {
        // A link whose row is gone. `danglingLinks` is what reports one inside
        // the app; here it is a refusal, because the text has no way to say
        // *points at something that is not here* and writing nothing would
        // delete the pointer on the way back in — quietly, which is the one
        // thing this project has decided it will not do.
        return err(
          `A row of ${declaration.name} has ${column.name} pointing at a row of ` +
            `${column.target ?? 'another format'} that is not in the document. Clear it, or put ` +
            'the row back.',
        )
      }
      body.push(`${column.name}: ${writeScalar(named)}`)
      continue
    }

    if (column.type === 'boolean') {
      body.push(`${column.name}: ${cell === 1 ? 'true' : 'false'}`)
      continue
    }

    // The figure, not the integer it is stored as (M24 U6, D-257): the text is
    // read back through the same coercion a tool uses, which takes a figure.
    if (column.type === 'decimal' && typeof cell === 'number') {
      body.push(`${column.name}: ${formatDecimal(cell, column.scale ?? 0)}`)
      continue
    }
    // `12.5%`, as it is entered and shown, and read back the same way (D-333).
    if (column.type === 'percent' && typeof cell === 'number') {
      body.push(`${column.name}: ${formatStoredPercent(cell)}`)
      continue
    }

    body.push(
      `${column.name}: ${typeof cell === 'number' ? String(cell) : writeScalar(cell)}`,
    )
  }

  return ok({ heading, body })
}

/** One row's lines back into cells, through the same coercion a tool uses. */
function readRow(
  declaration: FormatDeclaration,
  block: Block,
  units: UnitTable,
): Result<ParsedRow, string> {
  const naming = labelColumn(declaration)
  const offered = new Map(block.cells)

  if (naming !== undefined) {
    if (offered.has(naming.name)) {
      return err(
        `Line ${String(block.line)}: ${naming.name} is the name of a row of ${declaration.name}, ` +
          'so it is written as the ### heading rather than as a line of its own.',
      )
    }
    if (block.heading !== undefined) offered.set(naming.name, block.heading)
  }

  // **An unknown key is refused rather than dropped** (D-138). A hand-merged
  // file that says `protein` where the format declares `protein_g` has not
  // written a row with a figure missing — whoever wrote it believes the figure
  // is there.
  const known = new Set(offeredKeysOf(declaration))
  for (const key of offered.keys()) {
    if (!known.has(key)) {
      return err(
        `Line ${String(block.line)}: ${declaration.name} has no ${key}. It has ` +
          `${[...known].join(', ')}.`,
      )
    }
  }

  const cells: Record<string, StoredValue> = {}
  const links: Record<string, string | readonly string[]> = {}

  for (const column of declaration.columns) {
    if (column.type === 'links') {
      const written = offered.get(column.name)
      if (written === undefined || written === '') continue
      const names = namesIn(written)
      if (names === undefined) {
        return err(
          `Line ${String(block.line)}: ${column.name} lists rows of ${column.target ?? 'another format'}, ` +
            `written as a JSON list of their names — ["M27 U1", "M27 U3"]. Got ${written}.`,
        )
      }
      if (names.length > 0) links[column.name] = names
      continue
    }

    if (column.type === 'enums') {
      const written = offered.get(column.name)
      if (written === undefined || written === '') {
        cells[column.name] = []
        continue
      }
      const members = namesIn(written)
      if (members === undefined) {
        return err(
          `Line ${String(block.line)}: ${column.name} holds several of ${column.values.join(', ')}, ` +
            `written as a JSON list — ["${column.values[0] ?? 'one'}"]. Got ${written}.`,
        )
      }
      const coerced = coerceValue(column, members, undefined, units)
      if (!coerced.ok) return err(`Line ${String(block.line)}: ${coerced.error}`)
      Object.assign(cells, coerced.value)
      continue
    }

    if (column.type === 'link') {
      const named = offered.get(column.name)
      if (named === undefined || named === '') {
        if (column.required) {
          return err(`Line ${String(block.line)}: ${column.name} is required and was not given.`)
        }
        cells[column.name] = null
        continue
      }
      links[column.name] = named
      continue
    }

    if (column.type === 'money') {
      const names = moneyColumnNames(column)
      const amount = offered.get(column.name)
      const code = offered.get(names.currency)
      if (amount === undefined && code === undefined) {
        if (column.required) {
          return err(`Line ${String(block.line)}: ${column.name} is required and was not given.`)
        }
        cells[names.minor] = null
        cells[names.currency] = null
        continue
      }
      const currency: CurrencyCode = (code ?? '').trim().toUpperCase()
      const value = amount === undefined ? undefined : fromDecimalString(amount, currency)
      if (value === undefined || !/^[A-Z]{3}$/.test(currency)) {
        return err(
          `Line ${String(block.line)}: ${column.name} is money, written as an amount in major ` +
            `units beside ${names.currency} as a three-letter code. Got "${amount ?? ''}" and ` +
            `"${code ?? ''}".`,
        )
      }
      cells[names.minor] = value.minor
      cells[names.currency] = value.currency
      continue
    }

    if (column.type === 'text') {
      // **The one type that does not go through `coerceValue`**, and it is the
      // empty string that forces it. A tool treats `""` as *nothing was given*,
      // which is right when a conversation sends it and wrong here: this text
      // came out of the table, and a `NOT NULL` column holding an empty string
      // is a row SQLite permits. Turning it into null on the way back would be
      // a cell changing value during a round trip that exists to prove none do.
      // Nothing is lost by the bypass — a text column has no bound, no member
      // list and no shape, so the check being skipped is the check for a string.
      const value = offered.get(column.name)
      if (value === undefined) {
        if (column.required) {
          return err(`Line ${String(block.line)}: ${column.name} is required and was not given.`)
        }
        cells[column.name] = null
        continue
      }
      cells[column.name] = value
      continue
    }

    const beside =
      column.type === 'quantity' ? offered.get(quantityColumnNames(column).unit) : undefined
    const coerced = coerceValue(column, offered.get(column.name), beside, units)
    if (!coerced.ok) return err(`Line ${String(block.line)}: ${coerced.error}`)
    Object.assign(cells, coerced.value)
  }

  return ok({ cells, links })
}

/** A `links` line's JSON list of names, or nothing when it is not one. */
function namesIn(written: string): readonly string[] | undefined {
  const names = stringListOf(written)
  return names?.every((each) => each !== '') === true ? names : undefined
}

/** One `### heading` and the `key: value` lines under it. */
interface Block {
  /** Absent when the heading carried nothing, which is a row with no name. */
  readonly heading: string | undefined
  readonly cells: ReadonlyMap<string, string>
  /** The heading's line number, for the message when something below it is wrong. */
  readonly line: number
}

/** Every row block from `from` onward, or the first line that is not one. */
function* blocksIn(lines: readonly string[], from: number): Generator<Result<Block, string>> {
  let heading: string | undefined
  let cells = new Map<string, string>()
  let line = 0

  for (let index = from; index <= lines.length; index += 1) {
    const text = lines[index] ?? ''
    const isHeading = index < lines.length && /^###(\s|$)/.test(text)

    if (isHeading || index === lines.length) {
      if (line !== 0) yield ok({ heading, cells, line })
      if (index === lines.length) return

      const written = text.slice(3).trim()
      const decoded = written === '' ? ok(undefined) : readScalar(written)
      if (!decoded.ok) {
        yield err(`Line ${String(index + 1)}: ${decoded.error}`)
        return
      }
      heading = decoded.value
      cells = new Map()
      line = index + 1
      continue
    }

    if (text.trim() === '') continue

    const pair = /^([a-z][a-z0-9_]*):(.*)$/.exec(text)
    if (pair === null || line === 0) {
      yield err(
        `Line ${String(index + 1)}: expected "### a row's name" or "column: value", got "${text}".`,
      )
      return
    }

    const key = pair[1] ?? ''
    if (cells.has(key)) {
      yield err(`Line ${String(index + 1)}: ${key} is given twice in one row.`)
      return
    }
    const value = readScalar((pair[2] ?? '').trim())
    if (!value.ok) {
      yield err(`Line ${String(index + 1)}: ${value.error}`)
      return
    }
    cells.set(key, value.value)
  }
}

/**
 * The units the document knows, when they are not the ones it was seeded with.
 *
 * The same block shape as a row, for the same reason: a unit's note is prose
 * somebody wrote and a pipe table cannot hold a newline in a cell.
 */
export function writeUnits(units: UnitTable): string {
  return [
    '---',
    'emerald: units',
    '---',
    ...sortedUnits(units).flatMap((unit) => [
      '',
      `### ${writeScalar(unit.symbol)}`,
      `dimension: ${unit.dimension}`,
      `per_base: ${String(unit.perBase)}`,
      `origin: ${unit.origin}`,
      ...(unit.note === '' ? [] : [`note: ${writeScalar(unit.note)}`]),
    ]),
    '',
  ].join('\n')
}

/** The units part back into a table, checked by the same rule that stores one. */
export function readUnits(text: string): Result<UnitTable, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || start === -1) {
    return err('The units part starts with a --- block saying "emerald: units".')
  }

  const rows: UnitRow[] = []
  for (const block of blocksIn(lines, start + 1)) {
    if (!block.ok) return block

    const symbol = block.value.heading
    const dimension = block.value.cells.get('dimension')
    const perBase = Number(block.value.cells.get('per_base'))
    const origin = block.value.cells.get('origin')

    if (symbol === undefined || dimension === undefined || origin === undefined) {
      return err(
        `Line ${String(block.value.line)}: a unit is a ### symbol with dimension, per_base and ` +
          'origin under it.',
      )
    }
    if (!isDimension(dimension)) {
      return err(
        `Line ${String(block.value.line)}: ${symbol} is in ${dimension}, which is not one of ` +
          `${DIMENSIONS.join(', ')}.`,
      )
    }
    if (origin !== 'SEEDED' && origin !== 'USER') {
      return err(`Line ${String(block.value.line)}: ${symbol} is ${origin}, not SEEDED or USER.`)
    }

    const row: UnitRow = {
      symbol,
      dimension,
      perBase,
      origin: origin satisfies UnitOrigin,
      note: block.value.cells.get('note') ?? '',
    }
    const rejection = unitRejection(row)
    if (rejection !== undefined) return err(`Line ${String(block.value.line)}: ${rejection}`)
    rows.push(row)
  }

  return ok(rows)
}

/**
 * Which rows are a pack's (D-264): one block per record, named by the row, in
 * the order the table orders them — by format, then by name.
 */
export function writeSeeds(seeds: readonly SeedRecord[]): string {
  const sorted = [...seeds].sort(
    (a, b) => compareText(a.format, b.format) || compareText(a.key, b.key),
  )
  return [
    '---',
    'emerald: seeds',
    '---',
    ...sorted.flatMap((seed) => [
      '',
      `### ${writeScalar(seed.key)}`,
      `format: ${seed.format}`,
      `state: ${seed.state}`,
    ]),
    '',
  ].join('\n')
}

/** The seeds part back into records. */
export function readSeeds(text: string): Result<readonly SeedRecord[], string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || start === -1) {
    return err('The seeds part starts with a --- block saying "emerald: seeds".')
  }

  const seeds: SeedRecord[] = []
  for (const block of blocksIn(lines, start + 1)) {
    if (!block.ok) return block
    const key = block.value.heading
    const format = block.value.cells.get('format')
    const state = block.value.cells.get('state')
    if (key === undefined || format === undefined || (state !== 'SEEDED' && state !== 'REMOVED')) {
      return err(
        `Line ${String(block.value.line)}: a seed is a ### name with format and state ` +
          '(SEEDED or REMOVED) under it.',
      )
    }
    seeds.push({ format, key, state })
  }
  return ok(seeds)
}

/**
 * How a format is shown: one block per format with the widths its sheet's
 * columns were dragged to (D-289), then one block per format and view with what
 * that view keeps per column (D-294) — `### recipe entry` and `method: markdown`
 * — all in name order. A format name has no space in it, so the word after one
 * is the view's. Then each saved view as a block of its own under `### recipe
 * saved` — its `name`, `kind` and `address` (M53 U5, D-520) — in name order.
 * Then each dashboard's blocks in its order (M53 U7, D-521), the document's
 * first under `### Document dashboard` — a capital no format's name has — and
 * each format's under `### recipe dashboard`: `kind`, `name`, the `format` it
 * reads on the document's, a headline total's `sum` and `address`, and the
 * block's `width` and `height` when it was given a size (M53 F4, D-527).
 */
export function writeWidths(
  widths: readonly ColumnWidth[],
  views: readonly ViewSetting[] = [],
  saved: readonly SavedView[] = [],
  dashboards: readonly DashboardBlock[] = [],
): string {
  const formats = [...new Set(widths.map((each) => each.format))].sort(compareText)
  const viewed = [...new Set(views.map((each) => `${each.format} ${each.view}`))].sort(compareText)
  return [
    '---',
    'emerald: views',
    '---',
    ...formats.flatMap((format) => [
      '',
      `### ${format}`,
      ...widths
        .filter((each) => each.format === format)
        .sort((a, b) => compareText(a.column, b.column))
        .map((each) => `${each.column}: ${String(each.width)}`),
    ]),
    ...viewed.flatMap((heading) => [
      '',
      `### ${heading}`,
      ...views
        .filter((each) => `${each.format} ${each.view}` === heading)
        .sort((a, b) => compareText(a.column, b.column))
        .map((each) => `${each.column}: ${each.setting}`),
    ]),
    ...[...saved]
      .sort((a, b) => compareText(a.format, b.format) || compareText(a.name, b.name))
      .flatMap((each) => [
        '',
        `### ${each.format} ${SAVED_HEADING}`,
        `name: ${writeScalar(each.name)}`,
        `kind: ${each.kind}`,
        ...(each.address === '' ? [] : [`address: ${writeScalar(each.address)}`]),
      ]),
    ...[...dashboards]
      // Stable: each dashboard's blocks keep the order they were given in.
      .sort((a, b) => compareText(a.dashboard ?? '', b.dashboard ?? ''))
      .flatMap((each) => [
        '',
        `### ${each.dashboard ?? DOCUMENT_DASHBOARD} ${DASHBOARD_HEADING}`,
        `kind: ${each.kind}`,
        `name: ${writeScalar(each.name)}`,
        ...(each.dashboard === undefined ? [`format: ${each.format}`] : []),
        ...(each.kind === 'total' && each.sum !== undefined ? [`sum: ${each.sum}`] : []),
        ...(each.kind === 'total' && each.address !== '' ? [`address: ${writeScalar(each.address)}`] : []),
        ...(each.width === undefined ? [] : [`width: ${String(each.width)}`]),
        ...(each.height === undefined ? [] : [`height: ${String(each.height)}`]),
      ]),
    '',
  ].join('\n')
}

/** The word after a format's name — or `Document` — that heads a dashboard's block in the views part. */
const DASHBOARD_HEADING = 'dashboard'

/** The word after a format's name that heads a saved view's block in the views part. */
const SAVED_HEADING = 'saved'

/** The views part back into widths and view settings. */
export function readViews(
  text: string,
): Result<
  {
    readonly widths: readonly ColumnWidth[]
    readonly views: readonly ViewSetting[]
    readonly saved: readonly SavedView[]
    readonly dashboards: readonly DashboardBlock[]
  },
  string
> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || start === -1) {
    return err('The views part starts with a --- block saying "emerald: views".')
  }

  const widths: ColumnWidth[] = []
  const views: ViewSetting[] = []
  const saved: SavedView[] = []
  const dashboards: DashboardBlock[] = []
  for (const block of blocksIn(lines, start + 1)) {
    if (!block.ok) return block
    const heading = block.value.heading
    if (heading === undefined) {
      return err(`Line ${String(block.value.line)}: a view is a ### format name with its columns under it.`)
    }
    const [format = '', view, ...rest] = heading.split(/\s+/)
    if (view === DASHBOARD_HEADING && rest.length === 0) {
      const read = readBlock(format === DOCUMENT_DASHBOARD ? undefined : format, block.value.cells, block.value.line)
      if (!read.ok) return read
      if (dashboards.some((each) => each.dashboard === read.value.dashboard && each.format === read.value.format && each.name === read.value.name)) {
        return err(`Line ${String(block.value.line)}: ${format}’s dashboard has two blocks called ${read.value.name}.`)
      }
      dashboards.push(read.value)
      continue
    }
    if (view === SAVED_HEADING && rest.length === 0) {
      const read = readSaved(format, block.value.cells, block.value.line)
      if (!read.ok) return read
      if (saved.some((each) => each.format === format && each.name === read.value.name)) {
        return err(`Line ${String(block.value.line)}: ${format} has two saved views called ${read.value.name}.`)
      }
      saved.push(read.value)
      continue
    }
    if (view !== undefined) {
      if (rest.length > 0 || !isViewKind(view)) {
        return err(
          `Line ${String(block.value.line)}: ${heading} is a format name and a view, and ${view} is not a view this app has.`,
        )
      }
      for (const [column, setting] of block.value.cells) {
        if (!isViewSetting(view, setting)) {
          return err(
            view === 'entry'
              ? `Line ${String(block.value.line)}: ${column} under ${heading} is a way to show it (line, markdown, figure, bar…), a place like #2, header, hidden, new, or several of them, ` +
                  `and ${setting} is not.`
              : `Line ${String(block.value.line)}: ${column} under ${heading} is ${VIEW_PARTS[view].join(' or ')}, ` +
                  `and ${setting} is not.`,
          )
        }
        views.push({ format, view, column, setting })
      }
      continue
    }
    for (const [column, written] of block.value.cells) {
      const width = Number(written)
      if (!/^\d+$/.test(written) || boundedWidth(width) !== width) {
        return err(
          `Line ${String(block.value.line)}: ${column} under ${format} is a width in whole pixels, ` +
            `and ${written} is not one the sheet takes.`,
        )
      }
      widths.push({ format, column, width })
    }
  }
  return ok({ widths, views, saved, dashboards })
}

/**
 * One `### format dashboard` block back into a dashboard's block (M53 U7,
 * D-521): a `kind` and a `name`, the `format` it reads on the document's, a
 * headline total's `sum` and `address`, and its `width` and `height` (M53 F4).
 */
function readBlock(dashboard: string | undefined, cells: ReadonlyMap<string, string>, line: number): Result<DashboardBlock, string> {
  const at = `Line ${String(line)}: a block on ${dashboard ?? 'the document'}’s dashboard`
  const allowed = ['kind', 'name', 'format', 'sum', 'address', 'width', 'height']
  const stray = [...cells.keys()].filter((key) => !allowed.includes(key))
  if (stray.length > 0) {
    return err(`${at} has a kind, a name, a format, a sum, an address, a width and a height, and ${stray.join(', ')} is none of them.`)
  }
  const kind = cells.get('kind') ?? ''
  if (!isBlockKind(kind)) return err(`${at} is ${BLOCK_KINDS.join(', ')}, and ${kind === '' ? 'it names none' : kind} is not one.`)
  const name = cells.get('name') ?? ''
  const refusal = totalNameRefusal(name)
  if (refusal !== undefined) return err(`${at}: ${refusal}`)
  const format = dashboard ?? cells.get('format') ?? ''
  if (format === '') return err(`${at} names the \`format\` it reads.`)
  if (dashboard !== undefined && cells.has('format') && cells.get('format') !== dashboard) {
    return err(`${at} reads ${dashboard}; a format’s dashboard holds its own views.`)
  }
  const sum = cells.get('sum')
  const address = cells.get('address') ?? ''
  if (kind !== 'total' && (sum !== undefined || address !== '')) return err(`${at} is a ${kind}; only a headline total has a sum and an address.`)
  const size = { width: wholeOf(cells.get('width')), height: wholeOf(cells.get('height')) }
  const wrong = blockSizeRefusal(size)
  if (wrong !== undefined) return err(`${at}: ${wrong}`)
  return ok({
    dashboard,
    format,
    kind,
    name,
    ...(sum === undefined || sum === '' ? {} : { sum }),
    address: savedAddress(address),
    // Refused above unless each is a whole number in range.
    ...(typeof size.width === 'number' ? { width: size.width } : {}),
    ...(typeof size.height === 'number' ? { height: size.height } : {}),
  })
}

/** A size's line as written — a whole number, or what was written for the refusal to name. */
function wholeOf(written: string | undefined): number | string | undefined {
  if (written === undefined || written.trim() === '') return undefined
  return /^\d+$/.test(written.trim()) ? Number(written.trim()) : written
}

/** One `### format saved` block back into a saved view: a `name`, a `kind`, and an `address` when it holds one. */
function readSaved(format: string, cells: ReadonlyMap<string, string>, line: number): Result<SavedView, string> {
  const at = `Line ${String(line)}: a saved view of ${format}`
  const stray = [...cells.keys()].filter((key) => key !== 'name' && key !== 'kind' && key !== 'address')
  if (stray.length > 0) return err(`${at} has a name, a kind and an address, and ${stray.join(', ')} is none of them.`)
  const name = cells.get('name') ?? ''
  const refusal = savedNameRefusal(name)
  if (refusal !== undefined) return err(`${at}: ${refusal}`)
  const kind = cells.get('kind') ?? ''
  if (!isSavedKind(kind)) return err(`${at} opens as ${SAVED_KINDS.join(', ')}, and ${kind === '' ? 'it names none' : kind} is not one.`)
  return ok({ format, name, kind, address: savedAddress(cells.get('address') ?? '') })
}

/**
 * What was read in (M38 U3, D-408): one block per reading — headed by the file,
 * in the order format, file, moment — with its mapping and the rows it wrote,
 * then one block per name a person gave a reader. The mapping and the rows are
 * JSON on one line each: bookkeeping a person rarely reads, kept exact.
 */
export function writeReadings(readings: readonly ReadingRecord[], readerNames: readonly ReaderNameRecord[]): string {
  const sorted = [...readings].sort(
    (a, b) =>
      compareText(a.format, b.format) ||
      compareText(a.file, b.file) ||
      a.readAt - b.readAt ||
      compareText(a.hash, b.hash),
  )
  const names = [...readerNames].sort(
    (a, b) => compareText(a.format, b.format) || compareText(a.signature, b.signature),
  )
  const binding = (each: ReadingBinding): Record<string, string | number> => ({
    key: each.key,
    ...(each.row === undefined ? {} : { row: each.row }),
    ...(each.index === undefined ? {} : { index: each.index }),
    ...(each.fixed === undefined ? {} : { fixed: each.fixed }),
    ...(each.separator === undefined ? {} : { separator: each.separator }),
  })
  return [
    '---',
    'emerald: readings',
    '---',
    ...sorted.flatMap((reading) => [
      '',
      `### ${writeScalar(reading.file)}`,
      `format: ${reading.format}`,
      `hash: ${writeScalar(reading.hash)}`,
      `signature: ${writeScalar(reading.signature)}`,
      `read_at: ${String(reading.readAt)}`,
      `header_row: ${String(reading.headerRow)}`,
      `date_order: ${reading.dateOrder}`,
      `row_count: ${String(reading.rowCount)}`,
      ...(reading.headerFormat === undefined ? [] : [`header_format: ${reading.headerFormat}`]),
      ...(reading.headerLink === undefined ? [] : [`header_link: ${reading.headerLink}`]),
      ...(reading.headerCells === undefined ? [] : [`header_cells: ${writeScalar(reading.headerCells)}`]),
      ...(reading.forgotten ? ['forgotten: yes'] : []),
      `columns: ${JSON.stringify(reading.columns.map(binding))}`,
      ...(reading.header.length === 0 ? [] : [`header: ${JSON.stringify(reading.header.map(binding))}`]),
      `rows: ${JSON.stringify(
        [...reading.rows]
          .sort(
            (a, b) =>
              compareText(a.format ?? '', b.format ?? '') ||
              compareText(a.row.name, b.row.name) ||
              a.row.n - b.row.n,
          )
          .map((row) => ({
            row: row.row.name,
            ...(row.row.n === 1 ? {} : { n: row.row.n }),
            ...(row.format === undefined ? {} : { format: row.format }),
            ...(row.key === undefined ? {} : { key: row.key }),
            ...(row.written === undefined ? {} : { written: row.written }),
          })),
      )}`,
    ]),
    ...names.flatMap((each) => [
      '',
      `### ${writeScalar(each.name)}`,
      `format: ${each.format}`,
      `reader_for: ${writeScalar(each.signature)}`,
    ]),
    '',
  ].join('\n')
}

/** The readings part back into its records. */
export function readReadings(
  text: string,
): Result<{ readonly readings: readonly ReadingRecord[]; readonly readerNames: readonly ReaderNameRecord[] }, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || start === -1) {
    return err('The readings part starts with a --- block saying "emerald: readings".')
  }

  const readings: ReadingRecord[] = []
  const readerNames: ReaderNameRecord[] = []
  for (const block of blocksIn(lines, start + 1)) {
    if (!block.ok) return block
    const { heading, cells, line } = block.value
    const at = `Line ${String(line)} of the readings`
    const format = cells.get('format')
    if (heading === undefined || format === undefined) return err(`${at}: a reading is a ### file with its format under it.`)
    const signature = cells.get('reader_for')
    if (signature !== undefined) {
      readerNames.push({ format, signature, name: heading })
      continue
    }
    const number = (key: string): number | undefined => {
      const value = Number(cells.get(key))
      return cells.has(key) && Number.isSafeInteger(value) ? value : undefined
    }
    const json = (key: string): unknown => {
      const value = cells.get(key)
      if (value === undefined) return undefined
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    const readAt = number('read_at')
    const headerRow = number('header_row')
    const rowCount = number('row_count')
    const hash = cells.get('hash')
    const dateOrder = cells.get('date_order')
    const columns = bindingsOf(json('columns'))
    const header = cells.has('header') ? bindingsOf(json('header')) : []
    const rows = readingRowsOf(json('rows'))
    const headerCells = cells.get('header_cells')
    if (
      readAt === undefined ||
      headerRow === undefined ||
      rowCount === undefined ||
      hash === undefined ||
      dateOrder === undefined ||
      columns === undefined ||
      header === undefined ||
      rows === undefined
    ) {
      return err(
        `${at}: a reading has hash, signature, read_at, header_row, date_order, row_count, and its ` +
          'columns and rows as JSON.',
      )
    }
    readings.push({
      format,
      file: heading,
      hash,
      signature: cells.get('signature') ?? '',
      readAt,
      headerRow,
      dateOrder,
      rowCount,
      headerFormat: cells.get('header_format'),
      headerLink: cells.get('header_link'),
      headerCells,
      forgotten: cells.get('forgotten') === 'yes',
      columns,
      header,
      rows,
    })
  }
  return ok({ readings, readerNames })
}

function bindingsOf(value: unknown): readonly ReadingBinding[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ReadingBinding[] = []
  for (const each of value as unknown[]) {
    if (typeof each !== 'object' || each === null) return undefined
    const record = each as Record<string, unknown>
    if (typeof record['key'] !== 'string') return undefined
    out.push({
      key: record['key'],
      row: typeof record['row'] === 'number' ? record['row'] : undefined,
      index: typeof record['index'] === 'number' ? record['index'] : undefined,
      fixed: typeof record['fixed'] === 'string' ? record['fixed'] : undefined,
      separator: typeof record['separator'] === 'string' ? record['separator'] : undefined,
    })
  }
  return out
}

function readingRowsOf(value: unknown): ReadingRecord['rows'] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: (ReadingRecord['rows'][number])[] = []
  for (const each of value as unknown[]) {
    if (typeof each !== 'object' || each === null) return undefined
    const record = each as Record<string, unknown>
    if (typeof record['row'] !== 'string') return undefined
    out.push({
      row: { name: record['row'], n: typeof record['n'] === 'number' ? record['n'] : 1 },
      format: typeof record['format'] === 'string' ? record['format'] : undefined,
      key: typeof record['key'] === 'string' ? record['key'] : undefined,
      written: typeof record['written'] === 'string' ? record['written'] : undefined,
    })
  }
  return out
}

/** What the settings part holds: the currency (D-344) and the day a week starts on (D-528), each when chosen. */
export interface DocumentSettings {
  readonly currency?: string | undefined
  readonly weekStart?: string | undefined
}

/** The document's own settings: one line each under the header, only those chosen. */
export function writeSettings(settings: DocumentSettings): string {
  const lines = [
    ...(settings.currency === undefined ? [] : [`currency: ${settings.currency}`]),
    ...(settings.weekStart === undefined ? [] : [`week_starts_on: ${settings.weekStart}`]),
  ]
  return ['---', 'emerald: settings', '---', '', ...lines, ''].join('\n')
}

/** The settings part back into what it holds. */
export function readSettings(text: string): Result<DocumentSettings, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || start === -1) {
    return err('The settings part starts with a --- block saying "emerald: settings".')
  }
  let currency: string | undefined
  let weekStart: string | undefined
  for (const [at, line] of lines.entries()) {
    if (at <= start || line.trim() === '') continue
    const week = /^week_starts_on:\s*(.*)$/.exec(line.trim())
    if (week !== null) {
      const day = parseWeekday(week[1] ?? '')
      if (day === undefined) return err(`Line ${String(at + 1)} of the settings: "${week[1] ?? ''}" is not a day of the week.`)
      weekStart = weekdayText(day)
      continue
    }
    const match = /^currency:\s*(.*)$/.exec(line.trim())
    if (match === null) {
      return err(`Line ${String(at + 1)} of the settings: "${line.trim()}" is not a setting this build knows.`)
    }
    const code = parseCurrency(match[1] ?? '')
    if (!code.ok) return err(`Line ${String(at + 1)} of the settings: ${code.error}`)
    currency = code.value
  }
  return ok({ ...(currency === undefined ? {} : { currency }), ...(weekStart === undefined ? {} : { weekStart }) })
}

/** When each format last changed (M47 U5, D-462): one `name: YYYY-MM-DD` line per format, in name order. */
export function writeChanged(changed: ReadonlyMap<string, string>): string {
  const lines = [...changed].sort(([a], [b]) => compareText(a, b)).map(([name, day]) => `${name}: ${day}`)
  return ['---', 'emerald: changed', '---', '', ...lines, ''].join('\n')
}

/** The changed part back into format name → day. */
export function readChanged(text: string): Result<ReadonlyMap<string, string>, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || start === -1) {
    return err('The changed part starts with a --- block saying "emerald: changed".')
  }
  const changed = new Map<string, string>()
  for (const [at, line] of lines.entries()) {
    if (at <= start || line.trim() === '') continue
    const match = /^([a-z][a-z0-9_]*):\s*(\d{4}-\d{2}-\d{2})$/.exec(line.trim())
    if (match === null) {
      return err(`Line ${String(at + 1)} of changed.md: "${line.trim()}" is not "format: YYYY-MM-DD".`)
    }
    changed.set(match[1] ?? '', match[2] ?? '')
  }
  return ok(changed)
}

/**
 * Where each bubble sits on the canvas (D-291): a block per place, formats
 * first and then packs, each in name order. A pack's block says so, because a
 * pack and a format may share a name.
 */
export function writePlaces(places: readonly GraphPlace[]): string {
  const sorted = [...places].sort((a, b) =>
    a.kind === b.kind ? compareText(a.name, b.name) : a.kind === 'FORMAT' ? -1 : 1,
  )
  return [
    '---',
    'emerald: graph',
    '---',
    ...sorted.flatMap((each) => [
      '',
      `### ${each.name}`,
      ...(each.kind === 'PACK' ? ['of: pack'] : []),
      `x: ${String(each.x)}`,
      `y: ${String(each.y)}`,
    ]),
    '',
  ].join('\n')
}

/** The canvas part back into places. */
export function readPlaces(text: string): Result<readonly GraphPlace[], string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || start === -1) {
    return err('The graph part starts with a --- block saying "emerald: graph".')
  }

  const places: GraphPlace[] = []
  for (const block of blocksIn(lines, start + 1)) {
    if (!block.ok) return block
    const { heading: name, cells, line } = block.value
    if (name === undefined) {
      return err(`Line ${String(line)}: a place is a ### format name with its x and y under it.`)
    }
    const of = cells.get('of')
    if (of !== undefined && of !== 'pack') {
      return err(`Line ${String(line)}: ${name} is "of: pack" or says nothing, and ${of} is neither.`)
    }
    const coordinates: number[] = []
    for (const axis of ['x', 'y']) {
      const written = cells.get(axis) ?? ''
      const value = Number(written)
      if (!/^-?\d+$/.test(written) || boundedCoordinate(value) !== value) {
        return err(`Line ${String(line)}: ${name}'s ${axis} is a whole number of pixels, and "${written}" is not one.`)
      }
      coordinates.push(value)
    }
    places.push({ kind: of === 'pack' ? 'PACK' : 'FORMAT', name, x: coordinates[0] ?? 0, y: coordinates[1] ?? 0 })
  }
  return ok(places)
}

/**
 * A value as one line, exactly recoverable.
 *
 * Plain when it can be — a name, a date, a sentence — and JSON-quoted when it
 * cannot: empty, padded, multi-line, or already starting with a quote. That
 * covers every string there is with one rule and no dependency, and the common
 * case reads as though nothing were encoded at all, which is the point.
 */
function writeScalar(text: string): string {
  const plain =
    text !== '' && text === text.trim() && !/[\n\r]/.test(text) && !text.startsWith('"')
  return plain ? text : JSON.stringify(text)
}

function readScalar(text: string): Result<string, string> {
  if (!text.startsWith('"')) return ok(text)
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value === 'string') return ok(value)
  } catch {
    // Falls through to the one message below.
  }
  return err(`a value starting with a quote is a JSON string, and ${text} is not one.`)
}

/**
 * Ordered by the code unit, and deliberately not by a locale.
 *
 * `localeCompare` orders by whoever is running the build, so a file generated on
 * two machines would differ in nothing but its order — which is exactly the fake
 * diff this whole file exists to avoid.
 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sortedUnits(units: UnitTable): UnitTable {
  return [...units].sort((a, b) => {
    const byDimension = DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension)
    return byDimension === 0 ? compareText(a.symbol, b.symbol) : byDimension
  })
}

function sameUnits(a: UnitTable, b: UnitTable): boolean {
  if (a.length !== b.length) return false
  const left = sortedUnits(a)
  const right = sortedUnits(b)
  return left.every((unit, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      unit.symbol === other.symbol &&
      unit.dimension === other.dimension &&
      unit.perBase === other.perBase &&
      unit.origin === other.origin &&
      unit.note === other.note
    )
  })
}

function isDimension(value: string): value is Dimension {
  return (DIMENSIONS as readonly string[]).includes(value)
}
