/**
 * Debts and the payments they come down by — `Debt` and `DebtPayment` in
 * docs/04-data-model.md, migration 020, docs/f08-debts.md.
 *
 * Owns its SQL and its row decoding, like every repository here. What it does
 * **not** own is any arithmetic: every balance, every projection, the obligation
 * basis and the whole of discovery come from `@/domain/debt.ts`, and this file's
 * job is to hand that domain the rows it needs and write back what it says.
 *
 * Four things are worth knowing before reading further:
 *
 * - **No query here sums a balance.** There is no `SELECT SUM(amount_minor)` in
 *   this file, for the reason there is none in `savingsRepository` (D-074): a
 *   total computed in SQL would be a second answer to the question docs/f08
 *   inverts the whole feature to keep honest, and the two would disagree the
 *   first time either changed. Rows go to the domain; the domain adds them up.
 * - **Discovery is one pass, not four.** `syncDiscoveredPayments` calls
 *   `discoverPayments` once over every open debt, the whole ledger and every
 *   payslip, because ambiguity is a fact about the set — a row claimed by a
 *   merchant pattern on one debt and a category on another is only visible to
 *   something looking at both. Running the mechanisms separately would produce
 *   two confident answers and no way to notice they were about the same money.
 * - **Payroll payments are upserted; discovered ones are appended.** The two are
 *   not the same relationship and the difference is deliberate. A payroll
 *   payment is *derived* from a payslip that is still in the document, so an
 *   edited slip must move the figure rather than leave a second row behind, and
 *   an unlinked type must take its payments with it. A payment discovered from a
 *   transaction was found **once** and then stands on its own: its source row is
 *   immutable, and if the source disappears docs/f08 asks for it to be surfaced
 *   as orphaned rather than deleted.
 * - **A dismissal is remembered, or the next scan asks again.** "This charge is
 *   not a payment on that loan" is an answer, and an answer the app forgets is
 *   an answer it will overrule at the next import. They live in one
 *   `app_setting`, the way `fixedExpenseRepository` remembers a dismissed
 *   merchant — not as rows, because a dismissal is about a payment that was
 *   never created.
 */

import type { Database } from 'sql.js'

