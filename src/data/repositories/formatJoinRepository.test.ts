import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { aggregate } from '@/domain/format/aggregate.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { identity } from '@/domain/format/identity.ts'
import { evaluateIdentity } from '@/domain/format/identity.ts'
import { createDatabase } from '../db/database.ts'
import { adoptFormat, listFormats } from './formatRepository.ts'
import { insertRows, listRows } from './formatRowRepository.ts'
import {
  aggregatesOf,
  indexOf,
  inputsFor,
  inputsWithAggregates,
} from './formatJoinRepository.ts'

const NOW = Date.UTC(2026, 8, 17)

/**
 * **The case D-210 moved the engine's line to permit**, built end to end:
 * ingredient ↔ recipe_line ↔ recipe, with per-serving nutrition as a sum across
 * a join. The vault does this by hand, in prose, from figures on twelve other
 * notes — and the whole claim of U4b is that a document can now do it and be
 * asked whether it adds up.
 */
function declarations(): readonly FormatDeclaration[] {
  const base = {
    language: 3,
    notes: '',
    nothingMustHold: true,
    identities: [],
    aggregates: [],
  } as const

  const ingredient: FormatDeclaration = {
    ...base,
    name: 'ingredient',
    title: 'Ingredient',
    columns: [
      column('name', 'text', { required: true }),
      column('kcal', 'real', { unit: 'kcal', note: 'per 100 g' }),
      column('pack', 'real', { unit: 'kg' }),
    ],
  }

  const recipe: FormatDeclaration = {
    ...base,
    name: 'recipe',
    title: 'Recipe',
    nothingMustHold: false,
    columns: [
      column('name', 'text', { required: true }),
      column('servings', 'integer'),
      column('printed_per_serving', 'real', { unit: 'kcal' }),
    ],
    aggregates: [
      aggregate(
        'total_kcal',
        'SUM',
        { format: 'recipe_line', column: 'recipe' },
        { expression: 'amount_g / 100 * ingredient.kcal', unit: 'kcal' },
      ),
      aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'recipe' }),
    ],
    identities: [
      identity('per_serving', 'total_kcal / servings = printed_per_serving', {
        tolerance: { kind: 'RELATIVE', percent: 2 },
        note: 'the card rounds',
      }),
    ],
  }

  const recipeLine: FormatDeclaration = {
    ...base,
    name: 'recipe_line',
    title: 'Recipe line',
    columns: [
      column('recipe', 'link', { target: 'recipe', required: true }),
      column('ingredient', 'link', { target: 'ingredient', required: true }),
      column('amount_g', 'real', { unit: 'g' }),
    ],
  }

  // `recipe` before `recipe_line` would refuse: its aggregate names a format
  // the document has not got yet. That is the ordering a person meets too, and
  // it is why the refusal names what is missing.
  return [ingredient, recipe, recipeLine]
}

async function kitchen(): Promise<{
  db: Database
  recipeId: string
  formats: ReturnType<typeof indexOf>
}> {
  const db = await createDatabase()
  const [ingredient, recipe, recipeLine] = declarations()
  if (ingredient === undefined || recipe === undefined || recipeLine === undefined) {
    throw new Error('declarations')
  }

  // The line format first, so the recipe's aggregate has something to name.
  expect(adoptFormat(db, ingredient, NOW).refusals).toEqual([])
  expect(adoptFormat(db, recipeLine, NOW).refusals).toEqual([])
  expect(adoptFormat(db, recipe, NOW).refusals).toEqual([])

  const [pasta, oil] = insertRows(db, ingredient, [
    { name: 'Pasta', kcal: 352, pack: 0.5 },
    { name: 'Olive oil', kcal: 884, pack: 1 },
  ])
  const [recipeId] = insertRows(db, recipe, [
    { name: 'Aglio e olio', servings: 4, printed_per_serving: 450 },
  ])
  if (pasta === undefined || oil === undefined || recipeId === undefined) throw new Error('rows')

  insertRows(db, recipeLine, [
    { recipe: recipeId, ingredient: pasta, amount_g: 400 },
    { recipe: recipeId, ingredient: oil, amount_g: 45 },
  ])

  return { db, recipeId, formats: indexOf(listFormats(db)) }
}

