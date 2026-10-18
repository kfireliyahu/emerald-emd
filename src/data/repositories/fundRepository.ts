/**
 * Funds and their readings — **a fund is a holding** (M36 U12, D-389): a
 * `FundAccount` is a `holding` row whose `fund_type` is set, a
 * `FundBalanceSnapshot` one of its `holding_reading` rows, and a `FundDeposit` a
 * `reading_deposit` row of the reading that printed it. Before U12 they were
 * three formats of their own beside the holdings, and a pension entered both ways
 * counted twice; now there is one row for it, and every total reads that row.
 *
 * Owns its SQL and its row decoding, like every repository here. What it does
 * **not** own is any arithmetic: the expected contributions, the reconciliation
 * and every fee and return figure come from `@/domain/funds.ts`, and this file's
 * job is to hand that domain the rows it needs and nothing else.
 *
 * Two things are worth knowing before reading further:
 *
 * - **Expected contributions are not stored and are not recomputed here.**
 *   `expectedContributionsFor` loads the payslips and calls the one domain
 *   function that knows the rule. A second implementation in SQL would be a
 *   second answer to "what should have reached this fund", and the two would
 *   disagree the first time the rule changed.
 * - **A snapshot belongs to its fund.** Deleting a fund removes its
 *   snapshots with it, the way deleting a paycheck takes its lines — nothing
 *   outside a fund addresses one.
 * - **Whether a reading's parts make its value is the pack's identity**, not
 *   code here (D-280). `snapshotProblems` asks the document's declaration and
 *   refuses a reading its `parts` identity fails; a reading that left a part
 *   out is `unchecked`, which refuses nothing.
 */

import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  parseISODate,
  parseYearMonth,
  toISODate,
  toYearMonthString,
  type LocalDate,
} from '@/core/time.ts'
import {
  depositPeriods,
  depositsByMonth,
  distinctDeposits,
  effectiveFee,
  expectedContributions,
  fundReturns,
  reconcileDeposits,
  sortSnapshots,
  validateSnapshot,
  type DepositPeriod,
  type DepositReconciliation,
  type DepositTolerance,
  type EffectiveFee,
  type FundReturns,
  type FundWithLatest,
  type MonthlyDeposit,
  type SnapshotProblem,
} from '@/domain/funds.ts'
import {
  FUND_STATUSES,
  FUND_TYPES,
  type ExpectedContribution,
  type FundAccount,
  type FundBalanceSnapshot,
  type FundDeposit,
  type FundStatus,
  type FundType,
  type ReadDeposit,
} from '@/domain/model/funds.ts'
import type { DeductionType } from '@/domain/model/paycheck.ts'
import { verdictSentence, type Verdict } from '@/domain/format/identity.ts'
import { verdictsOf, type StoredValue } from '@/domain/format/row.ts'
import { inTransaction, query } from '../db/database.ts'
import { latestOf } from '../packs/ledger/figures.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { listDeductionTypes, unlinkDeductionTypes } from './deductionTypeRepository.ts'
import { listPaychecksWithLines } from './paycheckRepository.ts'
import { unaimBuckets } from './splitPlanRepository.ts'

export interface NewFundAccount {
  readonly name: string
  readonly fundType: FundType
  readonly institutionId?: string | undefined
  readonly policyNumber?: string | undefined
  readonly investmentTrack?: string | undefined
  readonly status?: FundStatus | undefined
  readonly employerName?: string | undefined
  readonly openedDate?: LocalDate | undefined
  readonly firstDepositDate?: LocalDate | undefined
  readonly feeOnAccumulationBasisPoints?: number | undefined
  readonly feeOnDepositBasisPoints?: number | undefined
  readonly feeNegotiatedUntil?: LocalDate | undefined
  /** A yearly return the provider agreed to, in basis points; kept apart from an assumed one (M28 U8, S6). */
  readonly agreedReturnBasisPoints?: number | undefined
  readonly beneficiaries?: string | undefined
  readonly notes?: string | undefined
}

export type FundAccountEdit = Partial<NewFundAccount>

// The fee columns are percentages to two places, stored as the basis points
// the domain reads (D-257). A fund's fee on what it holds is the holding's
// `fee`, and a return the provider agreed to is its `CONTRACTUAL` expected one.
const FUND_SELECT = `SELECT id, name, fund_type, institution AS institution_id, policy_number,
                            investment_track, status, employer_name, opened AS opened_date,
                            first_deposit AS first_deposit_date,
                            fee AS fee_on_accumulation_bp,
                            fee_on_deposit AS fee_on_deposit_bp, fee_negotiated_until,
                            CASE WHEN expected_return_basis = 'CONTRACTUAL' THEN expected_return END
                              AS agreed_return_bp,
                            beneficiaries, note AS notes, is_archived
                       FROM fmt_holding
                      WHERE fund_type IS NOT NULL`

