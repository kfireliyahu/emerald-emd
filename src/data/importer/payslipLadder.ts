/**
 * F17's ladder for a payslip: which rungs there are lives in
 * `documentLadder.ts`, and this is the twenty lines that say what a payslip is.
 *
 * Three functions and a noun (`LadderShape`): anchor a model's line numbers to
 * the words on those lines, execute a template, and say whether the slip's own
 * arithmetic vouches for the result. Nothing about rungs, and nothing in the
 * ladder knows what a deduction is.
 *
 * The types are re-exported under their old names because a payslip is what the
 * app had first and every call site already spells them that way.
 */

import type { CurrencyCode } from '@/core/money.ts'
import type { PayslipLines } from '@/domain/modelTasks.ts'
import type { PayslipReading } from '@/domain/model/paycheck.ts'
import {
  anchorsOf,
  type PayslipDocumentTemplate,
  type PayslipTemplate,
} from '@/domain/model/templates.ts'

import {
  readByLadder,
  readWithTemplate,
  storesTemplate as ladderStoresTemplate,
  type Derive,
  type LadderOutcome,
  type LadderRead,
  type LadderShape,
} from './documentLadder.ts'
import { anchorPayslip } from './labelTemplate.ts'
import { readAnchoredPayslip, readPayslip } from './payslipTemplate.ts'

export type SlipRead = LadderRead<PayslipTemplate, PayslipReading, PayslipDocumentTemplate>
export type SlipOutcome = LadderOutcome<PayslipTemplate, PayslipReading, PayslipDocumentTemplate>

/** What a deriving rung has to provide. A model, the plugin, or a seed. */
export type DerivePayslip = Derive<PayslipLines>

/** Currency is bound here rather than threaded through the ladder, which has no money in it. */
function payslipShape(currency: CurrencyCode): LadderShape<PayslipLines, PayslipTemplate, PayslipReading> {
  return {
    noun: 'slip',
    anchor: (lines, text) => anchorPayslip(lines, text),
    execute: (anchors, text) => readAnchoredPayslip(anchors, text, currency),
    executeLines: (lines, text) => readPayslip(lines, text, currency),
    verifies: (reading) => reading.reconciles,
    // The same test, because a slip's is already the positive one: gross less
    // deductions is net, to the agora. A slip with no figures cannot pass it.
    proves: (reading) => reading.reconciles,
    isEmpty: (anchors) => anchorsOf(anchors).length === 0,
  }
}

export async function readSlipByLadder(options: {
  readonly text: string
  readonly templates: readonly PayslipDocumentTemplate[]
  readonly derive?: DerivePayslip | undefined
  readonly currency?: CurrencyCode
}): Promise<SlipOutcome> {
  const { text, templates, derive, currency = 'ILS' } = options
  return readByLadder({ shape: payslipShape(currency), text, templates, derive })
}

/** The user naming the format instead of letting the match choose one (D-148). */
export function readSlipWithTemplate(options: {
  readonly text: string
  readonly template: PayslipDocumentTemplate
  readonly currency?: CurrencyCode
  readonly attempts?: readonly string[]
}): SlipRead {
  const { text, template, currency = 'ILS', attempts } = options
  return readWithTemplate({ shape: payslipShape(currency), text, template, ...(attempts === undefined ? {} : { attempts }) })
}

/** Whether accepting this reading has a template to store. See the ladder. */
export function storesTemplate(outcome: SlipRead): boolean {
  return ladderStoresTemplate(outcome)
}
