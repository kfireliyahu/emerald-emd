import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  countCellKinds,
  isSupportedFileName,
  readWorkbook,
  ssfFrom,
  type SheetCell,
  type SheetTable,
} from './sheetTable.ts'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/synthetic/typed-cells.xlsx', import.meta.url))

function load(): SheetTable {
  const workbook = readWorkbook('typed-cells.xlsx', new Uint8Array(readFileSync(FIXTURE)))
  const sheet = workbook.sheets[0]
  if (sheet === undefined) throw new Error('fixture has no sheets')
  return sheet
}

/** Rows are addressed the way a spreadsheet numbers them, so assertions read like the file. */
function cellOf(table: SheetTable, oneBasedRow: number, zeroBasedColumn: number): SheetCell {
  const row = table.rows[oneBasedRow - 1]
  if (row === undefined) throw new Error(`no row ${oneBasedRow}`)
  const cell = row[zeroBasedColumn]
  if (cell === undefined) throw new Error(`no cell at row ${oneBasedRow}, column ${zeroBasedColumn}`)
  return cell
}

describe('readWorkbook', () => {
  it('keeps every row, including the junk preamble and the blank rows', () => {
    const table = load()

    expect(table.name).toBe('עסקאות')
    // 17 rows in the fixture, and none of them are dropped on the way in.
    expect(table.rows).toHaveLength(17)
    expect(table.columnCount).toBe(8)
    // Row 9 is the real header. Whether the app finds it is step 2's problem;
    // that it is still there at index 8 is this step's.
    expect(cellOf(table, 9, 0).text).toBe('תאריך עסקה')
    expect(cellOf(table, 1, 0).text).toBe('כרטיס אשראי — דוגמה סינתטית')
    expect(cellOf(table, 2, 0).kind).toBe('empty')
    expect(cellOf(table, 7, 0).kind).toBe('empty')
  })

  it('pads every row to the full column count', () => {
    const table = load()
    for (const r of table.rows) {
      expect(r).toHaveLength(table.columnCount)
    }
  })
})

