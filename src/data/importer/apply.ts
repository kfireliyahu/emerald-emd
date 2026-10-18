/**
 * Applying a mapping to a sheet: pipeline step 6 of
 * docs/f01-card-statement-import.md.
 *
 * One row in, one outcome out. A row that cannot be parsed produces a
 * row-scoped error and the file keeps going — docs/02-architecture.md is
 * explicit that one bad row must never abort a 400-row statement.
 */

import { abs, negate, type CurrencyCode, type Money } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import type { LocalDate } from '@/core/time.ts'
import { installmentGroupKey } from '@/domain/installments.ts'
import type { BankRow } from '@/domain/model/banking.ts'
import type {
  ColumnRole,
  Direction,
  DraftForeignAmount,
  DraftInstallment,
  DraftMapping,
  DraftTransaction,
  RowError,
} from '@/domain/model/importing.ts'
import { columnFor } from './guess.ts'
import {
  parseAmountCell,
  parseCardLast4,
  parseCurrencyCell,
  parseDateCell,
  parseInstallmentText,
  parseNumberCell,
} from './normalize.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

export type RowOutcome =
  | {
      readonly kind: 'parsed'
      readonly transaction: DraftTransaction
      /**
       * The running balance the row states, when a `balance` column is mapped.
       *
       * Beside the transaction rather than in it: docs/f06 is explicit that the
       * balance is imported for verification and **not stored per transaction**.
       * It exists between the parse and `verifyRunningBalance`, and nowhere
       * after.
       */
      readonly balance?: Money | undefined
    }
  | { readonly kind: 'error'; readonly errors: readonly RowError[] }
  /** Not a data row at all: a blank, or a trailing total. Counted, never silent. */
  | { readonly kind: 'skipped'; readonly reason: string }

export interface ParsedRow {
  /** 0-based index into `table.rows`; add one for the number the spreadsheet shows. */
  readonly rowIndex: number
  readonly cells: readonly SheetCell[]
  readonly outcome: RowOutcome
}

export interface ParseSummary {
  readonly parsed: number
  readonly errors: number
  readonly skipped: number
}

export function applyMapping(table: SheetTable, mapping: DraftMapping): readonly ParsedRow[] {
  const rows: ParsedRow[] = []
  for (let rowIndex = mapping.dataStartRowIndex; rowIndex < table.rows.length; rowIndex++) {
    const cells = table.rows[rowIndex]
    if (cells === undefined) continue
    rows.push({ rowIndex, cells, outcome: parseRow(cells, mapping, table.name, rowIndex) })
  }
  return rows
}

export function summarize(rows: readonly ParsedRow[]): ParseSummary {
  let parsed = 0
  let errors = 0
  let skipped = 0
  for (const row of rows) {
    if (row.outcome.kind === 'parsed') parsed += 1
    else if (row.outcome.kind === 'error') errors += 1
    else skipped += 1
  }
  return { parsed, errors, skipped }
}

/** Every row that parsed. The total over these is what the printed total is checked against. */
export function allParsed(rows: readonly ParsedRow[]): readonly DraftTransaction[] {
  const found: DraftTransaction[] = []
  for (const row of rows) {
    if (row.outcome.kind === 'parsed') found.push(row.outcome.transaction)
  }
  return found
}

/**
 * Every row that parsed, in the file's own order, as the bank-import domain
 * takes them.
 *
 * The order is not incidental — `verifyRunningBalance` reads it as evidence of
 * which end of the file the oldest row is at, so this must not sort. The
 * description is handed over twice on purpose: keywords are matched against the
 * normalized form and the card's last-4 is read out of the raw one, because
 * `normalizeMerchant` strips a trailing four-digit run as a branch number.
 */
export function bankRowsOf(rows: readonly ParsedRow[]): readonly BankRow[] {
  const found: BankRow[] = []
  for (const row of rows) {
    if (row.outcome.kind !== 'parsed') continue
    const { transaction, balance } = row.outcome
    found.push({
      ref: transaction.sourceRowRef,
      date: transaction.transactionDate,
      amount: transaction.amount,
      descriptionRaw: transaction.merchantRaw,
      descriptionNormalized: transaction.merchantNormalized,
      balance,
    })
  }
  return found
}

/** The first `count` rows that parsed, for the mapper's live preview. */
export function firstParsed(rows: readonly ParsedRow[], count: number): readonly DraftTransaction[] {
  const found: DraftTransaction[] = []
  for (const row of rows) {
    if (row.outcome.kind === 'parsed') found.push(row.outcome.transaction)
    if (found.length === count) break
  }
  return found
}

