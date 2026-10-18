/**
 * Payslips and their lines — `Paycheck` and `PaycheckLine` in
 * docs/04-data-model.md, the ledger pack's `paycheck` and `paycheck_line` since
 * M25 U7 (D-281).
 *
 * The math is `@/domain/paycheck.ts` and knows nothing about SQL; this is where
 * a slip gets identity, timestamps and a place to live. A paycheck is loaded
 * whole — a slip is a dozen lines, and every figure in F04 reads all of them.
 *
 * Two shapes worth knowing before reading further:
 *
 * - **The currency lives on the paycheck**, and lines take theirs from it. A
 *   payslip is denominated in one currency, and a copy on every line is a copy
 *   that can drift from the total it is supposed to add up to.
 * - **Editing a slip replaces its lines wholesale.** Nothing outside the
 *   paycheck addresses a line, so there is no identity to preserve — and the
 *   alternative, diffing twelve rows the user retyped, buys nothing.
 * - **Whether the lines account for the net is the pack's identity** as well
 *   as `reconciliationDelta` (D-281): `net = gross - deducted` is what
 *   `format_rows` says of a stored slip, and the delta is the same sum signed,
 *   for a draft nobody has saved yet.
 *
 * Decoding is defensive, as everywhere else here: a row whose period or date no
 * longer parses is skipped rather than thrown.
 */

import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  parseISODate,
  parseYearMonth,
  toISODate,
  toYearMonthString,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import {
  PAYCHECK_SOURCE_KINDS,
  type Paycheck,
  type PaycheckLine,
  type PaycheckFigures,
  type PaycheckSourceKind,
  type PaycheckWithLines,
} from '@/domain/model/paycheck.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import { inTransaction, query } from '../db/database.ts'
import { declaredFigures, type RowFigures } from '../packs/ledger/figures.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { unbasePlans } from './splitPlanRepository.ts'
import { readJsonSetting, writeSetting } from './settingsRepository.ts'

/** A line as it is entered: amounts, and which type they are against. */
export interface NewPaycheckLine {
  readonly deductionTypeId: string
  readonly employeeAmount: Money
  readonly employerAmount?: Money | undefined
  readonly basisAmount?: Money | undefined
  readonly note?: string | undefined
}

export interface NewPaycheck {
  readonly period: YearMonth
  readonly paymentDate: LocalDate
  readonly employerName?: string | undefined
  readonly gross: Money
  readonly net: Money
  readonly depositedToAccountId?: string | undefined
  readonly note?: string | undefined
  readonly sourceKind?: PaycheckSourceKind | undefined
  readonly attachmentRef?: string | undefined
  readonly isIrregular?: boolean | undefined
  readonly lines?: readonly NewPaycheckLine[] | undefined
}

export interface PaycheckEdit {
  readonly period?: YearMonth | undefined
  readonly paymentDate?: LocalDate | undefined
  readonly employerName?: string | undefined
  readonly gross?: Money | undefined
  readonly net?: Money | undefined
  readonly depositedToAccountId?: string | undefined
  readonly note?: string | undefined
  readonly attachmentRef?: string | undefined
  readonly isIrregular?: boolean | undefined
  /** Given, these become the slip's lines. Omitted, the existing lines are left alone. */
  readonly lines?: readonly NewPaycheckLine[] | undefined
}

// A slip is in one currency (`validatePaycheck` refuses a mix), so the gross's
// is the one every amount on it is decoded in.
const SELECT = `SELECT id, period, payment_date, employer_name, gross_minor, net_minor,
                       gross_currency AS currency, deposited_to AS deposited_to_account_id,
                       note, source_kind, attachment_ref, is_irregular
                  FROM fmt_paycheck
                 WHERE 1 = 1`

const LINE_COLUMNS = `id, paycheck AS paycheck_id, deduction_type AS deduction_type_id,
                      employee_minor, employer_minor, basis_minor, note, sort_order`

/**
 * Every slip, newest salary month first.
 *
 * Headers only. The net trend, the averages and the gap badges all read nets and
 * periods, and loading a dozen lines per slip to draw a sparkline would be a
 * query per row for numbers nothing on that screen shows.
 */
export function listPaychecks(db: Database): readonly Paycheck[] {
  return decodeAll(query(db, `${SELECT} ORDER BY period DESC, employer_name`))
}

