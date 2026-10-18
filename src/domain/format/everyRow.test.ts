/**
 * **A total over every row of a format** — M34 U4, D-397: written `every
 * course`, a word rather than a column left out; one hop still a parse rule;
 * a language of its own; and on the graph a curve to the whole bubble.
 */

import { describe, expect, it } from 'vitest'

import {
  aggregate,
  aggregateSentence,
  evaluateAggregate,
  foldsEvery,
  inputsWithTotals,
  overText,
  type AggregateDeclaration,
} from './aggregate.ts'
import { parse, write } from './artefact.ts'
import { edgeHeadline, edgesOf, headlineOf } from './connections.ts'
import {
  aggregateRejection,
  column,
  declarationProblems,
  EVERY_ROW_LANGUAGE,
  type FormatDeclaration,
} from './declaration.ts'
import { evaluateIdentity, identity, type IdentityInputs } from './identity.ts'

const COURSE: FormatDeclaration = {
  language: EVERY_ROW_LANGUAGE,
  name: 'course',
  title: 'Course',
  notes: '',
  columns: [column('name', 'text'), column('grade', 'real'), column('points', 'real')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const WEIGHTED = aggregate('weighted', 'SUM', { format: 'course' }, { expression: 'grade * points' })
const CREDIT = aggregate('credit', 'SUM', { format: 'course' }, { expression: 'points' })

const DEGREE: FormatDeclaration = {
  language: EVERY_ROW_LANGUAGE,
  name: 'degree',
  title: 'Degree',
  notes: '',
  columns: [column('name', 'text'), column('stated_average', 'real')],
  identities: [identity('average_holds', 'stated_average = weighted / credit')],
  aggregates: [WEIGHTED, CREDIT],
  nothingMustHold: false,
}

const GRADES: readonly (readonly [number, number])[] = [
  [90, 10],
  [80, 10],
  [85, 10],
  [82, 10],
  [86, 6],
  [85, 4],
]

function courses(grades: readonly (readonly [number, number])[]): IdentityInputs[] {
  return grades.map(([grade, points], at) => ({
    id: `c${String(at + 1)}`,
    numbers: new Map([
      ['grade', grade],
      ['points', points],
    ]),
    currencies: new Map(),
  }))
}

function verdictFor(grades: readonly (readonly [number, number])[], stated: number) {
  const rows = courses(grades)
  const totals = [WEIGHTED, CREDIT].map((each: AggregateDeclaration) => ({
    aggregate: each,
    value: evaluateAggregate(each, rows),
  }))
  const inputs = inputsWithTotals(
    { id: 'd1', numbers: new Map([['stated_average', stated]]), currencies: new Map() },
    totals,
  )
  const [holds] = DEGREE.identities
  if (holds === undefined) throw new Error('no identity')
  return evaluateIdentity(holds, inputs)
}

describe('a total over every row of a format (M34 U4)', () => {
  it('fails 85 against the 84.52 the courses give, and proves it once one grade moves', () => {
    const failed = verdictFor(GRADES, 85)
    expect(failed.kind).toBe('FAILED')
    if (failed.kind === 'FAILED') {
      expect(failed.left).toBe(85)
      expect(failed.right).toBeCloseTo(84.52, 10)
    }
    const moved = GRADES.map(([grade, points], at) => [at === 5 ? 91 : grade, points] as const)
    expect(verdictFor(moved, 85).kind).toBe('PROVED')
  })

  it('says it folds every row, and that a format with none has none', () => {
    const value = evaluateAggregate(CREDIT, courses(GRADES))
    expect(aggregateSentence(CREDIT, value)).toBe('credit: 50 — the sum over every row of course, 6 rows.')
    const average = aggregate('mean', 'AVERAGE', { format: 'course' }, { expression: 'grade' })
    const none = evaluateAggregate(average, [])
    expect(none.kind === 'UNCHECKED' ? none.reason : '').toBe('course has no row, and there is no average of nothing.')
  })

  it('is written `every course` and reads back the same', () => {
    expect(foldsEvery(WEIGHTED.over)).toBe(true)
    expect(overText(WEIGHTED)).toBe('every course')
    const text = write(DEGREE)
    expect(text).toContain('| every course |')
    const back = parse(text)
    expect(back.ok).toBe(true)
    if (back.ok) {
      expect(back.value.aggregates[0]?.over).toEqual({ format: 'course' })
      expect(foldsEvery(back.value.aggregates[0]?.over ?? { format: '' })).toBe(true)
    }
  })

  it('keeps a forgotten column a refusal, and one hop a parse rule', () => {
    const forgot = write(DEGREE).replace('| every course |', '| course |')
    const refused = parse(forgot)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('every course')

    const hopped = aggregate('far', 'SUM', { format: 'course' }, { expression: 'teacher.school.size' })
    expect(aggregateRejection(hopped, DEGREE, [COURSE])).toBeDefined()
    expect(aggregateRejection(WEIGHTED, DEGREE, [COURSE])).toBeUndefined()
  })

  it('needs the language that can say it', () => {
    const older = { ...DEGREE, language: EVERY_ROW_LANGUAGE - 1 }
    const problems = declarationProblems(older, [COURSE]).map((each) => each.message)
    expect(problems.join(' ')).toContain(`folds every row of course, which format language ${String(EVERY_ROW_LANGUAGE)} says`)
    expect(declarationProblems(DEGREE, [COURSE])).toEqual([])
  })

  it('draws its curve to the whole bubble, and says every course', () => {
    const [edge] = edgesOf([COURSE, DEGREE]).filter((each) => each.kind === 'FIGURE')
    expect(edge?.to).toEqual({ kind: 'ROW', format: 'course' })
    expect(edge?.dangling).toBe(false)
    if (edge !== undefined) {
      expect(edgeHeadline(edge, [COURSE, DEGREE])).toBe('Each degree adds up the weighted of every course.')
    }
    expect(
      headlineOf({ kind: 'FIGURE', format: 'degree', over: { format: 'course' } }, [COURSE, DEGREE], {
        total: { kind: 'AVERAGE', name: 'grade_average' },
      }),
    ).toBe('Each degree shows the average grade_average of every course.')
  })
})
