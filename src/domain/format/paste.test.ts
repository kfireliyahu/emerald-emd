import { describe, expect, it } from 'vitest'

import { column } from './declaration.ts'
import { fieldsOf, gridOf, pasted } from './paste.ts'

describe('clipboard text as cells', () => {
  it('reads a spreadsheet’s tab-separated block, without a last empty row', () => {
    expect(gridOf('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('reads a block of plain text as one column', () => {
    expect(gridOf('one\ntwo')).toEqual([['one'], ['two']])
  })

  it('keeps a quoted cell’s line break, tab and doubled quote', () => {
    expect(gridOf('"two\nlines"\t"say ""hi"""\tplain "quote"\n')).toEqual([
      ['two\nlines', 'say "hi"', 'plain "quote"'],
    ])
  })

  it('keeps empty cells where they were', () => {
    expect(gridOf('a\t\tc')).toEqual([['a', '', 'c']])
  })
})

describe('a paste laid onto drafts', () => {
  const columns = [column('name', 'text'), column('price', 'money'), column('weight', 'quantity')]
  const blank = { name: '', price: '', price_currency: 'ILS', weight: '', weight_unit: '' }

  it('starts at the cell pasted in, and opens rows past the last', () => {
    const result = pasted([blank], columns, [['12.90', '750 g'], ['3 usd']], 0, 1, blank)
    expect(result.touched).toEqual([0, 1])
    expect(result.drafts[0]).toMatchObject({ price: '12.90', price_currency: 'ILS', weight: '750', weight_unit: 'g' })
    expect(result.drafts[1]).toMatchObject({ price: '3', price_currency: 'USD' })
    expect(result.dropped).toBe(0)
  })

  it('counts the cells past the last column rather than losing them quietly', () => {
    const result = pasted([blank], columns, [['a', '1', '2 g', 'extra']], 0, 0, blank)
    expect(result.dropped).toBe(1)
  })

  it('skips a row of the paste that is empty', () => {
    const result = pasted([blank], columns, [['a'], [''], ['b']], 0, 0, blank)
    expect(result.touched).toEqual([0, 2])
  })

  it('leaves a figure exactly as written for the coercion to judge', () => {
    expect(fieldsOf(columns[1]!, '12,90 EUR')).toEqual({ price: '12,90', price_currency: 'EUR' })
    expect(fieldsOf(columns[1]!, 'ILS 5')).toEqual({ price: '5', price_currency: 'ILS' })
    expect(fieldsOf(columns[0]!, ' keep  me ')).toEqual({ name: ' keep  me ' })
  })
})
