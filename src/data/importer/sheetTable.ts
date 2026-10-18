/**
 * SheetTable — the platform-neutral grid that a statement file becomes.
 *
 * This is step 2 of the import pipeline in docs/f01-card-statement-import.md.
 * Everything downstream of it — header detection, column-role guessing, the
 * mapper, row parsing — is plain TypeScript over this structure, with no
 * SheetJS and no browser in sight.
 *
 * The rule that matters here: **a cell's underlying type is preserved.** A real
 * Excel date cell arrives as `kind: 'date'`, a number as `kind: 'number'`, text
 * as `kind: 'string'`. Value-shape inference (f01, "How the app guesses") is
 * built on that distinction, and it cannot be recovered once the grid has been
 * flattened to strings. Never stringify on the way in.
 */

import * as XLSX from 'xlsx'

/**
 * A date exactly as the file stored it: calendar parts, no timezone.
 *
 * Spreadsheet dates are timezone-free serial numbers counting days from an
 * epoch. Converting one to a `Date` drags in a timezone and invites an
 * off-by-one-day shift, so we never do — we read the serial through SheetJS's
 * own format parser and keep the parts. Turning this into the domain's
 * date-only value is a later step, in the normalizer.
 */
export interface SheetDate {
  readonly year: number
  /** 1-12. */
  readonly month: number
  /** 1-31. */
  readonly day: number
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
}

/**
 * One cell. `text` is what the file displayed — SheetJS's formatted text, kept
 * verbatim including stray spaces and RTL marks, because that is what the raw
 * grid has to show. The typed `value` is what everything downstream reasons
 * about.
 */
export type SheetCell =
  | { readonly kind: 'empty'; readonly text: string }
  | { readonly kind: 'string'; readonly text: string; readonly value: string }
  | { readonly kind: 'number'; readonly text: string; readonly value: number }
  | { readonly kind: 'boolean'; readonly text: string; readonly value: boolean }
  | { readonly kind: 'date'; readonly text: string; readonly value: SheetDate }
  | { readonly kind: 'error'; readonly text: string; readonly value: string }

export type SheetCellKind = SheetCell['kind']

/** One sheet, as a rectangular grid. Blank rows are kept: row `i` of `rows` is row `i + 1` of the file. */
export interface SheetTable {
  readonly name: string
  readonly rows: readonly (readonly SheetCell[])[]
  readonly columnCount: number
}

/** A whole file. Cal and Max split local, foreign, and installment charges across sheets. */
export interface SheetWorkbook {
  readonly fileName: string
  readonly sheets: readonly SheetTable[]
}

export const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const

export function isSupportedFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

const EMPTY_CELL: SheetCell = { kind: 'empty', text: '' }

/** Read the bytes of an .xlsx / .xls / .csv file into a workbook of typed grids. */
export function readWorkbook(fileName: string, bytes: Uint8Array): SheetWorkbook {
  const options: XLSX.ParsingOptions = {
    // Keep date cells as serial numbers; `toCell` converts them itself, without
    // a timezone. SheetJS's own Date conversion is the thing we are avoiding.
    cellDates: false,
    // The number format is how a date cell is told apart from a plain number.
    // Without this, every date in the file silently becomes a number.
    cellNF: true,
    // Keep the file's own formatted text for the raw grid.
    cellText: true,
  }

  // CSV is decoded here rather than by SheetJS, which assumes codepage 1252 and
  // turns every Hebrew merchant name into mojibake. xlsx carries its own UTF-8
  // XML, so it is handed over as bytes.
  //
  // `raw` matters as much as the encoding: a CSV has no cell types. Left to
  // itself SheetJS invents them, and it reads `02-07-2026` as 7 February —
  // month-first, on a file written day-first. Rather than accept a guess made
  // without knowing the locale, every CSV cell stays the text it actually is,
  // and the mapper infers the date order per column from the values it sees.
  const workbook = isCsvFileName(fileName)
    ? XLSX.read(decodeCsv(bytes), { ...options, type: 'string', raw: true })
    : XLSX.read(withAstralReferencesSpelled(bytes), { ...options, type: 'array' })

  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    return sheet === undefined ? emptyTable(name) : toSheetTable(name, sheet)
  })

  return { fileName, sheets }
}

/** A character reference past the first 65,536 code points: `&#x1F375;`, `&#128512;`. */
const ASTRAL_REFERENCE = /&#(?:[xX]([0-9a-fA-F]+)|(\d+));/g

/** The part of SheetJS's bundled zip reader this file uses. Typed `any` by the package. */
interface ZipContainer {
  readonly FullPaths: readonly string[]
  readonly FileIndex: { content?: Uint8Array | number[]; size?: number }[]
}
interface ZipModule {
  read(bytes: Uint8Array, options: { type: 'array' }): ZipContainer
  write(zip: ZipContainer, options: { type: 'array'; fileType: 'zip' }): ArrayBuffer | number[]
}