function parseRow(
  cells: readonly SheetCell[],
  mapping: DraftMapping,
  sheetName: string,
  rowIndex: number,
): RowOutcome {
  const cellFor = (role: ColumnRole): SheetCell | undefined => {
    const column = columnFor(mapping.columnRoles, role)
    return column === undefined ? undefined : cells[column]
  }

  const filled = (cell: SheetCell | undefined): boolean => cell !== undefined && cell.kind !== 'empty'

  const split = mapping.amountConvention === 'SEPARATE_DEBIT_CREDIT'

  const dateCell = cellFor('date')
  const amountCell = cellFor('amount')
  const debitCell = cellFor('debit')
  const creditCell = cellFor('credit')
  const merchantCell = cellFor('merchant')

  const statesAmount = split ? filled(debitCell) || filled(creditCell) : filled(amountCell)

  // A row carrying neither an amount nor a merchant is not a transaction. This
  // is what drops blank rows and the trailing `סך הכל` / total rows that both
  // real files end with, without needing a pattern list for them.
  if (!statesAmount && !filled(merchantCell)) {
    return { kind: 'skipped', reason: filled(dateCell) ? 'no amount or merchant' : 'blank row' }
  }

  const errors: RowError[] = []

  const currency = readCurrency(cellFor('currency')) ?? mapping.defaultCurrency

  const transactionDate = readDate(dateCell, mapping, 'date', errors, 'transaction date')
  const rawAmount = split
    ? readSplitAmount(debitCell, creditCell, currency, errors)
    : readAmount(amountCell, currency, errors)
  const merchantRaw = readMerchant(merchantCell, errors)

  if (transactionDate === undefined || rawAmount === undefined || merchantRaw === undefined) {
    return { kind: 'error', errors }
  }

  const amount = applyConvention(rawAmount, mapping)

  const chargeDate = filled(cellFor('chargeDate'))
    ? readDate(cellFor('chargeDate'), mapping, 'chargeDate', errors, 'charge date')
    : undefined

  // The running balance is read here and carried no further than the check that
  // reads it. A balance cell the file filled in and this build cannot parse is
  // an error for the same reason a charge date is: the check that would have
  // caught the bad parse is exactly the one a silent drop disables.
  const balanceCell = cellFor('balance')
  const balance = filled(balanceCell)
    ? readBalance(balanceCell, currency, errors)
    : undefined

  // A failure in an optional column is still an error — silently dropping a
  // charge date the file supplied would be worse than saying so.
  if (errors.length > 0) return { kind: 'error', errors }

  const merchantNormalized = normalizeMerchant(merchantRaw)

  // The original-amount column is read once and dealt to whichever field it
  // belongs in. Which one it is depends on the currency, so this cannot be two
  // independent readers — see `readOriginal`.
  const original = readOriginal(
    cellFor('originalAmount'),
    cellFor('originalCurrency'),
    cellFor('exchangeRate'),
    currency,
    amount,
  )

  const counter = readInstallmentCounter(
    cellFor('installmentText'),
    cellFor('installmentSequence'),
    cellFor('installmentTotal'),
  )

  return {
    kind: 'parsed',
    balance,
    transaction: {
      transactionDate,
      chargeDate,
      amount,
      direction: directionOf(amount),
      merchantRaw,
      merchantNormalized,
      providerCategory: readText(cellFor('providerCategory')),
      cardLast4: readLast4(cellFor('cardLast4')),
      reference: readText(cellFor('reference')),
      note: readText(cellFor('note')),
      installment:
        counter === undefined
          ? undefined
          : toInstallment(counter, merchantNormalized, transactionDate, original.originalTotal),
      foreign: original.foreign,
      sourceRowRef: `${sheetName}!${rowIndex + 1}`,
    },
  }
}

/**
 * A slice, with the group link that ties it to the other slices of its purchase.
 *
 * The original date is the row's own transaction date, and there is no other
 * date it could be: both real providers repeat the purchase date on every slice
 * and vary only the charge date, and a format stating a second purchase date
 * has no role to put it in (D-036). See docs/04-data-model.md, "Installment".
 */
function toInstallment(
  counter: { readonly sequence: number; readonly total: number },
  merchantNormalized: string,
  transactionDate: LocalDate,
  originalTotal: Money | undefined,
): DraftInstallment {
  return {
    ...counter,
    originalTotal,
    groupKey: installmentGroupKey({
      merchantNormalized,
      originalDate: transactionDate,
      originalTotal,
      paymentCount: counter.total,
    }),
  }
}

