import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { listed } from '@/core/text.ts'
import { MAX_CATEGORY_DEPTH, placementProblem, subtreeOf } from '@/domain/categoryTree.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { refileFixedExpenses } from './fixedExpenseRepository.ts'
import { countsCondition, isMovedKind } from './movedRepository.ts'
import { reaimBuckets } from './splitPlanRepository.ts'

export type CategoryKind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'SAVING' | 'DEBT_PAYMENT'

/** Where a category assignment came from. `MANUAL` is never overwritten by anything (D-009). */
export type CategorySource = 'MANUAL' | 'RULE' | 'AI' | 'INHERITED' | 'NONE'

/**
 * Migration 002's id for it, which the conversion keeps (M25 U2, D-268): a
 * converted row keeps the id every transaction already names it by.
 */
export const UNCATEGORIZED_ID = 'cat:uncategorized'

export interface Category {
  readonly id: string
  readonly name: string
  readonly parentId: string | undefined
  /** 1 at the top level, 3 at the deepest (M28 F29, D-348). */
  readonly depth: number
  readonly kind: CategoryKind
  readonly isSystem: boolean
  readonly isArchived: boolean
  /**
   * The colour a chart draws this category in — a `--color-category-*` token
   * name, not a hex value.
   *
   * A token rather than a colour because the app has two themes and a hex
   * chosen in one of them is wrong in the other; the palette carries a lifted
   * variant of every hue for the dark page (docs/11). Undefined means nobody has
   * chosen, and `categoryPalette` picks a stable slot from the id.
   *
   * The column has existed since migration `002` and nothing read it until the
   * donut needed one (D-088).
   */
  readonly color: string | undefined
  /** An emoji. Unread so far; the chips and the picker are where it lands. */
  readonly icon: string | undefined
  /** `Living → Utilities → Electricity`: every level, top first. Pickers show the path. */
  readonly path: string
}

/**
 * The live taxonomy, in the user's own order.
 *
 * Archived categories are out by default because that is what archiving is for
 * — every picker in the app calls this. The management screen is the one place
 * that asks for them, so it can bring one back.
 */
export function listCategories(
  db: Database,
  options: { readonly includeArchived?: boolean } = {},
): readonly Category[] {
  // Every row, archived included, so a live child of an archived parent still
  // has its path; the filter comes after the tree is built.
  const rows = query(
    db,
    `SELECT id, name, parent AS parent_id, kind, is_system, is_archived, sort_order, color, icon
       FROM fmt_category
      ORDER BY sort_order, name`,
  )
  const byId = new Map(rows.map((row) => [String(row['id']), row]))
  const parentOf = (row: Record<string, unknown>): string | undefined => {
    const parent = row['parent_id']
    return parent === null || parent === undefined || !byId.has(String(parent)) ? undefined : String(parent)
  }
  const childrenOf = new Map<string | undefined, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = parentOf(row)
    const list = childrenOf.get(key)
    if (list === undefined) childrenOf.set(key, [row])
    else list.push(row)
  }

  // **The tree in the user's own order** (M28 F29, D-348): a top-level
  // category, then what is under it, depth first — the order every picker, the
  // Categories screen and Plan's headings read.
  const ordered: Category[] = []
  const seen = new Set<string>()
  const visit = (row: Record<string, unknown>, trail: readonly string[]): void => {
    const id = String(row['id'])
    if (seen.has(id)) return
    seen.add(id)
    const name = String(row['name'])
    const path = [...trail, name]
    if (options.includeArchived === true || Number(row['is_archived']) !== 1) {
      ordered.push({
        id,
        name,
        parentId: parentOf(row),
        depth: path.length,
        kind: String(row['kind']) as CategoryKind,
        isSystem: Number(row['is_system']) === 1,
        isArchived: Number(row['is_archived']) === 1,
        color: row['color'] == null ? undefined : String(row['color']),
        icon: row['icon'] == null ? undefined : String(row['icon']),
        path: path.join(' → '),
      })
    }
    for (const child of childrenOf.get(id) ?? []) visit(child, path)
  }
  // System categories last at the top level, as their group had them:
  // Uncategorized and Internal Transfer are where things land, not headings.
  const tops = [...(childrenOf.get(undefined) ?? [])].sort(
    (a, b) => Number(a['is_system']) - Number(b['is_system']),
  )
  for (const row of tops) visit(row, [])
  // A row in a cycle a hand edit made has no top; it still shows, at the end.
  for (const row of rows) visit(row, [])
  return ordered
}

