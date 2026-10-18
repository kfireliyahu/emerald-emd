import { describe, expect, it } from 'vitest'

import { column, type FormatDeclaration } from './declaration.ts'
import { planIsSettled, planReconcile, type ObservedTable } from './reconcile.ts'

function declaration(columns: FormatDeclaration['columns']): FormatDeclaration {
  return {
    language: 1,
    name: 'ingredient',
    title: 'Ingredient',
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
}

function observed(
  columns: readonly {
    name: string
    storageClass?: string
    filled?: number
    distinct?: number
    unique?: boolean
  }[],
  rowCount = 0,
): ObservedTable {
  return {
    name: 'fmt_ingredient',
    rowCount,
    columns: [
      { name: 'id', storageClass: 'TEXT', notNull: true, filled: rowCount, distinct: rowCount, unique: false },
      ...columns.map((each) => ({
        name: each.name,
        storageClass: each.storageClass ?? 'TEXT',
        notNull: false,
        filled: each.filled ?? 0,
        distinct: each.distinct ?? each.filled ?? 0,
        unique: each.unique ?? false,
      })),
    ],
  }
}

describe('a format with no table yet', () => {
  it('is created, and nothing can be refused because nothing can be lost', () => {
    const plan = planReconcile(declaration([column('name', 'text')]), undefined, undefined)

    expect(plan.refusals).toEqual([])
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]?.kind).toBe('CREATE_TABLE')
  })
})

describe('reconciling on open', () => {
  // `next` and `current` are the same declaration: nothing is being adopted, so
  // only the table can disagree.
  const pasta = declaration([column('name', 'text'), column('kcal', 'real', { unit: 'kcal' })])

  it('does nothing when the table already matches', () => {
    const plan = planReconcile(
      pasta,
      pasta,
      observed([{ name: 'name' }, { name: 'kcal', storageClass: 'REAL' }]),
    )
    expect(planIsSettled(plan)).toBe(true)
  })

  it('adds a column the table has not got', () => {
    const plan = planReconcile(pasta, pasta, observed([{ name: 'name' }]))

    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => [step.kind, step.column])).toEqual([['ADD_COLUMN', 'kcal']])
  })

  it('is idempotent — running it twice is running it once', () => {
    const after = observed([{ name: 'name' }, { name: 'kcal', storageClass: 'REAL' }])
    expect(planIsSettled(planReconcile(pasta, pasta, after))).toBe(true)
  })
})

describe('what it will not decide by itself', () => {
  it('refuses to drop a column that holds data', () => {
    // H5 at a smaller scale and with no ceremony around it: the user is
    // mid-thought, not making an architectural decision.
    const plan = planReconcile(
      declaration([column('name', 'text')]),
      declaration([column('name', 'text'), column('old_note', 'text')]),
      observed([{ name: 'name' }, { name: 'old_note', filled: 3 }], 4),
    )

    expect(plan.steps).toEqual([])
    expect(plan.refusals[0]?.reason).toBe('DROP_WITH_DATA')
    expect(plan.refusals[0]?.detail).toContain('3 rows')
  })

  it('refuses a type change on a column that holds data', () => {
    const plan = planReconcile(
      declaration([column('kcal', 'text')]),
      declaration([column('kcal', 'real')]),
      observed([{ name: 'kcal', storageClass: 'TEXT', filled: 2 }], 2),
    )

    expect(plan.refusals[0]?.reason).toBe('TYPE_CHANGED')
    expect(plan.steps).toEqual([])
  })

  it('refuses a unit change on a column that holds data, which alters no SQL at all', () => {
    // The quietest possible corruption: every figure stays, every figure is
    // wrong by a thousand, and nothing in the file records that the meaning
    // moved. It is the change only a declaration-to-declaration comparison can
    // see, because SQLite has no idea a column is grams.
    const plan = planReconcile(
      declaration([column('sodium', 'real', { unit: 'g' })]),
      declaration([column('sodium', 'real', { unit: 'mg' })]),
      observed([{ name: 'sodium', storageClass: 'REAL', filled: 12 }], 12),
    )

    expect(plan.refusals[0]?.reason).toBe('UNIT_CHANGED')
    expect(plan.refusals[0]?.detail).toContain('in mg')
    expect(plan.refusals[0]?.detail).toContain('in g')
  })

  it('refuses a tightened constraint on a column that holds data', () => {
    const plan = planReconcile(
      declaration([column('basis', 'enum', { values: ['dry'] })]),
      declaration([column('basis', 'enum', { values: ['dry', 'cooked'] })]),
      observed([{ name: 'basis', filled: 5 }], 5),
    )

    expect(plan.refusals[0]?.reason).toBe('CONSTRAINT_CHANGED')
  })

  it('refuses a new required column on a table that already has rows', () => {
    // SQLite refuses it outright — "Cannot add a NOT NULL column with default
    // value NULL" — and the existing rows genuinely have no answer for it.
    const plan = planReconcile(
      declaration([column('name', 'text'), column('basis', 'text', { required: true })]),
      declaration([column('name', 'text')]),
      observed([{ name: 'name', filled: 4 }], 4),
    )

    expect(plan.refusals[0]?.reason).toBe('REQUIRED_ON_ROWS')
    expect(plan.steps).toEqual([])
  })

  it('says so when something outside the app changed the table', () => {
    const plan = planReconcile(
      declaration([column('kcal', 'real')]),
      declaration([column('kcal', 'real')]),
      observed([{ name: 'kcal', storageClass: 'TEXT' }]),
    )

    expect(plan.refusals[0]?.reason).toBe('STORAGE_MISMATCH')
  })
})

