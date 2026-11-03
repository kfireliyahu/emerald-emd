/**
 * **The inbox and start_here, answered by the hooks module where it runs**
 * (M56 U2, D-547): what the two npx command hooks print (M47 U1, M51 U6), said
 * by the module instead, with no process started for it.
 *
 * **Why it passes on, marked, and never answers alone.** A module that answers
 * `classic.SessionStart` or `classic.UserPromptSubmit` without `next` keeps
 * every settings hook beneath it from running — the person's own, and every
 * other plugin's — not only this plugin's npx command (proved on Claude Code
 * 2.1.317). So it always calls `next`, with the input marked
 * (`ANSWERED_MARK`), and the plugin's npx commands start through
 * `hooks/unless-mod.mjs`, which exits at once on a marked input. Where the
 * module does not run (cloud Cowork, an older Claude Code), nothing marks the
 * input and the npx commands run as before: the floor.
 *
 * **It marks only what it answered.** Where it cannot read — the person's rules
 * would ask first (`npx emerald-mcp init` allows the three reads, D-541), the
 * server is not up, a read failed — it passes on unmarked and the npx command
 * says what it always said. A folder that means no document is marked with
 * nothing added, which is what the npx command would print, without its
 * process.
 *
 * **What it says is what the npx commands say**, word for word
 * (`hosts/claude/inbox.test.ts`): start_here at `SessionStart`, headed by the
 * same line for the model; before a prompt, each new inbox row in full the
 * first time this session meets it, then the count once, then nothing until
 * the rows change. The rows a session was told are kept in this module's
 * memory by session, in place of `<document>.told` — a reload of the module
 * forgets them, and the cost of that is a row printed twice.
 *
 * **Between prompts it watches** (`$.clock.every`): the document's size and
 * time, and when they change it reads the inbox and the units in progress
 * again, puts the status line (`status.ts`) right, and raises a toast for a
 * row that arrived — for the person. The model is told at the next prompt,
 * never in the middle of a turn. A prompt after a change the watch has not yet
 * read waits for that one read.
 *
 * **A change it reads is the pane's cue too** (M56 F1): a reading whose size
 * or time differs from the one before calls the pane's `documentChanged`, and
 * an open pane reads its answer again — the only watch on the document is
 * this one.
 *
 * Read-only, as the pane is: `start_here` and `format_rows`, nothing else.
 */
import type { EngineInterface, On } from 'claude-code'

import { ANSWERED_MARK, arrivedToast, inboxAnswer, inboxRows, PRINTED_NOT_DRAWN, worktreeNote, type InboxRow, type Told } from './inboxText.ts'
import { documentChanged } from './pane.tsx'
import { projectDocument, type ProjectDocument, type ProjectFiles } from './project.ts'
import { showStatus, unitsFromTable } from './status.ts'

/** The plugin's own server, by its key in `plugin.json`. */
const SERVER = 'emerald'
/** Everything the module may ask of the server for this: two answers, both read-only. */
export const INBOX_READS = ['start_here', 'format_rows'] as const
type Read = (typeof INBOX_READS)[number]
/** How often the watch looks at the document's size and time. */
export const WATCH_MS = 5000

// --- What one load of the module knows ---------------------------------------

interface Reading {
  readonly size: number
  readonly mtimeMs: number
  /** The new rows; undefined when the document has no inbox it could read. */
  readonly rows: readonly InboxRow[] | undefined
}

let project: ProjectDocument | undefined
let cache: Reading | undefined
let inFlight: Promise<Reading | undefined> | undefined
let watch: { cancel(): void } | undefined
const sessions = new Map<string, Told>()

function filesOf($: EngineInterface): ProjectFiles {
  return {
    read: (path) => $.fs.read(path),
    list: (path) => $.fs.list(path),
    stat: (path) => $.fs.stat(path),
  }
}

async function projectOf($: EngineInterface, cwd: string): Promise<ProjectDocument> {
  project ??= await projectDocument(filesOf($), cwd)
  return project
}

/** The server's answer as text, or undefined when it could not be asked. */
async function ask($: EngineInterface, tool: Read, args: Record<string, unknown>): Promise<{ text: string; isError: boolean } | undefined> {
  const connected = await $.mcp.connect(SERVER)
  if (!connected.isConnected) return undefined
  const result = await $.mcp.call(connected.server, tool, args)
  const text = result.content
    .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('\n\n')
  return { text, isError: result.isError === true }
}

/** Whether the person's rules let this read run without asking them (the server connected first, D-541). */
async function isAllowed($: EngineInterface, tool: Read): Promise<boolean> {
  const connected = await $.mcp.connect(SERVER)
  if (!connected.isConnected) return false
  const name = `mcp__${connected.server.replace(/[^A-Za-z0-9_-]/g, '_')}__${tool}`
  const verdict = await $.tool.check({ tool: name, input: {} }).catch(() => undefined)
  return verdict?.decision === 'allow'
}

async function stampOf($: EngineInterface, path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  const found = await $.fs.stat(path).catch(() => undefined)
  return found?.kind === 'file' ? { size: found.size, mtimeMs: found.mtimeMs } : undefined
}

const isCurrent = (reading: Reading | undefined, stamp: { size: number; mtimeMs: number }): reading is Reading =>
  reading !== undefined && reading.size === stamp.size && reading.mtimeMs === stamp.mtimeMs