/**
 * Set — or clear — how a category is drawn: its colour slot and its icon.
 *
 * Both columns have existed since migration 002 and neither had ever been
 * written. The colour is a **token name** (`category-3`), not a hex: the app has
 * two themes and the palette carries a lifted variant of every hue for the dark
 * page, so a hex chosen against the white theme is the wrong colour on the black
 * one (D-088). Which names are legal is the palette's business, not this
 * layer's — `ui/charts/categoryColor.ts` owns the list and falls back to the
 * hashed slot for anything it does not recognize, which is also what makes an
 * older document written by a future palette harmless.
 *
 * `undefined` clears, in the same shape as `setMonthlyTarget`: no colour is not
 * a colour, and the hashed slot is what "no colour" looks like on a chart.
 *
 * The two travel together because they are one decision on one popover — a
 * separate writer per column would take two mutations, and every mutation
 * snapshots the document to the crash cache (D-052).
 */
export function setCategoryAppearance(
  db: Database,
  id: string,
  appearance: { readonly color: string | undefined; readonly icon: string | undefined },
  _now: number,
): void {
  updateRow(db, declared(db, 'category'), id, {
    color: appearance.color ?? null,
    icon: appearance.icon ?? null,
  })
}

/**
 * Assign a category by hand.
 *
 * Always recorded as `MANUAL`, which is what makes it permanent: no rule,
 * re-import, or AI pass may overwrite it (D-009). One instance of an override
 * being silently reverted destroys confidence in the whole system.
 */
export function setCategoryManually(
  db: Database,
  transactionId: string,
  categoryId: string | undefined,
  _now: number,
): void {
  db.run(
    `UPDATE fmt_transaction
        SET category = ?, category_source = ?, matched_rule = NULL
      WHERE id = ?`,
    [categoryId ?? null, categoryId === undefined ? 'NONE' : 'MANUAL', transactionId],
  )
}

/**
 * Assign a category because a rule said so, naming the rule.
 *
 * The rule id is not decoration: F03's second design commitment is that every
 * assignment names what made it, and `matched_rule_id` is what the detail
 * panel's provenance line and the "this rule never fires" view both read. A
 * `RULE` assignment is also the one kind that a later re-apply may revisit,
 * which is exactly why it must not be written as `MANUAL` (D-009).
 */
export function setCategoryFromRule(
  db: Database,
  transactionId: string,
  categoryId: string,
  ruleId: string,
  _now: number,
): void {
  db.run(
    `UPDATE fmt_transaction
        SET category = ?, category_source = 'RULE', matched_rule = ?
      WHERE id = ?`,
    [categoryId, ruleId, transactionId],
  )
}

/**
 * Assign a category because the assistant said so, through the Claude plugin.
 *
 * **`AI` is a label recording how the row got here, not a pending state** — the
 * meaning D-092 gave it when the plugin stopped parking its work in a review
 * queue. Nothing waits on it and nothing in the app treats it as unconfirmed;
 * what it buys is that a whole batch stays findable and reversible afterwards
 * without a queue to empty.
 *
 * Deliberately **not** written through `correctCategories`, which is the user's
 * own bulk path: that one writes `category_override` rows, and those are the
 * record of *a human correcting the machine*. Filling them with the machine's
 * own assignments would feed F03's learning offer its own output and invite it
 * to suggest rules from what it already did.
 *
 * The caller is responsible for never pointing this at a `MANUAL` row. That is
 * not politeness — "user overrides win" (docs/conventions.md, D-009) is the one
 * convention whose breach destroys confidence in every other assignment.
 */
export function setCategoryFromAssistant(
  db: Database,
  transactionId: string,
  categoryId: string,
  _now: number,
): void {
  db.run(
    `UPDATE fmt_transaction
        SET category = ?, category_source = 'AI', matched_rule = NULL
      WHERE id = ?`,
    [categoryId, transactionId],
  )
}

// --- Managing the taxonomy (docs/f02, "Operations") -------------------------

export interface NewCategory {
  readonly name: string
  readonly kind: CategoryKind
  readonly parentId?: string | undefined
}

/**
 * Create a category, placed last among its siblings.
 *
 * Last rather than alphabetical: the sort order is the user's, used identically
 * in every picker and chart legend (docs/f02), and quietly re-sorting the list
 * under them when they add one is not a thing a list should do.
 *
 * **A subcategory inherits its parent's kind**, and does so here rather than
 * in the caller. Letting them differ makes "Food → Salary" expressible, and
 * every statistic downstream then has to decide which one it meant. That rule
 * lived in the app's new-category form — correct, and in a React file, so the
 * second front end could not reach it and would have had to restate it. Same
 * find as the institution rules (D-097): a rule enforced by one caller is a
 * rule until a second caller exists.
 */
export function createCategory(db: Database, category: NewCategory, _now: number): string {
  const id = newId()
  const parent =
    category.parentId === undefined
      ? undefined
      : listCategories(db, { includeArchived: true }).find((one) => one.id === category.parentId)
  if (category.parentId !== undefined) refuseDepth(db, undefined, category.parentId)
  const parentId = parent?.id ?? category.parentId ?? null
  const kind = parent?.kind ?? category.kind
  refuseTakenName(db, category.name, undefined)

  const siblings = query(
    db,
    'SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM fmt_category WHERE parent IS ?',
    [parentId],
  )

  insertRows(
    db,
    declared(db, 'category'),
    [
      {
        name: category.name,
        parent: parentId,
        kind,
        is_system: 0,
        sort_order: Number(siblings[0]?.['next'] ?? 10),
        is_archived: 0,
      },
    ],
    [id],
  )
  return id
}

