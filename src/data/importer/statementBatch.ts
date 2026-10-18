import type { Database } from 'sql.js'

import type { Money } from '@/core/money.ts'
import { verifyRunningBalance, type BalanceCheck } from '@/domain/bankImport.ts'
import type { Direction as DraftDirection, DraftMapping, DraftTransaction } from '@/domain/model/importing.ts'
import {
  peekAccountForImport,
  resolveAccountForImport,
  type Account,
  type AccountKind,
} from '../repositories/accountRepository.ts'
import { listMappings } from '../repositories/importMappingRepository.ts'
import { acceptAllNew } from '../repositories/stagedRowRepository.ts'
import { accountsHoldingRows, existingNaturalKeys, type RowsHeld } from '../repositories/transactionRepository.ts'
import { allParsed, applyMapping, bankRowsOf, type ParsedRow } from './apply.ts'
import { commitSession, type CommitResult } from './commit.ts'
import { defaultMappingName, statedCardLast4 } from './mappingName.ts'
import { assignNaturalKeys } from './naturalKey.ts'
import { findPrintedTotal, totalsAgree, type PrintedTotal } from './printedTotal.ts'
import type { SheetCell, SheetTable, SheetWorkbook } from './sheetTable.ts'
import { matchSavedMapping } from './signature.ts'
import { stageImport } from './stage.ts'

/**
 * **Statements read in a batch, and written with one Write** — M28 U5.
 *
 * From a review of the screen that followed every statement: *"the screen after
 * adding a sheet of accept all new is redundant and adds too much friction."*
 * It was, given what the screen was for. A row already in the document is
 * recognised by its natural key and can never be imported, accepted or not; so
 * the review's only real jobs were its two checks — the total the file prints
 * for itself, and a bank file's running balance — and a row that failed to read.
 *
 * So a sheet here is **read and judged, nothing written**. One whose checks
 * agree is ticked; one whose checks disagree is the only kind that asks for a
 * look, and what it is shown is the gap and the rows that cause it. A row that
 * failed is fixed by typing what its cell says — a **correction to the cell**,
 * not to the transaction, so the mapping parses it the way it parses every other
 * row and there is no second spelling of what a row means. Write stages each
 * ticked sheet, accepts what is new and commits it, in one go: the same three
 * steps `import_statement` has always taken in a conversation (D-100), which is
 * what keeps the screen and the tool one capability (D-227).
 *
 * **Nothing here writes until `writeSheets`.** The account a sheet goes to is a
 * request until then, because resolving one can create it.
 */

/** Which account a sheet goes to, as `resolveAccountForImport` takes it. */
export interface AccountRequest {
  readonly boundAccountId: string | undefined
  readonly last4: string | undefined
  readonly fallbackName: string
  readonly kind: AccountKind
  /**
   * A person said these rows belong where the request points although another
   * account already holds some of them — *Keep apart* (M28 F11). Absent, an
   * overlap with another account stops the sheet and asks.
   */
  readonly separate?: boolean | undefined
}

export interface StatementSheet {
  /** Unique within a batch: the file's, and the sheet's index after it. */
  readonly id: string
  readonly fileName: string
  readonly fileHash: string
  /** The sheet as the file had it. Corrections are applied over it, never into it. */
  readonly table: SheetTable
  readonly mapping: DraftMapping
  /** The saved mapping that read it, when it was a stored one. */
  readonly mappingId: string | undefined
  readonly account: AccountRequest
  /** Row index → column index → what the cell says, typed by a person. */
  readonly corrections: ReadonlyMap<number, ReadonlyMap<number, string>>
}

/** What reading a workbook came to: sheets a stored reader knows, or a new layout. */
export type WorkbookRead =
  | { readonly kind: 'sheets'; readonly sheets: readonly StatementSheet[] }
  | { readonly kind: 'new-layout' }

