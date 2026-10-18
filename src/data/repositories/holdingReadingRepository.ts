import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { toISODate, type LocalDate } from '@/core/time.ts'
import { costBasisCheck, type CostBasisCheck } from '@/domain/goalDeposits.ts'
import { cashCheck, quantityCheck, type HoldingWorth, type ReadingCheck } from '@/domain/holdingReadings.ts'
import { evaluateIdentity } from '@/domain/format/identity.ts'
import { identityInputsOf } from '@/domain/format/row.ts'
import { query } from '../db/database.ts'
import { countsCondition } from './movedRepository.ts'
import { declaredFigures } from '../packs/ledger/figures.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { findHolding, holdingQuantity } from './savingsRepository.ts'

/**
 * **A dated reading of what a holding is worth** (M30 U5, D-358): the
 * `holding_reading` format's repository, modelled on a fund's readings
 * (`fundRepository`'s snapshots) — one a holding a day, transcribed from a
 * statement, never fetched (D-308).
 *
 * What a reading is *for* is in three places: the holding's worth, the pack's
 * declared `reading` with what moved since (`holdingWorths` below); the growth
 * it implies for a goal fed by the holding, worked out on read (`fedDeposits`,
 * D-381); and the checks below, what it proves about the rows the document
 * already has.
 */

export interface HoldingReading {
  readonly id: string
  readonly holdingId: string
  readonly asOf: string
  readonly value: Money
  readonly quantityMicro: number | undefined
  readonly costBasis: Money | undefined
  readonly priceMicro: number | undefined
  readonly statementId: string | undefined
  readonly source: string | undefined
  readonly note: string | undefined
}

export interface NewHoldingReading {
  readonly holdingId: string
  readonly asOf: LocalDate
  readonly value: Money
  readonly quantityMicro?: number | undefined
  readonly costBasis?: Money | undefined
  readonly priceMicro?: number | undefined
  readonly statementId?: string | undefined
  readonly source?: string | undefined
  readonly note?: string | undefined
}

export class HoldingReadingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HoldingReadingError'
  }
}

const SELECT = `SELECT id, holding, as_of, value_minor, value_currency, quantity,
                       cost_basis_minor, cost_basis_currency, price, statement, source, note
                  FROM fmt_holding_reading WHERE 1 = 1`

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function decode(row: Record<string, unknown>): HoldingReading {
  const costMinor = optionalNumber(row['cost_basis_minor'])
  const costCurrency = optionalText(row['cost_basis_currency'])
  return {
    id: String(row['id']),
    holdingId: String(row['holding']),
    asOf: String(row['as_of']),
    value: money(Number(row['value_minor']), String(row['value_currency'])),
    quantityMicro: optionalNumber(row['quantity']),
    costBasis: costMinor === undefined || costCurrency === undefined ? undefined : money(costMinor, costCurrency),
    priceMicro: optionalNumber(row['price']),
    statementId: optionalText(row['statement']),
    source: optionalText(row['source']),
    note: optionalText(row['note']),
  }
}

/** Every reading, or one holding's, oldest first. */
export function listHoldingReadings(db: Database, holdingId?: string): readonly HoldingReading[] {
  return holdingId === undefined
    ? query(db, `${SELECT} ORDER BY as_of, holding`).map(decode)
    : query(db, `${SELECT} AND holding = ? ORDER BY as_of`, [holdingId]).map(decode)
}

/** The latest reading of a holding: what it is worth now. */
export function latestHoldingReading(db: Database, holdingId: string): HoldingReading | undefined {
  const row = query(db, `${SELECT} AND holding = ? ORDER BY as_of DESC LIMIT 1`, [holdingId])[0]
  return row === undefined ? undefined : decode(row)
}

function onDay(db: Database, holdingId: string, asOf: string): HoldingReading | undefined {
  const row = query(db, `${SELECT} AND holding = ? AND as_of = ?`, [holdingId, asOf])[0]
  return row === undefined ? undefined : decode(row)
}

