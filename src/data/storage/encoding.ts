/**
 * **How a document is stored: SQLite bytes, or text — chosen per file** (M22
 * U6, [D-246](../../../docs/09-decision-log.md)).
 *
 * ## The premise that turned out to be a choice
 *
 * That a `.emd` is SQLite bytes on disk was never a decision; it was what
 * sql.js handed over and nobody asked. It does not have to hold. A document is
 * wholly in memory while the app is open — sql.js has no other mode — and the
 * bytes on disk are a *serialization* of it, so which serialization is a
 * property of the file rather than of the product.
 *
 * **Measured before it was believed** (D-246): 149KB of text against 792KB of
 * SQLite for the same 285 rows, because most of a small binary is empty pages
 * for tables holding nothing. Rebuilding from text cost 9.5ms against 1.1ms to
 * open the binary — ~29µs a row, and **that was node's own SQLite rather than
 * sql.js in WASM**, so the honest figure in the app is larger. A repo's memory
 * is hundreds of rows and text wins on every axis; a decade of transactions is
 * 60k rows (D-118) and binary wins. Hence *per file*.
 *
 * ## What is here, and what is deliberately not
 *
 * This is the whole of the seam: two openers, one writer, and the sniff.
 * Everything above it holds a `Database` and does not learn that the format
 * changed — the two call sites that do are `documentStore`, which remembers
 * what the file was so a save keeps it, and the plugin's gate.
 *
 * It lives under `storage/` rather than under `db/` on purpose: *if it is about
 * presentation or storage, it is not the domain layer*, and this is storage
 * exactly. It also keeps `db/database.ts` free of a repository import, which
 * would have been a cycle.
 *
 * **The crash snapshot is not here and stays binary.** `crashCache` holds a
 * copy of memory rather than a document somebody reads, it must never refuse,
 * and an encoding that *can* refuse is the wrong thing to put between a
 * mutation and the only record of it.
 *
 * ## A text save is verified, not trusted
 *
 * U4's serializer covered the declared half — declarations, their rows, and the
 * units — and not the engine's own bookkeeping beside them: a pack's seed
 * records (D-264) came later, and an intake's reading (D-226) only in M38 U3
 * (D-408), before which a read into a text document could not be saved. Until
 * M25 U8 it could not cover the ledger's thirty tables either. So a text save of a document holding a
 * ledger would lose part of it, silently, which is the one failure this app is
 * named against.
 *
 * `uncarried` is what stops that, and it asks the question the only sound way:
 * **against a freshly created document at the same schema, table by table.**
 * Not against a list of tables — a list goes stale at the next migration, and
 * it would also have to know which rows a text document gets back from the
 * migrations themselves (the units) rather than from its text. Fresh-versus-this answers
 * both without being told either, and keeps answering after a migration nobody
 * remembers this file for. A verifier proves what it checks and nothing else
 * (D-138), so what it checks is the whole difference.
 */

import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import { listed } from '@/core/text.ts'
import { joinParts, splitParts } from '@/domain/format/document.ts'

import {
  createDatabase,
  exportDatabase,
  migrate,
  openDatabaseWithoutMigrating,
  query,
  readSchemaVersion,
  SCHEMA_VERSION,
  SchemaTooNewError,
} from '../db/database.ts'
import { applyParts, serializeDocument } from '../repositories/formatDocumentRepository.ts'

/** Which serialization a file is. A property of the file, detected on open. */
export type DocumentEncoding = 'sqlite' | 'text'

/**
 * A document and the shape it was found in, which is the shape it is saved in.
 *
 * The pair is the whole reason this module has a return type of its own: an
 * encoding that is not carried from the open through to the save is an encoding
 * that silently becomes whatever the last person to touch the code preferred.
 */
export interface OpenedEncoded {
  readonly db: Database
  readonly encoding: DocumentEncoding
  /**
   * The file was at an older schema and what came back is not what is on disk.
   * The app has to treat that as unsaved work: a migration held only in memory
   * is lost on close, and the file stays behind for every tool that refuses to
   * migrate it — the plugin, `docs/memory.emd`'s SCHEMA_BEHIND.
   */
  readonly migrated: boolean
}

/**
 * `SQLite format 3` and a NUL — the first sixteen bytes of every SQLite file,
 * from its own file-format documentation.
 */
const SQLITE_MAGIC = [...'SQLite format 3'].map((char) => char.charCodeAt(0)).concat(0)

/**
 * The first line of a text document, and the only place the schema version
 * lives in one.
 *
 * A line rather than a part, so it sits above `joinParts`'s output and
 * `splitParts` — which drops everything before its first marker — needs no
 * knowledge of it. An HTML comment, so a rendered view of the file shows the
 * document rather than the seam; and readable, because the first thing a person
 * opening one should learn is what they are looking at.
 */
