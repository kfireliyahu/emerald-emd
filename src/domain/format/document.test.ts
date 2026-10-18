/**
 * **The shapes `docs/memory.emd` does not have yet** — money, quantities, a
 * newline in a cell, a unit somebody corrected, and every refusal.
 *
 * `formatDocumentRepository.test.ts` runs the whole thing over the real
 * document, which is the test that matters and the one that cannot cover what
 * that document has never held. This file is the other half, and its shape is
 * one claim at a time: **anything that goes in comes back, byte for byte, and
 * everything that cannot is refused by name.**
 */

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { column, type FormatDeclaration } from './declaration.ts'
import {
  joinParts,
  readDocument,
  readFormat,
  splitParts,
  writeDocument,
  writeFormat,
  type DocumentContent,
  type FormatContent,
} from './document.ts'
import type { StoredRow, StoredValue } from './row.ts'
import { SEEDED_UNITS, type UnitRow, type UnitTable } from './unit.ts'

function format(
  name: string,
  columns: FormatDeclaration['columns'],
  extra: Partial<FormatDeclaration> = {},
): FormatDeclaration {
  return {
    language: 4,
    name,
    title: name,
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    ...extra,
  }
}

function row(id: string, cells: Record<string, StoredValue>): StoredRow {
  return { id, cells }
}

/** A document, written and read back and written again. */
function roundTrip(content: DocumentContent): {
  readonly first: string
  readonly second: string
} {
  const written = writeDocument(content)
  if (!written.ok) throw new Error(written.error)
  const joined = joinParts(written.value)
  if (!joined.ok) throw new Error(joined.error)

  const read = readDocument(written.value)
  if (!read.ok) throw new Error(read.error)

  // Read back, the rows carry no ids, so writing them again needs one — and it
  // must not matter what it is, which is most of what this function proves.
  const again = writeDocument({
    units: read.value.units,
    formats: read.value.formats.map((each) => ({
      declaration: each.declaration,
      rows: each.rows.map((parsed, at) => ({
        id: `made-up-${String(at)}`,
        cells: { ...parsed.cells, ...parsed.links },
      })),
    })),
  })
  if (!again.ok) throw new Error(again.error)
  const rejoined = joinParts(again.value)
  if (!rejoined.ok) throw new Error(rejoined.error)

  return { first: joined.value, second: rejoined.value }
}

const NOTE = format('note', [
  column('name', 'text', { required: true }),
  column('body', 'text'),
  column('rating', 'integer', { minimum: 0, maximum: 5 }),
  column('ratio', 'real'),
  column('seen', 'date'),
  column('kept', 'boolean'),
  column('mood', 'enum', { values: ['good', 'bad'] }),
])

describe('a value survives the trip', () => {
  it('keeps a newline, a leading space, an empty string and a leading quote', () => {
    const content: DocumentContent = {
      units: SEEDED_UNITS,
      formats: [
        {
          declaration: NOTE,
          rows: [
            row('1', { name: 'multiline', body: 'first line\nsecond line', rating: null, ratio: null, seen: null, kept: null, mood: null }),
            row('2', { name: 'padded', body: '  held on both sides  ', rating: null, ratio: null, seen: null, kept: null, mood: null }),
            row('3', { name: 'empty', body: '', rating: null, ratio: null, seen: null, kept: null, mood: null }),
            row('4', { name: '"quoted"', body: '| a pipe | and another |', rating: null, ratio: null, seen: null, kept: null, mood: null }),
          ],
        },
      ],
    }

    const written = writeDocument(content)
    if (!written.ok) throw new Error(written.error)
    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)

    const bodies = (read.value.formats[0]?.rows ?? []).map((each) => each.cells['body'])
    expect(bodies).toContain('first line\nsecond line')
    expect(bodies).toContain('  held on both sides  ')
    expect(bodies).toContain('')
    expect(bodies).toContain('| a pipe | and another |')

    const names = (read.value.formats[0]?.rows ?? []).map((each) => each.cells['name'])
    expect(names).toContain('"quoted"')
  })

  it('keeps null apart from the empty string', () => {
    const content: DocumentContent = {
      units: SEEDED_UNITS,
      formats: [
        {
          declaration: NOTE,
          rows: [
            row('1', { name: 'nothing', body: null, rating: null, ratio: null, seen: null, kept: null, mood: null }),
            row('2', { name: 'blank', body: '', rating: null, ratio: null, seen: null, kept: null, mood: null }),
          ],
        },
      ],
    }

    const written = writeDocument(content)
    if (!written.ok) throw new Error(written.error)
    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)

    const rows = read.value.formats[0]?.rows ?? []
    expect(rows.find((each) => each.cells['name'] === 'nothing')?.cells['body']).toBeNull()
    expect(rows.find((each) => each.cells['name'] === 'blank')?.cells['body']).toBe('')
  })

  it('keeps every other type as it was declared', () => {
    const content: DocumentContent = {
      units: SEEDED_UNITS,
      formats: [
        {
          declaration: NOTE,
          rows: [
            row('1', {
              name: 'everything',
              body: 'plain',
              rating: 4,
              ratio: 1.5,
              seen: '2026-09-20',
              kept: 1,
              mood: 'good',
            }),
          ],
        },
      ],
    }

    const written = writeDocument(content)
    if (!written.ok) throw new Error(written.error)
    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)

    expect(read.value.formats[0]?.rows[0]?.cells).toEqual({
      name: 'everything',
      body: 'plain',
      rating: 4,
      ratio: 1.5,
      seen: '2026-09-20',
      kept: 1,
      mood: 'good',
    })
  })
})