/**
 * Why this reading cannot be kept, in a sentence — or `undefined` when it can.
 * The one judgement the screen, the tool's preview and the write share.
 *
 * **An account's own cash has a value and nothing else**: no quantity, cost or
 * price, because cash bought with cash is cash — its check is the account's
 * running balance instead.
 */
export function holdingReadingProblem(db: Database, input: NewHoldingReading): string | undefined {
  const holding = findHolding(db, input.holdingId)
  if (holding === undefined) return 'That holding no longer exists.'
  if (!Number.isSafeInteger(input.value.minor)) return 'That value is not a figure this document can keep.'
  if (input.costBasis !== undefined && input.costBasis.currency !== input.value.currency) {
    return `The cost is in ${input.costBasis.currency} and the value in ${input.value.currency}; a reading is one currency.`
  }
  if (input.quantityMicro !== undefined && !Number.isSafeInteger(input.quantityMicro)) {
    return 'That quantity is not a figure this document can keep.'
  }
  if (input.priceMicro !== undefined && (!Number.isSafeInteger(input.priceMicro) || input.priceMicro < 0)) {
    return 'A price is a figure of zero or more.'
  }
  if (
    holding.accountId !== undefined &&
    (input.quantityMicro !== undefined || input.costBasis !== undefined || input.priceMicro !== undefined)
  ) {
    return `${holding.name} is an account's own cash: its reading is a value only, checked against the account's rows.`
  }
  if (input.statementId !== undefined && query(db, 'SELECT 1 FROM fmt_statement WHERE id = ?', [input.statementId]).length === 0) {
    return 'That statement is not in this document.'
  }
  return undefined
}

/** What recording one reading did. */
export type ReadingOutcome = 'CREATED' | 'UNCHANGED' | 'CORRECTED'

function sameFigures(held: HoldingReading, input: NewHoldingReading): boolean {
  const sameMoney = (a: Money | undefined, b: Money | undefined): boolean =>
    a === undefined ? b === undefined : b !== undefined && a.minor === b.minor && a.currency === b.currency
  return (
    sameMoney(held.value, input.value) &&
    sameMoney(held.costBasis, input.costBasis) &&
    held.quantityMicro === input.quantityMicro &&
    held.priceMicro === input.priceMicro
  )
}

/** What a reading on a day that already has one would change, or `undefined` when it changes nothing. */
export function readingClash(db: Database, input: NewHoldingReading): HoldingReading | undefined {
  const held = onDay(db, input.holdingId, toISODate(input.asOf))
  return held === undefined || sameFigures(held, input) ? undefined : held
}

function cells(input: NewHoldingReading) {
  return {
    value_minor: input.value.minor,
    value_currency: input.value.currency,
    quantity: input.quantityMicro ?? null,
    cost_basis_minor: input.costBasis?.minor ?? null,
    cost_basis_currency: input.costBasis?.currency ?? null,
    price: input.priceMicro ?? null,
    statement: input.statementId ?? null,
    source: input.source ?? null,
    note: input.note ?? null,
  }
}

/**
 * **Record what a statement said a holding was worth on a day.** Recording the
 * same figures for the same day again changes nothing — an overlapping file is
 * the ordinary case. Different figures for a day that has a reading are refused
 * by name unless `correct` says they replace it: a figure quietly overwritten is
 * the one way a reading could be wrong without anybody knowing.
 */
export function recordHoldingReading(
  db: Database,
  input: NewHoldingReading,
  options: { readonly correct?: boolean } = {},
  _now: number,
): ReadingOutcome {
  const problem = holdingReadingProblem(db, input)
  if (problem !== undefined) throw new HoldingReadingError(problem)
  const day = toISODate(input.asOf)
  const held = onDay(db, input.holdingId, day)
  if (held === undefined) {
    insertRows(db, declared(db, 'holding_reading'), [{ holding: input.holdingId, as_of: day, ...cells(input) }])
    return 'CREATED'
  }
  if (sameFigures(held, input)) return 'UNCHANGED'
  if (options.correct !== true) {
    throw new HoldingReadingError(
      `There is already a reading of that holding for ${day}, with other figures. Say it corrects that one, or leave it.`,
    )
  }
  updateRow(db, declared(db, 'holding_reading'), held.id, cells(input))
  return 'CORRECTED'
}

