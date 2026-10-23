/**
 * The write path: creating a document, and saving one back.
 *
 * This is the first code in the plugin that changes anything on disk, and it
 * arrived with `create_document` on purpose (D-096). Creating a file that does
 * not exist is the only write in this milestone that needs none of the
 * safeguards the mutating tools will need — nothing to back up, no row to label
 * with provenance, and a dry-run diff that would read "an empty document" —
 * while still exercising every part of the machinery below. So the machinery
 * gets proven where a bug costs the user nothing.
 *
 * Two rules hold here and will keep holding when the mutating tools land:
 *
 * - **The document is replaced atomically.** Bytes go to a temp file beside the
 *   target and are renamed over it, so a crash half-way leaves the original
 *   intact rather than a truncated SQLite file. The document is the user's only
 *   copy (D-021), and a partial write is the one failure with no recovery.
 * - **Nothing is saved unless the work succeeded.** The mutation runs inside
 *   `inTransaction`, and the export happens only after it returns.
 */

import { open, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import {
  SCHEMA_VERSION,
  createDatabase,
  inTransaction,
} from '@/data/db/database.ts'
import { keepPack, type PackDescription } from '@/data/packs/packs.ts'
import { listFormats, rowCountOf } from '@/data/repositories/formatRepository.ts'
import { exportEncoded, type DocumentEncoding } from '@/data/storage/encoding.ts'

import {
  noLedgerRefusal,
  openDocument,
  openDocumentForWriting,
  readDocument,
  refusalText,
  type DocumentProblem,
  type OpenDocument,
} from './document.ts'
import { BACKUPS_KEPT, backupDocument, backupFolderFor, keepNamedCopy, type BackupResult } from './backup.ts'
import { NAMED_COPIES_KEPT, NAMED_COPY_ROWS, ORPHANED_COPIES_DAYS, writeAtomically } from '../../electron/bridge.ts'

/**
 * Write `db` over `path`, atomically, **in the shape the file already was**
 * (D-246).
 *
 * `rename` within a directory is atomic, which is the whole reason for the temp
 * file: the alternative — truncating the real document and streaming bytes into
 * it — has a window in which a crash leaves the user with neither the old file
 * nor the new one. Byte-agnostic, so text costs it nothing.
 *
 * The encoding is required rather than defaulted. A default would be this
 * surface having an opinion about a property of somebody else's file, and the
 * one call site that saves already knows what it opened.
 */
async function saveDocument(
  path: string,
  db: Database,
  encoding: DocumentEncoding,
): Promise<void> {
  const encoded = await exportEncoded(db, encoding)
  // Thrown rather than returned: this is called from inside `writeDocument`,
  // after the work has already run and committed in memory, and a refusal there
  // must abort the save rather than be a value somebody forgets to read. The
  // document on disk is untouched either way.
  if (!encoded.ok) throw new Error(encoded.error)

  // The shell's own atomic write: a failed write or rename leaves no scratch file
  // behind, and the original is untouched either way.
  await writeAtomically({ pid: process.pid, writeFile, rename, unlink }, path, encoded.value)
}

/**
 * Create a brand-new document at this build's schema.
 *
 * **Refuses a path that already exists**, and does it with the `wx` open flag
 * rather than by checking first: a check followed by a write has a window
 * between them, and the window is one in which somebody's document gets
 * overwritten. There is deliberately no force flag — this tool is not an
 * overwrite with a friendly name.
 */
export async function createDocumentFile(
  path: string,
  /** The packs it starts with, in the order they are kept (M38 U7, D-405). */
  packs: readonly PackDescription[],
  /**
   * How the new file is stored (D-246): SQLite bytes unless asked. `emerald-mcp init` asks for
   * text when the document goes inside the repository, so it is committed and diffs (M50 U1).
   */
  encoding: DocumentEncoding = 'sqlite',
): Promise<Result<number, DocumentProblem>> {
  const db = await createDatabase()
  // Each pack is kept before the first byte is written, as the Packs screen
  // would keep it on the open document — declared, converted and seeded.
  for (const pack of packs) {
    const kept = keepPack(db, pack, Date.now())
    if (!kept.ok) {
      db.close()
      return err({ code: 'UNREADABLE', message: `Could not create ${path}: ${kept.error}` })
    }
  }
  const encoded = await exportEncoded(db, encoding)
  db.close()
  if (!encoded.ok) return err({ code: 'UNREADABLE', message: `Could not create ${path}: ${encoded.error}` })
  const bytes = encoded.value

  try {
    const handle = await open(path, 'wx')
    try {
      await handle.writeFile(bytes)
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      return err({
        code: 'ALREADY_EXISTS',
        message:
          `${path} already exists, and this tool will not overwrite a document. ` +
          'Choose another path, or ask `document_info` what is in the one that is there.',
      })
    }
    return err({
      code: 'UNREADABLE',
      message: `Could not create ${path}: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  // `createDatabase` migrates to this build's schema by construction, so the
  // number is not read back — there is nothing that could make it differ.
  return ok(SCHEMA_VERSION)
}

/**
 * Open a document for writing, gate it, run the work, and save if it succeeded.
 *
 * The mirror of `readDocument`, and deliberately a separate function with a
 * different name rather than a flag on that one: **leaving the read-only mode
 * is the thing that should be visible in a diff** (D-094). A reviewer can tell
 * whether a tool writes by which helper it calls, without reading its body.
 *
 * **The pack is installed before the work, under the lock** (M36 U02, D-378):
 * the open brings the document up to what this build declares, and the save
 * writes that with the change. So a document made before the latest pack
 * change takes a write with no app open, and the work never meets an older
 * shape. The backup, taken after the gate, is still the bytes on disk.
 */
export async function writeDocument(
  path: string,
  work: (document: OpenDocument) => string,
  options: { readonly afterGate?: (document: OpenDocument) => Promise<void> } = {},
): Promise<string> {
  // **One writer at a time, from read to rename** (M27 U6). Without it two
  // plugin processes each read the file, each change their copy, and the
  // second rename silently undoes the first — and a conditional write (`expect`)
  // would tell both sessions the unit was theirs.
  return holdingLock(path, () => writeHeld(path, work, options))
}

async function writeHeld(
  path: string,
  work: (document: OpenDocument) => string,
  options: { readonly afterGate?: (document: OpenDocument) => Promise<void> },
): Promise<string> {
  const opened = await openDocumentForWriting(path)
  if (!opened.ok) return refusalText(path, opened.error)

  const document = opened.value
  try {
    // Between the gate and the mutation, which is the only correct place for a
    // backup: a refused document must not leave a `.bak` behind explaining that
    // nothing happened, and a copy taken after the write would copy the wrong
    // thing.
    //
    // The open document is handed over because whether a copy is *wanted* can
    // depend on what is in it — onboarding's writes take none while the
    // document is minutes old and take one afterwards (D-110). Reading that
    // from the already-open handle beats opening the file a second time, and it
    // is still the bytes on disk that get copied, since nothing is saved until
    // the mutation returns.
    await options.afterGate?.(document)
    // A bank account's own cash is made with the account (M36 U08), so nothing
    // is held to after the work any more.
    const answer = inTransaction(document.db, () => work(document))
    await saveDocument(path, document.db, document.encoding)
    return answer
  } catch (error) {
    // Rolled back already; a ledger tool on a document with none says so (M36 U03).
    const refused = noLedgerRefusal(path, document.db, error)
    if (refused !== undefined) return refused
    throw error
  } finally {
    document.db.close()
  }
}

/** How long a writer waits for another to finish before refusing. */
const LOCK_WAIT_MS = 10_000
/**
 * A lock older than this is a writer that died holding it. A write is one
 * open, one transaction and one rename — well under a second on memory.emd —
 * so a minute is a crash and not a slow write.
 */
export const LOCK_STALE_MS = 60_000

/** The lock beside a document: `memory.emd` → `memory.emd.lock`. */
export function lockPathFor(path: string): string {
  return `${path}.lock`
}

/**
 * Run `work` holding `<path>.lock`, made with the `wx` flag so taking it is
 * one atomic step rather than a check and a write. **It serializes the plugin's
 * writers and nothing else**: the app does not take it, and does not need to —
 * its save checks the file's mark first (D-092) and refuses to overwrite a
 * change it has not seen.
 */
async function holdingLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lock = lockPathFor(path)
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const handle = await open(lock, 'wx')
      try {
        await handle.writeFile(`${String(process.pid)} ${new Date().toISOString()}\n`)
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const held = await stat(lock).catch(() => undefined)
      if (held !== undefined && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
        await unlink(lock).catch(() => undefined)
        continue
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Another writer has held ${lock} for over ${String(LOCK_WAIT_MS / 1000)} seconds. ` +
            'Nothing was changed; try again in a moment.',
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30))
    }
  }
  try {
    return await work()
  } finally {
    await unlink(lock).catch(() => undefined)
  }
}