describe('one hop through a link', () => {
  it('reaches a column of the row a link names', async () => {
    const { db, formats } = await kitchen()
    const lines = formats.get('recipe_line')
    if (lines === undefined) throw new Error('recipe_line')

    const inputs = inputsFor(db, lines, listRows(db, lines), formats)
    expect(inputs).toHaveLength(2)
    // **Sorted rather than indexed.** `listRows` orders by the row id, which is
    // generated and not counted, so "the first line" is not a thing a test may
    // assume — and assuming it is what made this one pass and the next one
    // fail on the same data.
    expect(inputs.map((each) => each.numbers.get('ingredient.kcal')).sort()).toEqual([352, 884])
  })

  it('carries the linked column’s unit with it, so a conversion still works', async () => {
    const { db, formats } = await kitchen()
    const lines = formats.get('recipe_line')
    if (lines === undefined) throw new Error('recipe_line')

    const inputs = inputsFor(db, lines, listRows(db, lines), formats)
    const pastaLine = inputs.find((each) => each.numbers.get('ingredient.kcal') === 352)
    expect(pastaLine?.units?.get('ingredient.pack')).toBe('kg')
    // The pasta pack is 0.5 kg, and the identity asks for it in grams.
    const converts = identity('packed', 'ingredient.pack in g = 500')
    expect(evaluateIdentity(converts, pastaLine ?? never()).kind).toBe('PROVED')
  })

  it('does not ask the database once per row', async () => {
    // The batch fetches the distinct ids in one `IN (…)`. Two lines using one
    // ingredient twice is one lookup, not two — which is the difference
    // between a vault and a spinner.
    const { db, formats } = await kitchen()
    const lines = formats.get('recipe_line')
    const recipeLine = formats.get('recipe_line')
    if (lines === undefined || recipeLine === undefined) throw new Error('recipe_line')

    const rows = listRows(db, lines)
    const inputs = inputsFor(db, recipeLine, rows, formats)
    expect(inputs.every((each) => each.numbers.has('ingredient.kcal'))).toBe(true)
  })
})