/**
 * **An emoji written as a character reference survives the read** (M38 U1).
 *
 * SheetJS 0.18.5, where this was found, decodes `&#x1F375;` with `String.fromCharCode`, which keeps
 * the low sixteen bits and turns 🍵 into an invisible private-use character —
 * so a cell of `Tea &#x1F375;` arrived as `Tea ` plus nothing a person could
 * see. Writers that escape every non-ASCII character do this to every emoji.
 * The references are spelled out as the characters themselves before SheetJS
 * sees the XML; a file holding none is handed over untouched, byte for byte.
 */
function withAstralReferencesSpelled(bytes: Uint8Array): Uint8Array {
  // A zip starts `PK`; an .xls is a compound file and has no XML to fix.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return bytes
  // SheetJS types its bundled zip library `any`; `ZipModule` is the part of it used here.
  const cfb: ZipModule = XLSX.CFB
  let zip: ZipContainer
  try {
    zip = cfb.read(bytes, { type: 'array' })
  } catch {
    return bytes
  }
  let changed = false
  zip.FileIndex.forEach((entry, at) => {
    const path = zip.FullPaths[at] ?? ''
    if (!/\.xml$/i.test(path) || entry.content === undefined) return
    const content = entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content)
    const text = new TextDecoder().decode(content)
    if (!text.includes('&#')) return
    const spelled = text.replace(ASTRAL_REFERENCE, (whole, hex: string | undefined, decimal: string | undefined) => {
      const code = hex !== undefined ? parseInt(hex, 16) : parseInt(decimal ?? '', 10)
      return code > 0xffff && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
    if (spelled === text) return
    const encoded = new TextEncoder().encode(spelled)
    entry.content = encoded
    entry.size = encoded.length
    changed = true
  })
  if (!changed) return bytes
  return new Uint8Array(cfb.write(zip, { type: 'array', fileType: 'zip' }))
}

function isCsvFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.csv')
}

/**
 * Turn CSV bytes into text without guessing wrong about Hebrew.
 *
 * A byte-order mark settles it. Otherwise, try UTF-8 strictly: real UTF-8 is
 * self-validating, so a clean decode is close to proof. Only when that fails do
 * we fall back to windows-1255, the Hebrew codepage an Israeli bank or a Hebrew
 * copy of Excel writes. The two agree on ASCII, so an English CSV is unaffected
 * either way.
 */
function decodeCsv(bytes: Uint8Array): string {
  const [b0, b1, b2] = bytes
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return decode(bytes.subarray(3), 'utf-8')
  if (b0 === 0xff && b1 === 0xfe) return decode(bytes.subarray(2), 'utf-16le')
  if (b0 === 0xfe && b1 === 0xff) return decode(bytes.subarray(2), 'utf-16be')

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return decode(bytes, 'windows-1255')
  }
}

function decode(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding).decode(bytes)
}

function emptyTable(name: string): SheetTable {
  return { name, rows: [], columnCount: 0 }
}

function toSheetTable(name: string, sheet: XLSX.WorkSheet): SheetTable {
  const ref = sheet['!ref']
  if (typeof ref !== 'string') return emptyTable(name)

  const range = XLSX.utils.decode_range(ref)
  const columnCount = range.e.c + 1
  // Always start at row 0 and column 0, even when the used range doesn't, so a
  // row's index in `rows` is its row number in the file. The junk preamble in a
  // Cal or Max export is exactly the region where that goes wrong otherwise.
  const rowCount = range.e.r + 1
  if (columnCount <= 0 || rowCount <= 0) return emptyTable(name)

  const rows: SheetCell[][] = []
  for (let r = 0; r < rowCount; r++) {
    const row: SheetCell[] = []
    for (let c = 0; c < columnCount; c++) {
      row.push(toCell(cellAt(sheet, XLSX.utils.encode_cell({ r, c }))))
    }
    rows.push(row)
  }

  return { name, rows, columnCount }
}

