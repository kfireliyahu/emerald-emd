import type { Category } from '@/data/repositories/categoryRepository.ts'
import { MAX_CATEGORY_DEPTH, placementProblem } from '@/domain/categoryTree.ts'

/**
 * The categories a new one can go under: any with room below it in the three
 * levels (M28 F29, D-348), not built in, not archived. One list for the
 * categories screen, the picker's create form (M28 F17) and Plan's, so none of
 * them offers a parent `createCategory` would refuse.
 */
export function eligibleParents(categories: readonly Category[]): readonly Category[] {
  return categories.filter(
    (category) => category.depth < MAX_CATEGORY_DEPTH && !category.isSystem && !category.isArchived,
  )
}

/**
 * Where an existing category can move (M28 F29): a live parent of its own kind,
 * not itself or anything under it, with room for it and what it carries.
 */
export function parentsFor(categories: readonly Category[], source: Category): readonly Category[] {
  return eligibleParents(categories).filter(
    (parent) => parent.kind === source.kind && placementProblem(categories, parent.id, source.id) === undefined,
  )
}

/**
 * The parents that match what was typed in the new-category form (M28 F9).
 * Case-insensitive substring over the path, so `living` finds what is under
 * Living too; an empty search is every parent.
 */
export function matchingParents(parents: readonly Category[], typed: string): readonly Category[] {
  const needle = typed.trim().toLocaleLowerCase()
  if (needle === '') return parents
  return parents.filter((parent) => parent.path.toLocaleLowerCase().includes(needle))
}
