/**
 * **Which document a project means** (M47 U1): what a hook asks before it can
 * say anything, since a hook is handed a folder and never a document.
 *
 * In order:
 *
 * 1. `.claude/emerald.json` in the folder, `{ "document": "docs/memory.emd" }`
 *    — relative to the folder, or absolute. Said is said: a named document that
 *    is not there is a problem to report, not a reason to go looking.
 * 2. Otherwise **the one `.emd` in the folder**, when there is exactly one —
 *    not counting the copies Emerald itself kept beside a document before
 *    M48 U4 moved them to its own folder (`planner.before-20261009T062530-….emd`,
 *    D-399, D-470), or the first named copy would silence every hook in that
 *    project — and copies made then are not moved.
 * 3. Otherwise nothing, and a hook says nothing. A plugin's hooks run in every
 *    folder a person opens, and most hold no document.
 *
 * **A git worktree means the main checkout's copy** (M51 U1). A worktree has
 * its branch's copy of every file, the document with them, so a session there
 * read rows as they were at its branch point — none recorded since and not yet
 * committed — and whatever it wrote landed in a copy that would have to be
 * merged back as text. So a document found inside a linked worktree is taken at
 * the same place in the main working tree, the parent of the repository's
 * common `.git` (`git rev-parse --git-common-dir`), when it is there: every
 * worktree reads and writes the one file, and the lock (D-304) already makes
 * several writers safe. The main checkout, a folder outside git, a bare
 * repository's worktrees and a document outside the worktree are as before.
 */

import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { DOCUMENT_EXTENSION, isNamedCopyOf } from '../../../electron/bridge.ts'

/** Where a project names its document, relative to the project's folder. */
export const PROJECT_FILE = join('.claude', 'emerald.json')

export type ProjectDocument =
  | {
      readonly kind: 'document'
      readonly path: string
      /** In a linked worktree: the worktree's own copy, which `path` is read instead of. */
      readonly worktreeCopy?: string
    }
  /** No document named and not exactly one in the folder: nothing to say. */
  | { readonly kind: 'none' }
  /** The project named one and it cannot be had — said, because somebody wrote it down. */
  | { readonly kind: 'problem'; readonly message: string }

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() === true
}

/** `git rev-parse` in `folder`, one line per argument, or undefined outside git or without git. */
function revParse(folder: string, args: readonly string[]): Promise<readonly string[] | undefined> {
  return new Promise((settle) => {
    execFile('git', ['rev-parse', ...args], { cwd: folder, windowsHide: true, timeout: 5_000 }, (error, stdout) => {
      settle(error ? undefined : stdout.split(/\r?\n/).filter((line) => line !== ''))
    })
  })
}

/**
 * Where the main working tree has `path`, when `folder` is in a linked worktree
 * and `path` is inside it; otherwise undefined. The main working tree is the
 * parent of the common `.git` — a bare repository has none, and a submodule's
 * common dir is not called `.git`, so neither is moved.
 */
export async function mainCheckoutPath(folder: string, path: string): Promise<string | undefined> {
  const lines = await revParse(folder, ['--show-toplevel', '--git-dir', '--git-common-dir'])
  if (lines?.length !== 3) return undefined
  const [top, gitDir, commonDir] = lines.map((line) => resolve(folder, line)) as [string, string, string]
  if (relative(gitDir, commonDir) === '' || basename(commonDir) !== '.git') return undefined
  const inside = relative(top, path)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return undefined
  return join(dirname(commonDir), inside)
}

/** `found`, or the main checkout's copy of it when the folder is a linked worktree and the main checkout has one. */
async function canonical(folder: string, found: string): Promise<ProjectDocument> {
  const main = await mainCheckoutPath(folder, found)
  return main !== undefined && (await isFile(main))
    ? { kind: 'document', path: main, worktreeCopy: found }
    : { kind: 'document', path: found }
}

/** The document the project at `folder` means, by the order above. */
export async function projectDocument(folder: string): Promise<ProjectDocument> {
  const named = join(folder, PROJECT_FILE)
  const text = await readFile(named, 'utf8').catch(() => undefined)
  if (text !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { kind: 'problem', message: `${named} is not JSON; it should be { "document": "<path to the .emd>" }.` }
    }
    const document = (parsed as { document?: unknown } | null)?.document
    if (typeof document !== 'string' || document.trim() === '') {
      return { kind: 'problem', message: `${named} names no document; it should be { "document": "<path to the .emd>" }.` }
    }
    const path = resolve(folder, document)
    return (await isFile(path))
      ? canonical(folder, path)
      : { kind: 'problem', message: `${named} names ${path}, and there is no document there.` }
  }

  const names = await readdir(folder).catch(() => [] as string[])
  const documents = names.filter((name) => name.toLowerCase().endsWith(DOCUMENT_EXTENSION))
  const originals = documents.filter((name) => !documents.some((other) => other !== name && isNamedCopyOf(other, name)))
  if (originals.length !== 1) return { kind: 'none' }
  const path = join(folder, originals[0] as string)
  return (await isFile(path)) ? canonical(folder, path) : { kind: 'none' }
}