/**
 * Every sheet a saved mapping fits **exactly**, read with it.
 *
 * A close match is a new layout here — columns moved is a real question about
 * the file, and the mapper is where it is asked, with the moved columns marked.
 * A sheet nothing fits while another sheet of the same file is read is left
 * alone: a summary sheet beside the transactions is common and is not data.
 */
export function readStatementWorkbook(
  db: Database,
  input: { readonly fileName: string; readonly fileHash: string; readonly workbook: SheetWorkbook; readonly id: string },
): WorkbookRead {
  const candidates = listMappings(db)
  const sheets: StatementSheet[] = []
  input.workbook.sheets.forEach((table, index) => {
    const match = candidates.length === 0 ? undefined : matchSavedMapping(table, candidates)
    if (match === undefined || match.comparison.kind !== 'exact') return
    sheets.push(
      sheetFrom({
        id: `${input.id}:${String(index)}`,
        fileName: input.fileName,
        fileHash: input.fileHash,
        table,
        mapping: match.mapping,
        mappingId: match.candidate.id,
        mappingName: match.candidate.name,
        boundAccountId: match.candidate.accountId,
      }),
    )
  })
  return sheets.length === 0 ? { kind: 'new-layout' } : { kind: 'sheets', sheets }
}

/**
 * A sheet, from a mapping — what the batch reads with a stored one and what the
 * mapper hands back when a person has just drawn one (`kind` is theirs then).
 */
export function sheetFrom(input: {
  readonly id: string
  readonly fileName: string
  readonly fileHash: string
  readonly table: SheetTable
  readonly mapping: DraftMapping
  readonly mappingId: string | undefined
  readonly mappingName: string | undefined
  readonly boundAccountId: string | undefined
  readonly kind?: AccountKind | undefined
}): StatementSheet {
  const rows = applyMapping(input.table, input.mapping)
  const last4 = cardLast4Of(rows, input.fileName, input.table, input.mapping.headerRowIndex)
  const name =
    input.mappingName ??
    defaultMappingName({
      fileName: input.fileName,
      table: input.table,
      headerRowIndex: input.mapping.headerRowIndex,
      cardLast4: last4,
    })
  return {
    id: input.id,
    fileName: input.fileName,
    fileHash: input.fileHash,
    table: input.table,
    mapping: input.mapping,
    mappingId: input.mappingId,
    account: {
      boundAccountId: input.boundAccountId,
      last4,
      fallbackName: accountNameFor(last4, name, input.fileName),
      kind: input.kind ?? guessKind(rows),
    },
    corrections: new Map(),
  }
}

/**
 * Which card a file is for: a mapped column wins, then the number the file
 * states about itself (D-033). Account identity, not decoration.
 */
export function cardLast4Of(
  rows: readonly ParsedRow[],
  fileName: string,
  table: SheetTable,
  headerRowIndex: number,
): string | undefined {
  return allParsed(rows)[0]?.cardLast4 ?? statedCardLast4({ fileName, table, headerRowIndex })
}

/**
 * **A running balance is the tell** (D-070): a bank statement restates the
 * balance on every row and a card statement never does.
 */
export function guessKind(rows: readonly ParsedRow[]): AccountKind {
  return rows.some((row) => row.outcome.kind === 'parsed' && row.outcome.balance !== undefined)
    ? 'BANK'
    : 'CREDIT_CARD'
}

/**
 * What to call the account these rows belong to, when there is no account yet.
 *
 * The last-4 is the identity `findOrCreateAccount` matches on, so a name is
 * only needed when the file states no card number anywhere — and then it is the
 * *mapping's* name, which is stable across months where a file name is not.
 */
export function accountNameFor(last4: string | undefined, mappingName: string, fileName: string): string {
  if (last4 !== undefined) return `Card ${last4}`
  const stem = fileName.replace(/\.[^.]+$/, '')
  return (mappingName.trim() === '' ? stem : mappingName).slice(0, 60)
}

// --- Corrections -----------------------------------------------------------

