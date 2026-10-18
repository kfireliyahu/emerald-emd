import { describe, expect, it } from 'vitest'

import { aggregate } from './aggregate.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from './declaration.ts'
import { derived } from './derived.ts'
import {
  acceptsBounds,
  acceptsUnit,
  closenessOf,
  columnIsBlank,
  declarationOf,
  draftOf,
  draftProblems,
  followingRenames,
  freehandIdentities,
  headIsBlank,
  identityNameFor,
  moveColumn,
  newColumn,
  newDraft,
  pruned,
  newIdentity,
  originOf,
  problemsOfColumn,
  problemsOfIdentity,
  renamesOf,
  retype,
  suggestedName,
  withCloseness,
  type ColumnDraft,
  type FormatDraft,
  type IdentityDraft,
} from './draft.ts'

function draft(overrides: Partial<FormatDraft> = {}): FormatDraft {
  return {
    ...newDraft(),
    name: 'ingredient',
    title: 'Ingredient',
    ...overrides,
  }
}

function columnDraft(overrides: Partial<ColumnDraft> = {}): ColumnDraft {
  return { ...newColumn(), name: 'kcal', type: 'real', ...overrides }
}

describe('a draft holds what was typed', () => {
  it('keeps a bound as text, so a half-typed minus sign is not a keystroke the form ate', () => {
    // The whole reason this shape exists: `-` is neither a number nor nothing,
    // and a form storing numbers would have to discard it or refuse it.
    const half = draft({ columns: [columnDraft({ minimum: '-' })] })
    expect(half.columns[0]?.minimum).toBe('-')
    expect(declarationOf(half).columns[0]?.minimum).toBeNaN()

    const whole = draft({ columns: [columnDraft({ minimum: '-5' })] })
    expect(declarationOf(whole).columns[0]?.minimum).toBe(-5)
  })

  it('reads a blank bound as no bound and a blank unit as no unit', () => {
    const declaration = declarationOf(draft({ columns: [columnDraft({ minimum: ' ', unit: '  ' })] }))
    expect(declaration.columns[0]?.minimum).toBeUndefined()
    expect(declaration.columns[0]?.unit).toBeUndefined()
  })

  it('drops the empty pieces of an enum, because a trailing comma is on the way to the next member', () => {
    const declaration = declarationOf(
      draft({ columns: [columnDraft({ type: 'enum', values: 'analogue, mixed, ' })] }),
    )
    expect(declaration.columns[0]?.values).toEqual(['analogue', 'mixed'])
  })

  it('always produces a declaration, and lets declarationProblems judge it', () => {
    // Total on purpose: "can it be read" and "is it allowed" stay separate, the
    // way the artefact reader already keeps them.
    const declaration = declarationOf(draft({ name: '  ', columns: [] }))
    expect(declaration.name).toBe('')
    expect(declaration.columns).toEqual([])
  })
})

describe('an existing format, opened and closed again', () => {
  const ingredient: FormatDeclaration = {
    language: 1,
    name: 'ingredient',
    title: 'Ingredient',
    notes: 'Dry-weight values, which is what recipes measure.',
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    columns: [
      column('brand', 'text', { note: 'who made it' }),
      column('kcal', 'real', { unit: 'kcal', required: true, minimum: 0, maximum: 900 }),
      column('micros_basis', 'enum', { values: ['analogue', 'mixed', 'label'] }),
      column('price', 'money'),
    ],
  }

  it('round-trips through the editor unchanged, but always in this build’s language', () => {
    // The one field that is deliberately not preserved: a declaration opened and
    // saved is written in the language this build speaks (2 since U3), which is
    // what the integer is for. Everything a person typed survives.
    expect(declarationOf(draftOf(ingredient))).toEqual({
      ...ingredient,
      language: DECLARATION_LANGUAGE,
    })
  })

  it('remembers what it is revising, so its own name is not a duplicate of itself', () => {
    const opened = draftOf(ingredient)
    expect(opened.revising).toBe('ingredient')
    expect(draftProblems(opened, [ingredient, { ...ingredient, name: 'recipe' }])).toEqual([])
    // A new format with the same name is still a duplicate.
    expect(draftProblems({ ...opened, revising: undefined }, [ingredient])).toHaveLength(1)
  })
})

