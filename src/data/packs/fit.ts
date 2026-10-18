/**
 * **Whether a format a document already holds is a pack's** — M38 U7.
 *
 * Keeping a pack declares the formats it lacks; a format of the same name that
 * the document holds already is either the pack's, perhaps from before the pack
 * grew a column, or a person's own that happens to share the name. The first is
 * **completed** — given the optional columns it lacks, the growth an install
 * already allows (D-270, D-319) — and the second is **a clash**, refused with
 * the column that makes it one, because declaring the pack over it would
 * re-mean the rows it holds.
 *
 * A column the document added of its own is no clash: it stays, as a person's
 * own column on a pack's format always has (D-265).
 */

import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'

export interface Fit {
  /** The optional columns the pack declares and the document's format lacks: what keeping the pack adds. */
  readonly missing: readonly ColumnDeclaration[]
  /** Why the document's format is not the pack's, a sentence per column. Empty when it is. */
  readonly clashes: readonly string[]
}

/** How the document's `held` format stands against the pack's declaration of the same name. */
export function fitOf(held: FormatDeclaration, theirs: FormatDeclaration): Fit {
  const missing: ColumnDeclaration[] = []
  const clashes: string[] = []
  for (const column of theirs.columns) {
    const ours = held.columns.find((each) => each.name === column.name)
    const named = `\`${theirs.name}.${column.name}\``
    if (ours === undefined) {
      if (column.required) clashes.push(`${named} is required by the pack, and this document has no such column.`)
      else missing.push(column)
      continue
    }
    if (ours.type !== column.type) {
      clashes.push(`${named} is ${ours.type} here and ${column.type} in the pack.`)
      continue
    }
    if (ours.target !== column.target) {
      clashes.push(`${named} links to ${ours.target ?? 'nothing'} here and to ${column.target ?? 'nothing'} in the pack.`)
      continue
    }
    if ((ours.unit ?? '') !== (column.unit ?? '')) {
      clashes.push(`${named} is in ${ours.unit ?? 'no unit'} here and in ${column.unit ?? 'no unit'} in the pack.`)
      continue
    }
    const lacking = column.values.filter((value) => !ours.values.includes(value))
    if (lacking.length > 0) {
      clashes.push(`${named} has no ${lacking.join(', ')} here, which the pack’s rows can hold.`)
    }
  }
  return { missing, clashes }
}

/**
 * **A column a pack renamed** (M44 U5, D-443) — `unit.claimed_by` became
 * `taken_by` (D-420). A document that kept the pack before holds the old name,
 * and comparing it by name alone would add the new one empty beside the old one
 * still holding every value. So a pack lists its renames, and keeping it again
 * renames the column in place, values and all, through the reconciler's own
 * rename (M26 U3) — only when the document holds the old name and not the new.
 */
export interface PackRename {
  readonly format: string
  readonly from: string
  readonly to: string
}

/**
 * The pack's renames that `held` still has to follow, and `held` as it reads
 * once it has — what `fitOf` is asked about, so the new name is not counted
 * missing and the old one not counted as the document's own.
 */
export function followingRenames(
  held: FormatDeclaration,
  renames: readonly PackRename[],
): { readonly held: FormatDeclaration; readonly renames: readonly PackRename[] } {
  const names = new Set(held.columns.map((column) => column.name))
  const due = renames.filter(
    (each) => each.format === held.name && names.has(each.from) && !names.has(each.to),
  )
  if (due.length === 0) return { held, renames: [] }
  const to = new Map(due.map((each) => [each.from, each.to]))
  return {
    held: { ...held, columns: held.columns.map((column) => ({ ...column, name: to.get(column.name) ?? column.name })) },
    renames: due,
  }
}
