import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { reaimBucketLink, unaimBuckets } from './splitPlanRepository.ts'

/**
 * A card, a bank account, cash — or, since M30 U1, **an account that holds
 * things** (D-354): a broker, a savings account, whose cash buys what it holds.
 *
 * `HOLDINGS` is a kind of its own, stored as itself since M36 U09 — the pack
 * rebuilds an older document's list to take it. Every statement query that
 * asks for `kind = 'BANK'` leaves it out, so a broker's rows are never scanned
 * for card charges or a salary.
 */
export type AccountKind = 'CREDIT_CARD' | 'BANK' | 'CASH' | 'HOLDINGS'

/** The kinds, in the order a picker offers them. */
export const ACCOUNT_KINDS: readonly AccountKind[] = ['CREDIT_CARD', 'BANK', 'CASH', 'HOLDINGS']

/**
 * The kind of place an account's own row reads as: cash is cash, an account
 * with holdings is an investment account, and the rest are current accounts.
 */
export function placeKindOf(kind: AccountKind | undefined): 'CASH' | 'INVESTMENT' | 'CHECKING' {
  return kind === 'CASH' ? 'CASH' : kind === 'HOLDINGS' ? 'INVESTMENT' : 'CHECKING'
}

export interface Account {
  readonly id: string
  readonly name: string
  readonly kind: AccountKind
  readonly last4: string | undefined
  readonly institutionId: string | undefined
  /**
   * The remembered answer to "should I ignore this card's monthly charge in the
   * bank statement?" (F06). **`undefined` is a third state** — not yet asked,
   * which prompts, as against `false`, which is an answer and must never prompt
   * again (D-061).
   */
  readonly excludeSettlementsFromStats: boolean | undefined
  readonly isArchived: boolean
}

export interface NewAccount {
  readonly name: string
  readonly kind: AccountKind
  readonly last4?: string | undefined
  readonly institutionId?: string | undefined
}

const SELECT = `SELECT id, name, kind, last4, institution AS institution_id, is_archived,
                       exclude_settlements_from_stats
                  FROM fmt_account
                 WHERE 1 = 1`

/**
 * The accounts, cards first and then by name.
 *
 * Archived accounts are out by default — that is what archiving is for, and
 * every picker in the app calls this. The accounts screen asks for them so it can
 * bring one back, and `findAccountByLast4` asks for them because identity does
 * not stop mattering when a card is put away.
 */
export function listAccounts(
  db: Database,
  options: { readonly includeArchived?: boolean } = {},
): readonly Account[] {
  return query(
    db,
    `${SELECT} AND (is_archived = 0 OR ? = 1)
      ORDER BY CASE kind WHEN 'CREDIT_CARD' THEN 0 WHEN 'BANK' THEN 1 ELSE 2 END, name`,
    [options.includeArchived === true ? 1 : 0],
  ).map(decode)
}

export function findAccountById(db: Database, id: string): Account | undefined {
  return query(db, `${SELECT} AND id = ?`, [id]).map(decode)[0]
}

/**
 * The account carrying this card number, archived ones included.
 *
 * Archived ones included deliberately: the last-4 is the card's identity (D-014,
 * D-033), and the natural-key uniqueness that makes an import idempotent is
 * `(account_id, natural_key)`. Skipping an archived match would create a second
 * account for one card, which is exactly the split D-033 fixed — only reachable
 * through the archive button the accounts screen adds.
 */
export function findAccountByLast4(db: Database, last4: string): Account | undefined {
  return query(db, `${SELECT} AND last4 = ? ORDER BY is_archived`, [last4]).map(decode)[0]
}

