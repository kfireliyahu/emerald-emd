import { describe, expect, it } from 'vitest'

import { parse, write } from './artefact.ts'
import { column, declarationProblems, DECLARATION_LANGUAGE, type FormatDeclaration } from './declaration.ts'
import { applyFinds, foundByText, parseFoundBy, planFinds, type Finder, type FoundBy } from './foundBy.ts'

/**
 * A link found by a date (M29 F8, D-350): the sentence, the declaration's
 * checks, and the rule on a write — synthetic days and slips, never real ones.
 */

function format(name: string, columns: FormatDeclaration['columns']): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name,
    title: name === 'paycheck' ? 'Paycheck' : 'Work day',
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
}

const PAYCHECK = format('paycheck', [column('label', 'text'), column('period', 'month'), column('paid_on', 'date')])
const BY_MONTH: FoundBy = { from: 'date', in: 'period', grain: 'MONTH' }
const DAY = format('work_day', [
  column('date', 'date'),
  column('hours', 'real'),
  column('paycheck', 'link', { target: 'paycheck', foundBy: BY_MONTH }),
])

const SLIPS = [
  { id: 'sep', cells: { label: 'September', period: '2026-09', paid_on: '2026-10-01' } },
  { id: 'oct', cells: { label: 'October', period: '2026-10', paid_on: '2026-11-01' } },
  { id: 'oct2', cells: { label: 'October bonus', period: '2026-10', paid_on: '2026-11-05' } },
]

function finder(found: FoundBy = BY_MONTH, rows = SLIPS): Finder {
  return {
    column: { ...column('paycheck', 'link', { target: 'paycheck' }), foundBy: found },
    target: PAYCHECK,
    rows,
  }
}

describe('the sentence', () => {
  it('reads a month and a day, and writes them back', () => {
    expect(parseFoundBy('date in period')).toEqual({ ok: true, value: BY_MONTH })
    expect(parseFoundBy('found by date on paid_on')).toEqual({
      ok: true,
      value: { from: 'date', in: 'paid_on', grain: 'DAY' },
    })
    expect(foundByText({ from: 'date', in: 'paid_on', grain: 'DAY' })).toBe('date on paid_on')
    const refused = parseFoundBy('date during period')
    expect(refused.ok).toBe(false)
  })

  it('round-trips through a .format.md in the cell that says what the link points at', () => {
    const text = write(DAY)
    expect(text).toContain('| paycheck | link | paycheck, found by date in period |')
    const back = parse(text)
    expect(back.ok && back.value.columns[2]?.foundBy).toEqual(BY_MONTH)
    expect(back.ok && back.value.columns[2]?.target).toBe('paycheck')
  })
})

describe('the declaration', () => {
  it('is accepted against a month, and against a date by month or by day', () => {
    expect(declarationProblems(DAY, [PAYCHECK])).toEqual([])
    const byDay = format('work_day', [
      column('date', 'date'),
      column('paycheck', 'link', { target: 'paycheck', foundBy: { from: 'date', in: 'paid_on', grain: 'DAY' } }),
    ])
    expect(declarationProblems(byDay, [PAYCHECK])).toEqual([])
  })

  it('names what is wrong: no such date, not a date, a day on a month, an old language', () => {
    const problem = (found: FoundBy, extra: Partial<FormatDeclaration> = {}): string =>
      declarationProblems(
        {
          ...format('work_day', [
            column('date', 'date'),
            column('hours', 'real'),
            column('paycheck', 'link', { target: 'paycheck', foundBy: found }),
          ]),
          ...extra,
        },
        [PAYCHECK],
      )
        .map((each) => each.message)
        .join(' ')
    expect(problem({ from: 'day', in: 'period', grain: 'MONTH' })).toContain('work_day has no column called that')
    expect(problem({ from: 'hours', in: 'period', grain: 'MONTH' })).toContain('which is a real')
    expect(problem({ from: 'date', in: 'label', grain: 'MONTH' })).toContain('which is a text')
    expect(problem({ from: 'date', in: 'period', grain: 'DAY' })).toContain('A day falls *in* a month')
    expect(problem(BY_MONTH, { language: 17 })).toContain('format language 18')
  })
})

