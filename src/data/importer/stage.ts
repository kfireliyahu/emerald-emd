/**
 * Staging an import: pipeline steps 10 and 12 of
 * docs/f01-card-statement-import.md.
 *
 * Every row of the file — parsed, failed or skipped — is classified and written
 * to the staging area, and the session is left at `AWAITING_REVIEW`. Nothing
 * reaches the ledger here. That separation is what makes the review screen
 * possible and what makes an import survive the tab closing.
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { localDate, yearMonthOf, type LocalDate } from '@/core/time.ts'
import { firstMatch } from '@/domain/categorization.ts'
import { verifyRunningBalance } from '@/domain/bankImport.ts'
import type { DraftTransaction, StagedRowStatus } from '@/domain/model/importing.ts'
import type { CategoryRule } from '@/domain/model/rules.ts'
import { inTransaction } from '../db/database.ts'
import { loadRules } from '../repositories/ruleSetRepository.ts'
import {
  createSession,
  setBalanceCheck,
  setCoverage,
  setPrintedTotal,
  setSessionCounts,
} from '../repositories/importSessionRepository.ts'
import { insertStagedRows, type InsertableStagedRow } from '../repositories/stagedRowRepository.ts'
import { existingNaturalKeys } from '../repositories/transactionRepository.ts'
import { bankRowsOf, type ParsedRow } from './apply.ts'
import { assignNaturalKeys } from './naturalKey.ts'
import { findPrintedPeriod, spanOf } from './printedPeriod.ts'
import { findPrintedTotal, type PrintedTotal } from './printedTotal.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

export interface StageRequest {
  readonly accountId: string
  readonly fileName: string
  readonly fileHash: string
  readonly sheetName: string
  /** The saved mapping that parsed this file, when the mapping used was a stored one. */
  readonly mappingId?: string | undefined
  /** Every row the mapping produced, in sheet order — not only the ones that parsed. */
  readonly rows: readonly ParsedRow[]
  /**
   * The sheet, so the total it prints for itself can be found and recorded.
   * Optional: the check is a help, not a precondition, and a caller without a
   * sheet in hand should still be able to stage.
   */
  readonly table?: SheetTable | undefined
  readonly headerRowIndex?: number | undefined
  readonly currency?: string | undefined
}

export interface StageResult {
  readonly sessionId: string
  readonly total: number
  readonly newRows: number
  readonly duplicates: number
  readonly failed: number
  readonly skipped: number
}

/**
 * Write a parsed file into the staging area as one session.
 *
 * One SQL transaction, so a failure half-way cannot leave half a statement
 * staged and a session claiming to be reviewable.
 */
export function stageImport(db: Database, request: StageRequest, now: number): StageResult {
  const sessionId = newId()
  const alreadyPresent = existingNaturalKeys(db, request.accountId)

  // The document's rules and the built-ins the app ships, loaded once for the
  // whole file. The engine is pure, so the answer for a row depends on nothing
  // but the row and these rules — and a rule the user edits while a review is
  // open does not retroactively change a session they are half-way through
  // reading (D-038).
  const rules = loadRules(db)

  // Natural keys are assigned over the whole batch, because the collision
  // counter that separates two genuinely identical same-day purchases is only
  // meaningful across the file. Keyed by row index so a failed row in the
  // middle does not shift everything after it.
  const parsed = request.rows.filter(
    (row): row is ParsedRow & { outcome: { kind: 'parsed'; transaction: DraftTransaction } } =>
      row.outcome.kind === 'parsed',
  )
  const keys = assignNaturalKeys(parsed.map((row) => row.outcome.transaction))
  const keyByRowIndex = new Map(parsed.map((row, index) => [row.rowIndex, keys[index] ?? '']))

  let newRows = 0
  let duplicates = 0
  let failed = 0
  let skipped = 0

  inTransaction(db, () => {
    createSession(
      db,
      {
        id: sessionId,
        accountId: request.accountId,
        mappingId: request.mappingId,
        fileName: request.fileName,
        fileHash: request.fileHash,
        sheetName: request.sheetName,
      },
      now,
    )

    const staged: InsertableStagedRow[] = []
    for (const row of request.rows) {
      const transaction = row.outcome.kind === 'parsed' ? row.outcome.transaction : undefined
      const naturalKey = keyByRowIndex.get(row.rowIndex)
      const status = classify(row, naturalKey, alreadyPresent)
      const suggestion = suggest(rules, transaction, request.accountId)

      if (status === 'NEW') newRows += 1
      else if (status === 'PARSE_ERROR') failed += 1
      else if (status === 'SKIPPED') skipped += 1
      else duplicates += 1

      staged.push({
          id: newId(),
          sessionId,
          rowIndex: row.rowIndex,
          rawCells: row.cells.map(cellText),
          status,
          decision: 'PENDING',
          errorMessage: describe(row),
          suggestedCategoryId: suggestion?.targetCategoryId,
          suggestedRuleId: suggestion?.id,
          chosenCategoryId: undefined,
          transaction,
          naturalKey,
          // Derived from the charge date for now. The account's billing day and
          // the statement preamble are the earlier attempts in docs/05, and
          // neither is collected yet.
          billingPeriod:
            transaction === undefined
              ? undefined
              : yearMonthOf(transaction.chargeDate ?? transaction.transactionDate),
      })
    }
    insertStagedRows(db, staged, now)

    setSessionCounts(db, sessionId, { total: request.rows.length, newRows, duplicates, failed }, now)
    setPrintedTotal(db, sessionId, printedTotalOf(request), now)
    // Every row the file read, duplicates included: the days it covers are the
    // file's, and an overlap dropped at commit takes none of them away (M28 F26).
    const rows = spanOf(parsed.map((row) => row.outcome.transaction.transactionDate))
    const printed =
      request.table === undefined || request.headerRowIndex === undefined
        ? undefined
        : findPrintedPeriod(request.table, request.headerRowIndex, rows, dayOf(now))
    setCoverage(db, sessionId, { rows, printed }, now)
    // Run here for the reason the printed total is: by review time the sheet is
    // gone, and this one has a second reason of its own — the check is about
    // the *file's own order*, which the staging area does not preserve and the
    // ledger certainly does not. It can only ever be asked once (D-063).
    setBalanceCheck(db, sessionId, verifyRunningBalance(bankRowsOf(request.rows)), now)
  })

  return { sessionId, total: request.rows.length, newRows, duplicates, failed, skipped }
}