/** Remove one reading; its growth goes with it on the next sync. */
export function deleteHoldingReading(db: Database, id: string, _now: number): void {
  deleteRows(db, declared(db, 'holding_reading'), [id], allDeclared(db))
}

// --- What a holding is worth (M30 F5; M36 U05) -------------------------------

/** The source kinds a person types: money put in by hand, and a gain or loss they said (D-381). */
const TYPED_SINCE = "('MANUAL', 'FROM_PLAN', 'OPENING_BALANCE', 'GROWTH')"

/** Each read holding's latest reading day — the `reading` the pack declares picks the same row. */
const LATEST_DAY = 'SELECT holding, MAX(as_of) AS as_of FROM fmt_holding_reading GROUP BY holding'

/**
 * **What each holding with a reading is worth now, and what of it is growth**
 * (M30 F5; M36 U05, D-381). The pack declares the two figures that are folds:
 * `reading`, the latest reading's value, and `put_in`, what the holding's rows
 * bought less what they sold and what a person put in by hand. **What moved
 * after the reading's day is the one part that stays code** — a buy or a sale
 * since, or a deposit typed since — because a filter cannot compare a row's day
 * with another total's, and leaving it out would keep a holding sold whole after
 * its last reading at that reading forever. Growth is the worth less `put_in`.
 *
 * An account's own cash has no cost: its worth is the reading and the account's
 * rows since, and it has no growth. A holding whose latest reading is in another
 * currency is no figure here (D-003), and is Σ its deposits, as one with no
 * reading is.
 */
export function holdingWorths(db: Database, currency: CurrencyCode): ReadonlyMap<string, HoldingWorth> {
  const latest = new Map(query(db, LATEST_DAY).map((row) => [String(row['holding']), String(row['as_of'])]))
  if (latest.size === 0) return new Map()
  const figures = declaredFigures(db, 'holding', ['reading', 'put_in'], `t.id IN (SELECT holding FROM fmt_holding_reading)`)
  // An account's own cash has no cost, and neither has a fund here: what went into
  // a fund is its payslips', worked out on its own page (D-389), never `put_in`.
  const cash = new Set(
    query(
      db,
      'SELECT id FROM fmt_holding WHERE (account IS NOT NULL OR fund_type IS NOT NULL) AND id IN (SELECT holding FROM fmt_holding_reading)',
    ).map((row) => String(row['id'])),
  )
  const since = new Map<string, number>()
  const add = (rows: readonly Record<string, unknown>[]): void => {
    for (const row of rows) {
      const id = String(row['holding'])
      since.set(id, (since.get(id) ?? 0) + Number(row['moved'] ?? 0))
    }
  }
  // A position's rows since, turned around as `bought` turns them, and what a person typed into it since.
  add(
    query(
      db,
      `SELECT t.holding AS holding, -SUM(t.amount_minor) AS moved
         FROM fmt_transaction t JOIN (${LATEST_DAY}) r ON r.holding = t.holding
        WHERE COALESCE(t.is_excluded_from_stats, 0) = 0 AND t.transaction_date > r.as_of AND t.amount_currency = ?
        GROUP BY t.holding`,
      [currency],
    ),
  )
  add(
    query(
      db,
      `SELECT d.holding AS holding, SUM(d.amount_minor) AS moved
         FROM fmt_saving_deposit d JOIN (${LATEST_DAY}) r ON r.holding = d.holding
        WHERE d.date > r.as_of AND d.amount_currency = ? AND d.source_kind IN ${TYPED_SINCE}
          AND d.holding NOT IN (SELECT id FROM fmt_holding WHERE account IS NOT NULL)
        GROUP BY d.holding`,
      [currency],
    ),
  )
  // An account's own cash: the account's rows as they stand.
  add(
    query(
      db,
      `SELECT h.id AS holding, SUM(t.amount_minor) AS moved
         FROM fmt_holding h JOIN (${LATEST_DAY}) r ON r.holding = h.id
         JOIN fmt_transaction t ON t.account = h.account
        WHERE t.transaction_date > r.as_of AND t.amount_currency = ?
        GROUP BY h.id`,
      [currency],
    ),
  )

  const out = new Map<string, HoldingWorth>()
  for (const [holdingId, asOf] of latest) {
    const one = figures.get(holdingId)
    const reading = one?.money('reading', currency)
    if (reading?.currency !== currency) continue
    const worth = money(reading.minor + (since.get(holdingId) ?? 0), currency)
    const isCash = cash.has(holdingId)
    const putIn = isCash ? undefined : one?.money('put_in', currency)
    const counted = putIn?.currency === currency ? putIn : undefined
    out.set(holdingId, {
      holdingId,
      asOf,
      reading,
      worth,
      putIn: counted,
      growth: counted === undefined ? undefined : money(worth.minor - counted.minor, currency),
    })
  }
  return out
}