describe('an aggregate across one', () => {
  /** 400 g of pasta at 352 and 45 g of oil at 884 — 1,408 + 397.8. */
  it('sums the rows that point at this one', async () => {
    const { db, recipeId, formats } = await kitchen()
    const recipe = formats.get('recipe')
    if (recipe === undefined) throw new Error('recipe')
    const row = listRows(db, recipe)[0]
    if (row === undefined) throw new Error('row')

    const folded = aggregatesOf(db, recipe, row, formats)
    const total = folded.find((each) => each.aggregate.name === 'total_kcal')?.value
    expect(total?.kind).toBe('VALUE')
    if (total?.kind !== 'VALUE') return
    expect(Math.round(total.value * 10) / 10).toBe(1805.8)
    expect(total.rows).toBe(2)
    expect(recipeId).not.toBe('')
  })

  it('counts them too', async () => {
    const { db, formats } = await kitchen()
    const recipe = formats.get('recipe')
    if (recipe === undefined) throw new Error('recipe')
    const row = listRows(db, recipe)[0]
    if (row === undefined) throw new Error('row')
    const lines = aggregatesOf(db, recipe, row, formats).find(
      (each) => each.aggregate.name === 'lines',
    )
    expect(lines?.value).toMatchObject({ value: 2 })
  })

  /**
   * **This is the sentence the whole unit exists for.** A figure worked out
   * across a link, named by an identity, and judged against what the recipe
   * card printed. 1805.8 / 4 is 451.5 against a printed 450, inside 2%.
   */
  it('is a figure an identity can be written about', async () => {
    const { db, formats } = await kitchen()
    const recipe = formats.get('recipe')
    if (recipe === undefined) throw new Error('recipe')
    const row = listRows(db, recipe)[0]
    if (row === undefined) throw new Error('row')

    const inputs = inputsWithAggregates(db, recipe, row, formats)
    expect(inputs.numbers.get('total_kcal')).toBeDefined()
    const verdict = evaluateIdentity(recipe.identities[0] ?? never(), inputs)
    expect(verdict.kind).toBe('PROVED')
  })

  it('fails that identity when the printed figure disagrees', async () => {
    const { db, formats } = await kitchen()
    const recipe = formats.get('recipe')
    if (recipe === undefined) throw new Error('recipe')
    const row = listRows(db, recipe)[0]
    if (row === undefined) throw new Error('row')

    const wrong = { ...recipe, identities: [identity('per_serving', 'total_kcal / servings = 300')] }
    const inputs = inputsWithAggregates(db, wrong, row, formats)
    expect(evaluateIdentity(wrong.identities[0] ?? never(), inputs).kind).toBe('FAILED')
  })

  it('folds to zero for a recipe with no lines, and the identity has nothing to prove (D-465)', async () => {
    const { db, formats } = await kitchen()
    const recipe = formats.get('recipe')
    if (recipe === undefined) throw new Error('recipe')
    const [empty] = insertRows(db, recipe, [
      { name: 'Nothing yet', servings: 2, printed_per_serving: 300 },
    ])
    const row = listRows(db, recipe).find((each) => each.id === empty)
    if (row === undefined) throw new Error('row')

    const inputs = inputsWithAggregates(db, recipe, row, indexOf(listFormats(db)))
    expect(inputs.numbers.get('total_kcal')).toBe(0)
    expect(evaluateIdentity(recipe.identities[0] ?? never(), inputs)).toEqual({
      kind: 'UNCHECKED',
      reason: 'No row of recipe_line points at this one, so total_kcal adds up nothing yet and there is nothing to prove.',
    })
  })

  /**
   * **A sum that skipped a row is not a smaller sum** (D-138, the tenth time).
   * One line with no amount makes the whole total `unchecked`, and the identity
   * naming it goes `unchecked` too rather than proving against a number that
   * quietly lost a line.
   */
  it('refuses to fold at all when one row cannot answer', async () => {
    const { db, recipeId, formats } = await kitchen()
    const recipe = formats.get('recipe')
    const lines = formats.get('recipe_line')
    if (recipe === undefined || lines === undefined) throw new Error('formats')

    const [ingredientId] = listRows(db, formats.get('ingredient') ?? never()).map((each) => each.id)
    insertRows(db, lines, [{ recipe: recipeId, ingredient: ingredientId ?? '', amount_g: null }])

    const row = listRows(db, recipe)[0]
    if (row === undefined) throw new Error('row')
    const total = aggregatesOf(db, recipe, row, formats).find(
      (each) => each.aggregate.name === 'total_kcal',
    )?.value
    expect(total?.kind).toBe('UNCHECKED')
    expect(total?.kind === 'UNCHECKED' && total.reason).toContain('amount_g')

    const inputs = inputsWithAggregates(db, recipe, row, formats)
    expect(inputs.numbers.has('total_kcal')).toBe(false)
    expect(evaluateIdentity(recipe.identities[0] ?? never(), inputs).kind).toBe('UNCHECKED')
  })
})

function never(): never {
  throw new Error('expected a value')
}

/**
 * **The recipe in the units a recipe is written in** (U4c, D-225).
 *
 * The same three formats, with the line's amount as a `quantity` and the
 * density on the ingredient. This is the whole of what U4a, U4b and U4c were
 * each a third of, running through a real document: two tables, a join, a
 * per-row unit and a fact the app does not know.
 */