/** The sheet with every typed correction in its cells. */
export function correctedTable(sheet: StatementSheet): SheetTable {
  if (sheet.corrections.size === 0) return sheet.table
  const rows = sheet.table.rows.map((cells, rowIndex) => {
    const fixes = sheet.corrections.get(rowIndex)
    if (fixes === undefined) return cells
    const width = Math.max(cells.length, ...[...fixes.keys()].map((column) => column + 1))
    return Array.from({ length: width }, (_, column): SheetCell => {
      const typed = fixes.get(column)
      if (typed === undefined) return cells[column] ?? { kind: 'empty', text: '' }
      return typed.trim() === '' ? { kind: 'empty', text: '' } : { kind: 'string', text: typed, value: typed }
    })
  })
  return { ...sheet.table, rows }
}

/** Every row the mapping makes of the sheet, corrections included. */
export function sheetRows(sheet: StatementSheet): readonly ParsedRow[] {
  return applyMapping(correctedTable(sheet), sheet.mapping)
}

/** The sheet with one cell typed over. An empty string clears the correction. */
export function correct(sheet: StatementSheet, rowIndex: number, column: number, text: string): StatementSheet {
  const corrections = new Map(sheet.corrections)
  const row = new Map(corrections.get(rowIndex) ?? [])
  const original = sheet.table.rows[rowIndex]?.[column]?.text ?? ''
  if (text === original) row.delete(column)
  else row.set(column, text)
  if (row.size === 0) corrections.delete(rowIndex)
  else corrections.set(rowIndex, row)
  return { ...sheet, corrections }
}

// --- The verdict -----------------------------------------------------------

/**
 * What a sheet came to, before anything is written.
 *
 * - `ok` — its checks agree, or it prints nothing to check against: ticked.
 * - `same` — every row is already in the document: nothing to write.
 * - `elsewhere` — rows of it are already in **another** account (M28 F11): the
 *   same bank read by a second reader, about to become a second account. It
 *   waits for *Into that account* or *Keep apart*, and is never written quietly.
 * - `gap` — the printed total or the running balance disagrees with the rows,
 *   or nothing in it read at all: it waits for a look and is left out until then.
 *
 * Only `gap` asks anything, which is the whole of that ask.
 */
export interface SheetVerdict {
  readonly state: 'ok' | 'same' | 'gap' | 'elsewhere'
  readonly rows: readonly ParsedRow[]
  readonly parsed: number
  readonly newRows: number
  readonly duplicates: number
  readonly failed: readonly ParsedRow[]
  readonly printed: PrintedTotal | undefined
  /** One per currency, as magnitudes — a file with two sections prints two totals. */
  readonly parsedTotals: readonly Money[]
  /** `undefined` when the file prints no total: unchecked, not agreed (D-149). */
  readonly reconciles: boolean | undefined
  readonly balance: BalanceCheck
  /** The account it would go to, when that is already known. */
  readonly accountId: string | undefined
  /** That account's name, or the name a new one would get. */
  readonly accountName: string
  /**
   * The file earlier in the batch that makes the new account this sheet goes to
   * as well (M28 F15) — one account, made once, by whichever is written first.
   */
  readonly madeBy: string | undefined
  /** The other account holding most of its rows, when one holds enough to say so. */
  readonly elsewhere: Elsewhere | undefined
}

/**
 * **Where the batch has sent rows so far** — M28 F15.
 *
 * Four exports were added at once, and the accounts the first two were
 * about to make were nowhere for the next two: not in the mapper's *Into*, and
 * not something their rows could be found in, because both looked only at what
 * the document already held. Two passes, where one should do. So every sheet
 * the batch is going to write leaves its rows here, under the account they go
 * to — a real one by its id, or the one its request will make — and every sheet
 * after it is judged against this as well as the document.
 */