import { abs, money, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  monthStart,
  parseISODate,
  toISODate,
  toYearMonthString,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import {
  debtBalance,
  debtsOverview,
  MIXED_CURRENCY_REASON,
  debtWarnings,
  discoverPayments,
  DEFAULT_INSTALLMENT_PROMOTION_THRESHOLD,
  installmentDebtCandidates,
  newPayments,
  orphanedPayments,
  outstandingInstallmentTotal,
  paymentSourceKey,
  projectPayoff,
  sortPayments,
  unresolvedAmbiguities,
  type AmbiguousMatch,
  type DebtBalance,
  type DebtsOverview,
  type DebtWarning,
  type DebtWithPayments,
  type DiscoveredPayment,
  type InstallmentDebtCandidate,
  type PayoffProjection,
  type PaymentProvenance,
} from '@/domain/debt.ts'
import {
  AUTO_TRACK_KINDS,
  DEBT_KINDS,
  PAYMENT_SOURCE_KINDS,
  type AutoTracking,
  type AutoTrackKind,
  type Debt,
  type DebtKind,
  type DebtPayment,
  type PaymentObservation,
  type PaymentSourceKind,
} from '@/domain/model/debt.ts'
import { inTransaction, query } from '../db/database.ts'
import { declaredFigures, workedOutSql } from '../packs/ledger/figures.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { listDeductionTypes, unlinkDeductionTypes } from './deductionTypeRepository.ts'
import { listFixedExpenses } from './fixedExpenseRepository.ts'
import { unaimBuckets } from './splitPlanRepository.ts'
import { listPaychecksWithLines } from './paycheckRepository.ts'
import { readSetting, writeSetting } from './settingsRepository.ts'

// --- Debts ------------------------------------------------------------------

export interface NewDebt {
  readonly name: string
  readonly kind: DebtKind
  readonly principalAmount: Money
  readonly openedDate: LocalDate
  readonly expectedEndDate?: LocalDate | undefined
  /** Must be in the principal's currency; migration 020 stores one for both. */
  readonly monthlyPaymentAmount?: Money | undefined
  readonly linkedAccountId?: string | undefined
  readonly tracking?: AutoTracking | undefined
  readonly note?: string | undefined
}

export type DebtEdit = Partial<NewDebt>

const DEBT_SELECT = `SELECT id, name, kind, principal_currency AS currency, principal_minor,
                            opened AS opened_date, expected_end AS expected_end_date,
                            monthly_payment_minor, linked_account AS linked_account_id,
                            auto_track_kind, auto_track_pattern, auto_track_category,
                            is_closed, note
                       FROM fmt_debt
                      WHERE 1 = 1`

/** Open first, then by name — the debts screen's two sections in one order. */
export function listDebts(
  db: Database,
  options?: { readonly includeClosed?: boolean },
): readonly Debt[] {
  const where = options?.includeClosed === true ? '' : ' AND is_closed = 0'
  return decodeDebts(query(db, `${DEBT_SELECT}${where} ORDER BY is_closed, name`))
}

export function findDebt(db: Database, id: string): Debt | undefined {
  return decodeDebts(query(db, `${DEBT_SELECT} AND id = ?`, [id]))[0]
}

/**
 * Every debt with its payments attached — the shape the domain reads.
 *
 * Two queries rather than a join and a regroup: the payments are needed whole
 * anyway, and a debt with none has to come back with an empty list rather than
 * fall out of the result, which is what an inner join would do to a debt nobody
 * has paid yet.
 */
export function listDebtsWithPayments(
  db: Database,
  options?: { readonly includeClosed?: boolean },
): readonly DebtWithPayments[] {
  const debts = listDebts(db, options)
  if (debts.length === 0) return []

  const byDebt = new Map<string, DebtPayment[]>()
  for (const payment of listPayments(db)) {
    const list = byDebt.get(payment.debtId)
    if (list === undefined) byDebt.set(payment.debtId, [payment])
    else list.push(payment)
  }

  return debts.map((debt) => ({ debt, payments: byDebt.get(debt.id) ?? [] }))
}

export function createDebt(db: Database, input: NewDebt, _now: number): Debt {
  const [id = ''] = insertRows(db, declared(db, 'debt'), [
    {
      ...debtColumns(input),
      is_closed: 0,
    },
  ])

  const created = findDebt(db, id)
  if (created === undefined) throw new Error('debt did not survive insert')
  // A debt made after its payments were imported finds them now, not at the next import (M28 F10).
  if (created.tracking.kind !== 'NONE') syncDiscoveredPayments(db, _now)
  return created
}

/**
 * Change a debt. Fields left out are left alone; fields named and set to
 * `undefined` are cleared — the edit's own key presence decides, so clearing an
 * expected end date is expressible.
 *
 * **The tracking pair moves together or not at all.** `trackingColumns` writes
 * both columns from the one union, so there is no edit that can leave
 * `CATEGORY` beside a merchant pattern the user typed under the previous kind —
 * the state migration 020's CHECK refuses, refused one layer earlier and with a
 * reason rather than an exception.
 */
export function updateDebt(db: Database, id: string, edit: DebtEdit, _now: number): void {
  const existing = findDebt(db, id)
  if (existing === undefined) return

  const principal = edit.principalAmount ?? existing.principalAmount
  const monthly =
    'monthlyPaymentAmount' in edit ? edit.monthlyPaymentAmount : existing.monthlyPaymentAmount
  const endDate = 'expectedEndDate' in edit ? edit.expectedEndDate : existing.expectedEndDate
  const account = 'linkedAccountId' in edit ? edit.linkedAccountId : existing.linkedAccountId
  const note = 'note' in edit ? edit.note : existing.note

  updateRow(
    db,
    declared(db, 'debt'),
    id,
    debtColumns({
      name: edit.name ?? existing.name,
      kind: edit.kind ?? existing.kind,
      principalAmount: principal,
      openedDate: edit.openedDate ?? existing.openedDate,
      expectedEndDate: endDate,
      monthlyPaymentAmount: monthly,
      linkedAccountId: account,
      tracking: edit.tracking ?? existing.tracking,
      note,
    }),
  )
  // A new way of finding payments looks through what is already imported (M28 F10).
  if (edit.tracking !== undefined && edit.tracking.kind !== 'NONE') syncDiscoveredPayments(db, _now)
}

/**
 * Close a debt, or reopen it.
 *
 * Closing keeps every payment: docs/f08 moves closed debts to a collapsed
 * section with their history intact, and a closed debt is skipped by discovery
 * rather than emptied — so reopening one finds the payments still there and the
 * next scan picks up whatever was charged meanwhile.
 */
export function setDebtClosed(db: Database, id: string, isClosed: boolean, _now: number): void {
  updateRow(db, declared(db, 'debt'), id, { is_closed: isClosed ? 1 : 0 })
}

export class DebtHasPaymentsError extends Error {
  constructor(
    readonly debtName: string,
    readonly paymentCount: number,
  ) {
    super(
      `${debtName} has ${paymentCount} payment${paymentCount === 1 ? '' : 's'} recorded against it. Close it to keep the history, or remove the payments first.`,
    )
    this.name = 'DebtHasPaymentsError'
  }
}

/**
 * Remove a debt, refusing while it has payments — `deleteGoal`'s shape, whose
 * two alternatives the message names.
 *
 * **F08's third acceptance criterion lives here**: deleting a debt does not
 * delete the underlying transactions or paycheck lines, and it cannot, because
 * nothing in this function touches either table. What it does touch is
 * `deduction_type.linked_debt_id`, for the reason `deleteGoal` and `deleteFund`
 * clear their own links (D-067): a link to a debt that is gone would go on
 * discovering payroll payments for something nobody can see.
 */
export function deleteDebt(db: Database, id: string, _now: number): void {
  const debt = findDebt(db, id)
  if (debt === undefined) return

  const rows = query(db, 'SELECT COUNT(*) AS n FROM fmt_debt_payment WHERE debt = ?', [id])
  const paymentCount = Number(rows[0]?.['n'] ?? 0)
  if (paymentCount > 0) throw new DebtHasPaymentsError(debt.name, paymentCount)

  inTransaction(db, () => {
    unlinkDeductionTypes(db, 'linked_debt', id)
    unaimBuckets(db, 'target_debt', id)
    deleteRows(db, declared(db, 'debt'), [id], allDeclared(db))
  })
}

/** The debts a deduction type could be pointed at, for the **Pays into** select. */
export function deductionTypesForDebt(db: Database, debtId: string) {
  return listDeductionTypes(db).filter((type) => type.linkedDebtId === debtId)
}

// --- Payments ---------------------------------------------------------------

export interface NewPayment {
  readonly debtId: string
  readonly date: LocalDate
  /** A magnitude. The column refuses a direction and so does this. */
  readonly amount: Money
  readonly interestPortion?: Money | undefined
  readonly sourceKind?: PaymentSourceKind | undefined
  readonly sourceRefId?: string | undefined
  readonly isConfirmed?: boolean | undefined
  readonly note?: string | undefined
}

export type PaymentEdit = Partial<Omit<NewPayment, 'debtId'>> & { readonly debtId?: string }

/**
 * A payment found in a transaction names it with a link; one from a payslip or
 * a plan names what it came from with a key, since neither is one row (D-279).
 * The domain reads either as its `sourceRefId`.
 */
/**
 * The stored payment and the part of it that came off what is owed, which the
 * pack declares (`principal_part`, M36 U03) and the document works out.
 */
function paymentSelect(db: Database): string {
  return `SELECT p.id AS id, debt AS debt_id, date, amount_currency AS currency, amount_minor,
                 interest_minor, source_kind,
                 COALESCE("transaction", source_key) AS source_ref_id,
                 is_confirmed, note, w.principal_part_minor, w.principal_part_currency
            FROM fmt_debt_payment AS p
            LEFT JOIN (${workedOutSql(db, 'debt_payment')}) AS w ON w.id = p.id
           WHERE 1 = 1`
}

export function listPayments(db: Database, debtId?: string): readonly DebtPayment[] {
  const rows =
    debtId === undefined
      ? query(db, `${paymentSelect(db)} ORDER BY date, id`)
      : query(db, `${paymentSelect(db)} AND debt = ? ORDER BY date, id`, [debtId])
  return decodePayments(rows)
}

export function findPayment(db: Database, id: string): DebtPayment | undefined {
  return decodePayments(query(db, `${paymentSelect(db)} AND p.id = ?`, [id]))[0]
}

/**
 * Record a payment.
 *
 * Confirmed by default, because the path into this function is a person typing
 * a figure. Discovery goes through `insertPayment` with `isConfirmed: false` —
 * the review queue exists for answers the app produced, not for the user's own.
 */
export function addPayment(db: Database, input: NewPayment, _now: number): DebtPayment {
  const [id = ''] = insertPayments(db, [input])

  const created = findPayment(db, id)
  if (created === undefined) throw new Error('payment did not survive insert')
  return created
}

export function updatePayment(db: Database, id: string, edit: PaymentEdit, _now: number): void {
  const existing = findPayment(db, id)
  if (existing === undefined) return

  const amount = edit.amount ?? existing.amount
  const interest = edit.interestPortion ?? existing.interestPortion
  const note = 'note' in edit ? edit.note : existing.note

  updateRow(db, declared(db, 'debt_payment'), id, {
    debt: edit.debtId ?? existing.debtId,
    date: toISODate(edit.date ?? existing.date),
    amount_minor: amount.minor,
    amount_currency: amount.currency,
    // The interest is stored in the payment's currency, so a portion handed in
    // in another one is taken as the magnitude it states rather than converted
    // (D-003). `validatePayment` is what stops that reaching the database.
    interest_minor: interest.minor,
    interest_currency: amount.currency,
    is_confirmed: (edit.isConfirmed ?? existing.isConfirmed) ? 1 : 0,
    note: note ?? null,
  })
}

/** Agree with what the app found. The balance does not move — it already counted. */
export function confirmPayment(db: Database, id: string, _now: number): void {
  updateRow(db, declared(db, 'debt_payment'), id, { is_confirmed: 1 })
}

export function deletePayment(db: Database, id: string, _now: number): void {
  deletePayments(db, [id])
}

function deletePayments(db: Database, ids: readonly string[]): void {
  if (ids.length === 0) return
  deleteRows(db, declared(db, 'debt_payment'), ids, allDeclared(db))
}

// --- The ledger as discovery reads it ---------------------------------------

/**
 * Every row that could be a repayment, in the shape the domain takes.
 *
 * Outflows only and the installment fields carried along, on the same date basis
 * as everything else — charge date falling back to transaction date (D-006) — so
 * a payment's month and a month's spending total cannot disagree about which
 * month a row was in. `listExpenseObservations` reads the ledger the same way
 * for the detector, and the two deliberately look alike.
 *
 * **Rows excluded from statistics are still read.** That is the opposite of what
 * the detector does, and the difference is the point: a row excluded from stats
 * is usually a card settlement, which is the same money as the charges beneath
 * it — but a *loan repayment* the user excluded is still a repayment, and the
 * exclusion says nothing about whether the debt came down. What keeps the two
 * from double-counting is `debtObligationBasis`, not a filter here.
 */
export function listPaymentObservations(
  db: Database,
  options?: { readonly installmentSlicesOnly?: boolean },
): readonly PaymentObservation[] {
  const rows = query(
    db,
    `SELECT id, COALESCE(charge_date, transaction_date) AS basis_date,
            merchant_normalized, merchant_raw, amount_minor, amount_currency AS currency,
            category AS category_id, installment_sequence, installment_total, installment_group_key,
            original_total_minor
       FROM fmt_transaction
      WHERE amount_minor < 0
        ${options?.installmentSlicesOnly === true ? 'AND installment_group_key IS NOT NULL' : ''}
      ORDER BY basis_date, id`,
  )

  const observations: PaymentObservation[] = []
  for (const row of rows) {
    const date = parseISODate(String(row['basis_date']))
    if (date === undefined) continue

    const currency = String(row['currency'])
    const groupKey = row['installment_group_key']
    const sequence = row['installment_sequence']
    const total = row['installment_total']
    const originalTotal = row['original_total_minor']

    observations.push({
      id: String(row['id']),
      merchantNormalized: String(row['merchant_normalized'] ?? ''),
      merchantRaw: String(row['merchant_raw'] ?? ''),
      date,
      amount: money(Number(row['amount_minor'] ?? 0), currency),
      categoryId: row['category_id'] == null ? undefined : String(row['category_id']),
      installment:
        groupKey == null || sequence == null || total == null
          ? undefined
          : {
              sequence: Number(sequence),
              total: Number(total),
              groupKey: String(groupKey),
              // The currency is the transaction's own — migration 007 stores the
              // minor units alone, because a total in another currency would be
              // a conversion this document has no rate for.
              originalTotal:
                originalTotal == null ? undefined : money(Number(originalTotal), currency),
            },
    })
  }
  return observations
}

// --- Discovery --------------------------------------------------------------

export interface DiscoverySyncResult {
  /** Unconfirmed payments written. What the review queue's badge counts. */
  readonly created: number
  /** Payroll payments an edited payslip moved rather than duplicated. */
  readonly updated: number
  /** Payroll payments whose line no longer feeds a debt. */
  readonly removed: number
  /** Rows more than one debt claims, still unanswered. */
  readonly ambiguous: number
  /** Discovered payments the user has already said no to. */
  readonly dismissed: number
}

/**
 * Run all four mechanisms and write what they found.
 *
 * Called after every import commit and after every paycheck save, and safe to
 * call at any other time: **re-running it changes nothing**, which is F08's
 * first acceptance criterion and the reason it is affordable to run
 * unconditionally. Idempotency is `newPayments` plus the unique index migration
 * 020 defines, both reading `paymentSourceKey` — one definition of "the same
 * payment", so the code and the constraint cannot come to disagree.
 *
 * Payroll is the one mechanism that also *updates and removes*, and the comment
 * at the head of this file says why: the payslip is still in the document and is
 * still the truth about that payment, where a transaction was read once and the
 * reading stands. A slip's saving deposits made the same split for the same
 * reason (D-077), until M36 U05 worked them out on read instead (D-381).
 */
export function syncDiscoveredPayments(db: Database, _now: number): DiscoverySyncResult {
  const debts = listDebts(db, { includeClosed: true })
  if (debts.length === 0) return EMPTY_SYNC

  const existing = listPayments(db)
  const dismissals = readDismissals(db)
  const discovery = discoverPayments({
    debts,
    transactions: listPaymentObservations(db),
    paychecks: listPaychecksWithLines(db),
    deductionTypes: listDeductionTypes(db),
    dismissedKeys: dismissals,
  })

  const payroll = syncPayrollPayments(db, discovery.payments, existing)

  let created = 0
  for (const payment of newPayments(discovery.payments, existing)) {
    if (payment.sourceKind === 'PAYCHECK') continue

    insertPayments(db, [
      {
        debtId: payment.debtId,
        date: payment.date,
        amount: payment.amount,
        sourceKind: payment.sourceKind,
        sourceRefId: payment.sourceRefId,
        isConfirmed: false,
        note: provenanceNote(payment.provenance),
      },
    ])
    created += 1
  }

  const ambiguous = unresolvedAmbiguities(discovery.ambiguous, existing).filter(
    (match) => !dismissals.has(ambiguityKey(match.sourceRefId)),
  )

  return {
    created: created + payroll.created,
    updated: payroll.updated,
    removed: payroll.removed,
    ambiguous: ambiguous.length,
    dismissed: discovery.dismissed,
  }
}

const EMPTY_SYNC: DiscoverySyncResult = {
  created: 0,
  updated: 0,
  removed: 0,
  ambiguous: 0,
  dismissed: 0,
}

/**
 * Bring the payroll-discovered payments in line with what the payslips say.
 *
 * An upsert per `paycheckId:debtId`, never an append — editing a slip moves the
 * figure instead of leaving a second row behind, and a type that no longer names
 * a debt takes its payments with it. That is the gap `syncSettlementLinks` had
 * until D-069, arriving in the one other place a link can be taken back.
 *
 * A payment already answered keeps its answer: confirming one and then editing
 * the slip corrects the amount without asking the user to agree twice. What it
 * cannot keep is an interest portion larger than the new amount — that would
 * make principal negative and push the balance *up* — so it is clamped, which is
 * the only figure in this file the app changes on the user's behalf.
 */
function syncPayrollPayments(
  db: Database,
  discovered: readonly DiscoveredPayment[],
  existing: readonly DebtPayment[],
): { created: number; updated: number; removed: number } {
  const fromPayroll = discovered.filter((payment) => payment.sourceKind === 'PAYCHECK')
  const stored = new Map(
    existing
      .filter((payment) => payment.sourceKind === 'PAYCHECK' && payment.sourceRefId !== undefined)
      .map((payment) => [payment.sourceRefId ?? payment.id, payment]),
  )

  let created = 0
  let updated = 0

  for (const payment of fromPayroll) {
    const current = stored.get(payment.sourceRefId)
    if (current === undefined) {
      insertPayments(db, [
        {
          debtId: payment.debtId,
          date: payment.date,
          amount: payment.amount,
          sourceKind: 'PAYCHECK',
          sourceRefId: payment.sourceRefId,
          isConfirmed: false,
          note: provenanceNote(payment.provenance),
        },
      ])
      created += 1
      continue
    }

    stored.delete(payment.sourceRefId)
    const unchanged =
      current.amount.minor === payment.amount.minor &&
      current.amount.currency === payment.amount.currency &&
      toISODate(current.date) === toISODate(payment.date)
    if (unchanged) continue

    const interest =
      current.interestPortion.currency === payment.amount.currency
        ? Math.min(current.interestPortion.minor, payment.amount.minor)
        : 0

    updateRow(db, declared(db, 'debt_payment'), current.id, {
      date: toISODate(payment.date),
      amount_minor: payment.amount.minor,
      amount_currency: payment.amount.currency,
      interest_minor: interest,
      interest_currency: payment.amount.currency,
    })
    updated += 1
  }

  // Whatever is left named a slip that no longer feeds this debt.
  deletePayments(db, [...stored.values()].map((stale) => stale.id))

  return { created, updated, removed: stored.size }
}

// --- Payments a plan proposes -----------------------------------------------

/**
 * The ref a plan's payment is unique per: one per plan, per month, per bucket.
 *
 * The bucket rather than the debt, for `planDepositRef`'s reason and word for
 * word: two buckets in one plan may point at the same debt on purpose — "the
 * mortgage" and "the mortgage, extra out of the bonus" — and keying on the debt
 * would make the second overwrite the first.
 */
export function planPaymentRef(planId: string, period: YearMonth, bucketId: string): string {
  return `${planId}:${toYearMonthString(period)}:${bucketId}`
}

/**
 * Record — or correct — the payment a split plan proposes for one bucket.
 *
 * Upserted on the ref above, so applying a plan twice moves a figure rather than
 * adding a second payment. That is the mechanism `applyPlanDeposit` uses on the
 * savings side, the one `syncPayrollPayments` uses on this one, and the one
 * migration 020's unique index enforces — which admits `FROM_PLAN` without
 * changing, because it excludes `MANUAL` and nothing else.
 *
 * **Confirmed, and that is the deliberate half.** Everything else that writes a
 * payment the user did not type starts unconfirmed, because the app inferred it
 * from a row and might have read the row wrong. This is not an inference: the
 * user pressed a button on a figure the panel printed, which is the same act as
 * typing it, and `addPayment` confirms that act for the same reason. A review
 * queue that filled up with the user's own decisions would be asking them to
 * agree twice.
 *
 * **All principal, and there is nothing to ask.** A plan says what leaves the
 * account, not how the lender splits it; `interest_minor` stays zero, which is
 * docs/04's all-principal default, and the payment editor is where a person
 * corrects it if they know better.
 *
 * **Dated the first of the month it plans**, not today — `applyPlanDeposit`'s
 * rule, and it matters more here: a September plan applied on the 28th of August
 * and dated today would land in August's payment total, where "How it went"
 * would compare it against the wrong month on both sides.
 */
export function applyPlanPayment(
  db: Database,
  input: {
    readonly planId: string
    readonly period: YearMonth
    readonly bucketId: string
    readonly debtId: string
    readonly amount: Money
  },
  _now: number,
): void {
  const ref = planPaymentRef(input.planId, input.period, input.bucketId)
  const existing = decodePayments(
    query(db, `${paymentSelect(db)} AND debt = ? AND source_kind = 'FROM_PLAN' AND source_key = ?`, [
      input.debtId,
      ref,
    ]),
  )[0]

  const amount = abs(input.amount)

  if (existing !== undefined) {
    // The clamp `syncPayrollPayments` makes, for its reason: an interest portion
    // larger than the payment would make principal negative and push the balance
    // up. Zero unless a person has since typed one in.
    const interest =
      existing.interestPortion.currency === amount.currency
        ? Math.min(existing.interestPortion.minor, amount.minor)
        : 0
    updateRow(db, declared(db, 'debt_payment'), existing.id, {
      date: toISODate(monthStart(input.period)),
      amount_minor: amount.minor,
      amount_currency: amount.currency,
      interest_minor: interest,
      interest_currency: amount.currency,
    })
    return
  }

  insertPayments(db, [
    {
      debtId: input.debtId,
      date: monthStart(input.period),
      amount,
      sourceKind: 'FROM_PLAN',
      sourceRefId: ref,
      isConfirmed: true,
      note: `Planned for ${toYearMonthString(input.period)}`,
    },
  ])
}

/**
 * What a plan has already paid towards each debt for one month, keyed by **debt
 * id** — the shape `applyPlan` diffs against.
 *
 * Keyed by debt because that is what a suggestion names; two buckets pointing at
 * one debt read as one figure here, which is the right answer to "how much of
 * this month's plan has already landed on this debt". `planDeposits` is the same
 * function on the savings side and the symmetry is the point: one screen calls
 * both and merges them into one map.
 */
export function planPayments(
  db: Database,
  planId: string,
  period: YearMonth,
  currency: CurrencyCode,
): ReadonlyMap<string, Money> {
  const prefix = `${planId}:${toYearMonthString(period)}:`
  const rows = decodePayments(
    query(db, `${paymentSelect(db)} AND source_kind = 'FROM_PLAN' AND source_key LIKE ?`, [
      `${prefix}%`,
    ]),
  )

  const byDebt = new Map<string, Money>()
  for (const row of rows) {
    if (row.amount.currency !== currency) continue
    const running = byDebt.get(row.debtId)
    byDebt.set(row.debtId, money((running?.minor ?? 0) + row.amount.minor, currency))
  }
  return byDebt
}

// --- The review queue -------------------------------------------------------

/** One discovered payment awaiting an answer, with what it can say for itself. */
export interface ReviewItem {
  readonly payment: DebtPayment
  readonly debt: Debt
  /**
   * Regenerated by the scan rather than stored. F08's second acceptance
   * criterion is that every payment can name where it came from, and the
   * provenance carries the merchant, the payslip period or the "3 of 12" — facts
   * that a screen looking them up later might find recategorized, edited, or
   * gone. Undefined when the row no longer produces this payment, which is what
   * `orphaned` says in the same breath.
   */
  readonly provenance: PaymentProvenance | undefined
  /** The source row is no longer in the document. Surfaced, never auto-deleted. */
  readonly orphaned: boolean
}

/** A row two debts claim, and the debts to choose between. */
export interface ReviewAmbiguity extends AmbiguousMatch {
  readonly debts: readonly Debt[]
}

export interface PaymentReview {
  readonly items: readonly ReviewItem[]
  readonly ambiguities: readonly ReviewAmbiguity[]
  /** Confirmed payments whose source row has since left the document. */
  readonly orphaned: readonly ReviewItem[]
}

/**
 * What is waiting to be answered.
 *
 * The whole queue is **derived**, recomputed from the ledger and the payslips
 * every time it is read — the shape `fundDepositChecks` and the settlement queue
 * both take. Nothing about a question is stored, because the answer is what gets
 * stored, and a stored question would need keeping in step with a document that
 * has moved on.
 */
export function paymentReview(db: Database): PaymentReview {
  const debts = listDebts(db, { includeClosed: true })
  if (debts.length === 0) return { items: [], ambiguities: [], orphaned: [] }

  const byId = new Map(debts.map((debt) => [debt.id, debt]))
  const payments = listPayments(db)
  const observations = listPaymentObservations(db)
  const paychecks = listPaychecksWithLines(db)

  const dismissals = readDismissals(db)
  const discovery = discoverPayments({
    debts,
    transactions: observations,
    paychecks,
    deductionTypes: listDeductionTypes(db),
    dismissedKeys: dismissals,
  })

  const provenanceByKey = new Map(
    discovery.payments.map((payment) => [
      `${payment.debtId}:${payment.sourceKind}:${payment.sourceRefId}`,
      payment.provenance,
    ]),
  )

  // A source row is live if the document still holds it. The test is the *row*,
  // not whether it would still be discovered: narrowing a merchant pattern is a
  // change of mind about future rows, not a claim that the payment never
  // happened (`orphanedPayments`).
  const liveRefs = new Set<string>(observations.map((observation) => observation.id))
  for (const paycheck of paychecks) {
    for (const debt of debts) liveRefs.add(`${paycheck.paycheck.id}:${debt.id}`)
  }
  const orphans = new Set(orphanedPayments(payments, liveRefs).map((payment) => payment.id))

  const items: ReviewItem[] = []
  const orphaned: ReviewItem[] = []
  for (const payment of sortPayments(payments)) {
    const debt = byId.get(payment.debtId)
    if (debt === undefined) continue

    const item: ReviewItem = {
      payment,
      debt,
      provenance: provenanceByKey.get(
        `${payment.debtId}:${payment.sourceKind}:${payment.sourceRefId}`,
      ),
      orphaned: orphans.has(payment.id),
    }

    if (!payment.isConfirmed) items.push(item)
    else if (item.orphaned) orphaned.push(item)
  }

  const ambiguities = unresolvedAmbiguities(discovery.ambiguous, payments)
    .filter((match) => !dismissals.has(ambiguityKey(match.sourceRefId)))
    .map((match) => ({
      ...match,
      debts: match.debtIds
        .map((id) => byId.get(id))
        .filter((debt): debt is Debt => debt !== undefined),
    }))

  return { items, ambiguities, orphaned }
}

/**
 * Answer an ambiguity by naming the debt that was paid.
 *
 * One payment, confirmed, because the user has just said so — the alternative
 * claimants were never owed one. `unresolvedAmbiguities` stops the question
 * being asked again, and it stops on the payment's existence rather than on a
 * second record of the answer.
 */
export function resolveAmbiguity(
  db: Database,
  match: AmbiguousMatch,
  debtId: string,
  now: number,
): DebtPayment | undefined {
  if (!match.debtIds.includes(debtId)) return undefined

  // Payroll matches are exempt from ambiguity by construction — they are keyed
  // per slip per debt and summed before they are emitted — so that branch exists
  // to make the switch total, not because it can be reached.
  const date =
    match.provenance.kind === 'PAYCHECK'
      ? monthStart(match.provenance.period)
      : match.provenance.date

  return addPayment(
    db,
    {
      debtId,
      date,
      amount: match.amount,
      sourceKind: match.provenance.kind,
      sourceRefId: match.sourceRefId,
      isConfirmed: true,
      note: provenanceNote(match.provenance),
    },
    now,
  )
}

/**
 * "This is not a payment on that debt."
 *
 * The discovered payment is removed and the answer is remembered, or the next
 * import would create it again — which is the difference between a queue and a
 * nag. Remembered against `paymentSourceKey`, so it is specific to this row and
 * this debt: the same charge can still be found for another debt, and the same
 * debt can still be found in another row.
 *
 * docs/f08 asks for the dismissal to offer to tighten the pattern too. That is
 * the screen's sentence; what it needs from here is `findDebt` and
 * `updateDebt`, which it already has.
 */
export function dismissPayment(db: Database, paymentId: string, now: number): void {
  const payment = findPayment(db, paymentId)
  if (payment === undefined) return

  deletePayment(db, paymentId, now)

  const key = paymentSourceKey(payment.debtId, payment.sourceKind, payment.sourceRefId)
  if (key === undefined) return
  rememberDismissal(db, key, now)
}

/** Dismiss a question rather than an answer: no debt was paid by this row. */
export function dismissAmbiguity(db: Database, sourceRefId: string, now: number): void {
  rememberDismissal(db, ambiguityKey(sourceRefId), now)
}

const DISMISSAL_KEY = 'debt.dismissedPayments'

function rememberDismissal(db: Database, key: string, now: number): void {
  const dismissals = Object.fromEntries(readDismissalEntries(db))
  dismissals[key] = now
  writeSetting(db, DISMISSAL_KEY, JSON.stringify({ keys: dismissals }), now)
}

function readDismissals(db: Database): ReadonlySet<string> {
  return new Set(readDismissalEntries(db).map(([key]) => key))
}

function readDismissalEntries(db: Database): readonly [string, number][] {
  const raw = readSetting(db, DISMISSAL_KEY)
  if (raw === undefined) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    const keys = (parsed as { keys?: Record<string, unknown> } | null)?.keys
    if (keys === undefined || keys === null) return []
    return Object.entries(keys).map(([key, at]) => [key, Number(at)])
  } catch {
    // A setting this app wrote and something else corrupted is not worth taking
    // the screen down for: no dismissals is the safe reading, since it asks a
    // question again rather than hiding one.
    return []
  }
}