/**
 * Both real card files list charges as positive numbers, so the importer is
 * what makes a charge negative. See D-004 and docs/05 — `amount` is signed,
 * outflow negative, and getting this wrong is how refunds inflate spending.
 *
 * `SEPARATE_DEBIT_CREDIT` passes through untouched: `readSplitAmount` has
 * already signed it from the column it came out of, and there is no second
 * opinion to apply.
 */
function applyConvention(amount: Money, mapping: DraftMapping): Money {
  return mapping.amountConvention === 'POSITIVE_IS_CHARGE' ? negate(amount) : amount
}

/**
 * One amount out of the bank pair — חובה and זכות, debit and credit.
 *
 * **The column decides the sign, not the digits.** Both are magnitudes on paper
 * and banks are not consistent about it: some print a debit as `1,234.56` and
 * some as `-1,234.56`, in a column that can only ever mean money out. Reading
 * the stated sign would turn the second bank's every charge into a deposit, so
 * the magnitude is taken and the sign comes from which column it was in — which
 * is the entire content of this convention.
 *
 * A row filling both columns with real numbers is not a row this app can read.
 * It is a mapping pointed at the wrong pair of columns far more often than it is
 * a bank saying something clever, and guessing which half to believe would hide
 * that.
 */
function readSplitAmount(
  debitCell: SheetCell | undefined,
  creditCell: SheetCell | undefined,
  currency: CurrencyCode,
  errors: RowError[],
): Money | undefined {
  const debit = readSide(debitCell, 'debit', currency, errors)
  const credit = readSide(creditCell, 'credit', currency, errors)
  if (debit === undefined && credit === undefined) {
    if (errors.length === 0) errors.push({ role: 'debit', message: 'Missing debit and credit' })
    return undefined
  }

  if (debit !== undefined && credit !== undefined) {
    errors.push({
      role: 'debit',
      message: `Row states both a debit (${debitCell?.text ?? ''}) and a credit (${creditCell?.text ?? ''})`,
    })
    return undefined
  }

  return debit === undefined ? (credit as Money) : negate(debit)
}

/** One side of the pair, as a magnitude. A zero is the column saying nothing. */
function readSide(
  cell: SheetCell | undefined,
  role: ColumnRole,
  currency: CurrencyCode,
  errors: RowError[],
): Money | undefined {
  if (cell === undefined || cell.kind === 'empty') return undefined

  const parsed = parseAmountCell(cell, currency)
  if (parsed === undefined) {
    errors.push({ role, message: `Could not read an amount from "${cell.text}"` })
    return undefined
  }
  return parsed.minor === 0 ? undefined : abs(parsed)
}

/** The running balance a bank row states. Signed as printed — an overdraft is negative. */
function readBalance(
  cell: SheetCell | undefined,
  currency: CurrencyCode,
  errors: RowError[],
): Money | undefined {
  if (cell === undefined || cell.kind === 'empty') return undefined

  const parsed = parseAmountCell(cell, currency)
  if (parsed === undefined) {
    errors.push({ role: 'balance', message: `Could not read a balance from "${cell.text}"` })
    return undefined
  }
  return parsed
}

function readDate(
  cell: SheetCell | undefined,
  mapping: DraftMapping,
  role: ColumnRole,
  errors: RowError[],
  label: string,
): LocalDate | undefined {
  if (cell === undefined || cell.kind === 'empty') {
    errors.push({ role, message: `Missing ${label}` })
    return undefined
  }

  const date = parseDateCell(cell, mapping.dateOrders.get(role) ?? 'DMY')
  if (date === undefined) {
    errors.push({ role, message: `Could not read ${label} from "${cell.text}"` })
    return undefined
  }
  return date
}

function readAmount(
  cell: SheetCell | undefined,
  currency: string,
  errors: RowError[],
): Money | undefined {
  if (cell === undefined || cell.kind === 'empty') {
    errors.push({ role: 'amount', message: 'Missing amount' })
    return undefined
  }

  const amount = parseAmountCell(cell, currency)
  if (amount === undefined) {
    errors.push({ role: 'amount', message: `Could not read an amount from "${cell.text}"` })
    return undefined
  }
  return amount
}

