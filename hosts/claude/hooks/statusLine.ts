/**
 * **The status line: the inbox and the unit at work, shown to the person and
 * not to the model** (M51 U6).
 *
 * A hook's stdout is the model's context; a status line's is a strip under the
 * prompt that a person reads and the model never sees. So what a person should
 * notice on every prompt — a new inbox row, which unit is in progress — costs
 * the conversation nothing there:
 *
 *     inbox 1 new · in progress: M51 U6
 *
 * This is the fast half (`statusCache.ts` says why there are two): it finds the
 * project's document as a hook does (`project.ts`, a git worktree meaning the
 * main checkout's copy), and prints what `<document>.status` says. When that
 * describes an older version of the document, it prints it anyway — a status
 * line a prompt behind is better than one that makes a person wait — and asks
 * for a refresh, unless one is already on its way.
 *
 * A host that has no status line just has the hook; nothing here is needed
 * for anything else to work.
 */

import { open, stat, unlink } from 'node:fs/promises'

import { projectDocument } from './project.ts'
import { readStatusCache, refreshMarkFor, sameStamp, stampOf, statusText } from './statusCache.ts'

/** A refresh mark older than this is a refresh that died. */
const REFRESH_GIVES_UP_MS = 30_000

export interface StatusLineOptions {
  /** Starts the slow half for `document`, which writes its cache and removes the mark. */
  readonly refresh: (document: string) => void
}

/** Takes the refresh mark; false when a live refresh already holds it. */
async function takeMark(document: string): Promise<boolean> {
  const mark = refreshMarkFor(document)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await (await open(mark, 'wx')).close()
      return true
    } catch {
      const held = await stat(mark).catch(() => undefined)
      if (held !== undefined && Date.now() - held.mtimeMs < REFRESH_GIVES_UP_MS) return false
      await unlink(mark).catch(() => undefined)
    }
  }
  return false
}

/** The document a status line is about: a `.emd` named outright, or a folder's. */
async function documentFor(target: string): Promise<string | undefined> {
  const there = await stat(target).catch(() => undefined)
  if (there?.isFile() === true) return target
  if (there?.isDirectory() !== true) return undefined
  const found = await projectDocument(target)
  return found.kind === 'document' ? found.path : undefined
}

/** What the status line prints for `target`: '' when there is nothing to say. Never throws. */
export async function statusLine(target: string, options: StatusLineOptions): Promise<string> {
  try {
    const document = await documentFor(target)
    if (document === undefined) return ''
    const [stamp, cache] = await Promise.all([stampOf(document), readStatusCache(document)])
    if (stamp === undefined) return ''
    if (cache === undefined || !sameStamp(cache.of, stamp)) {
      if (await takeMark(document)) options.refresh(document)
    }
    return cache === undefined ? '' : statusText(cache.parts)
  } catch {
    return ''
  }
}