/** One slip with its lines, or nothing. */
export function findPaycheck(db: Database, id: string): PaycheckWithLines | undefined {
  const paycheck = decodeAll(query(db, `${SELECT} AND id = ?`, [id]))[0]
  if (paycheck === undefined) return undefined
  const figures = paycheckFigures(db, 't.id = ?', [id])
  return { paycheck, lines: listPaycheckLines(db, id, paycheck.gross.currency), figures: figuresOf(figures, paycheck) }
}

/**
 * **A slip's figures, as the document works them out** (M36 U03): what the
 * lines do not account for and what they saved — the pack's `unexplained` and
 * `saved_employee` — and since M36 U04 what the employer paid, the tax, the
 * compensation and the tax rate; one query for every slip asked about.
 */
function paycheckFigures(
  db: Database,
  where: string,
  params: readonly (string | number)[],
): ReadonlyMap<string, RowFigures> {
  return declaredFigures(
    db,
    'paycheck',
    ['unexplained', 'saved_employee', 'employer_paid', 'tax', 'compensation', 'tax_rate'],
    where,
    params,
  )
}

function figuresOf(figures: ReadonlyMap<string, RowFigures>, paycheck: Paycheck): PaycheckFigures {
  const read = figures.get(paycheck.id)
  const currency = paycheck.gross.currency
  return {
    unexplained: read?.money('unexplained', currency),
    savedEmployee: read?.money('saved_employee', currency),
    employerPaid: read?.money('employer_paid', currency),
    tax: read?.money('tax', currency),
    compensation: read?.money('compensation', currency),
    taxRate: read?.number('tax_rate'),
  }
}

/**
 * Every slip with its lines, in two queries rather than one per slip.
 *
 * What the year-to-date figures and the pension reconciliation of F13 read: both
 * are sums over lines across many months, and neither has a slip in hand to ask
 * about.
 */
export function listPaychecksWithLines(db: Database): readonly PaycheckWithLines[] {
  const paychecks = listPaychecks(db)
  if (paychecks.length === 0) return []

  const currencies = new Map(paychecks.map((paycheck) => [paycheck.id, paycheck.gross.currency]))
  const lines = new Map<string, PaycheckLine[]>()

  for (const row of query(
    db,
    `SELECT ${LINE_COLUMNS} FROM fmt_paycheck_line ORDER BY paycheck, sort_order`,
  )) {
    const paycheckId = String(row['paycheck_id'])
    const currency = currencies.get(paycheckId)
    if (currency === undefined) continue

    const line = decodeLine(row, currency)
    const existing = lines.get(paycheckId)
    if (existing === undefined) lines.set(paycheckId, [line])
    else existing.push(line)
  }

  const figures = paycheckFigures(db, '1 = 1', [])
  return paychecks.map((paycheck) => ({
    paycheck,
    lines: lines.get(paycheck.id) ?? [],
    figures: figuresOf(figures, paycheck),
  }))
}

export function listPaycheckLines(
  db: Database,
  paycheckId: string,
  currency: CurrencyCode,
): readonly PaycheckLine[] {
  return query(
    db,
    `SELECT ${LINE_COLUMNS} FROM fmt_paycheck_line WHERE paycheck = ? ORDER BY sort_order`,
    [paycheckId],
  ).map((row) => decodeLine(row, currency))
}

/**
 * Slips already recorded for a salary month.
 *
 * The schema does not forbid a second one, because docs/f04 allows a 13th salary
 * in the same period as the regular slip (D-048). This is what entry asks so it
 * can say "you already have a June paycheck" and let the user decide, which is
 * the difference between a warning and an argument.
 */
export function findPaychecksForPeriod(
  db: Database,
  period: YearMonth,
  employerName?: string,
): readonly Paycheck[] {
  const rows =
    employerName === undefined
      ? query(db, `${SELECT} AND period = ?`, [toYearMonthString(period)])
      : query(db, `${SELECT} AND period = ? AND employer_name IS ?`, [
          toYearMonthString(period),
          employerName,
        ])
  return decodeAll(rows)
}

