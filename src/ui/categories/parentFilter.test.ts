import { describe, expect, it } from 'vitest'

import type { Category } from '@/data/repositories/categoryRepository.ts'
import { eligibleParents, matchingParents, parentsFor } from '@/ui/categories/parentFilter.ts'

const named = (name: string, more: Partial<Category> = {}): Category =>
  ({ id: name, name, path: name, depth: 1, kind: 'EXPENSE', isSystem: false, isArchived: false, ...more }) as unknown as Category

describe('matchingParents', () => {
  const parents = [named('Groceries'), named('Home'), named('מזון')]

  it('keeps everything while nothing is typed', () => {
    expect(matchingParents(parents, '  ')).toHaveLength(3)
  })

  it('filters by substring, ignoring case', () => {
    expect(matchingParents(parents, 'GRO').map((p) => p.name)).toEqual(['Groceries'])
  })

  it('filters Hebrew names', () => {
    expect(matchingParents(parents, 'מז').map((p) => p.name)).toEqual(['מזון'])
  })
})

describe('eligibleParents', () => {
  it('keeps the categories with room under them, that a person made and still uses (M28 F29)', () => {
    const all = [
      named('Living'),
      named('Utilities', { parentId: 'Living', depth: 2 }),
      named('Electricity', { parentId: 'Utilities', depth: 3 }),
      named('Uncategorized', { isSystem: true }),
      named('Old', { isArchived: true }),
      named('Home'),
    ]
    expect(eligibleParents(all).map((p) => p.name)).toEqual(['Living', 'Utilities', 'Home'])
  })

  it('matches a path, so a top level finds what is under it', () => {
    const all = [named('Living'), named('Utilities', { parentId: 'Living', depth: 2, path: 'Living → Utilities' })]
    expect(matchingParents(all, 'living').map((p) => p.name)).toEqual(['Living', 'Utilities'])
  })
})

describe('parentsFor', () => {
  const all = [
    named('Living'),
    named('Utilities', { parentId: 'Living', depth: 2 }),
    named('Electricity', { parentId: 'Utilities', depth: 3 }),
    named('Transport'),
    named('Fuel', { parentId: 'Transport', depth: 2 }),
    named('Salary', { kind: 'INCOME' }),
  ]
  const find = (name: string): Category => all.find((one) => one.name === name) as Category

  it('offers its own kind with room for what it carries, never itself or what is under it', () => {
    // Utilities carries Electricity: under a top level only, where it is or another.
    expect(parentsFor(all, find('Utilities')).map((p) => p.name)).toEqual(['Living', 'Transport'])
    // Living carries two levels, so nothing can hold it.
    expect(parentsFor(all, find('Living'))).toEqual([])
    // A leaf goes under anything of its kind with room.
    expect(parentsFor(all, find('Fuel')).map((p) => p.name)).toEqual(['Living', 'Utilities', 'Transport'])
  })
})
