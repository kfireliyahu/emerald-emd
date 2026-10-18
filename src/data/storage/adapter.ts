/**
 * Where the document lives. One interface, selected by feature detection
 * rather than a build flag, so both paths stay exercised (D-021).
 *
 * IndexedDB auto-persist for hosted mode is deliberately absent: it is blocked
 * on `file://`, which is the distribution mode, and step 3 of docs/13 does not
 * call for it. The crash snapshot in `crashCache.ts` covers the same failure
 * for both modes.
 */

import { DOCUMENT_EXTENSION } from '../../../electron/bridge.ts'
import type { MarkReading } from './externalChange.ts'
import { instantDate } from '@/core/instant.ts'
import { toYearMonthString, yearMonthOf } from '@/core/time.ts'

export interface OpenedDocument {
  readonly bytes: Uint8Array
  readonly name: string
}

export interface StorageAdapter {
  readonly id: 'file-system' | 'download' | 'desktop'
  /** What the UI tells the user about where their data goes. */
  describe(): string
  /** True when saving is silent. False means every save is a download. */
  readonly canSaveSilently: boolean
  /**
   * The open document's absolute path, when there is one to name (M26 U7).
   * Only the shell has it — a browser hands the page a handle or a download,
   * never a path — and it is what the MCP screen fills into its snippet.
   */
  location?(): string | undefined
  open(): Promise<OpenedDocument | undefined>
  /**
   * Open a document the user chose somewhere other than this app's picker —
   * a double-click, the File menu's recents (D-128). Only the shell has one:
   * a browser adapter has no name for a file it was not just handed.
   */
  openPath?(path: string): Promise<OpenedDocument | undefined>
  /** Returns the name it was saved under, so the UI can show it. */
  save(bytes: Uint8Array, suggestedName: string): Promise<string | undefined>
  /**
   * Save to a file the user picks, and keep writing there afterwards. The way
   * out of a conflict that loses nothing: the disk keeps the other writer's
   * version and this session's work lands beside it (D-092).
   */
  saveAs(bytes: Uint8Array, suggestedName: string): Promise<string | undefined>
  /**
   * What the file on disk looks like now — cheap facts, no content. `unwatched`
   * where the adapter has nothing to watch; see `externalChange.ts`.
   */
  readMark(): Promise<MarkReading>
  /**
   * Re-read the same file with no picker, for "the file changed, reload it".
   * `undefined` where the adapter cannot reach the file again on its own.
   */
  reread(): Promise<OpenedDocument | undefined>
  /**
   * Be told the file changed instead of having to ask. Returns an unsubscribe.
   *
   * Optional, and absent on both browser adapters for the same reason: the
   * File System Access API has no change events and a download has no file to
   * watch. Only the desktop shell can push (D-127); `useDiskWatch` keeps the
   * check on focus either way, because a watcher is a better trigger for the
   * same question rather than a different question.
   */
  watch?(onChange: () => void): () => void
  /**
   * Keep a copy of the document as it was, in its folder of earlier copies
   * (D-470) — M25 U2's conversion, and a named copy since D-399. Returns
   * where it went, or `undefined` when one by that name is already there (the
   * first copy is the one worth keeping) or the adapter has nowhere to put it.
   *
   * Optional, and only the shell has one: a browser adapter cannot write a
   * file it was not handed, and a download never overwrites anything.
   */
  backup?(bytes: Uint8Array, label: string): Promise<string | undefined>
}

/**
 * `untitled-2026-08.emd` — the date makes an accidental overwrite recoverable.
 *
 * **Untitled, not a word from any pack** (M38 F1): a new document keeps no pack
 * until it is asked to (D-405), so the name it is first saved under says only
 * that it has not been named yet. This is the one place it is written.
 */
export function suggestedFileName(now: Date = new Date()): string {
  return `untitled-${toYearMonthString(yearMonthOf(instantDate(now.getTime())))}${DOCUMENT_EXTENSION}`
}

/**
 * Defined by the shell, because the shell is what registers it with the
 * operating system and what filters the native dialogs by it. Re-exported here
 * so the app's own code has one obvious place to import it from.
 */
export { DOCUMENT_EXTENSION }