/** A slip and its lines, in one transaction: both land or neither does. */
export function createPaycheck(db: Database, input: NewPaycheck, _now: number): PaycheckWithLines {
  let id = ''

  inTransaction(db, () => {
    ;[id = ''] = insertRows(db, declared(db, 'paycheck'), [
      {
        ...paycheckColumns({
          period: input.period,
          paymentDate: input.paymentDate,
          employerName: input.employerName,
          gross: input.gross,
          net: input.net,
          depositedToAccountId: input.depositedToAccountId,
          note: input.note,
          attachmentRef: input.attachmentRef,
          isIrregular: input.isIrregular === true,
        }),
        source_kind: input.sourceKind ?? 'MANUAL',
      },
    ])
    writeLines(db, id, input.gross.currency, input.lines ?? [])
  })

  const created = findPaycheck(db, id)
  if (created === undefined) throw new Error('paycheck did not survive insert')
  return created
}

/**
 * Change a slip in place. Fields left out are left alone.
 *
 * `lines` is the exception and is all-or-nothing: given, it becomes the whole
 * itemization. That is what the entry screen submits — the user has the slip in
 * front of them and the form holds every line at once.
 */
export function updatePaycheck(db: Database, id: string, edit: PaycheckEdit, _now: number): void {
  const existing = findPaycheck(db, id)
  if (existing === undefined) return

  const current = existing.paycheck
  const pick = <K extends keyof PaycheckEdit>(key: K, value: PaycheckEdit[K]): PaycheckEdit[K] =>
    key in edit ? edit[key] : value
  const gross = edit.gross ?? current.gross

  inTransaction(db, () => {
    updateRow(
      db,
      declared(db, 'paycheck'),
      id,
      paycheckColumns({
        period: edit.period ?? current.period,
        paymentDate: edit.paymentDate ?? current.paymentDate,
        employerName: pick('employerName', current.employerName),
        gross,
        net: edit.net ?? current.net,
        depositedToAccountId: pick('depositedToAccountId', current.depositedToAccountId),
        note: pick('note', current.note),
        attachmentRef: pick('attachmentRef', current.attachmentRef),
        isIrregular: edit.isIrregular ?? current.isIrregular,
      }),
    )

    if (edit.lines !== undefined) {
      removeLines(db, id)
      writeLines(db, id, gross.currency, edit.lines)
    }
  })
}

/**
 * Remove a slip and its lines.
 *
 * **Removed, not soft-deleted**, since M25 U7: a declared row is there or it
 * is not (D-266), and the lines go with the slip, children first, because
 * nothing outside it addresses one. A split plan based on this very slip keeps
 * its kind and loses the slip, so the splitter says its basis is unavailable
 * rather than quietly rebasing it on another month.
 */
export function deletePaycheck(db: Database, id: string, _now: number): void {
  inTransaction(db, () => {
    unbasePlans(db, id)
    removeLines(db, id)
    deleteRows(db, declared(db, 'paycheck'), [id], allDeclared(db))
  })
}

interface PaycheckFields {
  readonly period: YearMonth
  readonly paymentDate: LocalDate
  readonly employerName: string | undefined
  readonly gross: Money
  readonly net: Money
  readonly depositedToAccountId: string | undefined
  readonly note: string | undefined
  readonly attachmentRef: string | undefined
  readonly isIrregular: boolean
}

function paycheckColumns(paycheck: PaycheckFields): Record<string, StoredValue> {
  return {
    period: toYearMonthString(paycheck.period),
    payment_date: toISODate(paycheck.paymentDate),
    employer_name: paycheck.employerName ?? null,
    ...moneyCells('gross', paycheck.gross),
    ...moneyCells('net', paycheck.net),
    deposited_to: paycheck.depositedToAccountId ?? null,
    note: paycheck.note ?? null,
    attachment_ref: paycheck.attachmentRef ?? null,
    is_irregular: paycheck.isIrregular ? 1 : 0,
  }
}

function removeLines(db: Database, paycheckId: string): void {
  const ids = query(db, 'SELECT id FROM fmt_paycheck_line WHERE paycheck = ?', [paycheckId]).map(
    (row) => String(row['id']),
  )
  if (ids.length > 0) deleteRows(db, declared(db, 'paycheck_line'), ids, allDeclared(db))
}

/**
 * A slip's lines, in the order typed. Each amount is in the slip's currency
 * whatever the line says — a copy per line is a copy that can drift from the
 * total it is supposed to add up to, and `validatePaycheck` has already
 * refused a line in another.
 */
