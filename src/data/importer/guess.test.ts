import { readFileSync } from 'node:fs'
import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { formatMoney } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import type { ColumnRole } from '@/domain/model/importing.ts'
import { applyMapping, firstParsed, summarize } from './apply.ts'
import {
  columnFor,
  detectHeaderRow,
  guessDefaultCurrency,
  guessMapping,
  inferColumnShape,
  missingRequiredRoles,
} from './guess.ts'
import { readWorkbook, type SheetCell, type SheetTable } from './sheetTable.ts'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/synthetic/typed-cells.xlsx', import.meta.url))

function sheet(): SheetTable {
  const found = readWorkbook('typed-cells.xlsx', new Uint8Array(readFileSync(FIXTURE))).sheets[0]
  if (found === undefined) throw new Error('fixture has no sheets')
  return found
}

/**
 * A grid of text cells. Enough for the currency guess, which reads what a cell
 * *displays* — and a number cell displays whatever its number format says,
 * which is where the symbol lives in a real file. The fixture covers that shape.
 */
function textTable(rows: readonly (readonly string[])[]): SheetTable {
  return {
    name: 'test',
    rows: rows.map((row) =>
      row.map((text): SheetCell => (text === '' ? { kind: 'empty', text: '' } : { kind: 'string', text, value: text })),
    ),
    columnCount: Math.max(...rows.map((row) => row.length)),
  }
}

describe('detectHeaderRow', () => {
  it('finds the header under a preamble rather than assuming row 1', () => {
    const header = detectHeaderRow(sheet())
    // Row 9 as a spreadsheet numbers it.
    expect(header?.rowIndex).toBe(8)
  })

  it('beats the preamble rows that also contain a recognisable label', () => {
    // Rows 6 and 8 of the fixture hold `מספר כרטיס` and `הערה`, both of which
    // are aliases. A header row has to win on breadth, not on a single hit.
    const table = sheet()
    const header = detectHeaderRow(table)
    expect(header?.aliasHits).toBeGreaterThanOrEqual(6)
  })

  it('returns nothing for a sheet with no header-shaped row', () => {
    const empty: SheetTable = { name: 'blank', rows: [], columnCount: 0 }
    expect(detectHeaderRow(empty)).toBeUndefined()
  })
})

describe('inferColumnShape', () => {
  const table = sheet()
  const dataRows = table.rows.slice(9, 15)
  const column = (index: number) => dataRows.map((row) => row[index]!)

  it('sees real date cells as dates', () => {
    expect(inferColumnShape(column(0))).toBe('date')
  })

  it('sees dates written as text as dates too', () => {
    // Column A of row 14 is the string `19-07-2026`. Shape inference has to
    // agree with the date cells around it, because a whole real file (Max)
    // is written that way.
    const textDates = [table.rows[13]![0]!]
    expect(inferColumnShape(textDates)).toBe('date')
  })

  it('sees numbers as amounts', () => {
    expect(inferColumnShape(column(2))).toBe('amount')
  })

  it('sees Hebrew merchant names as text', () => {
    expect(inferColumnShape(column(1))).toBe('text')
  })

  it('calls an empty column empty', () => {
    expect(inferColumnShape([])).toBe('empty')
  })
})