describe('a total over lines that are not in one unit', () => {
  async function measuredKitchen(): Promise<{
    db: Database
    recipeId: string
    formats: ReturnType<typeof indexOf>
    recipe: FormatDeclaration
  }> {
    const base = { language: 4, notes: '', nothingMustHold: true, identities: [], aggregates: [] } as const

    const ingredient: FormatDeclaration = {
      ...base,
      name: 'ingredient',
      title: 'Ingredient',
      columns: [
        column('name', 'text', { required: true }),
        // The fact the engine will never know, in the place it belongs: a
        // column of the thing it is a fact about.
        column('density', 'real', { unit: 'g', per: 'ml' }),
      ],
    }

    const recipeLine: FormatDeclaration = {
      ...base,
      name: 'recipe_line',
      title: 'Recipe line',
      columns: [
        column('recipe', 'link', { target: 'recipe', required: true }),
        column('ingredient', 'link', { target: 'ingredient', required: true }),
        column('amount', 'quantity', { required: true }),
      ],
    }

    const recipe: FormatDeclaration = {
      ...base,
      name: 'recipe',
      title: 'Recipe',
      nothingMustHold: false,
      columns: [column('name', 'text', { required: true }), column('printed_g', 'real', { unit: 'g' })],
      aggregates: [
        aggregate(
          'total_g',
          'SUM',
          { format: 'recipe_line', column: 'recipe' },
          { expression: 'amount in g via ingredient.density', unit: 'g' },
        ),
      ],
      identities: [
        identity('weighs', 'total_g = printed_g', { tolerance: { kind: 'ABSOLUTE', amount: 1 } }),
      ],
    }

    const db = await createDatabase()
    expect(adoptFormat(db, ingredient, NOW).refusals).toEqual([])
    expect(adoptFormat(db, recipeLine, NOW).refusals).toEqual([])
    expect(adoptFormat(db, recipe, NOW).refusals).toEqual([])

    const [flour, water, oil] = insertRows(db, ingredient, [
      { name: 'Flour' },
      { name: 'Water', density: 1 },
      { name: 'Olive oil', density: 0.92 },
    ])
    const [recipeId] = insertRows(db, recipe, [{ name: 'Dough', printed_g: 527.6 }])
    if (flour === undefined || water === undefined || oil === undefined || recipeId === undefined) {
      throw new Error('rows')
    }

    insertRows(db, recipeLine, [
      // Flour has no density and does not need one: the line is in grams.
      { recipe: recipeId, ingredient: flour, amount: 300, amount_unit: 'g' },
      { recipe: recipeId, ingredient: water, amount: 200, amount_unit: 'ml' },
      { recipe: recipeId, ingredient: oil, amount: 30, amount_unit: 'ml' },
    ])

    return { db, recipeId, formats: indexOf(listFormats(db)), recipe }
  }

  it('adds grams and millilitres into one weight, through a fact on each ingredient', async () => {
    const { db, formats, recipe } = await measuredKitchen()
    const [row] = listRows(db, recipe, { limit: 1 })
    if (row === undefined) throw never()
    const [total] = aggregatesOf(db, recipe, row, formats)

    // 300 g + 200 ml of water + 30 ml of oil = 300 + 200 + 27.6.
    expect(total?.value.kind).toBe('VALUE')
    expect(total?.value.kind === 'VALUE' && total.value.value).toBeCloseTo(527.6, 6)
  })

  it('proves the printed weight against it, which is what makes the total a fact', async () => {
    const { db, formats, recipe } = await measuredKitchen()
    const [row] = listRows(db, recipe, { limit: 1 })
    if (row === undefined) throw never()

    const inputs = inputsWithAggregates(db, recipe, row, formats)
    const verdict = evaluateIdentity(recipe.identities[0] ?? never(), inputs)
    expect(verdict.kind).toBe('PROVED')
  })

  it('carries the row’s own unit across the hop, not the column’s', async () => {
    const { db, formats } = await measuredKitchen()
    const line = formats.get('recipe_line')
    if (line === undefined) throw never()
    const rows = listRows(db, line, { limit: 10 })
    const inputs = inputsFor(db, line, rows, formats)

    // Sorted, because what is asserted is that each row carried its own unit
    // rather than the column's, not what order the table hands them back in.
    expect(inputs.map((each) => each.units?.get('amount')).sort()).toEqual(['g', 'ml', 'ml'])
  })
})