export function createAccount(db: Database, account: NewAccount, _now: number): Account {
  const id = newId()
  db.run(
    `INSERT INTO fmt_account (id, name, kind, last4, institution, is_archived)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [id, account.name, account.kind, account.last4 ?? null, account.institutionId ?? null],
  )
  ensureOwnCash(db, id)
  return {
    id,
    name: account.name,
    kind: account.kind,
    last4: account.last4,
    institutionId: account.institutionId,
    excludeSettlementsFromStats: undefined,
    isArchived: false,
  }
}

/**
 * The account a file belongs to, created on the spot if this is the first time.
 *
 * Onboarding (F12) is where accounts are properly created, and where the user is
 * asked which card a file is for. This is still the path for a statement dropped
 * on a document that was never onboarded, and for a card that was skipped: the
 * last-4 is the identifier that makes "the same card" mean something across
 * files (D-014, D-033).
 *
 * A match that was archived comes back. A statement is evidence the card is in
 * use, and importing into a hidden account is worse than either alternative.
 */
export function findOrCreateAccount(db: Database, account: NewAccount, now: number): Account {
  const match = findAccountFor(db, account)

  if (match === undefined) return createAccount(db, account, now)
  return match.isArchived ? unarchive(db, match, now) : match
}

/**
 * The account an incoming file belongs to, given everything known about it.
 *
 * The order matters, and it is the whole of D-033 plus the binding F12 adds:
 *
 * 1. **The number the file states** wins. It is a fact about this file, and
 *    identity resting on it is what makes two statements of one card one account.
 * 2. **The mapping's bound account** answers when the file states nothing. A
 *    mapping is matched by header signature, so it is stable across months —
 *    which is exactly what a file name is not.
 * 3. Otherwise the name, which is the mapping's, not the file's.
 *
 * The interesting case is a bound account with no card number and a file that
 * states one: the binding says *which* account, and the file supplies the number
 * that account was missing. Adopting it there beats creating a second account for
 * a card the user has already told us about. A bound account whose number
 * disagrees with the file is a different card, and the file wins.
 */
export function resolveAccountForImport(
  db: Database,
  request: {
    readonly boundAccountId: string | undefined
    readonly last4: string | undefined
    readonly fallbackName: string
    readonly kind: AccountKind
  },
  now: number,
): Account {
  const bound =
    request.boundAccountId === undefined ? undefined : findAccountById(db, request.boundAccountId)

  if (bound !== undefined) {
    const live = bound.isArchived ? unarchive(db, bound, now) : bound
    if (request.last4 === undefined) return live
    if (live.last4 === undefined) {
      setAccountLast4(db, live.id, request.last4, now)
      return { ...live, last4: request.last4 }
    }
    if (live.last4 === request.last4) return live
    // A different card. Fall through and let the number decide.
  }

  return findOrCreateAccount(
    db,
    { name: request.fallbackName, kind: request.kind, last4: request.last4 },
    now,
  )
}

/** The account `findOrCreateAccount` would find, without making one. */
function findAccountFor(db: Database, account: { readonly name: string; readonly last4?: string | undefined }): Account | undefined {
  return account.last4 === undefined
    ? listAccounts(db).find((candidate) => candidate.name === account.name)
    : findAccountByLast4(db, account.last4)
}

/**
 * The account `resolveAccountForImport` would answer with, **without creating
 * one** — `undefined` when the import would make a new account (M28 F11).
 *
 * The read screen judges a sheet before anything is written, and judging it
 * against the bound account and the last-4 only, as it did, missed the third
 * rule: a bank file states no number, so it lands in the account named after
 * its reader, and a re-read of it counted every row as new.
 */
export function peekAccountForImport(
  db: Database,
  request: {
    readonly boundAccountId: string | undefined
    readonly last4: string | undefined
    readonly fallbackName: string
  },
): Account | undefined {
  const bound = request.boundAccountId === undefined ? undefined : findAccountById(db, request.boundAccountId)
  if (bound !== undefined && (request.last4 === undefined || bound.last4 === undefined || bound.last4 === request.last4)) {
    return bound
  }
  return findAccountFor(db, { name: request.fallbackName, last4: request.last4 })
}

function unarchive(db: Database, account: Account, now: number): Account {
  setAccountArchived(db, account.id, false, now)
  return { ...account, isArchived: false }
}

// --- What the accounts screen does to them ----------------------------------

export function renameAccount(db: Database, id: string, name: string, _now: number): void {
  db.run('UPDATE fmt_account SET name = ? WHERE id = ?', [name, id])
}

/**
 * Correct what kind of account this is.
 *
 * Editable for the same reason the last-4 is: getting it wrong is silent and
 * everything downstream depends on it. A bank statement sitting on an account
 * marked as a card is invisible to the entire settlement mechanism —
 * `listBankRowsForScan` reads `kind = 'BANK'` and nothing else — so the card
 * charges in it are never matched and the month is quietly counted twice
 * (D-070).
 *
 * The caller rescans afterwards: which rows are bank rows has just changed, and
 * the reading that depends on it is derived rather than stored (D-060).
 */
export function setAccountKind(db: Database, id: string, kind: AccountKind, _now: number): void {
  db.run('UPDATE fmt_account SET kind = ? WHERE id = ?', [kind, id])
  // A card holds no money (D-354): an account made a card lets go of its own
  // cash — gone while nothing is in it, kept where it is otherwise.
  if (kind === 'CREDIT_CARD') letGoOfOwnCash(db, id)
  // A card made a bank account gets the cash any bank account has (M30 F2).
  else ensureOwnCash(db, id)
}

/**
 * **A place that holds nothing yet** — one an older build made with a bank
 * account or cash (M30 F2, D-362), named as the account, with only that
 * account's own cash in it, no deposit, reading or row in that, and nothing
 * written on it. Since M36 U08 a bank account's own cash is in no place, so no
 * new one is made; the ones a document already has stay, and are still the
 * account's because its cash is in them. Naming the account from another place
 * moves its cash there and removes this one, and deleting or merging the
 * account takes it along (M30 F5).
 */
export function isBarePlace(db: Database, placeId: string): boolean {
  const place = query(db, 'SELECT name, institution, note FROM fmt_holding_place WHERE id = ?', [placeId])[0]
  if (place === undefined) return false
  if (place['institution'] != null || place['note'] != null) return false
  const inPlace = query(db, 'SELECT id, account FROM fmt_holding WHERE holding_place = ?', [placeId])
  const only = inPlace.length === 1 ? inPlace[0] : undefined
  const accountId = only?.['account']
  if (only === undefined || typeof accountId !== 'string') return false
  // Only the place a bank account or cash was made with: named as the account.
  const account = findAccountById(db, accountId)
  if (account === undefined || (account.kind !== 'BANK' && account.kind !== 'CASH')) return false
  if (String(place['name']).trim().toLowerCase() !== account.name.trim().toLowerCase()) return false
  return isUnusedHolding(db, String(only['id']))
}

/** Whether nothing was ever put in a holding: no deposit, reading or row names it, and no goal keeps money in it. */
export function isUnusedHolding(db: Database, heldId: string): boolean {
  const used = query(
    db,
    `SELECT (SELECT COUNT(*) FROM fmt_saving_deposit WHERE holding = ?)
          + (SELECT COUNT(*) FROM fmt_holding_reading WHERE holding = ?)
          + (SELECT COUNT(*) FROM fmt_transaction WHERE holding = ?)
          + (SELECT COUNT(*) FROM fmt_staged_row WHERE holding = ?)
          + (SELECT COUNT(*) FROM fmt_saving_goal WHERE default_holding = ?) AS n`,
    [heldId, heldId, heldId, heldId, heldId],
  )
  return Number(used[0]?.['n'] ?? 0) === 0
}

/** An account's own cash, and the place it is in when it is in one. */
export function ownCash(
  db: Database,
  accountId: string,
): { readonly id: string; readonly placeId: string | undefined } | undefined {
  const row = query(db, 'SELECT id, holding_place FROM fmt_holding WHERE account = ?', [accountId])[0]
  if (row === undefined) return undefined
  const place = row['holding_place']
  return { id: String(row['id']), placeId: typeof place === 'string' ? place : undefined }
}

/**
 * **An account lets go of its own cash** — deleted, merged away, or made a card.
 * Its cash goes while nothing was ever put in it, with the bare place an older
 * build made for it (M30 F5). Otherwise it stays, as a holding that is nobody's
 * own cash: in the place it is in, or — a bank account's, which is in none — in
 * a place made now and named as the account, so the money in it stays
 * somewhere (D-354: nothing is auto-deleted).
 */
function letGoOfOwnCash(db: Database, accountId: string): void {
  const cash = ownCash(db, accountId)
  if (cash === undefined) return
  if (cash.placeId !== undefined && isBarePlace(db, cash.placeId)) {
    deleteRows(db, declared(db, 'holding'), [cash.id], allDeclared(db))
    deleteRows(db, declared(db, 'holding_place'), [cash.placeId], allDeclared(db))
    return
  }
  if (cash.placeId === undefined && isUnusedHolding(db, cash.id)) {
    deleteRows(db, declared(db, 'holding'), [cash.id], allDeclared(db))
    return
  }
  let placeId = cash.placeId
  if (placeId === undefined) {
    const account = findAccountById(db, accountId)
    ;[placeId = ''] = insertRows(db, declared(db, 'holding_place'), [
      {
        name: account?.name ?? 'Cash',
        kind: placeKindOf(account?.kind),
        institution: null,
        note: null,
        is_archived: 0,
      },
    ])
  }
  updateRow(db, declared(db, 'holding'), cash.id, { holding_place: placeId, account: null })
}

/**
 * Correct a card's last 4 digits — docs/f12's "last-4 entered wrong", which is
 * editable rather than permanent because settlement matching (F06) depends on it.
 *
 * Stored as `NULL` rather than an empty string when cleared: `findAccountByLast4`
 * compares against it, and an empty string is a value that could match.
 */
export function setAccountLast4(
  db: Database,
  id: string,
  last4: string | undefined,
  _now: number,
): void {
  db.run('UPDATE fmt_account SET last4 = ? WHERE id = ?', [last4 ?? null, id])
}

export function setAccountInstitution(
  db: Database,
  id: string,
  institutionId: string | undefined,
  _now: number,
): void {
  db.run('UPDATE fmt_account SET institution = ? WHERE id = ?', [institutionId ?? null, id])
}

/**
 * Remember — or forget — what the user said about this card's monthly charge in
 * the bank statement (F06, D-061).
 *
 * `undefined` writes `NULL` and puts the card back to "not yet asked", which is
 * what makes the setting reversible from the account screen rather than a
 * one-way door. The three states are the point: `false` is an answer and must
 * never re-prompt, `NULL` is the absence of one and must.
 *
 * This is the remembered answer only. It does not reach back and change
 * settlements already decided — `setSettlementDecision` and `decideAllForCard`
 * are what move those, and they carry the invariant that a decision and the
 * bank row's `counted_on_card` are written together (M36 U04).
 */
export function setExcludeSettlementsFromStats(
  db: Database,
  id: string,
  exclude: boolean | undefined,
  _now: number,
): void {
  db.run(
    'UPDATE fmt_account SET exclude_settlements_from_stats = ? WHERE id = ?',
    [exclude === undefined ? null : exclude ? 1 : 0, id],
  )
}

/**
 * Hide an account from the pickers without losing its history — docs/04's
 * `isArchived`, "hidden from pickers, retained in history".
 */
export function setAccountArchived(
  db: Database,
  id: string,
  archived: boolean,
  _now: number,
): void {
  db.run('UPDATE fmt_account SET is_archived = ? WHERE id = ?', [archived ? 1 : 0, id])
}

// --- Every bank account has its own cash (M30 F2, M36 U08) ------------------

/**
 * The holding that is an account's own cash, as a row: what `ensureOwnCash`
 * and `setPlaceAccount` both write, so the two cannot make a different Cash. A
 * bank account's is in no place (`placeId` null); an account with holdings
 * keeps it in the place with its holdings.
 */
export function ownCashRow(placeId: string | null, accountId: string): Readonly<Record<string, string | number | null>> {
  return {
    holding_place: placeId,
    name: 'Cash',
    kind: 'CASH',
    provenance: 'RECORDED',
    last_confirmed: null,
    is_liquid: 1,
    expected_return: null,
    expected_return_basis: null,
    term_end: null,
    fee: null,
    note: null,
    is_archived: 0,
    account: accountId,
  }
}

/**
 * **A bank account or cash has its own Cash holding** (M30 F2, D-362), made
 * with the account — so a goal's money can be in it, and the Accounts screen,
 * Plan, every import and every tool get it with no call of their own.
 *
 * **It is in no place** (M36 U08): the holding names its account, and that is
 * enough. Before, every bank account was given a place named as it as well,
 * which every screen then showed beside the account it was. A place is for
 * money with no statements of its own — cash at home, a deposit — as D-354
 * meant it.
 *
 * Neither a card (it holds no money) nor an account with holdings (its
 * statement makes its own place, and its cash is there) nor an archived one.
 * Made with the account and when a card becomes a bank account — never on
 * open, for an account an older build wrote without one (D-385: no old-document
 * support). Archiving keeps it, so coming back needs none. Returns whether
 * anything was written.
 */
export function ensureOwnCash(db: Database, accountId: string): boolean {
  const account = findAccountById(db, accountId)
  if (account === undefined || account.isArchived) return false
  if (account.kind !== 'BANK' && account.kind !== 'CASH') return false
  if (ownCash(db, accountId) !== undefined) return false
  insertRows(db, declared(db, 'holding'), [ownCashRow(null, accountId)])
  return true
}

export interface AccountUsage {
  readonly transactions: number
  readonly importSessions: number
  readonly mappings: number
}

/** What an account holds. The merge panel and the archive button both ask this first. */
export function accountUsage(db: Database, id: string): AccountUsage {
  const rows = query(
    db,
    `SELECT
       (SELECT COUNT(*) FROM fmt_transaction WHERE account = ?) AS transactions,
       (SELECT COUNT(*) FROM fmt_statement WHERE account = ?) AS sessions,
       (SELECT COUNT(*) FROM fmt_import_mapping WHERE account = ?) AS mappings`,
    [id, id, id],
  )
  const row = rows[0]
  return {
    transactions: Number(row?.['transactions'] ?? 0),
    importSessions: Number(row?.['sessions'] ?? 0),
    mappings: Number(row?.['mappings'] ?? 0),
  }
}

export class AccountInUseError extends Error {
  constructor(
    readonly account: Account,
    readonly usage: AccountUsage,
  ) {
    super(
      `${account.name} holds ${usage.transactions} transactions. Archive it instead, or merge it into another account.`,
    )
    this.name = 'AccountInUseError'
  }
}

/**
 * Remove an account that never held anything — the institution unticked in
 * onboarding, or a card added by mistake.
 *
 * Refused rather than cascaded once it holds transactions, exactly as
 * `deleteCategory` is: deleting an account years of statements point at would
 * silently take the ledger with it. Archive and merge are the operations for a
 * card with history, and the error names both.
 *
 * Soft, like every delete in this document (docs/04).
 */
export function deleteAccount(db: Database, id: string, _now: number): void {
  const account = findAccountById(db, id)
  if (account === undefined) return

  const usage = accountUsage(db, id)
  if (usage.transactions > 0) throw new AccountInUseError(account, usage)

  // A mapping bound here is unbound — "ask each time" — rather than bound to
  // nothing (M25 U3b): a link names a row that is there (D-275).
  db.run('UPDATE fmt_import_mapping SET account = NULL WHERE account = ?', [id])
  // A plan bucket pointed at it becomes free money (D-319).
  unaimBuckets(db, 'target_account', id)
  // Its own cash goes with it while nothing is in it; otherwise it stays (D-354).
  letGoOfOwnCash(db, id)
  // Through the engine, so a rule limited to this account refuses the delete
  // by name rather than being left limited to nothing.
  deleteRows(db, declared(db, 'account'), [id], allDeclared(db))
}

export class AccountMergeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountMergeError'
  }
}

export interface MergePreview {
  /** Transactions that move across. */
  readonly moved: number
  /**
   * Transactions the target already has under the same natural key — the same
   * charge, filed twice because one card was split across two accounts.
   */
  readonly duplicates: number
}

/**
 * What a merge would do, before it does it.
 *
 * The duplicate count is the interesting half. The reason this operation exists
 * is documents written before D-033, where two accounts hold overlapping months
 * of one card — so a merge is not a straight repoint, and the panel has to be
 * able to say how many rows it is about to drop.
 */
export function mergePreview(db: Database, fromId: string, intoId: string): MergePreview {
  const rows = query(
    db,
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(
         EXISTS (SELECT 1 FROM fmt_transaction t
                  WHERE t.account = ? AND t.natural_key = source.natural_key)
       ), 0) AS duplicates
       FROM fmt_transaction source
      WHERE source.account = ?`,
    [intoId, fromId],
  )
  const total = Number(rows[0]?.['total'] ?? 0)
  const duplicates = Number(rows[0]?.['duplicates'] ?? 0)
  return { moved: total - duplicates, duplicates }
}

