/**
 * **A document's saved exports, checked and written for the app** (M63 U4,
 * D-605) — the main-process half of Settings › Export's saved exports.
 *
 * The page works the bytes out (`src/data/export/formatExport.ts`, the same code
 * the command line runs) and sends them with the file each `export` row names.
 * **Where that file is, is decided here**: relative to the open document's
 * folder, by `inDocumentFolder` in `bridge.ts` — the one rule the command line
 * and the tool hold a saved export to — and refused anywhere outside it. A document someone sends
 * is a list of file names a page reads, and the page is not what is trusted to
 * keep those names inside the folder.
 *
 * Nothing on disk is handed back: a check answers with a word per file, so the
 * page learns whether a file holds its bytes and nothing of what else it holds.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import * as nodePath from 'node:path'

import { inDocumentFolder, writeAtomically, type ExportFile, type ExportFileOutcome } from './bridge.ts'

/** The disk, as much of it as a saved export needs — a test hands in its own. */
export interface ExportFileSystem {
  /** The file's text, or `undefined` when it is not there. */
  read(path: string): Promise<string | undefined>
  /** Written atomically, its folder made if need be. */
  write(path: string, text: string): Promise<void>
}

export const nodeExportFileSystem: ExportFileSystem = {
  read: (path) => readFile(path, 'utf8').catch(() => undefined),
  write: async (path, text) => {
    await mkdir(nodePath.dirname(path), { recursive: true })
    await writeAtomically({ pid: process.pid, writeFile, rename, unlink }, path, new TextEncoder().encode(text))
  },
}

/** The page's list, held to its shape: anything else is refused whole. */
export function exportFilesOf(value: unknown): readonly ExportFile[] {
  if (!Array.isArray(value)) throw new Error('Saved exports are sent as a list of files.')
  return value.map((each: unknown) => {
    if (typeof each !== 'object' || each === null) throw new Error('A saved export is a file and its text.')
    const { file, text } = each as Record<string, unknown>
    if (typeof file !== 'string' || typeof text !== 'string') throw new Error('A saved export is a file and its text.')
    return { file, text }
  })
}

/** Each file against what is on disk, in order — refused outside the document's folder. Writes nothing. */
export async function checkExportFiles(
  documentPath: string,
  files: readonly ExportFile[],
  fs: ExportFileSystem = nodeExportFileSystem,
): Promise<readonly ExportFileOutcome[]> {
  const out: ExportFileOutcome[] = []
  for (const { file, text } of files) {
    const target = inDocumentFolder(nodePath, documentPath, file)
    if (target === undefined) {
      out.push({ file, state: 'refused' })
      continue
    }
    const held = await fs.read(target)
    out.push({ file, state: held === undefined ? 'missing' : held === text ? 'current' : 'differs' })
  }
  return out
}

/** Writes each file that is missing or differs; one outside the document's folder is refused and the rest carry on. */
export async function writeExportFiles(
  documentPath: string,
  files: readonly ExportFile[],
  fs: ExportFileSystem = nodeExportFileSystem,
): Promise<readonly ExportFileOutcome[]> {
  const out: ExportFileOutcome[] = []
  for (const { file, text } of files) {
    const target = inDocumentFolder(nodePath, documentPath, file)
    if (target === undefined) {
      out.push({ file, state: 'refused' })
      continue
    }
    if ((await fs.read(target)) === text) {
      out.push({ file, state: 'current' })
      continue
    }
    await fs.write(target, text)
    out.push({ file, state: 'written' })
  }
  return out
}
