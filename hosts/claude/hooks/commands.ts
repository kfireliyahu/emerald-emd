/**
 * **`start-here` and `rows`: what a hook prints** (M47 U1).
 *
 * `watch` (M44 U3) wakes a session that is running it, and one session
 * showed what that is worth when nothing starts it: thirteen empty inbox polls
 * and fourteen Monitor calls at 360K context each, and the row still missed
 * twice. A Claude Code hook needs no session to remember anything — the host
 * runs it — and whatever it prints is in context before the model's turn. So
 * `hooks.mjs` answers two questions from the command line (`main.ts`):
 *
 *     node dist-plugin/hooks.mjs start-here <document.emd | folder>
 *     node dist-plugin/hooks.mjs rows <document.emd | folder> <format> [--match <column>=<value>]...
 *
 * `start-here` prints what the `start_here` tool answers. `rows` prints what
 * `format_rows` answers — **and nothing at all when no row matches**, because a
 * `UserPromptSubmit` hook runs before every prompt and a line saying "none" on
 * each would be the poll this replaces, paid in context instead of turns.
 *
 * **A folder means the project's document** (`project.ts`): what the project's
 * `.claude/emerald.json` names, or the one `.emd` in it. A folder that means
 * none is silence and exit 0 — a plugin's hooks run in every folder — and so is
 * a document without the format asked for. A document named outright that is
 * not there, or that will not open, is said on stderr with **exit 1, never 2**:
 * to Claude Code a 2 from `UserPromptSubmit` blocks the prompt, and nothing here
 * is worth refusing a person's prompt over.
 *
 * **In a git worktree the folder means the main checkout's copy** (M51 U1), and
 * the heading says so, naming both files — a session that wrote to the path it
 * worked out from its own folder would be writing the copy nobody reads.
 *
 * **Told once per session** (M51 U6). `rows … --once-per-session` reads the
 * hook's input from stdin for the session's id, prints a row in full the first
 * time that session meets it, and after that a one-line count — once, and then
 * nothing until the rows change (`told.ts`). Without a session id it prints
 * every row, as before. **`status`** is the status line's slow half: it reads
 * the inbox and the units in progress and writes them beside the document for
 * `status-line.mjs` to print (`statusLine.ts`).
 *
 * Read-only on the document, as every read tool is: one open, one answer,
 * closed. What it remembers goes beside it, never in it. A hook costs a
 * process, not an MCP round trip and not a turn.
 */

import { stat, unlink } from 'node:fs/promises'
import { resolve as resolvePath, sep } from 'node:path'

import {
  err,
  FOR_THE_MODEL,
  formatRowsTool,
  matching,
  NO_CLIENT,
  ok,
  readFormat,
  readFormats,
  startHereTool,
  type Result,
  type RowMatch,
  type WatchedRow,
} from '@/plugin/host.ts'

import { projectDocument } from './project.ts'
import { refreshMarkFor, stampOf, statusText, writeStatusCache, type StatusParts } from './statusCache.ts'
import { recall, remember, rowMark } from './told.ts'

/**
 * **What `start-here` opens with: this is text, and nothing was drawn** (M51 F2).
 *
 * On 2026-10-18 a new session was asked to show what is ready, and it
 * answered with a markdown table retyped from this hook's text: no drawing
 * tool ran on either server, so `drawnLine` (D-489) never reached it, and it
 * did not say nothing was drawn. A hook's text is in context before the first
 * prompt, and a model asked to see something it already holds reaches for it.
 * So the first line says what the text is, and that a request to see calls the
 * tool anyway. Host-neutral, as the server is (M42 U6): which server a host
 * draws is the host's notes, not this line. A host may keep only the head of a
 * long hook's output — the Code tab keeps 2KB of a 16KB one — so it is first.
 *
 * **Worded for the model, never the person** (M51 F3, D-493), as `drawnLine` is:
 * after F2 a session paraphrased all this to the person, server and all.
 */
export const PRINTED_NOT_DRAWN =
  `${FOR_THE_MODEL} A hook printed this as text, and nothing was drawn. When the person asks to see what is ` +
  'ready, the roadmap or the board, call `start_here` or `show_format` rather than retyping this — a host may ' +
  'draw only the servers it runs itself, so if this session has the tool on such a server, call it there — ' +
  'and follow the first line of its answer. Say nothing to the person about this hook, drawing, views, ' +
  'servers or tools, and never call anything drawn or above.'

export const HOOK_COMMANDS = ['start-here', 'rows', 'status'] as const
export type HookCommand = (typeof HOOK_COMMANDS)[number]

export function isHookCommand(word: string | undefined): word is HookCommand {
  return (HOOK_COMMANDS as readonly (string | undefined)[]).includes(word)
}