/**
 * Fold one account into another: transactions, import sessions and mapping
 * bindings all move, and the source is removed.
 *
 * This is the repair for documents written before D-033, where one card became
 * two accounts and re-importing an overlapping month was no longer caught as
 * duplicate — the unique index is `(account_id, natural_key)`, so a split card
 * breaks idempotence. Until this existed the only fix was starting a new
 * document.
 *
 * Rows the target already holds under the same natural key are removed rather
 * than moved. They cannot be moved — the index forbids it — and they are the
 * same charge, not a second one. **Removed, not soft-deleted, since M25 U3**
 * (D-275): what named the removed row — a correction, a settlement, a re-apply's
 * undo, a debt payment — names its twin in the survivor
 * instead, so nothing is left pointing at a row that is gone. The preview says
 * how many go before anything does, which is what makes it confirmable.
 *
 * Same kind only. A card and a bank account are different things, and merging
 * one into the other is a mis-click rather than an operation.
 */
export function mergeAccounts(db: Database, fromId: string, intoId: string, now: number): void {
  if (fromId === intoId) throw new AccountMergeError('An account cannot be merged into itself.')

  const source = findAccountById(db, fromId)
  const target = findAccountById(db, intoId)
  if (source === undefined || target === undefined) {
    throw new AccountMergeError('One of those accounts no longer exists.')
  }
  if (source.kind !== target.kind) {
    throw new AccountMergeError(
      `${source.name} and ${target.name} are different kinds of account. Only two cards, or two bank accounts, can be merged.`,
    )
  }

  inTransaction(db, () => {
    // Collisions first, or the repoint below hits the unique index.
    const twins = query(
      db,
      `SELECT source.id AS source, target.id AS target
         FROM fmt_transaction source
         JOIN fmt_transaction target ON target.account = ? AND target.natural_key = source.natural_key
        WHERE source.account = ?`,
      [intoId, fromId],
    ).map((row) => ({ source: String(row['source']), target: String(row['target']) }))
    for (const twin of twins) repointTransaction(db, twin.source, twin.target)
    if (twins.length > 0) {
      deleteRows(db, declared(db, 'transaction'), twins.map((twin) => twin.source), allDeclared(db))
    }
    db.run('UPDATE fmt_transaction SET account = ? WHERE account = ?', [intoId, fromId])
    // A reader that has only ever read into the source found it by its own name
    // (a bank file states no number), and would make the source again on the
    // next export. It is bound to the survivor instead (M28 F11).
    if (source.last4 === undefined && target.last4 === undefined) {
      db.run(
        `UPDATE fmt_import_mapping SET account = ?
          WHERE account IS NULL
            AND id IN (SELECT mapping FROM fmt_statement WHERE account = ?)
            AND id NOT IN (SELECT mapping FROM fmt_statement WHERE account <> ? AND mapping IS NOT NULL)`,
        [intoId, fromId, fromId],
      )
    }
    // Provenance moves with the rows: "show me where this came from" has to keep
    // answering after a merge.
    updateEach(db, 'statement', 'SELECT id FROM fmt_statement WHERE account = ?', fromId, { account: intoId })
    db.run('UPDATE fmt_import_mapping SET account = ? WHERE account = ?', [intoId, fromId])

    // Settlement links follow the card they are about.
    db.run('UPDATE fmt_card_settlement_link SET card_account = ? WHERE card_account = ?', [intoId, fromId])

    // The surviving account adopts what it was missing and nothing else. The
    // user picked which one survives, so its own name and institution stand;
    // a last-4 it never had is the one thing the merge can only have improved.
    if (target.last4 === undefined && source.last4 !== undefined) {
      setAccountLast4(db, intoId, source.last4, now)
    }
    if (target.institutionId === undefined && source.institutionId !== undefined) {
      setAccountInstitution(db, intoId, source.institutionId, now)
    }
    // An answer the survivor never gave. Same rule as the last-4: adopting a
    // fact the target lacked can only improve it, and overwriting one it has
    // would silently reverse a decision the user made about the survivor.
    if (
      target.excludeSettlementsFromStats === undefined &&
      source.excludeSettlementsFromStats !== undefined
    ) {
      setExcludeSettlementsFromStats(db, intoId, source.excludeSettlementsFromStats, now)
    }

    // A rule limited to the merged account follows it, like its transactions.
    db.run('UPDATE fmt_category_rule SET scope_account = ? WHERE scope_account = ?', [intoId, fromId])
    reaimBucketLink(db, 'target_account', fromId, intoId)
    // The source's own cash becomes the survivor's — and the place it is in with
    // it — unless the survivor has its own already: then the source's goes
    // while nothing is in it, and stays as a holding that is nobody's own cash
    // otherwise (D-354, M30 F5). One own cash per account.
    if (ownCash(db, intoId) !== undefined) letGoOfOwnCash(db, fromId)
    else db.run('UPDATE fmt_holding SET account = ? WHERE account = ?', [intoId, fromId])
    deleteRows(db, declared(db, 'account'), [fromId], allDeclared(db))
  })
}

