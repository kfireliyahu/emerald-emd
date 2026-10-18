/**
 * Opening a `.emd` from disk, and the gate that decides whether this
 * build of the plugin is allowed to say anything about it.
 *
 * This is the first file of the plugin because it is the one rule that cannot
 * be retrofitted (docs/f14 trap 1, D-092). Every other tool the milestone adds
 * arrives through `openDocument`, so the gate is not something a later tool can
 * forget to ask for.
 *
 * **The plugin never migrates.** `openDatabase` in `data/db/database.ts`
 * migrates upward unconditionally, which is correct in the app — there the code
 * that migrates is the code that renders. Here it is destructive: a plugin one
 * schema ahead of the user's app would answer a read-only question and write a
 * newer `schema_version` back, leaving that app correctly refusing to open its
 * owner's own document with `SchemaTooNewError`. So the plugin calls
 * `openDatabaseWithoutMigrating`, reads the version, and stops.
 *
 * **It does bring the pack up to date** (M36 U02, D-378), which is not the
 * same thing: a migration changes the engine's own tables and the version an
 * older app checks, while a pack's growth is declarations and rows the
 * document's own reconciler adopts, which the app does on every open anyway.
 * Without it, every pack change left a document unwritable until it was
 * opened in the app, and every repository carried a probe and a second read
 * path for the shape before. So every open — a read or a write — installs what
 * this build's packs declare into the copy in memory. A read never saves it; a
 * write saves it with its own change, under the lock (`write.ts`).
 *
 * A document is opened from its bytes into memory. Nothing here writes; the
 * file on disk is not even held open past `readFile`.
 */

import { readFile } from 'node:fs/promises'
import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import { SCHEMA_VERSION, inTransaction, readSchemaVersion, setQueryOnly } from '@/data/db/database.ts'
import { documentHasLedger, ledgerFormatNames } from '@/data/packs/ledger/pack.ts'
import { LedgerMissingError } from '@/data/packs/ledger/tables.ts'
import { bringUpToDate } from '@/data/packs/packs.ts'
import { keepChangeMarks } from '@/data/repositories/formatRepository.ts'
import {
  openEncodedWithoutMigrating,
  type DocumentEncoding,
} from '@/data/storage/encoding.ts'

/** The plugin's own version, which is not the schema version. */
export const PLUGIN_VERSION = '0.1.0'

export interface OpenDocument {
  readonly path: string
  readonly schemaVersion: number
  readonly db: Database
  /**
   * Which shape the file was in — SQLite bytes or text (M22 U6, D-246).
   *
   * Carried through so that **a write puts the document back the way it was
   * found**. The format is a property of the file and this surface does not get
   * an opinion about it: a plugin that saved a text document as binary would
   * silently undo a choice somebody made in the app, and the diff a person
   * chose text *for* would be gone from the next commit.
   */
  readonly encoding: DocumentEncoding
}

/**
 * Why the plugin will not serve a document.
 *
 * A code as well as a message because Claude reads the message and later tools
 * branch on the code — `SCHEMA_BEHIND` is the one a user can fix in thirty
 * seconds, and telling them exactly how is most of the value of refusing.
 */
export interface DocumentProblem {
  readonly code:
    | 'UNREADABLE'
    | 'NOT_A_DOCUMENT'
    | 'SCHEMA_BEHIND'
    | 'SCHEMA_AHEAD'
    /** `create_document` was pointed at a path that is already something. */
    | 'ALREADY_EXISTS'
    /** The document keeps a ledger this build's pack would not install onto (D-378). */
    | 'PACK_REFUSED'
  readonly message: string
  /** Absent when the file could not be read far enough to have one. */
  readonly fileSchemaVersion?: number
}

/**
 * The gate itself, as a function of one number, so that both directions are
 * testable without fabricating a document at a schema this build cannot write.
 *
 * Both directions refuse, and they refuse with different advice, because the
 * two mismatches are fixed at opposite ends: an old document is fixed by the
 * app, and an old plugin is fixed by rebuilding the plugin.
 */