/**
 * **The payslip M24 U8 was opened for** (D-260), synthetic and end to end.
 *
 * Net is gross less the lines whose deduction type reduces net — and *not* less
 * the employer's pension, which is printed on the slip and never left the
 * gross. A fold over every line gets that wrong by exactly the employer's
 * share, and the identity says so; the filtered fold proves it.
 */
describe('an aggregate over only the rows that match (U8)', () => {
  const base = { language: 8, notes: '', nothingMustHold: true, identities: [], aggregates: [] }
  const REDUCING = { column: 'deduction_type.reduces_net', is: 'true' }

  function payslipFormats(where: typeof REDUCING | undefined): readonly FormatDeclaration[] {
    const deductionType: FormatDeclaration = {
      ...base,
      name: 'deduction_type',
      title: 'Deduction type',
      columns: [
        column('name', 'text', { required: true }),
        column('reduces_net', 'boolean'),
      ],
    }
    const line: FormatDeclaration = {
      ...base,
      name: 'paycheck_line',
      title: 'Paycheck line',
      columns: [
        column('paycheck', 'link', { target: 'paycheck', required: true }),
        column('deduction_type', 'link', { target: 'deduction_type' }),
        column('amount', 'money', { required: true }),
      ],
    }
    const paycheck: FormatDeclaration = {
      ...base,
      name: 'paycheck',
      title: 'Paycheck',
      nothingMustHold: false,
      columns: [
        column('month', 'text', { required: true }),
        column('gross', 'money', { required: true }),
        column('net', 'money', { required: true }),
      ],
      aggregates: [
        aggregate(
          'deducted',
          'SUM',
          { format: 'paycheck_line', column: 'paycheck' },
          { expression: 'amount', where },
        ),
        aggregate('reducing_lines', 'COUNT', { format: 'paycheck_line', column: 'paycheck' }, { where }),
      ],
      identities: [identity('net', 'net = gross - deducted', { note: 'what reached the bank' })],
    }
    return [deductionType, line, paycheck]
  }

  async function payslip(
    where: typeof REDUCING | null = REDUCING,
    untyped = false,
  ): Promise<{ db: Database; formats: ReturnType<typeof indexOf> }> {
    const db = await createDatabase()
    const [deductionType, line, paycheck] = payslipFormats(where ?? undefined)
    if (deductionType === undefined || line === undefined || paycheck === undefined) never()
    for (const each of [deductionType, line, paycheck]) {
      expect(adoptFormat(db, each, NOW).refusals).toEqual([])
    }

    const [tax, insurance, pension, employer] = insertRows(db, deductionType, [
      { name: 'Income tax', reduces_net: 1 },
      { name: 'National insurance', reduces_net: 1 },
      { name: 'Pension, employee', reduces_net: 1 },
      { name: 'Pension, employer', reduces_net: 0 },
    ])
    // ₪20,000.00 gross; ₪2,500 + ₪900 + ₪1,200 come off it; the employer's
    // ₪1,300 is on the slip and comes off nothing. Net is ₪15,400.00.
    const [slip] = insertRows(db, paycheck, [
      {
        month: '2026-08',
        gross_minor: 2_000_000,
        gross_currency: 'ILS',
        net_minor: 1_540_000,
        net_currency: 'ILS',
      },
    ])
    const ils = (minor: number): Record<string, number | string> => ({
      amount_minor: minor,
      amount_currency: 'ILS',
    })
    insertRows(db, line, [
      { paycheck: slip ?? never(), deduction_type: tax ?? never(), ...ils(250_000) },
      { paycheck: slip ?? never(), deduction_type: insurance ?? never(), ...ils(90_000) },
      { paycheck: slip ?? never(), deduction_type: pension ?? never(), ...ils(120_000) },
      {
        paycheck: slip ?? never(),
        deduction_type: untyped ? null : (employer ?? never()),
        ...ils(130_000),
      },
    ])
    return { db, formats: indexOf(listFormats(db)) }
  }

  function slipOf(db: Database, formats: ReturnType<typeof indexOf>) {
    const paycheck = formats.get('paycheck') ?? never()
    return { paycheck, row: listRows(db, paycheck)[0] ?? never() }
  }

  it('folds only the lines that reduce net, and the net proves', async () => {
    const { db, formats } = await payslip()
    const { paycheck, row } = slipOf(db, formats)

    const folded = aggregatesOf(db, paycheck, row, formats)
    expect(folded.map((each) => each.value)).toEqual([
      { kind: 'VALUE', value: 460_000, unit: undefined, rows: 3, currency: 'ILS' },
      { kind: 'VALUE', value: 3, unit: undefined, rows: 3 },
    ])
    const inputs = inputsWithAggregates(db, paycheck, row, formats)
    expect(evaluateIdentity(paycheck.identities[0] ?? never(), inputs).kind).toBe('PROVED')
  })

  it('is the difference between a proved net and a failed one', async () => {
    const { db, formats } = await payslip(null)
    const { paycheck, row } = slipOf(db, formats)
    const inputs = inputsWithAggregates(db, paycheck, row, formats)
    expect(inputs.numbers.get('deducted')).toBe(590_000)
    expect(evaluateIdentity(paycheck.identities[0] ?? never(), inputs).kind).toBe('FAILED')
  })

  it('will not fold a line with no type, because nobody can say whether it reduces net', async () => {
    const { db, formats } = await payslip(REDUCING, true)
    const { paycheck, row } = slipOf(db, formats)
    const [deducted] = aggregatesOf(db, paycheck, row, formats)
    expect(deducted?.value.kind).toBe('UNCHECKED')
    expect(deducted?.value).toMatchObject({
      reason: expect.stringContaining('has nothing in deduction_type.reduces_net') as unknown,
    })
    const inputs = inputsWithAggregates(db, paycheck, row, formats)
    expect(evaluateIdentity(paycheck.identities[0] ?? never(), inputs).kind).toBe('UNCHECKED')
  })

  it('keeps the filter through the document', async () => {
    const { formats } = await payslip()
    expect(formats.get('paycheck')?.aggregates.map((each) => each.where)).toEqual([
      REDUCING,
      REDUCING,
    ])
  })
})