/**
 * Everything that names one transaction, made to name its twin — the row a
 * merge keeps. Where the twin already has its own (a settlement is one per
 * bank row, a re-apply one per run and row), the removed row's goes with it.
 */
function repointTransaction(db: Database, from: string, to: string): void {
  db.run('UPDATE fmt_category_override SET "transaction" = ? WHERE "transaction" = ?', [to, from])
  const settled = query(db, 'SELECT 1 FROM fmt_card_settlement_link WHERE bank_transaction = ?', [to])
  if (settled.length > 0) {
    db.run('DELETE FROM fmt_card_settlement_link WHERE bank_transaction = ?', [from])
  } else {
    db.run('UPDATE fmt_card_settlement_link SET bank_transaction = ? WHERE bank_transaction = ?', [to, from])
  }
  db.run(
    `DELETE FROM fmt_reapply_change
      WHERE "transaction" = ? AND run IN (SELECT run FROM fmt_reapply_change WHERE "transaction" = ?)`,
    [from, to],
  )
  db.run('UPDATE fmt_reapply_change SET "transaction" = ? WHERE "transaction" = ?', [to, from])
  // A payment is one per debt and row: where the twin already paid that
  // debt, the removed row's payment was the same payment, and goes too.
  db.run('UPDATE OR IGNORE fmt_debt_payment SET "transaction" = ? WHERE "transaction" = ?', [to, from])
  db.run('DELETE FROM fmt_debt_payment WHERE "transaction" = ?', [from])
  // A row is an end of one transfer at most (D-356): where the twin is one
  // already, the removed row's pair goes; otherwise it follows to the twin.
  const paired = query(
    db,
    'SELECT 1 FROM fmt_transfer_pair WHERE out_transaction = ? OR in_transaction = ?',
    [to, to],
  )
  if (paired.length > 0) {
    db.run('DELETE FROM fmt_transfer_pair WHERE out_transaction = ? OR in_transaction = ?', [from, from])
  } else {
    db.run('UPDATE fmt_transfer_pair SET out_transaction = ? WHERE out_transaction = ?', [to, from])
    db.run('UPDATE fmt_transfer_pair SET in_transaction = ? WHERE in_transaction = ?', [to, from])
  }
}

/** One write per row a query finds, through the engine. */
function updateEach(
  db: Database,
  format: string,
  sql: string,
  parameter: string,
  cells: Readonly<Record<string, string | number | null>>,
): void {
  const declaration = declared(db, format)
  for (const row of query(db, sql, [parameter])) updateRow(db, declaration, String(row['id']), cells)
}

function decode(row: Record<string, unknown>): Account {
  return {
    id: String(row['id']),
    name: String(row['name']),
    kind: String(row['kind']) as AccountKind,
    last4: row['last4'] == null ? undefined : String(row['last4']),
    institutionId: row['institution_id'] == null ? undefined : String(row['institution_id']),
    excludeSettlementsFromStats:
      row['exclude_settlements_from_stats'] == null
        ? undefined
        : Number(row['exclude_settlements_from_stats']) === 1,
    isArchived: Number(row['is_archived']) === 1,
  }
}
