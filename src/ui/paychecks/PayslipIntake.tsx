import { useMemo, useState } from 'react'
import type { Database } from 'sql.js'

import type { CurrencyCode } from '@/core/money.ts'
import { storesTemplate, type SlipRead } from '@/data/importer/payslipLadder.ts'
import {
  nameDeductionRows,
  recordTemplateUse,
  renameTemplate,
  readableTemplates,
  saveTemplate,
} from '@/data/repositories/documentTemplateRepository.ts'
import {
  createDeductionType,
  listDeductionTypes,
} from '@/data/repositories/deductionTypeRepository.ts'
import { listPaychecksWithLines } from '@/data/repositories/paycheckRepository.ts'
import type { DeductionKind } from '@/domain/model/paycheck.ts'
import { isPayslipTemplate } from '@/domain/model/templates.ts'
import {
  defaultFlags,
  draftFromSlip,
  pickerGroups,
  recentTypeIds,
  type PaycheckDraft,
} from '@/domain/paycheckEntry.ts'
import type { PayslipReview } from '@/domain/review.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { PaycheckEditor } from '@/ui/paychecks/PaycheckEditor.tsx'
import { ReadSlip } from '@/ui/paychecks/ReadSlip.tsx'
import { savePaycheckDraft } from '@/ui/paychecks/savePaycheck.ts'
import { today } from '@/ui/today.ts'

/**
 * Reading a payslip into the document, whole: the reader, the confirm surface,
 * the form it fills, and the writes at either end.
 *
 * **One of these rather than one per screen** (D-166), the fund report's
 * argument said about the other document. The accept rules here are not
 * incidental — a template is stored **only while the slip reconciles**, a
 * chosen format writes a second row under this document's labels (D-148), and
 * the rows the user named are kept against the format whichever rung read it
 * (D-145) — and a wizard step that reimplemented three-quarters of them would
 * teach the document a different thing from the screen.
 *
 * It reads its own templates, types and history, so a caller needs only a way
 * out.
 */
export function PayslipIntake({
  onLeave,
  onProblem,
  leaveLabel = 'Back to the list',
}: {
  /** Out of the flow entirely — back to wherever the caller came from. */
  onLeave: () => void
  onProblem: (problem: string | undefined) => void
  /** Where leaving goes, named. The paychecks screen's default; onboarding's is not. */
  leaveLabel?: string
}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [draft, setDraft] = useState<PaycheckDraft | undefined>()

  const entries = useMemo(
    () => (db === undefined ? [] : listPaychecksWithLines(db)),
    [db, revision],
  )
  const types = useMemo(() => (db === undefined ? [] : listDeductionTypes(db)), [db, revision])
  // Only the confirmed ones. A template nobody has agreed to is a proposal, and
  // the ladder's first rung does not execute a proposal (D-139).
  const templates = useMemo(
    () => (db === undefined ? [] : readableTemplates(db, 'PAYSLIP').filter(isPayslipTemplate)),
    [db, revision],
  )

  if (db === undefined) return null

  const currency: CurrencyCode = entries[0]?.paycheck.gross.currency ?? 'ILS'

  const write = (work: (database: Database, now: number) => boolean | void): boolean => {
    onProblem(undefined)
    try {
      let ok = true
      mutate((database) => {
        ok = work(database, Date.now()) !== false
      })
      return ok
    } catch (error) {
      onProblem(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  /**
   * The accept at the end of the confirm surface.
   *
   * Two writes and no third. The **template** is stored or credited with a use,
   * because the person in front of it just said this is how their slips are laid
   * out — that is the human action F17 gates the first rung on. The **paycheck**
   * is not written: the draft opens in the editor, where a typed slip is saved by
   * the same button.
   */
  const acceptSlip = (
    outcome: SlipRead,
    review: PayslipReview,
    name: string,
    named: ReadonlyMap<string, string>,
  ): void => {
    write((database, now) => {
      // **Only while it verifies** (F17). A reading whose figures do not add up
      // fills the form and teaches the document nothing: storing that template
      // would mean trusting next month's slip to a map that has never once been
      // right, and crediting a use to one that just failed would sort it to the
      // top of the list it failed from.
      if (!review.reconciles) return

      if (outcome.stored !== undefined) {
        recordTemplateUse(database, outcome.stored.id, now)
        // What the user named on this slip, kept against the format (D-145).
        // Written on the stored rung too, not only the deriving one: a row the
        // template has never been able to name is asked about every month until
        // somebody answers, and the month they answer is this one.
        nameDeductionRows(database, outcome.stored.id, named, now)
      }

      // Nothing more to store when a stored format read a slip its own labels
      // already cover. `storesTemplate` is the whole of that judgement.
      if (!storesTemplate(outcome)) return

      const chosen = outcome.stored
      const saved = saveTemplate(
        database,
        {
          kind: 'PAYSLIP',
          // A format picked by hand keeps the name it has; only a fresh one is
          // named on the surface.
          name: chosen?.name ?? (name === '' ? 'Paycheck' : name),
          labelSignature: outcome.signature,
          anchors: outcome.anchors,
          // The anchors came from the model, and the row exists because a
          // person put it there — which is what this field records (F17).
          derivedBy: chosen === undefined ? 'LOCAL_MODEL' : 'MANUAL',
          confirmed: true,
        },
        now,
      )
      nameDeductionRows(database, saved.id, named, now)
      // A second row for these labels supersedes whatever covered them before
      // and inherits *its* name, which is the right rule for a re-derivation and
      // the wrong one here: the user just said this slip is the other format.
      if (chosen !== undefined && saved.name !== chosen.name) {
        renameTemplate(database, saved.id, chosen.name, now)
      }
    })

    setDraft(draftFromSlip(review, currency, today()))
  }

  /**
   * Add a deduction type from inside the form, and hand back its id so the line
   * being typed can select it. Written immediately rather than on save: a type
   * is a document-level record, and a half-entered slip is not a good enough
   * reason to hold one in memory where a reload loses it.
   */
  const createType = (name: string, kind: DeductionKind): string | undefined => {
    let created: string | undefined
    write((database, now) => {
      created = createDeductionType(database, { name, kind, ...defaultFlags(kind) }, now).id
    })
    return created
  }

  if (draft !== undefined) {
    return (
      <PaycheckEditor
        initial={draft}
        isNew
        currency={currency}
        types={types}
        history={entries}
        onSave={(saving) => {
          const saved = write((database, now) => savePaycheckDraft(database, saving, undefined, now))
          if (saved) onLeave()
        }}
        onCancel={onLeave}
        onCreateType={createType}
        leaveLabel={leaveLabel}
      />
    )
  }

  return (
    <ReadSlip
      templates={templates}
      types={types}
      groups={pickerGroups(types, recentTypeIds(entries))}
      currency={currency}
      onCreateType={createType}
      onAccepted={acceptSlip}
      onCancel={onLeave}
      leaveLabel={leaveLabel}
    />
  )
}