/**
 * Every fund, active first and dormant after — which is the funds screen's two
 * sections in one query.
 *
 * Archived funds are left out by default and are not a status: a closed fund is
 * a fact about the policy, and archiving is a fact about whether the user wants
 * to look at it (docs/04's soft-archive convention).
 */
export function listFunds(
  db: Database,
  options?: { readonly includeArchived?: boolean },
): readonly FundAccount[] {
  const where = options?.includeArchived === true ? '' : ' AND is_archived = 0'
  return decodeFunds(
    query(
      db,
      `${FUND_SELECT}${where}
        ORDER BY CASE COALESCE(status, 'ACTIVE') WHEN 'ACTIVE' THEN 0 WHEN 'DORMANT' THEN 1 ELSE 2 END, name`,
    ),
  )
}

export function findFund(db: Database, id: string): FundAccount | undefined {
  return decodeFunds(query(db, `${FUND_SELECT} AND id = ?`, [id]))[0]
}

/**
 * Make a fund: a holding in no place, its kind `FUND`, transcribed from its
 * reports and never reachable this week (D-074, D-389).
 */
export function createFund(db: Database, input: NewFundAccount, _now: number): FundAccount {
  const [id = ''] = insertRows(db, declared(db, 'holding'), [
    { ...fundColumns(input), kind: 'FUND', provenance: 'TRANSCRIBED', is_liquid: 0, is_archived: 0 },
  ])

  const created = findFund(db, id)
  if (created === undefined) throw new Error('fund account did not survive insert')
  return created
}

/**
 * Change a fund in place. Fields left out are left alone; fields named and set
 * to `undefined` are cleared.
 *
 * The distinction matters most for the two fee columns and `feeNegotiatedUntil`:
 * "I do not know my fee" and "my fee is zero" are different claims, and a `??`
 * that coalesced the first into keeping the old value would make an expired
 * agreement uneditable.
 */
export function updateFund(
  db: Database,
  id: string,
  edit: FundAccountEdit,
  _now: number,
): void {
  const existing = findFund(db, id)
  if (existing === undefined) return

  const pick = <K extends keyof FundAccountEdit>(
    key: K,
    current: FundAccountEdit[K],
  ): FundAccountEdit[K] => (key in edit ? edit[key] : current)

  updateRow(
    db,
    declared(db, 'holding'),
    id,
    fundColumns({
      name: edit.name ?? existing.name,
      fundType: edit.fundType ?? existing.fundType,
      institutionId: pick('institutionId', existing.institutionId),
      policyNumber: pick('policyNumber', existing.policyNumber),
      investmentTrack: pick('investmentTrack', existing.investmentTrack),
      status: edit.status ?? existing.status,
      employerName: pick('employerName', existing.employerName),
      openedDate: pick('openedDate', existing.openedDate),
      firstDepositDate: pick('firstDepositDate', existing.firstDepositDate),
      feeOnAccumulationBasisPoints: pick(
        'feeOnAccumulationBasisPoints',
        existing.fees.onAccumulationBasisPoints,
      ),
      feeOnDepositBasisPoints: pick('feeOnDepositBasisPoints', existing.fees.onDepositBasisPoints),
      feeNegotiatedUntil: pick('feeNegotiatedUntil', existing.feeNegotiatedUntil),
      agreedReturnBasisPoints: pick('agreedReturnBasisPoints', existing.agreedReturnBasisPoints),
      beneficiaries: pick('beneficiaries', existing.beneficiaries),
      notes: pick('notes', existing.notes),
    }),
  )
}

/** A fund as the holding's columns. The fees go in as the basis points they are stored as. */
function fundColumns(fund: NewFundAccount): Record<string, StoredValue> {
  return {
    name: fund.name,
    fund_type: fund.fundType,
    institution: fund.institutionId ?? null,
    policy_number: fund.policyNumber ?? null,
    investment_track: fund.investmentTrack ?? null,
    status: fund.status ?? 'ACTIVE',
    employer_name: fund.employerName ?? null,
    opened: dateOrNull(fund.openedDate),
    first_deposit: dateOrNull(fund.firstDepositDate),
    fee: fund.feeOnAccumulationBasisPoints ?? null,
    fee_on_deposit: fund.feeOnDepositBasisPoints ?? null,
    fee_negotiated_until: dateOrNull(fund.feeNegotiatedUntil),
    expected_return: fund.agreedReturnBasisPoints ?? null,
    expected_return_basis: fund.agreedReturnBasisPoints === undefined ? null : 'CONTRACTUAL',
    beneficiaries: fund.beneficiaries ?? null,
    note: fund.notes ?? null,
  }
}

export function setFundArchived(
  db: Database,
  id: string,
  isArchived: boolean,
  _now: number,
): void {
  updateRow(db, declared(db, 'holding'), id, { is_archived: isArchived ? 1 : 0 })
}