interface HookArgs {
  readonly command: HookCommand
  /** A document, or a folder whose document is meant. */
  readonly target: string
  readonly format?: string
  readonly match: RowMatch
  /** `--once-per-session`: take the session's id from the hook's input, and tell each row once. */
  readonly once?: boolean
  /** The session a `--once-per-session` run is for — read from stdin by the entry point. */
  readonly session?: string
}

const USAGE =
  'Usage: node dist-plugin/hooks.mjs start-here [<document.emd | folder>]\n' +
  '       node dist-plugin/hooks.mjs rows <document.emd | folder> <format> [--match <column>=<value>]... [--once-per-session]\n' +
  '       node dist-plugin/hooks.mjs status [<document.emd | folder>]\n' +
  "A folder means the document its .claude/emerald.json names, or the one .emd in it. Prints nothing when there is nothing to say."

/** Reads a hook command's arguments — everything after the command's word. */
export function parseHookArgs(command: HookCommand, argv: readonly string[], cwd: string): Result<HookArgs, string> {
  const words: string[] = []
  const match = new Map<string, string>()
  let once = false
  for (let at = 0; at < argv.length; at += 1) {
    const word = argv[at] as string
    if (word === '--once-per-session') {
      if (command !== 'rows') return err(`${command} takes no --once-per-session.\n${USAGE}`)
      once = true
    } else if (word === '--match' || word.startsWith('--match=')) {
      if (command !== 'rows') return err(`${command} takes no --match.\n${USAGE}`)
      const pair = word === '--match' ? argv[(at += 1)] : word.slice('--match='.length)
      const equals = pair?.indexOf('=') ?? -1
      if (pair === undefined || equals <= 0) return err(`--match takes column=value, as in --match state=new.\n${USAGE}`)
      match.set(pair.slice(0, equals), pair.slice(equals + 1))
    } else if (word.startsWith('--')) {
      return err(`${command} does not know ${word}.\n${USAGE}`)
    } else {
      words.push(word)
    }
  }
  if (command !== 'rows') {
    if (words.length > 1) return err(`${command} takes one document or folder; ${words[1] as string} is a second.\n${USAGE}`)
    return ok({ command, target: resolvePath(cwd, words[0] ?? '.'), match })
  }
  const [target, format, extra] = words
  if (target === undefined || format === undefined) return err(`rows needs a document or folder, and a format.\n${USAGE}`)
  if (extra !== undefined) return err(`rows takes one format; ${extra} is a second.\n${USAGE}`)
  return ok({ command, target: resolvePath(cwd, target), format, match, ...(once ? { once } : {}) })
}