/**
 * Write, taking a `.bak` first — but only when the document has something to
 * lose (D-110).
 *
 * The onboarding tools were written on the invariant that a document in its
 * first run holds nothing older than the current conversation, which is why
 * they take no copy. The invariant is true and the conclusion drawn from it was
 * too strong: it justified skipping the copy, and it was used to refuse the
 * write outright once the first run was over. This is the same invariant with
 * the right conclusion — the predicate decides which of two protections applies,
 * and the answer says which one it was.
 *
 * There is no dry run here on purpose. These writes are additive or reversible
 * by their own tool (an archived category comes back), so a preview would show
 * a diff nobody needs to see; the copy is what stands behind them.
 */
export async function writeWithBackup(
  path: string,
  needsBackup: (document: OpenDocument) => boolean,
  work: (document: OpenDocument) => string,
): Promise<string> {
  let backup: BackupResult | undefined

  const answer = await writeDocument(path, work, {
    afterGate: async (document) => {
      if (!needsBackup(document)) return
      try {
        backup = await backupDocument(path)
      } catch (error) {
        throw new Error(
          'Refusing to write: the backup failed ' +
            `(${error instanceof Error ? error.message : String(error)}). Nothing was changed.` +
            copiesAreIn(path),
        )
      }
    },
  })

  const note = backup === undefined ? undefined : backupNoteOnce(path, backup)
  return note === undefined ? answer : [answer, '', note].join('\n')
}

