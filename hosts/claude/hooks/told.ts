/**
 * **What a session has already been told** (M51 U6).
 *
 * The `UserPromptSubmit` hook printed every inbox row in state `new` before
 * every prompt, so one untriaged row entered one conversation four times, and
 * every later turn re-read every copy — the turns-times-context bill the usage
 * study measured (M47). The hook's input carries the session's id, so the hook
 * remembers, per session, which rows it printed in full and the last count it
 * said, in `<document>.told`: a small file beside the writers' lock, and
 * **never in the document**, which holds what the project knows and not what a
 * host's session has seen.
 *
 * **A row is remembered by what it says, not by its id**: a text document
 * renews every id on every write (D-246), so an id would make every row new
 * again after any write. A row whose text changed is a row the session has not
 * seen, and is printed again — which is right.
 *
 * Kept small: a session not heard from in a week is forgotten, and a session's
 * marks are cut to the rows still matching. Two hooks writing at once can lose
 * one's write, and the cost of that is one row printed twice; nothing here is
 * worth a lock.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { writeWhole } from './statusCache.ts'

/** `memory.emd` → `memory.emd.told`. */
export function toldPathFor(document: string): string {
  return `${document}.told`
}

/** One session's memory. */
export interface SessionMemory {
  /** Marks of the rows printed in full. */
  readonly told: readonly string[]
  /** The count line said last, or '' when the last thing printed was rows in full, or nothing. */
  readonly said: string
}

interface Remembered extends SessionMemory {
  /** When the session was last heard from, as an ISO time. */
  readonly at: string
}

const FORGOTTEN_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** A row's mark: a short hash of what it says. */
export function rowMark(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

async function readAll(document: string): Promise<Record<string, Remembered>> {
  const text = await readFile(toldPathFor(document), 'utf8').catch(() => undefined)
  if (text === undefined) return {}
  try {
    const sessions = (JSON.parse(text) as { sessions?: unknown } | null)?.sessions
    return typeof sessions === 'object' && sessions !== null ? (sessions as Record<string, Remembered>) : {}
  } catch {
    return {}
  }
}

/** What `session` was told about this document; nothing yet when it is new. */
export async function recall(document: string, session: string): Promise<SessionMemory> {
  const found = (await readAll(document))[session]
  return {
    told: Array.isArray(found?.told) ? found.told.filter((each): each is string => typeof each === 'string') : [],
    said: typeof found?.said === 'string' ? found.said : '',
  }
}

/** Writes `session`'s memory, forgetting sessions not heard from in a week. Never throws. */
export async function remember(document: string, session: string, memory: SessionMemory, now = new Date()): Promise<void> {
  const sessions = await readAll(document)
  const kept: Record<string, Remembered> = {}
  for (const [id, each] of Object.entries(sessions)) {
    const at = Date.parse(each.at)
    if (id !== session && Number.isFinite(at) && now.getTime() - at < FORGOTTEN_AFTER_MS) kept[id] = each
  }
  kept[session] = { at: now.toISOString(), told: memory.told, said: memory.said }
  await writeWhole(toldPathFor(document), `${JSON.stringify({ sessions: kept })}\n`)
}