describe('re-typing a column clears what the new type cannot carry', () => {
  it('drops bounds when a number becomes text', () => {
    const bounded = columnDraft({ type: 'real', minimum: '0', maximum: '900' })
    const retyped = retype(bounded, 'text')
    expect(retyped.minimum).toBe('')
    expect(retyped.maximum).toBe('')
    // And the draft is then clean, rather than refused for a bound it no longer shows.
    expect(draftProblems(draft({ columns: [retyped] }))).toEqual([])
  })

  it('drops the members when an enum becomes something else, and keeps them on the way back', () => {
    const members = columnDraft({ type: 'enum', values: 'analogue, mixed' })
    expect(retype(members, 'text').values).toBe('')
    expect(retype(members, 'enum').values).toBe('analogue, mixed')
  })

  it('drops the unit when a column becomes money, because a currency lives in the row', () => {
    const grams = columnDraft({ type: 'real', unit: 'g' })
    expect(retype(grams, 'money').unit).toBe('')
    expect(acceptsUnit('money')).toBe(false)
    expect(acceptsBounds('text')).toBe(false)
    expect(acceptsBounds('integer')).toBe(true)
  })
})

describe('a problem knows which field it is about', () => {
  it('puts a column problem on that column and a format problem on the format', () => {
    const bad = columnDraft({ name: 'Sat Fat' })
    const problems = draftProblems(draft({ title: '', columns: [bad] }))

    expect(problems.filter((each) => each.where.kind === 'FORMAT').map((each) => each.message)).toEqual([
      'The format ingredient needs a title.',
    ])
    expect(problemsOfColumn(problems, bad.key)).toHaveLength(1)
    expect(problemsOfColumn(problems, bad.key)[0]?.message).toContain('Sat Fat')
  })

  it('reports every field at once, which a box showing one sentence could not', () => {
    // The editor's reason for existing: a person fixes four things in one pass.
    const first = columnDraft({ name: 'kcal', type: 'enum', values: '' })
    const second = columnDraft({ name: 'sodium', type: 'text', minimum: '3' })
    const problems = draftProblems(draft({ name: '', title: '', columns: [first, second] }))

    expect(problems.length).toBeGreaterThanOrEqual(4)
    expect(problemsOfColumn(problems, first.key)).toHaveLength(1)
    expect(problemsOfColumn(problems, second.key)).toHaveLength(1)
  })

  it('tells two columns of the same name apart, which is the case a name could not', () => {
    const first = columnDraft({ name: 'kcal' })
    const second = columnDraft({ name: 'kcal' })
    const problems = draftProblems(draft({ columns: [first, second] }))

    expect(problemsOfColumn(problems, first.key)).toEqual([])
    expect(problemsOfColumn(problems, second.key).map((each) => each.message)).toEqual([
      'Two columns are called kcal.',
    ])
  })

  it('catches a money column colliding with a plain one on a stored name', () => {
    const price = columnDraft({ name: 'price', type: 'money' })
    const minor = columnDraft({ name: 'price_minor', type: 'integer' })
    const problems = draftProblems(draft({ columns: [price, minor] }))
    expect(problemsOfColumn(problems, minor.key)[0]?.message).toContain('price_minor')
  })

  it('is empty for a draft that is ready, and for the one the editor opens with is not', () => {
    expect(draftProblems(draft({ columns: [columnDraft()] }))).toEqual([])
    // A new draft is unfinished rather than broken — it just has no name yet.
    expect(draftProblems(newDraft()).length).toBeGreaterThan(0)
  })

  it('says nothing has to add up when no identity is declared, and not otherwise (M29 F4, D-345)', () => {
    // The editor asked for it out loud — *Nothing does* — and the
    // verdict was "just let the user continue". A draft with no identity is
    // the saying; the plugin still takes `nothing_must_hold` in words.
    const none = draft({ columns: [columnDraft()] })
    expect(draftProblems(none)).toEqual([])
    expect(declarationOf(none).nothingMustHold).toBe(true)

    const one = draft({ columns: [columnDraft()], identities: [{ ...newIdentity(), name: 'atwater', expression: '4 * protein_g = kcal' }] })
    expect(declarationOf(one).nothingMustHold).toBe(false)
  })

  it('puts an identity’s problem on the identity that caused it', () => {
    const wrong = { ...newIdentity(), name: 'atwater', expression: '4*missing = kcal' }
    const problems = draftProblems(
      draft({ columns: [columnDraft()], identities: [wrong] }),
    )
    expect(problems.filter((each) => each.where.kind === 'FORMAT')).toEqual([])
    expect(problemsOfIdentity(problems, wrong.key)).toHaveLength(1)
    expect(problemsOfIdentity(problems, wrong.key)[0]?.message).toContain('missing')
  })

  it('carries an identity into the declaration and back, tolerance and all', () => {
    const atwater = {
      ...newIdentity(),
      name: 'atwater',
      expression: '4*protein_g = kcal',
      toleranceKind: 'RELATIVE' as const,
      amount: '2',
      note: 'the label rounds',
    }
    const declared = declarationOf(draft({ identities: [atwater] }))
    expect(declared.identities[0]).toEqual({
      name: 'atwater',
      expression: '4*protein_g = kcal',
      tolerance: { kind: 'RELATIVE', percent: 2 },
      note: 'the label rounds',
    })
    expect(draftOf(declared).identities[0]).toMatchObject({
      name: 'atwater',
      toleranceKind: 'RELATIVE',
      amount: '2',
    })
  })
})

