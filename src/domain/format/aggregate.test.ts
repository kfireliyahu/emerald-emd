import { describe, expect, it } from 'vitest'

import {
  aggregate,
  aggregateSentence,
  AGGREGATE_KINDS,
  evaluateAggregate,
  filterText,
  inputsWithTotals,
  namesUsedBy,
  overText,
  parseFilter,
  type AggregateKind,
  type OrderedInputs,
} from './aggregate.ts'
import { evaluateIdentity, identity, type IdentityInputs } from './identity.ts'
import { SEEDED_UNITS } from './unit.ts'

function row(
  numbers: Record<string, number>,
  extra: { id?: string; units?: Record<string, string>; per?: Record<string, string> } = {},
): IdentityInputs {
  return {
    ...(extra.id === undefined ? {} : { id: extra.id }),
    numbers: new Map(Object.entries(numbers)),
    currencies: new Map(),
    units: new Map(Object.entries(extra.units ?? {})),
    per: new Map(Object.entries(extra.per ?? {})),
  }
}

/** A recipe line: an amount, and the ingredient's per-100g figure one hop out. */
function line(amount: number, kcal: number, id?: string): IdentityInputs {
  return row(
    { amount_g: amount, 'ingredient.kcal': kcal },
    { ...(id === undefined ? {} : { id }), units: { amount_g: 'g', 'ingredient.kcal': 'kcal' } },
  )
}

const TOTAL = aggregate(
  'total_kcal',
  'SUM',
  { format: 'recipe_line', column: 'recipe' },
  { expression: 'amount_g / 100 * ingredient.kcal', unit: 'kcal' },
)

describe('folding', () => {
  /**
   * **The case D-210 moved the engine's line to permit.** Three lines, each an
   * amount times an ingredient's per-100g figure, summed — which the
   * vault (D-210) does by hand, in prose, from figures kept on other notes.
   */
  it('sums an expression that reaches one hop through a link', () => {
    const value = evaluateAggregate(TOTAL, [line(200, 352), line(150, 89), line(50, 717)])
    expect(value.kind).toBe('VALUE')
    if (value.kind !== 'VALUE') return
    expect(Math.round(value.value * 100) / 100).toBe(1196)
    expect(value.unit).toBe('kcal')
    expect(value.rows).toBe(3)
  })

  it('counts rows without an expression, and says nothing about a unit', () => {
    const counting = aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'recipe' })
    const value = evaluateAggregate(counting, [line(200, 352), line(150, 89)])
    expect(value).toEqual({ kind: 'VALUE', value: 2, unit: undefined, rows: 2 })
  })

  it('takes the least and the most and the mean of what it folded', () => {
    const rows = [line(100, 100), line(100, 300), line(100, 200)]
    const of = (kind: AggregateKind): unknown =>
      evaluateAggregate({ ...TOTAL, kind, name: 'x' }, rows)
    expect(of('MINIMUM')).toMatchObject({ value: 100 })
    expect(of('MAXIMUM')).toMatchObject({ value: 300 })
    expect(of('AVERAGE')).toMatchObject({ value: 200 })
  })

  it('converts inside the fold, where U4a left the conversion', () => {
    const inKilos = aggregate(
      'weight_g',
      'SUM',
      { format: 'recipe_line', column: 'recipe' },
      { expression: 'pack in g', unit: 'g' },
    )
    const rows = [
      row({ pack: 1.5 }, { units: { pack: 'kg' } }),
      row({ pack: 250 }, { units: { pack: 'g' } }),
    ]
    // 1.5 kg and 250 g, both converted to grams and summed. **The evaluator
    // already takes a unit per row** — what has no per-row unit is the
    // *storage*, where a declared column is in one thing for every row, and
    // that is what U4c is for.
    expect(evaluateAggregate(inKilos, rows, SEEDED_UNITS)).toMatchObject({ value: 1750 })
  })
})