/**
 * Renaming is free and history follows it, because history points at the id.
 *
 * **A name is one category's** since M25 U2 (D-268) — it is what a seed and a
 * text document name the row by — so a name another category has is refused
 * with that category named, rather than by SQLite's index.
 */
export function renameCategory(db: Database, id: string, name: string, _now: number): void {
  refuseTakenName(db, name, id)
  updateRow(db, declared(db, 'category'), id, { name })
}

export class CategoryNameTakenError extends Error {
  constructor(readonly taken: Category) {
    super(
      `There is already a category called ${taken.name}` +
        `${taken.parentId === undefined ? '' : ` (${taken.path})`}. Give this one another name, or merge the two.`,
    )
    this.name = 'CategoryNameTakenError'
  }
}

function refuseTakenName(db: Database, name: string, except: string | undefined): void {
  const taken = listCategories(db, { includeArchived: true }).find(
    (one) => one.name === name.trim() && one.id !== except,
  )
  if (taken !== undefined) throw new CategoryNameTakenError(taken)
}

export class CategoryDepthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CategoryDepthError'
  }
}

/** The tree as `categoryTree` reads it: every row's id and parent. */
function treeOf(db: Database): readonly { readonly id: string; readonly parentId: string | undefined }[] {
  return query(db, 'SELECT id, parent FROM fmt_category').map((row) => ({
    id: String(row['id']),
    parentId: row['parent'] == null ? undefined : String(row['parent']),
  }))
}

/**
 * **The tree is three levels at most** (M28 F29, D-348) — it was two, with
 * groups above it, until the groups became the top level. A category may not
 * go under itself or anything below it, and not so deep that it or what it
 * carries passes the third level. The old table held the two-level cap with
 * four triggers (migrations 002 and 005); a row constraint sees one row and
 * this compares several (D-259), so it is the pack's code (M25 U2), and every
 * write of a parent comes through here.
 *
 * And **a system category takes no children**: Uncategorized and Internal
 * Transfer are where the ledger puts things, not headings.
 */
function refuseDepth(db: Database, id: string | undefined, parentId: string): void {
  if (id === parentId) throw new CategoryDepthError('A category cannot be its own parent')
  const parent = query(db, 'SELECT is_system FROM fmt_category WHERE id = ?', [parentId])[0]
  if (parent === undefined) throw new CategoryDepthError('That parent category no longer exists.')
  if (Number(parent['is_system']) === 1) throw new CategoryDepthError('A system category takes no subcategories')
  const problem = placementProblem(treeOf(db), parentId, id)
  if (problem !== undefined) throw new CategoryDepthError(problem)
}

/**
 * Move a category under a different parent, or to the top level with `undefined`.
 *
 * The three-level cap is checked here (`refuseDepth`), and **a parent and its
 * children share a kind** (M28 F29): moving an INCOME category under an EXPENSE
 * one would roll it up into a parent that means the opposite, so it is refused
 * rather than silently re-kinded. What it carries comes with it.
 */
export function reparentCategory(
  db: Database,
  id: string,
  parentId: string | undefined,
  _now: number,
): void {
  if (parentId === undefined) {
    updateRow(db, declared(db, 'category'), id, { parent: null })
    return
  }
  refuseDepth(db, id, parentId)
  const kinds = query(db, 'SELECT id, kind FROM fmt_category WHERE id IN (?, ?)', [id, parentId])
  const kindOf = (one: string): unknown => kinds.find((row) => String(row['id']) === one)?.['kind']
  if (kindOf(id) !== kindOf(parentId)) {
    throw new CategoryDepthError('A category goes under one of its own kind')
  }
  updateRow(db, declared(db, 'category'), id, { parent: parentId })
}

export function setCategoryArchived(
  db: Database,
  id: string,
  archived: boolean,
  _now: number,
): void {
  updateRow(db, declared(db, 'category'), id, { is_archived: archived ? 1 : 0 })
}

export interface CategoryUsage {
  readonly transactions: number
  readonly subcategories: number
  readonly isSystem: boolean
  /**
   * A person's rules that assign it (M25 U2). A rule is a row that links here
   * now and cannot point at nothing, so these stand in the way of a delete the
   * way transactions do; the built-in ones go with the category.
   */
  readonly rules: number
  /** Plan buckets aimed at it — its budget, in whichever plan holds one (D-327). */
  readonly budgets: number
  /** Fixed expenses filed under it, or matched by it. */
  readonly fixedExpenses: number
  /** Debts whose payments are tracked by it. */
  readonly debts: number
  /** Saving goals whose deposits are its rows (M28 U8). */
  readonly goals: number
}

