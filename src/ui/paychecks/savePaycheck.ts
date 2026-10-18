import type { Database } from 'sql.js'

import { inTransaction } from '@/data/db/database.ts'
import { isLearned, type BatchSlip } from '@/data/importer/slipBatch.ts'
import {
  nameDeductionRows,
  recordTemplateUse,
  saveTemplate,
} from '@/data/repositories/documentTemplateRepository.ts'

import {
  createPaycheck,
  updatePaycheck,
  type NewPaycheckLine,
} from '@/data/repositories/paycheckRepository.ts'
import { syncPayroll } from '@/data/repositories/payrollSyncRepository.ts'
import { draftEntry, type PaycheckDraft } from '@/domain/paycheckEntry.ts'

/**
 * Writing a slip, and the two things that have to run after it.
 *
 * Shared between the paychecks screen and `PayslipIntake` (D-166), because what
 * a saved paycheck *sets off* is the part nobody remembers: a slip whose lines
 * feed a saving goal owes it a deposit (D-075), and the debts the same slip
 * repays are the one mechanism of F08's four that runs on a save rather than on
 * an import. Both are idempotent, so a slip with nothing linked costs a query
 * and changes nothing — and a second call site that forgot them would be a
 * screen where the paycheck lands and the goal never moves.
 */
export function savePaycheckDraft(
  database: Database,
  draft: PaycheckDraft,
  /** The slip being corrected, or `undefined` for a new one. */
  editingId: string | undefined,
  now: number,
): void {
  const entry = draftEntry(draft)
  const lines: readonly NewPaycheckLine[] = entry.lines.map((line) => ({
    deductionTypeId: line.deductionTypeId,
    employeeAmount: line.employeeAmount,
    employerAmount: line.employerAmount,
    // The base the slip printed, kept since D-169 — the only figure that can be
    // set against a fund's own salary column.
    basisAmount: line.basisAmount,
    note: line.note,
  }))

  const input = {
    period: entry.paycheck.period,
    paymentDate: entry.paycheck.paymentDate,
    employerName: entry.paycheck.employerName,
    gross: entry.paycheck.gross,
    net: entry.paycheck.net,
    note: entry.paycheck.note,
    isIrregular: entry.paycheck.isIrregular,
    lines,
  }

  if (editingId === undefined) createPaycheck(database, input, now)
  else updatePaycheck(database, editingId, input, now)

  // Idempotent, and an upsert: a corrected slip moves the deposit and the debt
  // payment rather than adding a second one.
  syncPayroll(database, now)
}

/** One slip of a batch, as Write receives it (M28 U3). */
export interface BatchWrite {
  readonly slip: BatchSlip
  readonly draft: PaycheckDraft
  /** Its own arithmetic closed. A reader is stored or credited only then (F17). */
  readonly reconciles: boolean
  /** What a person named its reader's rows, by anchor field (D-145). */
  readonly named: ReadonlyMap<string, string>
}

/**
 * **Write a batch of slips** — the ticked ones, whole or not at all.
 *
 * The single slip's two accept rules, per slip: a reader is stored or credited
 * **only while the slip reconciles** (F17), and the rows named on the screen are
 * kept against it (D-145). A reader worked out in this batch is stored once, by
 * the first ticked slip it read, and credited by the rest — twelve months of one
 * new employer is one reader, not twelve.
 */
export function writeSlipBatch(database: Database, slips: readonly BatchWrite[], now: number): number {
  const stored = new Map<string, string>()

  inTransaction(database, () => {
    for (const each of slips) {
      const { outcome, reader } = each.slip
      if (each.reconciles && outcome.kind === 'read' && reader !== undefined) {
        if (isLearned(reader)) {
          let id = stored.get(reader)
          if (id === undefined) {
            id = saveTemplate(
              database,
              {
                kind: 'PAYSLIP',
                name: outcome.stored?.name ?? each.slip.file.name.replace(/\.[^.]+$/, ''),
                labelSignature: outcome.signature,
                anchors: outcome.anchors,
                derivedBy: 'LOCAL_MODEL',
                confirmed: true,
              },
              now,
            ).id
            stored.set(reader, id)
          } else {
            recordTemplateUse(database, id, now)
          }
          nameDeductionRows(database, id, each.named, now)
        } else {
          recordTemplateUse(database, reader, now)
          nameDeductionRows(database, reader, each.named, now)
        }
      }
      savePaycheckDraft(database, each.draft, undefined, now)
    }
  })

  return slips.length
}