export interface PendingAccount {
  /** The account's id, or `new:` and what `findOrCreateAccount` will match it by. */
  readonly key: string
  /** Set when the account exists; a pending *new* account has none until Write. */
  readonly accountId: string | undefined
  readonly name: string
  readonly last4: string | undefined
  /** The request that makes it — what a later sheet copies to land on it. */
  readonly request: AccountRequest
  /** The first file going there. */
  readonly madeBy: string
  /** Rows on their way there and not in the document yet, by natural key. */
  readonly rows: ReadonlyMap<string, DraftDirection>
}

/**
 * Another account holding rows of a sheet: one the document has, or — when
 * `request` is set — one a sheet earlier in the batch is about to make.
 */
export interface Elsewhere {
  readonly key: string
  readonly accountId: string | undefined
  readonly accountName: string
  readonly last4: string | undefined
  readonly rows: number
  /** The pending account's request, which *Into* copies. */
  readonly request?: AccountRequest | undefined
  /** The file that sends the rows there, when they are not written yet. */
  readonly madeBy?: string | undefined
}

/** Where a request lands, and what it already finds there. */
export interface Placement {
  /** The account the document already has for it, if any. */
  readonly account: Account | undefined
  readonly key: string
  /** The pending account the batch already sends rows to under the same key. */
  readonly joins: PendingAccount | undefined
  readonly duplicates: number
  /** The rows not already where they are going — what writing would add. */
  readonly fresh: readonly { readonly key: string; readonly direction: DraftDirection }[]
  readonly elsewhere: Elsewhere | undefined
}

/**
 * What `resolveAccountForImport` will match a request by when it makes an
 * account: the last-4 when there is one, the name otherwise — so two requests
 * with one key are one account, made by whichever is written first.
 */
export function newAccountKey(request: { readonly last4: string | undefined; readonly fallbackName: string }): string {
  return request.last4 === undefined ? `new:@${request.fallbackName}` : `new:#${request.last4}`
}

/**
 * Where a sheet's rows land, judged against the document **and** the batch so
 * far: the rows already there are duplicates, and the account most of the rest
 * are already in, here or on their way, is where they may belong instead.
 */
export function placeRows(
  db: Database,
  request: { readonly boundAccountId: string | undefined; readonly last4: string | undefined; readonly fallbackName: string },
  drafts: readonly DraftTransaction[],
  soFar: readonly PendingAccount[] = [],
): Placement {
  const account = peekAccountForImport(db, request)
  const key = account?.id ?? newAccountKey(request)
  const joins = soFar.find((pending) => pending.key === key)
  const already = account === undefined ? new Set<string>() : existingNaturalKeys(db, account.id)
  const keys = assignNaturalKeys(drafts)
  const isDuplicate = (naturalKey: string): boolean => already.has(naturalKey) || joins?.rows.has(naturalKey) === true
  const duplicates = keys.filter(isDuplicate).length
  const fresh = keys.flatMap((naturalKey, index) => {
    const draft = drafts[index]
    return draft === undefined || isDuplicate(naturalKey) ? [] : [{ key: naturalKey, direction: draft.direction }]
  })

  // The document's accounts and the batch's, counted together: a row is in one
  // or the other, because the batch keeps only rows the document does not hold.
  const held = new Map<string, Elsewhere>()
  for (const found of accountsHoldingRows(db, fresh, account?.id)) held.set(found.accountId, { ...found, key: found.accountId })
  for (const pending of soFar) {
    if (pending.key === key) continue
    const rows = fresh.filter((row) => pending.rows.get(row.key) === row.direction).length
    if (rows === 0) continue
    const before = held.get(pending.key)
    held.set(
      pending.key,
      before !== undefined
        ? { ...before, rows: before.rows + rows }
        : {
            key: pending.key,
            accountId: pending.accountId,
            accountName: pending.name,
            last4: pending.last4,
            rows,
            request: pending.accountId === undefined ? pending.request : undefined,
            madeBy: pending.madeBy,
          },
    )
  }
  const top = [...held.values()].sort((a, b) => b.rows - a.rows)[0]
  const elsewhere = top !== undefined && top.rows >= Math.min(2, drafts.length) ? top : undefined
  return { account, key, joins, duplicates, fresh, elsewhere }
}