/** An ambiguity is dismissed per row, not per debt: none of them was paid. */
function ambiguityKey(sourceRefId: string): string {
  return `AMBIGUOUS:${sourceRefId}`
}

// --- Reading across everything ----------------------------------------------

/** The totals and worked-out columns the pack declares on `debt` (M36 U03). */
const DEBT_FIGURES = [
  'principal_paid',
  'total_paid',
  'interest_paid',
  'outstanding',
  'unconfirmed',
  'unconfirmed_count',
  'progress',
] as const

/**
 * **What each debt has come down to, as the document works it out** (M36 U03)
 * — its declared totals and worked-out columns in one query, never the payments
 * re-added here. A payment in another currency makes a debt's balance
 * `UNCHECKED` rather than a smaller figure (D-349).
 */
export function debtBalances(db: Database, debts: readonly Debt[]): ReadonlyMap<string, DebtBalance> {
  const out = new Map<string, DebtBalance>()
  if (debts.length === 0) return out
  const figures = declaredFigures(db, 'debt', DEBT_FIGURES)
  for (const debt of debts) {
    const read = figures.get(debt.id)
    const currency = debt.principalAmount.currency
    const sum = (name: string): Money | undefined => read?.money(name, currency)
    out.set(
      debt.id,
      debtBalance(debt, {
        principalPaid: sum('principal_paid'),
        totalPaid: sum('total_paid'),
        interestPaid: sum('interest_paid'),
        outstanding: sum('outstanding'),
        unconfirmed: sum('unconfirmed'),
        unconfirmedCount: read?.number('unconfirmed_count'),
        progress: read?.number('progress'),
      }),
    )
  }
  return out
}

