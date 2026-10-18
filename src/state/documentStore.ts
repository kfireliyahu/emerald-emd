/**
 * The open document: the sql.js database, whether it has unsaved changes, and
 * how to save it.
 *
 * One store per feature area (docs/conventions.md); components read through
 * selectors rather than taking the whole store.
 */

import { create } from 'zustand'
import type { Database } from 'sql.js'

import { createDatabase, exportDatabase, SchemaTooNewError } from '@/data/db/database.ts'
import { exportEncoded, openEncoded, type DocumentEncoding } from '@/data/storage/encoding.ts'
import { reconcileFormats } from '@/data/repositories/formatRepository.ts'
import { bringUpToDate } from '@/data/packs/packs.ts'
import { clearSnapshot, writeSnapshot } from '@/data/storage/crashCache.ts'
import { suggestedFileName, type StorageAdapter } from '@/data/storage/adapter.ts'
import {
  compareToDisk,
  copyFileName,
  followsDisk,
  wouldOverwrite,
  type DiskState,
  type FileMark,
} from '@/data/storage/externalChange.ts'
import { createDesktopAdapter, isDesktopShell } from '@/data/storage/desktop.ts'
import { createDownloadAdapter, downloadBytes } from '@/data/storage/download.ts'
import { namedCopyLabel, namedCopyName } from '../../electron/bridge.ts'
import { createFileSystemAdapter, isFileSystemAccessAvailable } from '@/data/storage/fileSystem.ts'

/**
 * Feature detection rather than a build flag (D-021), now three deep. The
 * shell comes first because inside it both of the others would also work —
 * Chromium is Chromium and `showSaveFilePicker` is present — and only this one
 * can watch the file (D-127).
 */
function pickAdapter(): StorageAdapter {
  if (isDesktopShell()) return createDesktopAdapter()
  return isFileSystemAccessAvailable() ? createFileSystemAdapter() : createDownloadAdapter()
}

/**
 * What the document layer is in the middle of, or `undefined` when it is not.
 *
 * A boolean until D-116's audit: `busy` was set by six operations and the
 * header rendered one word for all of them, so opening a document said
 * "saving…" and so did creating one. Six meanings is not two, which is what
 * [conventions](../../docs/conventions.md) means by preferring a union.
 */
export type BusyWith = 'creating' | 'opening' | 'saving' | 'reloading'

/**
 * A copy kept before something (M34 U6, D-399): in the document's **earlier
 * copies** in the shell, where `path` is the file — Emerald's own folder, never
 * beside the document since M48 U4 (D-470); **held** in a browser, where
 * `bytes` stay in this page until somebody downloads them or it closes.
 */
export type KeptCopy =
  | { readonly where: 'earlier-copies'; readonly what: string; readonly name: string; readonly path: string }
  | { readonly where: 'held'; readonly what: string; readonly name: string; readonly bytes: Uint8Array }

interface DocumentState {
  readonly db: Database | undefined
  readonly documentName: string
  readonly isDirty: boolean
  readonly lastSavedAt: number | undefined
  readonly busy: BusyWith | undefined
  readonly error: string | undefined
  /** Bumped on every mutation so components re-read the database. */
  readonly revision: number

  /**
   * Which shape this document is on disk — SQLite bytes or text (D-246).
   *
   * **Detected on open and kept by every save**, which is the whole of what
   * *per file* means: nothing here ever decides it, and the only thing that
   * changes it is a person saying so through `convertTo`.
   */
  readonly encoding: DocumentEncoding

  readonly adapter: StorageAdapter

  /**
   * What the file on disk looked like when we last read or wrote it, and what
   * we believe about it now (D-092). `diskState` is only ever as fresh as the
   * last `checkDisk()`; it is not a live watch.
   */
  readonly knownMark: FileMark | undefined
  readonly diskState: DiskState

