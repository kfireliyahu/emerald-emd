/**
 * Reading a fund report, against two quarters of one format.
 *
 * The two fixtures are the argument, exactly as the payslip pair is:
 * `fund-report-2026q2.txt` is Q1's format with **a line inserted** — a notice
 * about the investment track — which shifts every figure below it by one. A
 * template that remembered line numbers reads the wrong row off every field on
 * that report; one anchored to labels does not notice.
 *
 * What is tested here that the payslip's tests cannot be: the **third proof
 * state**. A report that prints enough is checked, a report that prints a period
 * that does not add up fails, and a report that prints only a balance is
 * `unchecked` — which is neither of the other two and is the ordinary case.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { fromMajorUnits, formatMoney, type Money } from '@/core/money.ts'
import type { FundReportReading } from '@/domain/model/funds.ts'
import type { FundReportLines } from '@/domain/modelTasks.ts'
import type { FundReportDocumentTemplate } from '@/domain/model/templates.ts'
import {
  accountChanges,
  editedFacts,
  reviewFundReport,
  snapshotFromReport,
} from '@/domain/review.ts'

import { readReportByLadder, readReportWithTemplate } from './fundLadder.ts'
import {
  readAnchoredFundReport,
  readFundReport,
  readRateBasisPoints,
  readReportAmount,
  readReportDate,
  restateReport,
  retargetToValue,
  valueOnLine,
} from './fundReportTemplate.ts'
import { anchorFundReport, computeLabelSignature } from './labelTemplate.ts'
import { storesTemplate } from './documentLadder.ts'

const Q1 = readReport('fund-report-2026q1.txt')
const Q2 = readReport('fund-report-2026q2.txt')

function readReport(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../fixtures/synthetic/${name}`, import.meta.url)),
    'utf8',
  )
}

/** Q1 as a model answers it: line numbers, and nothing else. */
const Q1_LINES: FundReportLines = {
  closingBalanceLine: 17,
  openingBalanceLine: 12,
  depositsLine: 13,
  yieldLine: 14,
  feesLine: 15,
  asOfDateLine: 7,
  employeeComponentLine: 22,
  employerComponentLine: 23,
  severanceComponentLine: 24,
}

function storedTemplate(): FundReportDocumentTemplate {
  return {
    id: 'tpl-fund-1',
    kind: 'FUND_REPORT',
    name: 'Menora quarterly',
    labelSignature: computeLabelSignature(Q1),
    anchors: anchorFundReport(Q1_LINES, Q1).template,
    derivedBy: 'LOCAL_MODEL',
    confirmedAt: 1,
    pinnedFields: [],
    version: 1,
    supersededAt: undefined,
    lastUsedAt: undefined,
    useCount: 0,
  }
}

const deriveQ1 = (): Promise<{ kind: 'lines'; lines: FundReportLines }> =>
  Promise.resolve({ kind: 'lines', lines: Q1_LINES })

describe('reading one report', () => {
  it('reads every figure it prints, and both equations come out to zero', () => {
    const reading = readFundReport(Q1_LINES, Q1)

    expect(formatMoney(reading.closingBalance!)).toBe('₪430,565.98')
    expect(formatMoney(reading.openingBalance!)).toBe('₪412,300.55')
    expect(formatMoney(reading.deposits!)).toBe('₪9,842.00')
    expect(formatMoney(reading.fees!)).toBe('₪226.77')
    expect(formatMoney(reading.yield!)).toBe('₪8,650.20')
    expect(formatMoney(reading.employeeComponent!)).toBe('₪150,698.09')
    expect(reading.periodDelta?.minor).toBe(0)
    expect(reading.componentDelta?.minor).toBe(0)
    expect(reading.proof).toBe('proved')
  })

  it('dates the reading at the end of the period, not the start', () => {
    // The line prints both: `לתקופה: 01/01/2026 — 31/03/2026  תאריך הדוח: 31/03/2026`.
    expect(readFundReport(Q1_LINES, Q1).asOfDate).toEqual({ year: 2026, month: 3, day: 31 })
    expect(readReportDate('01/01/2026 — 31/03/2026')).toEqual({ year: 2026, month: 3, day: 31 })
  })

  it('never reads a percentage as money', () => {
    // `רווחים (תשואה 2.10%)  8,650.20` — the rate and the sum are one line.
    expect(readReportAmount('רווחים (תשואה 2.10%)   8,650.20')).toBe(8650.2)
    expect(readReportAmount('דמי ניהול מהצבירה (0.22%)   226.77')).toBe(226.77)
    // And a line carrying only a rate carries no amount at all.
    expect(readReportAmount('תשואה שנתית 4.15%')).toBeUndefined()
  })
})

