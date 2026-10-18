import { describe, expect, it } from 'vitest'

import { column, type FormatDeclaration } from './declaration.ts'
import { identity } from './identity.ts'
import {
  findHeaderRow,
  guessReading,
  headerProblems,
  PENDING_HEADER,
  positionRow,
  readHeader,
  inferDateOrder,
  matchKey,
  parseFigure,
  readingProblems,
  readingSignature,
  readRows,
  signatureOverlap,
  stagedRows,
  type ReadCell,
  type ReadTable,
  type Reading,
} from './reading.ts'
import { tally } from './row.ts'

/**
 * A reading is judgement and `row.ts` is typing, and the tests are split the
 * same way: what is asserted here is *which cell went to which key* and *what a
 * reading refuses before it runs*, never what a value of a column is — that is
 * `row.test.ts`, and asserting it twice is how two places end up disagreeing
 * about it.
 *
 * The last block is the one the unit exists for: a file read onto a format
 * whose identity then judges the rows, before a single one is written.
 */

function declaring(...columns: FormatDeclaration['columns']): FormatDeclaration {
  return {
    language: 4,
    name: 'line',
    title: 'Line',
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
}

function text(value: string): ReadCell {
  return value === '' ? { kind: 'empty', text: '' } : { kind: 'text', text: value }
}

function number(value: number): ReadCell {
  return { kind: 'number', text: String(value), value }
}

function table(...rows: readonly (readonly ReadCell[])[]): ReadTable {
  return { rows, columnCount: Math.max(...rows.map((row) => row.length), 0) }
}

function reading(over: Partial<Reading> = {}): Reading {
  return {
    format: 'line',
    headerRow: 0,
    dateOrder: 'dmy',
    columns: [],
    fixed: [],
    ...over,
  }
}

describe('finding the header', () => {
  it('takes the row of short distinct labels over the rows of figures', () => {
    const sheet = table(
      [text('Ingredient export'), text(''), text('')],
      [text(''), text(''), text('')],
      [text('name'), text('grams'), text('kcal')],
      [text('Pasta'), number(100), number(350)],
      [text('Salt'), number(5), number(0)],
    )

    expect(findHeaderRow(sheet)).toBe(2)
  })

  it('does not mistake a repeated label for a header', () => {
    const sheet = table(
      [text('total'), text('total'), text('total')],
      [text('name'), text('grams'), text('kcal')],
    )

    expect(findHeaderRow(sheet)).toBe(1)
  })
})

describe('guessing which column is which key', () => {
  const declaration = declaring(
    column('name', 'text', { required: true }),
    column('amount_g', 'real', { unit: 'g' }),
    column('energy', 'real', { unit: 'kcal' }),
  )

  it('matches a header to the key it spells, then to the words it uses', () => {
    expect(matchKey(declaration, 'name', new Set())).toBe('name')
    expect(matchKey(declaration, 'Amount G', new Set())).toBe('amount_g')
    // `energy` declares its unit as kcal, which is what a spreadsheet's header
    // actually says.
    expect(matchKey(declaration, 'kcal', new Set())).toBe('energy')
  })

  it('leaves a header it does not recognise unmapped rather than guessing', () => {
    // D-114: a reference column read as an amount is a file that imports
    // cleanly and is wrong in every figure.
    expect(matchKey(declaration, 'אסמכתא', new Set())).toBeUndefined()
    expect(matchKey(declaration, 'notes', new Set())).toBeUndefined()
  })

  it('offers a key once, because the person knows which of two is which', () => {
    expect(matchKey(declaration, 'name', new Set(['name']))).toBeUndefined()
  })

  it('never proposes a link: which column names a row is the person’s to say', () => {
    const withLink = declaring(
      column('name', 'text'),
      column('recipe', 'link', { target: 'recipe' }),
    )

    expect(matchKey(withLink, 'recipe', new Set())).toBeUndefined()
  })

  it('guesses a whole reading, header row and date order included', () => {
    const sheet = table(
      [text('name'), text('amount g'), text('kcal')],
      [text('Pasta'), number(100), number(350)],
    )

    const guessed = guessReading(declaration, sheet)
    expect(guessed.format).toBe('line')
    expect(guessed.headerRow).toBe(0)
    expect(guessed.columns).toEqual([
      { index: 0, key: 'name' },
      { index: 1, key: 'amount_g' },
      { index: 2, key: 'energy' },
    ])
  })
})

describe('a date that could be two days', () => {
  it('reads the order off the dates when one of them decides it', () => {
    expect(inferDateOrder(['13/04/2026', '02/04/2026'])).toBe('dmy')
    expect(inferDateOrder(['04/13/2026', '04/02/2026'])).toBe('mdy')
    expect(inferDateOrder(['2026-04-13'])).toBe('ymd')
  })

  it('answers with the default when nothing decides it, rather than with a coin', () => {
    // `03/04/2026` is two different days and no amount of looking at it says
    // which. The mapper shows this as a select, not as a fact.
    expect(inferDateOrder(['03/04/2026', '01/02/2026'])).toBe('dmy')
  })
})

describe('a figure as a document writes one', () => {
  it('reads separators, symbols, parentheses and a trailing minus', () => {
    expect(parseFigure('1,234.50')).toBe(1234.5)
    expect(parseFigure('₪1,234.50')).toBe(1234.5)
    expect(parseFigure('(1,234.50)')).toBe(-1234.5)
    expect(parseFigure('1234.50-')).toBe(-1234.5)
  })

  it('answers nothing rather than a guess, so the refusal names the column', () => {
    expect(parseFigure('about four')).toBeUndefined()
    expect(parseFigure('')).toBeUndefined()
  })
})

describe('what a reading refuses before it runs', () => {
  const declaration = declaring(
    column('name', 'text', { required: true }),
    column('paid', 'money'),
    column('amount', 'quantity'),
    column('recipe', 'link', { target: 'recipe' }),
  )

  it('names a required column nothing fills', () => {
    const problems = readingProblems(declaration, reading({ columns: [{ index: 1, key: 'paid' }] }), undefined)

    expect(problems.map((each) => each.key)).toContain('name')
    expect(problems.find((each) => each.key === 'name')?.message).toContain('is required')
  })

  it('asks for a currency once rather than four hundred times', () => {
    const problems = readingProblems(
      declaration,
      reading({ columns: [{ index: 0, key: 'name' }, { index: 1, key: 'paid' }] }),
      undefined,
    )

    const currency = problems.find((each) => each.key === 'paid_currency')
    expect(currency?.message).toContain('one currency for the whole file')
  })

  it('takes a currency fixed for the file as an answer', () => {
    const problems = readingProblems(
      declaration,
      reading({
        columns: [{ index: 0, key: 'name' }, { index: 1, key: 'paid' }],
        fixed: [{ key: 'paid_currency', value: 'ILS' }],
      }),
      undefined,
    )

    expect(problems).toEqual([])
  })

  it('refuses a key filled twice over', () => {
    const problems = readingProblems(
      declaration,
      reading({
        columns: [{ index: 0, key: 'name' }, { index: 2, key: 'name' }],
      }),
      undefined,
    )

    expect(problems.find((each) => each.key === 'name')?.message).toContain('filled 2 times over')
  })

  it('refuses a column pointed at a link when it cannot see what the link names', () => {
    // No formats handed in is a caller that cannot look, and the answer is no.
    const problems = readingProblems(
      declaration,
      reading({ columns: [{ index: 0, key: 'name' }, { index: 1, key: 'recipe' }] }),
      undefined,
    )

    expect(problems.find((each) => each.key === 'recipe')?.message).toContain(
      'a column of a file cannot fill it',
    )
  })

  it('lets a column fill a link only by a unique name (M24 U9, D-261)', () => {
    const bound = reading({ columns: [{ index: 0, key: 'name' }, { index: 1, key: 'recipe' }] })
    const named = (unique: boolean): ReadonlyMap<string, Pick<FormatDeclaration, 'columns'>> =>
      new Map([['recipe', { columns: [column('title', 'text', { unique })] }]])

    // Not unique: a cell could name two rows, and the first would be a guess.
    const shared = readingProblems(declaration, bound, undefined, named(false))
    expect(shared.find((each) => each.key === 'recipe')?.message).toContain(
      'title — which is not unique',
    )
    // No text column at all: nothing a cell could be the name of.
    const nameless = readingProblems(
      declaration,
      bound,
      undefined,
      new Map([['recipe', { columns: [column('servings', 'integer')] }]]),
    )
    expect(nameless.find((each) => each.key === 'recipe')?.message).toContain('no text column')

    expect(readingProblems(declaration, bound, undefined, named(true))).toEqual([])
  })

  it('reads a link cell as the text the file shows, so a card keeps its leading zero', () => {
    const read = readRows(
      declaration,
      reading({ columns: [{ index: 0, key: 'name' }, { index: 1, key: 'recipe' }] }),
      table(
        [text('name'), text('card')],
        [text('Coffee'), { kind: 'number', text: '0417', value: 417 }],
      ),
    )

    expect(read.rows[0]?.problem).toBeUndefined()
    expect(read.rows[0]?.cells?.['recipe']).toBe('0417')
  })

  it('accepts one link chosen for the whole file', () => {
    const problems = readingProblems(
      declaration,
      reading({
        columns: [{ index: 0, key: 'name' }],
        fixed: [{ key: 'recipe', value: 'row-1' }],
      }),
      undefined,
    )

    expect(problems).toEqual([])
  })

  it('refuses a reading for another format outright', () => {
    const problems = readingProblems(declaration, reading({ format: 'other' }), undefined)

    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('is for other')
  })
})

describe('running a reading over a file', () => {
  const declaration = declaring(
    column('name', 'text', { required: true }),
    column('grams', 'real', { unit: 'g', minimum: 0 }),
    column('bought', 'date'),
  )

  const sheet = table(
    [text('name'), text('grams'), text('bought')],
    [text('Pasta'), text('1,200'), text('13/04/2026')],
    [text('Salt'), number(5), text('02/04/2026')],
    [text(''), text(''), text('')],
    [text('Oil'), text('about four'), text('01/04/2026')],
  )

  const over = reading({
    columns: [
      { index: 0, key: 'name' },
      { index: 1, key: 'grams' },
      { index: 2, key: 'bought' },
    ],
  })

  it('types every row the same way a conversation is typed', () => {
    const read = readRows(declaration, over, sheet)

    expect(read.rows[0]?.cells).toEqual({ name: 'Pasta', grams: 1200, bought: '2026-04-13' })
    expect(read.rows[1]?.cells).toEqual({ name: 'Salt', grams: 5, bought: '2026-04-02' })
  })

  it('keeps the row that failed, with the sentence that says why', () => {
    // A reading that threw away what it could not type would be hiding the
    // evidence from the one surface built to show it (D-149).
    const read = readRows(declaration, over, sheet)
    const failed = read.rows.find((row) => row.cells === undefined)

    expect(failed?.line).toBe(4)
    expect(failed?.problem).toContain('grams')
  })

  it('counts a blank row as nothing rather than as a failure', () => {
    const read = readRows(declaration, over, sheet)

    expect(read.blank).toBe(1)
    expect(read.rows).toHaveLength(3)
  })

  it('gives every row what a person fixed for the whole file', () => {
    const withMoney = declaring(column('name', 'text'), column('paid', 'money'))
    const priced = table([text('name'), text('paid')], [text('Pasta'), text('12.90')])

    const read = readRows(
      withMoney,
      reading({
        columns: [{ index: 0, key: 'name' }, { index: 1, key: 'paid' }],
        fixed: [{ key: 'paid_currency', value: 'ILS' }],
      }),
      priced,
    )

    expect(read.rows[0]?.cells).toEqual({ name: 'Pasta', paid_minor: 1290, paid_currency: 'ILS' })
  })

  it('gives a fixed currency or unit only to the rows with an amount (M38 U1)', () => {
    const withMoney = declaring(column('name', 'text'), column('paid', 'money'), column('weight', 'quantity'))
    const priced = table(
      [text('name'), text('paid'), text('weight')],
      [text('Pasta'), text('12.90'), text('500')],
      [text('Salt'), { kind: 'empty', text: '' }, { kind: 'empty', text: '' }],
    )

    const read = readRows(
      withMoney,
      reading({
        columns: [{ index: 0, key: 'name' }, { index: 1, key: 'paid' }, { index: 2, key: 'weight' }],
        fixed: [{ key: 'paid_currency', value: 'ILS' }, { key: 'weight_unit', value: 'g' }],
      }),
      priced,
    )

    expect(read.rows.map((row) => row.problem)).toEqual([undefined, undefined])
    expect(read.rows[0]?.cells).toMatchObject({ paid_minor: 1290, paid_currency: 'ILS', weight_unit: 'g' })
    expect(read.rows[1]?.cells).toMatchObject({ name: 'Salt', paid_minor: null, paid_currency: null, weight_unit: null })
  })
})

describe('the proof is the document’s, not the importer’s', () => {
  it('judges the staged rows by the format’s own identities before one is written', () => {
    // U3's identity, U5's rows, and nothing new in between. This is the whole
    // claim of the unit: the confirm surface does not verify the import, the
    // declaration does.
    const declaration: FormatDeclaration = {
      ...declaring(
        column('name', 'text', { required: true }),
        column('gross', 'real'),
        column('tax', 'real'),
        column('net', 'real'),
      ),
      identities: [identity('adds_up', 'gross - tax = net')],
      nothingMustHold: false,
    }

    const sheet = table(
      [text('name'), text('gross'), text('tax'), text('net')],
      [text('March'), number(100), number(20), number(80)],
      [text('April'), number(100), number(20), number(70)],
      [text('May'), number(100), text(''), text('')],
    )

    const read = readRows(
      declaration,
      reading({
        columns: [
          { index: 0, key: 'name' },
          { index: 1, key: 'gross' },
          { index: 2, key: 'tax' },
          { index: 3, key: 'net' },
        ],
      }),
      sheet,
    )

    expect(tally(declaration, stagedRows(read))).toEqual({ proved: 1, failed: 1, unchecked: 1 })
  })
})

describe('the signature that makes a file the same kind of file', () => {
  const sheet = table([text('name'), text('grams'), text('kcal')], [text('Pasta'), number(1), number(2)])

  it('is the header cells, normalized and sorted', () => {
    const moved = table([text('kcal'), text('name'), text('grams')], [])

    expect(readingSignature(sheet, 0)).toBe(readingSignature(moved, 0))
  })

  it('says how close rather than same or not', () => {
    const renamed = table([text('name'), text('grams'), text('energy')], [])

    expect(signatureOverlap(readingSignature(sheet, 0), readingSignature(sheet, 0))).toBe(1)
    expect(signatureOverlap(readingSignature(sheet, 0), readingSignature(renamed, 0))).toBeCloseTo(0.5)
  })
})

describe('a reading writes its own header row (M24 U10, D-262)', () => {
  const statement: FormatDeclaration = {
    ...declaring(
      column('period', 'text'),
      column('printed_total', 'money', { required: true }),
    ),
    name: 'statement',
    title: 'Statement',
  }
  const lines = declaring(
    column('merchant', 'text', { required: true }),
    column('amount', 'money'),
    column('statement', 'link', { target: 'statement', required: true }),
  )
  const formats = new Map([['statement', statement], ['line', lines]])

  const sheet = table(
    [text('Period'), text('2026-07')],
    [text('merchant'), text('amount')],
    [text('Shufersal'), number(120.5)],
    [text('Aroma'), number(32)],
    [text('Total'), text('₪152.50')],
    [text(''), text('')],
  )

  const header = {
    format: 'statement',
    link: 'statement',
    cells: [
      { key: 'period', row: 0, index: 1 },
      { key: 'printed_total', row: -1, index: 1 },
    ],
    fixed: [{ key: 'printed_total_currency', value: 'ILS' }],
  }
  const bound = reading({
    headerRow: 1,
    columns: [
      { index: 0, key: 'merchant' },
      { index: 1, key: 'amount' },
    ],
    fixed: [{ key: 'amount_currency', value: 'ILS' }],
    header,
  })

  it('counts a row below zero back from the last row that holds anything, not the last row', () => {
    // The trailing blank row is a spreadsheet's, and a total is above it.
    expect(positionRow(sheet, -1)).toBe(4)
    expect(positionRow(sheet, -5)).toBe(0)
    expect(positionRow(sheet, -6)).toBeUndefined()
    expect(positionRow(sheet, 6)).toBeUndefined()
  })

  it('reads the header off the file with the same typing a line gets', () => {
    const read = readHeader(statement, header, sheet, 'dmy')
    expect(read.problem).toBeUndefined()
    expect(read.cells).toMatchObject({
      period: '2026-07',
      printed_total_minor: 15250,
      printed_total_currency: 'ILS',
    })
  })

  it('refuses a header row that did not read, by the column it is missing', () => {
    const blank = { ...header, cells: [{ key: 'printed_total', row: 5, index: 1 }] }
    expect(readHeader(statement, blank, sheet, 'dmy').problem).toMatch(/^The header row: .*printed_total/)
  })

  it('fills every line’s link with a stand-in, and does not read the header’s own rows as lines', () => {
    const read = readRows(lines, bound, sheet)
    // Two lines: the total row under them is the header's, not a line that failed.
    expect(read.rows.map((row) => row.line)).toEqual([2, 3])
    expect(read.rows.every((row) => row.cells?.['statement'] === PENDING_HEADER)).toBe(true)
  })

  it('counts the header link as filled, and refuses it filled twice', () => {
    expect(readingProblems(lines, bound, sheet, formats)).toEqual([])
    const twice = readingProblems(
      lines,
      { ...bound, fixed: [...bound.fixed, { key: 'statement', value: 'x' }] },
      sheet,
      formats,
    )
    expect(twice.find((each) => each.key === 'statement')?.message).toContain('the reading fills it')
  })

  it('says what is wrong with a header before it runs', () => {
    expect(headerProblems(lines, header, statement, sheet, formats)).toEqual([])

    expect(headerProblems(lines, header, undefined, sheet)[0]?.message).toContain(
      'declares no format called statement',
    )
    expect(
      headerProblems(lines, { ...header, link: 'merchant' }, statement, sheet)[0]?.message,
    ).toContain('no link called merchant pointing at statement')

    const unfilled = headerProblems(lines, { ...header, cells: [] }, statement, sheet)
    expect(unfilled.map((each) => each.key)).toContain('printed_total')

    const noCurrency = headerProblems(lines, { ...header, fixed: [] }, statement, sheet)
    expect(noCurrency.map((each) => each.key)).toContain('printed_total_currency')

    const offFile = headerProblems(
      lines,
      { ...header, cells: [{ key: 'printed_total', row: 40, index: 1 }] },
      statement,
      sheet,
    )
    expect(offFile[0]?.message).toContain('not a cell of this file')

    const unknown = headerProblems(
      lines,
      { ...header, cells: [...header.cells, { key: 'card', row: 0, index: 0 }] },
      statement,
      sheet,
    )
    expect(unknown[0]?.message).toContain('statement has no card')
  })
})