/** One debt's balance out of `debtBalances`; a debt it was not asked about is unchecked. */
function balanceIn(balances: ReadonlyMap<string, DebtBalance>, debt: Debt): DebtBalance {
  return (
    balances.get(debt.id) ?? { kind: 'UNCHECKED', principal: debt.principalAmount, reason: MIXED_CURRENCY_REASON, unconfirmedCount: 0 }
  )
}

/** One debt with every figure its row prints, computed once. */
export interface DebtRow extends DebtWithPayments {
  readonly balance: DebtBalance
  readonly projection: PayoffProjection
}

export interface DebtsSummary extends DebtsOverview {
  readonly rows: readonly DebtRow[]
  /**
   * What is still to be charged on card installments across every group,
   * promoted to a debt or not — docs/f08 shows it on this screen "because that
   * money is committed regardless". **Future slices only**: the ones already
   * charged are in the spending totals, and counting them here would report the
   * same money as both spent and owed.
   */
  readonly installmentCommitment: Money
}

/**
 * The debts screen's figures, from one read of the document.
 *
 * Every figure a row prints is computed here rather than by the row, so the
 * ring, the outstanding figure and the projection on one card cannot disagree
 * with each other or with the totals above them — `fundAnalysis`' rule (D-071)
 * applied to a list instead of a detail.
 *
 * The currency defaults to what the debts are actually denominated in rather
 * than to a constant, so a document whose only debt is in dollars gets a total
 * instead of an empty one with every row listed as "other currency".
 *
 * `from` is the month projections count forward from, passed in rather than read
 * off a clock (D-062).
 */