  /**
   * A document the shell was asked to open — a double-click, Open Recent —
   * held because there is unsaved work in the window that opening would throw
   * away (D-128). The user answers it in `PendingOpenBar`.
   */
  readonly pendingOpen: string | undefined

  /**
   * A new document, or another one through the file picker, was asked for —
   * the title bar's New and Open…, `Ctrl+N`, `Ctrl+O`, the palette, the shell's
   * File menu — while this one has unsaved work replacing it would throw away
   * (M38 F1, U3). Answered in the same place as `pendingOpen`, with the same
   * three choices: `'new'` makes one after, `'pick'` shows the picker after.
   */
  readonly pendingReplace: 'new' | 'pick' | undefined

  /**
   * The copy kept before the last large read, or because somebody asked
   * (M34 U6, D-399) — said in a notice until it is dismissed.
   */
  readonly keptCopy: KeptCopy | undefined

  /** Replace whatever is open with a new, empty document, unsaved work or not. */
  createNew(): Promise<void>
  /**
   * A new document, asked for while one may be open: unsaved work here is
   * *never* discarded silently — it becomes `pendingReplace` and the user
   * decides, as `requestOpen` does for a path (M38 F1). Every New in the app is
   * this.
   */
  requestNew(): Promise<void>
  /**
   * Open… — the file picker, asked for while a document may be open: the same
   * question as `requestNew` before the picker shows, because what it opens
   * replaces this window (M38 U3). Every Open… in the app is this.
   */
  requestOpenFile(): Promise<void>
  /** Stay here: the question `requestNew` or `requestOpenFile` raised, put away. */
  dismissPendingReplace(): void
  /** The picker now, whatever is unsaved. The answer to a `'pick'` question. */
  openFile(): Promise<void>
  openBytes(bytes: Uint8Array, name: string): Promise<void>
  /**
   * Open a document by path, with no picker: the operating system or the File
   * menu already knows which one. Unsaved work here is *never* discarded
   * silently — it becomes `pendingOpen` and the user decides.
   */
  requestOpen(path: string): Promise<void>
  /** Open it now, whatever is unsaved. The answer to `pendingOpen`. */
  openDocumentAt(path: string): Promise<void>
  dismissPendingOpen(): void
  /**
   * Writes the document back. Refuses when the file changed underneath us,
   * leaving `diskState` for the UI to resolve; `overwrite` is the user saying
   * to write anyway.
   */
  save(options?: { readonly overwrite?: boolean }): Promise<void>
  /** Re-read the file from disk, discarding whatever is unsaved here. */
  reloadFromDisk(): Promise<void>
  /** Write this session's work to a file the user picks, leaving the other one alone. */
  saveCopyAs(): Promise<void>
  /** Compare the file on disk to what we last saw. Cheap; safe to call on focus. */
  checkDisk(): Promise<DiskState>
  /**
   * Check the disk and, when the file changed and nothing here is unsaved,
   * re-read it without asking (M27 U6). With unsaved work it only checks, and
   * the conflict stays the person's to answer.
   */
  followDisk(): Promise<DiskState>
  /** Stop showing the conflict without resolving it. The mark is not updated. */
  dismissDiskState(): void
  /**
   * Save this document in the other shape from now on — the per-file choice
   * (D-246), and the only thing in the app that makes it.
   *
   * It writes immediately, because the choice is not a preference the app
   * remembers: it is what the file *is*, and a document that claimed to be text
   * until the next save would be a promise rather than a property. A refusal —
   * a ledger the serializer cannot carry — leaves the encoding exactly as it
   * was and puts the sentence in `error`.
   */
  convertTo(encoding: DocumentEncoding): Promise<void>
  /** Run a mutation and mark the document dirty. Every write goes through here. */
  mutate(work: (db: Database) => void): void
  /**
   * Keep a copy of the document as it is in memory now, named for what it
   * comes before (M34 U6, D-399). In the shell it is a file among the
   * document's earlier copies (D-470); in a browser, which can write no file it was not handed, it is
   * held here until the page closes and saved only when asked. `undefined`
   * when no copy could be kept, with the reason in `error` — and a caller
   * about to write something large stops there.
   */
  keepCopy(what: string): Promise<KeptCopy | undefined>
  /** Save a copy held in a browser, as a download — the one way it leaves the page. */
  downloadKeptCopy(): void
  dismissKeptCopy(): void
  dismissError(): void
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  db: undefined,
  documentName: suggestedFileName(),
  isDirty: false,
  lastSavedAt: undefined,
  busy: undefined,
  error: undefined,
  revision: 0,
  // A new document is bytes, and that is the safe default rather than a
  // preference: it is the shape every document has been until now, it is the
  // only shape a ledger can be saved in, and a text one is a thing somebody
  // asks for.
  encoding: 'sqlite',
  adapter: pickAdapter(),
  knownMark: undefined,
  diskState: { kind: 'unwatched' },
  pendingOpen: undefined,
  pendingReplace: undefined,
  keptCopy: undefined,