describe('guessMapping', () => {
  const mapping = guessMapping(sheet())

  it('assigns every role the header names', () => {
    expect(mapping).toBeDefined()
    if (mapping === undefined) return

    const roleOf = (column: number): ColumnRoleId | undefined => mapping.columnRoles.get(column)
    expect(roleOf(0)).toBe('date')
    expect(roleOf(1)).toBe('merchant')
    expect(roleOf(4)).toBe('chargeDate')
    expect(roleOf(5)).toBe('installmentText')
    expect(roleOf(7)).toBe('note')
  })

  it('gives the charge amount the `amount` role, not the transaction amount', () => {
    // `סכום עסקה` and `סכום חיוב` both look like amounts. The money that hit
    // the account has to win, or foreign-currency rows import the wrong number.
    if (mapping === undefined) throw new Error('no mapping')
    expect(columnFor(mapping.columnRoles, 'amount')).toBe(3)
    expect(columnFor(mapping.columnRoles, 'originalAmount')).toBe(2)
  })

  it('leaves columns it does not recognise unassigned', () => {
    if (mapping === undefined) throw new Error('no mapping')
    expect(mapping.columnRoles.has(6)).toBe(false)
  })

  it('has everything it needs to parse', () => {
    if (mapping === undefined) throw new Error('no mapping')
    expect(missingRequiredRoles(mapping)).toEqual([])
  })

  it('reads the amount convention from the values', () => {
    if (mapping === undefined) throw new Error('no mapping')
    // Every charge in the fixture is positive, as in both real files.
    expect(mapping.amountConvention).toBe('POSITIVE_IS_CHARGE')
  })

  it('infers day-first dates', () => {
    if (mapping === undefined) throw new Error('no mapping')
    expect(mapping.dateOrders.get('date')).toBe('DMY')
  })

  it('reads the currency off the amounts rather than assuming shekels', () => {
    if (mapping === undefined) throw new Error('no mapping')
    // The fixture's amounts are number cells under `[$₪] #,##0.00`, so the ₪
    // is in the displayed text and nowhere else. Right answer, real reason.
    expect(mapping.defaultCurrency).toBe('ILS')
  })
})

describe('guessDefaultCurrency', () => {
  const roles = (amountColumn: number): ReadonlyMap<number, ColumnRole> =>
    new Map<number, ColumnRole>([[amountColumn, 'amount']])

  it('takes the symbol the amount cells display', () => {
    const table = textTable([
      ['Date', 'Amount'],
      ['03/07/2026', '$1,234.56'],
      ['05/07/2026', '$89.90'],
    ])
    expect(guessDefaultCurrency(table, roles(1), 0, 1)).toBe('USD')
  })

  it('reads a trailing symbol and a spelled-out code the same way', () => {
    const table = textTable([
      ['Date', 'Amount'],
      ['03/07/2026', '1,234.56 ₪'],
      ['05/07/2026', '89.90 ILS'],
    ])
    expect(guessDefaultCurrency(table, roles(1), 0, 1)).toBe('ILS')
  })

  it("takes the amount column's header when the amounts themselves are bare", () => {
    const table = textTable([
      ['Date', 'Amount in EUR'],
      ['03/07/2026', '1,234.56'],
    ])
    expect(guessDefaultCurrency(table, roles(1), 0, 1)).toBe('EUR')
  })

  it('falls back to the preamble the statement opens with', () => {
    const table = textTable([
      ['Kontoauszug', ''],
      ['Betrag in €', ''],
      ['', ''],
      ['Date', 'Amount'],
      ['03/07/2026', '1,234.56'],
    ])
    expect(guessDefaultCurrency(table, roles(1), 3, 4)).toBe('EUR')
  })

  it('prefers what the amounts say over what the preamble says', () => {
    // A page printed in shekels can still bill in dollars — a foreign-currency
    // section of an Israeli statement is exactly that — and the column the
    // money is in is the one that decides.
    const table = textTable([
      ['סה"כ לחיוב 2,600.00 ₪', ''],
      ['Date', 'Amount'],
      ['03/07/2026', '$1,234.56'],
      ['05/07/2026', '$89.90'],
    ])
    expect(guessDefaultCurrency(table, roles(1), 1, 2)).toBe('USD')
  })

  it('is not swayed by a currency named in some other column', () => {
    // The fixture states `USD` in its notes column, on the one row that is a
    // foreign purchase. That is a fact about a row, not about the file.
    const table = sheet()
    const mapping = guessMapping(table)
    if (mapping === undefined) throw new Error('no mapping')
    expect(columnFor(mapping.columnRoles, 'note')).toBe(7)
    expect(mapping.defaultCurrency).toBe('ILS')
  })

  it('lets a majority of shekel rows outvote one foreign row', () => {
    const table = textTable([
      ['Date', 'Amount'],
      ['03/07/2026', '₪421.05'],
      ['05/07/2026', '$42.99'],
      ['11/07/2026', '₪89.90'],
    ])
    expect(guessDefaultCurrency(table, roles(1), 0, 1)).toBe('ILS')
  })

  it('falls back to shekels when nothing in the sheet says anything', () => {
    const table = textTable([
      ['Date', 'Amount'],
      ['03/07/2026', '1,234.56'],
    ])
    expect(guessDefaultCurrency(table, roles(1), 0, 1)).toBe('ILS')
    // And when there is no amount column to read at all.
    expect(guessDefaultCurrency(table, new Map(), 0, 1)).toBe('ILS')
  })
})

