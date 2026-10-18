import { describe, expect, it } from 'vitest'

import {
  constraintHolds,
  constraintKey,
  constraintProblem,
  constraintText,
  ONE_PER_TYPES,
  parseConstraint,
  rowConstraint,
  type RowConstraint,
} from './constraint.ts'
import { read, write } from './artefact.ts'
import { column, declarationProblems, UNIQUE_TYPES, type FormatDeclaration } from './declaration.ts'
import { constraintConditionSql } from './ddl.ts'
import { planReconcile, type ObservedTable } from './reconcile.ts'
import { brokenConstraints } from './row.ts'

/** The ledger's three shapes, as a synthetic debt and a synthetic transaction. */
const DEBT_COLUMNS = [
  column('name', 'text', { required: true }),
  column('track', 'enum', { values: ['NONE', 'MANUAL', 'CATEGORY'], required: true }),
  column('track_ref', 'text'),
  column('goal', 'text'),
  column('fund', 'text'),
  column('direction', 'enum', { values: ['OUTFLOW', 'INFLOW', 'TRANSFER'] }),
  column('amount', 'money'),
]

const TRACKED = rowConstraint('REQUIRED_WHEN', ['track_ref'], {
  when: 'track',
  is: ['MANUAL', 'CATEGORY'],
  only: true,
})
const ONE_SOURCE = rowConstraint('AT_MOST_ONE', ['goal', 'fund'])
const OUT_IS_NEGATIVE = rowConstraint('SIGN_WHEN', ['amount'], {
  sign: 'AT_MOST_ZERO',
  when: 'direction',
  is: ['OUTFLOW'],
})

function debt(constraints: readonly RowConstraint[], language = 7): FormatDeclaration {
  return {
    language,
    name: 'debt',
    title: 'Debt',
    notes: '',
    columns: DEBT_COLUMNS,
    identities: [],
    aggregates: [],
    constraints,
    nothingMustHold: true,
  }
}

describe('a row constraint as a sentence (M24 U7, D-259)', () => {
  it.each([
    ['track_ref is required only when track is MANUAL, CATEGORY', TRACKED],
    ['at most one of goal, fund', ONE_SOURCE],
    ['amount is at most 0 when direction is OUTFLOW', OUT_IS_NEGATIVE],
  ])('writes and reads back %s', (text, each) => {
    expect(constraintText(each)).toBe(text)
    const parsed = parseConstraint(text)
    expect(parsed.ok && parsed.value).toEqual(each)
  })

  it('reads the one-way required and the other sign', () => {
    const required = parseConstraint('track_ref is required when track is MANUAL')
    expect(required.ok && required.value.only).toBe(false)
    const sign = parseConstraint('amount  is at least 0 when direction is INFLOW')
    expect(sign.ok && sign.value.sign).toBe('AT_LEAST_ZERO')
  })

  it('refuses a sentence that is none of the three, naming them', () => {
    const parsed = parseConstraint('amount > 0')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('at most one of')
  })

  it('keys by the rule and not the note', () => {
    expect(constraintKey({ ...ONE_SOURCE, note: 'why' })).toBe(constraintKey(ONE_SOURCE))
    expect(constraintKey(ONE_SOURCE)).not.toBe(constraintKey(rowConstraint('AT_MOST_ONE', ['fund', 'goal'])))
  })
})

describe('what a constraint may say', () => {
  it.each([
    [rowConstraint('AT_MOST_ONE', ['goal', 'nope']), 'nope'],
    [rowConstraint('AT_MOST_ONE', ['goal']), 'two or more'],
    [rowConstraint('AT_MOST_ONE', ['goal', 'name']), 'required'],
    [rowConstraint('REQUIRED_WHEN', ['track_ref'], { when: 'goal', is: ['x'] }), 'decided by an enum'],
    [rowConstraint('REQUIRED_WHEN', ['track_ref'], { when: 'track', is: ['WEEKLY'] }), 'NONE, MANUAL, CATEGORY'],
    [rowConstraint('REQUIRED_WHEN', ['name'], { when: 'track', is: ['MANUAL'] }), 'already required'],
    [rowConstraint('SIGN_WHEN', ['goal'], { when: 'direction', is: ['OUTFLOW'], sign: 'AT_MOST_ZERO' }), 'a sign goes on'],
    [rowConstraint('SIGN_WHEN', ['amount'], { when: 'direction', is: ['OUTFLOW'] }), 'which side of zero'],
  ])('refuses %#', (each, phrase) => {
    expect(constraintProblem(each, DEBT_COLUMNS)).toContain(phrase)
  })

  it('stands for the three the ledger says', () => {
    expect(declarationProblems(debt([TRACKED, ONE_SOURCE, OUT_IS_NEGATIVE]))).toEqual([])
  })

  it('needs language 7', () => {
    const problems = declarationProblems(debt([ONE_SOURCE], 6))
    expect(problems[0]?.constraintIndex).toBe(0)
    expect(problems[0]?.message).toContain('format language 7')
  })

  it('is refused when a column it names is renamed away', () => {
    const renamed = { ...debt([ONE_SOURCE]), columns: DEBT_COLUMNS.filter((each) => each.name !== 'fund') }
    expect(declarationProblems(renamed)[0]?.message).toContain('fund')
  })
})