describe('a column holding nothing', () => {
  // Every refusal above becomes an ordinary step when nothing would be lost.
  // This is what makes drafting a format the ordinary work H9 says it is: a
  // declaration is rewritten several times before the first row goes in.
  it('is rebuilt when its type changes', () => {
    const plan = planReconcile(
      declaration([column('kcal', 'integer')]),
      declaration([column('kcal', 'real')]),
      observed([{ name: 'kcal', storageClass: 'REAL' }]),
    )

    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => step.kind)).toEqual(['DROP_COLUMN', 'ADD_COLUMN'])
  })

  it('is dropped when the declaration stops naming it', () => {
    const plan = planReconcile(
      declaration([column('name', 'text')]),
      declaration([column('name', 'text'), column('old_note', 'text')]),
      observed([{ name: 'name' }, { name: 'old_note' }]),
    )

    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => [step.kind, step.column])).toEqual([
      ['DROP_COLUMN', 'old_note'],
    ])
  })

  it('takes a unit change with no step at all, because a unit is not SQL', () => {
    const plan = planReconcile(
      declaration([column('sodium', 'real', { unit: 'mg' })]),
      declaration([column('sodium', 'real', { unit: 'g' })]),
      observed([{ name: 'sodium', storageClass: 'REAL' }]),
    )

    expect(planIsSettled(plan)).toBe(true)
  })
})

describe('money', () => {
  it('adds both of its columns together', () => {
    const plan = planReconcile(
      declaration([column('price', 'money')]),
      declaration([]),
      observed([]),
    )

    expect(plan.steps[0]?.sql).toHaveLength(2)
    expect(plan.steps[0]?.sql.join(' ')).toContain('price_minor')
    expect(plan.steps[0]?.sql.join(' ')).toContain('price_currency')
  })

  it('refuses half a pair rather than repairing it', () => {
    const pair = declaration([column('price', 'money')])
    const plan = planReconcile(pair, pair, observed([{ name: 'price_minor', storageClass: 'INTEGER' }]))

    expect(plan.refusals[0]?.reason).toBe('STORAGE_MISMATCH')
  })
})

/** **A quantity and a ratio** (U4c, D-225). */
describe('a quantity', () => {
  it('adds both of its columns together', () => {
    const plan = planReconcile(
      declaration([column('amount', 'quantity')]),
      declaration([]),
      observed([]),
    )

    expect(plan.steps[0]?.sql).toHaveLength(2)
    expect(plan.steps[0]?.sql.join(' ')).toContain('"amount" REAL')
    expect(plan.steps[0]?.sql.join(' ')).toContain('amount_unit')
  })

  it('refuses half a pair rather than repairing it', () => {
    const pair = declaration([column('amount', 'quantity')])
    const plan = planReconcile(pair, pair, observed([{ name: 'amount', storageClass: 'REAL' }]))

    expect(plan.refusals[0]?.reason).toBe('STORAGE_MISMATCH')
  })

  it('reports a real re-declared as a quantity as the type change it is', () => {
    // It arrives looking exactly like half a pair — the figure is there and the
    // unit column is not — and *something outside the app changed this table*
    // would be a true sentence about the wrong cause.
    const plan = planReconcile(
      declaration([column('amount', 'quantity')]),
      declaration([column('amount', 'real')]),
      observed([{ name: 'amount', storageClass: 'REAL', filled: 4 }], 4),
    )

    expect(plan.refusals[0]?.reason).toBe('TYPE_CHANGED')
  })

  it('rebuilds it in the new shape when the column holds nothing', () => {
    // Drafting a format is ordinary work, and what is dropped is what the table
    // actually has rather than what the new declaration wants.
    const plan = planReconcile(
      declaration([column('amount', 'quantity')]),
      declaration([column('amount', 'real', { unit: 'g' })]),
      observed([{ name: 'amount', storageClass: 'REAL' }], 3),
    )

    expect(plan.refusals).toEqual([])
    expect(plan.steps[0]?.kind).toBe('DROP_COLUMN')
    expect(plan.steps[0]?.sql).toEqual(['ALTER TABLE "fmt_ingredient" DROP COLUMN "amount"'])
    expect(plan.steps[1]?.kind).toBe('ADD_COLUMN')
    expect(plan.steps[1]?.sql).toHaveLength(2)
  })

  it('refuses a changed ratio on a column that holds data, exactly as it refuses a unit', () => {
    // `g` per `ml` becoming `g` per `l` alters no SQL, loses no row, and makes
    // every figure bridged through it wrong by a thousand.
    const plan = planReconcile(
      declaration([column('density', 'real', { unit: 'g', per: 'l' })]),
      declaration([column('density', 'real', { unit: 'g', per: 'ml' })]),
      observed([{ name: 'density', storageClass: 'REAL', filled: 9 }], 9),
    )

    expect(plan.refusals[0]?.reason).toBe('UNIT_CHANGED')
    expect(plan.refusals[0]?.detail).toContain('g per ml')
    expect(plan.refusals[0]?.detail).toContain('g per l')
  })
})

