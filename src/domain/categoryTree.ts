/**
 * **The category tree's shape** — M28 F29 (D-348).
 *
 * Groups and top-level categories were two names for one thing, a heading that
 * collects what is under it, so they are one tree now: **three levels at most**
 * (Living → Utilities → Electricity). A top-level category is a heading Plan
 * and the Categories screen list things under; any category can be a budget's
 * target, and a figure for one counts everything filed under it.
 *
 * Pure, over anything with an id and a parent id, so the repository, the
 * screens and the plugin judge depth with the same few lines. The cap is pack
 * code and not a constraint: it compares a row with the rows it links to, and a
 * row constraint sees one (D-259).
 */

/** How deep the tree goes: a top-level category, its children, and theirs. */
export const MAX_CATEGORY_DEPTH = 3

export interface TreeNode {
  readonly id: string
  readonly parentId: string | undefined
}

/** 1 for a top-level category, 2 for its child, 3 for a grandchild. A cycle stops counting. */
export function depthOf(nodes: readonly TreeNode[], id: string): number {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let depth = 1
  const seen = new Set<string>([id])
  for (let at = byId.get(id)?.parentId; at !== undefined && !seen.has(at); at = byId.get(at)?.parentId) {
    seen.add(at)
    depth += 1
  }
  return depth
}

/** The category and everything under it, at any depth. */
export function subtreeOf(nodes: readonly TreeNode[], id: string): ReadonlySet<string> {
  const under = new Set<string>([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const node of nodes) {
      if (node.parentId !== undefined && under.has(node.parentId) && !under.has(node.id)) {
        under.add(node.id)
        grew = true
      }
    }
  }
  return under
}

/** How many levels a category and what is under it take: 1 for one with no children. */
export function heightOf(nodes: readonly TreeNode[], id: string): number {
  const children = nodes.filter((node) => node.parentId === id && node.id !== id)
  if (children.length === 0) return 1
  return 1 + Math.max(...children.map((child) => heightOf(nodes.filter((node) => node.id !== id), child.id)))
}

/**
 * Why `childId` (or a new category, when undefined) cannot go under `parentId`,
 * or `undefined` when it can: not under itself or anything below it, and not so
 * deep that it or what it carries would go past the third level.
 */
export function placementProblem(
  nodes: readonly TreeNode[],
  parentId: string,
  childId?: string,
): string | undefined {
  if (childId === parentId) return 'A category cannot be its own parent'
  if (childId !== undefined && subtreeOf(nodes, childId).has(parentId)) {
    return 'A category cannot go under one of its own subcategories'
  }
  const carried = childId === undefined ? 1 : heightOf(nodes, childId)
  if (depthOf(nodes, parentId) + carried > MAX_CATEGORY_DEPTH) {
    return carried > 1
      ? `Categories nest ${String(MAX_CATEGORY_DEPTH)} levels at most, and its subcategories would go past that`
      : `Categories nest ${String(MAX_CATEGORY_DEPTH)} levels at most`
  }
  return undefined
}