export function debtsSummary(
  db: Database,
  from: YearMonth,
  options?: { readonly currency?: CurrencyCode },
): DebtsSummary {
  const debts = listDebtsWithPayments(db, { includeClosed: true })
  const currency = options?.currency ?? debts[0]?.debt.principalAmount.currency ?? 'ILS'
  const balances = debtBalances(db, debts.map((entry) => entry.debt))

  return {
    ...debtsOverview(debts, balances, currency),
    rows: debts.map((entry) => {
      const balance = balanceIn(balances, entry.debt)
      return { ...entry, balance, projection: projectPayoff(entry.debt, entry.payments, balance, from) }
    }),
    installmentCommitment: installmentCommitment(db, currency),
  }
}

/**
 * What the card installments already charged still commit the user to.
 *
 * Read off the ledger every time rather than stored, the way every candidate in
 * this app is: the slices are the record, and a stored figure would be a second
 * answer that goes stale the moment a statement lands.
 */
export function installmentCommitment(db: Database, currency: CurrencyCode): Money {
  // Slices only, which is the whole reason `listPaymentObservations` takes an
  // option at all. `outstandingInstallmentTotal` groups by `installment` and
  // skips every row without one, so the wider read was building an object per
  // outflow in the document to throw almost all of them away — 613ms of the
  // home dashboard's second at 60k rows, on a document with no debts in it
  // (`data/scale.test.ts`). This is the shape 02-architecture's "aggregations
  // rather than loading rows into JS" rule is about.
  return outstandingInstallmentTotal(
    listPaymentObservations(db, { installmentSlicesOnly: true }),
    currency,
  )
}

