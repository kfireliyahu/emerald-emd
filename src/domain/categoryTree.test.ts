import { describe, expect, it } from 'vitest'

import { depthOf, heightOf, placementProblem, subtreeOf } from './categoryTree.ts'

// Living → Utilities → Electricity, Living → Groceries, and Transport on its own.
const tree = [
  { id: 'living', parentId: undefined },
  { id: 'utilities', parentId: 'living' },
  { id: 'power', parentId: 'utilities' },
  { id: 'groceries', parentId: 'living' },
  { id: 'transport', parentId: undefined },
]

describe('the category tree (M28 F29)', () => {
  it('measures depth from the top and height from the bottom', () => {
    expect(depthOf(tree, 'living')).toBe(1)
    expect(depthOf(tree, 'power')).toBe(3)
    expect(heightOf(tree, 'living')).toBe(3)
    expect(heightOf(tree, 'groceries')).toBe(1)
  })

  it('finds everything under a category', () => {
    expect([...subtreeOf(tree, 'living')].sort()).toEqual(['groceries', 'living', 'power', 'utilities'])
  })

  it('places a category only where it and what it carries fit in three levels', () => {
    expect(placementProblem(tree, 'utilities')).toBeUndefined()
    expect(placementProblem(tree, 'power')).toMatch(/3 levels at most/)
    expect(placementProblem(tree, 'transport', 'utilities')).toBeUndefined()
    expect(placementProblem(tree, 'groceries', 'utilities')).toMatch(/would go past that/)
    expect(placementProblem(tree, 'utilities', 'living')).toMatch(/its own subcategories/)
    expect(placementProblem(tree, 'living', 'living')).toMatch(/its own parent/)
  })

  it('does not loop on a cycle a hand edit made', () => {
    const cycle = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]
    expect(depthOf(cycle, 'a')).toBe(2)
  })
})