/**
 * **A sum that skipped a row is not a smaller sum, it is a wrong one.**
 *
 * This is D-138 in the one place where the alternative looks most reasonable: a
 * recipe total that quietly omitted the line with no figure on it would arrive
 * as a number a person then believes. The tenth instance.
 */
describe('a row that cannot answer', () => {
  it('makes the whole fold unchecked, and names the row', () => {
    const value = evaluateAggregate(TOTAL, [
      line(200, 352, 'row-1'),
      row({ amount_g: 150 }, { id: 'row-2', units: { amount_g: 'g' } }),
    ])
    expect(value.kind).toBe('UNCHECKED')
    if (value.kind !== 'UNCHECKED') return
    expect(value.reason).toContain('row-2')
    expect(value.reason).toContain('ingredient.kcal')
    expect(value.reason).toContain('smaller number and not a truer one')
  })

  it('names the position when the caller had no id to give', () => {
    const value = evaluateAggregate(TOTAL, [line(200, 352), row({ amount_g: 150 })])
    expect(value.kind === 'UNCHECKED' && value.reason).toContain('Row 2')
  })

  it('is unchecked when the expression does not parse', () => {
    const broken = { ...TOTAL, expression: '4 amount_g' }
    expect(evaluateAggregate(broken, [line(200, 352)]).kind).toBe('UNCHECKED')
  })
})

describe('nothing to fold', () => {
  /**
   * A recipe with no lines really has no kilocalories: the figure is zero, and
   * a claim over it has nothing to prove yet (D-465). But there is no least
   * member of nothing.
   */
  it('sums to zero, because a sum of nothing is zero', () => {
    expect(evaluateAggregate(TOTAL, [])).toEqual({
      kind: 'VALUE',
      value: 0,
      unit: 'kcal',
      rows: 0,
      nothingToProve: 'No row of recipe_line points at this one, so total_kcal adds up nothing yet and there is nothing to prove.',
    })
  })

  /**
   * **A claim over a sum nothing points at is `unchecked`, not failed** (M33
   * F7, D-465): a paycheck month before the timesheet was kept has no hours to
   * fail against. One that holds over zero is proved, and rows that point here
   * but that a filter takes none of are a real zero, judged like any other.
   */
  it('leaves a claim over a sum of no rows unchecked, unless it holds', () => {
    const claim = identity('kcal', 'total_kcal = printed')
    const over = (rows: readonly IdentityInputs[], printed: number) =>
      evaluateIdentity(
        claim,
        inputsWithTotals({ numbers: new Map([['printed', printed]]), currencies: new Map() }, [
          { aggregate: TOTAL, value: evaluateAggregate(TOTAL, rows) },
        ]),
      )
    expect(over([], 300)).toEqual({
      kind: 'UNCHECKED',
      reason: 'No row of recipe_line points at this one, so total_kcal adds up nothing yet and there is nothing to prove.',
    })
    expect(over([], 0).kind).toBe('PROVED')

    const refunds = aggregate(
      'refunds',
      'SUM',
      { format: 'recipe_line', column: 'recipe' },
      { expression: 'amount_g', where: { column: 'kind', is: 'refund' } },
    )
    const line: IdentityInputs = {
      numbers: new Map([['amount_g', 5]]),
      currencies: new Map(),
      members: new Map([['kind', 'sale']]),
    }
    expect(evaluateAggregate(refunds, [line])).toEqual({ kind: 'VALUE', value: 0, unit: undefined, rows: 0 })
  })

  it('counts to zero', () => {
    const counting = aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'recipe' })
    expect(evaluateAggregate(counting, [])).toMatchObject({ value: 0 })
  })

  it('will not name a minimum, a maximum or a mean of nothing', () => {
    for (const kind of ['MINIMUM', 'MAXIMUM', 'AVERAGE'] as const) {
      const value = evaluateAggregate({ ...TOTAL, kind }, [])
      expect(value.kind, kind).toBe('UNCHECKED')
      expect(value.kind === 'UNCHECKED' && value.reason).toContain('of nothing')
    }
  })
})