/** How many rows of `table` name `id` in `column`. */
function countLinking(db: Database, table: string, column: string, id: string): number {
  return Number(query(db, `SELECT COUNT(*) AS n FROM ${table} WHERE "${column}" = ?`, [id])[0]?.['n'] ?? 0)
}

/** What would break if this category went away. The delete button asks this first. */
export function categoryUsage(db: Database, id: string): CategoryUsage {
  const rows = query(
    db,
    `SELECT
       (SELECT COUNT(*) FROM fmt_transaction WHERE category = ?) AS txns,
       (SELECT COUNT(*) FROM fmt_category WHERE parent = ?) AS kids,
       (SELECT is_system FROM fmt_category WHERE id = ?) AS system,
       (SELECT COUNT(*) FROM fmt_category_rule WHERE target = ? AND origin <> 'BUILT_IN') AS rules`,
    [id, id, id, id],
  )

  return {
    transactions: Number(rows[0]?.['txns'] ?? 0),
    subcategories: Number(rows[0]?.['kids'] ?? 0),
    isSystem: Number(rows[0]?.['system'] ?? 0) === 1,
    rules: Number(rows[0]?.['rules'] ?? 0),
    budgets: countLinking(db, 'fmt_split_bucket', 'target_category', id),
    fixedExpenses:
      countLinking(db, 'fmt_fixed_expense', 'category', id) + countLinking(db, 'fmt_fixed_expense', 'match_category', id),
    debts: countLinking(db, 'fmt_debt', 'auto_track_category', id),
    goals: countLinking(db, 'fmt_saving_goal', 'deposit_category', id),
  }
}

/**
 * **In use** is anything a delete would lose (M28 F18, D-340): a row filed
 * there, a person's rule, a subcategory, a budget, a fixed expense, a debt's
 * tracking or a goal's deposits. What is history or in progress — corrections,
 * a re-apply's undo, a review not yet filed, the built-in rules — is not: it is
 * forgotten with the category, as it always was.
 */
export function isCategoryInUse(usage: CategoryUsage): boolean {
  return (
    usage.transactions > 0 ||
    usage.subcategories > 0 ||
    usage.rules > 0 ||
    usage.budgets > 0 ||
    usage.fixedExpenses > 0 ||
    usage.debts > 0 ||
    usage.goals > 0
  )
}

/** What still uses it, as phrases: `12 rows`, `2 rules`, `1 budget`. Empty when nothing does. */
export function describeCategoryUsage(usage: CategoryUsage): readonly string[] {
  const some = (n: number, one: string, many: string): string | undefined =>
    n === 0 ? undefined : n === 1 ? `1 ${one}` : `${String(n)} ${many}`
  return [
    some(usage.transactions, 'row', 'rows'),
    some(usage.rules, 'rule', 'rules'),
    some(usage.subcategories, 'subcategory', 'subcategories'),
    some(usage.budgets, 'Plan bucket', 'Plan buckets'),
    some(usage.fixedExpenses, 'bill', 'bills'),
    some(usage.debts, 'debt tracked by it', 'debts tracked by it'),
    some(usage.goals, 'saving goal fed by it', 'saving goals fed by it'),
  ].filter((part): part is string => part !== undefined)
}

/** Which tab a kind is on: spending, money moved or income (D-316). */
function familyOf(kind: CategoryKind): 'SPENDING' | 'MOVED' | 'INCOME' {
  return kind === 'INCOME' ? 'INCOME' : isMovedKind(kind) ? 'MOVED' : 'SPENDING'
}

/**
 * Where a category in use can send what uses it before it goes (M28 F18,
 * D-340): a live, non-system category **of the same kind** — the tab it is on —
 * that is not itself or one of its children. If it has subcategories, only a
 * top-level one, since they move under it and the tree is two levels. And not
 * one a saving goal already reads its deposits from, when this one feeds a
 * goal: a category feeds one goal.
 *
 * **Empty is the refusal**: nowhere to move means the delete is refused and
 * says what still uses it.
 */
export function categoryDeleteTargets(db: Database, id: string): readonly Category[] {
  const source = listCategories(db, { includeArchived: true }).find((one) => one.id === id)
  if (source === undefined) return []
  const usage = categoryUsage(db, id)
  const tree = treeOf(db)
  const under = subtreeOf(tree, id)
  return listCategories(db).filter(
    (one) =>
      !under.has(one.id) &&
      !one.isSystem &&
      familyOf(one.kind) === familyOf(source.kind) &&
      (usage.subcategories === 0 || takesChildrenOf(tree, one.id, id)) &&
      (usage.goals === 0 || countLinking(db, 'fmt_saving_goal', 'deposit_category', one.id) === 0),
  )
}

/**
 * Whether `intoId` can take `fromId`'s subcategories when a merge or a delete
 * moves them (M28 F29): each goes under it with what it carries, inside the
 * three levels.
 */