/**
 * The documents this server's run has already told where their copies go
 * (M52 F2).
 *
 * Every write takes a copy, and every write used to say so in a paragraph: a
 * session of forty writes read the same paragraph forty times. **The first
 * write to a document in a run says where its copies go, and the rest are
 * silent.** The copy is still taken every time; `keep_copy`, a named copy and
 * a refusal still name where the copies are, because those are the moments
 * somebody is looking for them.
 */
const toldWhereCopiesGo = new Set<string>()

/** The rolling copy's note the first time this run writes `path`, and nothing after. */
function backupNoteOnce(path: string, backup: BackupResult): string | undefined {
  const key = resolve(path)
  if (toldWhereCopiesGo.has(key)) return undefined
  toldWhereCopiesGo.add(key)
  return backupNote(backup)
}

/** What a refusal ends with: where this document's earlier copies are, so a failed write still says. */
function copiesAreIn(path: string): string {
  return ` Its earlier copies are in \`${backupFolderFor(path)}\` (File › Earlier copies of this document).`
}

function backupNote(backup: BackupResult): string {
  return (
    `The document was copied to \`${backup.path}\` first, in Emerald's own folder of earlier copies — ` +
    `the app's File › Earlier copies of this document lists them to restore. The last ${BACKUPS_KEPT} are kept; ` +
    (backup.pruned.length === 0
      ? 'nothing was pruned.'
      : `${backup.pruned.length} older one(s) were pruned.`) +
    (backup.swept === undefined || backup.swept.length === 0
      ? ''
      : ` The copies of ${backup.swept.length} document(s) gone for more than ${ORPHANED_COPIES_DAYS} days were removed.`)
  )
}

// --- the shape every mutating tool has -------------------------------------

/**
 * A change, computed before it is made.
 *
 * `plan` runs against a **read-only** document and answers "what would this
 * touch"; `describe` turns that into the diff Claude puts in the conversation;
 * `apply` makes it. Splitting them is what lets the dry run be the default
 * without every tool writing the same two code paths and eventually letting
 * them disagree.
 */
export interface Mutation<T> {
  plan(document: OpenDocument): T
  describe(plan: T): string
  apply(document: OpenDocument, plan: T): string
  /**
   * Whether this plan will write nothing at all — optional, and the answer to a
   * sentence that read wrongly (D-217).
   *
   * A tool that applies its batch whole or not at all ends a refused commit
   * with *"Nothing was written"* immediately followed by *"The document was
   * copied to …"*, because the copy is taken between the gate and the mutation
   * and the mutation is what decides. The copy is harmless and the sentence is
   * not: this surface's whole discipline is that what it says happened is what
   * happened. A mutation that can know in advance says so here and the copy is
   * skipped; one that cannot leaves this out and nothing changes for it.
   */
  refuses?(plan: T): boolean
  /**
   * What this plan comes before, and how many rows it writes (M34 U6, D-399).
   * A plan of `NAMED_COPY_ROWS` rows or more takes a **named** copy as well as
   * the rolling one — `memory.before-…-reading-tasks-csv.emd` — kept apart
   * from the five so that the copy from before an import is still there six
   * writes later. A mutation that leaves this out never takes one.
   */
  copyBefore?(plan: T): CopyBefore | undefined
}