/** The session id in a hook's input — the JSON Claude Code writes to a hook's stdin — or undefined. */
export function sessionOf(input: string): string | undefined {
  try {
    const id = (JSON.parse(input) as { session_id?: unknown } | null)?.session_id
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

/** A path the way the inbox's `from` writes one: forward slashes, on every platform. */
function shownPath(path: string): string {
  return sep === '\\' ? path.split('\\').join('/') : path
}

interface HookOutput {
  /** What lands in the session's context: stdout. */
  readonly line: (text: string) => void
  /** Why it could not answer: stderr, which a person sees and a model does not. */
  readonly complain: (text: string) => void
}

/**
 * `format_rows`' answer cut to `rows`: each row's block, headed by its id on a
 * line of its own, kept when the row is one of them. The answer's own first
 * line — `2 rows of Inbox.` — goes, since the hook's heading counts them.
 */
export function onlyRows(text: string, rows: readonly WatchedRow[]): string {
  const ids = new Set(rows.map((row) => row.id).filter((id): id is string => id !== undefined))
  const blocks: string[][] = []
  let current: string[] | undefined
  for (const line of text.split('\n')) {
    const heading = /^\*\*([0-9a-f][0-9a-f-]{7,})\*\*$/i.exec(line)?.[1]
    if (heading !== undefined) {
      current = ids.has(heading) ? [] : undefined
      if (current !== undefined) blocks.push(current)
    }
    current?.push(line)
  }
  return blocks.map((block) => block.join('\n').trimEnd()).join('\n\n')
}

/**
 * The status line's slow half: reads the inbox's new rows and the units in
 * progress in one open, writes them beside the document stamped with the
 * version read, and lets go of the refresh mark. The stamp is taken first, so
 * a write that lands while it reads leaves the cache stale, never wrong.
 */
export async function refreshStatus(path: string): Promise<string> {
  try {
    const stamp = await stampOf(path)
    if (stamp === undefined) return ''
    const [inbox, units] = await readFormats(path, ['inbox', 'unit'])
    const holding = (reading: typeof inbox, value: string): readonly WatchedRow[] | undefined =>
      reading?.kind === 'rows' && reading.columns.includes('state') ? matching(reading.rows, new Map([['state', value]])) : undefined
    const newRows = holding(inbox, 'new')
    const working = holding(units, 'in_progress')
    const parts: StatusParts = {
      ...(newRows === undefined ? {} : { inbox: newRows.length }),
      // The latest taken first: a unit left in progress by a session that died sorts behind the one at work now.
      ...(working === undefined
        ? {}
        : { units: [...working].sort((a, b) => (b.cells['started'] ?? '').localeCompare(a.cells['started'] ?? '')).map((row) => row.label) }),
    }
    await writeStatusCache(path, { of: stamp, parts })
    return statusText(parts)
  } finally {
    await unlink(refreshMarkFor(path)).catch(() => undefined)
  }
}

/** Prints the answer, or nothing; resolves with the exit code — 0, or 1 for a problem worth saying. */
export async function runHook(args: HookArgs, output: HookOutput): Promise<number> {
  const there = await stat(args.target).catch(() => undefined)
  if (there === undefined) {
    output.complain(`No document or folder at ${args.target}.`)
    return 1
  }
  // A folder is a project: silence when it means no document, or lacks the format.
  const fromProject = there.isDirectory()
  let path = args.target
  let worktreeCopy: string | undefined
  if (fromProject) {
    const found = await projectDocument(args.target)
    if (found.kind === 'none') return 0
    if (found.kind === 'problem') {
      output.complain(found.message)
      return 1
    }
    path = found.path
    worktreeCopy = found.worktreeCopy
  }
  // Which file, when it is not the folder's own: the one to write to, by name.
  const which =
    worktreeCopy === undefined
      ? ''
      : ` — the main checkout's copy, which every worktree reads and writes; write to this path, not to this worktree's ${shownPath(worktreeCopy)}`

  try {
    if (args.command === 'start-here') {
      const text = await startHereTool.run({ path }, NO_CLIENT)
      output.line(`${PRINTED_NOT_DRAWN}\n\nstart_here on ${shownPath(path)}${which}:\n\n${text}`)
      return 0
    }
    if (args.command === 'status') {
      const line = await refreshStatus(path)
      if (line !== '') output.line(line)
      return 0
    }

    const format = args.format as string
    const reading = await readFormat(path, format)
    if (reading.kind !== 'rows') {
      if (fromProject) return 0
      output.complain(reading.kind === 'gone' ? `No document at ${path}.` : reading.message)
      return 1
    }
    const unknown = [...args.match.keys()].filter((name) => !reading.columns.includes(name))
    if (unknown.length > 0) {
      output.complain(`--match names ${unknown.join(', ')}, which ${format} has not got. It has ${reading.columns.join(', ')}.`)
      return 1
    }
    const rows = matching(reading.rows, args.match)
    const matched = rows.length
    const head = args.match.size === 0 ? format : `${format} (${[...args.match].map(([key, value]) => `${key}=${value}`).join(', ')})`
    const counted = `${head}: ${String(matched)} ${matched === 1 ? 'row' : 'rows'} in ${shownPath(path)}`

    if (args.session === undefined) {
      if (matched === 0) return 0
      const text = await formatRowsTool.run({ path, format, match: Object.fromEntries(args.match) }, NO_CLIENT)
      output.line(`${counted}${which}\n\n${text}`)
      return 0
    }

    // Once per session (M51 U6): a row in full the first time, then the count once, then nothing.
    const memory = await recall(path, args.session)
    if (matched === 0) {
      if (memory.told.length > 0 || memory.said !== '') await remember(path, args.session, { told: [], said: '' })
      return 0
    }
    const told = new Set(memory.told)
    const marks = rows.map((row) => rowMark(row.key))
    const fresh = rows.filter((_row, at) => !told.has(marks[at] as string))
    if (fresh.length > 0) {
      const text = await formatRowsTool.run({ path, format, match: Object.fromEntries(args.match) }, NO_CLIENT)
      const earlier = matched - fresh.length
      const note = earlier === 0 ? '' : `; ${String(earlier)} of them printed earlier this session and not repeated`
      output.line(`${counted}${which}${note}\n\n${onlyRows(text, fresh)}`)
      await remember(path, args.session, { told: marks, said: '' })
      return 0
    }
    const line = `${counted}, every one printed in full earlier this session.`
    if (line === memory.said) return 0
    output.line(line)
    await remember(path, args.session, { told: marks, said: line })
    return 0
  } catch (error) {
    output.complain(error instanceof Error ? error.message : String(error))
    return 1
  }
}
