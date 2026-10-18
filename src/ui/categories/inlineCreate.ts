import type { Category, CategoryKind, NewCategory } from '@/data/repositories/categoryRepository.ts'

/**
 * The two decisions behind *create the category you just typed* (D-158).
 *
 * They are here rather than inside `CategoryPicker` because they are the only
 * part of that feature a test can hold still, and they are both the kind of
 * rule that is wrong in a way nobody notices: an offer that does not appear
 * looks like the feature is missing, and a twin that gets created looks like it
 * worked.
 */

/**
 * Whether to offer to create `typed`.
 *
 * **Not "nothing matched".** `Coffee` is a category you may well want while
 * `Coffee shops` exists, and the picker filters by substring — so withholding
 * the offer whenever something contains what you typed would withhold it
 * exactly when a new sibling is most likely what you meant. The offer goes when
 * the name is *taken*: an existing category's own name, or its full path.
 *
 * Case- and whitespace-insensitive, because `groceries` and `Groceries ` are
 * the same request and two categories differing by a space is a taxonomy bug
 * that takes a year to notice.
 */
export function offersCreate(categories: readonly Category[], typed: string): boolean {
  const needle = typed.trim().toLocaleLowerCase()
  if (needle === '') return false
  return !categories.some(
    (category) =>
      category.name.toLocaleLowerCase() === needle || category.path.toLocaleLowerCase() === needle,
  )
}

/**
 * The category this create would duplicate, if there is one.
 *
 * Same name under the same parent. `createCategory` does not check — nothing in
 * the app stops two siblings sharing a name — so the form checks before it
 * writes, and the answer is to *choose* the one that exists rather than to
 * refuse: the user asked for a category with that name on that row, and one is
 * already there.
 *
 * The parent is compared as `id ?? ''` on both sides, because the form holds
 * the top level as `''` (a select's value cannot be `undefined`) and a
 * top-level category holds it as `undefined`.
 */
export function twinOf(
  categories: readonly Category[],
  name: string,
  parentId: string | undefined,
): Category | undefined {
  const needle = name.trim().toLocaleLowerCase()
  if (needle === '') return undefined
  return categories.find(
    (category) =>
      category.name.toLocaleLowerCase() === needle &&
      (category.parentId ?? '') === (parentId ?? ''),
  )
}

/**
 * What the picker's create form asks `createCategory` for (M28 F28): the form
 * holds the top level as `''`, as a select's value must be. Under a parent the
 * kind is the parent's — `createCategory` enforces it whatever it is sent.
 */
export function inlineCategory(draft: {
  readonly name: string
  readonly kind: CategoryKind
  readonly parentId: string
}): NewCategory {
  const name = draft.name.trim()
  if (draft.parentId !== '') return { name, kind: draft.kind, parentId: draft.parentId }
  return { name, kind: draft.kind }
}
