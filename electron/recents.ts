/**
 * The documents this person has opened, most recent first.
 *
 * **The list is authority as well as convenience** (D-128). D-127 gave the
 * renderer no ambient access to the disk: a path works only after coming back
 * from a dialog the user answered *in this run*. A recents list is the same
 * promise across runs — every path in it is one the user chose once — so
 * loading it at startup grants exactly those paths and nothing else. That is
 * what lets "Open Recent" and a double-clicked document work without widening
 * the renderer's reach by a single file.
 *
 * It lives in the main process, in `userData`, rather than in the renderer's
 * `localStorage` beside the crash snapshot. Three reasons, in order: the
 * grants above have to be decided where the file operations happen; the File
 * menu is built in main and needs the list before a page exists; and a list of
 * paths on someone's disk is a property of the installation rather than of any
 * document.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import type { RecentDocument } from './bridge.ts'

export type { RecentDocument }

/**
 * Eight. Long enough to cover a person who keeps last year's document beside
 * this year's, short enough that the menu is still a list rather than a
 * history — and short enough that granting every path in it stays a sentence
 * anyone can check.
 */
export const RECENT_LIMIT = 8

/** Most recent first, no duplicates, capped. Paths are compared resolved. */
export function withRecent(
  list: readonly RecentDocument[],
  path: string,
  openedAt: number,
): RecentDocument[] {
  const full = resolve(path)
  const others = list.filter((entry) => resolve(entry.path) !== full)
  return [{ path: full, name: basename(full), openedAt }, ...others].slice(0, RECENT_LIMIT)
}

/** Used when a document turns out not to be there any more; see `main.ts`. */
export function withoutRecent(
  list: readonly RecentDocument[],
  path: string,
): RecentDocument[] {
  const full = resolve(path)
  return list.filter((entry) => resolve(entry.path) !== full)
}

/**
 * Defensive, like every decoder in `src/data/repositories/`: this file is JSON
 * on somebody's disk, it can be edited or truncated, and a bad line in it must
 * cost one entry rather than the app's ability to start.
 */
export function decodeRecents(text: string): RecentDocument[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const decoded: RecentDocument[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const path = row['path']
    if (typeof path !== 'string' || path === '') continue
    const openedAt = row['openedAt']
    decoded.push({
      path,
      name: typeof row['name'] === 'string' && row['name'] !== '' ? row['name'] : basename(path),
      openedAt: typeof openedAt === 'number' && Number.isFinite(openedAt) ? openedAt : 0,
    })
    if (decoded.length === RECENT_LIMIT) break
  }
  return decoded
}

export function encodeRecents(list: readonly RecentDocument[]): string {
  return `${JSON.stringify(list, null, 2)}\n`
}

/** A missing or unreadable file is an empty list, never a failure to start. */
export async function loadRecents(file: string): Promise<RecentDocument[]> {
  try {
    return decodeRecents(await readFile(file, 'utf8'))
  } catch {
    return []
  }
}

export async function saveRecents(file: string, list: readonly RecentDocument[]): Promise<void> {
  await writeFile(file, encodeRecents(list), 'utf8')
}