function writeLines(
  db: Database,
  paycheckId: string,
  currency: CurrencyCode,
  lines: readonly NewPaycheckLine[],
): void {
  if (lines.length === 0) return
  const inSlip = (amount: Money | undefined): Money | undefined =>
    amount === undefined ? undefined : money(amount.minor, currency)
  insertRows(
    db,
    declared(db, 'paycheck_line'),
    lines.map((line, position) => ({
      paycheck: paycheckId,
      deduction_type: line.deductionTypeId,
      ...moneyCells('employee', inSlip(line.employeeAmount)),
      ...moneyCells('employer', inSlip(line.employerAmount)),
      ...moneyCells('basis', inSlip(line.basisAmount)),
      note: line.note ?? null,
      sort_order: position * 10,
    })),
  )
}

/** A money column's two cells, both empty for no amount. */
function moneyCells(column: string, amount: Money | undefined): Record<string, StoredValue> {
  return {
    [`${column}_minor`]: amount === undefined ? null : amount.minor,
    [`${column}_currency`]: amount === undefined ? null : amount.currency,
  }
}

const VALID_SOURCE_KINDS: ReadonlySet<string> = new Set<string>(PAYCHECK_SOURCE_KINDS)

function decodeAll(rows: readonly Record<string, unknown>[]): readonly Paycheck[] {
  const paychecks: Paycheck[] = []
  for (const row of rows) {
    const paycheck = decode(row)
    if (paycheck !== undefined) paychecks.push(paycheck)
  }
  return paychecks
}

function decode(row: Record<string, unknown>): Paycheck | undefined {
  const period = parseYearMonth(String(row['period']))
  const paymentDate = parseISODate(String(row['payment_date']))
  // A slip with no readable salary month is a slip nothing can place on a
  // timeline, and every figure in F04 is indexed by one.
  if (period === undefined || paymentDate === undefined) return undefined

  const sourceKind = String(row['source_kind'])
  const currency = String(row['currency'])

  return {
    id: String(row['id']),
    period,
    paymentDate,
    employerName: row['employer_name'] == null ? undefined : String(row['employer_name']),
    gross: money(Number(row['gross_minor'] ?? 0), currency),
    net: money(Number(row['net_minor'] ?? 0), currency),
    depositedToAccountId:
      row['deposited_to_account_id'] == null ? undefined : String(row['deposited_to_account_id']),
    note: row['note'] == null ? undefined : String(row['note']),
    sourceKind: VALID_SOURCE_KINDS.has(sourceKind) ? (sourceKind as PaycheckSourceKind) : 'MANUAL',
    attachmentRef: row['attachment_ref'] == null ? undefined : String(row['attachment_ref']),
    isIrregular: Number(row['is_irregular'] ?? 0) === 1,
  }
}

function decodeLine(row: Record<string, unknown>, currency: CurrencyCode): PaycheckLine {
  return {
    id: String(row['id']),
    paycheckId: String(row['paycheck_id']),
    deductionTypeId: String(row['deduction_type_id']),
    employeeAmount: money(Number(row['employee_minor'] ?? 0), currency),
    employerAmount:
      row['employer_minor'] == null ? undefined : money(Number(row['employer_minor']), currency),
    basisAmount: row['basis_minor'] == null ? undefined : money(Number(row['basis_minor']), currency),
    note: row['note'] == null ? undefined : String(row['note']),
    sortOrder: Number(row['sort_order'] ?? 0),
  }
}

/** Where "no pay that month" lives: one key, a month-to-true map (M31 U1). */
export const NO_PAY_MONTHS_KEY = 'paychecks.no_pay_months'

/** The months somebody said had no pay, as `YYYY-MM`. */
export function readNoPayMonths(db: Database): ReadonlySet<string> {
  const stored = readJsonSetting(db, NO_PAY_MONTHS_KEY) ?? {}
  return new Set(Object.entries(stored).filter(([, value]) => value === true).map(([month]) => month))
}

/**
 * Says a month had no pay, so no payslip is missing for it — or takes that
 * back. The only way to close "No payslip for September" without a slip, for
 * a month between jobs or on unpaid leave (M31 U1). Stored as an answer, never
 * as a slip: no figure anywhere moves.
 */
export function setNoPayMonths(db: Database, months: readonly YearMonth[], noPay: boolean, now: number): void {
  const stored = { ...(readJsonSetting(db, NO_PAY_MONTHS_KEY) ?? {}) }
  for (const month of months) {
    if (noPay) stored[toYearMonthString(month)] = true
    else delete stored[toYearMonthString(month)]
  }
  writeSetting(db, NO_PAY_MONTHS_KEY, JSON.stringify(stored), now)
}