// --- Promoting a split purchase ---------------------------------------------

/**
 * What the app is willing to offer, and what it has been told not to.
 *
 * One `app_setting`, the way dismissals are: none of this is about a row that
 * exists. A threshold and a switch are the two controls docs/f08 asks for —
 * "the user can decline, and can set the threshold or disable the prompt" — and
 * the declines sit beside them because they are the same kind of fact.
 */
export interface InstallmentPromotionSettings {
  /** Purchases split into **more** than this many payments are offered. */
  readonly threshold: number
  /** Off means the offer is not made at all. Nothing already promoted changes. */
  readonly isOffered: boolean
  readonly declinedGroupKeys: ReadonlySet<string>
}

const PROMOTION_KEY = 'debt.installmentPromotion'

export function readInstallmentPromotion(db: Database): InstallmentPromotionSettings {
  const raw = readSetting(db, PROMOTION_KEY)
  const fallback: InstallmentPromotionSettings = {
    threshold: DEFAULT_INSTALLMENT_PROMOTION_THRESHOLD,
    isOffered: true,
    declinedGroupKeys: new Set(),
  }
  if (raw === undefined) return fallback

  try {
    const parsed = JSON.parse(raw) as {
      threshold?: unknown
      isOffered?: unknown
      declined?: Record<string, unknown>
    } | null
    const threshold = Number(parsed?.threshold)
    return {
      // A threshold of one would offer every two-payment split, and a negative
      // one would offer rows that are not installments at all. The stored value
      // is the user's, but it is read back through the same floor the control
      // enforces rather than trusted because it was written once.
      threshold:
        Number.isFinite(threshold) && threshold >= MIN_PROMOTION_THRESHOLD
          ? Math.floor(threshold)
          : DEFAULT_INSTALLMENT_PROMOTION_THRESHOLD,
      isOffered: parsed?.isOffered !== false,
      declinedGroupKeys: new Set(Object.keys(parsed?.declined ?? {})),
    }
  } catch {
    // A setting this app wrote and something else corrupted is not worth taking
    // the screen down for. The default asks a question rather than hiding one.
    return fallback
  }
}

/** Two payments is not a purchase split over time; it is a purchase. */
export const MIN_PROMOTION_THRESHOLD = 2

