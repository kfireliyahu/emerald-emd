/**
 * Saved import mappings — the `ImportMapping` of docs/04-data-model.md, rows
 * of the ledger pack's `import_mapping` since M25 U3b (D-277).
 *
 * The mapper edits a `DraftMapping`; this is where one is given identity, a
 * name, a header signature and usage counters, and where it comes back from.
 * Its two `Map`s are stored as JSON, because the shape is a map keyed by column
 * index whose meaning belongs to the importer rather than to SQL.
 *
 * Decoding is defensive throughout. A `.emd` file is a real SQLite
 * database the user owns and can open in any tool, so a row can hold anything;
 * a mapping that no longer decodes is skipped, never thrown, and the import
 * falls back to guessing exactly as it does when no mapping exists (f01,
 * "Mapping deleted while files still use it").
 */

import { integerOf, objectOf } from './json.ts'
import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import {
  type AmountConvention,
  type ColumnRole,
  type DateOrder,
  type DraftMapping,
} from '@/domain/model/importing.ts'
import { columnRoleIds } from './columnRoleRepository.ts'
import { deleteRows, insertRows } from './formatRowRepository.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared, instantOf, millisOf } from '../packs/ledger/tables.ts'

export interface SavedMapping {
  readonly id: string
  readonly name: string
  readonly accountId: string | undefined
  readonly headerSignature: string
  readonly mapping: DraftMapping
  readonly lastUsedAt: number | undefined
  readonly useCount: number
}

export interface SaveMappingInput {
  /** Supply this to update a mapping in place; omit it and the signature decides. */
  readonly id?: string | undefined
  readonly name: string
  readonly accountId?: string | undefined
  readonly headerSignature: string
  readonly mapping: DraftMapping
}

const SELECT = `SELECT id, name, account, header_signature, sheet_name, header_row_index,
                       data_start_row_index, column_roles, amount_convention, date_orders,
                       default_currency, last_used, use_count
                  FROM fmt_import_mapping
                 WHERE 1 = 1`

/**
 * Most recently used first, so the mapper's fallbacks reach for the familiar
 * one. An instant column is ISO text, which sorts as the moment does.
 */
const ORDER = " ORDER BY COALESCE(last_used, '') DESC, use_count DESC, name"

export function listMappings(db: Database): readonly SavedMapping[] {
  return decodeAll(db, query(db, SELECT + ORDER))
}

/**
 * The saved mapping for exactly this header, if there is one.
 *
 * Close matches are not this function's business: they need the file's grid to
 * work out what moved. See `matchSavedMapping` in the importer.
 */
export function findMappingBySignature(db: Database, signature: string): SavedMapping | undefined {
  return decodeAll(db, query(db, `${SELECT} AND header_signature = ?${ORDER}`, [signature]))[0]
}

/**
 * Insert a mapping, or update the one that already covers this format.
 *
 * Upsert rather than insert, keyed on the id when the mapper has one and on the
 * signature otherwise. The signature key outlived the reason it was introduced
 * for — there is a mappings screen now, so a second row for one format would be
 * neither indistinguishable nor undeletable. It stays because the *match* is
 * still one-to-one: `matchSavedMapping` resolves a file to a single mapping, and
 * two rows carrying one signature turn that answer into a tiebreak. Saving from
 * the mapper says "this is how this format is read", so it belongs in the row
 * that already says so.
 *
 * `duplicateMapping` is the deliberate exception, and it is the user asking.
 */
export function saveMapping(db: Database, input: SaveMappingInput, now: number): SavedMapping {
  const existing =
    input.id !== undefined
      ? findMappingById(db, input.id)
      : findMappingBySignature(db, input.headerSignature)

  if (existing === undefined) {
    return insertMapping(db, newId(), input, now)
  }

  // A save that says nothing about the account keeps the one the mapping has.
  // The mapper only knows an account when the file resolved to one, and
  // "re-saving the columns" must not quietly unbind a mapping the user bound on
  // the mappings screen. `setMappingAccount` is how a binding is cleared.
  const accountId = input.accountId ?? existing.accountId

  db.run(
    `UPDATE fmt_import_mapping
        SET name = ?, account = ?, header_signature = ?, sheet_name = ?,
            header_row_index = ?, data_start_row_index = ?, column_roles = ?,
            amount_convention = ?, date_orders = ?, default_currency = ?
      WHERE id = ?`,
    [
      input.name,
      accountId ?? null,
      input.headerSignature,
      input.mapping.sheetName === '' ? null : input.mapping.sheetName,
      input.mapping.headerRowIndex,
      input.mapping.dataStartRowIndex,
      encodeColumnRoles(input.mapping.columnRoles),
      input.mapping.amountConvention,
      encodeDateOrders(input.mapping.dateOrders),
      input.mapping.defaultCurrency,
      existing.id,
    ],
  )

  return {
    id: existing.id,
    name: input.name,
    accountId,
    headerSignature: input.headerSignature,
    mapping: input.mapping,
    lastUsedAt: existing.lastUsedAt,
    useCount: existing.useCount,
  }
}