/**
 * Remove a fund, its snapshots and their deposit rows, and every deduction-type
 * link that named it.
 *
 * The links go because a
 * payslip line pointing at a fund that is gone would keep producing expected
 * contributions for it — the reconciliation would then compare payslips against
 * a fund with no reports, forever. Clearing the link is the honest version of
 * "this money is no longer tracked here".
 *
 * The snapshots go because nothing outside a fund addresses one, exactly as a
 * paycheck's lines go with the paycheck.
 */
export function deleteFund(db: Database, id: string, _now: number): void {
  if (findFund(db, id) === undefined) return
  const ids = (sql: string): string[] => query(db, sql, [id]).map((row) => String(row['id']))
  inTransaction(db, () => {
    const formats = allDeclared(db)
    // Children first, so no removal leaves a link naming nothing (D-263).
    deleteRows(
      db,
      declared(db, 'reading_deposit'),
      ids('SELECT id FROM fmt_reading_deposit WHERE reading IN (SELECT id FROM fmt_holding_reading WHERE holding = ?)'),
      formats,
    )
    deleteRows(db, declared(db, 'holding_reading'), ids('SELECT id FROM fmt_holding_reading WHERE holding = ?'), formats)
    unlinkDeductionTypes(db, 'linked_holding', id)
    unaimBuckets(db, 'target_holding', id)
    deleteRows(db, declared(db, 'holding'), [id], formats)
  })
}

// --- Snapshots --------------------------------------------------------------

export interface NewSnapshot {
  readonly fundAccountId: string
  readonly asOfDate: LocalDate
  readonly totalBalance: Money
  readonly employeeComponent?: Money | undefined
  readonly employerComponent?: Money | undefined
  readonly severanceComponent?: Money | undefined
  readonly depositsSincePrevious?: Money | undefined
  readonly feesChargedSincePrevious?: Money | undefined
  readonly returnSincePrevious?: Money | undefined
  readonly note?: string | undefined
}

export type SnapshotEdit = Partial<Omit<NewSnapshot, 'fundAccountId'>>

// A reading is in one currency (`validateSnapshot` refuses a mix), so the
// value's is the one every amount is decoded in.
const SNAPSHOT_SELECT = `SELECT id, holding AS fund_account_id, as_of AS as_of_date,
                                value_currency AS currency, value_minor AS total_balance_minor,
                                employee_minor, employer_minor, severance_minor, deposits_minor,
                                fees_charged_minor, return_amount_minor AS return_minor,
                                deposit_gap_acknowledged, note
                           FROM fmt_holding_reading
                          WHERE 1 = 1`

/** Every reading of one fund, oldest first — the order every window is walked in. */
export function listSnapshots(db: Database, fundAccountId: string): readonly FundBalanceSnapshot[] {
  return decodeSnapshots(
    query(db, `${SNAPSHOT_SELECT} AND holding = ? ORDER BY as_of`, [fundAccountId]),
  )
}

export function findSnapshot(db: Database, id: string): FundBalanceSnapshot | undefined {
  return decodeSnapshots(query(db, `${SNAPSHOT_SELECT} AND id = ?`, [id]))[0]
}

/**
 * The most recent reading of one fund, which is what "current balance" means —
 * **the one the holding's `reading` picks** (D-272, D-381), read rather than
 * sorted for again here (M36 U03): the engine's `latest` by `as_of`, and the
 * reading of that day. None when the fund has no reading.
 */
export function latestSnapshot(db: Database, fundAccountId: string): FundBalanceSnapshot | undefined {
  const balance = latestOf(db, 'holding', 'reading', fundAccountId)
  if (balance.kind !== 'VALUE' || balance.at === undefined) return undefined
  return decodeSnapshots(
    query(db, `${SNAPSHOT_SELECT} AND holding = ? AND as_of = ?`, [fundAccountId, String(balance.at)]),
  )[0]
}

export class DuplicateSnapshotError extends Error {
  constructor(readonly asOfDate: LocalDate) {
    super(
      `This fund already has a reading for ${toISODate(asOfDate)}. Edit that one rather than adding a second.`,
    )
    this.name = 'DuplicateSnapshotError'
  }
}

/**
 * Record a reading transcribed from a report.
 *
 * `one row per holding, as_of` would refuse a second reading for one date
 * anyway; this refuses it by name first, because "the fund already has a
 * reading for that date" is a sentence and a constraint violation is not.
 * docs/04's other two invariants — a non-negative balance, parts that make the
 * total — are `snapshotProblems` and belong to the form, which can show them
 * beside the field that caused them rather than as a failed save.
 */