describe('saying it aloud', () => {
  it('names the figure, its unit and how many rows went into it', () => {
    const value = evaluateAggregate(TOTAL, [line(200, 352), line(150, 89)])
    const sentence = aggregateSentence(TOTAL, value)
    expect(sentence).toContain('total_kcal:')
    expect(sentence).toContain('kcal')
    expect(sentence).toContain('2 rows')
    expect(sentence).toContain('recipe_line')
  })

  it('trims the arithmetic to something a person would read', () => {
    // A sum over reals lands on 2139.9999999999995 often enough that printing
    // it would make every total look like a bug rather than a fact.
    const value = evaluateAggregate(TOTAL, [line(100, 0.1), line(100, 0.2)])
    expect(aggregateSentence(TOTAL, value)).not.toContain('0000000')
  })

  it('says unchecked with the reason, and never a number beside it', () => {
    const value = evaluateAggregate(TOTAL, [row({ amount_g: 1 }, { id: 'r' })])
    expect(aggregateSentence(TOTAL, value)).toContain('total_kcal: unchecked')
  })
})

describe('the kinds', () => {
  it('are five folds and two picks, and each one a person can check by hand', () => {
    // No MEDIAN and no DISTINCT. The two picks read one row by an order of the
    // rows already gathered (M25 E3, D-272) — no traversal, which D-209 drew.
    expect([...AGGREGATE_KINDS]).toEqual([
      'SUM',
      'COUNT',
      'AVERAGE',
      'MINIMUM',
      'MAXIMUM',
      'LATEST',
      'EARLIEST',
    ])
  })
})

/**
 * **The recipe, in the units a recipe is actually written in** (U4c, D-225).
 *
 * This is what U4a, U4b and U4c were each a third of: lines measured in grams,
 * millilitres and eggs, totalled in grams, through facts that live on the
 * ingredients rather than in the app.
 */
describe('a total over lines that are not in one unit', () => {
  /** One line: a quantity whose unit is this row's, and the ingredient's bridge. */
  function measured(
    amount: number,
    unit: string,
    bridge: { amount: number; unit: string; per: string },
    id?: string,
  ): IdentityInputs {
    return row(
      { amount, 'ingredient.density': bridge.amount },
      {
        ...(id === undefined ? {} : { id }),
        units: { amount: unit, 'ingredient.density': bridge.unit },
        per: { 'ingredient.density': bridge.per },
      },
    )
  }

  const WEIGHT = aggregate(
    'total_g',
    'SUM',
    { format: 'recipe_line', column: 'recipe' },
    { expression: 'amount in g via ingredient.density', unit: 'g' },
  )

  const WATER = { amount: 1, unit: 'g', per: 'ml' } as const
  const OIL = { amount: 0.92, unit: 'g', per: 'ml' } as const
  const EGG = { amount: 60, unit: 'g', per: 'each' } as const

  it('adds grams, millilitres and eggs into one weight', () => {
    const value = evaluateAggregate(WEIGHT, [
      measured(150, 'g', WATER),
      measured(200, 'ml', WATER),
      measured(2, 'each', EGG),
      measured(30, 'ml', OIL),
    ])

    // 150 + 200 + 120 + 27.6
    expect(value.kind).toBe('VALUE')
    expect(value.kind === 'VALUE' && value.value).toBeCloseTo(497.6, 6)
    expect(value.kind === 'VALUE' && value.rows).toBe(4)
  })

  it('does not need a density on a line that is already in grams', () => {
    // **The property the whole type hangs off.** Salt has no density recorded
    // and the line is in grams, so nothing about it is missing — and a fold
    // that demanded the fact anyway would take the whole recipe down.
    const value = evaluateAggregate(WEIGHT, [
      measured(150, 'ml', WATER),
      row({ amount: 5 }, { units: { amount: 'g' } }),
    ])

    expect(value.kind === 'VALUE' && value.value).toBeCloseTo(155, 6)
  })

  it('is unchecked in whole, naming the line, when one line cannot be crossed', () => {
    // D-138 for the eleventh time: a total that quietly left out the oil is a
    // smaller number and not a truer one.
    const value = evaluateAggregate(WEIGHT, [
      measured(150, 'g', WATER, 'line-1'),
      row({ amount: 30 }, { id: 'line-2', units: { amount: 'ml' } }),
    ])

    expect(value.kind).toBe('UNCHECKED')
    expect(value.kind === 'UNCHECKED' && value.reason).toContain('line-2')
    expect(value.kind === 'UNCHECKED' && value.reason).toContain('smaller number')
  })
})

