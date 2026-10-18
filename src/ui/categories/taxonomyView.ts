import type { Category } from '@/data/repositories/categoryRepository.ts'

/**
 * The shape the categories screen draws: **the top of the tree as headings**,
 * each holding the categories under it, each holding its own children — three
 * levels (M28 F29, D-348). The headings were groups until the groups became
 * top-level categories; a heading is a category now, picked, renamed and
 * budgeted like any other.
 *
 * The screen used to render one flat list with the subcategories indented by a
 * left padding, which is a picture of a tree rather than a tree — nothing could
 * be collapsed, nothing could be searched, and a taxonomy of forty-six rows was
 * a scroll with no landmarks. This module is the shaping, kept out of the
 * component so the filtering rule can be tested rather than eyeballed.
 *
 * **The filter's rule is the one that always trips people up**: a parent stays
 * on screen when a child matches, because a subcategory with no parent above it
 * is a row you cannot read. It is marked as context rather than as a match, so
 * the screen can say which rows actually answered the search.
 */
export interface TaxonomyRow {
  readonly category: Category
  readonly children: readonly Category[]
  /** True when the row is only here to hold up a matching child. */
  readonly contextOnly: boolean
}

export interface TaxonomySection {
  /** The top-level category this section is — its heading. */
  readonly category: Category
  /** True when the heading is only here to hold up a match below it. */
  readonly contextOnly: boolean
  readonly rows: readonly TaxonomyRow[]
  /** Categories under the heading after filtering, children included. */
  readonly shown: number
  /** How many of them nothing has ever been filed into. */
  readonly unused: number
}

/**
 * Head, nest and filter, in the order `listCategories` already sorted.
 *
 * `used` answers "has anything ever been filed here", which is the only part of
 * the activity read this module needs; the figures themselves are the row's
 * business.
 */
export function buildTaxonomy(
  categories: readonly Category[],
  options: {
    readonly search?: string
    readonly used?: (id: string) => boolean
  } = {},
): readonly TaxonomySection[] {
  const needle = (options.search ?? '').trim().toLocaleLowerCase()
  const used = options.used ?? (() => true)

  const matches = (category: Category): boolean =>
    needle === '' || category.path.toLocaleLowerCase().includes(needle)

  const present = new Set(categories.map((category) => category.id))
  const childrenOf = new Map<string, Category[]>()
  for (const category of categories) {
    const parentId = category.parentId
    if (parentId === undefined || !present.has(parentId)) continue
    const existing = childrenOf.get(parentId)
    if (existing === undefined) childrenOf.set(parentId, [category])
    else existing.push(category)
  }

  // A row and the children it shows: all of them when it matches, the ones
  // that do when it does not, and nothing at all when neither does.
  const rowOf = (category: Category, inherited: boolean): TaxonomyRow | undefined => {
    const own = inherited || matches(category)
    const children = childrenOf.get(category.id) ?? []
    const shownChildren = own ? children : children.filter(matches)
    if (!own && shownChildren.length === 0) return undefined
    return { category, children: shownChildren, contextOnly: !own }
  }

  const sections: TaxonomySection[] = []
  for (const category of categories) {
    // A category is a heading when it is at the top, or when its parent is not
    // in the list at all — an archived parent with the archived filter off.
    // Then it stands on its own rather than disappearing with it.
    if (category.parentId !== undefined && present.has(category.parentId)) continue

    const headMatch = matches(category)
    const rows = (childrenOf.get(category.id) ?? [])
      .map((child) => rowOf(child, headMatch))
      .filter((row): row is TaxonomyRow => row !== undefined)
    if (!headMatch && rows.length === 0) continue

    const all = rows.flatMap((row) => [row.category, ...row.children])
    sections.push({
      category,
      contextOnly: !headMatch,
      rows,
      shown: all.length,
      unused: all.filter((one) => !used(one.id)).length,
    })
  }
  return sections
}
