import { describe, expect, it } from 'vitest'

import type { Category } from '@/data/repositories/categoryRepository.ts'
import { buildTaxonomy } from './taxonomyView.ts'

function category(id: string, name: string, path: string, over: Partial<Category> = {}): Category {
  return {
    id,
    name,
    parentId: undefined,
    depth: path.split(' → ').length,
    kind: 'EXPENSE',
    isSystem: false,
    isArchived: false,
    color: undefined,
    icon: undefined,
    path,
    ...over,
  }
}

// The order listCategories gives: a top level, then what is under it, depth first.
const living = category('cat:living', 'Living', 'Living')
const utilities = category('cat:utilities', 'Utilities', 'Living → Utilities', { parentId: 'cat:living' })
const electricity = category('cat:electricity', 'Electricity', 'Living → Utilities → Electricity', {
  parentId: 'cat:utilities',
})
const water = category('cat:water', 'Water', 'Living → Utilities → Water', { parentId: 'cat:utilities' })
const groceries = category('cat:groceries', 'Groceries', 'Living → Groceries', { parentId: 'cat:living' })
const transport = category('cat:transport', 'Transport', 'Transport')
const fuel = category('cat:fuel', 'Fuel', 'Transport → Fuel', { parentId: 'cat:transport' })
const loans = category('cat:loans', 'Loan payments', 'Loan payments')

const all = [living, utilities, electricity, water, groceries, transport, fuel, loans]

describe('buildTaxonomy (M28 F29: the top of the tree is the headings)', () => {
  it('heads a section with each top-level category, and nests three levels under it', () => {
    const sections = buildTaxonomy(all)

    expect(sections.map((one) => one.category.name)).toEqual(['Living', 'Transport', 'Loan payments'])
    const first = sections[0]
    expect(first?.rows.map((row) => row.category.id)).toEqual(['cat:utilities', 'cat:groceries'])
    expect(first?.rows[0]?.children.map((one) => one.id)).toEqual(['cat:electricity', 'cat:water'])
    expect(first?.shown).toBe(4)
    // A top-level category nothing sits under is a heading of its own.
    expect(sections[2]?.rows).toEqual([])
  })

  it('keeps a parent and its heading on screen to hold up a matching child, marked as context', () => {
    const sections = buildTaxonomy(all, { search: 'water' })

    expect(sections).toHaveLength(1)
    expect(sections[0]?.contextOnly).toBe(true)
    const row = sections[0]?.rows[0]
    expect(row?.category.id).toBe('cat:utilities')
    expect(row?.contextOnly).toBe(true)
    expect(row?.children.map((one) => one.id)).toEqual(['cat:water'])
  })

  it('brings everything under a heading or a row that itself matches', () => {
    const byRow = buildTaxonomy(all, { search: 'utilities' })
    expect(byRow[0]?.rows.map((row) => row.category.id)).toEqual(['cat:utilities'])
    expect(byRow[0]?.rows[0]?.children).toHaveLength(2)

    // The path is what is searched, so a heading's name finds what is under it.
    const byHeading = buildTaxonomy(all, { search: 'living' })
    expect(byHeading[0]?.contextOnly).toBe(false)
    expect(byHeading[0]?.shown).toBe(4)
  })

  it('drops a heading entirely when nothing in it matches', () => {
    expect(buildTaxonomy(all, { search: 'fuel' }).map((one) => one.category.name)).toEqual(['Transport'])
  })

  it('stands an orphaned subcategory up as a heading rather than losing it with its parent', () => {
    // What the screen sees when the parent is archived and archived rows are off.
    const sections = buildTaxonomy([utilities, electricity, transport])

    expect(sections.map((one) => one.category.id)).toEqual(['cat:utilities', 'cat:transport'])
    expect(sections[0]?.rows.map((row) => row.category.id)).toEqual(['cat:electricity'])
  })

  it('counts what nothing has ever been filed into under a heading, children included', () => {
    const busy = new Set(['cat:groceries', 'cat:electricity'])
    const sections = buildTaxonomy(all, { used: (id) => busy.has(id) })

    expect(sections[0]?.unused).toBe(2)
    expect(sections[1]?.unused).toBe(1)
  })

  it('is empty for an empty taxonomy, and for a search that matches nothing', () => {
    expect(buildTaxonomy([])).toEqual([])
    expect(buildTaxonomy(all, { search: 'zzz' })).toEqual([])
  })
})