/* --------------------------------------------- only the rows that match (U8) */

describe('an aggregate over only the rows that match (M24 U8, D-260)', () => {
  const OUTFLOWS = aggregate(
    'spent',
    'SUM',
    { format: 'transaction', column: 'account' },
    { expression: 'amount', where: { column: 'direction', is: 'OUTFLOW' } },
  )

  function movement(amount: number, direction: string | undefined, id?: string): IdentityInputs {
    return {
      ...row({ amount }, id === undefined ? {} : { id }),
      members: new Map(direction === undefined ? [] : [['direction', direction]]),
    }
  }

  it('reads one sentence, and nothing that combines', () => {
    expect(parseFilter('deduction_type.reduces_net is true')).toEqual({
      column: 'deduction_type.reduces_net',
      is: 'true',
    })
    expect(parseFilter(' direction is OUTFLOW ')).toEqual({ column: 'direction', is: 'OUTFLOW' })
    expect(parseFilter('direction is OUTFLOW or INFLOW')).toHaveProperty('problem')
    expect(parseFilter('direction = OUTFLOW')).toHaveProperty('problem')
    expect(filterText({ column: 'direction', is: 'OUTFLOW' })).toBe('direction is OUTFLOW')
  })

  it('folds the rows whose member matches and leaves the others out', () => {
    const rows = [movement(-120, 'OUTFLOW'), movement(3000, 'INFLOW'), movement(-80, 'OUTFLOW')]
    expect(evaluateAggregate(OUTFLOWS, rows)).toEqual({
      kind: 'VALUE',
      value: -200,
      unit: undefined,
      rows: 2,
    })
    const counted = aggregate('outflows', 'COUNT', OUTFLOWS.over, { where: OUTFLOWS.where })
    expect(evaluateAggregate(counted, rows)).toMatchObject({ value: 2, rows: 2 })
  })

  it('refuses the whole fold when a row has nothing in the filter column, and names it', () => {
    const value = evaluateAggregate(OUTFLOWS, [movement(-120, 'OUTFLOW'), movement(50, undefined, 'r2')])
    expect(value.kind).toBe('UNCHECKED')
    expect(value).toMatchObject({
      reason: expect.stringContaining('Row r2 of transaction has nothing in direction') as unknown,
    })
  })

  it('sums nothing to zero when no row matches, and has no least member of nothing', () => {
    const inflows = [movement(3000, 'INFLOW')]
    expect(evaluateAggregate(OUTFLOWS, inflows)).toMatchObject({ kind: 'VALUE', value: 0, rows: 0 })
    const least = aggregate('smallest', 'MINIMUM', OUTFLOWS.over, {
      expression: 'amount',
      where: OUTFLOWS.where,
    })
    expect(evaluateAggregate(least, inflows)).toMatchObject({
      kind: 'UNCHECKED',
      reason: expect.stringContaining('No row of transaction where direction is OUTFLOW') as unknown,
    })
  })

  it('says which rows it folded when it says what it came to', () => {
    const value = evaluateAggregate(OUTFLOWS, [movement(-120, 'OUTFLOW')])
    expect(aggregateSentence(OUTFLOWS, value)).toBe(
      'spent: -120 — the sum over 1 row of transaction where direction is OUTFLOW.',
    )
  })

  it('names the filter column among what it reaches for', () => {
    expect(namesUsedBy(OUTFLOWS)).toEqual(['amount', 'direction'])
  })
})

