/**
 * **The write rules as guards** (M56 U3): what was prose in the conventions,
 * refused at the call instead. Each is a `tool.call` hook whose `.catch`
 * refuses in its place, so a guard that fails refuses rather than lets the
 * call through.
 *
 * 1. **An Edit or Write on a `.emd` file is refused.** The document is changed
 *    through its tools, which check a write against its formats and dry-run it
 *    first; a hand edit does neither, and can break the file without a word.
 * 2. **A `git commit` in a linked worktree that would carry the worktree's own
 *    copy of the project's document is refused** — while that copy is staged,
 *    or while it has changed and `-a` or a pathspec would take it. The rule of
 *    `scripts/guard-memory-emd.mjs` (M51 U1), which stays for sessions without
 *    this module: a worktree's session writes the main checkout's document, so
 *    its own copy is never the one written, and committing it would carry a
 *    stale copy back to main as a merge.
 */
import type { EngineInterface, On } from 'claude-code'

import { documentAt, git } from './git.ts'
import { normalize, resolve } from './project.ts'

// --- 1. No hand edit of a document ---------------------------------------------

/** Whether `path` names an Emerald document. */
export function isDocumentPath(path: string): boolean {
  return /\.emd$/i.test(path.trim())
}

export function handEditRefusal(path: string): string {
  return (
    `${path} is an Emerald document, and it is changed through its tools, never by editing the file: ` +
    'a write through them is checked against its formats and dry-run first, and a hand edit is neither, ' +
    'so it can break the document without a word. Use record_format_rows, update_format_rows, ' +
    'declare_format or extend_format on it (create_document for a new one).'
  )
}

// --- 2. No worktree commit of the document's copy --------------------------------

/** One shell command, split at the operators that start another. */
export function segments(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/).map((part) => part.trim())
}

const unquote = (word: string) => word.replace(/^['"]|['"]$/g, '')

/** The git subcommand, its arguments and any `-C` folder, or undefined for anything else. */
function gitCall(segment: string): { sub: string | undefined; args: string[]; folder: string | undefined } | undefined {
  const words = segment.split(/\s+/).map(unquote)
  const at = words.findIndex((word) => word === 'git' || /[\\/]git(\.exe)?$/i.test(word))
  if (at === -1) return undefined
  // Skip global options (`-C dir`, `-c k=v`) to reach the subcommand.
  let i = at + 1
  let folder: string | undefined
  while (i < words.length && (words[i] ?? '').startsWith('-')) {
    if (words[i] === '-C') folder = words[i + 1]
    i += words[i] === '-C' || words[i] === '-c' ? 2 : 1
  }
  return { sub: words[i], args: words.slice(i + 1), folder }
}

/** A `git commit` in a command: the folder it runs in, relative to where the command starts, and its arguments. */
export interface CommitCall {
  readonly folder: string
  readonly args: readonly string[]
}

/**
 * Every `git commit` in `command`, with the folder it runs in: a `-C` folder,
 * after any `cd` or `Set-Location` earlier in the same command.
 */
export function commitCalls(command: string): CommitCall[] {
  const found: CommitCall[] = []
  let here = '.'
  for (const segment of segments(command)) {
    const moved = /^(?:cd|Set-Location|sl|pushd)\s+(\S+)$/i.exec(segment)
    if (moved?.[1] !== undefined) {
      here = resolve(here, unquote(moved[1]))
      continue
    }
    const call = gitCall(segment)
    if (call?.sub !== 'commit') continue
    found.push({ folder: call.folder === undefined ? here : resolve(here, call.folder), args: call.args })
  }
  return found
}

/** Whether two normalized paths are one, a Windows drive's case aside. */
function samePath(a: string, b: string): boolean {
  return /^[A-Za-z]:/.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Whether a pathspec list, read in `folder`, reaches `copy`: the file itself, a folder above it, the whole tree, or its name anywhere. */
export function reachesCopy(pathspecs: readonly string[], folder: string, copy: string): boolean {
  const name = copy.slice(copy.lastIndexOf('/') + 1).toLowerCase()
  return pathspecs.some((raw) => {
    const spec = raw.replace(/\\/g, '/')
    if (/^(:\/|:\/\.|\*)$/.test(spec) || spec.toLowerCase().includes(name)) return true
    const at = resolve(folder, spec)
    return samePath(at, copy) || samePath(copy.slice(0, at.length + 1), `${at}/`)
  })
}

/** Whether `args` take every changed tracked file: `-a`, `--all`, or a run of short flags holding `a`. */
function takesAll(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(arg))
}

export function worktreeCommitRefusal(copy: string): string {
  return (
    `This is a git worktree, and this commit would carry its own copy of the project's document (${copy}). ` +
    "A worktree's session writes the main checkout's document (M51 U1), so this copy is never the one " +
    `written. Unstage it (git restore --staged -- "${copy}") and commit without it; the rows are committed ` +
    'from the main checkout.'
  )
}

/**
 * Why a `git commit` with `args` in `folder` is refused, or undefined to let it
 * run: only in a linked worktree whose project means a document, only when its
 * copy is staged, or changed and taken by `-a` or a pathspec. (A message's
 * words look like pathspecs here, so that half asks for a changed copy first.)
 */
async function commitRefusal($: EngineInterface, folder: string, args: readonly string[]): Promise<string | undefined> {
  const project = await documentAt($, folder)
  if (project.kind !== 'document' || project.worktreeCopy === undefined) return undefined
  const copy = normalize(project.worktreeCopy)
  if ((await git($, folder, ['diff', '--cached', '--name-only', '--', copy])) !== '') return worktreeCommitRefusal(copy)
  const pathspecs = args.filter((arg) => !arg.startsWith('-'))
  if (!takesAll(args) && !reachesCopy(pathspecs, folder, copy)) return undefined
  return (await git($, folder, ['status', '--porcelain', '--', copy])) !== '' ? worktreeCommitRefusal(copy) : undefined
}

const COULD_NOT_TELL = "Emerald could not tell whether this commit carries a worktree's copy of the document, so it is refused."

export function registerGuards(on: On): void {
  on('tool.call', { tool: ['Edit', 'Write'] }, ($, e, next) => {
    const path = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : ''
    return isDocumentPath(path) ? { deny: handEditRefusal(path) } : next(e)
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: 'Emerald could not tell whether this edit touches a document, so it is refused; try again.' },
  )

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const command = 'command' in e && typeof e.command === 'string' ? e.command : ''
    const commits = commitCalls(command)
    if (commits.length === 0) return next(e)
    // The judgement catches its own failure as well as carrying the `.catch`:
    // a hook above this one that answers its own failure with `next(e)` (the
    // pane's, which redraws after a write) would otherwise run the commit when
    // this hook throws, its refusal lost on the way up.
    let refusal: string | undefined
    try {
      const cwd = normalize(await $.session.cwd())
      for (const commit of commits) {
        refusal = await commitRefusal($, resolve(cwd, commit.folder), commit.args)
        if (refusal !== undefined) break
      }
    } catch {
      refusal = COULD_NOT_TELL
    }
    return refusal === undefined ? next(e) : { deny: refusal }
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: COULD_NOT_TELL }))
}