describe('the suggested name', () => {
  it('slugs a title the way a column name has to be spelled', () => {
    expect(suggestedName('Sat fat (g)')).toBe('sat_fat_g')
    expect(suggestedName('  Micros basis  ')).toBe('micros_basis')
  })

  it('gives up rather than guess when the slug would not start with a letter', () => {
    // `2% milk` has no good guess, and inventing one puts a column nobody chose
    // into a real table.
    expect(suggestedName('2% milk')).toBe('')
    expect(suggestedName('עגבניה')).toBe('')
    expect(suggestedName('')).toBe('')
  })
})

describe('a field nobody has touched is unfinished, not wrong', () => {
  it('calls a new draft and its first column blank, so the editor does not open red', () => {
    const fresh = newDraft()
    expect(headIsBlank(fresh)).toBe(true)
    expect(fresh.columns.every(columnIsBlank)).toBe(true)
    // The problems are still all there — what the editor withholds is only the
    // colour, and Save stays disabled on the real count.
    expect(draftProblems(fresh).length).toBeGreaterThan(0)
  })

  it('stops calling one blank the moment anything is in it, including the checkbox', () => {
    expect(columnIsBlank(columnDraft({ name: '', type: 'text' }))).toBe(true)
    expect(columnIsBlank(columnDraft({ name: '', note: 'what it means' }))).toBe(false)
    expect(columnIsBlank(columnDraft({ name: '', required: true }))).toBe(false)
    expect(columnIsBlank(columnDraft({ name: 'kcal' }))).toBe(false)
    expect(headIsBlank(draft({ name: '', title: 'Ingredient' }))).toBe(false)
  })
})