/** The units in progress, read after the inbox and never waited on: the status line only. */
async function readUnits($: EngineInterface, path: string, rows: Reading['rows']): Promise<void> {
  const units = await ask($, 'format_rows', { path, format: 'unit', match: { state: 'in_progress' }, columns: ['ref', 'started'] }).catch(() => undefined)
  showStatus($, {
    ...(rows === undefined ? {} : { inbox: rows.length }),
    ...(units === undefined || units.isError ? {} : { units: unitsFromTable(units.text) }),
  })
}

/**
 * Reads the inbox's new rows, once at a time; undefined when it could not.
 * The stamp is taken first, so a write that lands while it reads leaves the
 * reading stale, never wrong. A reading that is not the first, of a document
 * whose stamp moved, tells the pane (`documentChanged`) — whether the watch
 * or a prompt read it.
 */
function readInbox($: EngineInterface, path: string): Promise<Reading | undefined> {
  inFlight ??= (async () => {
    const stamp = await stampOf($, path)
    if (stamp === undefined) return undefined
    const answer = await ask($, 'format_rows', { path, format: 'inbox', match: { state: 'new' } })
    if (answer === undefined) return undefined
    const reading: Reading = { ...stamp, rows: answer.isError ? undefined : inboxRows(answer.text) }
    const before = cache
    cache = reading
    if (before !== undefined && !isCurrent(before, stamp)) documentChanged($)
    void readUnits($, path, reading.rows).catch(() => undefined)
    return reading
  })()
    .catch(() => undefined)
    .finally(() => {
      inFlight = undefined
    })
  return inFlight
}

/** The watch's look: when the document changed, read it again, and raise a toast for a row that arrived. */
async function look($: EngineInterface): Promise<void> {
  if (project?.kind !== 'document' || inFlight !== undefined) return
  const path = project.path
  const stamp = await stampOf($, path)
  if (stamp === undefined || isCurrent(cache, stamp) || !(await isAllowed($, 'format_rows'))) return
  const before = cache?.rows
  const now = await readInbox($, path)
  if (before === undefined || now?.rows === undefined) return
  const seen = new Set(before.map((row) => row.mark))
  const arrived = now.rows.filter((row) => !seen.has(row.mark))
  if (arrived.length > 0) $.ui.toast(arrivedToast(arrived, path))
}

/** Adds the module's text to what the hooks beneath answered. */
function withContext<R extends { additionalContext?: string[] }>(result: R, text: string): R {
  return text === '' ? result : { ...result, additionalContext: [...(result.additionalContext ?? []), text] }
}

function marked<T extends object>(e: T): T {
  return { ...e, [ANSWERED_MARK]: true }
}

/** start_here as the npx `start-here` command prints it; undefined where the module cannot say it. */
async function startHere($: EngineInterface, cwd: string): Promise<string | undefined> {
  const found = await projectOf($, cwd)
  if (found.kind === 'none') return ''
  if (found.kind === 'problem' || !(await isAllowed($, 'start_here'))) return undefined
  const answer = await ask($, 'start_here', { path: found.path })
  if (answer === undefined || answer.isError) return undefined
  return `${PRINTED_NOT_DRAWN}\n\nstart_here on ${found.path}${worktreeNote(found)}:\n\n${answer.text}`
}

/** The inbox's text before a prompt for `session`; undefined where the module cannot say it. */
async function beforePrompt($: EngineInterface, cwd: string, session: string): Promise<string | undefined> {
  const found = await projectOf($, cwd)
  if (found.kind === 'none') return ''
  if (found.kind === 'problem' || !(await isAllowed($, 'format_rows'))) return undefined
  const stamp = await stampOf($, found.path)
  if (stamp === undefined) return undefined
  const reading = isCurrent(cache, stamp) ? cache : await readInbox($, found.path)
  if (reading === undefined) return undefined
  if (reading.rows === undefined) return ''
  const answer = inboxAnswer(reading.rows, sessions.get(session) ?? { told: [], said: '' }, found.path, worktreeNote(found))
  sessions.set(session, answer.memory)
  return answer.text
}

export function registerInbox(on: On): void {
  // A matcher, because the engine refuses a module's second unmatched `session.start` hook (pane.tsx has one).
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    project = await projectDocument(filesOf($), e.cwd)
    watch?.cancel()
    watch = project.kind === 'document' ? $.clock.every(WATCH_MS, () => void look($).catch(() => undefined)) : undefined
    return next(e)
  })

  // The npx `start-here` hook's matcher: startup, clear and compact; never a resume.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source !== 'startup' && e.source !== 'clear' && e.source !== 'compact') return next(e)
    if (e.source === 'clear') sessions.delete(e.session_id)
    const text = await startHere($, e.cwd).catch(() => undefined)
    if (text === undefined) return next(e)
    // The status line and the toast's baseline, read once the session is up.
    $.clock.after(0, () => void look($).catch(() => undefined))
    return withContext(await next(marked(e)), text)
  }).catch((_$, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const text = await beforePrompt($, e.cwd, e.session_id).catch(() => undefined)
    if (text === undefined) return next(e)
    return withContext(await next(marked(e)), text)
  }).catch((_$, e, next) => next(e))
}
