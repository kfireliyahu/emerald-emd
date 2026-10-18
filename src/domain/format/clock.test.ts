/**
 * **Today in questions, never in claims** — M49 U2, D-472: the filter's
 * windows around today, worked out against a day handed in; `days_left = due
 * - today` as a question's computed column, kept out of the stored view; and a
 * claim, a total and a rule set that read the clock, each refused saying why.
 */

import { describe, expect, it } from 'vitest'

import { aggregate, filterText, parseFilter } from './aggregate.ts'
import { clockRange, parseClockWords } from './clock.ts'
import { column, declarationRejection, DECLARATION_LANGUAGE, nameRejection, type FormatDeclaration } from './declaration.ts'
import { filterConditionSql, rollupQuerySql } from './ddl.ts'
import { compileDerived, createDerivedViewSql, derived, derivedSelectSql, evaluateDerived } from './derived.ts'
import { formulaPieces } from './formula.ts'
import { identity } from './identity.ts'
import { parseRollup } from './rollup.ts'
import { parseRuleSet } from './rule.ts'
import { identityInputsOf } from './row.ts'

const TODAY = '2026-10-14'

const ASSIGNMENT: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'assignment',
  title: 'Assignment',
  notes: '',
  columns: [column('name', 'text'), column('due', 'date'), column('hours', 'integer'), column('opens', 'time')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

describe('a window around today', () => {
  it('is read in the words a filter says, and worked out against the day handed in', () => {
    expect(parseClockWords('within 14 days')).toEqual({ kind: 'WITHIN', days: 14 })
    expect(parseClockWords('within 2 weeks')).toEqual({ kind: 'WITHIN', days: 14 })
    expect(parseClockWords('Before  Today')).toEqual({ kind: 'BEFORE' })
    expect(parseClockWords('within a week')).toBeUndefined()
    expect(clockRange({ kind: 'WITHIN', days: 14 }, TODAY)).toEqual({ from: '2026-10-14', through: '2026-10-28' })
    expect(clockRange({ kind: 'BEFORE' }, TODAY)).toEqual({ through: '2026-10-13' })
    expect(clockRange({ kind: 'AFTER' }, '2026-12-31')).toEqual({ from: '2027-01-01' })
    expect(clockRange({ kind: 'TODAY' }, TODAY)).toEqual({ from: TODAY, through: TODAY })
  })

  it('joins D-380’s filter words, and is written back as it was said', () => {
    const within = parseFilter('due is within 2 weeks')
    expect(within).toEqual({ column: 'due', is: 'within 2 weeks', clock: { kind: 'WITHIN', days: 14 } })
    if ('problem' in within) throw new Error(within.problem)
    expect(filterText(within)).toBe('due is within 2 weeks')
    expect(parseFilter('due is before today')).toMatchObject({ clock: { kind: 'BEFORE' } })
    expect(parseFilter('due is not before today')).toEqual({ problem: expect.stringMatching(/not turned round/) })
    expect(parseFilter('due is within 1 month')).toEqual({ problem: expect.stringMatching(/not a window of days/) })
    // A member called that, quoted, is still a member.
    expect(parseFilter('status is "today"')).toEqual({ column: 'status', is: 'today' })
  })

  it('is a condition SQL reads, and a reader told no day refuses rather than guesses', () => {
    const filter = parseFilter('due is within 14 days')
    if ('problem' in filter) throw new Error(filter.problem)
    expect(filterConditionSql('t.due', filter, [], false, TODAY)).toBe("(t.due >= '2026-10-14' AND t.due <= '2026-10-28')")
    expect(() => filterConditionSql('t.due', filter, [], false)).toThrow(/what day it is/)
  })

  it('may stand in a rollup’s where, a question, and is a date’s', () => {
    const rollup = parseRollup('soon', 'sum of hours by month of due where due is within 14 days')
    if (!rollup.ok) throw new Error(rollup.error)
    const declared = { ...ASSIGNMENT, rollups: [rollup.value] }
    expect(declarationRejection(declared)).toBeUndefined()
    expect(rollupQuerySql(declared, rollup.value, [], { today: TODAY }).sql).toContain("'2026-10-28'")
    const wrong = parseRollup('soon', 'sum of hours by month of due where hours is within 14 days')
    if (!wrong.ok) throw new Error(wrong.error)
    expect(declarationRejection({ ...ASSIGNMENT, rollups: [wrong.value] })).toMatch(/hours is an integer\. A window around today is a date's/)
  })
})

describe('a claim may not read the clock', () => {
  it('refuses an identity that names today, saying why', () => {
    const problem = declarationRejection({
      ...ASSIGNMENT,
      nothingMustHold: false,
      identities: [identity('not_late', 'due - today = 0')],
    })
    expect(problem).toMatch(/The claim not_late names today, and a claim may not read the clock: a proof that held yesterday must not fail tomorrow/)
  })

  it('refuses a total that filters by today, or folds a column that reads it', () => {
    const course = {
      ...ASSIGNMENT,
      name: 'course',
      title: 'Course',
      columns: [column('name', 'text')],
    }
    const lines = {
      ...ASSIGNMENT,
      columns: [...ASSIGNMENT.columns, column('course', 'link', { target: 'course' })],
      derived: [derived('days_left', 'due - today')],
    }
    const filtered = declarationRejection(
      {
        ...course,
        aggregates: [aggregate('due_soon', 'COUNT', { format: 'assignment', column: 'course' }, { where: { column: 'due', is: 'within 14 days', clock: { kind: 'WITHIN', days: 14 } } })],
      },
      [lines],
    )
    expect(filtered).toMatch(/due is within 14 days: a total is what a claim reads, and a claim may not read the clock/)
    const folded = declarationRejection(
      { ...course, aggregates: [aggregate('left', 'SUM', { format: 'assignment', column: 'course' }, { expression: 'days_left' })] },
      [lines],
    )
    expect(folded).toMatch(/folds days_left, which reads today: a total is what a claim reads/)
  })

  it('refuses a rule set that filters by today: a rule writes what it decides', () => {
    const parsed = parseRuleSet(
      'shelves',
      'product.shelf from shelf when label matches pattern as contains first by priority where due is before today, recorded in shelf_source as RULE, never over MANUAL',
    )
    expect(parsed.ok ? undefined : parsed.error).toMatch(/a rule writes what it decides, and a claim may not read the clock/)
  })

  it('keeps today as a word, never a column’s name', () => {
    expect(nameRejection('today', 'column')).toMatch(/the word a question reads the day by/)
    expect(formulaPieces('due - today').find((each) => each.text === 'today')?.kind).toBe('WORD')
  })
})

describe('days left — a question’s computed column', () => {
  it('compiles against the day handed in, and is left out of the stored view', () => {
    const declared = { ...ASSIGNMENT, derived: [derived('days_left', 'due - today'), derived('reminder', 'due - 3 days')] }
    const { compiled, problems } = compileDerived(declared, [], undefined, TODAY)
    expect(problems).toEqual([])
    expect(compiled.map((each) => [each.declaration.name, each.clock])).toEqual([
      ['days_left', true],
      ['reminder', false],
    ])
    expect(derivedSelectSql(declared, [], false, TODAY)).toContain("julianday('2026-10-14')")
    const view = createDerivedViewSql(declared, []) ?? ''
    expect(view).toContain('"reminder"')
    expect(view).not.toContain('days_left')
    expect(view).not.toContain('2026-10-14')
  })

  it('works out the same figure in TypeScript, and an empty date is an empty cell', () => {
    const declared = { ...ASSIGNMENT, derived: [derived('days_left', 'due - today')] }
    const [days] = compileDerived(declared, [], undefined, TODAY).compiled
    if (days === undefined) throw new Error('not compiled')
    const inputs = (due: string | null) => identityInputsOf(declared, { id: 'r1', cells: { due } })
    expect(evaluateDerived(days, inputs('2026-10-20'), undefined, TODAY)).toEqual({ kind: 'NUMBER', value: 6, unit: 'day' })
    expect(evaluateDerived(days, inputs('2026-10-10'), undefined, TODAY)).toEqual({ kind: 'NUMBER', value: -4, unit: 'day' })
    expect(evaluateDerived(days, inputs(null), undefined, TODAY)).toMatchObject({ kind: 'EMPTY' })
  })

  it('refuses today alone, moved, or against a time, in words', () => {
    const problem = (expression: string): string | undefined =>
      compileDerived({ ...ASSIGNMENT, derived: [derived('x', expression)] }, [], undefined, TODAY).problems[0]?.message
    expect(problem('today + 14 days')).toMatch(/the same date on every row/)
    expect(problem('today * 2')).toMatch(/today/)
    expect(problem('opens - today')).toMatch(/opens/)
  })
})