export function judgeSheet(db: Database, sheet: StatementSheet, soFar: readonly PendingAccount[] = []): SheetVerdict {
  return judged(db, sheet, soFar).verdict
}

function judged(
  db: Database,
  sheet: StatementSheet,
  soFar: readonly PendingAccount[],
): { readonly verdict: SheetVerdict; readonly placement: Placement } {
  const rows = sheetRows(sheet)
  const drafts = allParsed(rows)
  const placement = placeRows(db, sheet.account, drafts, soFar)
  const { account, duplicates, elsewhere } = placement
  const failed = rows.filter((row) => row.outcome.kind === 'error')

  const lastDataRowIndex = rows.reduce(
    (last, row) => (row.outcome.kind === 'parsed' ? row.rowIndex : last),
    sheet.mapping.dataStartRowIndex,
  )
  const printed = findPrintedTotal(correctedTable(sheet), {
    headerRowIndex: sheet.mapping.headerRowIndex,
    lastDataRowIndex,
    currency: sheet.mapping.defaultCurrency,
  })
  const parsedTotals = totalsOf(rows)
  const reconciles =
    printed === undefined ? undefined : parsedTotals.some((total) => totalsAgree(printed.amount, total))
  const balance = verifyRunningBalance(bankRowsOf(rows))

  const newRows = drafts.length - duplicates
  const state =
    elsewhere !== undefined && sheet.account.separate !== true
      ? 'elsewhere'
      : drafts.length === 0 || reconciles === false || balance.kind === 'DIVERGED'
      ? 'gap'
      : newRows === 0
        ? 'same'
        : 'ok'

  return {
    placement,
    verdict: {
      state,
      rows,
      parsed: drafts.length,
      newRows,
      duplicates,
      failed,
      printed,
      parsedTotals,
      reconciles,
      balance,
      accountId: account?.id,
      accountName: account?.name ?? sheet.account.fallbackName,
      madeBy: account === undefined ? placement.joins?.madeBy : undefined,
      elsewhere,
    },
  }
}

/**
 * **A batch judged in its order, each sheet against the ones before it** —
 * M28 F15. `writes` is a person's say on a sheet given its verdict (ticked,
 * forced); only a sheet that will be written sends rows anywhere. What comes
 * back is every verdict and where the batch sends rows — which is also what
 * the mapper offers a file still on its way in.
 */
export function judgeBatch(
  db: Database,
  sheets: readonly { readonly id: string; readonly sheet: StatementSheet }[],
  writes: (id: string, verdict: SheetVerdict) => boolean,
): { readonly verdicts: ReadonlyMap<string, SheetVerdict>; readonly pending: readonly PendingAccount[] } {
  const verdicts = new Map<string, SheetVerdict>()
  let pending: readonly PendingAccount[] = []
  for (const { id, sheet } of sheets) {
    const { verdict, placement } = judged(db, sheet, pending)
    verdicts.set(id, verdict)
    if (writes(id, verdict)) pending = sendRows(pending, placement, sheet)
  }
  return { verdicts, pending }
}

/** The batch with a sheet's fresh rows on their way to where it lands. */
function sendRows(pending: readonly PendingAccount[], placement: Placement, sheet: StatementSheet): readonly PendingAccount[] {
  const rows = new Map(placement.joins?.rows ?? [])
  for (const row of placement.fresh) rows.set(row.key, row.direction)
  const joins = placement.joins
  if (joins !== undefined) return pending.map((each) => (each === joins ? { ...each, rows } : each))
  const request: AccountRequest = { ...sheet.account, separate: undefined }
  return [
    ...pending,
    {
      key: placement.key,
      accountId: placement.account?.id,
      name: placement.account?.name ?? sheet.account.fallbackName,
      last4: placement.account?.last4 ?? sheet.account.last4,
      request,
      madeBy: sheet.fileName,
      rows,
    },
  ]
}

