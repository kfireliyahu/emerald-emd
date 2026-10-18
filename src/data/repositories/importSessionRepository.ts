/**
 * Import sessions in and out of SQLite.
 *
 * A session is the unit an import can be resumed or abandoned as. It is created
 * at `AWAITING_REVIEW` by `stageImport` and moves to `COMMITTED` or `CANCELLED`
 * by the user's decision — never on its own, because nothing here is
 * auto-anything (docs/conventions.md).
 *
 * **A session is a row of the pack's `statement`** since M25 U3 (D-275): the
 * header of the file, which every transaction it wrote links to. The name
 * stays here because the importer's own word for it is a session.
 */

import type { Database } from 'sql.js'

import { money, type Money } from '@/core/money.ts'
import { toISODate, type LocalDate } from '@/core/time.ts'
import type { BalanceCheck } from '@/domain/bankImport.ts'
import { query } from '../db/database.ts'
import type { DateSpan } from '../importer/printedPeriod.ts'
import { declared, instantOf, millisOf } from '../packs/ledger/tables.ts'
import { insertRows, updateRow } from './formatRowRepository.ts'

export type ImportSessionStatus =
  | 'PARSING'
  | 'AWAITING_REVIEW'
  | 'COMMITTED'
  | 'CANCELLED'
  | 'FAILED'

export interface ImportSession {
  readonly id: string
  readonly accountId: string
  readonly accountName: string
  readonly mappingId: string | undefined
  readonly fileName: string
  readonly fileHash: string
  readonly sheetName: string | undefined
  readonly rowCountTotal: number
  readonly rowCountNew: number
  readonly rowCountDuplicate: number
  readonly rowCountFailed: number
  readonly status: ImportSessionStatus
  readonly committedAt: number | undefined
  readonly createdAt: number
  /** The total the file printed for itself, when it printed one. */
  readonly printedTotal: PrintedTotalRecord | undefined
  /**
   * What the running balance said about the parse (F06). Undefined for every
   * card import ever made, and for a bank file whose mapping reads no balance
   * column — which is a different fact from a check that ran and failed.
   */
  readonly balanceCheck: BalanceCheck | undefined
}

export interface PrintedTotalRecord {
  readonly amount: Money
  /** The text it was read out of, so the user can check the claim against the file. */
  readonly text: string
  readonly sourceRowRef: string
}

/** What `stageImport` opens a session with. */
export interface NewSession {
  readonly id: string
  readonly accountId: string
  readonly mappingId: string | undefined
  readonly fileName: string
  readonly fileHash: string
  readonly sheetName: string | undefined
}

/** A session, opened at `AWAITING_REVIEW` with nothing counted yet. */
export function createSession(db: Database, session: NewSession, now: number): void {
  insertRows(
    db,
    declared(db, 'statement'),
    [
      {
        file_name: session.fileName,
        account: session.accountId,
        file_hash: session.fileHash,
        sheet_name: session.sheetName ?? null,
        mapping: session.mappingId ?? null,
        status: 'AWAITING_REVIEW',
        rows_total: 0,
        rows_new: 0,
        rows_duplicate: 0,
        rows_failed: 0,
        started: instantOf(now),
      },
    ],
    [session.id],
  )
}

/**
 * Record what `verifyRunningBalance` made of the file, once, at stage time.
 *
 * Stored as JSON for the reason migration `016` gives: it is a discriminated
 * union read whole by one strip, and nothing queries it. Written even when the
 * answer is `UNAVAILABLE`, because "no balance column" and "this session
 * predates the check" are different things to tell the user.
 */
export function setBalanceCheck(
  db: Database,
  sessionId: string,
  check: BalanceCheck | undefined,
  _now: number,
): void {
  updateRow(db, declared(db, 'statement'), sessionId, {
    balance_check: check === undefined ? null : JSON.stringify(check),
  })
}

/**
 * The recorded check, or nothing.
 *
 * Defensive to the point of paranoia about the shape, because the document is a
 * real SQLite file the user can edit by hand and a mangled value must read as
 * "no check was recorded" rather than crash the screen that blocks on it —
 * failing *open* here is correct, since the same state is what every card
 * import has.
 */
function toBalanceCheck(row: Record<string, unknown>): BalanceCheck | undefined {
  const raw = row['balance_check']
  if (raw == null) return undefined

  try {
    const parsed: unknown = JSON.parse(String(raw))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const kind = (parsed as { kind?: unknown }).kind
    if (kind !== 'UNAVAILABLE' && kind !== 'VERIFIED' && kind !== 'DIVERGED') return undefined
    return parsed as BalanceCheck
  } catch {
    return undefined
  }
}