/** Whether no format of this document — a pack's included — holds a single row. */
function holdsNoRows(document: OpenDocument): boolean {
  return listFormats(document.db).every((format) => rowCountOf(document.db, format) === 0)
}

/** `{ what: 'reading tasks.csv', rows: 300 }` — what the copy is named for, and the size that decides it. */
interface CopyBefore {
  readonly what: string
  readonly rows: number
}

/**
 * Run a mutating tool: **a dry run unless told otherwise** (D-092, D-098).
 *
 * The gate is a second, explicit call rather than a confirmation the caller can
 * satisfy on its own — Claude has to come back with `commit: true` after
 * showing the user what it is about to do. That is the whole of what replaced
 * the app's review queue, and it is worth being blunt about what it is and is
 * not: it is a real gate on *batch size and target*, and it is not a
 * permissions system. The three things behind it are the backup, the provenance
 * on every row, and the fact that nothing here can touch a `MANUAL` assignment.
 *
 * **The dry run is read-only by the engine, not by intention.** It goes through
 * `readDocument`, so the document is open with `PRAGMA query_only` and a `plan`
 * that tried to write would fail loudly rather than quietly mutating during
 * what the user was told was a preview (D-094).
 *
 * **A dry run that will refuse does not invite a commit** (D-220). The tail
 * below says *call this tool again with `commit: true` if they agree*, and there
 * is nothing to agree to when the plan already says it will write nothing — a
 * caller that follows the instruction spends a round trip to be told the same
 * sentence again. Same discipline as the backup D-217 stopped taking for a
 * refused batch, in the other half of the same function: what this surface says
 * is what is going to happen.
 *
 * **The plan is computed again at commit time**, inside the write transaction,
 * rather than being carried over from the dry run. Two reasons: the document
 * may have changed between the calls, and a stale plan applied blind is exactly
 * the failure a dry run is supposed to prevent rather than introduce. So the
 * committed answer reports what actually happened, which can differ from what
 * the preview said — and if it does, that difference is real news.
 */
export async function mutatingCall<T>(
  path: string,
  commit: boolean,
  mutation: Mutation<T>,
): Promise<string> {
  if (!commit) {
    return readDocument(path, (document) => {
      const plan = mutation.plan(document)
      const described = mutation.describe(plan)
      if (mutation.refuses?.(plan) === true) return described
      return [
        described,
        '',
        '**Nothing has been written.** This was a dry run — show the user what is above, and ' +
          'call this tool again with `commit: true` if they agree.',
      ].join('\n')
    })
  }

  let backup: BackupResult | undefined
  let named: { readonly copy: BackupResult; readonly what: string } | undefined

  const answer = await writeDocument(
    path,
    (document) => mutation.apply(document, mutation.plan(document)),
    {
      afterGate: async (document) => {
        // Computed a second time, and deliberately: the plan is already
        // recomputed inside the transaction below rather than carried over from
        // the dry run, for the reason in this function's own comment. This one
        // asks it two questions — is there going to be a write at all, and is
        // it large enough to want a named copy before it (D-399).
        const asked = mutation.refuses !== undefined || mutation.copyBefore !== undefined
        const plan = asked ? mutation.plan(document) : undefined
        if (plan !== undefined && mutation.refuses?.(plan) === true) return

        try {
          backup = await backupDocument(path)
        } catch (error) {
          // Thrown rather than warned past. A batch with no way back is exactly
          // the thing the copy exists for, and "we could not make one, so we
          // went ahead" is the sentence nobody wants to read afterwards.
          throw new Error(
            'Refusing to write: the backup failed ' +
              `(${error instanceof Error ? error.message : String(error)}). Nothing was changed.` +
              copiesAreIn(path),
          )
        }

        const before = plan === undefined ? undefined : mutation.copyBefore?.(plan)
        if (before === undefined) return
        // **And before the first rows of all** (M38 U5), whatever their
        // number: the trial's empty starting file — formats declared, nothing
        // in them — was the one copy worth keeping, and five small writes
        // rolled it away.
        const first = before.rows > 0 && holdsNoRows(document)
        if (before.rows < NAMED_COPY_ROWS && !first) return
        try {
          named = { copy: await keepNamedCopy(path, before.what), what: before.what }
        } catch (error) {
          throw new Error(
            'Refusing to write: the copy from before it failed ' +
              `(${error instanceof Error ? error.message : String(error)}). Nothing was changed.` +
              copiesAreIn(path),
          )
        }
      },
    },
  )

  const note = backup === undefined ? undefined : backupNoteOnce(path, backup)
  return [
    answer,
    ...(named === undefined ? [] : ['', namedNote(named.copy, named.what)]),
    ...(note === undefined ? [] : ['', note]),
  ].join('\n')
}