function readMerchant(cell: SheetCell | undefined, errors: RowError[]): string | undefined {
  if (cell === undefined || cell.kind === 'empty') {
    errors.push({ role: 'merchant', message: 'Missing merchant' })
    return undefined
  }
  return cell.kind === 'string' ? cell.value : cell.text
}

function readText(cell: SheetCell | undefined): string | undefined {
  if (cell === undefined || cell.kind === 'empty') return undefined
  const value = cell.kind === 'string' ? cell.value : cell.text
  return value.trim() === '' ? undefined : value
}

function readCurrency(cell: SheetCell | undefined): string | undefined {
  return cell === undefined ? undefined : parseCurrencyCell(cell)
}

function readLast4(cell: SheetCell | undefined): string | undefined {
  const text = readText(cell)
  return text === undefined ? undefined : parseCardLast4(text)
}

/**
 * "3 of 12", from whichever columns the file states it in.
 *
 * The two numeric roles win over the text one when both are mapped: a user who
 * pointed at a pair of counter columns has stated something more precise than a
 * sentence a regex has to take apart. Neither real file has the numeric pair —
 * Cal writes `תשלום 3 מתוך 12` into a free-text column — which is exactly why
 * both paths have to exist.
 */
function readInstallmentCounter(
  textCell: SheetCell | undefined,
  sequenceCell: SheetCell | undefined,
  totalCell: SheetCell | undefined,
): { readonly sequence: number; readonly total: number } | undefined {
  const sequence = readCount(sequenceCell)
  const total = readCount(totalCell)
  if (sequence !== undefined && total !== undefined && sequence <= total) {
    return { sequence, total }
  }

  const text = readText(textCell)
  return text === undefined ? undefined : parseInstallmentText(text)
}

/** A payment counter: a whole number of at least one, or nothing. */
function readCount(cell: SheetCell | undefined): number | undefined {
  if (cell === undefined || cell.kind === 'empty') return undefined
  const value = parseNumberCell(cell)
  if (value === undefined || !Number.isInteger(value) || value < 1) return undefined
  return value
}

/**
 * What the "original amount" column is actually stating.
 *
 * The column means two different things depending on the row, and the two are
 * not interchangeable: on a foreign purchase it is the amount in the foreign
 * currency, and on an installment it is the **whole purchase price** in the
 * same currency the slice was charged in. Cal's `סכום עסקה` is the second and
 * matches the same alias, so reading it as a foreign amount records a ₪1,200
 * sofa as a "foreign" ₪1,200 — a currency conversion from shekels to shekels.
 * See D-035.
 *
 * The currency is what separates them, so it is read first: a stated original
 * currency that differs from the charge currency is a conversion, and anything
 * else is not. When the two agree, an amount that differs from the charge is
 * the full purchase; an amount equal to the charge is Max repeating itself on a
 * domestic row and is dropped.
 */
function readOriginal(
  originalCell: SheetCell | undefined,
  currencyCell: SheetCell | undefined,
  rateCell: SheetCell | undefined,
  chargeCurrency: CurrencyCode,
  charged: Money,
): { readonly foreign?: DraftForeignAmount; readonly originalTotal?: Money } {
  if (originalCell === undefined || originalCell.kind === 'empty') return {}

  const originalCurrency = readCurrency(currencyCell) ?? chargeCurrency
  const originalAmount = parseAmountCell(originalCell, originalCurrency)
  if (originalAmount === undefined) return {}

  if (originalCurrency !== chargeCurrency) {
    const exchangeRate = rateCell === undefined ? undefined : parseNumberCell(rateCell)
    return { foreign: { originalAmount, exchangeRate } }
  }

  const total = abs(originalAmount)
  return total.minor === abs(charged).minor ? {} : { originalTotal: total }
}

/**
 * Which way the money went, which is the **sign of the amount** and nothing
 * else.
 *
 * A function rather than a ternary at the one call site, because the review
 * screen types an amount over now (M16 U11) and a row whose direction still
 * described the figure the mapping produced would be an outflow of a positive
 * number. That is not merely incoherent: **`staged_row` and the ledger both
 * refuse it** — "sign and direction must agree, or refunds start inflating
 * spending" (D-004, `003_staged_row.sql`) — so a direction offered as a control
 * beside the amount throws on the first keystroke that disagrees with it. It is
 * derived, and the sign is the gesture.
 *
 * `TRANSFER` is in the vocabulary and is not produced here: nothing about one
 * row of a statement says it is one.
 */
export function directionOf(amount: Money): Direction {
  return amount.minor < 0 ? 'OUTFLOW' : 'INFLOW'
}
