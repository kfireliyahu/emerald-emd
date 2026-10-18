import { describe, expect, it } from 'vitest'

import { defaultMappingName, statedCardLast4 } from './mappingName.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

/**
 * The preambles below are written to the shape of the two real exports and
 * carry no real data: invented card numbers, invented account numbers, no
 * names. Real statement files never enter the repo (docs/conventions.md).
 */
function tableOf(name: string, rows: readonly (readonly string[])[]): SheetTable {
  const columnCount = Math.max(1, ...rows.map((row) => row.length))
  return {
    name,
    columnCount,
    rows: rows.map((row) =>
      Array.from({ length: columnCount }, (_, index): SheetCell => {
        const value = row[index] ?? ''
        return value === '' ? { kind: 'empty', text: '' } : { kind: 'string', text: value, value }
      }),
    ),
  }
}

describe('defaultMappingName', () => {
  it('names a Cal-shaped file from the prose above its header', () => {
    // Neither real export prints its issuer anywhere. What the preamble does
    // carry is the bank and the card, which is what makes a name recognisable
    // a year later.
    const table = tableOf('מרכנתיל דיסקונט 111-22222222', [
      ['פירוט עסקאות לחשבון מרכנתיל דיסקונט 111-22222222 לכרטיס ויזה מיידי בינלאומי המסתיים ב-4321'],
      [''],
      ['עסקאות בחיוב מיידי 1,000.00 ₪'],
      ['תאריך עסקה', 'שם בית עסק', 'סכום חיוב'],
    ])

    expect(defaultMappingName({ fileName: 'פירוט חיובים.xlsx', table, headerRowIndex: 3 })).toBe(
      'Mercantile – Visa 4321',
    )
  })

  it('names a Max-shaped file from its card product line', () => {
    const table = tableOf('עסקאות במועד החיוב', [
      ['שם המחזיק-000000000'],
      ['4321-MAX Gold VISA'],
      ['08/2026'],
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'],
    ])

    expect(
      defaultMappingName({ fileName: 'transaction-details_export_1.xlsx', table, headerRowIndex: 3 }),
    ).toBe('Max – Visa 4321')
  })

  it('trusts a mapped card column over anything it read in the preamble', () => {
    const table = tableOf('sheet', [['כאל · כרטיס ויזה המסתיים ב-1111'], ['תאריך', 'סכום']])
    expect(
      defaultMappingName({
        fileName: 'cal.xlsx',
        table,
        headerRowIndex: 1,
        cardLast4: '2222',
      }),
    ).toBe('Cal – Visa 2222')
  })

  it('does not mistake an account or ID number for a card number', () => {
    // `111-22222222` and a nine-digit ID are both four digits followed by more
    // digits. Only a run introduced by a card word counts.
    const table = tableOf('sheet', [['חשבון 111-22222222 · שם המחזיק-000000000'], ['תאריך', 'סכום']])
    expect(defaultMappingName({ fileName: 'export.xlsx', table, headerRowIndex: 1 })).toBe('export')
  })

  it('prefers the bank the file names over the one it merely mentions', () => {
    // `לאומי קארד` is Max. Matching `לאומי` first would call it the bank.
    const table = tableOf('sheet', [['לאומי קארד — פירוט חיובים'], ['תאריך', 'סכום']])
    expect(defaultMappingName({ fileName: 'export.xlsx', table, headerRowIndex: 1 })).toBe('Max')
  })

  it('does not find a provider inside an unrelated word', () => {
    // An unanchored `cal` matches "local", which would name every arbitrary CSV
    // after a credit-card issuer it has nothing to do with.
    const table = tableOf('sheet', [['Local transactions export'], ['date', 'amount']])
    expect(defaultMappingName({ fileName: 'local-export.csv', table, headerRowIndex: 1 })).toBe(
      'local-export',
    )
  })

  it('falls back to the file name when the file says nothing about itself', () => {
    const table = tableOf('Sheet1', [['date', 'amount', 'merchant']])
    expect(defaultMappingName({ fileName: 'my-spending.csv', table, headerRowIndex: 0 })).toBe(
      'my-spending',
    )
  })

  it('falls back to the sheet name when there is no file name either', () => {
    const table = tableOf('Sheet1', [['date', 'amount']])
    expect(defaultMappingName({ fileName: '', table, headerRowIndex: 0 })).toBe('Sheet1')
  })

  it('keeps a name short enough to be a label', () => {
    const table = tableOf('sheet', [['date', 'amount']])
    const name = defaultMappingName({
      fileName: `${'a'.repeat(200)}.csv`,
      table,
      headerRowIndex: 0,
    })
    expect(name.length).toBeLessThanOrEqual(60)
  })
})

describe('statedCardLast4', () => {
  const bare = tableOf('Sheet1', [['תאריך עסקה', 'שם בית עסק', 'סכום חיוב']])

  it('reads the card out of the file name, which is where the real export puts it', () => {
    // The shape that produced D-033: one card, two downloads. The date in the
    // name is the day it was downloaded, identical in both, and the only
    // difference is the "(1)" the second download picked up.
    const june = 'פירוט חיובים לכרטיס ויזה 4321 - 08.08.26.xlsx'
    const july = 'פירוט חיובים לכרטיס ויזה 4321 - 08.08.26 (1).xlsx'

    expect(statedCardLast4({ fileName: june, table: bare, headerRowIndex: 0 })).toBe('4321')
    expect(statedCardLast4({ fileName: july, table: bare, headerRowIndex: 0 })).toBe(
      statedCardLast4({ fileName: june, table: bare, headerRowIndex: 0 }),
    )
  })

  it('reads it out of the preamble when the name is uninformative', () => {
    const table = tableOf('עסקאות', [
      ['פירוט עסקאות לכרטיס ויזה המסתיים ב-4321'],
      ['תאריך עסקה', 'שם בית עסק', 'סכום חיוב'],
    ])

    expect(statedCardLast4({ fileName: 'export.xlsx', table, headerRowIndex: 1 })).toBe('4321')
  })

  it('reads the digits-first shape only when the text is about a card at all', () => {
    const card = tableOf('Sheet1', [['9876-Gold VISA'], ['Date', 'Merchant', 'Amount']])
    expect(statedCardLast4({ fileName: 'export.xlsx', table: card, headerRowIndex: 1 })).toBe('9876')

    // Same shape, no card word anywhere: a year, a dash and a Hebrew month.
    // Reading that as a card number would name an account after a date.
    const notACard = tableOf('Sheet1', [['דוח 2026 - יוני'], ['תאריך', 'תיאור', 'סכום']])
    expect(
      statedCardLast4({ fileName: 'report.xlsx', table: notACard, headerRowIndex: 1 }),
    ).toBeUndefined()
  })

  it('does not mistake the account number beside it for the card', () => {
    const table = tableOf('Sheet1', [
      ['פירוט עסקאות לחשבון 100-00000000 לכרטיס ויזה המסתיים ב-4321'],
      ['תאריך עסקה', 'שם בית עסק', 'סכום חיוב'],
    ])

    expect(statedCardLast4({ fileName: 'x.xlsx', table, headerRowIndex: 1 })).toBe('4321')
  })

  it('is undefined when the file says nothing about a card', () => {
    expect(
      statedCardLast4({ fileName: 'transactions.csv', table: bare, headerRowIndex: 0 }),
    ).toBeUndefined()
  })
})
