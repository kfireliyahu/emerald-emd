/**
 * **A date moved by whole days** — M49 U1, D-471: the grammar's `7 days` and
 * `2 weeks`, a date and a count of days as a date, either end of a span moved,
 * and every refusal said in words.
 */

import { describe, expect, it } from 'vitest'

import { column, declarationRejection, DECLARATION_LANGUAGE, type FormatDeclaration } from './declaration.ts'
import { compileDerived, derived, evaluateDerived } from './derived.ts'
import { formulaPieces } from './formula.ts'
import { evaluateExpression, evaluateIdentity, identity, parseExpression, parseIdentity } from './identity.ts'
import { identityInputsOf, type StoredRow } from './row.ts'
import { dateOfOrdinal, pointOrdinal } from './span.ts'

const PLAN: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'plan',
  title: 'Plan',
  notes: '',
  columns: [
    column('name', 'text'),
    column('start', 'date'),
    column('due', 'date'),
    column('remind_on', 'date'),
    column('opens', 'time'),
    column('stamped', 'instant'),
    column('days', 'integer'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

function inputs(cells: StoredRow['cells']) {
  return identityInputsOf(PLAN, { id: 'r1', cells })
}

function rejected(expression: string, tolerance?: { kind: 'RELATIVE'; percent: number }): string | undefined {
  return declarationRejection({
    ...PLAN,
    nothingMustHold: false,
    identities: [identity('x', expression, tolerance === undefined ? {} : { tolerance })],
  })
}

function derivedProblem(expression: string): string | undefined {
  return compileDerived({ ...PLAN, derived: [derived('worked', expression)] }).problems[0]?.message
}

describe('a count of days', () => {
  it('is read after a number, in days or weeks, and only whole', () => {
    expect(parseExpression('start + 7 days')).toEqual({
      kind: 'ADD',
      left: { kind: 'COLUMN', name: 'start' },
      right: { kind: 'DAYS', days: 7, text: '7 days' },
    })
    expect(parseExpression('start + 2 weeks')).toMatchObject({ right: { kind: 'DAYS', days: 14 } })
    expect(parseExpression('due - 1 day')).toMatchObject({ kind: 'SUBTRACT', right: { kind: 'DAYS', days: 1 } })
    expect(parseExpression('start + 1.5 days')).toEqual({ problem: expect.stringMatching(/whole days and weeks/) })
    expect(parseExpression('start + 1 month')).toEqual({ problem: expect.stringMatching(/a month is not always as long/) })
    // A column called days is still a column, by a `*`, and a missing one still a missing `*`.
    expect(parseExpression('7 * days')).toMatchObject({ kind: 'MULTIPLY', right: { kind: 'COLUMN', name: 'days' } })
    expect(parseExpression('7 hours')).toEqual({ problem: expect.stringMatching(/need a `\*`/) })
  })

  it('is a word in the field as it is typed, not a name', () => {
    expect(formulaPieces('start + 7 days').map((each) => [each.kind, each.text])).toEqual([
      ['NAME', 'start'],
      ['OTHER', ' + 7 '],
      ['WORD', 'days'],
    ])
  })

  it('is a figure in days on its own', () => {
    const next = evaluateExpression(parseExpression('7 days') as never, inputs({}))
    expect(next).toMatchObject({ kind: 'NUMBER', value: 7, unit: 'day' })
  })
})

describe('a date and its ordinal', () => {
  it('go there and back across leap days, centuries and the epoch', () => {
    for (const date of ['1970-01-01', '1969-12-31', '2000-02-29', '1900-03-01', '2024-02-29', '2100-02-28', '0001-01-01', '9999-12-31']) {
      const ordinal = pointOrdinal('date', date)
      expect(ordinal, date).toBeDefined()
      expect(dateOfOrdinal(ordinal ?? 0), date).toBe(date)
    }
    expect(dateOfOrdinal(0)).toBe('1970-01-01')
  })
})

describe('a claim between two dates', () => {
  it('holds a date moved by days against a date', () => {
    const claim = identity('remind', 'due - 3 days = remind_on')
    expect(evaluateIdentity(claim, inputs({ due: '2026-03-02', remind_on: '2026-02-27' }))).toMatchObject({
      kind: 'PROVED',
      points: { type: 'date', left: '2026-02-27', right: '2026-02-27' },
    })
    expect(evaluateIdentity(claim, inputs({ due: '2026-03-02', remind_on: '2026-02-26' }))).toMatchObject({
      kind: 'FAILED',
      difference: 1,
    })
    expect(evaluateIdentity(claim, inputs({ due: null, remind_on: '2026-02-26' }))).toEqual({
      kind: 'UNCHECKED',
      reason: 'This row has nothing in due, so there is nothing to check.',
    })
    // Within a tolerance in days.
    const loose = identity('remind', 'due - 3 days = remind_on', { tolerance: { kind: 'ABSOLUTE', amount: 2 } })
    expect(evaluateIdentity(loose, inputs({ due: '2026-03-02', remind_on: '2026-02-25' }))).toMatchObject({ kind: 'PROVED' })
  })

  it('takes a span between moved ends, and a span against a count of days', () => {
    const between = evaluateExpression(parseExpression('due - (start + 1 week)') as never, inputs({ start: '2026-01-01', due: '2026-01-31' }))
    expect(between).toMatchObject({ kind: 'NUMBER', value: 23, unit: 'day' })
    expect(
      evaluateIdentity(identity('a_fortnight', 'due - start = 2 weeks'), inputs({ start: '2026-01-01', due: '2026-01-15' })),
    ).toMatchObject({ kind: 'PROVED', left: 14, right: 14 })
  })

  it('is refused in words when it moves a time, mixes a date and a figure, or allows a percent', () => {
    expect(rejected('start + 7 days = due')).toBeUndefined()
    expect(rejected('due - start = 2 weeks')).toBeUndefined()
    expect(rejected('opens + 1 day = opens')).toMatch(/only a date moves by whole days/)
    expect(rejected('start + 7 days = days')).toMatch(/A claim about a date holds a date on each side/)
    expect(rejected('start = stamped')).toMatch(/One side is a date — start — and the other an instant/)
    expect(rejected('start + 7 days = due', { kind: 'RELATIVE', percent: 5 })).toMatch(/a number of days, not a percent/)
    expect(parseIdentity('start + 7 days = due')).not.toHaveProperty('problem')
  })
})

describe('a computed date', () => {
  it('compiles to date() and works out the same in TypeScript', () => {
    const { compiled, problems } = compileDerived({ ...PLAN, derived: [derived('next', 'start + 2 weeks - 3 days')] })
    expect(problems).toEqual([])
    expect(compiled[0]?.type).toEqual({ kind: 'DATE' })
    expect(compiled[0]?.select).toEqual([{ column: 'next', sql: `date(t."start", '+11 days')` }])
    const one = compiled[0]
    if (one === undefined) throw new Error('none')
    expect(evaluateDerived(one, inputs({ start: '2026-02-20' }))).toEqual({ kind: 'DATE', date: '2026-03-03' })
    expect(evaluateDerived(one, inputs({ start: null }))).toEqual({ kind: 'EMPTY', reason: 'start is empty here.' })
  })

  it('is refused for a time, an instant or a date inside other arithmetic', () => {
    expect(derivedProblem('opens + 1 day')).toMatch(/only a date moves by whole days/)
    expect(derivedProblem('stamped + 1 day')).toMatch(/an instant crosses a time zone/)
    expect(derivedProblem('(start + 7 days) * 2')).toMatch(/moving by whole days/)
    expect(derivedProblem('7 days')).toMatch(/names no column/)
  })
})