describe('the three proof states', () => {
  it('is proved when the report prints enough for an equation', () => {
    expect(readFundReport(Q1_LINES, Q1).proof).toBe('proved')
  })

  it('is failed when an equation ran and did not come out to zero', () => {
    const changed = Q1.replace('9,842.00', '9,942.00')
    const reading = readFundReport(Q1_LINES, changed)

    expect(reading.proof).toBe('failed')
    expect(formatMoney(reading.periodDelta!)).toBe('₪100.00')
    // The components are untouched and still add up — which is the point of
    // running both: one proof passing is not a report that checks out.
    expect(reading.componentDelta?.minor).toBe(0)
  })

  it('is unchecked when the report prints only a balance', () => {
    const reading = readFundReport({ closingBalanceLine: 17 }, Q1)

    expect(reading.proof).toBe('unchecked')
    expect(reading.periodDelta).toBeUndefined()
    expect(reading.componentDelta).toBeUndefined()
    expect(formatMoney(reading.closingBalance!)).toBe('₪430,565.98')
  })

  it('is failed when no balance was read at all, whatever else came back', () => {
    // The one figure a fund report exists to state.
    expect(readFundReport({ closingBalanceLine: 3 }, Q1).proof).toBe('failed')
  })
})

describe('the ladder', () => {
  it('reads the next quarter with nothing asked of anything', async () => {
    const derive = vi.fn(deriveQ1)
    const outcome = await readReportByLadder({
      text: Q2,
      templates: [storedTemplate()],
      derive,
    })

    expect(outcome.kind).toBe('read')
    if (outcome.kind !== 'read') return
    expect(outcome.source).toBe('stored')
    // A line was inserted above every figure and the labels did not move.
    expect(formatMoney(outcome.reading.closingBalance!)).toBe('₪448,343.28')
    expect(formatMoney(outcome.reading.fees!)).toBe('₪238.10')
    expect(outcome.reading.proof).toBe('proved')
    // M11's done-when condition, for the second of the two document kinds.
    expect(derive).not.toHaveBeenCalled()
  })

  it('does not re-derive a report nothing could check', async () => {
    const balanceOnly: FundReportDocumentTemplate = {
      ...storedTemplate(),
      anchors: anchorFundReport({ closingBalanceLine: 17 }, Q1).template,
    }
    const derive = vi.fn(deriveQ1)

    const outcome = await readReportByLadder({ text: Q2, templates: [balanceOnly], derive })

    if (outcome.kind !== 'read') throw new Error('expected a reading')
    expect(outcome.reading.proof).toBe('unchecked')
    // The alternative asks a model about the same statement every quarter, to
    // answer a question the document cannot answer.
    expect(derive).not.toHaveBeenCalled()
  })

  it('drops to the deriving rung when the stored format stops adding up', async () => {
    const changed = Q2.replace('10,110.00', '10,111.00')
    const derive = vi.fn(deriveQ1)

    const outcome = await readReportByLadder({
      text: changed,
      templates: [storedTemplate()],
      derive,
    })

    expect(derive).toHaveBeenCalledOnce()
    expect(outcome.attempts[0]).toContain('do not add up')
    expect(outcome.attempts[0]).toContain('Menora quarterly')
    expect(outcome.attempts[0]).toContain('report')
  })

  it('lets a person name the format, and has a second row to store when they do', () => {
    const outcome = readReportWithTemplate({ text: Q2, template: storedTemplate() })

    expect(outcome.source).toBe('chosen')
    expect(outcome.reading.proof).toBe('proved')
    expect(outcome.attempts[0]).toBe('You chose the format “Menora quarterly” for this report.')
    expect(computeLabelSignature(Q2)).not.toBe(computeLabelSignature(Q1))
    expect(storesTemplate(outcome)).toBe(true)
  })
})

