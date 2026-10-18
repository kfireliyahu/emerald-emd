/**
 * **A pack's formats: read anywhere, written only through the pack** — M25 E5,
 * D-269.
 *
 * U2 put the ledger's rows in declared tables, and the engine's generic
 * surfaces could then write them past the pack's code: a third level of
 * categories from `#/formats/category`, and — once U3 moves transactions — a
 * row that skipped the importer's dedupe and the settlement logic. The answer:
 * lock them per operation, not wholesale.
 *
 * ## What is locked
 *
 * - **Rows.** Every generic write — the format's page, `record_format_rows`,
 *   `update_format_rows`, `delete_format_rows`, a reading onto it or its
 *   supersession, and `apply_rules` onto it — refuses in one sentence naming
 *   where to go instead. Reads stay open everywhere: a table nobody can see is
 *   not checkable (D-214).
 * - **The declaration.** The pack's columns are the pack's. A person may add a
 *   column of their own, and may not change or drop one of the pack's, nor take
 *   away anything else it declared. Deleting the format is refused.
 *
 * ## Where the lock sits
 *
 * **In the generic callers, never in the row functions.** The pack's own code
 * writes through `insertRows`, `updateRow` and `deleteRows` like anybody's, and a
 * lock in them would lock the pack out of its own tables. So these functions
 * answer *may a generic surface do this?* and each caller asks before it acts.
 *
 * ## Where it is kept
 *
 * **In the document**, on the format, and in its text as front matter
 * (`pack:`, `written:`, `pack columns:`). Not derived from the pack's code:
 * the engine-only server never loads that code, and it is exactly the surface
 * that has to refuse. Language 13, so a build that could not read the lock
 * refuses the format rather than reading it unlocked.
 */

import { labelColumn, type ColumnDeclaration, type FormatDeclaration } from './declaration.ts'
import { constraintKey } from './constraint.ts'
import { rollupText } from './rollup.ts'
import { ruleSetText } from './rule.ts'

/** Who owns a format, and where its rows are written instead. */
export interface FormatOwner {
  /** The pack's name: `ledger`. */
  readonly pack: string
  /**
   * Where the rows are written, as the pack says it — the tail of the refusal:
   * *on the Categories screen, or with `create_category`*.
   */
  readonly written: string
  /** The columns the pack declared. Any other column is a person's own. */
  readonly columns: readonly string[]
}

/** Why a generic surface may not write this format's rows, or nothing. */
export function rowWriteRefusal(declaration: FormatDeclaration): string | undefined {
  const owner = declaration.owner
  if (owner === undefined) return undefined
  return (
    `${declaration.title} belongs to the ${owner.pack} pack, so its rows are written only ` +
    `through it — ${owner.written}. Reading them here is fine.`
  )
}

/** Why a generic surface may not delete this format, or nothing. */
export function deleteFormatRefusal(declaration: FormatDeclaration): string | undefined {
  const owner = declaration.owner
  if (owner === undefined) return undefined
  return `${declaration.title} belongs to the ${owner.pack} pack, and only the pack can take it away.`
}

/**
 * Why a generic surface may not turn `before` into `after`, or nothing.
 *
 * A person may add — a column, an identity, a constraint — and may change what
 * is theirs. What the pack declared stays exactly as it is: its columns, and
 * everything else the format held, which a generic surface never learns was
 * the pack's and so may not take away.
 */
export function declarationChangeRefusal(
  before: FormatDeclaration,
  after: FormatDeclaration,
): string | undefined {
  const owner = before.owner
  if (owner === undefined) return undefined
  const whose = `${before.title} belongs to the ${owner.pack} pack`

  if (!sameOwner(owner, after.owner)) {
    return `${whose}, and which pack owns a format is the pack's to say.`
  }
  for (const name of owner.columns) {
    const was = before.columns.find((each) => each.name === name)
    if (was === undefined) continue
    const now = after.columns.find((each) => each.name === name)
    if (now === undefined) {
      return `${whose}, and ${name} is one of its columns, so it stays. A column of your own can go.`
    }
    if (!sameColumn(was, now)) {
      return `${whose}, and ${name} is one of its columns, so it stays as the pack declared it. Add a column of your own instead.`
    }
  }
  // **What the pack's entries are called by is the pack's** (M29 U2, D-332).
  // Columns move freely, but a text column moved ahead of the one that names
  // the entries would rename every one of them where it is read back — the
  // pack's links, its pickers, its rows' headings in a text document.
  const naming = labelColumn(before)?.name
  if (naming !== undefined && owner.columns.includes(naming) && labelColumn(after)?.name !== naming) {
    return `${whose}, and its entries are called by their ${naming}, so ${naming} stays its first text column.`
  }

  const kept = (
    kind: string,
    was: readonly string[],
    now: readonly string[],
  ): string | undefined => {
    const missing = was.find((each) => !now.includes(each))
    return missing === undefined ? undefined : `${whose}, and ${kind} ${missing} stays as it is.`
  }
  return (
    kept(
      'the constraint',
      (before.constraints ?? []).map(constraintKey),
      (after.constraints ?? []).map(constraintKey),
    ) ??
    kept(
      'the claim',
      before.identities.map((each) => `${each.name}: ${each.expression}`),
      after.identities.map((each) => `${each.name}: ${each.expression}`),
    ) ??
    kept(
      'the aggregate',
      before.aggregates.map((each) => JSON.stringify(each)),
      after.aggregates.map((each) => JSON.stringify(each)),
    ) ??
    kept(
      'the rollup',
      (before.rollups ?? []).map((each) => `${each.name}: ${rollupText(each)}`),
      (after.rollups ?? []).map((each) => `${each.name}: ${rollupText(each)}`),
    ) ??
    kept(
      'the rule set',
      (before.ruleSets ?? []).map((each) => `${each.name}: ${ruleSetText(each)}`),
      (after.ruleSets ?? []).map((each) => `${each.name}: ${ruleSetText(each)}`),
    )
  )
}

export function sameOwner(a: FormatOwner | undefined, b: FormatOwner | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return (
    a.pack === b.pack &&
    a.written === b.written &&
    a.columns.length === b.columns.length &&
    a.columns.every((each, index) => b.columns[index] === each)
  )
}

function sameColumn(a: ColumnDeclaration, b: ColumnDeclaration): boolean {
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b))
}

/** A column with its optional fields spelled out, so an absent and an undefined agree. */
function normal(column: ColumnDeclaration): unknown {
  return {
    name: column.name,
    type: column.type,
    unit: column.unit ?? null,
    per: column.per ?? null,
    scale: column.scale ?? null,
    required: column.required,
    unique: column.unique === true,
    values: column.values,
    minimum: column.minimum ?? null,
    maximum: column.maximum ?? null,
    target: column.target ?? null,
    note: column.note,
  }
}