describe('money and quantities', () => {
  const PRICED = format('priced', [
    column('name', 'text', { required: true }),
    column('price', 'money'),
    column('amount', 'quantity'),
  ])

  function priced(rows: readonly StoredRow[]): DocumentContent {
    return { units: SEEDED_UNITS, formats: [{ declaration: PRICED, rows }] }
  }

  it('writes an amount in major units and reads back the same minor units', () => {
    // `421.05` is the number `fromMajorUnits` documents itself against:
    // `421.05 * 100` is `42104.999999999996`. Three currencies because the
    // number of minor-unit digits is not two everywhere, and a serializer that
    // assumed it would be wrong by a hundredfold in Tokyo.
    const content = priced([
      row('1', { name: 'shekels', price_minor: 42105, price_currency: 'ILS', amount: null, amount_unit: null }),
      row('2', { name: 'yen', price_minor: 1250, price_currency: 'JPY', amount: null, amount_unit: null }),
      row('3', { name: 'dinars', price_minor: 1234567, price_currency: 'KWD', amount: null, amount_unit: null }),
      row('4', { name: 'owed', price_minor: -999, price_currency: 'ILS', amount: null, amount_unit: null }),
      row('5', { name: 'nought', price_minor: 0, price_currency: 'ILS', amount: null, amount_unit: null }),
    ])

    const written = writeDocument(content)
    if (!written.ok) throw new Error(written.error)
    expect(written.value[0]?.text).toContain('price: 421.05')
    expect(written.value[0]?.text).toContain('price: 12')
    expect(written.value[0]?.text).toContain('price: 1234.567')
    expect(written.value[0]?.text).toContain('price: -9.99')

    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)
    const minors = (read.value.formats[0]?.rows ?? []).map((each) => each.cells['price_minor'])
    expect(minors.sort((a, b) => Number(a) - Number(b))).toEqual([-999, 0, 1250, 42105, 1234567])
  })

  it('keeps a quantity as the figure and the unit it was in', () => {
    const content = priced([
      row('1', { name: 'flour', price_minor: null, price_currency: null, amount: 150, amount_unit: 'g' }),
      row('2', { name: 'milk', price_minor: null, price_currency: null, amount: 200, amount_unit: 'ml' }),
    ])

    const written = writeDocument(content)
    if (!written.ok) throw new Error(written.error)
    expect(written.value[0]?.text).toContain('amount: 150')
    expect(written.value[0]?.text).toContain('amount_unit: g')

    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)
    const rows = read.value.formats[0]?.rows ?? []
    expect(rows.find((each) => each.cells['name'] === 'milk')?.cells['amount_unit']).toBe('ml')
  })

  it('refuses an amount with more fraction digits than the currency has', () => {
    const written = writeDocument(
      priced([row('1', { name: 'a', price_minor: 100, price_currency: 'ILS', amount: null, amount_unit: null })]),
    )
    if (!written.ok) throw new Error(written.error)
    const text = (written.value[0]?.text ?? '').replace('price: 1.00', 'price: 1.005')

    const read = readFormat(text)
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error('expected a refusal')
    expect(read.error).toContain('price is money')
  })
})