/**
 * The other account a sheet's rows are already in, when enough are to mean it:
 * two rows, or every row of a file that has fewer. One coincidence — the same
 * coffee, the same day, on two cards — is not an account.
 */
export function overlapElsewhere(
  db: Database,
  rows: readonly { readonly key: string; readonly direction: DraftDirection }[],
  parsed: number,
  except: string | undefined,
): RowsHeld | undefined {
  const top = accountsHoldingRows(db, rows, except)[0]
  return top !== undefined && top.rows >= Math.min(2, parsed) ? top : undefined
}

/**
 * The sheet sent to the account that already holds its rows — *Into Everyday Bank*.
 * An account the batch is about to make is joined by taking its request, so
 * both resolve to the one account whichever is written first (M28 F15).
 */
export function pointAt(
  sheet: StatementSheet,
  held: Pick<Elsewhere, 'accountId' | 'last4' | 'request'>,
): StatementSheet {
  if (held.accountId === undefined) {
    return held.request === undefined ? sheet : { ...sheet, account: { ...held.request, separate: undefined } }
  }
  return {
    ...sheet,
    account: { ...sheet.account, boundAccountId: held.accountId, last4: held.last4 ?? sheet.account.last4, separate: undefined },
  }
}

/** The sheet kept where it was going, overlap and all — *Keep apart*. */
export function keepApart(sheet: StatementSheet): StatementSheet {
  return { ...sheet, account: { ...sheet.account, separate: true } }
}

/** Magnitudes per currency, the shape the printed total is compared with. */
function totalsOf(rows: readonly ParsedRow[]): readonly Money[] {
  const byCurrency = new Map<string, number>()
  for (const draft of allParsed(rows)) {
    byCurrency.set(draft.amount.currency, (byCurrency.get(draft.amount.currency) ?? 0) + Math.abs(draft.amount.minor))
  }
  return [...byCurrency].map(([currency, minor]) => ({ minor, currency }))
}

// --- Write -----------------------------------------------------------------

export interface WrittenSheet {
  readonly sheet: StatementSheet
  readonly result: CommitResult
}

/**
 * Write the sheets: each staged, its new rows accepted, and committed — the
 * pipeline `import_statement` runs (D-100), so rules categorise on commit and a
 * row already here is left out on its own.
 *
 * `force` is a sheet somebody chose to write although its running balance
 * disagrees — *Write anyway* on the screen that showed them the gap. A printed
 * total that disagrees never blocked a commit; the balance did, and forcing it
 * is that same override, said where the gap was shown.
 *
 * The caller wraps this in one `mutate`, so it is one write of the document.
 */
export function writeSheets(
  db: Database,
  sheets: readonly { readonly sheet: StatementSheet; readonly force: boolean }[],
  now: number,
): readonly WrittenSheet[] {
  return sheets.map(({ sheet, force }) => {
    const account = resolveAccountForImport(db, sheet.account, now)
    const staged = stageImport(
      db,
      {
        accountId: account.id,
        fileName: sheet.fileName,
        fileHash: sheet.fileHash,
        sheetName: sheet.table.name,
        mappingId: sheet.mappingId,
        rows: sheetRows(sheet),
        table: correctedTable(sheet),
        headerRowIndex: sheet.mapping.headerRowIndex,
        currency: sheet.mapping.defaultCurrency,
      },
      now,
    )
    acceptAllNew(db, staged.sessionId, now)
    return { sheet, result: commitSession(db, staged.sessionId, now, { ignoreBalanceCheck: force }) }
  })
}

/** The months the rows of a sheet fall in, on the date money left the account. */
export function monthsOf(rows: readonly ParsedRow[]): readonly string[] {
  const months = new Set<string>()
  for (const draft of allParsed(rows)) {
    const date = draft.chargeDate ?? draft.transactionDate
    months.add(`${String(date.year)}-${String(date.month).padStart(2, '0')}`)
  }
  return [...months].sort()
}