/**
 * The days the file covers, recorded once at stage time (M28 F26): the span of
 * every row it read and the period it printed, when it printed one that holds.
 *
 * Its committed rows are not the same thing. A statement overlapping one read
 * before it loses the shared days as duplicates, and its own transactions then
 * end days before the statement does — while its closing balance is still the
 * balance on its last row's day.
 */
export function setCoverage(
  db: Database,
  sessionId: string,
  coverage: { readonly rows: DateSpan | undefined; readonly printed: DateSpan | undefined },
  _now: number,
): void {
  const iso = (date: LocalDate | undefined) => (date === undefined ? null : toISODate(date))
  updateRow(db, declared(db, 'statement'), sessionId, {
    covers_from: iso(coverage.rows?.from),
    covers_to: iso(coverage.rows?.to),
    printed_from: iso(coverage.printed?.from),
    printed_to: iso(coverage.printed?.to),
  })
}

export function setPrintedTotal(
  db: Database,
  sessionId: string,
  total: PrintedTotalRecord | undefined,
  _now: number,
): void {
  updateRow(db, declared(db, 'statement'), sessionId, {
    printed_total_minor: total?.amount.minor ?? null,
    printed_total_currency: total?.amount.currency ?? null,
    printed_total_text: total?.text ?? null,
    printed_total_source: total?.sourceRowRef ?? null,
  })
}

const SELECT = `SELECT s.*, a.name AS account_name
                  FROM fmt_statement s
                  JOIN fmt_account a ON a.id = s.account`

export function findSession(db: Database, sessionId: string): ImportSession | undefined {
  return query(db, `${SELECT} WHERE s.id = ?`, [sessionId]).map(toDomain)[0]
}

/**
 * The statement this exact file was committed as to this account, if it was —
 * a file with no sheets, which is what a statement a conversation read is (M30 U6).
 */
export function findCommittedFile(db: Database, accountId: string, fileHash: string): ImportSession | undefined {
  return query(db, `${SELECT} WHERE s.account = ? AND s.file_hash = ? AND s.sheet_name IS NULL AND s.status = 'COMMITTED'`, [
    accountId,
    fileHash,
  ]).map(toDomain)[0]
}

export function setSessionStatus(
  db: Database,
  sessionId: string,
  status: ImportSessionStatus,
  now: number,
): void {
  updateRow(db, declared(db, 'statement'), sessionId, {
    status,
    ...(status === 'COMMITTED' ? { committed: instantOf(now) } : {}),
  })
}

export function setSessionCounts(
  db: Database,
  sessionId: string,
  counts: {
    readonly total: number
    readonly newRows: number
    readonly duplicates: number
    readonly failed: number
  },
  _now: number,
): void {
  updateRow(db, declared(db, 'statement'), sessionId, {
    rows_total: counts.total,
    rows_new: counts.newRows,
    rows_duplicate: counts.duplicates,
    rows_failed: counts.failed,
  })
}

function toDomain(row: Record<string, unknown>): ImportSession {
  const text = (key: string): string | undefined => {
    const value = row[key]
    return value === null || value === undefined ? undefined : String(value)
  }

  return {
    id: String(row['id']),
    accountId: String(row['account']),
    accountName: String(row['account_name']),
    mappingId: text('mapping'),
    fileName: String(row['file_name']),
    fileHash: String(row['file_hash']),
    sheetName: text('sheet_name'),
    rowCountTotal: Number(row['rows_total'] ?? 0),
    rowCountNew: Number(row['rows_new'] ?? 0),
    rowCountDuplicate: Number(row['rows_duplicate'] ?? 0),
    rowCountFailed: Number(row['rows_failed'] ?? 0),
    status: String(row['status']) as ImportSessionStatus,
    committedAt: millisOf(row['committed']),
    createdAt: millisOf(row['started']) ?? 0,
    printedTotal: toPrintedTotal(row),
    balanceCheck: toBalanceCheck(row),
  }
}

function toPrintedTotal(row: Record<string, unknown>): PrintedTotalRecord | undefined {
  const minor = row['printed_total_minor']
  const currency = row['printed_total_currency']
  // Both or neither. "The file did not say" is a different fact from "the file
  // said zero", and a half-written record must not be read as either.
  if (typeof minor !== 'number' || currency == null) return undefined

  return {
    amount: money(minor, String(currency)),
    text: row['printed_total_text'] == null ? '' : String(row['printed_total_text']),
    sourceRowRef: row['printed_total_source'] == null ? '' : String(row['printed_total_source']),
  }
}
