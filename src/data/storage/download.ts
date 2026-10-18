/**
 * The fallback that always works: `<input type="file">` to open, a download to
 * save. Safari and Firefox, and anywhere the File System Access API is absent.
 */

import { plainBytes } from '@/core/bytes.ts'

import { DOCUMENT_EXTENSION, type OpenedDocument, type StorageAdapter } from './adapter.ts'
import type { MarkReading } from './externalChange.ts'

/**
 * Hand the browser bytes to save under a name. The adapter's save, and the way
 * a named copy held in a browser is kept (M34 U6, D-399): asked for, never
 * started on its own.
 */
export function downloadBytes(bytes: Uint8Array, suggestedName: string): void {
  // `octet-stream` rather than `x-sqlite3` since D-246: a `.emd` may be text
  // or SQLite bytes and this adapter is handed whichever, so a type naming one
  // of them would be wrong half the time. The extension is what the app and
  // the operating system go by either way.
  downloadBlob(new Blob([plainBytes(bytes)], { type: 'application/octet-stream' }), suggestedName)
}

/**
 * Hand the browser a file to save: a Blob, an anchor, and a revoke on a timer.
 * The document's save and the Export screen's CSVs both leave this way.
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function createDownloadAdapter(): StorageAdapter {
  // A plain function rather than `this.save`, so a destructured `saveAs` still
  // works — the store passes these around.
  const saveByDownload = async (
    bytes: Uint8Array,
    suggestedName: string,
  ): Promise<string | undefined> => {
    downloadBytes(bytes, suggestedName)
    return suggestedName
  }

  return {
    id: 'download',
    canSaveSilently: false,

    describe: () =>
      'Your data is a file you own. Saving downloads a new copy — keep the newest one.',

    open(): Promise<OpenedDocument | undefined> {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = DOCUMENT_EXTENSION
        input.addEventListener('change', () => {
          const file = input.files?.[0]
          if (file === undefined) {
            resolve(undefined)
            return
          }
          void file.arrayBuffer().then((buffer) => {
            resolve({ bytes: new Uint8Array(buffer), name: file.name })
          })
        })
        // A cancelled picker fires no event in most browsers, so the promise
        // simply never settles. That is fine: nothing is awaiting a cancel.
        input.click()
      })
    },

    save: saveByDownload,

    /** Every save here is already a new file the user names. */
    saveAs: saveByDownload,

    /**
     * There is no handle to compare against: the browser took the bytes and the
     * app never learns where they went. Downloading cannot clobber a second
     * writer either, so there is nothing this check would protect.
     */
    readMark(): Promise<MarkReading> {
      return Promise.resolve({ kind: 'unwatched' })
    },

    reread(): Promise<OpenedDocument | undefined> {
      return Promise.resolve(undefined)
    },
  }
}