describe('whether a row keeps it', () => {
  const figure = (cells: Record<string, string | number | null>) => (name: string) => cells[name] ?? null

  it('required only when: filled exactly when the enum is a member', () => {
    expect(constraintHolds(TRACKED, figure({ track: 'MANUAL', track_ref: 'x' }))).toBe(true)
    expect(constraintHolds(TRACKED, figure({ track: 'MANUAL' }))).toBe(false)
    expect(constraintHolds(TRACKED, figure({ track: 'NONE', track_ref: 'x' }))).toBe(false)
    expect(constraintHolds(TRACKED, figure({ track: 'NONE' }))).toBe(true)
    const oneWay = { ...TRACKED, only: false }
    expect(constraintHolds(oneWay, figure({ track: 'NONE', track_ref: 'x' }))).toBe(true)
  })

  it('at most one of: none or one set', () => {
    expect(constraintHolds(ONE_SOURCE, figure({}))).toBe(true)
    expect(constraintHolds(ONE_SOURCE, figure({ goal: 'g' }))).toBe(true)
    expect(constraintHolds(ONE_SOURCE, figure({ goal: 'g', fund: 'f' }))).toBe(false)
  })

  it('a sign when: zero is on both sides, and no direction is no rule', () => {
    expect(constraintHolds(OUT_IS_NEGATIVE, figure({ direction: 'OUTFLOW', amount: -500 }))).toBe(true)
    expect(constraintHolds(OUT_IS_NEGATIVE, figure({ direction: 'OUTFLOW', amount: 0 }))).toBe(true)
    expect(constraintHolds(OUT_IS_NEGATIVE, figure({ direction: 'OUTFLOW', amount: 500 }))).toBe(false)
    expect(constraintHolds(OUT_IS_NEGATIVE, figure({ direction: 'INFLOW', amount: 500 }))).toBe(true)
    expect(constraintHolds(OUT_IS_NEGATIVE, figure({ amount: 500 }))).toBe(true)
  })

  it('reads a money column by its minor units, and names the rule', () => {
    const format = debt([OUT_IS_NEGATIVE])
    expect(
      brokenConstraints(format, { direction: 'OUTFLOW', amount_minor: 1200, amount_currency: 'ILS' }),
    ).toEqual(['This row breaks "amount is at most 0 when direction is OUTFLOW".'])
    expect(constraintConditionSql(format, OUT_IS_NEGATIVE)).toContain('"amount_minor" <= 0')
  })
})

describe('the reconciler and the triggers', () => {
  const table = (checks: readonly string[], unheld: Record<string, number> = {}): ObservedTable => ({
    name: 'fmt_debt',
    rowCount: 3,
    columns: [
      { name: 'id', storageClass: 'TEXT', notNull: true, filled: 3, distinct: 3, unique: false },
      ...['name', 'track', 'track_ref', 'goal', 'fund', 'direction', 'amount_currency'].map((name) => ({
        name,
        storageClass: 'TEXT',
        notNull: false,
        filled: 1,
        distinct: 1,
        unique: false,
      })),
      { name: 'amount_minor', storageClass: 'INTEGER', notNull: false, filled: 1, distinct: 1, unique: false },
    ],
    checks,
    unheld,
  })

  it('creates a table with an insert and an update trigger per constraint', () => {
    const sql = planReconcile(debt([ONE_SOURCE]), undefined, undefined).steps[0]?.sql ?? []
    expect(sql).toHaveLength(3)
    expect(sql[1]).toContain(`CREATE TRIGGER "fmt_debt__check_${constraintKey(ONE_SOURCE)}__insert" BEFORE INSERT`)
    expect(sql[2]).toContain('BEFORE UPDATE')
    expect(sql[1]).toContain(`RAISE(ABORT, 'debt: at most one of goal, fund')`)
  })

  it('adds one no row breaks, and takes one away that is gone', () => {
    const plan = planReconcile(debt([OUT_IS_NEGATIVE]), debt([ONE_SOURCE]), table([constraintKey(ONE_SOURCE)]))
    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => step.kind)).toEqual(['DROP_CHECK', 'ADD_CHECK'])
  })

  it('refuses one that rows already break, saying how many', () => {
    const plan = planReconcile(debt([TRACKED]), debt([]), table([], { [constraintKey(TRACKED)]: 2 }))
    expect(plan.steps).toEqual([])
    expect(plan.refusals).toMatchObject([{ column: 'track_ref', reason: 'NOT_HELD' }])
    expect(plan.refusals[0]?.detail).toContain('2 rows')
  })

  it('leaves a kept constraint alone', () => {
    const format = debt([ONE_SOURCE])
    expect(planReconcile(format, format, table([constraintKey(ONE_SOURCE)])).steps).toEqual([])
  })
})