/**
 * What the rules make of one row, or nothing.
 *
 * A row that did not parse has no merchant and no amount to match on, so it is
 * not offered to the engine at all. A duplicate is: the user can still see what
 * the row would have been categorized as, and a suggestion on a row that never
 * commits costs nothing.
 *
 * Only the suggestion is written. Nothing here decides anything — the review
 * screen shows it in the same picker a manual choice goes into, and the commit
 * is where it becomes a category (D-038, and "nothing is auto-anything" in
 * docs/conventions.md).
 */
function suggest(
  rules: readonly CategoryRule[],
  transaction: DraftTransaction | undefined,
  accountId: string,
): CategoryRule | undefined {
  if (transaction === undefined || rules.length === 0) return undefined

  return firstMatch(rules, {
    merchantNormalized: transaction.merchantNormalized,
    providerCategory: transaction.providerCategory,
    amount: transaction.amount,
    accountId,
  })
}

/**
 * The total the file states for itself, recorded once at stage time.
 *
 * Scanned here rather than on the review screen because by then the sheet is
 * gone — a resumed import has rows in the document and no file in memory.
 */
function printedTotalOf(request: StageRequest): PrintedTotal | undefined {
  const { table, headerRowIndex } = request
  if (table === undefined || headerRowIndex === undefined) return undefined

  const parsed = request.rows.filter((row) => row.outcome.kind === 'parsed')
  const lastDataRowIndex = parsed[parsed.length - 1]?.rowIndex ?? headerRowIndex

  return findPrintedTotal(table, {
    headerRowIndex,
    lastDataRowIndex,
    currency: request.currency ?? 'ILS',
  })
}

function classify(
  row: ParsedRow,
  naturalKey: string | undefined,
  alreadyPresent: ReadonlySet<string>,
): StagedRowStatus {
  if (row.outcome.kind === 'error') return 'PARSE_ERROR'
  if (row.outcome.kind === 'skipped') return 'SKIPPED'
  if (naturalKey !== undefined && alreadyPresent.has(naturalKey)) return 'DUPLICATE_EXACT'
  return 'NEW'
}

/**
 * The row-scoped explanation, kept for the review screen.
 *
 * A skipped row gets one too. "Blank row" and "no amount or merchant" are the
 * difference between a mapping that ended where the data ended and one that
 * quietly stopped reading half-way, and the user cannot tell which without
 * being told.
 */
function describe(row: ParsedRow): string | undefined {
  if (row.outcome.kind === 'error') {
    return row.outcome.errors.map((error) => error.message).join('; ')
  }
  if (row.outcome.kind === 'skipped') return row.outcome.reason
  return undefined
}

/** The cell as the file displayed it. Never trimmed — stray marks are the point. */
function cellText(cell: SheetCell): string {
  return cell.kind === 'empty' ? '' : cell.text
}

/** The local day an instant falls on — the day the file was read. */
function dayOf(now: number): LocalDate {
  const at = new Date(now)
  return localDate(at.getFullYear(), at.getMonth() + 1, at.getDate())
}
