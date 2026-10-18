import { describe, expect, it } from 'vitest'

import { read, write } from './artefact.ts'
import {
  column,
  declarationProblems,
  DECLARATION_LANGUAGE,
  rollupRejection,
  type FormatDeclaration,
} from './declaration.ts'
import { assembleRollup, parseRollup, rollupText, type RollupDeclaration } from './rollup.ts'

const CATEGORY: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'category',
  title: 'Category',
  notes: '',
  columns: [column('name', 'text', { required: true }), column('essential', 'boolean')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const SPEND: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'spend',
  title: 'Spend',
  notes: '',
  columns: [
    column('label', 'text', { required: true }),
    column('amount', 'money'),
    column('grams', 'quantity'),
    column('rate', 'decimal', { scale: 2 }),
    column('charged_on', 'date'),
    column('bought_on', 'date', { required: true }),
    column('period', 'month'),
    column('at', 'instant'),
    column('direction', 'enum', { values: ['OUTFLOW', 'INFLOW'] }),
    column('category', 'link', { target: 'category' }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

function parsed(text: string, name = 'spending'): RollupDeclaration {
  const result = parseRollup(name, text)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function rejected(text: string): string | undefined {
  return rollupRejection(parsed(text), SPEND, [CATEGORY])
}

describe('the rollup sentence', () => {
  it('reads every part and writes it back the same', () => {
    const text =
      'sum of amount by month of charged_on or bought_on and category where direction is OUTFLOW and category.essential is true'
    const each = parsed(text)
    expect(each).toMatchObject({
      kind: 'SUM',
      of: 'amount',
      period: { column: 'charged_on', fallback: 'bought_on', truncate: true },
      by: 'category',
      where: [
        { column: 'direction', is: 'OUTFLOW' },
        { column: 'category.essential', is: 'true' },
      ],
    })
    expect(rollupText(each)).toBe(text)
    expect(rollupText(parsed('count by period'))).toBe('count by period')
  })

  it('reads a filter whose members have spaces, and an `and` inside a quoted one (M48 U1)', () => {
    const text = 'sum of amount by period where kind is one of Rent, "Food and Drink" and label is "Research and development"'
    const each = parsed(text)
    expect(each.where).toEqual([
      { column: 'kind', is: 'Rent', oneOf: ['Rent', 'Food and Drink'] },
      { column: 'label', is: 'Research and development' },
    ])
    expect(rollupText(each)).toBe(text)
    expect(parsed(rollupText(each)).where).toEqual(each.where)
  })

  it('refuses a sentence that is not one, and a kind that is not one', () => {
    expect(parseRollup('x', 'amount per month').ok).toBe(false)
    const median = parseRollup('x', 'median of amount by period')
    expect(median.ok ? '' : median.error).toContain('sum, count, average, minimum, maximum')
    expect(parseRollup('x', 'sum of amount by period, category').ok).toBe(false)
  })

  it('takes what the columns can answer', () => {
    expect(rejected('sum of amount by month of bought_on and category where direction is OUTFLOW')).toBeUndefined()
    expect(rejected('minimum of rate by period')).toBeUndefined()
    expect(rejected('count by period and category where category.essential is false')).toBeUndefined()
  })

  it('refuses what it cannot compile honestly, each in a sentence naming the part', () => {
    expect(rejected('sum of label by period')).toContain('label, which is a text')
    expect(rejected('sum of grams by period')).toContain('a quantity')
    expect(rejected('average of amount by period')).toContain('an average of money')
    expect(rejected('count of amount by period')).toContain('counts rows')
    expect(rejected('sum of amount by bought_on')).toContain('month of bought_on')
    expect(rejected('sum of amount by month of period')).toContain('takes a date column')
    expect(rejected('sum of amount by month of at')).toContain('time zone')
    expect(rejected('sum of amount by period and direction')).toContain('groups by one link')
    expect(rejected('sum of amount by period where direction is OUTFLOWS')).toContain('one of OUTFLOW, INFLOW')
    expect(rejected('sum of amount by period where label is x')).toContain('enum or a boolean')
    expect(rejected('sum of amount by period where direction is OUTFLOW and direction is INFLOW')).toContain('twice')
    expect(rejected('sum of nothing by period')).toContain('no such column')
  })

  it('is language 10, and shares a name with nothing else the format declares', () => {
    const rollup = parsed('sum of amount by period', 'amount')
    const problems = declarationProblems({ ...SPEND, rollups: [rollup] }, [CATEGORY])
    expect(problems.map((each) => each.message).join(' ')).toContain('same thing as a column')
    const older = declarationProblems({ ...SPEND, language: 9, rollups: [parsed('count by period')] }, [CATEGORY])
    expect(older.some((each) => each.rollupIndex === 0 && each.message.includes('language 10'))).toBe(true)
  })

  it('round-trips through the .format.md as a fifth table', () => {
    const declaration: FormatDeclaration = {
      ...SPEND,
      rollups: [{ ...parsed('sum of amount by month of bought_on and category'), note: 'per category' }],
    }
    const text = write(declaration)
    expect(text).toContain('| rollup | works out | note |')
    const back = read(text, undefined, [CATEGORY])
    expect(back.ok ? back.value.rollups : back.error).toEqual(declaration.rollups)
  })
})

describe('assembling the groups', () => {
  const sum = parsed('sum of amount by period and category where direction is OUTFLOW')

  it('keeps currencies apart and marks only the group with a silent row', () => {
    const groups = assembleRollup(
      sum,
      'spend',
      [
        { period: '2026-03', by: 'food', currency: 'ILS', figure: -500, rows: 2, silent: 0, silent_row: null },
        { period: '2026-03', by: 'food', currency: 'USD', figure: -20, rows: 1, silent: 0, silent_row: null },
        { period: '2026-04', by: 'food', currency: 'ILS', figure: -100, rows: 3, silent: 1, silent_row: 'r9' },
      ],
      { money: true },
    )
    expect(groups[0]).toEqual({
      period: '2026-03',
      by: 'food',
      rows: 3,
      value: {
        kind: 'VALUE',
        figures: [
          { value: -500, currency: 'ILS' },
          { value: -20, currency: 'USD' },
        ],
      },
    })
    expect(groups[1]?.value.kind).toBe('UNCHECKED')
    expect(groups[1]?.value.kind === 'UNCHECKED' ? groups[1].value.reason : '').toContain('Row r9 of spend')
  })

  it('reads a decimal back at its scale, and a count as one figure', () => {
    const minimum = parsed('minimum of rate by period')
    expect(
      assembleRollup(minimum, 'spend', [{ period: '2026-03', by: null, currency: null, figure: 1234, rows: 1, silent: 0, silent_row: null }], {
        money: false,
        scale: 2,
      })[0]?.value,
    ).toEqual({ kind: 'VALUE', figures: [{ value: 12.34 }] })
    const count = parsed('count by period')
    expect(
      assembleRollup(count, 'spend', [{ period: null, by: null, currency: null, figure: null, rows: 4, silent: 0, silent_row: null }], { money: false })[0],
    ).toEqual({ period: undefined, by: undefined, rows: 4, value: { kind: 'VALUE', figures: [{ value: 4 }] } })
  })
})