describe('not, empty and one of (M36 U04, D-380)', () => {
  function movement(amount: number, kind: string | undefined, extra: { id?: string; filled?: string[] } = {}): IdentityInputs {
    return {
      ...row({ amount }, extra.id === undefined ? {} : { id: extra.id }),
      members: new Map(kind === undefined ? [] : [['category.kind', kind]]),
      filled: new Set(extra.filled ?? []),
    }
  }
  const over = { format: 'transaction', column: 'account' }
  const where = (text: string) => {
    const parsed = parseFilter(text)
    if ('problem' in parsed) throw new Error(parsed.problem)
    return parsed
  }

  it('reads five spellings of one column, and writes each back as it was said', () => {
    expect(parseFilter('category.kind is not TRANSFER')).toEqual({ column: 'category.kind', is: 'TRANSFER', not: true })
    expect(parseFilter('kind is one of TAX,  HEALTH ,SOCIAL_INSURANCE')).toEqual({
      column: 'kind',
      is: 'TAX',
      oneOf: ['TAX', 'HEALTH', 'SOCIAL_INSURANCE'],
    })
    expect(parseFilter('kind is not one of TRANSFER, SAVING')).toEqual({
      column: 'kind',
      is: 'TRANSFER',
      not: true,
      oneOf: ['TRANSFER', 'SAVING'],
    })
    expect(parseFilter('holding is empty')).toEqual({ column: 'holding', is: 'empty' })
    expect(parseFilter('employer is not empty')).toEqual({ column: 'employer', is: 'empty', not: true })
    for (const text of [
      'kind is not one of TRANSFER, SAVING',
      'kind is one of TAX, HEALTH',
      'category.kind is not TRANSFER',
      'holding is empty',
      'employer is not empty',
    ]) {
      expect(filterText(where(text))).toBe(text)
    }
    expect(parseFilter('kind is one of TAX, TAX')).toHaveProperty('problem')
    expect(parseFilter('kind is TAX or HEALTH')).toHaveProperty('problem')
  })

  it('takes members with spaces, split on the commas or quoted alone, and says what it could not read (M48 U1)', () => {
    expect(parseFilter('status is one of Planned, In progress')).toEqual({
      column: 'status',
      is: 'Planned',
      oneOf: ['Planned', 'In progress'],
    })
    expect(parseFilter('status is "In progress"')).toEqual({ column: 'status', is: 'In progress' })
    expect(parseFilter('status is not "In progress"')).toEqual({ column: 'status', is: 'In progress', not: true })
    expect(parseFilter('label is one of "Rent, utilities", Food')).toEqual({
      column: 'label',
      is: 'Rent, utilities',
      oneOf: ['Rent, utilities', 'Food'],
    })
    for (const text of [
      'status is one of Planned, In progress',
      'status is "In progress"',
      'status is not "In progress"',
      'label is one of "Rent, utilities", Food',
    ]) {
      expect(filterText(where(text))).toBe(text)
    }
    const problem = (text: string): string => {
      const parsed = parseFilter(text)
      return 'problem' in parsed ? parsed.problem : ''
    }
    expect(problem('status is In progress')).toContain('"In progress" is more than one word')
    expect(problem('status is In progress')).toContain('`is "In progress"`')
    expect(problem('status = Planned')).toContain('it has no `is`')
    expect(problem('my status is Planned')).toContain('"my status" is not a column')
    expect(problem('status is "In progress')).toContain('does not close')
    expect(problem('status is one of Planned, , Done')).toContain('empty member')
  })

  it('lets an empty cell through `is not` — an uncategorised row is not a transfer', () => {
    const spent = aggregate('spent', 'SUM', over, { expression: 'amount', where: where('category.kind is not one of TRANSFER, SAVING') })
    const rows = [movement(-100, 'EXPENSE'), movement(-40, 'TRANSFER'), movement(-7, undefined), movement(-3, 'SAVING')]
    expect(evaluateAggregate(spent, rows)).toMatchObject({ kind: 'VALUE', value: -107, rows: 2 })
  })

  it('takes any member of a set, and still refuses an empty cell it cannot place', () => {
    const tax = aggregate('tax', 'SUM', over, { expression: 'amount', where: where('category.kind is one of TAX, HEALTH') })
    expect(evaluateAggregate(tax, [movement(10, 'TAX'), movement(5, 'HEALTH'), movement(99, 'PENSION')])).toMatchObject({
      value: 15,
      rows: 2,
    })
    expect(evaluateAggregate(tax, [movement(10, 'TAX'), movement(5, undefined, { id: 'r2' })])).toMatchObject({
      kind: 'UNCHECKED',
      reason: expect.stringContaining('Row r2 of transaction has nothing in category.kind') as unknown,
    })
  })

  it('asks whether a cell holds anything, of any type, and decides every row', () => {
    const paid = aggregate('paid', 'COUNT', over, { where: where('employer is not empty') })
    const empty = aggregate('none', 'COUNT', over, { where: where('employer is empty') })
    const rows = [movement(1, undefined, { filled: ['employer'] }), movement(2, undefined), movement(3, 'X', { filled: ['employer'] })]
    expect(evaluateAggregate(paid, rows)).toMatchObject({ kind: 'VALUE', value: 2 })
    expect(evaluateAggregate(empty, rows)).toMatchObject({ kind: 'VALUE', value: 1 })
  })
})