  async createNew() {
    set({ busy: 'creating', error: undefined, pendingReplace: undefined })
    try {
      const db = await createDatabase()
      reconcileFormats(db)
      clearSnapshot()
      set({
        db,
        documentName: suggestedFileName(),
        isDirty: false,
        lastSavedAt: undefined,
        revision: get().revision + 1,
        encoding: 'sqlite',
        // Nothing on disk yet, so there is nothing to have changed.
        knownMark: undefined,
        diskState: { kind: 'unwatched' },
      })
    } catch (error) {
      set({ error: describe(error) })
    } finally {
      set({ busy: undefined })
    }
  },

  async openFile() {
    set({ busy: 'opening', error: undefined, pendingReplace: undefined })
    try {
      const opened = await get().adapter.open()
      if (opened === undefined) return
      await get().openBytes(opened.bytes, opened.name)
      await noteMark(set, get)
    } catch (error) {
      set({ error: describe(error) })
    } finally {
      set({ busy: undefined })
    }
  },

  async requestNew() {
    // The same test as `requestOpen`: nothing unsaved means the file on disk, or
    // nothing at all, holds everything this window holds.
    if (get().db !== undefined && get().isDirty) {
      set({ pendingReplace: 'new' })
      return
    }
    await get().createNew()
  },

  async requestOpenFile() {
    // Asked before the picker rather than after it: a browser hands back bytes
    // with no path to hold, and the question is about this window, not the file.
    if (get().db !== undefined && get().isDirty) {
      set({ pendingReplace: 'pick' })
      return
    }
    await get().openFile()
  },

  dismissPendingReplace() {
    set({ pendingReplace: undefined })
  },

  async requestOpen(path) {
    // A document already open with nothing unsaved is safe to replace: the file
    // on disk holds everything this window holds.
    if (get().db !== undefined && get().isDirty) {
      set({ pendingOpen: path })
      return
    }
    await get().openDocumentAt(path)
  },

  async openDocumentAt(path) {
    const openPath = get().adapter.openPath
    if (openPath === undefined) return

    set({ busy: 'opening', error: undefined, pendingOpen: undefined })
    try {
      const opened = await openPath(path)
      if (opened === undefined) return
      await get().openBytes(opened.bytes, opened.name)
      await noteMark(set, get)
    } catch (error) {
      set({ error: describe(error) })
    } finally {
      set({ busy: undefined })
    }
  },

  dismissPendingOpen() {
    set({ pendingOpen: undefined })
  },

