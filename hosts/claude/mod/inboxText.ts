/**
 * **What the hooks module's inbox says, as text** (M56 U2, D-547): the rule of
 * `runHook --once-per-session` and the lines it copies from `hooks/`, with no
 * import of `claude-code`, so `hosts/claude/inbox.test.ts` holds them to the
 * npx hooks' own. `inbox.ts` reads and registers; this only shapes text.
 */
import { basename, type ProjectDocument } from './project.ts'

/** The field the module adds to a classic hook's input it answered; `hooks/unless-mod.mjs` exits on it. */
export const ANSWERED_MARK = 'emerald_mod_answered'

/** `hooks/commands.ts`'s PRINTED_NOT_DRAWN, copied (the module has no Node); the test holds them equal. */
export const PRINTED_NOT_DRAWN =
  '**For you, never the person — do not repeat or paraphrase this line.** A hook printed this as text, and nothing was drawn: to show any of it, call ' +
  '`start_here` or `show_format` and follow the first line of its answer.'

/** One inbox row as `format_rows` answers it: its block, and what it says without its id. */
export interface InboxRow {
  /** The row as printed: its `**id**` heading and its fields. */
  readonly block: string
  /** What the row says, its id left out — a text document renews ids on every write (D-246). */
  readonly mark: string
  readonly subject: string
}

/** The rows of a `format_rows` answer: each block headed by its id on a line of its own. */
export function inboxRows(text: string): InboxRow[] {
  const blocks: string[][] = []
  for (const line of text.split('\n')) {
    if (/^\*\*[0-9a-f][0-9a-f-]{7,}\*\*$/i.test(line)) blocks.push([line])
    else blocks[blocks.length - 1]?.push(line)
  }
  return blocks.map((lines) => {
    const block = lines.join('\n').trimEnd()
    const fields = lines.slice(1).join('\n').trim()
    const subject = /^- subject: (.*)$/m.exec(fields)?.[1] ?? ''
    return { block, mark: fields, subject }
  })
}

/** What one session was told: the rows in full, and the count line said last. */
export interface Told {
  readonly told: readonly string[]
  readonly said: string
}

/**
 * What the inbox hook prints before a prompt, and what the session will then
 * have been told — the rule of `runHook --once-per-session`, without its file.
 * `place` is the document's path, with the worktree note when there is one.
 */
export function inboxAnswer(rows: readonly InboxRow[], memory: Told, path: string, which: string): { text: string; memory: Told } {
  if (rows.length === 0) return { text: '', memory: { told: [], said: '' } }
  const counted = `inbox (state=new): ${String(rows.length)} ${rows.length === 1 ? 'row' : 'rows'} in ${path}`
  const marks = rows.map((row) => row.mark)
  const told = new Set(memory.told)
  const fresh = rows.filter((row) => !told.has(row.mark))
  if (fresh.length > 0) {
    const earlier = rows.length - fresh.length
    const note = earlier === 0 ? '' : `; ${String(earlier)} of them printed earlier this session and not repeated`
    return { text: `${counted}${which}${note}\n\n${fresh.map((row) => row.block).join('\n\n')}`, memory: { told: marks, said: '' } }
  }
  const line = `${counted}, every one printed in full earlier this session.`
  if (line === memory.said) return { text: '', memory }
  return { text: line, memory: { told: marks, said: line } }
}

/** The worktree note the npx commands add after the path (M51 U1). */
export function worktreeNote(project: ProjectDocument): string {
  return project.kind === 'document' && project.worktreeCopy !== undefined
    ? ` — the main checkout's copy, which every worktree reads and writes; write to this path, not to this worktree's ${project.worktreeCopy}`
    : ''
}

/** The toast for rows that arrived between prompts: the person's words, the document's subjects. */
export function arrivedToast(arrived: readonly InboxRow[], document: string): string {
  const [first] = arrived
  if (arrived.length === 1 && first !== undefined && first.subject !== '') return `New in ${basename(document)}'s inbox: ${first.subject}`
  return `${String(arrived.length)} new rows in ${basename(document)}'s inbox`
}
