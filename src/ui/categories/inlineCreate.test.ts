import { describe, expect, it } from 'vitest'

import type { Category } from '@/data/repositories/categoryRepository.ts'
import { inlineCategory, offersCreate, twinOf } from './inlineCreate.ts'

/**
 * The two decisions behind the picker's create offer (D-158).
 *
 * Both fail quietly if they are wrong: an offer that never appears reads as a
 * feature that was never built — which is what F02 said about this one for four
 * milestones — and a twin that gets written reads as success until the totals
 * are split across two categories with the same name.
 */

function category(
  name: string,
  extra: { path?: string; parentId?: string } = {},
): Category {
  return {
    id: `id-${name}-${extra.parentId ?? 'top'}`,
    name,
    parentId: extra.parentId,
    depth: 1,
    kind: 'EXPENSE',
    isSystem: false,
    isArchived: false,
    color: undefined,
    icon: undefined,
    path: extra.path ?? name,
  }
}

const CATEGORIES: readonly Category[] = [
  category('Groceries'),
  category('Coffee shops'),
  category('Water', { parentId: 'utilities', path: 'Utilities → Water' }),
]

describe('offering to create the category that was typed', () => {
  it('offers nothing for an empty box, so the plain list is untouched', () => {
    expect(offersCreate(CATEGORIES, '')).toBe(false)
    expect(offersCreate(CATEGORIES, '   ')).toBe(false)
  })

  it('withholds the offer when the name is taken, by name or by full path', () => {
    expect(offersCreate(CATEGORIES, 'Groceries')).toBe(false)
    expect(offersCreate(CATEGORIES, 'groceries')).toBe(false)
    expect(offersCreate(CATEGORIES, '  Groceries  ')).toBe(false)
    expect(offersCreate(CATEGORIES, 'Water')).toBe(false)
    expect(offersCreate(CATEGORIES, 'Utilities → Water')).toBe(false)
  })

  /**
   * The one that matters, and the one a "no matches" implementation gets
   * wrong: `Coffee` is exactly when you want a new category, and it is also
   * exactly when the filtered list is not empty.
   */
  it('offers the name even while something else contains it', () => {
    expect(offersCreate(CATEGORIES, 'Coffee')).toBe(true)
    expect(offersCreate(CATEGORIES, 'Groc')).toBe(true)
    expect(offersCreate(CATEGORIES, 'Rent')).toBe(true)
  })
})

describe('the twin a create would have duplicated', () => {
  it('finds a top-level twin however the top level is spelled', () => {
    expect(twinOf(CATEGORIES, 'Groceries', undefined)?.name).toBe('Groceries')
    expect(twinOf(CATEGORIES, 'groceries', '')?.name).toBe('Groceries')
  })

  it('is scoped to the parent, because two parents may each want a Water', () => {
    expect(twinOf(CATEGORIES, 'Water', 'utilities')?.name).toBe('Water')
    expect(twinOf(CATEGORIES, 'Water', undefined)).toBeUndefined()
    expect(twinOf(CATEGORIES, 'Groceries', 'utilities')).toBeUndefined()
  })

  it('matches on the name and not on the path, which no form ever asks for', () => {
    expect(twinOf(CATEGORIES, 'Utilities → Water', 'utilities')).toBeUndefined()
  })

  it('finds nothing for an empty name rather than the first category', () => {
    expect(twinOf(CATEGORIES, '   ', undefined)).toBeUndefined()
  })
})

describe('what the picker asks createCategory for (M28 F28)', () => {
  it('sends a top-level category with its kind', () => {
    expect(inlineCategory({ name: ' Gym ', kind: 'EXPENSE', parentId: '' })).toEqual({ name: 'Gym', kind: 'EXPENSE' })
  })

  it('sends the parent, whose kind createCategory takes', () => {
    expect(inlineCategory({ name: 'Gym', kind: 'EXPENSE', parentId: 'p1' })).toEqual({
      name: 'Gym',
      kind: 'EXPENSE',
      parentId: 'p1',
    })
  })
})