export function assessSchema(fileSchemaVersion: number, path: string): DocumentProblem | undefined {
  if (fileSchemaVersion === SCHEMA_VERSION) return undefined

  if (fileSchemaVersion === 0) {
    return {
      code: 'NOT_A_DOCUMENT',
      message:
        `${path} is a readable SQLite database but records no schema version, ` +
        'so it is not an Emerald document.',
      fileSchemaVersion,
    }
  }

  if (fileSchemaVersion < SCHEMA_VERSION) {
    return {
      code: 'SCHEMA_BEHIND',
      message:
        `${path} is at schema version ${fileSchemaVersion}; this plugin build understands ` +
        `version ${SCHEMA_VERSION}. Open the document in the Emerald app once — ` +
        'the app will migrate it and save it — then ask again. The plugin will not migrate it: ' +
        'migrating a document from out here is how you end up with a file the app itself can ' +
        'no longer open.',
      fileSchemaVersion,
    }
  }

  return {
    code: 'SCHEMA_AHEAD',
    message:
      `${path} is at schema version ${fileSchemaVersion}, which is newer than the ` +
      `version ${SCHEMA_VERSION} this plugin build understands. Rebuild the plugin from a ` +
      'current checkout (`npm run build:plugin`) rather than reading the document with this one.',
    fileSchemaVersion,
  }
}

/**
 * Read a `.emd` and hand back a database the caller may query, or the
 * reason it will not.
 *
 * The caller owns the returned `db` and must `close()` it. Nothing is cached
 * between calls: the plugin holds no document open, which is why the tools are
 * named for questions rather than for a session (see `documentInfo.ts`).
 */
export async function openDocument(path: string): Promise<Result<OpenDocument, DocumentProblem>> {
  const opened = await openGated(path)
  if (opened.ok) {
    // Read-only by the engine rather than by intention. `PRAGMA query_only`
    // means a write cannot happen by accident — not through a repository
    // function, not through a mistake nobody notices because the document is
    // only rewritten on `export` (D-094).
    setQueryOnly(opened.value.db, true)
  }
  return opened
}

/**
 * The same document, opened so that it can be changed.
 *
 * A separate exported name rather than an option on `openDocument`, for the
 * reason `openDatabaseWithoutMigrating` is a separate name: **the moment a
 * caller stops being read-only should be legible in a diff**. Everything that
 * writes goes through `writeDocument` in `write.ts`, which is this plus an
 * atomic save.
 */
export async function openDocumentForWriting(
  path: string,
): Promise<Result<OpenDocument, DocumentProblem>> {
  const opened = await openGated(path)
  if (opened.ok) setQueryOnly(opened.value.db, false)
  return opened
}

/** Read the bytes, refuse the wrong schema, and leave the mode to the caller. */
async function openGated(path: string): Promise<Result<OpenDocument, DocumentProblem>> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(path)
  } catch (error) {
    return err({ code: 'UNREADABLE', message: `Cannot read ${path}: ${describe(error)}` })
  }

  let db: Database
  let encoding: DocumentEncoding
  try {
    // Either shape, detected from the file (D-246). A text document is rebuilt
    // at the version its own header records, which is what keeps the refusals
    // below saying the same thing they say about a binary one.
    ;({ db, encoding } = await openEncodedWithoutMigrating(bytes))
  } catch (error) {
    return err({
      code: 'UNREADABLE',
      message: `${path} is not an Emerald document this plugin can open: ${describe(error)}`,
    })
  }

  let schemaVersion: number
  try {
    schemaVersion = readSchemaVersion(db)
  } catch (error) {
    db.close()
    return err({ code: 'UNREADABLE', message: `Cannot read ${path}: ${describe(error)}` })
  }

  const problem = assessSchema(schemaVersion, path)
  if (problem !== undefined) {
    // Closed rather than returned alongside the refusal: a document the plugin
    // will not serve is one no caller may hold a handle to by accident.
    db.close()
    return err(problem)
  }

  // **Up to what this build's packs declare, before anything reads it** (D-378).
  // In memory only: a read closes it unsaved, and a write saves it with its own
  // change. One transaction, so a refusal half-way leaves nothing half-done in
  // the copy either.
  let upToDate: ReturnType<typeof bringUpToDate>
  try {
    upToDate = inTransaction(db, () => {
      const brought = bringUpToDate(db, Date.now())
      // **And the triggers that mark a format's change** (M47 U5, D-462), for a
      // document the app has not opened since there were any: a write from
      // here moves its own format's mark like a write in the app.
      if (brought.ok) keepChangeMarks(db)
      return brought
    })
  } catch (error) {
    db.close()
    return err({ code: 'UNREADABLE', message: `Cannot bring ${path} up to date: ${describe(error)}` })
  }
  if (!upToDate.ok) {
    db.close()
    return err({
      code: 'PACK_REFUSED',
      message:
        `${path} keeps a ledger this build's pack will not install onto: ${upToDate.error} ` +
        'Nothing was changed. The app says the same when it opens the document, and shows the ' +
        'format in the way at #/formats.',
      fileSchemaVersion: schemaVersion,
    })
  }

  return ok({ path, schemaVersion, db, encoding })
}