describe('cell types survive the read', () => {
  it('keeps a real date cell as a date, with the calendar parts the file stored', () => {
    const table = load()

    const transactionDate = cellOf(table, 10, 0)
    expect(transactionDate.kind).toBe('date')
    if (transactionDate.kind !== 'date') throw new Error('unreachable')
    expect(transactionDate.value).toEqual({
      year: 2026,
      month: 7,
      day: 3,
      hours: 0,
      minutes: 0,
      seconds: 0,
    })

    // A date in the preamble is still a date — nothing about position is special.
    const billingPeriod = cellOf(table, 4, 1)
    expect(billingPeriod.kind).toBe('date')
    if (billingPeriod.kind !== 'date') throw new Error('unreachable')
    expect(billingPeriod.value.year).toBe(2026)
    expect(billingPeriod.value.month).toBe(7)
    expect(billingPeriod.value.day).toBe(1)
  })

  it('never shifts a date by a day, whatever the timezone', () => {
    const table = load()
    // Dates are stored as timezone-free serials. If the reader ever routes one
    // through a `Date`, the boundary days are where it shows up first.
    const dates = [
      { row: 10, day: 3 },
      { row: 11, day: 5 },
      { row: 12, day: 11 },
      { row: 13, day: 14 },
      { row: 15, day: 22 },
    ]
    for (const { row: r, day } of dates) {
      const cell = cellOf(table, r, 0)
      if (cell.kind !== 'date') throw new Error(`row ${r} column A is ${cell.kind}, not a date`)
      expect(cell.value).toMatchObject({ year: 2026, month: 7, day })
    }
  })

  it('keeps a real number cell as a number, not a string', () => {
    const table = load()

    // Cal formats every amount as currency. The ₪ and the thousands separator
    // are in the number format, not the value — a cell with a format is not
    // automatically a date, and a cell showing ₪ is not automatically text.
    const amount = cellOf(table, 10, 2)
    expect(amount.kind).toBe('number')
    if (amount.kind !== 'number') throw new Error('unreachable')
    expect(amount.value).toBe(421.05)
    expect(amount.text).toBe('₪ 421.05')

    const thousands = cellOf(table, 12, 2)
    expect(thousands.kind).toBe('number')
    if (thousands.kind !== 'number') throw new Error('unreachable')
    expect(thousands.value).toBe(1184.2)
    expect(thousands.text).toBe('₪ 1,184.20')

    const preambleTotal = cellOf(table, 5, 1)
    expect(preambleTotal.kind).toBe('number')
    if (preambleTotal.kind !== 'number') throw new Error('unreachable')
    expect(preambleTotal.value).toBe(4210.55)
  })

  it('keeps text as text, even when it looks like a date or an amount', () => {
    const table = load()

    // A date written as text — the shape a real Max export uses for every date
    // in the file. Parsing it is the mapper's job, not the reader's, and the
    // reader must not quietly promote it to a date cell.
    const textDate = cellOf(table, 14, 0)
    expect(textDate.kind).toBe('string')
    if (textDate.kind !== 'string') throw new Error('unreachable')
    expect(textDate.value).toBe('19-07-2026')

    // A trailing-minus amount. Still a string; the sign convention is mapping.
    const trailingMinus = cellOf(table, 13, 2)
    expect(trailingMinus.kind).toBe('string')
    if (trailingMinus.kind !== 'string') throw new Error('unreachable')
    expect(trailingMinus.value).toBe('1,234.56-')

    // A card number is digits, but it is text and must not become 1234.
    const cardNumber = cellOf(table, 6, 1)
    expect(cardNumber.kind).toBe('string')
    if (cardNumber.kind !== 'string') throw new Error('unreachable')
    expect(cardNumber.value).toBe('****1234')
  })

  it('keeps a boolean as a boolean', () => {
    const table = load()

    const yes = cellOf(table, 10, 6)
    expect(yes.kind).toBe('boolean')
    if (yes.kind !== 'boolean') throw new Error('unreachable')
    expect(yes.value).toBe(true)

    const no = cellOf(table, 13, 6)
    expect(no.kind).toBe('boolean')
    if (no.kind !== 'boolean') throw new Error('unreachable')
    expect(no.value).toBe(false)
  })

  it('does not trim, so stray whitespace stays visible in the grid', () => {
    const table = load()
    const merchant = cellOf(table, 15, 1)
    if (merchant.kind !== 'string') throw new Error('expected a string')
    expect(merchant.value).toBe('קפה  נמרוד')
    expect(merchant.text).toBe('קפה  נמרוד')
  })

  it('reports the mix of kinds it read', () => {
    const counts = countCellKinds(load())
    expect(counts.date).toBeGreaterThan(0)
    expect(counts.number).toBeGreaterThan(0)
    expect(counts.string).toBeGreaterThan(0)
    expect(counts.boolean).toBeGreaterThan(0)
    expect(counts.error).toBe(0)
  })
})

describe('emoji survive the read (M38 U1)', () => {
  // The cells are written as character references — `Tea &#x1F375; &#128512;`
  // — which SheetJS alone decodes to an invisible private-use character.
  const EMOJI = fileURLToPath(new URL('../../../fixtures/synthetic/emoji-references.xlsx', import.meta.url))

  it('keeps an emoji written as a character reference, hex or decimal', () => {
    const sheet = readWorkbook('emoji-references.xlsx', new Uint8Array(readFileSync(EMOJI))).sheets[0]
    if (sheet === undefined) throw new Error('no sheet')
    expect(cellOf(sheet, 2, 0)).toMatchObject({ kind: 'string', value: 'Tea \u{1F375} \u{1F600}' })
    expect(cellOf(sheet, 2, 1)).toMatchObject({ kind: 'string', value: '\u{1F600} good' })
  })

  it('keeps an emoji written as itself, in a CSV', () => {
    const sheet = readWorkbook('moods.csv', new TextEncoder().encode('name\nTea \u{1F375}\n')).sheets[0]
    if (sheet === undefined) throw new Error('no sheet')
    expect(cellOf(sheet, 2, 0)).toMatchObject({ kind: 'string', value: 'Tea \u{1F375}' })
  })
})