describe('what has to add up, as three questions (T4, D-236)', () => {
  const identityDraft = (expression: string, extra: Partial<IdentityDraft> = {}) => ({
    ...newIdentity(),
    name: 'it',
    expression,
    ...extra,
  })

  it('reads how close as one of three answers, exact being a blank or a zero', () => {
    expect(closenessOf(identityDraft('a = b'))).toBe('EXACT')
    expect(closenessOf(identityDraft('a = b', { amount: '0' }))).toBe('EXACT')
    expect(closenessOf(identityDraft('a = b', { amount: '2' }))).toBe('AMOUNT')
    expect(closenessOf(identityDraft('a = b', { toleranceKind: 'RELATIVE', amount: '1' }))).toBe(
      'PERCENT',
    )
  })

  it('gives the allowance a figure when it stops being exact, so the question stays answered', () => {
    // A blank box reads back as exact, so leaving one would make the answer
    // flip back the instant it was given.
    const exact = identityDraft('a = b')
    expect(closenessOf(withCloseness(exact, 'AMOUNT'))).toBe('AMOUNT')
    expect(withCloseness(exact, 'AMOUNT').amount).toBe('1')
    expect(closenessOf(withCloseness(exact, 'PERCENT'))).toBe('PERCENT')

    // And it keeps a figure somebody typed when only the kind changes.
    const two = identityDraft('a = b', { amount: '2' })
    expect(withCloseness(two, 'PERCENT')).toMatchObject({ toleranceKind: 'RELATIVE', amount: '2' })
    expect(withCloseness(two, 'EXACT').amount).toBe('')
  })

  it('draws every identity exactly once, which is the whole point of the split', () => {
    // D-138's ninth instance was an edit form that showed six fields and wrote
    // two. An identity the questions do not ask about has to be somewhere, so
    // the freehand list is defined as everything the questions leave over.
    const asked = identityDraft('4 * protein_g = kcal')
    const algebra = identityDraft('kcal / (protein_g + carbs_g) = ratio')
    const orphan = identityDraft('4 * protein_g = renamed_away')
    const second = identityDraft('9 * fat_g = kcal')
    const all = draft({
      identities: [asked, algebra, orphan, second],
    })

    const answerable = ['kcal', 'protein_g', 'fat_g']
    const freehand = freehandIdentities(all, answerable).map((each) => each.key)
    expect(freehand).toEqual([algebra.key, orphan.key, second.key])

    // Every one of them, once.
    expect([...freehand, asked.key].sort()).toEqual(
      all.identities.map((each) => each.key).sort(),
    )
  })

  it('names the identity after the column, and keeps the name inside the limit', () => {
    expect(identityNameFor('kcal')).toBe('kcal_adds_up')
    expect(identityNameFor(' line_total ')).toBe('line_total_adds_up')
    expect(identityNameFor('c'.repeat(48)).length).toBe(48)
  })
})

describe('a filtered aggregate on the screen (M24 U8, D-260)', () => {
  it('is carried through an edit it does not show', () => {
    const where = { column: 'deduction_type.reduces_net', is: 'true' }
    const declaration: FormatDeclaration = {
      language: 8,
      name: 'paycheck',
      title: 'Paycheck',
      notes: '',
      nothingMustHold: true,
      identities: [],
      columns: [column('gross', 'money')],
      aggregates: [
        aggregate('deducted', 'SUM', { format: 'paycheck_line', column: 'paycheck' }, {
          expression: 'amount',
          where,
        }),
      ],
    }
    expect(declarationOf(draftOf(declaration)).aggregates[0]?.where).toEqual(where)
  })
})

describe('a format changed on its sheet (M26 U3)', () => {
  const INGREDIENT: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'ingredient',
    title: 'Ingredient',
    notes: '',
    columns: [column('name', 'text'), column('kcal', 'real')],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
  const LINE: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'line',
    title: 'Line',
    notes: '',
    columns: [
      column('ingredient', 'link', { target: 'ingredient' }),
      column('grams', 'real'),
      column('kcal', 'real'),
    ],
    identities: [
      {
        name: 'energy',
        expression: 'kcal = ingredient.kcal * grams / 100',
        tolerance: { kind: 'ABSOLUTE', amount: 1 },
        note: '',
      },
    ],
    aggregates: [],
    nothingMustHold: false,
  }

  it('knows a rename from a removal and an addition, by the key the column opened with', () => {
    const draft = draftOf(INGREDIENT)
    const origin = originOf(draft)
    const [name, kcal] = draft.columns
    if (name === undefined || kcal === undefined) throw new Error('two columns')
    const edited: FormatDraft = {
      ...draft,
      columns: [{ ...name, name: 'label' }, { ...newColumn(), name: 'kcal' }],
    }
    // `label` was `name`; the new `kcal` is a new column, not the old one kept.
    expect(renamesOf(edited, origin)).toEqual(new Map([['label', 'name']]))
  })

  it('says what a change would break in another format, by that format’s name', () => {
    const draft = draftOf(INGREDIENT)
    const renamed: FormatDraft = {
      ...draft,
      columns: draft.columns.map((each) => (each.name === 'kcal' ? { ...each, name: 'energy' } : each)),
    }
    const problems = draftProblems(renamed, [INGREDIENT, LINE])
    expect(problems.some((each) => each.message.startsWith('Line would break:'))).toBe(true)
    // Unchanged, nothing of the neighbour's is this edit's to report.
    expect(draftProblems(draft, [INGREDIENT, LINE])).toEqual([])
  })
})