describe('a unique column (M24 U4, D-255)', () => {
  const plain = declaration([column('ref', 'text'), column('title', 'text')])
  const unique = declaration([column('ref', 'text', { unique: true }), column('title', 'text')])

  it('is created with its index', () => {
    const plan = planReconcile(unique, undefined, undefined)
    const sql = plan.steps[0]?.sql ?? []
    expect(sql).toHaveLength(2)
    expect(sql[1]).toBe(
      'CREATE UNIQUE INDEX "fmt_ingredient__ref__unique" ON "fmt_ingredient" ("ref")',
    )
  })

  it('becomes unique by an index alone, when nothing repeats', () => {
    const plan = planReconcile(unique, plain, observed([{ name: 'ref', filled: 3, distinct: 3 }, { name: 'title' }], 3))
    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => [step.kind, step.column])).toEqual([['ADD_INDEX', 'ref']])
  })

  it('refuses to become unique over values that repeat, saying how many', () => {
    const plan = planReconcile(unique, plain, observed([{ name: 'ref', filled: 3, distinct: 2 }, { name: 'title' }], 3))
    expect(plan.steps).toEqual([])
    expect(plan.refusals).toMatchObject([{ column: 'ref', reason: 'NOT_UNIQUE' }])
    expect(plan.refusals[0]?.detail).toContain('1 row')
  })

  it('stops being unique by dropping the index, which loses nothing', () => {
    const plan = planReconcile(plain, unique, observed([{ name: 'ref', filled: 3, unique: true }, { name: 'title' }], 3))
    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => [step.kind, step.column])).toEqual([['DROP_INDEX', 'ref']])
  })

  it('is settled when the index is already there', () => {
    const plan = planReconcile(unique, unique, observed([{ name: 'ref', unique: true }, { name: 'title' }]))
    expect(planIsSettled(plan)).toBe(true)
  })

  it('drops the index before the column, because SQLite will not drop an indexed one', () => {
    const plan = planReconcile(
      declaration([column('title', 'text')]),
      unique,
      observed([{ name: 'ref', unique: true }, { name: 'title' }]),
    )
    expect(plan.steps[0]?.sql).toEqual([
      'DROP INDEX IF EXISTS "fmt_ingredient__ref__unique"',
      'ALTER TABLE "fmt_ingredient" DROP COLUMN "ref"',
    ])
  })
})

describe('a decimal that moves its point (M24 U6, D-257)', () => {
  const at = (scale: number): FormatDeclaration => ({
    ...declaration([column('rate', 'decimal', { scale })]),
    language: 6,
  })

  it('is refused on a column that holds figures, which it would re-mean by ten', () => {
    const plan = planReconcile(at(3), at(2), observed([{ name: 'rate', storageClass: 'INTEGER', filled: 2 }], 2))
    expect(plan.refusals[0]?.reason).toBe('TYPE_CHANGED')
    expect(plan.refusals[0]?.detail).toContain('kept 2 places and now keeps 3')
  })

  it('rebuilds an empty column, whose bounds are compiled onto the stored integer', () => {
    const plan = planReconcile(at(3), at(2), observed([{ name: 'rate', storageClass: 'INTEGER' }]))
    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => step.kind)).toContain('ADD_COLUMN')
  })
})
