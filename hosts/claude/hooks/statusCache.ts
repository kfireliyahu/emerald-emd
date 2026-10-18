/**
 * **What the status line last knew, beside the document** (M51 U6).
 *
 * A status line runs on every prompt and a person waits on it, so it cannot
 * open the document: a large text `.emd` takes over a second to open, and the
 * bundle holding the tools takes a third of one to load. So the slow half — the
 * `status` command of `hooks.mjs` — reads the document and writes what it found to
 * `<document>.status`, a small file beside the writers' lock (`<document>.lock`,
 * D-304), stamped with the document's size and modification time; and the fast
 * half — `status-line.mjs`, a separate build of a few kilobytes — reads only
 * that file. When the stamp no longer matches, the fast half prints what it
 * last knew and starts the slow half in the background, once: a mark beside
 * it, `<document>.status.refreshing`, says one is already on its way.
 *
 * **Never in the document**: what a host's status line last printed is not a
 * fact the document holds, and a write to the document would wake every
 * session watching it. Node's own modules only, because both halves bundle
 * this and the fast one must stay small.
 */

import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'

/** `memory.emd` → `memory.emd.status`. */
export function statusPathFor(document: string): string {
  return `${document}.status`
}

/** `memory.emd` → `memory.emd.status.refreshing`: a refresh is on its way. */
export function refreshMarkFor(document: string): string {
  return `${document}.status.refreshing`
}

/** Which version of the document a cache describes. */
export interface DocumentStamp {
  readonly size: number
  readonly mtimeMs: number
}

/** What the status line says — each part left out when the document has not got the format. */
export interface StatusParts {
  /** Inbox rows in state `new`. */
  readonly inbox?: number
  /** The units in state `in_progress`, by `ref`. */
  readonly units?: readonly string[]
}

export interface StatusCache {
  readonly of: DocumentStamp
  readonly parts: StatusParts
}

export async function stampOf(document: string): Promise<DocumentStamp | undefined> {
  const there = await stat(document).catch(() => undefined)
  return there?.isFile() === true ? { size: there.size, mtimeMs: there.mtimeMs } : undefined
}

export function sameStamp(a: DocumentStamp, b: DocumentStamp): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs
}

export async function readStatusCache(document: string): Promise<StatusCache | undefined> {
  const text = await readFile(statusPathFor(document), 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const parsed = JSON.parse(text) as Partial<StatusCache> | null
    const of = parsed?.of
    if (typeof of?.size !== 'number' || typeof of.mtimeMs !== 'number' || typeof parsed?.parts !== 'object') return undefined
    return { of, parts: parsed.parts ?? {} }
  } catch {
    return undefined
  }
}

/**
 * Writes a file whole or not at all — a temporary name, then a rename — and
 * never throws: a cache that could not be written is a status line one prompt
 * late, never a hook that fails.
 */
export async function writeWhole(path: string, text: string): Promise<void> {
  const temporary = `${path}.${String(process.pid)}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, path)
  } catch {
    await unlink(temporary).catch(() => undefined)
  }
}

export async function writeStatusCache(document: string, cache: StatusCache): Promise<void> {
  await writeWhole(statusPathFor(document), `${JSON.stringify(cache)}\n`)
}

/** How many unit refs are named before the rest are counted. */
const UNITS_NAMED = 2

/** The line itself: `inbox 1 new · in progress: M51 U6, M33 U4 +1`, or '' when the document has neither format. */
export function statusText(parts: StatusParts): string {
  const said: string[] = []
  if (parts.inbox !== undefined) said.push(`inbox ${String(parts.inbox)} new`)
  if (parts.units !== undefined && parts.units.length > 0) {
    const named = parts.units.slice(0, UNITS_NAMED).join(', ')
    const more = parts.units.length - UNITS_NAMED
    said.push(`in progress: ${named}${more > 0 ? ` +${String(more)}` : ''}`)
  }
  return said.join(' · ')
}