describe('on a write', () => {
  it('finds the slip of each day’s month', () => {
    expect(applyFinds([finder()], { date: '2026-09-14', paycheck: null }).cells['paycheck']).toBe('sep')
    const byDay = finder({ from: 'date', in: 'paid_on', grain: 'DAY' })
    expect(applyFinds([byDay], { date: '2026-11-05' }).cells['paycheck']).toBe('oct2')
  })

  it('refuses a day with no slip and a day with two, naming them', () => {
    const none = applyFinds([finder()], { date: '2026-12-03', paycheck: null })
    expect(none.refusals[0]?.column).toBe('paycheck')
    expect(none.refusals[0]?.reason).toContain('no Paycheck has period 2026-12')
    const two = applyFinds([finder()], { date: '2026-10-03', paycheck: null })
    expect(two.refusals[0]?.reason).toContain('"October", "October bonus"')
    expect(two.cells['paycheck']).toBeNull()
  })

  it('never moves a link a person set, and leaves one a person emptied', () => {
    expect(applyFinds([finder()], { date: '2026-09-14', paycheck: 'oct' }).cells['paycheck']).toBe('oct')
    const emptied = applyFinds([finder()], { paycheck: null }, { date: '2026-09-14', paycheck: 'sep' })
    expect(emptied.cells['paycheck']).toBeNull()
    expect(emptied.refusals).toEqual([])
  })

  it('finds again when the date moves and the link was the old date’s own', () => {
    const moved = applyFinds([finder()], { date: '2026-10-02' }, { date: '2026-09-30', paycheck: 'sep' })
    // October has two slips, so the move is refused rather than left pointing at September.
    expect(moved.refusals[0]?.reason).toContain('October bonus')
    const rows = SLIPS.filter((each) => each.id !== 'oct2')
    expect(applyFinds([finder(BY_MONTH, rows)], { date: '2026-10-02' }, { date: '2026-09-30', paycheck: 'sep' }).cells['paycheck']).toBe('oct')
    // A link a person pointed elsewhere stays where they put it.
    expect(applyFinds([finder(BY_MONTH, rows)], { date: '2026-10-02' }, { date: '2026-09-30', paycheck: 'oct' }).cells['paycheck']).toBeUndefined()
  })

  it('leaves a row with no date alone', () => {
    expect(applyFinds([finder()], { hours: 8, paycheck: null })).toEqual({ cells: { hours: 8, paycheck: null }, refusals: [] })
  })
})

describe('planFinds — the rule over the rows already there (M29 F11, D-353)', () => {
  const rows = [
    { id: 'a', cells: { date: '2026-09-14', hours: 8, paycheck: null } },
    { id: 'b', cells: { date: '2026-10-02', hours: 8, paycheck: null } },
    { id: 'c', cells: { date: '2026-12-01', hours: 8, paycheck: null } },
    { id: 'd', cells: { date: null, hours: 8, paycheck: null } },
    { id: 'e', cells: { date: '2026-09-20', hours: 8, paycheck: 'oct' } },
  ]

  it('places what it can, names what it cannot, and asks nothing of a link already set', () => {
    const plan = planFinds(finder(), DAY, rows)
    expect(plan.rows).toBe(5)
    expect(plan.empty).toBe(4)
    expect(plan.placements).toEqual([{ id: 'a', name: undefined, date: '2026-09-14', to: 'sep', toName: 'September' }])
    expect(plan.unplaced).toEqual([
      { kind: 'MANY', id: 'b', name: undefined, date: '2026-10-02', names: ['October', 'October bonus'] },
      { kind: 'NONE', id: 'c', name: undefined, date: '2026-12-01' },
      { kind: 'NO_DATE', id: 'd', name: undefined },
    ])
  })
})