/** The sentence a named copy is reported in — before the rolling one's, because it is the one a person comes back for. */
function namedNote(copy: BackupResult, what: string): string {
  return (
    `**A copy from before ${what} is at \`${copy.path}\`.** It opens like any document. ` +
    `Named copies sit with the rolling ones in Emerald's folder (File › Earlier copies of this document), ` +
    `pruned apart from them, the last ${NAMED_COPIES_KEPT}; ` +
    (copy.pruned.length === 0 ? 'none was removed.' : `${copy.pruned.length} older one(s) were removed.`)
  )
}

/** What a dry run ends with: nothing written, and how to write it. */
const DRY_RUN =
  '**Nothing has been written.** This was a dry run — show the user what is above, and ' +
  'call this tool again with `commit: true` if they agree.'

const STORED_AS: Record<DocumentEncoding, string> = { text: 'text', sqlite: 'SQLite bytes' }

/**
 * **The per-file choice, from a conversation** (M47 U7): the document written
 * again as text or as SQLite bytes — the app's *Save as text* and *Save as
 * SQLite* (`convertTo`, D-246). Refused by the app's own sentence when the text
 * would not carry the document (`exportEncoded`): a ledger, or links whose
 * target's names repeat (D-245). Backed up first, like every write; a dry run
 * until `commit`.
 */
export async function storeDocumentAs(path: string, encoding: DocumentEncoding, commit: boolean): Promise<string> {
  const said = STORED_AS[encoding]
  const answer = async (document: OpenDocument, write?: (bytes: Uint8Array) => Promise<string>): Promise<string> => {
    if (document.encoding === encoding) return `${path} is already stored as ${said}. Nothing to do.`
    const encoded = await exportEncoded(document.db, encoding)
    if (!encoded.ok) return encoded.error
    const size = `${String(Math.max(1, Math.round(encoded.value.length / 1024)))} KB`
    if (write === undefined) {
      return `${path} is stored as ${STORED_AS[document.encoding]}; it would be written as ${said}, ${size}, with the same formats, rows and units.\n\n${DRY_RUN}`
    }
    const note = await write(encoded.value)
    return `${path} is stored as ${said} now, ${size}. Every write from here keeps it that way.${note === '' ? '' : `\n\n${note}`}`
  }
  if (!commit) return readDocument(path, (document) => answer(document))

  return holdingLock(path, async () => {
    const opened = await openDocumentForWriting(path)
    if (!opened.ok) return refusalText(path, opened.error)
    try {
      return await answer(opened.value, async (bytes) => {
        let backup: BackupResult
        try {
          backup = await backupDocument(path)
        } catch (error) {
          throw new Error(
            `Refusing to write: the backup failed (${error instanceof Error ? error.message : String(error)}). Nothing was changed.` +
              copiesAreIn(path),
          )
        }
        await writeAtomically({ pid: process.pid, writeFile, rename, unlink }, path, bytes)
        return backupNoteOnce(path, backup) ?? ''
      })
    } finally {
      opened.value.db.close()
    }
  })
}

/**
 * Keep a named copy now, because somebody asked (`keep_copy`, D-399). Gated
 * like a read — a file that is not a document is refused, not copied — and
 * taken under the writers' lock, so it is never a document half-way through
 * somebody else's rename.
 */
export async function keepCopyNow(path: string, what: string): Promise<string> {
  return holdingLock(path, async () => {
    const opened = await openDocument(path)
    if (!opened.ok) return refusalText(path, opened.error)
    opened.value.db.close()
    return namedNote(await keepNamedCopy(path, what), what)
  })
}