describe('the artefact', () => {
  it('writes a constraints table only when there is one, and reads it back', () => {
    expect(write(debt([]))).not.toContain('| constraint | note |')
    const text = write(debt([{ ...ONE_SOURCE, note: 'a debt is paid from one place' }]))
    expect(text).toContain('| constraint | note |\n| --- | --- |\n| at most one of goal, fund | a debt is paid from one place |')
    const back = read(text)
    expect(back.ok && back.value.constraints).toEqual([{ ...ONE_SOURCE, note: 'a debt is paid from one place' }])
  })

  it('refuses a rule it cannot read, naming the line', () => {
    const text = write(debt([ONE_SOURCE])).replace('at most one of goal, fund', 'goal or fund')
    const back = read(text)
    expect(back.ok).toBe(false)
    if (!back.ok) expect(back.error).toMatch(/^Line \d+: /)
  })
})

describe('one row per (M25 E1, D-270)', () => {
  const PER = [
    column('plan', 'text', { required: true }),
    column('bucket', 'text'),
    column('mode', 'enum', { values: ['PERCENTAGE', 'REMAINDER'], required: true }),
    column('share', 'real'),
  ]
  const PER_BUCKET = rowConstraint('ONE_PER', ['plan', 'bucket'])
  const ONE_REMAINDER = rowConstraint('ONE_PER', ['plan'], { when: 'mode', is: ['REMAINDER'] })
  const allocation = (constraints: readonly RowConstraint[], language = 9): FormatDeclaration => ({
    ...debt(constraints, language),
    name: 'allocation',
    columns: PER,
  })

  it.each([
    ['one row per plan, bucket', PER_BUCKET],
    ['one row per plan when mode is REMAINDER', ONE_REMAINDER],
  ])('writes and reads back %s', (text, each) => {
    expect(constraintText(each)).toBe(text)
    const parsed = parseConstraint(text)
    expect(parsed.ok && parsed.value).toEqual(each)
  })

  it.each([
    [rowConstraint('ONE_PER', ['plan']), "column's own `unique`"],
    [rowConstraint('ONE_PER', ['plan', 'share']), 'which is a real'],
    [rowConstraint('ONE_PER', ['plan', 'nope']), 'nope'],
    [rowConstraint('ONE_PER', ['plan'], { when: 'bucket', is: ['x'] }), 'decided by an enum'],
    [rowConstraint('ONE_PER', ['plan'], { when: 'mode', is: ['FIXED'] }), 'PERCENTAGE, REMAINDER'],
  ])('refuses %#', (each, phrase) => {
    expect(constraintProblem(each, PER)).toContain(phrase)
  })

  it('takes every type a column may be unique on', () => {
    for (const type of UNIQUE_TYPES) expect(ONE_PER_TYPES.has(type)).toBe(true)
  })

  it('may be decided by one of its own columns', () => {
    const own = rowConstraint('ONE_PER', ['plan', 'mode'], { when: 'mode', is: ['REMAINDER'] })
    expect(constraintProblem(own, PER)).toBeUndefined()
  })

  it('stands in language 9 and not before', () => {
    expect(declarationProblems(allocation([PER_BUCKET, ONE_REMAINDER]))).toEqual([])
    const problems = declarationProblems(allocation([PER_BUCKET], 8))
    expect(problems[0]?.message).toContain('format language 9')
  })

  it('is no fact about one row, so a row alone always keeps it', () => {
    expect(brokenConstraints(allocation([PER_BUCKET]), { plan: 'a', bucket: 'b' })).toEqual([])
  })

  it('compiles to a unique index, partial under a when, and drops by key', () => {
    const sql = planReconcile(allocation([PER_BUCKET, ONE_REMAINDER]), undefined, undefined).steps[0]?.sql ?? []
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "fmt_allocation__check_${constraintKey(PER_BUCKET)}__index" ON "fmt_allocation" ("plan", "bucket")`,
    )
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "fmt_allocation__check_${constraintKey(ONE_REMAINDER)}__index" ON "fmt_allocation" ("plan") WHERE "mode" IN ('REMAINDER')`,
    )
    expect(sql.filter((each) => each.includes('TRIGGER'))).toEqual([])
  })

  it('counts a collision with a subquery that reads the other row, not its own', () => {
    const sql = constraintConditionSql(allocation([]), ONE_REMAINDER, (stored) => `"row"."${stored}"`)
    expect(sql).toContain('"other"."plan" = "row"."plan"')
    expect(sql).toContain('"other"."id" <> "row"."id"')
    expect(constraintConditionSql(allocation([]), PER_BUCKET, (stored) => (stored === 'bucket' ? 'NULL' : stored))).toBe('1')
  })
})