function writeInstallmentPromotion(
  db: Database,
  settings: InstallmentPromotionSettings,
  now: number,
): void {
  writeSetting(
    db,
    PROMOTION_KEY,
    JSON.stringify({
      threshold: settings.threshold,
      isOffered: settings.isOffered,
      declined: Object.fromEntries([...settings.declinedGroupKeys].map((key) => [key, now])),
    }),
    now,
  )
}

export function setInstallmentThreshold(db: Database, threshold: number, now: number): void {
  const current = readInstallmentPromotion(db)
  writeInstallmentPromotion(
    db,
    { ...current, threshold: Math.max(MIN_PROMOTION_THRESHOLD, Math.floor(threshold)) },
    now,
  )
}

export function setInstallmentOffers(db: Database, isOffered: boolean, now: number): void {
  writeInstallmentPromotion(db, { ...readInstallmentPromotion(db), isOffered }, now)
}

/** "This purchase is not a debt." Remembered, or the next import asks again. */
export function declineInstallmentGroup(db: Database, groupKey: string, now: number): void {
  const current = readInstallmentPromotion(db)
  writeInstallmentPromotion(
    db,
    { ...current, declinedGroupKeys: new Set([...current.declinedGroupKeys, groupKey]) },
    now,
  )
}

export function clearInstallmentDecline(db: Database, groupKey: string, now: number): void {
  const current = readInstallmentPromotion(db)
  const remaining = new Set(current.declinedGroupKeys)
  if (!remaining.delete(groupKey)) return
  writeInstallmentPromotion(db, { ...current, declinedGroupKeys: remaining }, now)
}

/**
 * The split purchases worth offering as debts.
 *
 * Derived from the ledger every time, never stored — the shape every candidate
 * in this app takes (docs/f09's fixed-expense candidates, D-053). What is
 * stored is only the **answers**: a group already promoted is found by looking
 * for a debt that tracks it, and a group declined is in the setting above.
 *
 * Both are handed to the domain as one set, because from where it stands they
 * are the same fact — do not offer this group — and keeping them apart there
 * would be a distinction with no consumer.
 */
export function installmentCandidates(
  db: Database,
  options?: { readonly includeDeclined?: boolean },
): readonly InstallmentDebtCandidate[] {
  const settings = readInstallmentPromotion(db)
  if (!settings.isOffered && options?.includeDeclined !== true) return []

  const answered = new Set<string>(
    options?.includeDeclined === true ? [] : settings.declinedGroupKeys,
  )
  for (const debt of listDebts(db, { includeClosed: true })) {
    if (debt.tracking.kind === 'CARD_INSTALLMENT_GROUP') answered.add(debt.tracking.groupKey)
  }

  return installmentDebtCandidates(listPaymentObservations(db), {
    threshold: settings.threshold,
    promotedGroupKeys: answered,
  })
}

/**
 * Turn one split purchase into a debt, with the slices already charged recorded
 * against it.
 *
 * docs/f08 calls this the case most apps get wrong: twelve slices' worth of
 * money is owed the moment the purchase is made, and only one slice appears in
 * each statement. The principal is the whole purchase — the total the file
 * printed when it printed one, and slice × count when it did not, which is what
 * `candidate.principal.basis` says and what the offer shows before anyone
 * agrees to it.
 *
 * **The slices already charged are confirmed, not queued.** Promoting the group
 * *is* the confirmation: the user has just said this purchase is a debt, and
 * asking them again once per slice would be the app disbelieving an answer it
 * had just been given. Only this debt's payments are touched, and a debt created
 * one statement earlier has none of anybody else's.
 *
 * **No expected end date**, though the count implies one. The payoff projection
 * reads the rate the slices actually arrive at rather than a date, so a
 * calculated end date would be a second answer to a question already answered
 * from the ledger — and the one place it could disagree is a purchase whose
 * charges skipped a month.
 */
export function promoteInstallmentGroup(
  db: Database,
  candidate: InstallmentDebtCandidate,
  now: number,
): Debt {
  const debt = createDebt(
    db,
    {
      name: candidate.merchantRaw,
      kind: 'CARD_INSTALLMENTS',
      principalAmount: candidate.principal.amount,
      openedDate: candidate.firstChargeDate,
      // Stated by the file, not inferred: it is what the last slice was charged.
      monthlyPaymentAmount: abs(candidate.sliceAmount),
      tracking: { kind: 'CARD_INSTALLMENT_GROUP', groupKey: candidate.groupKey },
      note: `Promoted from a purchase split into ${candidate.paymentCount} payments`,
    },
    now,
  )

  syncDiscoveredPayments(db, now)
  const payments = declared(db, 'debt_payment')
  for (const payment of listPayments(db, debt.id)) {
    if (!payment.isConfirmed) updateRow(db, payments, payment.id, { is_confirmed: 1 })
  }

  // A group promoted after being declined is no longer declined: the answer the
  // user just gave replaces the one they gave before, rather than sitting behind
  // it waiting to suppress the offer if the debt is ever deleted.
  clearInstallmentDecline(db, candidate.groupKey, now)

  return debt
}

export interface DebtDetail {
  readonly debt: Debt
  readonly payments: readonly DebtPayment[]
  readonly balance: DebtBalance
  readonly projection: PayoffProjection
  readonly warnings: readonly DebtWarning[]
}

/**
 * One debt and every figure a screen prints about it, from one set of inputs —
 * so the balance, the ring and the projection cannot disagree with each other,
 * which is what `fundAnalysis` exists to guarantee for a fund (D-071).
 *
 * `from` is passed in rather than read off a clock: a projection is then a
 * function of the document and reads the same on any day (D-062).
 */
export function debtDetail(db: Database, id: string, from: YearMonth): DebtDetail | undefined {
  const debt = findDebt(db, id)
  if (debt === undefined) return undefined

  const payments = listPayments(db, id)
  const balance = balanceIn(debtBalances(db, [debt]), debt)
  return {
    debt,
    payments: sortPayments(payments),
    balance,
    projection: projectPayoff(debt, payments, balance, from),
    warnings: debtWarnings(
      debt,
      listDebts(db, { includeClosed: true }),
      listFixedExpenses(db),
    ),
  }
}

// --- Encoding and decoding --------------------------------------------------

/** The kinds whose source is one transaction, and so a link (D-279). */
const TRANSACTION_SOURCES: ReadonlySet<PaymentSourceKind> = new Set(['TRANSACTION', 'INSTALLMENT_SLICE'])

