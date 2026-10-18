/**
 * The row shape neither real export happened to contain: an installment slice,
 * and a purchase in another currency, sitting in the same "original amount"
 * column. See D-035 and docs/f01-card-statement-import.md.
 */

import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { formatMoney } from '@/core/money.ts'
import type { DraftTransaction } from '@/domain/model/importing.ts'
import { allParsed, applyMapping } from './apply.ts'
import { columnFor, guessMapping } from './guess.ts'
import { readWorkbook, type SheetTable } from './sheetTable.ts'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/synthetic/installments.xlsx', import.meta.url))

function sheet(index: number): SheetTable {
  const found = readWorkbook('installments.xlsx', new Uint8Array(readFileSync(FIXTURE))).sheets[index]
  if (found === undefined) throw new Error(`fixture has no sheet ${index}`)
  return found
}

function parsed(index: number): readonly DraftTransaction[] {
  const table = sheet(index)
  const mapping = guessMapping(table)
  if (mapping === undefined) throw new Error('no mapping')
  return allParsed(applyMapping(table, mapping))
}

describe('the installment sheet', () => {
  const table = sheet(0)
  const mapping = guessMapping(table)!
  const rows = parsed(0)

  const roleOf = (column: number): ColumnRoleId | undefined => mapping.columnRoles.get(column)

  it('maps the charge as the amount and the transaction amount as the original', () => {
    expect(roleOf(2)).toBe('originalAmount')
    expect(roleOf(3)).toBe('originalCurrency')
    expect(roleOf(4)).toBe('amount')
    expect(roleOf(6)).toBe('installmentText')
    // `סכום חיוב` is the money that left the account and must win the amount
    // role outright, or every installment row imports at its full price.
    expect(columnFor(mapping.columnRoles, 'amount')).toBe(4)
  })

  it('reads the purchase total as a total, not as a foreign amount', () => {
    // The bug this fixture exists for: ₪1,200 charged in twelve ₪100 slices was
    // recorded as a conversion from shekels into shekels.
    const slice = rows[0]
    expect(slice).toBeDefined()
    if (slice === undefined) return

    expect(formatMoney(slice.amount)).toBe('-₪100.00')
    expect(slice.foreign).toBeUndefined()
    expect(slice.installment?.sequence).toBe(3)
    expect(slice.installment?.total).toBe(12)
    expect(slice.installment?.originalTotal).toEqual({ minor: 120000, currency: 'ILS' })
  })

  it('gives two slices of one purchase the same group key', () => {
    // Months apart, different slice numbers, different charge dates.
    expect(rows[0]?.installment?.groupKey).toBe(rows[1]?.installment?.groupKey)
    expect(rows[0]?.installment?.groupKey).not.toBe('')
  })

  it('does not group two purchases from the same shop on the same day', () => {
    expect(rows[2]?.installment?.originalTotal).toEqual({ minor: 240000, currency: 'ILS' })
    expect(rows[2]?.installment?.groupKey).not.toBe(rows[0]?.installment?.groupKey)
  })

  it('still reads a genuine conversion as one, in the currency the file stated', () => {
    const abroad = rows[3]
    expect(abroad?.merchantRaw).toBe('AMAZON.COM')
    expect(abroad?.installment).toBeUndefined()
    // Not ILS 42.99, which is what recording a foreign amount in the charge
    // currency used to produce.
    expect(abroad?.foreign?.originalAmount).toEqual({ minor: 4299, currency: 'USD' })
  })

  it('drops the original amount a provider repeats on a domestic row', () => {
    const domestic = rows[4]
    expect(domestic?.merchantRaw).toBe('קפה גן עד')
    expect(domestic?.foreign).toBeUndefined()
    expect(domestic?.installment).toBeUndefined()
  })
})

describe('the numbered sheet', () => {
  const rows = parsed(1)

  it('reads a counter split across two numeric columns', () => {
    // `installmentSequence` and `installmentTotal` have been roles since the
    // mapper shipped; until 007 nothing read them.
    expect(rows[0]?.installment?.sequence).toBe(3)
    expect(rows[0]?.installment?.total).toBe(12)
  })

  it('reaches the same group key as the sentence-shaped file', () => {
    // Same purchase, stated two ways. A key derived from the purchase rather
    // than from the row's wording has to agree.
    expect(rows[0]?.installment?.groupKey).toBe(parsed(0)[0]?.installment?.groupKey)
  })

  it('leaves an ordinary row alone', () => {
    expect(rows[2]?.installment).toBeUndefined()
  })
})