describe('applyMapping over the fixture', () => {
  const table = sheet()
  const mapping = guessMapping(table)!
  const rows = applyMapping(table, mapping)

  it('parses the data rows and skips the blank one', () => {
    const summary = summarize(rows)
    expect(summary.parsed).toBe(6)
    expect(summary.skipped).toBeGreaterThanOrEqual(1)
  })

  it('negates a positive charge, so spending is negative', () => {
    const [first] = firstParsed(rows, 1)
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(toISODate(first.transactionDate)).toBe('2026-07-03')
    expect(formatMoney(first.amount)).toBe('-₪421.05')
    expect(first.direction).toBe('OUTFLOW')
    expect(first.merchantRaw).toBe('שופרסל דיל 344')
    expect(first.merchantNormalized).toBe('שופרסל דיל')
  })

  it('reads a text amount with a trailing minus back as an inflow', () => {
    // `1,234.56-` under POSITIVE_IS_CHARGE is a refund: negative in the file,
    // so positive in the ledger. This is the case that stops refunds inflating
    // spending (D-004).
    const refund = firstParsed(rows, 6)[3]
    expect(refund).toBeDefined()
    if (refund === undefined) return
    expect(refund.merchantRaw).toBe('החזר כספי')
    expect(formatMoney(refund.amount)).toBe('₪1,234.56')
    expect(refund.direction).toBe('INFLOW')
  })

  it('reads a text date in the same column as real date cells', () => {
    const row = firstParsed(rows, 6)[4]
    expect(row).toBeDefined()
    if (row === undefined) return
    expect(row.merchantRaw).toBe('AMAZON.COM')
    expect(toISODate(row.transactionDate)).toBe('2026-07-19')
  })

  it('picks up the installment counter and the charge date', () => {
    const row = firstParsed(rows, 3)[2]
    expect(row).toBeDefined()
    if (row === undefined) return
    expect(row.installment?.sequence).toBe(1)
    expect(row.installment?.total).toBe(3)
    // This fixture's row states the same amount twice, so there is no purchase
    // total to capture — the group key then leans on the payment count. The
    // shape that states a total lives in `installments.test.ts`.
    expect(row.installment?.originalTotal).toBeUndefined()
    expect(row.installment?.groupKey).toContain('2026-07-11')
    expect(row.chargeDate && toISODate(row.chargeDate)).toBe('2026-08-02')
  })

  it('records where each row came from', () => {
    const [first] = firstParsed(rows, 1)
    expect(first?.sourceRowRef).toBe('עסקאות!10')
  })

  it('reports the trailing total row as an error instead of importing it', () => {
    // The fixture's total sits in the amount column, so it cannot be skipped by
    // absence. It has to fail loudly and let the other rows through — the data
    // range in docs/f01 is the eventual fix, and it is the user's to set.
    const total = rows.find((row) => row.rowIndex === 16)
    expect(total?.outcome.kind).toBe('error')
    expect(summarize(rows).parsed).toBe(6)
  })
})