function takesChildrenOf(
  tree: readonly { readonly id: string; readonly parentId: string | undefined }[],
  intoId: string,
  fromId: string,
): boolean {
  return tree
    .filter((one) => one.parentId === fromId)
    .every((child) => placementProblem(tree, intoId, child.id) === undefined)
}

export class CategoryInUseError extends Error {
  constructor(
    readonly usage: CategoryUsage,
    message = 'This category is still in use. Merge it into another one, or archive it.',
  ) {
    super(message)
    this.name = 'CategoryInUseError'
  }
}

/**
 * Delete a category (M28 F18, D-340).
 *
 * **Nothing uses it: it goes.** **Something does** (`isCategoryInUse`): it is
 * refused unless `moveTo` names where all of it goes — its rows, rules,
 * subcategories, budgets, fixed expenses, debts' tracking and goals' deposits —
 * and that has to be one of `categoryDeleteTargets`. With nowhere to move, it
 * is refused by what still uses it. A system category is never deletable, for
 * the reason it cannot be archived: the ledger relies on it.
 *
 * Moving is a merge's move, so `MANUAL` stays `MANUAL` (D-009) and history
 * follows the rows. **Removed, not soft-deleted**, since M25 U2: a declared row
 * is there or it is not (D-266). The built-in rules that assign a category
 * nothing uses go with it — through the engine, so they are recorded removed
 * and no later build brings them back.
 */
export function deleteCategory(db: Database, id: string, _now: number, moveTo?: string): void {
  const usage = categoryUsage(db, id)
  if (usage.isSystem) {
    throw new CategoryInUseError(usage, 'A system category cannot be deleted — the ledger relies on it.')
  }
  if (isCategoryInUse(usage)) {
    const using = listed(describeCategoryUsage(usage), 'nothing')
    const targets = categoryDeleteTargets(db, id)
    if (targets.length === 0) {
      throw new CategoryInUseError(
        usage,
        `It still has ${using}, and there is no other category of its kind to move them to. ` +
          'Make one, or archive this one instead.',
      )
    }
    if (moveTo === undefined) {
      throw new CategoryInUseError(usage, `It still has ${using}. Choose a category to move them to.`)
    }
    if (!targets.some((one) => one.id === moveTo)) {
      throw new CategoryInUseError(
        usage,
        'That category cannot take them: it has to be live, of the same kind, not under this one, and with room for its subcategories within three levels.',
      )
    }
    inTransaction(db, () => {
      moveEverything(db, id, moveTo)
      deleteRows(db, declared(db, 'category'), [id], allDeclared(db))
    })
    return
  }
  inTransaction(db, () => {
    const builtIns = query(db, 'SELECT id FROM fmt_category_rule WHERE target = ?', [id]).map((row) =>
      String(row['id']),
    )
    const formats = allDeclared(db)
    forgetCategory(db, id, builtIns)
    if (builtIns.length > 0) deleteRows(db, declared(db, 'category_rule'), builtIns, formats)
    deleteRows(db, declared(db, 'category'), [id], formats)
  })
}

/**
 * What still names a category nothing is filed in, taken off it before it
 * goes (M25 U3, D-275) — a link names a row that is there.
 *
 * A correction *to* it teaches nothing now, so it goes; one *from* it keeps
 * what the person chose and forgets where the row was. A re-apply that would
 * put a row back into it would put it into nothing, so that one row is
 * dropped from the undo — no row is in the category, or the delete would
 * have been refused. And a transaction a built-in rule filed elsewhere, then
 * moved, names no rule once the rules go.
 */
function forgetCategory(db: Database, id: string, rules: readonly string[]): void {
  db.run('DELETE FROM fmt_category_override WHERE new_category = ?', [id])
  db.run('UPDATE fmt_category_override SET previous_category = NULL WHERE previous_category = ?', [id])
  db.run('DELETE FROM fmt_reapply_change WHERE previous_category = ?', [id])
  // A review in progress forgets it too: its rows are not filed anywhere yet.
  db.run('UPDATE fmt_staged_row SET suggested_category = NULL, suggested_rule = NULL WHERE suggested_category = ?', [id])
  db.run('UPDATE fmt_staged_row SET chosen_category = NULL WHERE chosen_category = ?', [id])
  forgetRules(db, rules)
}

/**
 * A rule about to be removed, taken off every row that names it (M25 U3,
 * D-275). The category it gave stays, and a `RULE` assignment with no rule is
 * what the detail panel shows as a rule since deleted — the id it used to
 * keep for that was a link to nothing.
 */
export function forgetRules(db: Database, ids: readonly string[]): void {
  for (const id of ids) {
    db.run('UPDATE fmt_transaction SET matched_rule = NULL WHERE matched_rule = ?', [id])
    db.run('UPDATE fmt_reapply_change SET previous_rule = NULL WHERE previous_rule = ?', [id])
    db.run('UPDATE fmt_staged_row SET suggested_rule = NULL WHERE suggested_rule = ?', [id])
  }
}