  async openBytes(bytes, name) {
    try {
      // **Either shape, and the file decides** (D-246). What comes back is
      // carried into the state, because every save from here on has to put the
      // document back the way it was found.
      const { db, encoding, migrated } = await openEncoded(bytes)
      // **The declarations are the source of truth and the tables follow**
      // (D-214). Here rather than inside `openDatabase`, for the same reason
      // migration is the app's job exclusively: the plugin opens a document
      // read-only to answer a question and must not reshape it on the way past.
      // Idempotent, so a refusal is simply left standing for the formats screen
      // to show — a document never fails to open because it disagrees with
      // itself.
      reconcileFormats(db)
      // **The ledger is per document** (D-266): a document that keeps one gets
      // what this build's pack declares and seeds (M25 U1), and every bank
      // account its own cash (M30 F2) — the same step the plugin takes on every
      // read and write (M36 U02, D-378), so no screen meets an older shape.
      const upToDate = bringUpToDate(db, Date.now())
      const changed = upToDate.ok ? upToDate.value.changed : 0
      clearSnapshot()
      set({
        db,
        documentName: name,
        // Another document is open now, so a New or an Open… asked for over the
        // last one has nothing left to protect.
        pendingReplace: undefined,
        encoding,
        // A migration is a change like any other: held only in memory, it is
        // lost on close and the file stays behind for the plugin, which
        // refuses rather than migrate.
        isDirty: migrated || changed > 0,
        lastSavedAt: undefined,
        // **A refused install is said, not left standing** (M25 U2): a ledger
        // screen would otherwise read a declaration the pack did not bring up.
        error:
          upToDate.ok
            ? undefined
            : `The ledger in this document is not what this build declares. ${upToDate.error}`,
        revision: get().revision + 1,
        // Cleared rather than kept: `openBytes` is also how a crash snapshot is
        // restored, and those bytes are not what is on disk. The caller that
        // does know — `openFile` — records the mark afterwards.
        knownMark: undefined,
        // A copy kept from the document that was open is not this one's.
        keptCopy: undefined,
        diskState: { kind: 'unwatched' },
      })
    } catch (error) {
      // A file from a newer build must be refused with an explanation, never
      // opened and quietly migrated backwards.
      set({ error: error instanceof SchemaTooNewError ? error.message : describe(error) })
    }
  },

  async save(options) {
    const { db, adapter, documentName } = get()
    if (db === undefined) return

    set({ busy: 'saving', error: undefined })
    try {
      // Checked here rather than only on focus: focus is a hint, and this is
      // the moment the bytes are about to be replaced (D-092).
      if (options?.overwrite !== true) {
        const state = await get().checkDisk()
        if (wouldOverwrite(state)) return
      }

      const encoded = await exportEncoded(db, get().encoding)
      if (!encoded.ok) {
        set({ error: encoded.error })
        return
      }

      const savedAs = await adapter.save(encoded.value, documentName)
      // A cancelled picker is not a save. The two browser adapters could never
      // reach here — one rejects with `AbortError`, the other always writes —
      // so until the desktop adapter (D-127) this branch could not happen, and
      // clearing the dirty dot on a cancel would have been a silent lie about
      // an afternoon's work.
      if (savedAs === undefined) return
      clearSnapshot()
      set({
        isDirty: false,
        lastSavedAt: Date.now(),
        documentName: savedAs,
      })
      // The file we just wrote is the file we now know about.
      await noteMark(set, get)
    } catch (error) {
      set({ error: describe(error) })
    } finally {
      set({ busy: undefined })
    }
  },

  async reloadFromDisk() {
    set({ busy: 'reloading', error: undefined })
    try {
      const opened = await get().adapter.reread()
      if (opened === undefined) {
        set({ error: 'This document cannot be re-read — open it again from the file picker.' })
        return
      }
      await get().openBytes(opened.bytes, opened.name)
      await noteMark(set, get)
    } catch (error) {
      set({ error: describe(error) })
    } finally {
      set({ busy: undefined })
    }
  },

  async saveCopyAs() {
    const { db, adapter, documentName } = get()
    if (db === undefined) return

    set({ busy: 'saving', error: undefined })
    try {
      const encoded = await exportEncoded(db, get().encoding)
      if (!encoded.ok) {
        set({ error: encoded.error })
        return
      }

      const savedAs = await adapter.saveAs(encoded.value, copyFileName(documentName))
      if (savedAs === undefined) return
      clearSnapshot()
      set({ isDirty: false, lastSavedAt: Date.now(), documentName: savedAs })
      await noteMark(set, get)
    } catch (error) {
      set({ error: describe(error) })
    } finally {
      set({ busy: undefined })
    }
  },