/** Write payments through the engine, returning their ids in order. */
function insertPayments(db: Database, inputs: readonly NewPayment[]): readonly string[] {
  return insertRows(
    db,
    declared(db, 'debt_payment'),
    inputs.map((input) => {
      const amount = abs(input.amount)
      const interest = input.interestPortion
      const kind = input.sourceKind ?? 'MANUAL'
      const ref = input.sourceRefId ?? null
      return {
        debt: input.debtId,
        date: toISODate(input.date),
        amount_minor: amount.minor,
        amount_currency: amount.currency,
        interest_minor:
          interest === undefined || interest.currency !== amount.currency ? 0 : interest.minor,
        interest_currency: amount.currency,
        source_kind: kind,
        transaction: TRANSACTION_SOURCES.has(kind) ? ref : null,
        source_key: TRANSACTION_SOURCES.has(kind) ? null : ref,
        is_confirmed: (input.isConfirmed ?? true) ? 1 : 0,
        note: input.note ?? null,
      }
    }),
  )
}

/**
 * A debt's cells as the declaration names them, the tracking from the one
 * union: a pattern and a category are two columns, and the kind says which is
 * set (D-259) — so no edit can leave `CATEGORY` beside a merchant pattern
 * typed under the previous kind. The monthly payment is in the principal's
 * currency, as it always was.
 */
function debtColumns(debt: NewDebt): Record<string, string | number | null> {
  const tracking = debt.tracking ?? { kind: 'NONE' }
  const currency = debt.principalAmount.currency
  return {
    name: debt.name,
    kind: debt.kind,
    principal_minor: debt.principalAmount.minor,
    principal_currency: currency,
    opened: toISODate(debt.openedDate),
    expected_end: debt.expectedEndDate === undefined ? null : toISODate(debt.expectedEndDate),
    monthly_payment_minor: debt.monthlyPaymentAmount?.minor ?? null,
    monthly_payment_currency: debt.monthlyPaymentAmount === undefined ? null : currency,
    linked_account: debt.linkedAccountId ?? null,
    auto_track_kind: tracking.kind,
    auto_track_pattern:
      tracking.kind === 'MERCHANT_PATTERN'
        ? tracking.pattern
        : tracking.kind === 'CARD_INSTALLMENT_GROUP'
          ? tracking.groupKey
          : null,
    auto_track_category: tracking.kind === 'CATEGORY' ? tracking.categoryId : null,
    note: debt.note ?? null,
  }
}

/**
 * The union back from the columns.
 *
 * A kind the enum does not know, or one whose ref went missing under a document
 * edited by hand, decodes as `NONE` — a debt that discovers nothing, rather than
 * a mechanism reading a ref it does not understand. Discovery is the one place
 * in this app where a wrong reading writes money figures.
 */
function decodeTracking(
  kind: string,
  pattern: string | undefined,
  category: string | undefined,
): AutoTracking {
  if (!isTrackKind(kind)) return { kind: 'NONE' }

  switch (kind) {
    case 'MERCHANT_PATTERN':
      return pattern === undefined ? { kind: 'NONE' } : { kind, pattern }
    case 'CATEGORY':
      return category === undefined ? { kind: 'NONE' } : { kind, categoryId: category }
    case 'CARD_INSTALLMENT_GROUP':
      return pattern === undefined ? { kind: 'NONE' } : { kind, groupKey: pattern }
    case 'NONE':
      return { kind: 'NONE' }
  }
}

function isTrackKind(value: string): value is AutoTrackKind {
  return (AUTO_TRACK_KINDS as readonly string[]).includes(value)
}

function isDebtKind(value: string): value is DebtKind {
  return (DEBT_KINDS as readonly string[]).includes(value)
}

function isSourceKind(value: string): value is PaymentSourceKind {
  return (PAYMENT_SOURCE_KINDS as readonly string[]).includes(value)
}

function decodeDebts(rows: readonly Record<string, unknown>[]): readonly Debt[] {
  const debts: Debt[] = []
  for (const row of rows) {
    const openedDate = parseISODate(String(row['opened_date']))
    if (openedDate === undefined) continue

    const kind = String(row['kind'])
    const currency = String(row['currency'])
    const monthly = row['monthly_payment_minor']
    const endDate = row['expected_end_date']
    const pattern = row['auto_track_pattern']
    const category = row['auto_track_category']

    debts.push({
      id: String(row['id']),
      name: String(row['name'] ?? ''),
      kind: isDebtKind(kind) ? kind : 'OTHER',
      principalAmount: money(Number(row['principal_minor'] ?? 0), currency),
      openedDate,
      expectedEndDate: endDate == null ? undefined : parseISODate(String(endDate)),
      monthlyPaymentAmount: monthly == null ? undefined : money(Number(monthly), currency),
      linkedAccountId: row['linked_account_id'] == null ? undefined : String(row['linked_account_id']),
      tracking: decodeTracking(
        String(row['auto_track_kind']),
        pattern == null ? undefined : String(pattern),
        category == null ? undefined : String(category),
      ),
      isClosed: Number(row['is_closed'] ?? 0) === 1,
      note: row['note'] == null ? undefined : String(row['note']),
    })
  }
  return debts
}

function decodePayments(rows: readonly Record<string, unknown>[]): readonly DebtPayment[] {
  const payments: DebtPayment[] = []
  for (const row of rows) {
    const date = parseISODate(String(row['date']))
    if (date === undefined) continue

    const currency = String(row['currency'])
    const sourceKind = String(row['source_kind'])

    payments.push({
      id: String(row['id']),
      debtId: String(row['debt_id']),
      date,
      amount: money(Number(row['amount_minor'] ?? 0), currency),
      interestPortion: money(Number(row['interest_minor'] ?? 0), currency),
      principalPart:
        typeof row['principal_part_minor'] === 'number' && typeof row['principal_part_currency'] === 'string'
          ? money(row['principal_part_minor'], row['principal_part_currency'])
          : undefined,
      sourceKind: isSourceKind(sourceKind) ? sourceKind : 'MANUAL',
      sourceRefId: row['source_ref_id'] == null ? undefined : String(row['source_ref_id']),
      isConfirmed: Number(row['is_confirmed'] ?? 0) === 1,
      note: row['note'] == null ? undefined : String(row['note']),
    })
  }
  return payments
}

/**
 * The sentence a discovered payment arrives with.
 *
 * Written once, at discovery, from the provenance the domain produced — so the
 * row can still say where it came from after the transaction has been
 * recategorized or the payslip edited. The queue regenerates the full provenance
 * for the screen; this is what survives when it cannot.
 *
 * **No date in it.** The payment carries its own, every list that prints one of
 * these prints it in the column beside it, and a note repeating it reads as a
 * second fact rather than one — which is what driving the detail screen showed.
 * The payslip's period stays, because that is a different date from the day the
 * money moved.
 */
function provenanceNote(provenance: PaymentProvenance): string {
  switch (provenance.kind) {
    case 'TRANSACTION':
      return `From ${provenance.merchantRaw}`
    case 'INSTALLMENT_SLICE':
      return `Payment ${provenance.sequence} of ${provenance.total} — ${provenance.merchantRaw}`
    case 'PAYCHECK':
      return `From the ${toYearMonthString(provenance.period)} payslip`
  }
}