export function addSnapshot(db: Database, input: NewSnapshot, _now: number): FundBalanceSnapshot {
  const clash = query(
    db,
    'SELECT id FROM fmt_holding_reading WHERE holding = ? AND as_of = ?',
    [input.fundAccountId, toISODate(input.asOfDate)],
  )
  if (clash.length > 0) throw new DuplicateSnapshotError(input.asOfDate)

  const [id = ''] = insertRows(db, declared(db, 'holding_reading'), [
    {
      holding: input.fundAccountId,
      ...snapshotColumns(input),
      deposit_gap_acknowledged: 0,
    },
  ])

  const created = findSnapshot(db, id)
  if (created === undefined) throw new Error('snapshot did not survive insert')
  return created
}

/**
 * Correct a reading. Fields left out are left alone; fields named and set to
 * `undefined` are cleared.
 *
 * Transcription from a paper report is what this table is for, so getting a
 * digit wrong is the expected case rather than the exceptional one.
 */
export function updateSnapshot(db: Database, id: string, edit: SnapshotEdit, _now: number): void {
  const existing = findSnapshot(db, id)
  if (existing === undefined) return

  const pick = <K extends keyof SnapshotEdit>(key: K, current: SnapshotEdit[K]): SnapshotEdit[K] =>
    key in edit ? edit[key] : current

  const total = edit.totalBalance ?? existing.totalBalance
  if (edit.asOfDate !== undefined) {
    const clash = query(
      db,
      `SELECT id FROM fmt_holding_reading
        WHERE holding = ? AND as_of = ? AND id <> ?`,
      [existing.fundAccountId, toISODate(edit.asOfDate), id],
    )
    if (clash.length > 0) throw new DuplicateSnapshotError(edit.asOfDate)
  }

  updateRow(db, declared(db, 'holding_reading'), id, {
    ...snapshotColumns({
      asOfDate: edit.asOfDate ?? existing.asOfDate,
      totalBalance: total,
      employeeComponent: pick('employeeComponent', existing.employeeComponent),
      employerComponent: pick('employerComponent', existing.employerComponent),
      severanceComponent: pick('severanceComponent', existing.severanceComponent),
      depositsSincePrevious: pick('depositsSincePrevious', existing.depositsSincePrevious),
      feesChargedSincePrevious: pick('feesChargedSincePrevious', existing.feesChargedSincePrevious),
      returnSincePrevious: pick('returnSincePrevious', existing.returnSincePrevious),
      note: pick('note', existing.note),
    }),
  })
}

/** A reading's figures as the pack's columns: each money column its own two cells. */
function snapshotColumns(snapshot: Omit<NewSnapshot, 'fundAccountId'>): Record<string, StoredValue> {
  return {
    as_of: toISODate(snapshot.asOfDate),
    ...moneyCells('value', snapshot.totalBalance),
    ...moneyCells('employee', snapshot.employeeComponent),
    ...moneyCells('employer', snapshot.employerComponent),
    ...moneyCells('severance', snapshot.severanceComponent),
    ...moneyCells('deposits', snapshot.depositsSincePrevious),
    ...moneyCells('fees_charged', snapshot.feesChargedSincePrevious),
    ...moneyCells('return_amount', snapshot.returnSincePrevious),
    note: snapshot.note ?? null,
  }
}

export function deleteSnapshot(db: Database, id: string, _now: number): void {
  inTransaction(db, () => {
    const formats = allDeclared(db)
    // The deposit rows go with the reading that transcribed them. They are what
    // one report said, and a report nobody is keeping has nothing left to say.
    deleteRows(db, declared(db, 'reading_deposit'), depositIdsOf(db, id), formats)
    deleteRows(db, declared(db, 'holding_reading'), [id], formats)
  })
}

function depositIdsOf(db: Database, snapshotId: string): string[] {
  return query(db, 'SELECT id FROM fmt_reading_deposit WHERE reading = ?', [snapshotId]).map((row) =>
    String(row['id']),
  )
}

/**
 * What stops a reading being entered: `validateSnapshot`'s invariants, and the
 * pack's `parts` identity failing (D-280).
 *
 * **The parts are the identity's verdict, not a sum here.** It is the same
 * judgement `format_rows` prints for the row, from the same declaration, so a
 * person who widened the tolerance on the Formats screen widened it here too.
 * A reading that left a part out is unchecked, which refuses nothing: a report
 * that broke out one part has claimed nothing about the sum.
 */
export interface SnapshotJudgement {
  readonly problems: readonly SnapshotProblem[]
  /** The identity's verdict on the reading, when the document declares one. */
  readonly parts: Verdict | undefined
  /** And its sentence, for a surface that prints rather than draws it. */
  readonly partsSentence: string | undefined
}