describe('what the surface is shown', () => {
  it('says nothing checked it, and asks for the fee, when only a balance was read', () => {
    const review = reviewFundReport(readFundReport({ closingBalanceLine: 17 }, Q1))

    expect(review.proof).toBe('unchecked')
    // **Every slot is drawn, and seven of them are blank** (M16 U11). A figure
    // the report was not read as printing is a field on the confirm surface
    // rather than a row that is missing from it — which is what makes the fee
    // the doubt below asks for something a person can answer here.
    expect(review.figures).toHaveLength(8)
    expect(review.figures.filter((figure) => figure.amount !== undefined)).toHaveLength(1)
    expect(review.figures.every((figure) => !figure.proved)).toBe(true)
    const messages = review.doubts.map((doubt) => doubt.message).join(' ')
    expect(messages).toContain('Nothing on this report checks these figures')
    // F13 exists because nobody knows what their fees are.
    expect(messages).toContain('No management fee was read')
  })

  it('marks each figure by the proof it took part in, not all at once', () => {
    // Components add up; the period is one deposit out.
    const changed = Q1.replace('9,842.00', '9,942.00')
    const review = reviewFundReport(readFundReport(Q1_LINES, changed))

    const proved = new Map(review.figures.map((figure) => [figure.field, figure.proved]))
    expect(proved.get('employeeComponent')).toBe(true)
    expect(proved.get('deposits')).toBe(false)
    expect(proved.get('openingBalance')).toBe(false)
    // The balance is in both proofs, and one of them passed.
    expect(proved.get('closingBalance')).toBe(true)
  })

  it('fills the form with what was printed and invents nothing', () => {
    const reading = readFundReport({ closingBalanceLine: 17 }, Q1)
    const draft = snapshotFromReport(reading, 'fund-1', { year: 2020, month: 1, day: 1 })

    expect(formatMoney(draft.totalBalance)).toBe('₪430,565.98')
    // Empty means "the report did not say", which is not zero — the whole fee
    // and deposit reconciliation branches on that distinction.
    expect(draft.feesChargedSincePrevious).toBeUndefined()
    expect(draft.depositsSincePrevious).toBeUndefined()
    expect(draft.employeeComponent).toBeUndefined()
    // No date on the reading, so the caller's fallback stands.
    expect(draft.asOfDate).toEqual({ year: 2020, month: 1, day: 1 })
  })

  it('carries the date the report states when it has one', () => {
    const draft = snapshotFromReport(
      readFundReport(Q1_LINES, Q1),
      'fund-1',
      { year: 2020, month: 1, day: 1 },
    )
    expect(draft.asOfDate).toEqual({ year: 2026, month: 3, day: 31 })
  })
})

/**
 * The shape a **real** pension report turned out to have (D-152).
 *
 * `fund-report-2026h1.txt` is built to it: charges beside the management fee,
 * an actuarial adjustment, figures rounded to the shekel, the fee rate printed
 * on the same line as an unrelated figure and beside a market average, a period
 * that is year-to-date, and three labelled facts on one line. Every one of those
 * broke something the first time it was met.
 */
const H1 = readReport('fund-report-2026h1.txt')

const H1_LINES: FundReportLines = {
  closingBalanceLine: 21,
  openingBalanceLine: 13,
  depositsLine: 15,
  yieldLine: 16,
  feesLine: 17,
  asOfDateLine: 3,
  periodStartLine: 5,
  chargeLines: [18, 19],
  adjustmentLines: [20],
  feeRateOnDepositLine: 13,
  feeRateOnAccumulationLine: 15,
  investmentTrackLine: 23,
  employerNameLine: 6,
  expectedPensionLine: 8,
}