/**
 * Fold one category into another: every transaction repoints, the source is
 * deleted, and no history is lost.
 *
 * Everything that links to a category follows (`moveEverything`) — the
 * alternative, a cascade the database does silently, is how a merge quietly
 * drops a rule.
 *
 * `MANUAL` assignments survive as `MANUAL`: a merge changes what a category is
 * called, not the fact that a human chose it (D-009).
 */
export function mergeCategories(db: Database, fromId: string, intoId: string, _now: number): void {
  if (fromId === intoId) throw new Error('A category cannot be merged into itself')

  const usage = categoryUsage(db, fromId)
  if (usage.isSystem) throw new CategoryInUseError(usage)
  if (usage.goals > 0 && countLinking(db, 'fmt_saving_goal', 'deposit_category', intoId) > 0) {
    throw new Error('Both categories feed a saving goal, and a category feeds one goal. Point one goal elsewhere first.')
  }

  inTransaction(db, () => {
    moveEverything(db, fromId, intoId)
    deleteRows(db, declared(db, 'category'), [fromId], allDeclared(db))
  })
}

/**
 * Everything that names `fromId`, named `intoId` instead — a merge's move, and
 * a delete's when something still uses what it deletes (D-340).
 */
function moveEverything(db: Database, fromId: string, intoId: string): void {
  db.run('UPDATE fmt_transaction SET category = ? WHERE category = ?', [intoId, fromId])
  // The history follows the rows: a correction into the merged category was
  // a correction into the survivor, and an undo puts a row back there.
  db.run('UPDATE fmt_category_override SET new_category = ? WHERE new_category = ?', [intoId, fromId])
  db.run('UPDATE fmt_category_override SET previous_category = ? WHERE previous_category = ?', [intoId, fromId])
  db.run('UPDATE fmt_reapply_change SET previous_category = ? WHERE previous_category = ?', [intoId, fromId])
  // And a review in progress, whose rows are about to be filed.
  db.run('UPDATE fmt_staged_row SET suggested_category = ? WHERE suggested_category = ?', [intoId, fromId])
  db.run('UPDATE fmt_staged_row SET chosen_category = ? WHERE chosen_category = ?', [intoId, fromId])
  // A fixed expense filed or matched here follows, and a split bucket aimed
  // here, rather than naming a category that is removed below (M25 U2:
  // removed, not soft-deleted; U7: through the engine).
  refileFixedExpenses(db, fromId, intoId)
  reaimBuckets(db, fromId, intoId)
  // A debt tracked by it and a goal fed by it follow too (D-340): a link names
  // a row that is there, so either would otherwise refuse the removal.
  if (countLinking(db, 'fmt_debt', 'auto_track_category', fromId) > 0) {
    const debts = declared(db, 'debt')
    for (const row of query(db, 'SELECT id FROM fmt_debt WHERE auto_track_category = ?', [fromId])) {
      updateRow(db, debts, String(row['id']), { auto_track_category: intoId })
    }
  }
  if (countLinking(db, 'fmt_saving_goal', 'deposit_category', fromId) > 0) {
    const goals = declared(db, 'saving_goal')
    for (const row of query(db, 'SELECT id FROM fmt_saving_goal WHERE deposit_category = ?', [fromId])) {
      updateRow(db, goals, String(row['id']), { deposit_category: intoId })
    }
  }
  const category = declared(db, 'category')
  const rules = declared(db, 'category_rule')
  // Subcategories come along rather than being orphaned, with what they
  // carry, which the cap allows when the target has room for them within the
  // three levels (M28 F29) — and never under one of their own.
  const children = query(db, 'SELECT id FROM fmt_category WHERE parent = ?', [fromId])
  if (children.length > 0) {
    const tree = treeOf(db)
    if (subtreeOf(tree, fromId).has(intoId)) {
      throw new CategoryDepthError('A category cannot go into one of its own subcategories')
    }
    if (!takesChildrenOf(tree, intoId, fromId)) {
      throw new CategoryDepthError(
        `Categories nest ${String(MAX_CATEGORY_DEPTH)} levels at most, and its subcategories would go past that`,
      )
    }
  }
  for (const child of children) {
    updateRow(db, category, String(child['id']), { parent: intoId })
  }
  // Every rule that assigned it assigns the survivor now — through the
  // engine, so a built-in retargeted is the person's from here on.
  for (const rule of query(db, 'SELECT id FROM fmt_category_rule WHERE target = ?', [fromId])) {
    updateRow(db, rules, String(rule['id']), { target: intoId })
  }
}

/**
 * Move a category one place up or down among its siblings — the categories
 * under the same parent — by swapping their sort orders.
 *
 * A swap rather than a renumber: it touches two rows instead of all of them,
 * and it cannot leave the list in a state where two categories share a position
 * and the order depends on which one SQLite happens to read first.
 */