export function snapshotProblems(
  db: Database,
  snapshot: FundBalanceSnapshot,
  existing: readonly FundBalanceSnapshot[],
): SnapshotJudgement {
  const problems = [...validateSnapshot(snapshot, existing)]
  const declaration = declared(db, 'holding_reading')
  const judged = verdictsOf(declaration, {
    id: snapshot.id,
    cells: { holding: snapshot.fundAccountId, ...snapshotColumns(snapshot) },
  }).find((each) => each.identity.name === PARTS)
  if (judged?.verdict.kind === 'FAILED' && !problems.includes('MIXED_CURRENCY')) {
    problems.push('COMPONENTS_DISAGREE')
  }
  return {
    problems,
    parts: judged?.verdict,
    partsSentence: judged === undefined ? undefined : verdictSentence(judged.identity, judged.verdict),
  }
}

/** The name the pack declares the parts-against-total identity under. */
const PARTS = 'parts'

// --- The deposit table a report prints (D-153) ------------------------------

// A row with no amount at all is never written, so one of its currencies is
// always there — and a row is in one currency.
const DEPOSIT_SELECT = `SELECT d.id, r.holding AS fund_account_id, d.reading AS snapshot_id,
                               d.employer_name, d.deposit_date, d.salary_month,
                               COALESCE(d.total_currency, d.employee_currency, d.employer_currency,
                                        d.severance_currency, d.salary_currency) AS currency,
                               d.employee_minor, d.employer_minor, d.severance_minor, d.total_minor,
                               d.salary_minor, d.note
                          FROM fmt_reading_deposit d JOIN fmt_holding_reading r ON r.id = d.reading
                         WHERE 1 = 1`

/**
 * Every deposit row of one fund, oldest salary month first.
 *
 * **The tie is broken by the reading that transcribed the row**, oldest report
 * first, and that is not cosmetic. `distinctDeposits` keeps the *first*
 * statement of each deposit on the argument that the earliest report to state it
 * is the one closest to it in time — which was true only for as long as reports
 * were read in the order they arrived. A backfill is the opposite case: eight
 * years of quarterlies opened newest-first would have made every surviving row
 * cite the latest report that restated it. The order the documents were *read*
 * in is an accident of the afternoon; the order they were *written* in is not.
 */
export function listFundDeposits(db: Database, fundAccountId: string): readonly FundDeposit[] {
  return decodeDeposits(
    query(
      db,
      `${DEPOSIT_SELECT} AND r.holding = ?
        ORDER BY d.salary_month, d.deposit_date, r.as_of`,
      [fundAccountId],
    ),
  )
}

/**
 * Write a reading's deposit table, replacing whatever it held before.
 *
 * **Whole, never merged**, and that is the decision this function makes. A
 * reading's rows are one document's table; re-reading the same report with a
 * corrected format has to be able to *remove* a row that was never there, which
 * a merge cannot do. The rows of *other* readings are untouched — two reports
 * that overlap both keep their own tables, and `distinctDeposits` in the domain
 * is where the double-counting is resolved (D-153).
 */
export function replaceSnapshotDeposits(
  db: Database,
  snapshotId: string,
  fundAccountId: string,
  rows: readonly ReadDeposit[],
  _now: number,
): void {
  // A reading of another fund is not this fund's table to write.
  if (findSnapshot(db, snapshotId)?.fundAccountId !== fundAccountId) {
    throw new Error('That reading is not this fund’s.')
  }
  const cells: Record<string, StoredValue>[] = []
  for (const row of rows) {
    const currency =
      row.total?.currency ??
      row.employee?.currency ??
      row.employer?.currency ??
      row.severance?.currency ??
      row.salary?.currency
    // A row with no amount at all is not a deposit, and it has no currency to
    // store either. `readDepositRow` never produces one; this is the guard that
    // says so where it would otherwise be an empty string in a NOT NULL column.
    if (currency === undefined) continue

    cells.push({
      reading: snapshotId,
      employer_name: row.employerName ?? null,
      deposit_date: row.depositDate === undefined ? null : toISODate(row.depositDate),
      salary_month: row.salaryMonth === undefined ? null : toYearMonthString(row.salaryMonth),
      ...moneyCells('employee', row.employee),
      ...moneyCells('employer', row.employer),
      ...moneyCells('severance', row.severance),
      ...moneyCells('total', row.total),
      ...moneyCells('salary', row.salary),
      note: row.note ?? null,
    })
  }

  const deposits = declared(db, 'reading_deposit')
  inTransaction(db, () => {
    deleteRows(db, deposits, depositIdsOf(db, snapshotId), allDeclared(db))
    insertRows(db, deposits, cells)
  })
}


function decodeDeposits(rows: readonly Record<string, unknown>[]): readonly FundDeposit[] {
  return rows.map(decodeDeposit)
}

