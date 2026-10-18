/**
 * File System Access API — Chrome and Edge, including from `file://`.
 *
 * Keeps the file handle, so Save writes silently back to the same file. This
 * is the adapter that makes the document model feel like an application rather
 * than a download loop.
 */

import { plainBytes } from '@/core/bytes.ts'

import { DOCUMENT_EXTENSION, type OpenedDocument, type StorageAdapter } from './adapter.ts'
import type { MarkReading } from './externalChange.ts'

interface FileSystemWritable {
  write(data: BufferSource): Promise<void>
  close(): Promise<void>
}

interface FileHandle {
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<FileSystemWritable>
}

interface PickerOptions {
  suggestedName?: string
  types?: readonly { description: string; accept: Record<string, readonly string[]> }[]
}

interface PickerWindow {
  showOpenFilePicker(options?: PickerOptions & { multiple?: boolean }): Promise<FileHandle[]>
  showSaveFilePicker(options?: PickerOptions): Promise<FileHandle>
}

const FILE_TYPES = [
  {
    description: 'Emerald document',
    accept: { 'application/x-sqlite3': [DOCUMENT_EXTENSION] },
  },
] as const

export function isFileSystemAccessAvailable(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

export function createFileSystemAdapter(): StorageAdapter {
  // Held across calls: the whole point of this adapter is that the second save
  // does not ask again.
  let handle: FileHandle | undefined

  const picker = window as unknown as PickerWindow

  return {
    id: 'file-system',
    canSaveSilently: true,

    describe: () =>
      handle === undefined
        ? 'Your data is a file you choose. Save writes straight back to it.'
        : `Saving to ${handle.name}.`,

    async open(): Promise<OpenedDocument | undefined> {
      const [picked] = await picker.showOpenFilePicker({ types: FILE_TYPES, multiple: false })
      if (picked === undefined) return undefined
      handle = picked
      const file = await picked.getFile()
      return { bytes: new Uint8Array(await file.arrayBuffer()), name: picked.name }
    },

    async save(bytes: Uint8Array, suggestedName: string): Promise<string | undefined> {
      handle ??= await picker.showSaveFilePicker({ suggestedName, types: FILE_TYPES })
      return write(handle, bytes)
    },

    async saveAs(bytes: Uint8Array, suggestedName: string): Promise<string | undefined> {
      // Repoints the handle: after "save a copy", this session is working on
      // the copy, and the file that changed underneath us is left alone.
      handle = await picker.showSaveFilePicker({ suggestedName, types: FILE_TYPES })
      return write(handle, bytes)
    },

    async readMark(): Promise<MarkReading> {
      if (handle === undefined) return { kind: 'unwatched' }
      try {
        const file = await handle.getFile()
        return { kind: 'mark', mark: { lastModified: file.lastModified, size: file.size } }
      } catch (error) {
        // The file was moved, renamed, deleted, or the permission lapsed. Not
        // an error to throw at the user mid-keystroke, but not "unchanged"
        // either — the store decides what to say.
        return { kind: 'unreadable', reason: error instanceof Error ? error.message : String(error) }
      }
    },

    async reread(): Promise<OpenedDocument | undefined> {
      if (handle === undefined) return undefined
      const file = await handle.getFile()
      return { bytes: new Uint8Array(await file.arrayBuffer()), name: handle.name }
    },
  }
}

async function write(handle: FileHandle, bytes: Uint8Array): Promise<string> {
  const writable = await handle.createWritable()
  await writable.write(plainBytes(bytes))
  await writable.close()
  return handle.name
}
