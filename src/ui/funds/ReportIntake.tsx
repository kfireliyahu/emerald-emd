import { useMemo, useState } from 'react'
import type { Database } from 'sql.js'

import type { CurrencyCode } from '@/core/money.ts'
import { storesTemplate } from '@/data/importer/documentLadder.ts'
import type { ReportRead } from '@/data/importer/fundLadder.ts'
import {
  recordTemplateUse,
  renameTemplate,
  readableTemplates,
  saveTemplate,
} from '@/data/repositories/documentTemplateRepository.ts'
import {
  addSnapshot,
  listSnapshots,
  replaceSnapshotDeposits,
  updateFund,
} from '@/data/repositories/fundRepository.ts'
import type {
  FundAccount,
  FundBalanceSnapshot,
  FundReportAccountFacts,
  ReadDeposit,
} from '@/domain/model/funds.ts'
import { isFundReportTemplate } from '@/domain/model/templates.ts'
import { snapshotFromReport } from '@/domain/review.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { ReadReport } from '@/ui/funds/ReadReport.tsx'
import {
  advanceBatch,
  BatchProgress,
  NO_BATCH,
  startBatch,
  type ReportBatch,
} from '@/ui/funds/reportBatch.tsx'
import { SnapshotEditor } from '@/ui/funds/SnapshotEditor.tsx'
import { today } from '@/ui/today.ts'

interface Editing {
  readonly snapshot: FundBalanceSnapshot
  readonly deposits?: readonly ReadDeposit[] | undefined
}

/**
 * Reading fund reports into one fund, whole: the stack, the confirm surface, the
 * form it fills, and the writes at either end.
 *
 * **One of these rather than one per screen**, which is what D-166 is for. The
 * loop lived inside the fund detail screen, and that was right while the fund
 * detail screen was the only place a person met a report. Onboarding is exactly
 * the other place — a first run is when somebody has the folder open — and
 * copying two hundred lines of accept rules into a wizard step is how the two
 * drift: one stores a format the other does not, one applies what the report
 * says about the fund and the other quietly drops it.
 *
 * It reads its templates and its readings itself and takes the fund and a way
 * out, so a caller needs a `FundAccount` and nothing else.
 */