describe('CSV text encoding', () => {
  const CSV = 'Date,Merchant,Amount\n2026-07-03,שופרסל דיל 344,421.05\n'

  function merchantOf(bytes: Uint8Array): string {
    const sheet = readWorkbook('cal.csv', bytes).sheets[0]
    if (sheet === undefined) throw new Error('no sheet')
    const cell = cellOf(sheet, 2, 1)
    if (cell.kind !== 'string') throw new Error(`merchant is ${cell.kind}, not a string`)
    return cell.value
  }

  it('reads UTF-8 without a byte-order mark', () => {
    // SheetJS assumes codepage 1252 for CSV, which turns every Hebrew name into
    // mojibake. The reader has to decode the bytes itself.
    expect(merchantOf(new TextEncoder().encode(CSV))).toBe('שופרסל דיל 344')
  })

  it('reads UTF-8 with a byte-order mark, without leaking it into the first cell', () => {
    const utf8 = new TextEncoder().encode(CSV)
    const withBom = new Uint8Array(utf8.length + 3)
    withBom.set([0xef, 0xbb, 0xbf])
    withBom.set(utf8, 3)

    expect(merchantOf(withBom)).toBe('שופרסל דיל 344')

    const sheet = readWorkbook('cal.csv', withBom).sheets[0]
    if (sheet === undefined) throw new Error('no sheet')
    expect(cellOf(sheet, 1, 0).text).toBe('Date')
  })

  it('falls back to windows-1255 for Hebrew that is not valid UTF-8', () => {
    // 'שופרסל' in windows-1255: the Hebrew block starts at 0xE0.
    const hebrew = [0xf9, 0xe5, 0xf4, 0xf8, 0xf1, 0xec]
    const bytes = Uint8Array.from([
      ...[...'Date,Merchant,Amount\n2026-07-03,'].map((c) => c.charCodeAt(0)),
      ...hebrew,
      ...[...',421.05\n'].map((c) => c.charCodeAt(0)),
    ])
    expect(merchantOf(bytes)).toBe('שופרסל')
  })

  it('leaves every CSV cell as text, because a CSV has no cell types', () => {
    // Left to itself SheetJS types CSV cells by guessing, and its guess for a
    // numeric date is month-first. On `02-07-2026` from an Israeli statement
    // that silently yields 7 February. A CSV genuinely has no types, so
    // inventing them here would be fabricating information — the date order is
    // inferred per column further down the pipeline, where the whole column can
    // be looked at.
    const sheet = readWorkbook('cal.csv', new TextEncoder().encode(CSV)).sheets[0]
    if (sheet === undefined) throw new Error('no sheet')
    expect(cellOf(sheet, 2, 0).kind).toBe('string')
    expect(cellOf(sheet, 2, 2).kind).toBe('string')
  })

  it('does not let SheetJS reinterpret a day-first date as month-first', () => {
    const dayFirst = 'תאריך עסקה,שם בית עסק,סכום חיוב\n02-07-2026,שופרסל,421.05\n'
    const sheet = readWorkbook('cal.csv', new TextEncoder().encode(dayFirst)).sheets[0]
    if (sheet === undefined) throw new Error('no sheet')

    const cell = cellOf(sheet, 2, 0)
    if (cell.kind !== 'string') throw new Error(`expected text, got ${cell.kind}`)
    expect(cell.value).toBe('02-07-2026')
  })
})

describe('isSupportedFileName', () => {
  it('accepts the three formats Cal and Max export', () => {
    expect(isSupportedFileName('cal_2026-07.xlsx')).toBe(true)
    expect(isSupportedFileName('MAX.XLS')).toBe(true)
    expect(isSupportedFileName('export.csv')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isSupportedFileName('statement.pdf')).toBe(false)
    expect(isSupportedFileName('xlsx')).toBe(false)
  })
})

describe('reaching SSF whichever way the loader hands over the package', () => {
  it('takes it off the namespace, which is what Vite gives us', () => {
    const module = { is_date: () => true, parse_date_code: () => undefined }
    expect(ssfFrom({ SSF: module })).toBe(module)
  })

  it('falls back to `default`, which is what Node ESM gives us', () => {
    // The interop that cost the whole xlsx import path in the built plugin
    // while every test here passed (D-104).
    const module = { is_date: () => true, parse_date_code: () => undefined }
    expect(ssfFrom({ default: { SSF: module } })).toBe(module)
  })

  it('says so rather than throwing on the first formatted cell', () => {
    expect(() => ssfFrom({})).toThrow(/no SSF module/)
  })
})