/**
 * **The latest by an order** (M25 E3, D-272): a security's price is the one
 * from the greatest `as_of`, not a fold of all of them.
 */
describe('the latest and the earliest by an order (M25 E3, D-272)', () => {
  const PRICE = aggregate(
    'price',
    'LATEST',
    { format: 'security_price', column: 'security' },
    { expression: 'price', by: 'as_of' },
  )

  function quote(id: string, asOf: string | undefined, price?: number): OrderedInputs {
    return {
      ...row(price === undefined ? {} : { price }, { id }),
      ...(asOf === undefined ? {} : { order: asOf }),
    }
  }

  it('reads the row with the greatest order, and says which day it is from', () => {
    const rows = [quote('a', '2026-09-01', 101), quote('b', '2026-09-24', 104.5), quote('c', '2026-09-10', 99)]
    expect(evaluateAggregate(PRICE, rows)).toEqual({
      kind: 'VALUE',
      value: 104.5,
      unit: undefined,
      rows: 3,
      at: '2026-09-24',
    })
    expect(evaluateAggregate({ ...PRICE, kind: 'EARLIEST' }, rows)).toMatchObject({
      value: 101,
      at: '2026-09-01',
    })
  })

  it('orders integers as numbers, not as text', () => {
    const rows = [
      { ...row({ price: 1 }, { id: 'a' }), order: 9 },
      { ...row({ price: 2 }, { id: 'b' }), order: 10 },
    ]
    expect(evaluateAggregate(PRICE, rows)).toMatchObject({ value: 2, at: 10 })
  })

  /** Two sources on one day are two answers, and picking one is an opinion nobody declared. */
  it('refuses a tie at the top, and names the rows that tie', () => {
    const rows = [quote('a', '2026-09-24', 104), quote('b', '2026-09-24', 105), quote('c', '2026-09-01', 99)]
    const value = evaluateAggregate(PRICE, rows)
    expect(value.kind).toBe('UNCHECKED')
    if (value.kind !== 'UNCHECKED') return
    expect(value.reason).toContain('Rows a and b')
    expect(value.reason).toContain('tie at 2026-09-24')
  })

  it('does not mind a tie below the top', () => {
    const rows = [quote('a', '2026-09-01', 1), quote('b', '2026-09-01', 2), quote('c', '2026-09-24', 3)]
    expect(evaluateAggregate(PRICE, rows)).toMatchObject({ kind: 'VALUE', value: 3 })
  })

  it('is unchecked when a row has nothing in the order column, since it might be the one', () => {
    const value = evaluateAggregate(PRICE, [quote('a', '2026-09-24', 104), quote('b', undefined, 1)])
    expect(value.kind).toBe('UNCHECKED')
    if (value.kind !== 'UNCHECKED') return
    expect(value.reason).toContain('Row b')
    expect(value.reason).toContain('nothing in as_of')
  })

  it('needs only the row it picked to answer', () => {
    const rows = [quote('a', '2026-09-01'), quote('b', '2026-09-24', 104)]
    expect(evaluateAggregate(PRICE, rows)).toMatchObject({ kind: 'VALUE', value: 104 })
    const blank = evaluateAggregate(PRICE, [quote('a', '2026-09-01', 1), quote('b', '2026-09-24')])
    expect(blank.kind).toBe('UNCHECKED')
    if (blank.kind !== 'UNCHECKED') return
    expect(blank.reason).toContain('Row b of security_price is the latest by as_of')
  })

  it('has no latest of nothing', () => {
    expect(evaluateAggregate(PRICE, [])).toMatchObject({ kind: 'UNCHECKED' })
  })

  it('picks among the rows the filter takes', () => {
    const typed = { ...PRICE, where: { column: 'source', is: 'TYPED' } }
    const priced = (id: string, asOf: string, price: number, source: string): OrderedInputs => ({
      ...quote(id, asOf, price),
      members: new Map([['source', source]]),
    })
    const rows = [priced('a', '2026-09-01', 100, 'TYPED'), priced('b', '2026-09-24', 104, 'FETCHED')]
    expect(evaluateAggregate(typed, rows)).toMatchObject({ value: 100, rows: 1 })
  })

  it('reports how many rows it chose among when the caller narrowed them', () => {
    expect(evaluateAggregate(PRICE, [quote('b', '2026-09-24', 104)], SEEDED_UNITS, 340)).toMatchObject({
      rows: 340,
    })
  })

  it('says what it picked, from which day, out of how many', () => {
    const value = evaluateAggregate(PRICE, [quote('a', '2026-09-01', 1), quote('b', '2026-09-24', 104)])
    expect(aggregateSentence(PRICE, value)).toBe(
      'price: 104 — the latest of 2 rows of security_price by as_of, from 2026-09-24.',
    )
  })

  it('writes its over cell with the order before the filter, and names the order among what it reaches for', () => {
    const typed = { ...PRICE, where: { column: 'source', is: 'TYPED' } }
    expect(overText(typed)).toBe('security_price.security by as_of where source is TYPED')
    expect(namesUsedBy(PRICE)).toEqual(['price', 'as_of'])
  })
})