export function moveCategory(db: Database, id: string, direction: -1 | 1, _now: number): void {
  const rows = query(
    db,
    `SELECT id, sort_order FROM fmt_category
      WHERE parent IS (SELECT parent FROM fmt_category WHERE id = ?)
      ORDER BY sort_order, name`,
    [id],
  )

  const index = rows.findIndex((row) => String(row['id']) === id)
  const swapWith = rows[index + direction]
  const current = rows[index]
  if (index < 0 || swapWith === undefined || current === undefined) return

  const category = declared(db, 'category')
  inTransaction(db, () => {
    updateRow(db, category, id, { sort_order: Number(swapWith['sort_order']) })
    updateRow(db, category, String(swapWith['id']), { sort_order: Number(current['sort_order']) })
  })
}

export function countUncategorized(db: Database): number {
  const rows = query(
    db,
    `SELECT COUNT(*) AS n FROM fmt_transaction
      WHERE category IS NULL OR category = ?`,
    [UNCATEGORIZED_ID],
  )
  return Number(rows[0]?.['n'] ?? 0)
}

export interface CategoryTotal {
  readonly categoryId: string | undefined
  readonly name: string
  readonly outflowMinor: number
  readonly currency: string
  readonly count: number
}

/**
 * Spend per category for a period, uncategorized included as its own visible
 * row. docs/08 is emphatic about that: a hidden backlog is an abandoned
 * backlog, and hidden uncategorized spending is how these apps lose trust.
 */
export function categoryTotals(db: Database, period: string): readonly CategoryTotal[] {
  const rows = query(
    db,
    `SELECT t.category AS category_id, t.amount_currency AS currency,
            COALESCE(g.name || ' → ' || p.name || ' → ' || c.name, p.name || ' → ' || c.name, c.name, 'Uncategorized') AS label,
            COUNT(*) AS n,
            SUM(CASE WHEN t.amount_minor < 0 THEN -t.amount_minor ELSE 0 END) AS outflow
       FROM fmt_transaction t
       LEFT JOIN fmt_category c ON c.id = t.category
       LEFT JOIN fmt_category p ON p.id = c.parent
       LEFT JOIN fmt_category g ON g.id = p.parent
      WHERE ${countsCondition('t')}
        AND substr(COALESCE(t.charge_date, t.transaction_date), 1, 7) = ?
      GROUP BY t.category, t.amount_currency
      ORDER BY outflow DESC`,
    [period],
  )

  return rows.map((row) => ({
    categoryId: row['category_id'] === null ? undefined : String(row['category_id']),
    name: String(row['label']),
    currency: String(row['currency']),
    count: Number(row['n']),
    outflowMinor: Number(row['outflow'] ?? 0),
  }))
}
export interface CategoryActivity {
  /** Every transaction filed here, ever. Its own, not its children's. */
  readonly transactions: number
  /** What was spent here since the cutoff, per currency. Empty means nothing was. */
  readonly recent: readonly { readonly currency: string; readonly outflowMinor: number }[]
  /** The last date anything was filed here, or `undefined` if nothing ever was. */
  readonly lastUsed: string | undefined
}

/**
 * How much each category is actually being used — the badge docs/f02 asked for
 * in M1 and nothing ever drew.
 *
 * **It is the figure that makes a taxonomy editable.** Forty-six rows all look
 * alike; the ones with nothing behind them are the ones to merge or archive, and
 * until this read existed there was no way to tell them apart without opening
 * the ledger forty-six times. `categoryUsage` answers the same question for one
 * category and is what the delete button asks; this is the whole screen in one
 * query, because forty-six round trips per render is the other way to do it.
 *
 * `since` is an ISO date the caller computes — the repository does not know what
 * day it is, and inventing "today" down here is how a test starts depending on
 * the clock.
 *
 * Excluded rows are out of the recent spend, exactly as they are out of every
 * other total (the card-charge row that is the same money as the statement it
 * paid for), but they still count as transactions filed here: the row exists,
 * and "nothing points at this" would be a lie.
 */
export function categoryActivity(
  db: Database,
  since: string,
): ReadonlyMap<string, CategoryActivity> {
  const counts = query(
    db,
    `SELECT category AS category_id,
            COUNT(*) AS n,
            MAX(COALESCE(charge_date, transaction_date)) AS last_used
       FROM fmt_transaction
      WHERE category IS NOT NULL
      GROUP BY category`,
  )

  const spend = query(
    db,
    `SELECT category AS category_id, amount_currency AS currency,
            SUM(CASE WHEN amount_minor < 0 THEN -amount_minor ELSE 0 END) AS outflow
       FROM fmt_transaction
      WHERE category IS NOT NULL
        AND ${countsCondition()}
        AND COALESCE(charge_date, transaction_date) >= ?
      GROUP BY category, amount_currency
      HAVING outflow > 0`,
    [since],
  )

  const recentOf = new Map<string, { currency: string; outflowMinor: number }[]>()
  for (const row of spend) {
    const id = String(row['category_id'])
    const entry = { currency: String(row['currency']), outflowMinor: Number(row['outflow'] ?? 0) }
    const existing = recentOf.get(id)
    if (existing === undefined) recentOf.set(id, [entry])
    else existing.push(entry)
  }

  const activity = new Map<string, CategoryActivity>()
  for (const row of counts) {
    const id = String(row['category_id'])
    activity.set(id, {
      transactions: Number(row['n'] ?? 0),
      recent: recentOf.get(id) ?? [],
      lastUsed: row['last_used'] == null ? undefined : String(row['last_used']),
    })
  }
  return activity
}