describe('pruned', () => {
  it('drops the columns nobody filled in, and hands back the same draft when there are none', () => {
    const kept = { ...newColumn(), name: 'pages' }
    const draft = { ...newDraft(), columns: [kept, newColumn()] }
    expect(pruned(draft).columns).toEqual([kept])
    const untouched = { ...newDraft(), columns: [kept] }
    expect(pruned(untouched)).toBe(untouched)
  })
})

describe('moveColumn (M29 U2, D-332)', () => {
  const book = draftOf({
    language: DECLARATION_LANGUAGE,
    name: 'book',
    title: 'Book',
    notes: '',
    columns: [column('title', 'text'), column('pages', 'integer'), column('author', 'text')],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  })
  const keys = book.columns.map((each) => each.key)
  const names = (each: FormatDraft): string[] => each.columns.map((one) => one.name)

  it('puts a column just before another, or last', () => {
    expect(names(moveColumn(book, keys[2] ?? '', keys[0]))).toEqual(['author', 'title', 'pages'])
    expect(names(moveColumn(book, keys[0] ?? '', undefined))).toEqual(['pages', 'author', 'title'])
    expect(names(moveColumn(book, keys[0] ?? '', keys[2]))).toEqual(['pages', 'title', 'author'])
  })

  it('hands back the same draft when nothing moved, so it is not a change to save', () => {
    expect(moveColumn(book, keys[0] ?? '', keys[0])).toBe(book)
    expect(moveColumn(book, keys[0] ?? '', keys[1])).toBe(book)
    expect(moveColumn(book, keys[2] ?? '', undefined)).toBe(book)
    expect(moveColumn(book, 'nobody', undefined)).toBe(book)
  })

  it('keeps every column whole — a move changes the order and nothing else', () => {
    const moved = moveColumn(book, keys[1] ?? '', keys[0])
    expect(declarationOf(moved).columns).toEqual(
      [1, 0, 2].map((at) => declarationOf(book).columns[at]),
    )
  })
})

describe('a derived column in a draft (M29 U3b, D-334)', () => {
  const item: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'item',
    title: 'Item',
    notes: '',
    columns: [column('price', 'money'), column('qty', 'integer')],
    identities: [],
    aggregates: [],
    derived: [derived('total', 'price * qty', 'What the line costs.')],
    nothingMustHold: true,
  }

  it('survives an edit on screen, and follows a renamed column', () => {
    const draft = draftOf(item)
    expect(declarationOf(draft).derived).toEqual(item.derived)

    const renamed = {
      ...draft,
      columns: draft.columns.map((each) => (each.name === 'qty' ? { ...each, name: 'count' } : each)),
    }
    const followed = followingRenames(renamed, renamesOf(renamed, originOf(draft)))
    expect(declarationOf(followed).derived?.[0]?.expression).toBe('price * count')
  })

  it('draws a problem beside the derived column that caused it', () => {
    const draft = draftOf({ ...item, derived: [derived('total', 'price * price')] })
    const problems = draftProblems(draft)
    expect(problems).toContainEqual({
      where: { kind: 'DERIVED', key: draft.derived?.[0]?.key },
      message: expect.stringMatching(/money by money/),
    })
  })
})