function decodeDeposit(row: Record<string, unknown>): FundDeposit {
  const currency = String(row['currency'])
  const amount = (value: unknown): Money | undefined => {
    const minor = integer(value)
    return minor === undefined ? undefined : money(minor, currency)
  }
  const month = text(row['salary_month'])
  const paid = text(row['deposit_date'])

  return {
    id: String(row['id']),
    fundAccountId: String(row['fund_account_id']),
    snapshotId: String(row['snapshot_id']),
    employerName: text(row['employer_name']),
    // A row whose month or date will not parse keeps the rest of itself. Unlike
    // a snapshot, whose date is what every window is built on, a deposit with no
    // readable month is still money that arrived — it counts towards the fund's
    // total and towards no month, which is exactly what the surface says.
    depositDate: paid === undefined ? undefined : parseISODate(paid),
    salaryMonth: month === undefined ? undefined : parseYearMonth(month),
    employee: amount(row['employee_minor']),
    employer: amount(row['employer_minor']),
    severance: amount(row['severance_minor']),
    total: amount(row['total_minor']),
    salary: amount(row['salary_minor']),
    note: text(row['note']),
  }
}


/**
 * Record that the user chased the deposit gap ending at this reading and found
 * it explained.
 *
 * The one thing in F13 that is stored rather than derived (D-066), and it is
 * reversible: an acknowledgement made in March about a gap that has since grown
 * is one the user should be able to take back.
 */
export function acknowledgeDepositGap(
  db: Database,
  snapshotId: string,
  acknowledged: boolean,
  _now: number,
): void {
  updateRow(db, declared(db, 'holding_reading'), snapshotId, {
    deposit_gap_acknowledged: acknowledged ? 1 : 0,
  })
}

// --- Reading across the two, and across the payslips ------------------------

/** Every fund with its most recent reading — what the funds screen and the totals read. */
export function listFundsWithLatest(
  db: Database,
  options?: { readonly includeArchived?: boolean },
): readonly FundWithLatest[] {
  return listFunds(db, options).map((fund) => ({
    fund,
    latest: latestSnapshot(db, fund.id),
  }))
}

/**
 * Which deduction types feed a fund — docs/f13's `linkedDeductionTypeIds`, asked
 * of the side that actually stores it.
 *
 * The field docs/f13 wanted on `FundAccount` is this query (D-066). Keeping it a
 * query rather than a column is what makes it impossible for the two directions
 * to disagree.
 */
export function deductionTypesForFund(db: Database, fundAccountId: string): readonly DeductionType[] {
  return listDeductionTypes(db).filter((type) => type.linkedFundId === fundAccountId)
}

/**
 * What the payslips say should have reached a fund, or every fund.
 *
 * Loads the payslips and calls the domain. There is deliberately no SQL version
 * of this rule: the severance split, the two amount columns and the "one record
 * per fund per payslip" shape all live in `expectedContributions`, and a second
 * implementation would be a second answer.
 */
export function expectedContributionsFor(
  db: Database,
  fundAccountId?: string,
): readonly ExpectedContribution[] {
  const all = expectedContributions(listPaychecksWithLines(db), listDeductionTypes(db))
  return fundAccountId === undefined
    ? all
    : all.filter((contribution) => contribution.fundAccountId === fundAccountId)
}

/**
 * The deposit check for one fund, assembled from the three places its inputs
 * live.
 *
 * Here rather than in a screen for the reason `bankSpendingBasis` hands out a
 * total: a caller that gathered snapshots and contributions itself could pair a
 * fund's snapshots with another fund's payslips, or forget the lag, and the
 * result would look like an answer either way.
 */
export function fundDepositCheck(
  db: Database,
  fundAccountId: string,
  currency: CurrencyCode,
  options?: { readonly lagMonths?: number; readonly tolerance?: DepositTolerance },
): DepositReconciliation | undefined {
  const fund = findFund(db, fundAccountId)
  if (fund === undefined) return undefined

  return reconcileDeposits({
    status: fund.status,
    snapshots: sortSnapshots(listSnapshots(db, fundAccountId)),
    contributions: expectedContributionsFor(db, fundAccountId),
    currency,
    ...(options?.lagMonths === undefined ? {} : { lagMonths: options.lagMonths }),
    ...(options?.tolerance === undefined ? {} : { tolerance: options.tolerance }),
  })
}

/**
 * Everything the fund detail screen derives, from one load of the payslips.
 *
 * Assembled here rather than in the screen for the reason `fundDepositCheck`
 * is (D-067): the reconciliation, the return series and the per-period table all
 * take the same three inputs, and a caller gathering them itself could pair one
 * fund's snapshots with another's payslips, use the lag in one place and not the
 * next, or hand `periodReturn` the wrong contributions — which is the one thing
 * D-066's signature exists to prevent. One function, one set of inputs, four
 * answers that cannot disagree with each other.
 */