/** The same, as the valuations a balance takes: a reading replaces the sum of deposits (D-186). */
export function holdingValuations(db: Database, currency: CurrencyCode): ReadonlyMap<string, Money> {
  return new Map([...holdingWorths(db, currency)].map(([holdingId, one]) => [holdingId, one.worth]))
}

// --- What a reading proves ---------------------------------------------------

/** What a holding's rows put in, by a day or in all: their amounts summed and turned around. */
export interface RowsPutIn {
  readonly rows: number
  readonly putIn: Money
  /** Rows in another currency, which a cost basis cannot be checked against. */
  readonly otherCurrencies: number
}

export function rowsPutIn(db: Database, holdingId: string, currency: CurrencyCode, by?: string): RowsPutIn {
  const rows = query(
    db,
    `SELECT amount_currency, COUNT(*) AS n, SUM(amount_minor) AS total
       FROM fmt_transaction
      WHERE holding = ? AND ${countsCondition()} AND (? IS NULL OR transaction_date <= ?)
      GROUP BY amount_currency`,
    [holdingId, by ?? null, by ?? null],
  )
  let count = 0
  let minor = 0
  let others = 0
  for (const row of rows) {
    const n = Number(row['n'])
    count += n
    if (String(row['amount_currency']) === currency) minor -= Number(row['total'])
    else others += n
  }
  return { rows: count, putIn: money(minor, currency), otherCurrencies: others }
}

/** The holding's rows by the reading's day, against the cost basis it printed. */
export function readingCostCheck(db: Database, reading: HoldingReading): CostBasisCheck {
  const by = rowsPutIn(db, reading.holdingId, reading.value.currency, reading.asOf)
  if (reading.costBasis === undefined) return { kind: 'UNCHECKED', reason: 'The reading printed no cost.' }
  return costBasisCheck(by.putIn, reading.costBasis, by.otherCurrencies)
}

/**
 * An account's running balance on a day: its opening balance, when it has one
 * dated by then, and every row of it from that date to the day. `undefined`
 * when neither exists.
 */