describe('links, which are written as names', () => {
  const INGREDIENT = format('ingredient', [
    column('name', 'text', { required: true }),
    column('kcal', 'integer'),
  ])
  const LINE = format('line', [
    column('what', 'text', { required: true }),
    column('ingredient', 'link', { target: 'ingredient' }),
  ])

  function kitchen(ingredients: readonly StoredRow[], lines: readonly StoredRow[]): DocumentContent {
    return {
      units: SEEDED_UNITS,
      formats: [
        { declaration: INGREDIENT, rows: ingredients },
        { declaration: LINE, rows: lines },
      ],
    }
  }

  it('writes the name of the row it points at, not the id', () => {
    const written = writeDocument(
      kitchen(
        [row('id-pasta', { name: 'Pasta', kcal: 350 })],
        [row('id-line', { what: 'the base', ingredient: 'id-pasta' })],
      ),
    )
    if (!written.ok) throw new Error(written.error)
    const lines = written.value.find((part) => part.name === 'line.format.md')?.text ?? ''
    expect(lines).toContain('ingredient: Pasta')
    expect(lines).not.toContain('id-pasta')
  })

  it('reads a link back as the name, leaving the id to whoever can write one', () => {
    const written = writeDocument(
      kitchen(
        [row('id-pasta', { name: 'Pasta', kcal: 350 })],
        [row('id-line', { what: 'the base', ingredient: 'id-pasta' })],
      ),
    )
    if (!written.ok) throw new Error(written.error)
    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)

    const line = read.value.formats.find((each) => each.declaration.name === 'line')
    expect(line?.rows[0]?.links).toEqual({ ingredient: 'Pasta' })
    expect(line?.rows[0]?.cells['ingredient']).toBeUndefined()
  })

  it('refuses two rows of a linked-to format with the same name', () => {
    const written = writeDocument(
      kitchen(
        [row('a', { name: 'Pasta', kcal: 350 }), row('b', { name: 'Pasta', kcal: 400 })],
        [row('c', { what: 'the base', ingredient: 'a' })],
      ),
    )
    expect(written.ok).toBe(false)
    if (written.ok) throw new Error('expected a refusal')
    expect(written.error).toContain('Two rows of ingredient have name "Pasta"')
  })

  it('refuses a linked-to format with no text column to be named by', () => {
    const NUMBERED = format('ingredient', [column('kcal', 'integer', { required: true })])
    const written = writeDocument({
      units: SEEDED_UNITS,
      formats: [
        { declaration: NUMBERED, rows: [row('a', { kcal: 1 })] },
        { declaration: LINE, rows: [row('b', { what: 'x', ingredient: 'a' })] },
      ],
    })
    expect(written.ok).toBe(false)
    if (written.ok) throw new Error('expected a refusal')
    expect(written.error).toContain('no text column')
  })

  it('refuses a link whose row is gone rather than dropping the pointer', () => {
    const written = writeDocument(
      kitchen([row('a', { name: 'Pasta', kcal: 350 })], [row('b', { what: 'x', ingredient: 'vanished' })]),
    )
    expect(written.ok).toBe(false)
    if (written.ok) throw new Error('expected a refusal')
    expect(written.error).toContain('not in the document')
  })

  it('reads a format whose link points forward, whatever order the parts are in', () => {
    const written = writeDocument(
      kitchen(
        [row('id-pasta', { name: 'Pasta', kcal: 350 })],
        [row('id-line', { what: 'the base', ingredient: 'id-pasta' })],
      ),
    )
    if (!written.ok) throw new Error(written.error)

    // Reverse the parts so `line` comes before the format it points at: every
    // declaration is checked against all of them (M29 F1, D-336), and what
    // comes back is in link order whatever order the parts were in.
    const read = readDocument([...written.value].reverse())
    if (!read.ok) throw new Error(read.error)
    expect(read.value.formats.map((each) => each.declaration.name)).toEqual(['ingredient', 'line'])
  })
})