export function ReportIntake({
  fund,
  currency: given,
  onLeave,
  onProblem,
  leaveLabel = 'Back to the fund',
  files,
}: {
  fund: FundAccount
  /**
   * The unit to read figures in. Taken from the fund's own readings when the
   * caller has no better answer, which is onboarding's case: a document created
   * five minutes ago has nothing to take a currency from.
   */
  currency?: CurrencyCode | undefined
  /** Out of the flow entirely — back to wherever the caller came from. */
  onLeave: () => void
  onProblem: (problem: string | undefined) => void
  /** Where leaving goes, named. The fund screen's default; onboarding's is not. */
  leaveLabel?: string
  /** Reports already chosen — dropped on Home's Read files (M36 U10) — read as the stack. */
  files?: readonly File[] | undefined
}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [editing, setEditing] = useState<Editing | undefined>()
  /** The stack of reports being read in one sitting (D-164). */
  const [batch, setBatch] = useState<ReportBatch>(() =>
    files === undefined || files.length === 0 ? NO_BATCH : startBatch(files, NO_BATCH),
  )

  // Only the confirmed ones, and only the ones whose anchors are a report's: the
  // ladder's first rung does not execute a proposal (D-139), and the repository
  // will not decode a row whose kind and shape disagree.
  const templates = useMemo(
    () =>
      db === undefined ? [] : readableTemplates(db, 'FUND_REPORT').filter(isFundReportTemplate),
    [db, revision],
  )

  const snapshots = useMemo(
    () => (db === undefined ? [] : listSnapshots(db, fund.id)),
    [db, revision, fund.id],
  )

  if (db === undefined) return null

  const now = today()
  const latest = snapshots[snapshots.length - 1]
  const currency: CurrencyCode = given ?? snapshots[0]?.totalBalance.currency ?? 'ILS'

  const write = (work: (database: Database, at: number) => void): boolean => {
    onProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
      return true
    } catch (error) {
      onProblem(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  /**
   * The accept at the end of the confirm surface — the paychecks screen's
   * `acceptSlip` (D-140), for a document that often cannot prove itself.
   *
   * Two writes and no third. The **format** is stored or credited with a use,
   * because the person in front of it just said this is how their reports are
   * laid out. The **reading** is not written: the draft opens in the form a typed
   * one opens in, and that form's own save button is the only thing that writes a
   * snapshot.
   *
   * **A report that could not be checked is still remembered**, and that is the
   * one place this differs from a payslip's rule. A payslip that does not
   * reconcile was read by a map that has never once been right; a report with no
   * arithmetic printed on it is not that, and refusing to store its format would
   * mean asking a model about the same statement every quarter forever. What
   * `failed` means here is that an equation ran and came out wrong, and that
   * still stores nothing.
   */
  const acceptReport = (
    outcome: ReportRead,
    formatName: string,
    facts: FundReportAccountFacts | undefined,
  ): void => {
    if (outcome.reading.proof !== 'failed') {
      write((database, at) => {
        if (outcome.stored !== undefined) recordTemplateUse(database, outcome.stored.id, at)
        if (!storesTemplate(outcome)) return

        const chosen = outcome.stored
        const saved = saveTemplate(
          database,
          {
            kind: 'FUND_REPORT',
            name: chosen?.name ?? (formatName === '' ? 'Fund report' : formatName),
            labelSignature: outcome.signature,
            anchors: outcome.anchors,
            derivedBy: chosen === undefined ? 'LOCAL_MODEL' : 'MANUAL',
            confirmed: true,
          },
          at,
        )
        // A second row for these labels supersedes whatever covered them before
        // and inherits *its* name, which is right for a re-derivation and wrong
        // when the user just said this report is the other format (D-148).
        if (chosen !== undefined && saved.name !== chosen.name) {
          renameTemplate(database, saved.id, chosen.name, at)
        }
      })
    }

    // What the report says about the **fund** rather than about the period
    // (D-152). A separate write because it lands on a different row, and one the
    // user saw listed and ticked before pressing accept.
    if (facts !== undefined) {
      write((database, at) =>
        updateFund(
          database,
          fund.id,
          {
            // Only what the report actually stated: an edit is a patch, and a
            // field the report is silent about is not a field it set to nothing.
            ...(facts.feeOnDepositBasisPoints === undefined
              ? {}
              : { feeOnDepositBasisPoints: facts.feeOnDepositBasisPoints }),
            ...(facts.feeOnAccumulationBasisPoints === undefined
              ? {}
              : { feeOnAccumulationBasisPoints: facts.feeOnAccumulationBasisPoints }),
            ...(facts.investmentTrack === undefined
              ? {}
              : { investmentTrack: facts.investmentTrack }),
            ...(facts.employerName === undefined ? {} : { employerName: facts.employerName }),
          },
          at,
        ),
      )
    }

    setEditing({
      snapshot: snapshotFromReport(outcome.reading, fund.id, now, currency),
      deposits: outcome.reading.depositRows,
    })
  }

  /** Out of the flow entirely. The queue goes with it — see `reportBatch`. */
  const leave = (): void => {
    setBatch(NO_BATCH)
    onLeave()
  }

  /**
   * Done with the document in hand: record what became of it and take the next.
   *
   * A stack that has run out ends the sitting where the caller wanted it, rather
   * than on an empty reader.
   */
  const nextInBatch = (outcome: 'saved' | 'skipped'): void => {
    const next = advanceBatch(batch, outcome)
    if (next.opening === undefined) {
      setBatch(NO_BATCH)
      onLeave()
      return
    }
    setBatch(next)
  }

  if (editing !== undefined) {
    return (
      <SnapshotEditor
        key={editing.snapshot.id}
        initial={editing.snapshot}
        isNew
        currency={currency}
        existing={snapshots}
        fundName={fund.name}
        deposits={editing.deposits}
        progress={<BatchProgress batch={batch} />}
        {...(/* Only in a stack: one document opened on its own still says
                "Add reading" and still goes back to where it came from, because
                that is where it goes. A batch of one is not a batch. */
        batch.queued.length === 0
          ? { leaveLabel }
          : { saveLabel: 'Save and read the next', leaveLabel: 'Back to the reports' })}
        onSave={(snapshot) => {
          const saved = write((database, at) => {
            const added = addSnapshot(
              database,
              {
                fundAccountId: snapshot.fundAccountId,
                asOfDate: snapshot.asOfDate,
                totalBalance: snapshot.totalBalance,
                employeeComponent: snapshot.employeeComponent,
                employerComponent: snapshot.employerComponent,
                severanceComponent: snapshot.severanceComponent,
                depositsSincePrevious: snapshot.depositsSincePrevious,
                feesChargedSincePrevious: snapshot.feesChargedSincePrevious,
                returnSincePrevious: snapshot.returnSincePrevious,
                note: snapshot.note,
              },
              at,
            )
            // The report's deposit table, written by the same action that wrote
            // the reading it came off — after the insert, because a deposit row
            // belongs to a snapshot that exists (D-153).
            if (editing.deposits !== undefined && editing.deposits.length > 0) {
              replaceSnapshotDeposits(database, added.id, fund.id, editing.deposits, at)
            }
          })
          if (!saved) return
          setEditing(undefined)
          // Straight back into the stack, on the next document. The one thing a
          // person doing this eight times must not have to do eight times is
          // find the button again.
          nextInBatch('saved')
        }}
        onCancel={() => {
          setEditing(undefined)
          // In a batch, leaving the form is leaving *this document*, which is
          // what the label says. Out of one it is leaving altogether.
          nextInBatch('skipped')
        }}
      />
    )
  }

  return (
    <ReadReport
      // Each document is read from nothing: no text, no format name and no
      // typed-over fee carried in from the one before it.
      key={batch.step}
      templates={templates}
      fund={fund}
      previousAsOf={latest?.asOfDate}
      currency={currency}
      batch={batch}
      onFiles={(files) => setBatch((current) => startBatch(files, current))}
      onSkip={() => nextInBatch('skipped')}
      onAccepted={acceptReport}
      onCancel={leave}
      leaveLabel={leaveLabel}
    />
  )
}
