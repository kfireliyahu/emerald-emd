/**
 * The third storage adapter: a real file, on a real filesystem, in the shell.
 *
 * Same seam as the other two (D-021), so nothing above it changes — the store
 * calls `open`, `save`, `readMark`, `reread` and does not learn that the file
 * is a path rather than a handle. What this one adds is the thing neither
 * browser adapter can do: `watch`, which turns D-092's mtime comparison from a
 * question asked when the window regains focus into an answer that arrives
 * while the user is still looking at the screen.
 *
 * Everything below the bridge runs in the main process (`electron/documents.ts`).
 * This file holds the one piece of state a document-based app needs — which
 * file we are working on — and keeps the shell's watch pointed at it.
 */

import {
  BRIDGE_KEY,
  type EmeraldBridge,
  type EmeraldDocuments,
  type EmeraldApp,
  type EmeraldFiles,
  type EmeraldWindow,
} from '../../../electron/bridge.ts'
import { DOCUMENT_EXTENSION, type OpenedDocument, type StorageAdapter } from './adapter.ts'
import type { MarkReading } from './externalChange.ts'

/**
 * The shell's bridge, or nothing outside the shell — the one place the app reads it.
 *
 * The preload puts it on `window` under `BRIDGE_KEY` (`electron/preload.ts`), which
 * the DOM's `Window` type does not declare, so the property is read through a
 * record and trusted as the bridge once it is an object: what else could be there
 * is decided by our own preload, not by anything a document says.
 */
export function shellBridge(): EmeraldBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const found = (window as unknown as Record<string, unknown>)[BRIDGE_KEY]
  return typeof found === 'object' && found !== null ? (found as EmeraldBridge) : undefined
}

/**
 * Feature detection, like `isFileSystemAccessAvailable` — and the same reason
 * (D-021): both paths stay exercised because the app picks between them at
 * runtime rather than at build time. Checking `documents` rather than the
 * bridge alone means a shell too old to serve files falls back instead of
 * crashing on a missing method.
 */
export function isDesktopShell(): boolean {
  return shellBridge()?.documents !== undefined
}

/**
 * The shell's document API, for the few things that are not the storage
 * adapter's job: the File menu's commands, the recents list on the empty
 * screen, and telling the shell there is unsaved work before it lets the
 * window close (D-128). `undefined` everywhere but the shell.
 */
export function shellDocuments(): EmeraldDocuments | undefined {
  return shellBridge()?.documents
}

/**
 * The window, for the title bar the app draws itself (D-130). `undefined`
 * everywhere but the shell, which is also the answer to "is there a frame to
 * draw" — a browser tab already has one.
 *
 * Here rather than in `src/ui/` because this file is the one place that reads
 * the bridge off `window`, and one reader is what keeps the feature detection
 * honest.
 */
export function shellWindow(): EmeraldWindow | undefined {
  return shellBridge()?.window
}

/** The app's own About (M45 F3, D-457). `undefined` outside the shell, and in a shell older than it. */
export function shellApp(): EmeraldApp | undefined {
  return shellBridge()?.app
}

/** A `file` cell's opener (M37 U6). `undefined` outside the shell, and in a shell older than it. */
export function shellFiles(): EmeraldFiles | undefined {
  return shellBridge()?.files
}

export function createDesktopAdapter(
  documents: EmeraldDocuments = requireDocuments(),
): StorageAdapter {
  // The open document. Held across calls, exactly as the File System Access
  // adapter holds its handle: the second save does not ask again.
  let path: string | undefined
  let name: string | undefined

  /**
   * Every path change goes through here, so the shell's watch and the file we
   * are saving to can never drift apart — including after "save a copy", where
   * the point is that we stop watching the file the other writer took.
   */
  const pointAt = (opened: { path: string; name: string }): void => {
    path = opened.path
    name = opened.name
    void documents.watch(opened.path)
  }

  return {
    id: 'desktop',
    canSaveSilently: true,

    describe: () =>
      path === undefined
        ? 'Your data is a file you choose. Save writes straight back to it.'
        : `Saving to ${path}.`,

    location: () => path,

    async open(): Promise<OpenedDocument | undefined> {
      const opened = await documents.open()
      if (opened === undefined) return undefined
      pointAt(opened)
      return { bytes: opened.bytes, name: opened.name }
    },

    /**
     * No picker: the user already chose this file, by double-clicking it or by
     * picking it out of Open Recent. The shell refuses any path it did not hand
     * out, so this cannot reach a file the user has not pointed at (D-128).
     */
    async openPath(path: string): Promise<OpenedDocument | undefined> {
      const opened = await documents.read(path)
      pointAt(opened)
      return { bytes: opened.bytes, name: opened.name }
    },

    async save(bytes: Uint8Array, suggestedName: string): Promise<string | undefined> {
      if (path === undefined) {
        const chosen = await documents.chooseSavePath(withExtension(suggestedName))
        if (chosen === undefined) return undefined
        pointAt({ path: chosen, name: baseName(chosen) })
      }
      // Narrowing does not survive the await above; `pointAt` set both or we
      // returned.
      const file = path
      if (file === undefined) return undefined
      await documents.write(file, bytes)
      return name
    },

    async saveAs(bytes: Uint8Array, suggestedName: string): Promise<string | undefined> {
      const chosen = await documents.chooseSavePath(withExtension(suggestedName))
      if (chosen === undefined) return undefined
      // Repoints: after "save a copy" this session is working on the copy, and
      // the file that changed underneath us is left alone (D-092).
      pointAt({ path: chosen, name: baseName(chosen) })
      await documents.write(chosen, bytes)
      return name
    },

    async backup(bytes: Uint8Array, label: string): Promise<string | undefined> {
      if (path === undefined) return undefined
      return documents.backup(path, bytes, label)
    },

    async readMark(): Promise<MarkReading> {
      if (path === undefined) return { kind: 'unwatched' }
      return documents.mark(path)
    },

    async reread(): Promise<OpenedDocument | undefined> {
      if (path === undefined) return undefined
      const opened = await documents.read(path)
      return { bytes: opened.bytes, name: opened.name }
    },

    watch(onChange: () => void): () => void {
      return documents.onChanged(onChange)
    },
  }
}

function requireDocuments(): EmeraldDocuments {
  const documents = shellBridge()?.documents
  if (documents === undefined) throw new Error('The desktop adapter needs the Emerald shell.')
  return documents
}

/** Windows applies the dialog's filter; macOS and Linux hand back what was typed. */
function withExtension(name: string): string {
  return name.endsWith(DOCUMENT_EXTENSION) ? name : `${name}${DOCUMENT_EXTENSION}`
}

/** Both separators, because a Windows path reaches this code as typed. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}