  async checkDisk() {
    const { adapter, knownMark, isDirty } = get()
    if (get().db === undefined) return { kind: 'unwatched' }
    const state = compareToDisk(knownMark, await adapter.readMark(), isDirty)
    set({ diskState: state })
    return state
  },

  async followDisk() {
    const state = await get().checkDisk()
    // Asked again after the await rather than trusted from the check: an edit
    // made while the mark was being read is unsaved work, and re-reading now
    // would throw it away without a word.
    if (followsDisk(state) && !get().isDirty && get().busy === undefined) {
      await get().reloadFromDisk()
      return get().diskState
    }
    return state
  },

  dismissDiskState() {
    set({ diskState: { kind: 'unwatched' } })
  },

  async convertTo(encoding) {
    if (get().db === undefined || get().encoding === encoding) return

    // Set first and saved second, so `save` needs no encoding argument and
    // there is one place that reads it. Put back on a refusal, which is the
    // reason this is not simply two statements at the call site: a document
    // that could not be written as text must not be left believing it is.
    const was = get().encoding
    set({ encoding })
    await get().save({ overwrite: true })
    if (get().error !== undefined) set({ encoding: was })
  },

  mutate(work) {
    const { db } = get()
    if (db === undefined) throw new Error('No document is open')

    work(db)
    set({ isDirty: true, revision: get().revision + 1 })

    // Snapshot immediately after a mutation rather than only on a timer, so the
    // most expensive thing to lose — a just-committed import — is covered even
    // if the tab dies a second later.
    //
    // **Always bytes, whatever the document is** (D-246). This is a copy of
    // memory rather than a document somebody reads, and it must never refuse:
    // an encoding that can say *no, not this document* has no business standing
    // between a mutation and the only record of it.
    writeSnapshot(exportDatabase(db), get().documentName, Date.now())
  },

  dismissError() {
    set({ error: undefined })
  },

  async keepCopy(what) {
    const { db, adapter, documentName } = get()
    if (db === undefined) return undefined
    try {
      // In the document's own shape, like a save (D-246): the copy opens as
      // the document it was.
      const encoded = await exportEncoded(db, get().encoding)
      if (!encoded.ok) {
        set({ error: encoded.error })
        return undefined
      }
      const label = namedCopyLabel(what, new Date())
      const path = await adapter.backup?.(encoded.value, label)
      const kept: KeptCopy =
        path !== undefined
          ? { where: 'earlier-copies', what, name: path.split(/[\\/]/).pop() ?? path, path }
          : { where: 'held', what, name: namedCopyName(documentName, label), bytes: encoded.value }
      set({ keptCopy: kept })
      return kept
    } catch (error) {
      set({ error: `No copy could be kept, so nothing was written: ${describe(error)}` })
      return undefined
    }
  },

  downloadKeptCopy() {
    const kept = get().keptCopy
    if (kept?.where !== 'held') return
    downloadBytes(kept.bytes, kept.name)
  },

  dismissKeptCopy() {
    set({ keptCopy: undefined })
  },

}))

/**
 * Record the file as we now know it, and clear any conflict: whatever the disk
 * held, we have just read or written it.
 */
async function noteMark(
  set: (partial: Partial<DocumentState>) => void,
  get: () => DocumentState,
): Promise<void> {
  const reading = await get().adapter.readMark()
  set({
    knownMark: reading.kind === 'mark' ? reading.mark : undefined,
    diskState: reading.kind === 'mark' ? { kind: 'in-sync' } : { kind: 'unwatched' },
  })
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return ''
  return error instanceof Error ? error.message : String(error)
}