/**
 * A refusal, rendered for the conversation.
 *
 * One renderer rather than one per tool, because the refusal is the same fact
 * whichever question provoked it and a user who reads two different wordings
 * for one problem learns there are two problems.
 */
export function refusalText(path: string, problem: DocumentProblem): string {
  const found =
    problem.fileSchemaVersion === undefined ? 'unknown' : String(problem.fileSchemaVersion)
  return [
    `REFUSED — this plugin will not serve ${path}.`,
    '',
    problem.message,
    '',
    `Document schema version: ${found}. Plugin understands: ${SCHEMA_VERSION}. ` +
      `Reason code: ${problem.code}.`,
  ].join('\n')
}

/**
 * Open, read, close — the shape of every read tool.
 *
 * The document is opened fresh for each call and closed in a `finally`, so the
 * plugin holds nothing between calls and a tool that throws does not leak a
 * wasm heap. Its real job, though, is that **the schema gate guards every tool
 * by construction**: a tool reaches its own body only by going through here,
 * so tier 1 could not have added nine ways to skip the gate even carelessly.
 */
export async function readDocument(
  path: string,
  read: (document: OpenDocument) => string | Promise<string>,
): Promise<string> {
  const opened = await openDocument(path)
  if (!opened.ok) return refusalText(path, opened.error)

  try {
    // Awaited inside the `try`, so the document stays open while a read that
    // has to open another one — a row elsewhere (M47 U4) — finishes.
    return await read(opened.value)
  } catch (error) {
    const refused = noLedgerRefusal(path, opened.value.db, error)
    if (refused !== undefined) return refused
    throw error
  } finally {
    opened.value.db.close()
  }
}

/**
 * **A ledger tool asked about a document that keeps no ledger** (M36 U03).
 *
 * Since D-378 no repository probes for the shape it reads, so a ledger tool on
 * a document of declared formats alone reaches a `fmt_` table that is not
 * there. That is not this server's fault and not a fact the document said; it
 * is a question with no ledger to ask, and it is answered in one sentence here
 * — the one path every read and every write goes through — rather than by a
 * check in each of the ledger's tools.
 *
 * Only for a document the pack has never seeded, and only for a missing table
 * the ledger declares: anything else is still a failure and still says so.
 */
export function noLedgerRefusal(path: string, db: Database, error: unknown): string | undefined {
  if (!missesLedger(error)) return undefined
  if (documentHasLedger(db)) return undefined
  return (
    `${path} keeps no ledger — it holds declared formats only, so there is nothing here for a ` +
    'money tool to read or write. Nothing was changed. The `format` tools read what it does ' +
    'declare; a ledger is kept by choosing it for the document in the app.'
  )
}

function missesLedger(error: unknown): boolean {
  if (error instanceof LedgerMissingError) return true
  const table = /no such table: fmt_([a-z0-9_]+)/.exec(error instanceof Error ? error.message : String(error))?.[1]
  if (table === undefined) return false
  return ledgerFormatNames().has(table.replace(/__derived$/, ''))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