describe('a report shaped like a real one', () => {
  it('reads the costs beside the fee, and proves itself', () => {
    const reading = readFundReport(H1_LINES, H1)

    expect(formatMoney(reading.closingBalance!)).toBe('₪24,621.00')
    // A fee printed `-260` is money that left. The magnitude is what matters.
    expect(formatMoney(reading.fees!)).toBe('₪260.00')
    expect(reading.charges.map((one) => formatMoney(one))).toEqual(['₪300.00', '₪4.00'])
    expect(reading.adjustments.map((one) => formatMoney(one))).toEqual(['₪6.00'])
    expect(reading.proof).toBe('proved')
  })

  it('is off by the costs when they are left out — the bug the real file found', () => {
    const { chargeLines, adjustmentLines, ...withoutCosts } = H1_LINES
    const reading = readFundReport(withoutCosts, H1)

    expect(reading.proof).toBe('failed')
    // 300 + 4 − 6, and the shekel of rounding.
    expect(formatMoney(reading.periodDelta!)).toBe('₪299.00')
  })

  /**
   * The second real report ever read, and it broke the rule the first one wrote
   * (D-165).
   *
   * A hishtalmut statement whose movements block has five lines and no separate
   * costs at all: opening, deposits, *losses net of investment-management
   * expenses*, *management fees charged this year*, closing. D-152 says the
   * block is exhaustive, so the derivation dutifully listed the last two as
   * costs **as well as** naming them the yield and the fee — and a document that
   * balances to the shekel came out ₪20 out, subtracting both of them twice.
   *
   * A line holds one figure, so a charge on a line an equation term already
   * reads is that term restated. Here that is the fee's line and the yield's.
   */
  it('ignores a cost anchored to a line the equation already reads', () => {
    const duplicated = { ...H1_LINES, chargeLines: [17, 16, 18, 19] }
    const reading = readFundReport(duplicated, H1)

    // The fee and the yield are not counted a second time, so the charges are
    // the two real ones and the report still proves.
    expect(reading.charges.map((one) => formatMoney(one))).toEqual(['₪300.00', '₪4.00'])
    expect(reading.proof).toBe('proved')
  })

  it('does the same for an adjustment that restates a term', () => {
    const duplicated = { ...H1_LINES, adjustmentLines: [20, 15] }
    const reading = readFundReport(duplicated, H1)

    expect(reading.adjustments.map((one) => formatMoney(one))).toEqual(['₪6.00'])
    expect(reading.proof).toBe('proved')
  })

  it('allows the rounding the report admits to, and no more', () => {
    const reading = readFundReport(H1_LINES, H1)

    // Eight whole-shekel terms — opening, paid in, earned, the fee, two costs,
    // the adjustment and the balance — at half a shekel each.
    expect(formatMoney(reading.tolerance!)).toBe('₪4.00')
    expect(formatMoney(reading.periodDelta!)).toBe('₪1.00')
    expect(reading.proof).toBe('proved')
  })

  it('gives no slack at all to a report that prints agorot', () => {
    // Q1 is exact to the agora, so its equation has to come out to zero.
    const exact = readFundReport(Q1_LINES, Q1)
    expect(exact.tolerance?.minor ?? 0).toBe(0)
    expect(exact.proof).toBe('proved')
  })

  it('reads the fee this account pays, not the market average beside it', () => {
    const reading = readFundReport(H1_LINES, H1)

    // Line 13 prints the opening balance *and* `דמי ניהול מהפקדה 1.00%`; the
    // market average `1.05%` is on its own line above and is not what was asked
    // for. Both readings come off the same line and neither takes the other's.
    expect(reading.account.feeOnDepositBasisPoints).toBe(100)
    expect(reading.account.feeOnAccumulationBasisPoints).toBe(20)
    expect(formatMoney(reading.openingBalance!)).toBe('₪0.00')
    expect(formatMoney(reading.deposits!)).toBe('₪24,000.00')
  })

  it('takes the first column of an unlabelled line, not the whole of it', () => {
    // A deposit table's row is `אקמי  04/01/2026  11/2025  17,500 …`, and the
    // first real report had the model point at one where an employer belonged.
    expect(valueOnLine('אקמי                04/01/2026   11/2025   17,500   1,050   בפועל')).toBe(
      'אקמי',
    )
    expect(valueOnLine('מסלול כללי                    4.90%')).toBe('מסלול כללי')
    // With a label, the value is what follows the last colon.
    expect(valueOnLine('שם העמית/ה: ישראל    מספר ת"ז: 000    שם המעסיק: מעבדות תוכנה')).toBe(
      'מעבדות תוכנה',
    )
  })

  it('takes the employer from a line that prints three labelled facts', () => {
    // `שם העמית/ה: … מספר ת"ז: … שם המעסיק: מעבדות תוכנה` — the first attempt
    // returned the member's own name here.
    expect(readFundReport(H1_LINES, H1).account.employerName).toBe('מעבדות תוכנה')
    expect(readFundReport(H1_LINES, H1).account.investmentTrack).toBe('מסלול כללי')
  })

  it('reads the period from both ends, and the projection', () => {
    const reading = readFundReport(H1_LINES, H1)

    expect(reading.periodStart).toEqual({ year: 2026, month: 1, day: 1 })
    expect(reading.asOfDate).toEqual({ year: 2026, month: 6, day: 30 })
    expect(formatMoney(reading.expectedPension!)).toBe('₪640.00')
  })
})