const TEXT_HEADER = /^<!--\s*emerald document, schema (\d+)\s*-->$/

function textHeader(version: number): string {
  return `<!-- emerald document, schema ${String(version)} -->`
}

function startsWithMagic(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC.length) return false
  return SQLITE_MAGIC.every((code, at) => bytes[at] === code)
}

/** The text and the version its header declares, for a file that has one. */
function headerOf(
  bytes: Uint8Array,
): { readonly text: string; readonly version: number } | undefined {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Not valid UTF-8, so not a text document. Binary that is not SQLite lands
    // here too, which is the same answer.
    return undefined
  }

  const first = text.replace(/\r\n/g, '\n').split('\n', 1)[0] ?? ''
  const matched = TEXT_HEADER.exec(first.trim())
  if (matched === null) return undefined

  const version = Number(matched[1])
  return Number.isSafeInteger(version) ? { text, version } : undefined
}

/**
 * Open a document of either shape, migrating it — **the app's door.**
 *
 * The binary path migrates in place, as `openDatabase` does. The text path is
 * a document built at this build's schema with the text read into it, and that *is*
 * migration for a text document: the text carries declarations and rows,
 * neither of which has a schema version, so there is no chain to walk. The
 * header's number exists to refuse a file from the future, not to pick a
 * migration.
 */
export async function openEncoded(bytes: Uint8Array): Promise<OpenedEncoded> {
  const header = startsWithMagic(bytes) ? undefined : headerOf(bytes)
  if (header === undefined) {
    const db = await openDatabaseWithoutMigrating(bytes)
    const from = readSchemaVersion(db)
    migrate(db)
    return { db, encoding: 'sqlite', migrated: from < SCHEMA_VERSION }
  }

  if (header.version > SCHEMA_VERSION) throw new SchemaTooNewError(header.version, SCHEMA_VERSION)
  return {
    db: await rebuild(header.text, SCHEMA_VERSION),
    encoding: 'text',
    migrated: header.version < SCHEMA_VERSION,
  }
}

/**
 * The same file, left at the version it records — **everything that is not the
 * app.**
 *
 * The separate name is `openDatabaseWithoutMigrating`'s, for its reason: the
 * plugin answers a read-only question, and a plugin one schema ahead that wrote
 * a newer version back would leave the owner's own app refusing their own
 * document. For text that means a document at the version the *header* says
 * rather than at this build's, so `readSchemaVersion` afterwards reports the
 * file's own number and the plugin's gate can refuse it with the sentence that
 * explains the fix.
 *
 * **An older one is the version and nothing else** (M36 U02, D-378): an empty
 * document at that schema, which is all the gate reads before refusing it. The
 * text is read only into this build's own schema, so no code that reads a
 * document ever meets an engine table older than itself — and carries no probe
 * for one.
 */
export async function openEncodedWithoutMigrating(bytes: Uint8Array): Promise<OpenedEncoded> {
  const header = startsWithMagic(bytes) ? undefined : headerOf(bytes)
  if (header === undefined) {
    return { db: await openDatabaseWithoutMigrating(bytes), encoding: 'sqlite', migrated: false }
  }

  if (header.version > SCHEMA_VERSION) throw new SchemaTooNewError(header.version, SCHEMA_VERSION)
  if (header.version < SCHEMA_VERSION) {
    return { db: await createDatabase(header.version), encoding: 'text', migrated: false }
  }
  return { db: await rebuild(header.text, header.version), encoding: 'text', migrated: false }
}

/**
 * Text into a document at `schemaVersion`, or a thrown refusal.
 *
 * Thrown rather than returned because both openers stand exactly where
 * `openDatabase` stood and its callers already catch — `documentStore.openBytes`
 * renders whatever it catches, and the plugin's gate turns it into
 * `UNREADABLE`. A `Result` here would be a third error channel for one failure.
 */
async function rebuild(text: string, schemaVersion: number): Promise<Database> {
  const parts = splitParts(text)
  if (!parts.ok) throw new Error(parts.error)

  const db = await createDatabase(schemaVersion)
  const applied = applyParts(db, parts.value, Date.now())
  if (!applied.ok) {
    db.close()
    throw new Error(applied.error)
  }
  return db
}

/**
 * The bytes to write, in the shape the file already is — or one sentence saying
 * why this document cannot be text.
 *
 * A `Result` rather than a throw, and it is the one asymmetry with the openers:
 * unlike a file that will not open, this refusal is about the *document*. The
 * person asking has done nothing wrong, and the sentence has to name what is in
 * the way.
 */
