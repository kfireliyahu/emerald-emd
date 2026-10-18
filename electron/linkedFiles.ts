/**
 * **The gate a `file` cell's click goes through** (M37 U6).
 *
 * A document holds paths, and the page asks the shell to open one — the one
 * place the page names a file nobody picked in a dialog of ours (D-128 is the
 * rule everywhere else). What makes that safe enough is what this file allows:
 *
 * - **Nothing is read into the page.** The page learns whether a file is there
 *   and whether it opened; the file goes to the system's own app.
 * - **No request.** An address is handed on only when its scheme is a local
 *   app's (`LOCAL_SCHEMES`, an allowlist); `http:` and everything else are
 *   refused here even if a cell somehow holds one (D-124, D-308). A share on
 *   another machine (`\\host\…`, `//host/…`) is refused as well: reaching it is
 *   a request, and one a document could aim.
 * - **No program runs from a cell.** A kind of file that is a program
 *   (`PROGRAM_EXTENSIONS`) is shown in its folder and never opened: a click is
 *   not consent to run what a document names.
 *
 * The page resolves a relative path against the document's folder before it
 * asks, so every path here is absolute or refused.
 */

import { posix, win32 } from 'node:path'

import type { Shell } from 'electron'

import { LOCAL_SCHEMES, PROGRAM_EXTENSIONS } from './bridge.ts'

/** What a value asked to be opened turned out to be. */
export type LinkedTarget =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'address'; readonly address: string }
  | { readonly kind: 'refused'; readonly why: string }

/** A scheme of two letters or more — one letter is a Windows drive. */
const SCHEME = /^([a-z][a-z0-9+.-]+):/i

/** The value as something to open, or why it is not one. */
export function linkedTarget(value: unknown, platform: string): LinkedTarget {
  if (typeof value !== 'string' || value.trim() === '') return { kind: 'refused', why: 'There is nothing to open.' }
  const text = value.trim()
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase()
  if (scheme !== undefined) {
    if (LOCAL_SCHEMES.includes(scheme)) return { kind: 'address', address: text }
    return {
      kind: 'refused',
      why:
        scheme === 'http' || scheme === 'https'
          ? `A ${scheme} address is a request, and Emerald makes none.`
          : `${scheme}: is not an address Emerald hands on — only a file on this computer, or ${LOCAL_SCHEMES.map((each) => `${each}:`).join(', ')}.`,
    }
  }
  const windows = platform === 'win32'
  if (/^[\\/]{2}/.test(text)) {
    return { kind: 'refused', why: 'A file on another machine is reached over the network, and Emerald makes no request.' }
  }
  const absolute = windows ? /^[a-z]:[\\/]/i.test(text) : text.startsWith('/')
  if (!absolute) return { kind: 'refused', why: 'The path is not absolute.' }
  return { kind: 'path', path: (windows ? win32 : posix).normalize(text) }
}

/** Whether a path names a program, by its extension. */
export function isProgram(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && PROGRAM_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
}

/** What the gate needs of the process: the system's opener, and whether a path is there. */
export interface LinkedFileSystem {
  readonly shell: Pick<Shell, 'openPath' | 'openExternal' | 'showItemInFolder'>
  readonly platform: string
  exists(path: string): Promise<boolean>
}

/** Open it with the system's own app. `undefined` when it opened, else why not. */
export async function openLinked(value: unknown, io: LinkedFileSystem): Promise<string | undefined> {
  const target = linkedTarget(value, io.platform)
  if (target.kind === 'refused') return target.why
  // A local app's own address: no request, and the app it names opens it.
  if (target.kind === 'address') {
    await io.shell.openExternal(target.address)
    return undefined
  }
  if (!(await io.exists(target.path))) return 'No file is there now.'
  if (isProgram(target.path)) return 'It is a program, so it is shown in its folder and never run from here.'
  const failure = await io.shell.openPath(target.path)
  return failure === '' ? undefined : failure
}

/** Show it selected in its folder. `undefined` when shown, else why not. */
export async function showLinked(value: unknown, io: LinkedFileSystem): Promise<string | undefined> {
  const target = linkedTarget(value, io.platform)
  if (target.kind === 'refused') return target.why
  if (target.kind === 'address') return 'An address has no folder.'
  if (!(await io.exists(target.path))) return 'No file is there now.'
  io.shell.showItemInFolder(target.path)
  return undefined
}

/** Whether each path is there now; anything the gate refuses is not. */
export async function presentLinked(values: unknown, io: LinkedFileSystem): Promise<readonly boolean[]> {
  if (!Array.isArray(values)) return []
  return Promise.all(
    values.map(async (value: unknown) => {
      const target = linkedTarget(value, io.platform)
      return target.kind === 'path' && (await io.exists(target.path))
    }),
  )
}