describe('what a real-shaped report tells the surface', () => {
  it('says the period is year-to-date, because two of them double-count', () => {
    const review = reviewFundReport(readFundReport(H1_LINES, H1))
    const messages = review.doubts.map((one) => one.message).join(' ')

    expect(messages).toContain('2026-01-01 to 2026-06-30')
    expect(review.proof).toBe('proved')
  })

  it('names an earlier reading that falls inside the period', () => {
    const review = reviewFundReport(readFundReport(H1_LINES, H1), {
      year: 2026,
      month: 3,
      day: 31,
    })
    const messages = review.doubts.map((one) => one.message).join(' ')

    expect(messages).toContain('counted twice')
  })

  it('says how much of the fee the deposit rate explains', () => {
    // The closest a fund report comes to checking its own fee, which is the
    // figure F13 exists for.
    const messages = reviewFundReport(readFundReport(H1_LINES, H1))
      .doubts.map((one) => one.message)
      .join(' ')

    expect(messages).toContain('₪240.00')
    expect(messages).toContain('₪260.00')
  })

  it('lists the costs as their own rows rather than folding them into the fee', () => {
    const review = reviewFundReport(readFundReport(H1_LINES, H1))
    const labels = review.figures.map((one) => one.label)

    expect(labels).toContain('Cost')
    expect(labels).toContain('Adjustment')
    expect(labels).toContain('Projected pension, monthly')
  })
})

describe('what it says about the fund', () => {
  const fund = {
    fees: { onAccumulationBasisPoints: 50, onDepositBasisPoints: undefined },
    investmentTrack: undefined,
    employerName: undefined,
  }

  it('proposes only what differs, and says what it is replacing', () => {
    const changes = accountChanges(readFundReport(H1_LINES, H1).account, fund)
    const byField = new Map(changes.map((one) => [one.field, one]))

    expect(byField.get('feeOnAccumulationBasisPoints')?.from).toBe('0.5%')
    expect(byField.get('feeOnAccumulationBasisPoints')?.to).toBe('0.2%')
    // Never recorded until now: there is nothing to strike through.
    expect(byField.get('feeOnDepositBasisPoints')?.from).toBeUndefined()
    expect(byField.get('employerName')?.to).toBe('מעבדות תוכנה')
  })

  it('proposes nothing when the document already says the same thing', () => {
    const reading = readFundReport(H1_LINES, H1)
    expect(
      accountChanges(reading.account, {
        fees: { onAccumulationBasisPoints: 20, onDepositBasisPoints: 100 },
        investmentTrack: 'מסלול כללי',
        employerName: 'מעבדות תוכנה',
      }),
    ).toEqual([])
  })

  it('keeps what has no column of its own on the reading, rather than dropping it', () => {
    const draft = snapshotFromReport(readFundReport(H1_LINES, H1), 'fund-1', {
      year: 2020,
      month: 1,
      day: 1,
    })

    expect(draft.note).toContain('Covers 2026-01-01 to 2026-06-30')
    expect(draft.note).toContain('Projected pension')
    expect(draft.note).toContain('מסלול כללי')
    expect(draft.note).toContain('Cost')
  })
})

describe('correcting what nothing checks', () => {
  it('turns a corrected fee into a corrected anchor, so the next report is right', () => {
    // The failure this exists for (D-152): a real report prints the market
    // average beside the account's own rate, and the model took the average
    // twice, in two different prompts. No equation runs through a rate.
    const derived = anchorFundReport(
      { ...H1_LINES, feeRateOnDepositLine: 12 },
      H1,
    ).template

    expect(readAnchoredFundReport(derived, H1).account.feeOnDepositBasisPoints).toBe(105)

    const corrected = retargetToValue(
      derived,
      'feeRateOnDepositLine',
      H1,
      (line) => readRateBasisPoints(line) === 100,
    )

    // The anchor now names the account's own line, and reading is unchanged
    // code: next quarter's report answers 1.00% with no model involved.
    expect(readAnchoredFundReport(corrected, H1).account.feeOnDepositBasisPoints).toBe(100)
    expect(
      corrected.fields.find((one) => one.field === 'feeRateOnDepositLine')?.label,
    ).toContain('דמי ניהול מהפקדה')
  })

  it('moves nothing when the value typed is nowhere on the page', () => {
    const derived = anchorFundReport(H1_LINES, H1).template
    const same = retargetToValue(derived, 'feeRateOnDepositLine', H1, (line) =>
      readRateBasisPoints(line) === 333,
    )
    expect(same).toEqual(derived)
  })

  it('parses a rate however it is typed, and refuses an empty one', () => {
    const facts = { feeOnDepositBasisPoints: 105 }
    expect(editedFacts(facts, { feeOnDepositBasisPoints: '1.00%' }).feeOnDepositBasisPoints).toBe(100)
    expect(editedFacts(facts, { feeOnDepositBasisPoints: '1' }).feeOnDepositBasisPoints).toBe(100)
    // Clearing a field is not a statement that the fee is nothing.
    expect(editedFacts(facts, { feeOnDepositBasisPoints: '' }).feeOnDepositBasisPoints).toBe(105)
  })

  it('lays an edited employer over the one that was read', () => {
    const reading = readFundReport(H1_LINES, H1)
    expect(editedFacts(reading.account, { employerName: 'Software Labs' }).employerName).toBe(
      'Software Labs',
    )
  })
})