/**
 * The categories a person files into most — the six By merchant offers on its
 * number keys (M28 U6, S1).
 *
 * **By what is in them, not by what was filed lately**: a category earns the key
 * by holding the most rows, which is the one answer that needs no history of
 * filings and works on the first day a document has rows. System categories and
 * archived ones are never offered, and neither is a category with children and
 * no rows of its own (a heading is not somewhere to file).
 */
export function usualCategories(db: Database, limit: number): readonly string[] {
  return query(
    db,
    `SELECT t.category AS id, COUNT(*) AS n
       FROM fmt_transaction t
       JOIN fmt_category c ON c.id = t.category
      WHERE c.is_system = 0 AND c.is_archived = 0 AND t.category <> ?
      GROUP BY t.category
      ORDER BY n DESC, c.name
      LIMIT ?`,
    [UNCATEGORIZED_ID, limit],
  ).map((row) => String(row['id']))
}

/**
 * Spend per category over `span` consecutive months ending at `end`
 * (`YYYY-MM`), oldest first — the line beside a category and the twelve bars in
 * its panel (M28 U6).
 *
 * One query for the whole taxonomy: forty-six reads per render is the other way
 * to do it. **One currency**, the document's, because a line adding shekels to
 * dollars is not a figure; excluded rows are out, as they are out of every other
 * total. A month with nothing is `0`, so the series is always `span` long.
 * `flow` is which way the money went: spending is `OUT`, an income category's
 * is `IN`.
 */
export function categorySeries(
  db: Database,
  end: string,
  span: number,
  currency: string,
  flow: 'OUT' | 'IN' = 'OUT',
): ReadonlyMap<string, readonly number[]> {
  const [year, month] = end.split('-').map(Number) as [number, number]
  const periods = Array.from({ length: span }, (_, index) => {
    const at = year * 12 + (month - 1) - (span - 1 - index)
    return `${String(Math.floor(at / 12))}-${String((at % 12) + 1).padStart(2, '0')}`
  })

  const rows = query(
    db,
    `SELECT category AS id, substr(COALESCE(charge_date, transaction_date), 1, 7) AS period,
            SUM(CASE WHEN ${flow === 'OUT' ? 'amount_minor < 0 THEN -amount_minor' : 'amount_minor > 0 THEN amount_minor'} ELSE 0 END) AS outflow
       FROM fmt_transaction
      WHERE category IS NOT NULL AND ${countsCondition()} AND amount_currency = ?
        AND substr(COALESCE(charge_date, transaction_date), 1, 7) BETWEEN ? AND ?
      GROUP BY category, period`,
    [currency, periods[0] ?? end, end],
  )

  const series = new Map<string, number[]>()
  for (const row of rows) {
    const id = String(row['id'])
    const at = periods.indexOf(String(row['period']))
    if (at < 0) continue
    const line = series.get(id) ?? periods.map(() => 0)
    line[at] = Number(row['outflow'] ?? 0)
    series.set(id, line)
  }
  return series
}

export interface CategoryMerchant {
  readonly merchantRaw: string
  readonly count: number
  readonly outflowMinor: number
}

/**
 * Where a category's money goes: its merchants, largest first, over the months
 * given. Raw names as the document spelled them; the document's currency only.
 */
export function categoryMerchants(
  db: Database,
  categoryId: string,
  from: string,
  to: string,
  currency: string,
  limit: number,
): readonly CategoryMerchant[] {
  return query(
    db,
    `SELECT merchant_normalized AS merchant, MIN(merchant_raw) AS raw, COUNT(*) AS n,
            SUM(CASE WHEN amount_minor < 0 THEN -amount_minor ELSE 0 END) AS outflow
       FROM fmt_transaction
      WHERE category = ? AND ${countsCondition()} AND amount_currency = ?
        AND substr(COALESCE(charge_date, transaction_date), 1, 7) BETWEEN ? AND ?
      GROUP BY merchant_normalized
      ORDER BY outflow DESC
      LIMIT ?`,
    [categoryId, currency, from, to, limit],
  ).map((row) => ({
    merchantRaw: String(row['raw']),
    count: Number(row['n']),
    outflowMinor: Number(row['outflow'] ?? 0),
  }))
}