describe('deterministic', () => {
  it('orders rows by name and not by the order they came in', () => {
    const rows = [row('z', { name: 'Zebra' }), row('a', { name: 'Ant' }), row('m', { name: 'Moth' })]
    const ONLY = format('creature', [column('name', 'text', { required: true })])

    const forwards = writeDocument({ units: SEEDED_UNITS, formats: [{ declaration: ONLY, rows }] })
    const backwards = writeDocument({
      units: SEEDED_UNITS,
      formats: [{ declaration: ONLY, rows: [...rows].reverse() }],
    })
    if (!forwards.ok || !backwards.ok) throw new Error('expected both to write')
    expect(forwards.value).toEqual(backwards.value)
    expect(forwards.value[0]?.text.indexOf('### Ant')).toBeLessThan(
      forwards.value[0]?.text.indexOf('### Moth') ?? 0,
    )
  })

  it('orders formats by name and not by the order they were declared', () => {
    const a: FormatContent = { declaration: format('apple', [column('name', 'text')]), rows: [] }
    const z: FormatContent = { declaration: format('zebra', [column('name', 'text')]), rows: [] }

    const one = writeDocument({ units: SEEDED_UNITS, formats: [z, a] })
    if (!one.ok) throw new Error(one.error)
    expect(one.value.map((part) => part.name)).toEqual(['apple.format.md', 'zebra.format.md'])
  })

  it('writes the same bytes from a document it read, whatever ids it is given', () => {
    const { first, second } = roundTrip({
      units: SEEDED_UNITS,
      formats: [
        {
          declaration: NOTE,
          rows: [
            row('whatever', { name: 'one', body: 'a\nb', rating: 3, ratio: 0.25, seen: '2026-01-02', kept: 0, mood: 'bad' }),
            row('else', { name: 'two', body: null, rating: null, ratio: null, seen: null, kept: 1, mood: null }),
          ],
        },
      ],
    })
    expect(second).toBe(first)
  })
})

describe('the units', () => {
  it('writes no units part when the document has the ones it was seeded with', () => {
    const written = writeDocument({ units: SEEDED_UNITS, formats: [{ declaration: NOTE, rows: [] }] })
    if (!written.ok) throw new Error(written.error)
    expect(written.value.map((part) => part.name)).toEqual(['note.format.md'])
  })

  it('writes them all the moment one is added or corrected', () => {
    const slice: UnitRow = { symbol: 'slice', dimension: 'COUNT', perBase: 1, origin: 'USER', note: 'Of bread.' }
    const units: UnitTable = [...SEEDED_UNITS, slice]

    const written = writeDocument({ units, formats: [{ declaration: NOTE, rows: [] }] })
    if (!written.ok) throw new Error(written.error)
    expect(written.value[0]?.name).toBe('units.md')

    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.units).toHaveLength(SEEDED_UNITS.length + 1)
    expect(read.value.units.find((each) => each.symbol === 'slice')).toEqual(slice)
  })

  it('carries a corrected factor, which is the whole reason it is written at all', () => {
    // A 20 ml tablespoon. Dropping this on the way back would change every
    // recipe measured in them by a fifth, silently (D-223).
    const units = SEEDED_UNITS.map((unit) =>
      unit.symbol === 'tbsp' ? { ...unit, perBase: 20, note: 'In this kitchen.' } : unit,
    )
    const written = writeDocument({ units, formats: [{ declaration: NOTE, rows: [] }] })
    if (!written.ok) throw new Error(written.error)

    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.units.find((each) => each.symbol === 'tbsp')?.perBase).toBe(20)
  })
})