describe('a sum of money (M29 F7)', () => {
  const EARNED = aggregate('earned_total', 'SUM', { format: 'work_day', column: 'paycheck' }, { expression: 'earned' })
  const paid = (minor: number, currency: string, id: string): IdentityInputs => ({
    id,
    numbers: new Map([['earned', minor]]),
    currencies: new Map([['earned', currency]]),
  })

  it('keeps its currency, and says it as an amount', () => {
    const value = evaluateAggregate(EARNED, [paid(28_331, 'ILS', 'd1'), paid(28_331, 'ILS', 'd2')])
    expect(value).toEqual({ kind: 'VALUE', value: 56_662, unit: undefined, rows: 2, currency: 'ILS' })
    expect(aggregateSentence(EARNED, value)).toBe('earned_total: ₪566.62 — the sum over 2 rows of work_day.')
  })

  it('is no total when two currencies meet in it, and names the row', () => {
    const value = evaluateAggregate(EARNED, [paid(100, 'ILS', 'd1'), paid(100, 'ILS', 'd2'), paid(100, 'USD', 'd3')])
    expect(value).toEqual({
      kind: 'UNCHECKED',
      reason:
        'Row d3 of work_day is in USD and Row d1 in ILS — two currencies, and nothing here knows a rate between them, so there is no one sum.',
    })
  })

  it('is a bare zero over no rows, in nothing', () => {
    expect(evaluateAggregate(EARNED, [])).toMatchObject({ kind: 'VALUE', value: 0, unit: undefined, rows: 0 })
  })
})
