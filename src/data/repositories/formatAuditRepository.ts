/**
 * **A format's rows, looked over** — M34 U3, D-396. The rows and their
 * verdicts, judged through the join exactly as `format_rows` and the format's
 * page judge them, handed to `auditRows`. One function, so the band on the
 * page, `check_formats` and the answer after a read cannot disagree (D-227).
 */

import type { Database } from 'sql.js'

import { inputsWithTotals } from '@/domain/format/aggregate.ts'
import { auditRows, type FormatAudit } from '@/domain/format/audit.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { evaluateIdentity } from '@/domain/format/identity.ts'
import type { RowVerdict, StoredRow, Tally } from '@/domain/format/row.ts'
import type { UnitTable } from '@/domain/format/unit.ts'

import { aggregatesOf, inputsFor, type FormatIndex } from './formatJoinRepository.ts'
import { listRows } from './formatRowRepository.ts'
import { listUnits } from './unitRepository.ts'

export function auditFormat(
  db: Database,
  declaration: FormatDeclaration,
  formats: FormatIndex,
  units: UnitTable = listUnits(db),
): FormatAudit {
  const rows = listRows(db, declaration)
  return auditRows(declaration, rows, joinedVerdicts(db, declaration, rows, formats, units))
}

/**
 * **What the identities say across every row, through the join** (M34 U4,
 * D-397) — the tally the format's band and the list of formats draw. The
 * within-row tally said `unchecked` for an identity naming a total or a hop,
 * beside a row that failed: a degree's stated average against every course.
 */
export function joinedTally(
  db: Database,
  declaration: FormatDeclaration,
  formats: FormatIndex,
  units: UnitTable = listUnits(db),
): Tally {
  const rows = listRows(db, declaration)
  const verdictsOf = joinedVerdicts(db, declaration, rows, formats, units)
  let proved = 0
  let failed = 0
  let unchecked = 0
  for (const row of rows) {
    const verdicts = verdictsOf(row)
    if (verdicts.length === 0) continue
    if (verdicts.some((each) => each.verdict.kind === 'FAILED')) failed += 1
    else if (verdicts.some((each) => each.verdict.kind === 'UNCHECKED')) unchecked += 1
    else proved += 1
  }
  return { proved, failed, unchecked }
}

/** Each row's identities, judged with its hops and its totals beside its own figures. */
function joinedVerdicts(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: FormatIndex,
  units: UnitTable,
): (row: StoredRow) => readonly RowVerdict[] {
  // Every row's link hops in one pass; a total is folded per row, and only
  // when the format declares one.
  const inputs =
    declaration.identities.length === 0
      ? new Map()
      : new Map(inputsFor(db, declaration, rows, formats).map((each, at) => [rows[at]?.id ?? '', each]))
  return (row) => {
    const base = inputs.get(row.id)
    if (base === undefined) return []
    const folded =
      declaration.aggregates.length === 0
        ? base
        : inputsWithTotals(base, aggregatesOf(db, declaration, row, formats, units))
    return declaration.identities.map((identity) => ({
      identity,
      verdict: evaluateIdentity(identity, folded, units),
    }))
  }
}
