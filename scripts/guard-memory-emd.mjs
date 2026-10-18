/**
 * A Claude Code PreToolUse hook: refuse a git command that would throw away
 * uncommitted writes to `docs/memory.emd`.
 *
 * Why it exists: M22 lost write #1. On 2026-09-20 one session wrote a row into
 * the document through the plugin, and a second session saw the file modified
 * in `git status`, took it for its own leftover, and ran
 * `git checkout -- docs/memory.emd`. The row was gone and nothing said so. The
 * document has more than one writer — the app, the plugin, every session — so a
 * diff on it is somebody's work, never debris.
 *
 * Silent unless the file is actually dirty, so ordinary git use is untouched.
 * Reads the hook payload on stdin; prints a deny decision or nothing.
 *
 * **And a worktree never commits its own copy** (M51 U1). In a linked git
 * worktree the hooks read, and the session writes, the main checkout's
 * document, so the worktree's copy is never the one written: a commit of it
 * would carry a stale copy back to main as a merge. A `git commit` there is
 * refused while the copy is staged, or while it has changed and `-a` or a
 * pathspec would take it.
 */

import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

const DOCUMENT = 'docs/memory.emd'

/** One shell command, split at the operators that start another. */
function segments(command) {
  return command.split(/&&|\|\||[;|\n]/).map((part) => part.trim())
}

/** Whether a pathspec list reaches the document. */
function reachesDocument(args) {
  return args.some((arg) =>
    /memory\.emd/.test(arg) || /^(\.|\.\/|:\/|:\/\.|docs\/?|\.\/docs\/?|\*)$/.test(arg),
  )
}

/** The git subcommand, its arguments and any `-C` folder, or undefined for anything else. */
function gitCall(segment) {
  const words = segment.split(/\s+/).map((word) => word.replace(/^['"]|['"]$/g, ''))
  const at = words.findIndex((word) => word === 'git' || /[\\/]git(\.exe)?$/.test(word))
  if (at === -1) return undefined
  // Skip global options (`-C dir`, `-c k=v`) to reach the subcommand.
  let i = at + 1
  let folder
  while (i < words.length && words[i].startsWith('-')) {
    if (words[i] === '-C') folder = words[i + 1]
    i += words[i] === '-C' || words[i] === '-c' ? 2 : 1
  }
  return { sub: words[i], args: words.slice(i + 1), folder }
}

function discards(command) {
  for (const segment of segments(command)) {
    const call = gitCall(segment)
    if (call === undefined) continue
    const { sub, args } = call
    if (sub === 'checkout' && (reachesDocument(args) || args.includes('-f') || args.includes('--force'))) return true
    if (sub === 'restore' && !args.includes('--staged') && reachesDocument(args)) return true
    if (sub === 'restore' && args.includes('--worktree') && reachesDocument(args)) return true
    if (sub === 'reset' && args.includes('--hard')) return true
    if (sub === 'stash' && !['list', 'show'].includes(args[0])) return true
  }
  return false
}

/** `git <args>` in `cwd`, its stdout, or undefined when it fails or there is no git. */
function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
}

function documentIsDirty(cwd) {
  return (git(cwd, ['status', '--porcelain', '--', DOCUMENT]) ?? '').trim() !== ''
}

/** Whether `folder` is in a linked worktree: its git dir is not the repository's common one. */
function inLinkedWorktree(folder) {
  const lines = git(folder, ['rev-parse', '--git-dir', '--git-common-dir'])?.split(/\r?\n/).filter(Boolean)
  if (lines?.length !== 2) return false
  return relative(resolve(folder, lines[0]), resolve(folder, lines[1])) !== ''
}

/** Whether a `git commit` run in `folder` with `args` would carry a worktree's copy of the document. */
function commitsWorktreeCopy(folder, args) {
  if (!inLinkedWorktree(folder)) return false
  if ((git(folder, ['diff', '--cached', '--name-only', '--', DOCUMENT]) ?? '').trim() !== '') return true
  // Unstaged, it rides along only on `-a` or a pathspec that reaches it — and only when it has changed.
  // (A message's words look like pathspecs here, so that half asks for a changed copy first.)
  const all = args.some((arg) => arg === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(arg))
  return (all || reachesDocument(args.filter((arg) => !arg.startsWith('-')))) && documentIsDirty(folder)
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
}

let input = ''
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  let command = ''
  let cwd = process.cwd()
  try {
    const payload = JSON.parse(input)
    command = payload?.tool_input?.command ?? ''
    if (typeof payload?.cwd === 'string' && payload.cwd !== '') cwd = payload.cwd
  } catch {
    return
  }

  if (discards(command) && documentIsDirty(cwd)) {
    deny(
      `${DOCUMENT} has uncommitted changes, and this command would discard them. ` +
        'The document has other writers — the app, the plugin, other sessions — so a diff on it is ' +
        "somebody's work, not debris (M22 lost write #1). Commit it, or ask the maintainer.",
    )
    return
  }

  for (const segment of segments(command)) {
    const call = gitCall(segment)
    if (call?.sub !== 'commit' || !commitsWorktreeCopy(resolve(cwd, call.folder ?? '.'), call.args)) continue
    deny(
      `This is a git worktree, and this commit would carry its own copy of ${DOCUMENT}. ` +
        "A worktree's hooks read, and its session writes, the main checkout's document (M51 U1), so this " +
        `copy is never the one written. Unstage it (git restore --staged ${DOCUMENT}) and commit without it; ` +
        'the rows are committed from the main checkout.',
    )
    return
  }
})
