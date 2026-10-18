/**
 * **Files a person picked or dropped, sorted into folders of notes** — M34 U7.
 *
 * A browser hands the screen files, never a folder: a multi-file pick, a
 * folder chosen with the folder picker (each file carrying the path under it),
 * or a folder dropped (walked here through its entries). However they came,
 * the Markdown notes are grouped by the folder they sit in, so a dropped vault
 * with `ingredients/` and `recipes/` in it is two tables, each read onto its own
 * format — as `read_onto_format` reads each folder it is given (D-227). A file
 * that is not a note but sat in a folder of notes is named as skipped, so every
 * file in it is accounted for.
 */

import { isHiddenFileName, isNoteFileName, noteIndex, notesTable, type Note, type ParsedNote } from '@/domain/format/notes.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import type { ReadTable } from '@/domain/format/reading.ts'

/** A file, with the folder path it came from when it came in one. */
export interface PickedFile {
  readonly file: File
  /** `vault/ingredients/Flour.md` — empty when it was picked on its own. */
  readonly path: string
}

export interface NoteFolder {
  /** The folder's name with a slash, `ingredients/`, or `notes` for loose notes. */
  readonly name: string
  readonly notes: readonly Note[]
  readonly skipped: readonly string[]
}

/** What a drop held, walked into its folders. Files dropped loose have no path. */
export async function droppedFiles(transfer: DataTransfer): Promise<readonly PickedFile[]> {
  const entries = Array.from(transfer.items)
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null)
  if (entries.length === 0 || !entries.some((entry) => entry.isDirectory)) {
    return Array.from(transfer.files).map((file) => ({ file, path: '' }))
  }
  const found: PickedFile[] = []
  for (const entry of entries) await walk(entry, found, entry.isDirectory ? entry.name : '')
  return found
}

async function walk(entry: FileSystemEntry, found: PickedFile[], path: string): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    found.push({ file, path })
    return
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // A directory reader answers in pages; an empty page is the end.
  for (;;) {
    const page = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (page.length === 0) break
    for (const child of page) {
      await walk(child, found, `${path}/${child.name}`)
    }
  }
}

/** Files from an `<input>`: a folder pick carries each file's path under the folder. */
export function inputFiles(files: readonly File[]): readonly PickedFile[] {
  return files.map((file) => ({ file, path: file.webkitRelativePath }))
}

/**
 * The notes among the files, by the folder each sits in, and the rest — the
 * spreadsheets, read as before. A non-note in a folder that holds notes is
 * that folder's skipped file; one picked loose is the caller's to refuse.
 * **A hidden file is read as nothing** (M38 U1) — the `._` copy a disk leaves
 * beside every file is binary — and is named: skipped in its folder of notes,
 * else among `hidden`.
 */
export async function sortPicked(
  picked: readonly PickedFile[],
): Promise<{ folders: readonly NoteFolder[]; others: readonly File[]; hidden: readonly string[] }> {
  const folderOf = (each: PickedFile): string => {
    const parts = each.path.split('/').filter((part) => part !== '')
    return parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : ''
  }
  const withNotes = new Set(picked.filter((each) => isNoteFileName(each.file.name)).map(folderOf))
  const folders = new Map<string, { notes: Note[]; skipped: string[] }>()
  const others: File[] = []
  const hidden: string[] = []
  for (const each of picked) {
    const folder = folderOf(each)
    if (isHiddenFileName(each.file.name) && !withNotes.has(folder)) {
      hidden.push(each.file.name)
    } else if (isNoteFileName(each.file.name)) {
      const into = folders.get(folder) ?? { notes: [], skipped: [] }
      into.notes.push({ file: each.file.name, text: await each.file.text() })
      folders.set(folder, into)
    } else if ((folder !== '' || isHiddenFileName(each.file.name)) && withNotes.has(folder)) {
      const into = folders.get(folder) ?? { notes: [], skipped: [] }
      into.skipped.push(each.file.name)
      folders.set(folder, into)
    } else {
      others.push(each.file)
    }
  }
  return {
    folders: [...folders.entries()]
      .filter(([, folder]) => folder.notes.length > 0)
      .map(([path, folder]) => ({
        name: path === '' ? 'notes' : `${path.split('/').filter((part) => part !== '').pop() ?? path}/`,
        notes: [...folder.notes].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
        skipped: folder.skipped,
      })),
    others,
    hidden,
  }
}

/**
 * Every folder's table, its links resolved against every note on the screen —
 * so a recipe in one folder names an ingredient in another by its title,
 * whichever was added first.
 */
export function tablesAcross(folders: readonly (readonly ParsedNote[])[]): readonly ReadTable[] {
  const index = noteIndex(folders.flat())
  return folders.map((notes) => notesTable(notes, index))
}

/**
 * The format a file's own name names — `recipes/` onto `recipe`, `recipe-lines.csv`
 * onto `recipe_line` — by its name or title, one plural `s` either way. What the
 * data already says is not asked (the make-it-in-place rule).
 */
export function formatNamedBy(fileName: string, writable: readonly FormatDeclaration[]): FormatDeclaration | undefined {
  const words = (text: string): string =>
    text
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '')
  const stem = words(fileName.replace(/\/$/, ''))
  if (stem === '') return undefined
  const forms = new Set([stem, stem.replace(/s$/, ''), stem.replace(/es$/, '')])
  return writable.find((each) => forms.has(words(each.name)) || forms.has(words(each.title)))
}