/**
 * **A fund's balance is what its latest report said** (M25 E3, D-272) — picked
 * in SQL when nothing filters, and by reading every row when something does.
 * The two have to agree, which is what most of this checks.
 */
describe('the latest by an order (M25 E3)', () => {
  const base = { language: 11, notes: '', nothingMustHold: true, identities: [], aggregates: [] }
  const SNAPSHOT: FormatDeclaration = {
    ...base,
    name: 'fund_balance_snapshot',
    title: 'Fund balance',
    columns: [
      column('fund', 'link', { target: 'fund', required: true }),
      column('as_of', 'date'),
      column('total_balance', 'money', { required: true }),
      column('source', 'enum', { values: ['REPORT', 'TYPED'], required: true }),
    ],
  }
  function fundWith(where?: { column: string; is: string }, kind: 'LATEST' | 'EARLIEST' = 'LATEST'): FormatDeclaration {
    return {
      ...base,
      name: 'fund',
      title: 'Fund',
      columns: [column('name', 'text', { required: true })],
      aggregates: [
        aggregate('balance', kind, { format: 'fund_balance_snapshot', column: 'fund' }, {
          expression: 'total_balance',
          by: 'as_of',
          where,
        }),
      ],
    }
  }

  async function funds(
    readings: readonly { as_of: string | null; minor: number; source?: string }[],
    fund: FormatDeclaration = fundWith(),
  ): Promise<{ db: Database; formats: ReturnType<typeof indexOf>; fund: FormatDeclaration }> {
    const db = await createDatabase()
    expect(adoptFormat(db, { ...fund, aggregates: [] }, NOW).refusals).toEqual([])
    expect(adoptFormat(db, SNAPSHOT, NOW).refusals).toEqual([])
    expect(adoptFormat(db, fund, NOW).refusals).toEqual([])
    const [pension, other] = insertRows(db, fund, [{ name: 'Pension' }, { name: 'Study fund' }])
    insertRows(
      db,
      SNAPSHOT,
      readings.map((each) => ({
        fund: pension ?? never(),
        as_of: each.as_of,
        total_balance_minor: each.minor,
        total_balance_currency: 'ILS',
        source: each.source ?? 'REPORT',
      })),
    )
    // Another fund's later reading, which must never be this one's.
    insertRows(db, SNAPSHOT, [
      { fund: other ?? never(), as_of: '2027-01-01', total_balance_minor: 1, total_balance_currency: 'ILS', source: 'REPORT' },
    ])
    const formats = indexOf(listFormats(db))
    return { db, formats, fund: formats.get('fund') ?? never() }
  }

  function balanceOf(db: Database, fund: FormatDeclaration, formats: ReturnType<typeof indexOf>) {
    const row = listRows(db, fund).find((each) => each.cells['name'] === 'Pension') ?? never()
    return aggregatesOf(db, fund, row, formats)[0]?.value
  }

  const YEAR = [
    { as_of: '2026-03-31', minor: 10_000_000 },
    { as_of: '2026-09-30', minor: 12_500_000 },
    { as_of: '2026-06-30', minor: 11_000_000 },
  ]

  it('reads the latest report, out of every report of that fund, and the declaration keeps its order', async () => {
    const { db, formats, fund } = await funds(YEAR)
    expect(fund.aggregates[0]?.by).toBe('as_of')
    expect(balanceOf(db, fund, formats)).toEqual({
      kind: 'VALUE',
      value: 12_500_000,
      unit: undefined,
      rows: 3,
      currency: 'ILS',
      at: '2026-09-30',
    })
  })

  it('reads the earliest the same way', async () => {
    const { db, formats, fund } = await funds(YEAR, fundWith(undefined, 'EARLIEST'))
    expect(balanceOf(db, fund, formats)).toMatchObject({ value: 10_000_000, at: '2026-03-31', rows: 3 })
  })

  it('refuses two reports on the latest day, and names both', async () => {
    const { db, formats, fund } = await funds([...YEAR, { as_of: '2026-09-30', minor: 12_600_000, source: 'TYPED' }])
    const value = balanceOf(db, fund, formats)
    expect(value?.kind).toBe('UNCHECKED')
    expect(value?.kind === 'UNCHECKED' && value.reason).toContain('tie at 2026-09-30')
  })

  it('refuses a report with no day, which might be the latest', async () => {
    const { db, formats, fund } = await funds([...YEAR, { as_of: null, minor: 1 }])
    const value = balanceOf(db, fund, formats)
    expect(value?.kind === 'UNCHECKED' && value.reason).toContain('nothing in as_of')
  })

  it('picks among the rows a filter takes, and agrees with the SQL pick when they are the same rows', async () => {
    const readings = [...YEAR, { as_of: '2026-10-15', minor: 13_000_000, source: 'TYPED' }]
    const filtered = await funds(readings, fundWith({ column: 'source', is: 'REPORT' }))
    expect(balanceOf(filtered.db, filtered.fund, filtered.formats)).toMatchObject({
      value: 12_500_000,
      rows: 3,
    })
    const every = await funds(readings)
    expect(balanceOf(every.db, every.fund, every.formats)).toMatchObject({ value: 13_000_000, rows: 4 })
  })
})