export interface FundAnalysis {
  readonly fund: FundAccount
  readonly snapshots: readonly FundBalanceSnapshot[]
  /** The cumulative verdict — docs/f13's one clear sentence. */
  readonly reconciliation: DepositReconciliation
  /** The working behind it, one row per window. */
  readonly periods: readonly DepositPeriod[]
  /**
   * And the sharper working, one row per **salary month**, where the fund's
   * reports printed a deposit table to build it from (D-153).
   *
   * Empty for a fund whose reports print only totals, which is why the windows
   * above stay: this is a better answer where the document supports one, never a
   * replacement for the one that always works.
   */
  readonly months: readonly MonthlyDeposit[]
  /** The deposit rows themselves, deduplicated across overlapping reports. */
  readonly deposits: readonly FundDeposit[]
  readonly returns: FundReturns
  readonly fee: EffectiveFee
  /** Which payslip lines feed this fund. docs/f13's `linkedDeductionTypeIds`, as a query. */
  readonly linkedTypes: readonly DeductionType[]
}

export function fundAnalysis(
  db: Database,
  fundAccountId: string,
  options?: {
    /** Defaults to whatever the fund's own readings are denominated in. */
    readonly currency?: CurrencyCode
    readonly lagMonths?: number
    readonly tolerance?: DepositTolerance
  },
): FundAnalysis | undefined {
  const fund = findFund(db, fundAccountId)
  if (fund === undefined) return undefined

  const snapshots = listSnapshots(db, fundAccountId)
  // A fund is denominated in whatever its readings say. Taking it from the data
  // rather than from the caller means a screen cannot ask for a total in a
  // currency the fund was never recorded in, which `sum` would throw on.
  const currency = options?.currency ?? snapshots[0]?.totalBalance.currency ?? 'ILS'
  const contributions = expectedContributionsFor(db, fundAccountId)
  const deposits = listFundDeposits(db, fundAccountId)
  const shared = {
    status: fund.status,
    snapshots,
    contributions,
    currency,
    ...(options?.lagMonths === undefined ? {} : { lagMonths: options.lagMonths }),
  }

  return {
    fund,
    snapshots,
    reconciliation: reconcileDeposits({
      ...shared,
      ...(options?.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    }),
    periods: depositPeriods(shared),
    months: depositsByMonth({
      deposits,
      contributions,
      currency,
      ...(options?.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    }),
    deposits: distinctDeposits(deposits),
    returns: fundReturns(shared),
    fee: effectiveFee(snapshots, fund.fees.onAccumulationBasisPoints),
    linkedTypes: deductionTypesForFund(db, fundAccountId),
  }
}

/**
 * The deposit check for every fund at once — the funds screen's warning chip,
 * and the deposit-check screen's whole content.
 *
 * One pass over the payslips rather than one per fund: `expectedContributionsFor`
 * loads every paycheck with its lines, and a list of eight funds asking
 * individually would load them eight times on every render.
 *
 * Archived funds are included when asked for, because a fund can be archived
 * with a gap still open in it and hiding the gap is not the same as answering
 * it.
 */
export function fundDepositChecks(
  db: Database,
  currency: CurrencyCode,
  options?: {
    readonly includeArchived?: boolean
    readonly lagMonths?: number
    readonly tolerance?: DepositTolerance
  },
): ReadonlyMap<string, DepositReconciliation> {
  const contributions = expectedContributionsFor(db)
  const byFund = new Map<string, DepositReconciliation>()

  for (const fund of listFunds(db, { includeArchived: options?.includeArchived === true })) {
    byFund.set(
      fund.id,
      reconcileDeposits({
        status: fund.status,
        snapshots: listSnapshots(db, fund.id),
        contributions: contributions.filter(
          (contribution) => contribution.fundAccountId === fund.id,
        ),
        currency,
        ...(options?.lagMonths === undefined ? {} : { lagMonths: options.lagMonths }),
        ...(options?.tolerance === undefined ? {} : { tolerance: options.tolerance }),
      }),
    )
  }

  return byFund
}

/**
 * **The months each fund's own deposit tables say fell short** (M36 U12, D-389)
 * — a payslip that put money in for a salary month whose rows show less, or show
 * none of a part it put in: an employer's deposit that never arrived. One load of
 * the payslips for every fund, as `fundDepositChecks` does.
 *
 * The windows above need two readings and judge a quarter; this needs one report
 * with a table, and names the month — so a list can say a deposit is missing
 * the day the first report is read.
 */
export function fundMissingMonths(
  db: Database,
  options?: { readonly includeArchived?: boolean; readonly tolerance?: DepositTolerance },
): ReadonlyMap<string, readonly MonthlyDeposit[]> {
  const contributions = expectedContributionsFor(db)
  const out = new Map<string, readonly MonthlyDeposit[]>()
  for (const fund of listFunds(db, { includeArchived: options?.includeArchived === true })) {
    const deposits = listFundDeposits(db, fund.id)
    if (deposits.length === 0) continue
    const currency = listSnapshots(db, fund.id)[0]?.totalBalance.currency ?? 'ILS'
    const missing = depositsByMonth({
      deposits,
      contributions: contributions.filter((one) => one.fundAccountId === fund.id),
      currency,
      ...(options?.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    }).filter((month) => month.status === 'MISSING')
    if (missing.length > 0) out.set(fund.id, missing)
  }
  return out
}

// --- Decoding ---------------------------------------------------------------

function dateOrNull(date: LocalDate | undefined): string | null {
  return date === undefined ? null : toISODate(date)
}

/** A money column's two cells, both empty for no amount. */
function moneyCells(column: string, amount: Money | undefined): Record<string, StoredValue> {
  return {
    [`${column}_minor`]: amount === undefined ? null : amount.minor,
    [`${column}_currency`]: amount === undefined ? null : amount.currency,
  }
}

const VALID_TYPES: ReadonlySet<string> = new Set<string>(FUND_TYPES)
const VALID_STATUSES: ReadonlySet<string> = new Set<string>(FUND_STATUSES)


function decodeFunds(rows: readonly Record<string, unknown>[]): readonly FundAccount[] {
  const funds: FundAccount[] = []
  for (const row of rows) {
    const fund = decodeFund(row)
    if (fund !== undefined) funds.push(fund)
  }
  return funds
}

/**
 * Defensive, as everywhere else here: a `.emd` file is a real SQLite
 * database the user can open in any tool. A fund type this build has not heard
 * of is skipped rather than thrown — it would have no fee benchmark and no place
 * on either section of the screen.
 */
function decodeFund(row: Record<string, unknown>): FundAccount | undefined {
  const fundType = String(row['fund_type'])
  if (!VALID_TYPES.has(fundType)) return undefined

  const status = String(row['status'] ?? 'ACTIVE')

  return {
    id: String(row['id']),
    name: String(row['name']),
    fundType: fundType as FundType,
    institutionId: text(row['institution_id']),
    policyNumber: text(row['policy_number']),
    investmentTrack: text(row['investment_track']),
    status: VALID_STATUSES.has(status) ? (status as FundStatus) : 'ACTIVE',
    employerName: text(row['employer_name']),
    openedDate: date(row['opened_date']),
    firstDepositDate: date(row['first_deposit_date']),
    fees: {
      onAccumulationBasisPoints: integer(row['fee_on_accumulation_bp']),
      onDepositBasisPoints: integer(row['fee_on_deposit_bp']),
    },
    feeNegotiatedUntil: date(row['fee_negotiated_until']),
    agreedReturnBasisPoints: integer(row['agreed_return_bp']),
    beneficiaries: text(row['beneficiaries']),
    notes: text(row['notes']),
    isArchived: Number(row['is_archived'] ?? 0) === 1,
  }
}

function decodeSnapshots(
  rows: readonly Record<string, unknown>[],
): readonly FundBalanceSnapshot[] {
  const snapshots: FundBalanceSnapshot[] = []
  for (const row of rows) {
    const snapshot = decodeSnapshot(row)
    if (snapshot !== undefined) snapshots.push(snapshot)
  }
  return snapshots
}

/**
 * A reading with no readable date is skipped: `asOfDate` is what every window,
 * every ordering and the uniqueness invariant are built on, and a snapshot that
 * cannot say when it was taken cannot participate in any of them.
 */
function decodeSnapshot(row: Record<string, unknown>): FundBalanceSnapshot | undefined {
  const asOfDate = date(row['as_of_date'])
  if (asOfDate === undefined) return undefined

  const currency = String(row['currency'])
  const amount = (value: unknown): Money | undefined => {
    const minor = integer(value)
    return minor === undefined ? undefined : money(minor, currency)
  }

  return {
    id: String(row['id']),
    fundAccountId: String(row['fund_account_id']),
    asOfDate,
    totalBalance: money(Number(row['total_balance_minor'] ?? 0), currency),
    employeeComponent: amount(row['employee_minor']),
    employerComponent: amount(row['employer_minor']),
    severanceComponent: amount(row['severance_minor']),
    depositsSincePrevious: amount(row['deposits_minor']),
    feesChargedSincePrevious: amount(row['fees_charged_minor']),
    returnSincePrevious: amount(row['return_minor']),
    depositGapAcknowledged: Number(row['deposit_gap_acknowledged'] ?? 0) === 1,
    note: text(row['note']),
  }
}

function text(value: unknown): string | undefined {
  return value == null ? undefined : String(value)
}

function integer(value: unknown): number | undefined {
  return value == null ? undefined : Number(value)
}

function date(value: unknown): LocalDate | undefined {
  return value == null ? undefined : parseISODate(String(value))
}