function insertMapping(
  db: Database,
  id: string,
  input: SaveMappingInput,
  _now: number,
): SavedMapping {
  insertRows(
    db,
    declared(db, 'import_mapping'),
    [
      {
        name: input.name,
        account: input.accountId ?? null,
        header_signature: input.headerSignature,
        sheet_name: input.mapping.sheetName === '' ? null : input.mapping.sheetName,
        header_row_index: input.mapping.headerRowIndex,
        data_start_row_index: input.mapping.dataStartRowIndex,
        column_roles: encodeColumnRoles(input.mapping.columnRoles),
        amount_convention: input.mapping.amountConvention,
        date_orders: encodeDateOrders(input.mapping.dateOrders),
        default_currency: input.mapping.defaultCurrency,
        last_used: null,
        use_count: 0,
      },
    ],
    [id],
  )

  return {
    id,
    name: input.name,
    accountId: input.accountId,
    headerSignature: input.headerSignature,
    mapping: input.mapping,
    lastUsedAt: undefined,
    useCount: 0,
  }
}

export function findMappingById(db: Database, id: string): SavedMapping | undefined {
  return decodeAll(db, query(db, `${SELECT} AND id = ?`, [id]))[0]
}

// --- What the mappings screen does to them ----------------------------------

/**
 * Rename a mapping. The name is a label the user chose and nothing keys on it,
 * so this touches one column and no invariant.
 */
export function renameMapping(db: Database, id: string, name: string, _now: number): void {
  db.run('UPDATE fmt_import_mapping SET name = ? WHERE id = ?', [name, id])
}

/**
 * Bind a mapping to the account its files belong to, or unbind it with
 * `undefined` — docs/04's `ImportMapping.accountId`, which nothing set until F12.
 *
 * A bound mapping is what makes "which card is this file for" answerable when the
 * file itself does not say: D-033 identifies a card by the number the file states,
 * and this is the fallback for the hole that leaves. Unbound means the account is
 * worked out per file, which is what the mappings screen calls "ask each time".
 */
export function setMappingAccount(
  db: Database,
  id: string,
  accountId: string | undefined,
  _now: number,
): void {
  db.run('UPDATE fmt_import_mapping SET account = ? WHERE id = ?', [accountId ?? null, id])
}

/**
 * Copy a mapping under a new name, keeping the format it reads.
 *
 * The copy carries the same signature — a copy of a Cal mapping is still a Cal
 * mapping, and one stripped of its signature would match nothing and be
 * unreachable, since there is no way to pick a mapping by hand. Two rows for one
 * format is therefore exactly what this makes, and the screen says so: the most
 * recently used of them is what a matching file gets.
 *
 * Usage does not come along. The copy has not imported anything, and
 * `lastUsedAt` is what decides that tiebreak — inheriting it would let a copy
 * outrank the mapping that did the work.
 */
export function duplicateMapping(db: Database, id: string, now: number): SavedMapping | undefined {
  const source = findMappingById(db, id)
  if (source === undefined) return undefined

  const taken = new Set(listMappings(db).map((mapping) => mapping.name))
  return insertMapping(
    db,
    newId(),
    {
      name: copyName(source.name, taken),
      accountId: source.accountId,
      headerSignature: source.headerSignature,
      mapping: source.mapping,
    },
    now,
  )
}

/**
 * Forget a mapping. **Removed, not soft-deleted**, since M25 U3b (D-277): a
 * link names a row that is there (D-275), so a statement it read names no
 * mapping afterwards — the file, the sheet and the counts are still on it.
 *
 * No in-use guard, deliberately. A mapping is a convenience, not a dependency —
 * f01's "Mapping deleted while files still use it" says the next import of that
 * format falls back to guessing, which is what the very first import did.
 * Nothing already committed refers to it for its meaning.
 */
export function deleteMapping(db: Database, id: string, _now: number): void {
  inTransaction(db, () => {
    db.run('UPDATE fmt_statement SET mapping = NULL WHERE mapping = ?', [id])
    deleteRows(db, declared(db, 'import_mapping'), [id], allDeclared(db))
  })
}

/**
 * "Cal – Visa 1234" → "Cal – Visa 1234 (copy)", then "(copy 2)", "(copy 3)".
 *
 * An existing suffix is replaced rather than stacked, so copying a copy gives
 * "(copy 2)" and not "(copy) (copy)".
 */