describe('what it refuses', () => {
  it('refuses a key the format does not declare rather than dropping it', () => {
    const written = writeFormat(NOTE, [row('1', { name: 'x' })], new Map())
    if (!written.ok) throw new Error(written.error)

    const read = readFormat(`${written.value}protein: 12\n`)
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error('expected a refusal')
    expect(read.error).toContain('note has no protein')
  })

  it('refuses a row whose name is written twice', () => {
    const written = writeFormat(NOTE, [row('1', { name: 'x' })], new Map())
    if (!written.ok) throw new Error(written.error)

    const read = readFormat(`${written.value}name: x\n`)
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error('expected a refusal')
    expect(read.error).toContain('### heading')
  })

  it('refuses a value that breaks the declaration, the same way a tool does', () => {
    const written = writeFormat(NOTE, [row('1', { name: 'x', rating: 3 })], new Map())
    if (!written.ok) throw new Error(written.error)

    const read = readFormat(written.value.replace('rating: 3', 'rating: 9'))
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error('expected a refusal')
    expect(read.error).toContain('above its maximum')
  })

  it('refuses a declaration whose notes contain the line that separates the rows', () => {
    const written = writeFormat(format('note', [column('name', 'text')], { notes: '## rows' }), [], new Map())
    expect(written.ok).toBe(false)
    if (written.ok) throw new Error('expected a refusal')
    expect(written.error).toContain('Reword it')
  })

  it('refuses text with no rows line at all', () => {
    const read = readFormat('---\nformat: note\ntitle: note\nlanguage: 4\n---\n')
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error('expected a refusal')
    expect(read.error).toContain('## rows')
  })
})

describe('the parts, folded into one text', () => {
  it('splits back into exactly what was folded', () => {
    const written = writeDocument({
      units: SEEDED_UNITS,
      formats: [
        { declaration: NOTE, rows: [row('1', { name: 'one' })] },
        { declaration: format('other', [column('name', 'text')]), rows: [] },
      ],
    })
    if (!written.ok) throw new Error(written.error)

    const joined = joinParts(written.value)
    if (!joined.ok) throw new Error(joined.error)
    const split = splitParts(joined.value)
    if (!split.ok) throw new Error(split.error)
    expect(split.value).toEqual(written.value)
  })

  it('refuses to fold a part that already contains the separator', () => {
    const joined = joinParts([{ name: 'a.md', text: '<!-- emerald: b.md -->\n' }])
    expect(joined.ok).toBe(false)
    if (joined.ok) throw new Error('expected a refusal')
    expect(joined.error).toContain('Reword it')
  })

  it('refuses a text holding no parts', () => {
    const split = splitParts('just some markdown\n')
    expect(split.ok).toBe(false)
  })
})

describe('the money helper the serializer needed', () => {
  it('is the exact inverse of the one that writes it', async () => {
    const { fromDecimalString, toDecimalString } = await import('@/core/money.ts')
    for (const minor of [0, 1, -1, 999, -42105, 1234567, 90071992547409]) {
      for (const currency of ['ILS', 'JPY', 'KWD']) {
        const amount = money(minor, currency)
        expect(fromDecimalString(toDecimalString(amount), currency)).toEqual(amount)
      }
    }
  })
})

describe('a decimal, a month and a moment (M24 U6, D-257)', () => {
  const FEE: FormatDeclaration = {
    ...format('fee', [
      column('fund', 'text', { required: true }),
      column('rate', 'decimal', { scale: 4, unit: '%' }),
      column('period', 'month'),
      column('read_at', 'instant'),
    ]),
    language: 6,
  }

  it('writes the figure rather than the integer it is stored as, and reads back the integer', () => {
    const content: DocumentContent = {
      units: SEEDED_UNITS,
      formats: [
        {
          declaration: FEE,
          rows: [
            row('1', { fund: 'Index', rate: 3500, period: '2026-09', read_at: '2026-09-23T14:05:00.000Z' }),
            row('2', { fund: 'Bond', rate: -12, period: null, read_at: null }),
          ],
        },
      ],
    }
    const written = writeDocument(content)
    if (!written.ok) throw new Error(written.error)
    const text = written.value.map((part) => part.text).join('\n')
    expect(text).toContain('rate: 0.3500')
    expect(text).toContain('rate: -0.0012')
    expect(text).toContain('| rate | decimal |  | % |  | 4 |')
    // The seeded ratio units are the seed, so no units part is written.
    expect(written.value.some((part) => part.name === 'units.md')).toBe(false)

    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)
    const rows = read.value.formats[0]?.rows ?? []
    expect(rows.map((each) => each.cells['rate']).sort()).toEqual([-12, 3500])
    expect(rows.find((each) => each.cells['fund'] === 'Index')?.cells['read_at']).toBe(
      '2026-09-23T14:05:00.000Z',
    )
    expect(read.value.formats[0]?.declaration.columns[1]?.scale).toBe(4)
  })
})
