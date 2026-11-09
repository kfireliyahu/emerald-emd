/**
 * **Where a document's bytes live, behind one seam** (M57 U1, D-560).
 *
 * Every tool reaches its document by a `path`, and until this unit every one of
 * them reached the bytes by `node:fs` — `readFile` to open, a lock beside the
 * file and an atomic rename to save, a copy into Emerald's folder before a
 * write. That is one place a document can live. The Google Drive connector
 * (M57) is a second: the same tools, the bytes in the person's Drive, read at
 * the start of a call and written back at the end. So the tools now reach the
 * bytes through a `DocumentStore`, and the file on this machine is the first
 * store, `localFileStore`, which does exactly what the plugin did before.
 *
 * What a store is asked:
 *
 * - **read** the document's bytes, with a version token for what was read;
 * - **write** bytes back, given that token — and it may refuse. A store whose
 *   write is conditional (Drive's upload names the revision it read) refuses a
 *   document that changed since; the refusal reaches the tool as a refusal
 *   (`write.ts`), never as a success and never as a crash;
 * - **exclusive**: run one read-change-write from read to write without another
 *   writer in between, if it has a way to. The local store takes the lock beside
 *   the file (M27 U6); a store with a conditional write needs none;
 * - **copies**, optionally: an earlier copy before a write, and one named for
 *   what it came before (D-098, D-399). The local store keeps them in Emerald's
 *   own folder (`backup.ts`); Drive's version history is its own (D-562), so a
 *   store may have none, and then a write takes none and says nothing of one.
 *
 * **Which store a call uses is the call's, not a setting**: `withDocumentStore`
 * runs a call with one, and everything inside it — a read, a write, an open of
 * the document from deep in a tool — finds it with `documentStore()`. Outside
 * one, it is the local file. A hosted endpoint serves many people at once, each
 * call with its own; a flag held by the process could not be that.
 *
 * The bytes are the document's, in whichever encoding it is stored (D-246): a
 * store moves them and never reads them. Opening and gating them stays in
 * `document.ts`; encoding them back stays in `write.ts`.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'

import { err, ok, type Result } from '@/core/result.ts'

import { backupDocument, backupFolderFor, keepNamedCopy, type BackupResult } from './backup.ts'
import { writeAtomically } from '../../electron/bridge.ts'

/** A document's bytes as they were read, and the token a write gives back. */
export interface StoredDocument {
  readonly bytes: Uint8Array
  /**
   * What was read, as the store tells versions apart — a file's modification
   * time and size here, a Drive file's revision there. Opaque to everything but
   * the store that made it.
   */
  readonly version: string
}

/** Earlier copies of a document, kept by the store before a write (D-098, D-399, D-455). */
export interface EarlierCopies {
  /** The rolling copy, taken before a write. */
  before(path: string): Promise<BackupResult>
  /** A copy named for what it came before (`keep_copy`, and before a large batch). */
  named(path: string, what: string): Promise<BackupResult>
  /** Where this document's copies are, for a refusal to say. */
  folder(path: string): string
}

export interface DocumentStore {
  /** The document's bytes and their version, or why they could not be read. */
  read(path: string): Promise<Result<StoredDocument, string>>
  /**
   * Put `bytes` back as the document, **given the version that was read**. A
   * refusal is the sentence the person reads — nothing was written.
   */
  write(path: string, bytes: Uint8Array, version: string): Promise<Result<void, string>>
  /** Run a read-change-write with no other writer between its read and its write. */
  exclusive<T>(path: string, work: () => Promise<T>): Promise<T>
  /** Absent for a store that keeps no copies of its own. */
  readonly copies?: EarlierCopies
}

// --- the file on this machine ----------------------------------------------

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
 * **The file at `path`, as the plugin has always kept it.** Read whole with
 * `readFile`; written atomically — a temp file beside it renamed over it, so a
 * crash half-way leaves the original rather than a truncated SQLite file (the
 * document is the person's only copy, D-021); one plugin writer at a time by the
 * lock beside it; copies in Emerald's own folder (`backup.ts`).
 *
 * **Its write never refuses on the version.** The token is the file's mtime and
 * size, and nothing compares it: under the lock no other plugin writer can come
 * between the read and the write, and the app's own save is what checks the
 * file's mark (D-092). Comparing it here would be a new refusal on a store whose
 * behaviour this unit was told to keep.
 */
export const localFileStore: DocumentStore = {
  async read(path) {
    try {
      const bytes = await readFile(path)
      const info = await stat(path).catch(() => undefined)
      return ok({ bytes, version: info === undefined ? '' : `${String(info.mtimeMs)}:${String(info.size)}` })
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error))
    }
  },
  async write(path, bytes) {
    // The shell's own atomic write: a failed write or rename leaves no scratch
    // file behind, and the original is untouched either way. A failure here is
    // thrown, as it always was — a disk that will not take the bytes is this
    // server's trouble, not a refusal the document made.
    await writeAtomically({ pid: process.pid, writeFile, rename, unlink }, path, bytes)
    return ok(undefined)
  },
  exclusive: holdingLock,
  copies: {
    before: (path) => backupDocument(path),
    named: (path, what) => keepNamedCopy(path, what),
    folder: backupFolderFor,
  },
}

// --- which store a call uses -------------------------------------------------

const current = new AsyncLocalStorage<DocumentStore>()

/** The store this call reaches its document through: the one it runs with, else the local file. */
export function documentStore(): DocumentStore {
  return current.getStore() ?? localFileStore
}

/** Run `work` — a tool call, and everything it opens — with `store` as its document's. */
export function withDocumentStore<T>(store: DocumentStore, work: () => T): T {
  return current.run(store, work)
}