/**
 * The confirm surface's half of D-205, for the document F17 calls the weakest
 * verifier of the three: a report that printed nothing to check used to leave a
 * person nothing to do but read the same page through the same template again.
 */
/**
 * One figure typed over or cleared, exactly the way the confirm surface commits
 * one: **a blank field is the key absent**, which is what keeps "the report
 * printed nothing there" apart from "the figure is nothing".
 */
function typed(
  reading: FundReportReading,
  key: 'closingBalance' | 'openingBalance' | 'deposits' | 'fees' | 'yield',
  amount: Money | undefined,
): FundReportReading {
  const next = { ...reading }
  delete next[key]
  return amount === undefined ? next : { ...next, [key]: amount }
}

describe('restateReport — the reading, corrected', () => {
  it('turns unchecked into a period equation that runs when the missing term is typed in', () => {
    // Everything but the fee — which is the figure F13 exists for, and the one
    // a report most often prints somewhere the template did not look.
    const { feesLine: _dropped, ...withoutFees } = Q1_LINES
    const reading = readFundReport(withoutFees, Q1)

    expect(reading.fees).toBeUndefined()
    expect(reading.periodDelta).toBeUndefined()
    // Components still add up, so the report is not `unchecked` — what is
    // missing is the period, and that is what typing the fee in restores.
    const proved = readFundReport(Q1_LINES, Q1)
    expect(proved.periodDelta?.minor).toBe(0)

    const filled = restateReport(typed(reading, 'fees', proved.fees))
    expect(filled.periodDelta?.minor).toBe(0)
    expect(filled.proof).toBe('proved')
  })

  it('fails the period when a figure is typed wrongly, and recovers when it is typed back', () => {
    const reading = readFundReport(Q1_LINES, Q1)
    expect(reading.proof).toBe('proved')

    const wrong = restateReport(typed(reading, 'deposits', fromMajorUnits(1, 'ILS')))
    expect(wrong.proof).toBe('failed')
    expect(wrong.periodDelta?.minor).not.toBe(0)

    expect(restateReport(typed(wrong, 'deposits', reading.deposits)).proof).toBe('proved')
  })

  it('clears a delta whose term was cleared rather than keeping the old one', () => {
    // A blank field means the report printed nothing there. A spread that kept
    // the previous delta would be a proof standing for a figure nobody can see.
    const reading = readFundReport(Q1_LINES, Q1)
    const blank = restateReport(typed(reading, 'openingBalance', undefined))

    expect(blank.periodDelta).toBeUndefined()
    // The components still add up, so the verdict rests on the equation that
    // can still run — which is the whole reason a report's `proved` is per
    // figure and a slip's is all-or-nothing.
    expect(blank.componentDelta?.minor).toBe(0)
    expect(blank.proof).toBe('proved')
  })

  it('fails outright when the one figure a report exists to state is cleared', () => {
    const reading = readFundReport(Q1_LINES, Q1)
    expect(restateReport(typed(reading, 'closingBalance', undefined)).proof).toBe('failed')
  })

  it('carries the template’s own account of itself through untouched', () => {
    const reading = readFundReport(Q1_LINES, Q1)
    const edited = restateReport(typed(reading, 'yield', fromMajorUnits(1, 'ILS')))

    expect(edited.lines).toEqual(reading.lines)
    expect(edited.unresolved).toEqual(reading.unresolved)
    expect(edited.account).toEqual(reading.account)
  })
})
