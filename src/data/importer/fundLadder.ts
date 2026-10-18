/**
 * F17's ladder for a fund report — the same four questions a payslip answers
 * (`payslipLadder.ts`), asked about a pension, hishtalmut, provident or savings
 * statement.
 *
 * Everything that is a rung lives in `documentLadder.ts`. What is here is what a
 * report *is*: how a model's line numbers become anchors, how a template is
 * executed, and what counts as proof — which for a report is the one thing that
 * genuinely differs, because a report can come back **unchecked** and a payslip
 * cannot (`fundReportTemplate.ts`).
 *
 * **`verifies` accepts `unchecked`, and that is the decision this file makes.**
 * A stored template whose reading could not be checked is still executed and
 * still returned, rather than dropping to the deriving rung. The alternative
 * asks a model to re-derive the same format every quarter, for a report that
 * will be just as uncheckable next time, and ends by storing whichever
 * derivation a person happened to accept — all of it to answer a question the
 * document cannot answer. What the surface must do instead is *say so*, which is
 * where D-138's separation between what was proved and what only a person can
 * check does the work.
 */

import type { CurrencyCode } from '@/core/money.ts'
import type { FundReportReading } from '@/domain/model/funds.ts'
import type { FundReportLines } from '@/domain/modelTasks.ts'
import {
  anchorsOf,
  type FundReportDocumentTemplate,
  type FundReportTemplate,
} from '@/domain/model/templates.ts'

import {
  readByLadder,
  readWithTemplate,
  type Derive,
  type LadderOutcome,
  type LadderRead,
  type LadderShape,
} from './documentLadder.ts'
import { readAnchoredFundReport, readFundReport } from './fundReportTemplate.ts'
import { anchorFundReport } from './labelTemplate.ts'

export type ReportRead = LadderRead<FundReportTemplate, FundReportReading, FundReportDocumentTemplate>
export type ReportOutcome = LadderOutcome<
  FundReportTemplate,
  FundReportReading,
  FundReportDocumentTemplate
>

/** What a deriving rung has to provide. A model, the plugin, or a seed. */
export type DeriveFundReport = Derive<FundReportLines>

function reportShape(
  currency: CurrencyCode,
): LadderShape<FundReportLines, FundReportTemplate, FundReportReading> {
  return {
    noun: 'report',
    anchor: (lines, text) => anchorFundReport(lines, text),
    execute: (anchors, text) => readAnchoredFundReport(anchors, text, currency),
    executeLines: (lines, text) => readFundReport(lines, text, currency),
    // A reading nothing could check is not a reading that failed. See above.
    verifies: (reading) => reading.proof !== 'failed',
    isEmpty: (anchors) => anchorsOf(anchors).length === 0,
  }
}

export async function readReportByLadder(options: {
  readonly text: string
  readonly templates: readonly FundReportDocumentTemplate[]
  readonly derive?: DeriveFundReport | undefined
  readonly currency?: CurrencyCode
}): Promise<ReportOutcome> {
  const { text, templates, derive, currency = 'ILS' } = options
  return readByLadder({ shape: reportShape(currency), text, templates, derive })
}

/** The user naming the format instead of letting the match choose one (D-148). */
export function readReportWithTemplate(options: {
  readonly text: string
  readonly template: FundReportDocumentTemplate
  readonly currency?: CurrencyCode
  readonly attempts?: readonly string[]
}): ReportRead {
  const { text, template, currency = 'ILS', attempts } = options
  return readWithTemplate({
    shape: reportShape(currency),
    text,
    template,
    ...(attempts === undefined ? {} : { attempts }),
  })
}