function copyName(name: string, taken: ReadonlySet<string>): string {
  const stem = name.replace(/ \(copy(?: \d+)?\)$/, '')
  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? `${stem} (copy)` : `${stem} (copy ${attempt})`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Record that a mapping was used to import something.
 *
 * Called from the commit, not from opening the mapper: a mapping that was
 * looked at and abandoned was not used, and "last used" is what the mappings
 * screen will sort and prune by.
 */
export function recordMappingUse(db: Database, id: string, now: number, accountId?: string): void {
  db.run('UPDATE fmt_import_mapping SET last_used = ?, use_count = use_count + 1 WHERE id = ?', [
    instantOf(now),
    id,
  ])
  // **A reader learns its account on first use** (M28 F11), when that account
  // has no number of its own. A bank file states none, so without the binding
  // the next export of this layout finds its account by the reader's *name* —
  // and a reader named after one month's file name makes a new bank account
  // every month. A card is found by its last-4 and needs no binding; a reader
  // already bound is left alone.
  if (accountId !== undefined) {
    db.run(
      `UPDATE fmt_import_mapping SET account = ?
        WHERE id = ? AND account IS NULL
          AND EXISTS (SELECT 1 FROM fmt_account WHERE id = ? AND last4 IS NULL)`,
      [accountId, id, accountId],
    )
  }
}

// --- Encoding ---------------------------------------------------------------

function encodeColumnRoles(roles: ReadonlyMap<number, ColumnRoleId>): string {
  const object: Record<string, ColumnRoleId> = {}
  // Numerically, so a saved mapping reads the way the grid does when someone
  // opens the file in a SQLite browser.
  for (const column of [...roles.keys()].sort((a, b) => a - b)) {
    const role = roles.get(column)
    if (role !== undefined) object[String(column)] = role
  }
  return JSON.stringify(object)
}

function encodeDateOrders(orders: ReadonlyMap<ColumnRole, DateOrder>): string {
  return JSON.stringify(Object.fromEntries(orders))
}

/**
 * What this **document** calls a role, not what this build does (D-213).
 *
 * A stored mapping may name a role somebody added because a real file printed a
 * column no release could name (D-208). Checking it against the `const` would
 * drop exactly the mapping the feature exists to keep — so the check is against
 * the document's own `column_role` rows, which is still a closed set and still
 * refuses a role nothing ever declared.
 */
function validRoles(db: Database): ReadonlySet<string> {
  return new Set<string>(columnRoleIds(db, 'STATEMENT'))
}
const VALID_ORDERS: ReadonlySet<string> = new Set<string>(['DMY', 'MDY', 'YMD'])
/**
 * `amount_convention` carries no CHECK constraint (001), so the third value cost
 * no migration — the guard against a value this build cannot read is here and
 * has always been here. A mapping naming one is skipped rather than parsed as
 * something else, which is the same defence as an unreadable `column_roles`.
 */
const VALID_CONVENTIONS: ReadonlySet<string> = new Set<string>([
  'SIGNED_SINGLE',
  'POSITIVE_IS_CHARGE',
  'SEPARATE_DEBIT_CREDIT',
])

function decodeAll(db: Database, rows: readonly Record<string, unknown>[]): readonly SavedMapping[] {
  const valid = validRoles(db)
  const mappings: SavedMapping[] = []
  for (const row of rows) {
    const mapping = decode(row, valid)
    if (mapping !== undefined) mappings.push(mapping)
  }
  return mappings
}

function decode(row: Record<string, unknown>, valid: ReadonlySet<string>): SavedMapping | undefined {
  const headerRowIndex = integerOf(row['header_row_index'])
  const dataStartRowIndex = integerOf(row['data_start_row_index'])
  const convention = String(row['amount_convention'])
  if (headerRowIndex === undefined || dataStartRowIndex === undefined) return undefined
  if (!VALID_CONVENTIONS.has(convention)) return undefined

  const columnRoles = decodeColumnRoles(row['column_roles'], valid)
  const dateOrders = decodeDateOrders(row['date_orders'], valid)
  if (columnRoles === undefined || dateOrders === undefined) return undefined

  return {
    id: String(row['id']),
    name: String(row['name']),
    accountId: row['account'] == null ? undefined : String(row['account']),
    headerSignature: String(row['header_signature']),
    lastUsedAt: millisOf(row['last_used']),
    useCount: Number(row['use_count'] ?? 0),
    mapping: {
      sheetName: row['sheet_name'] == null ? '' : String(row['sheet_name']),
      headerRowIndex,
      dataStartRowIndex,
      columnRoles,
      amountConvention: convention as AmountConvention,
      dateOrders,
      defaultCurrency: String(row['default_currency']),
    },
  }
}

function decodeColumnRoles(
  value: unknown,
  valid: ReadonlySet<string>,
): Map<number, ColumnRoleId> | undefined {
  const object = objectOf(value)
  if (object === undefined) return undefined

  const roles = new Map<number, ColumnRoleId>()
  for (const [key, role] of Object.entries(object)) {
    const column = integerOf(key)
    // An unrecognised role is dropped rather than failing the whole mapping: a
    // newer build may have written a role this one has not heard of, and the
    // rest of the mapping is still worth having.
    if (column === undefined || typeof role !== 'string' || !valid.has(role)) continue
    roles.set(column, role)
  }
  return roles
}

function decodeDateOrders(
  value: unknown,
  valid: ReadonlySet<string>,
): Map<ColumnRole, DateOrder> | undefined {
  const object = objectOf(value)
  if (object === undefined) return undefined

  const orders = new Map<ColumnRole, DateOrder>()
  for (const [role, order] of Object.entries(object)) {
    if (!valid.has(role) || typeof order !== 'string' || !VALID_ORDERS.has(order)) continue
    orders.set(role as ColumnRole, order as DateOrder)
  }
  return orders
}