export function runningBalance(db: Database, accountId: string, on: string, currency: CurrencyCode): Money | undefined {
  const opening = query(
    db,
    'SELECT opening_balance_minor AS minor, opening_balance_currency AS currency, opening_date FROM fmt_account WHERE id = ?',
    [accountId],
  )[0]
  const openingDate = optionalText(opening?.['opening_date'])
  const openingMinor =
    openingDate !== undefined && openingDate <= on && String(opening?.['currency']) === currency
      ? optionalNumber(opening?.['minor'])
      : undefined
  const from = openingMinor === undefined ? null : (openingDate ?? null)
  const moved = query(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_minor), 0) AS total
       FROM fmt_transaction
      WHERE account = ? AND amount_currency = ? AND transaction_date <= ? AND (? IS NULL OR transaction_date >= ?)`,
    [accountId, currency, on, from, from],
  )[0]
  const rows = Number(moved?.['n'] ?? 0)
  if (rows === 0 && openingMinor === undefined) return undefined
  return money((openingMinor ?? 0) + Number(moved?.['total'] ?? 0), currency)
}

/**
 * **quantity × price against the value printed — the pack's `price` identity**
 * (M36 U03), judged on the reading's own row: `value = quantity * price * 100`
 * within a tenth of a percent. A check only: the value is the figure, and the
 * price is what catches a value or a price copied in the wrong unit (one broker
 * prints price in agorot, a factor of a hundred).
 *
 * It was code's until then, within one whole unit or 0.1% whichever was
 * larger. An identity has one tolerance, so it is 0.1% of quantity × price: a
 * reading under ₪1,000 is held a little closer than a whole shekel, which a
 * value rounded to the agora and a price printed to its own places still meet.
 * The `× 100` is a currency with hundredths, which every currency the ledger
 * reads is; a reading in one without would fail by the factor and say so.
 *
 * A reading not yet written — a statement's line in a dry run — is judged the
 * same way, over the cells it would be written with.
 */
export function priceCheck(
  db: Database,
  quantityMicro: number | undefined,
  priceMicro: number | undefined,
  value: Money,
): ReadingCheck<Money> {
  if (priceMicro === undefined) return { kind: 'UNCHECKED', reason: 'The reading printed no price.' }
  if (quantityMicro === undefined) return { kind: 'UNCHECKED', reason: 'The reading printed a price and no quantity.' }
  const declaration = declared(db, 'holding_reading')
  const identity = declaration.identities.find((one) => one.name === 'price')
  if (identity === undefined) {
    return { kind: 'UNCHECKED', reason: 'This document declares no price check on a reading.' }
  }
  const row = {
    id: 'reading',
    cells: { value_minor: value.minor, value_currency: value.currency, quantity: quantityMicro, price: priceMicro },
  }
  const verdict = evaluateIdentity(identity, identityInputsOf(declaration, row))
  if (verdict.kind === 'UNCHECKED') return verdict
  if (verdict.kind === 'PROVED') return { kind: 'PROVED' }
  return { kind: 'FAILED', ours: money(Math.round(verdict.right), value.currency), printed: value }
}

/** Everything a reading proves, each a check of its own. */
export interface ReadingChecks {
  readonly cost: CostBasisCheck
  readonly quantity: ReadingCheck<number>
  readonly price: ReadingCheck<Money>
  /** Set only on a reading of an account's own cash. */
  readonly cash: ReadingCheck<Money> | undefined
}

export function readingChecks(db: Database, reading: HoldingReading): ReadingChecks {
  const holding = findHolding(db, reading.holdingId)
  if (holding?.accountId !== undefined) {
    const running = runningBalance(db, holding.accountId, reading.asOf, reading.value.currency)
    const none: ReadingCheck<never> = { kind: 'UNCHECKED', reason: 'Cash has no quantity, cost or price.' }
    return {
      cost: { kind: 'UNCHECKED', reason: 'Cash has no cost.' },
      quantity: none,
      price: none,
      cash: cashCheck(running, reading.value),
    }
  }
  return {
    cost: readingCostCheck(db, reading),
    quantity: quantityCheck(holdingQuantityBy(db, reading.holdingId, reading.asOf), reading.quantityMicro),
    price: priceCheck(db, reading.quantityMicro, reading.priceMicro, reading.value),
    cash: undefined,
  }
}

/**
 * The holding's rows' quantity by a day. The declared sum (`holdingQuantity`) is
 * every row's; a reading is checked against the rows by its day, so this sums
 * those — and a row naming the holding with no quantity makes it unchecked,
 * never smaller, as the declared sum does (D-224).
 */
/** The quantity a holding's rows add up to by a day — or why they cannot say. */
export function holdingQuantityBy(db: Database, holdingId: string, by: string): { quantityMicro: number } | { reason: string } {
  const all = holdingQuantity(db, holdingId)
  if (all.kind === 'UNCHECKED') return { reason: all.reason }
  const row = query(
    db,
    `SELECT COUNT(*) AS n, COUNT(quantity) AS counted, COALESCE(SUM(quantity), 0) AS total
       FROM fmt_transaction WHERE holding = ? AND transaction_date <= ?`,
    [holdingId, by],
  )[0]
  const n = Number(row?.['n'] ?? 0)
  if (n !== Number(row?.['counted'] ?? 0)) return { reason: 'A row that names it has no quantity.' }
  return { quantityMicro: Number(row?.['total'] ?? 0) }
}
