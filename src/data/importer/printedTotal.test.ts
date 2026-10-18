import { describe, expect, it } from 'vitest'

import { formatMoney, fromMajorUnits } from '@/core/money.ts'
import { findPrintedTotal, numberIn, totalsAgree } from './printedTotal.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

/**
 * The preambles and trailers below are written to the shape of the two real
 * exports and carry no real data. Real statement files never enter the repo
 * (docs/conventions.md).
 */
function tableOf(rows: readonly (readonly (string | number)[])[]): SheetTable {
  const columnCount = Math.max(1, ...rows.map((row) => row.length))
  return {
    name: 'sheet',
    columnCount,
    rows: rows.map((row) =>
      Array.from({ length: columnCount }, (_, index): SheetCell => {
        const value = row[index]
        if (value === undefined || value === '') return { kind: 'empty', text: '' }
        if (typeof value === 'number') return { kind: 'number', text: String(value), value }
        return { kind: 'string', text: value, value }
      }),
    ),
  }
}

const SCAN = { headerRowIndex: 3, lastDataRowIndex: 5, currency: 'ILS' }

describe('numberIn', () => {
  it('pulls a total out of a sentence', () => {
    expect(numberIn('עסקאות בחיוב מיידי 2,600.00 ₪')).toBe(2600.00)
  })

  it('reads a number with the currency stuck to it', () => {
    expect(numberIn('1200.00₪')).toBe(1200.00)
  })

  it('prefers the figure with decimals over a bare integer beside it', () => {
    // A total line that also carries a year or a count. The decimal point is
    // what distinguishes money from everything else on the line.
    expect(numberIn('סך הכל ל-08/2026: 1,234.50 ₪')).toBe(1234.5)
  })

  it('takes the largest when nothing has decimals, since a total is the big number', () => {
    expect(numberIn('סך הכל 3 עסקאות 450')).toBe(450)
  })

  it('finds nothing in a string with no number', () => {
    expect(numberIn('סך הכל')).toBeUndefined()
  })
})

describe('findPrintedTotal', () => {
  it('reads a Cal-shaped total out of preamble prose', () => {
    const table = tableOf([
      ['פירוט עסקאות לחשבון … לכרטיס ויזה המסתיים ב-4321'],
      [''],
      ['עסקאות בחיוב מיידי 2,600.00 ₪'],
      ['תאריך עסקה', 'שם בית עסק', 'סכום חיוב'],
      ['4/6/26', 'חנות', 7.5],
      ['30/6/26', 'חנות אחרת', 2598.09],
    ])

    const found = findPrintedTotal(table, SCAN)
    expect(found?.amount).toEqual(fromMajorUnits(2600.00, 'ILS'))
    expect(found?.sourceRowRef).toBe('sheet!3')
    expect(found?.text).toContain('2,600.00')
  })

  it('reads a Max-shaped total from the row below its label, after the data', () => {
    // The label and the value are in different rows, and both come *after* the
    // transactions rather than before them.
    const table = tableOf([
      ['שם המחזיק'],
      ['4321-CARD'],
      ['08/2026'],
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'],
      ['02-07-2026', 'קפה', 106],
      ['03-07-2026', 'חנות', 1129.26],
      [''],
      ['סך הכל'],
      ['1200.00₪'],
    ])

    const found = findPrintedTotal(table, SCAN)
    expect(found?.amount).toEqual(fromMajorUnits(1200.00, 'ILS'))
  })

  it('reads a total sitting to the right of its label', () => {
    const table = tableOf([
      ['סה"כ לחיוב', 4210.55],
      [''],
      [''],
      ['date', 'merchant', 'amount'],
      ['2026-07-01', 'a', 1],
    ])
    expect(findPrintedTotal(table, { ...SCAN, lastDataRowIndex: 4 })?.amount).toEqual(
      fromMajorUnits(4210.55, 'ILS'),
    )
  })

  it('does not read a data row that happens to contain the word total', () => {
    // "Total Wine & More" is a real shop. Scanning the data rows for the word
    // "total" would turn one of its charges into the file's own total.
    const table = tableOf([
      ['My spending'],
      [''],
      [''],
      ['date', 'merchant', 'amount'],
      ['2026-07-01', 'TOTAL WINE & MORE', 88.4],
      ['2026-07-02', 'Corner Shop', 12.5],
    ])
    expect(findPrintedTotal(table, SCAN)).toBeUndefined()
  })

  it('finds nothing when the file states no total, rather than inventing one', () => {
    const table = tableOf([
      ['statement'],
      [''],
      [''],
      ['date', 'merchant', 'amount'],
      ['2026-07-01', 'a', 1],
    ])
    expect(findPrintedTotal(table, { ...SCAN, lastDataRowIndex: 4 })).toBeUndefined()
  })
})

describe('totalsAgree', () => {
  const printed = fromMajorUnits(1200.00, 'ILS')

  it('agrees with a parsed sum of the opposite sign', () => {
    // Both real files print charges as positive; the importer is what makes
    // them negative (D-004). Comparing signed values would report every correct
    // import as a mismatch.
    expect(totalsAgree(printed, fromMajorUnits(-1200.00, 'ILS'))).toBe(true)
  })

  it('disagrees over a single minor unit', () => {
    expect(totalsAgree(printed, fromMajorUnits(-1235.25, 'ILS'))).toBe(false)
  })

  it('disagrees across currencies rather than comparing the numbers', () => {
    expect(totalsAgree(printed, fromMajorUnits(-1200.00, 'USD'))).toBe(false)
  })

  it('compares in minor units, with no floating point in the path', () => {
    // 0.1 + 0.2 territory. The comparison is integer-to-integer by construction.
    const sum = fromMajorUnits(0.1, 'ILS').minor + fromMajorUnits(0.2, 'ILS').minor
    expect(formatMoney({ minor: sum, currency: 'ILS' })).toBe('₪0.30')
    expect(totalsAgree(fromMajorUnits(0.3, 'ILS'), { minor: sum, currency: 'ILS' })).toBe(true)
  })
})