export async function exportEncoded(
  db: Database,
  encoding: DocumentEncoding,
): Promise<Result<Uint8Array, string>> {
  if (encoding === 'sqlite') return ok(exportDatabase(db))

  // **The loss question first**, before anything is rendered. It is the one
  // refusal that is about what would go missing rather than about what cannot be
  // written, so it is the sentence a person needs even when the document also
  // happens to be empty of formats.
  const left = await uncarried(db)
  if (left.length > 0) {
    return err(
      'This document cannot be saved as text: the text holds declared formats, their rows and ' +
        `the units, and ${listed(left)} ${left.length === 1 ? 'holds' : 'hold'} something it does ` +
        'not carry. Save it as SQLite bytes instead — no serializer covers the ledger yet ' +
        '(D-246).',
    )
  }

  const parts = serializeDocument(db)
  if (!parts.ok) return parts

  // **A document with nothing declared in it has no text**, and the empty file
  // that would be written is one this build then refuses to open — the header
  // alone holds no parts. Caught here rather than discovered on the next open:
  // a save that produced an unopenable document is the worst answer available,
  // and it is the one an empty new document would have got.
  if (parts.value.length === 0) {
    return err(
      'There is nothing in this document to write as text yet — the text holds declared ' +
        'formats and their rows, and this document declares none. Declare a format first, or ' +
        'save it as SQLite bytes.',
    )
  }

  const joined = joinParts(parts.value)
  if (!joined.ok) return joined

  return ok(new TextEncoder().encode(`${textHeader(readSchemaVersion(db))}\n${joined.value}`))
}

/**
 * The tables holding something the text would not carry, and what is in them.
 *
 * Every table the serializer covers is skipped — the declarations, their `fmt_`
 * tables and the units — and everything else is compared against a document
 * this build has just created, because a fresh document is *exactly* what a
 * text one is read back into. What the migrations seed therefore matches and is
 * not reported; a row a person put there, or changed, does not and is.
 */
async function uncarried(db: Database): Promise<readonly string[]> {
  const fresh = await createDatabase(readSchemaVersion(db))
  try {
    const known = new Set(tablesOf(fresh))
    const left: string[] = []
    for (const table of tablesOf(db)) {
      if (CARRIED.has(table) || table.startsWith('fmt_')) continue
      const count = rowCount(db, table)
      // A table a fresh document has not got cannot be compared, so anything at
      // all in it is something the text would lose.
      if (!known.has(table)) {
        if (count > 0) left.push(`${table} (${String(count)} rows)`)
        continue
      }
      if (contentOf(db, table) === contentOf(fresh, table)) continue
      left.push(`${table} (${String(count)} rows)`)
    }
    return left
  } finally {
    fresh.close()
  }
}

/**
 * What U4's serializer writes, by the table it comes out of.
 *
 * Named rather than derived, and short enough to read against `document.ts`: a
 * declaration with its columns, their enum values, its identities, its
 * aggregates and its row constraints, plus the units, plus the version that goes in the header.
 * Anything the serializer grows to cover is added here in the same commit, and
 * anything it does not cover is caught by being absent — which is the safe
 * direction for this list to be wrong in.
 */
const CARRIED: ReadonlySet<string> = new Set([
  'schema_version',
  'format',
  'format_column',
  'format_column_value',
  'format_identity',
  'format_aggregate',
  'format_constraint',
  'format_rollup',
  'format_rule_set',
  // A derived column (D-334), which the declaration's own table carries.
  'format_derived',
  'format_column_view',
  'format_graph_place',
  // An entry's inputs (D-294) and a board's lanes and cards (D-301). The views
  // part has carried them since M26 U6, and this list did not say so until M27
  // U3 — so a text document with an input chosen could not be saved as text.
  'format_view_column',
  // A format's saved views (M53 U5, D-520), in the same part.
  'format_saved_view',
  // A dashboard's blocks (M53 U7, D-521), in the same part.
  'format_dashboard_block',
  'measurement_unit',
  // The document's currency (M29 F3, D-344), in the settings part.
  'document_setting',
  // What was read in, and which rows each read wrote (M38 U3, D-408) — the
  // readings part. Before it, a read into a text document could not be saved.
  'format_intake',
  'format_intake_column',
  'format_intake_row',
  'format_intake_header_cell',
  'format_reader',
])

function tablesOf(db: Database): readonly string[] {
  return query(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).map((row) => String(row['name']))
}

function rowCount(db: Database, table: string): number {
  const value = query(db, `SELECT COUNT(*) AS n FROM "${table}"`)[0]?.['n']
  return typeof value === 'number' ? value : 0
}

/**
 * One table's whole contents, canonically — for comparison and nothing else.
 *
 * Sorted after rendering rather than by a key, because this runs over tables
 * this file knows nothing about and the only ordering available in all of them
 * is the one the rows themselves spell.
 */
function contentOf(db: Database, table: string): string {
  return query(db, `SELECT * FROM "${table}"`)
    .map((row) => JSON.stringify(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : 1))))
    .sort()
    .join('\n')
}