function toCell(raw: XLSX.CellObject | undefined): SheetCell {
  if (raw === undefined) return EMPTY_CELL

  const { t, v } = raw
  if (t === 'z' || v === undefined || v === null) return EMPTY_CELL

  const formatted = typeof raw.w === 'string' ? raw.w : undefined

  // A date reaches us one of two ways: already a Date (CSV text that SheetJS
  // recognised), or — the usual case for xlsx and xls — a serial number whose
  // number format says "this is a date".
  if (t === 'd' && v instanceof Date) {
    const value = fromDate(v)
    return { kind: 'date', value, text: formatted ?? formatDate(value) }
  }

  if (t === 'n' && typeof v === 'number') {
    const format = typeof raw.z === 'string' ? raw.z : undefined
    if (format !== undefined && ssf.is_date(format)) {
      const value = fromSerial(v)
      if (value !== undefined) {
        return { kind: 'date', value, text: formatted ?? formatDate(value) }
      }
    }
    return { kind: 'number', value: v, text: formatted ?? String(v) }
  }

  if (t === 'b' && typeof v === 'boolean') {
    return { kind: 'boolean', value: v, text: formatted ?? (v ? 'TRUE' : 'FALSE') }
  }

  if (t === 'e') {
    const value = String(v)
    return { kind: 'error', value, text: formatted ?? value }
  }

  // Strings, and anything else SheetJS hands back. Never trimmed: leading
  // spaces, NBSPs and RTL marks are exactly what the mapper screen exists to
  // make visible.
  const value = typeof v === 'string' ? v : String(v)
  if (value === '') return EMPTY_CELL
  return { kind: 'string', value, text: formatted ?? value }
}

/**
 * `WorkSheet` is indexed as `CellObject | any`, so reading a cell off it hands
 * back `any`. Narrow it once, here, and keep the rest of the module typed.
 */
function cellAt(sheet: XLSX.WorkSheet, address: string): XLSX.CellObject | undefined {
  const cell: unknown = sheet[address]
  if (typeof cell !== 'object' || cell === null || !('t' in cell)) return undefined
  return cell as XLSX.CellObject
}

interface ExcelDateCode {
  readonly y: number
  readonly m: number
  readonly d: number
  readonly H: number
  readonly M: number
  readonly S: number
}

/** `XLSX.SSF` is typed `any` by the package. Give it a shape at the boundary. */
interface SsfModule {
  is_date(format: string): boolean
  parse_date_code(serial: number): ExcelDateCode | null | undefined
}

/**
 * `SSF` off whichever shape the loader handed us.
 *
 * `xlsx` is CommonJS. Under Vite — the app and the test suite both — the
 * namespace import carries every property. Under **Node's own ESM interop**,
 * which is what the plugin's bundled server runs on, the named exports are the
 * ones `cjs-module-lexer` can see statically, and `SSF` is not among them: it
 * arrives on `default` instead and `XLSX.SSF` is `undefined`.
 *
 * That cost an entire import path. Every numeric cell with a number format on
 * it — which is every amount in every real statement — asks `is_date`, so the
 * built plugin threw "Cannot read properties of undefined" on the first row of
 * any `.xlsx`, while the same code passed every test. Found by driving the
 * built server rather than the source (D-104). Exported so the fallback itself
 * has a test: under Vitest the real namespace always has `SSF`, so the branch
 * that mattered is unreachable from the module's own import.
 */
export function ssfFrom(namespace: unknown): SsfModule {
  const shape = namespace as { SSF?: SsfModule; default?: { SSF?: SsfModule } }
  const found = shape.SSF ?? shape.default?.SSF
  if (found === undefined) {
    throw new Error('The xlsx package exposed no SSF module, so cell formats cannot be read.')
  }
  return found
}

const ssf = ssfFrom(XLSX)

function fromSerial(serial: number): SheetDate | undefined {
  const parts = ssf.parse_date_code(serial)
  if (parts === null || parts === undefined) return undefined
  return {
    year: parts.y,
    month: parts.m,
    day: parts.d,
    hours: parts.H,
    minutes: parts.M,
    seconds: Math.floor(parts.S),
  }
}

/**
 * SheetJS builds its `Date`s so that the *local* getters read back the calendar
 * values the file meant. Read them the same way it wrote them.
 */
function fromDate(date: Date): SheetDate {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hours: date.getHours(),
    minutes: date.getMinutes(),
    seconds: date.getSeconds(),
  }
}

/** Only a fallback for when the file carried no formatted text of its own. */
function formatDate(date: SheetDate): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  const day = `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`
  if (date.hours === 0 && date.minutes === 0 && date.seconds === 0) return day
  return `${day} ${pad(date.hours)}:${pad(date.minutes)}:${pad(date.seconds)}`
}

/** How many cells of each kind the grid holds. The cheapest proof that types survived the read. */
export function countCellKinds(table: SheetTable): Readonly<Record<SheetCellKind, number>> {
  const counts: Record<SheetCellKind, number> = {
    empty: 0,
    string: 0,
    number: 0,
    boolean: 0,
    date: 0,
    error: 0,
  }
  for (const row of table.rows) {
    for (const cell of row) counts[cell.kind]++
  }
  return counts
}
