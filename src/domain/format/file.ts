/**
 * **A file on this computer, in a cell** — the `file` column (M37 U6).
 *
 * The value is where the file is, never what is in it: the document copies
 * nothing in, and a file that has gone is a cell that says *missing*, never a
 * write or a save refused (the brief's fourth point). Two spellings:
 *
 * - **A path** — `scans/receipt.pdf`, or `C:/Users/someone/Desktop/plan.pdf`.
 *   **Relative to the document's folder when the file is under it**, absolute
 *   otherwise, so a folder that moves with its document keeps its links
 *   (`fileValueFor` makes it so where the holder is known). Stored with `/`.
 * - **A local app's own address** — a note app's `obsidian://open?vault=…` —
 *   handed to the system to open in that app. Only the schemes in
 *   `LOCAL_SCHEMES`, an allowlist: an `http:` address is a request, and so
 *   might be any scheme nobody looked at (D-124, D-308).
 *
 * A share on another machine (`//host/…`, `\\host\…`) is refused too: opening
 * one is a request to that machine. Whether a file is there is a read's
 * question (the shell's `present`, the plugin's `existsSync`), never a write's.
 */

import { err, ok, type Result } from '@/core/result.ts'

import type { FormatDeclaration } from './declaration.ts'
import { isAbsolutePath, pathFrom } from './elsewhere.ts'

/**
 * **The addresses a cell may hold besides a path: a local app's own** — an
 * allowlist, because an `http:` address is a request and so might be any
 * scheme nobody looked at (D-124, D-308). One so far, a note app's; the list
 * grows by a decision. The shell's gate keeps the same list (`electron/bridge.ts`),
 * and `electron/linkedFiles.test.ts` fails when the two differ.
 */
export const LOCAL_SCHEMES: readonly string[] = ['obsidian']

/** A scheme of two letters or more: one letter is a Windows drive. */
const SCHEME = /^([a-z][a-z0-9+.-]+):/i

/** The schemes a cell may hold, as a person would write them. */
function schemesText(): string {
  return LOCAL_SCHEMES.map((each) => `${each}:`).join(', ')
}

/**
 * The one spelling a value is stored in, or why it is not a file.
 *
 * Forgiving of how a path arrives: wrapped in the quotes a file manager's
 * *copy as path* adds, with `\`, or as a `file:///` URL — each is the same
 * path, and stored as one.
 */
export function parseFile(value: string): Result<string, string> {
  let text = value.trim()
  if (/^(["']).*\1$/.test(text) && text.length >= 2) text = text.slice(1, -1).trim()
  if (text === '') return err('a file is a path on this computer, and this is empty.')

  // A file URL is a path written as an address: `file:///C:/x.pdf` is `C:/x.pdf`.
  const fileUrl = /^file:\/\/([^/]*)(\/.*)?$/i.exec(text)
  if (fileUrl !== null) {
    const host = fileUrl[1] ?? ''
    if (host !== '' && host.toLowerCase() !== 'localhost') return err(onAnotherMachine(value))
    let path: string
    try {
      path = decodeURIComponent(fileUrl[2] ?? '')
    } catch {
      return err(`"${value}" is not a file URL this can read. Write the path itself.`)
    }
    text = /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
  }

  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase()
  if (scheme !== undefined) {
    if (LOCAL_SCHEMES.includes(scheme)) return ok(text)
    if (scheme === 'http' || scheme === 'https') {
      return err(
        `"${value}" is a web address, and opening one is a request — Emerald makes none. A file is a path on this computer, or an app's own address (${schemesText()}).`,
      )
    }
    return err(`"${value}" is a ${scheme}: address. A file is a path on this computer, or an app's own address (${schemesText()}).`)
  }

  const path = text.replace(/\\/g, '/')
  if (path.startsWith('//')) return err(onAnotherMachine(value))
  if (path === '' || path === '/') return err(`"${value}" names no file.`)
  return ok(path)
}

function onAnotherMachine(value: string): string {
  return `"${value}" is on another machine, and reaching it is a request — Emerald makes none. Copy it onto this one, or link where it is synced to.`
}

/** Whether a stored value is an app's address rather than a path. */
export function isFileAddress(value: string): boolean {
  return SCHEME.test(value)
}

/**
 * What a written value is stored as, **beside the document when it is under
 * its folder**: `C:/work/plans/scans/a.pdf` from `C:/work/plans/plans.emd` is
 * `scans/a.pdf`. Absolute otherwise, and as written where the holder has no
 * path (a document never saved, or the page in a browser). A value that is not
 * a file comes back as it was, for the write to refuse with its reason.
 */
export function fileValueFor(written: string, holder: string | undefined): string {
  const parsed = parseFile(written)
  if (!parsed.ok) return written
  const value = parsed.value
  if (holder === undefined || isFileAddress(value) || !isAbsolutePath(value)) return value
  const folder = `${holder.replace(/\\/g, '/').replace(/\/[^/]*$/, '')}/`
  // A drive path is Windows's, where `C:/Work` and `c:/work` are one folder.
  const drive = /^[a-z]:\//i.test(folder)
  const under = drive ? value.toLowerCase().startsWith(folder.toLowerCase()) : value.startsWith(folder)
  return under && value.length > folder.length ? value.slice(folder.length) : value
}

/** Where a stored value points: an address, or a path made absolute against the holder. */
export type FileWhere =
  | { readonly kind: 'address'; readonly address: string }
  | {
      readonly kind: 'path'
      /** Absolute, or `undefined` when the value is relative and the holder has no path. */
      readonly path: string | undefined
    }

export function fileWhere(value: string, holder: string | undefined): FileWhere {
  if (isFileAddress(value)) return { kind: 'address', address: value }
  return { kind: 'path', path: pathFrom(value, holder) }
}

/**
 * What a cell shows of a value: a path's file name — `receipt.pdf` — and an
 * address's `file`, which is the note it opens, or the address without its scheme.
 */
export function fileNameOf(value: string): string {
  if (isFileAddress(value)) {
    const query = value.indexOf('?')
    if (query >= 0) {
      const file = new URLSearchParams(value.slice(query + 1)).get('file')
      if (file !== null && file !== '') return lastPart(file)
    }
    return value.replace(SCHEME, '').replace(/^\/+/, '')
  }
  return lastPart(value)
}

function lastPart(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

/**
 * A batch of rows with every `file` cell stored the way `fileValueFor` says —
 * what a conversation's write does with the document's own path, so `C:/…/plans/a.pdf`
 * written to `C:/…/plans/plans.emd` lands as `a.pdf`. Other cells are untouched.
 */
export function withFilesPlaced(
  declaration: FormatDeclaration,
  rows: readonly Record<string, unknown>[],
  holder: string | undefined,
): readonly Record<string, unknown>[] {
  const files = declaration.columns.filter((column) => column.type === 'file').map((column) => column.name)
  if (files.length === 0) return rows
  return rows.map((row) => {
    const placed: Record<string, unknown> = { ...row }
    for (const name of files) {
      const value = placed[name]
      if (typeof value === 'string') placed[name] = fileValueFor(value, holder)
    }
    return placed
  })
}
