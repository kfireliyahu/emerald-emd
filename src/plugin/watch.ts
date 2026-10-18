/**
 * **Telling whoever is listening that a document changed** (M44 U2) — a
 * listener, not a poll.
 *
 * The idea is the shell's (`electron/documents.ts`), rebuilt for plain Node
 * rather than imported, because `src/` reaches `electron/` through `bridge.ts`
 * and nothing else:
 *
 * - **The directory is watched, not the file** (D-127). Every writer worth
 *   catching saves by writing a sibling and renaming it over the document — the
 *   shell does, this server does — and a rename replaces the file, so a watch
 *   on the file itself follows the old one or goes deaf on the first save.
 * - **A burst is one change.** One save is several events (the sibling made,
 *   written, renamed); they settle for `SETTLE_MS` and then the file's mark is
 *   compared with the last one, so a listener hears once per change and never
 *   for a touch that changed nothing.
 * - **One watch per document, however many listen.** `watchDocument` is
 *   reference-counted: the server's subscriptions (U2), the `watch` command and
 *   a format's own subscription (U3) and the drawn view (U4) each add a
 *   listener, and the last one to stop closes the watch.
 *
 * **It holds nothing of the document**: a path, a size, a modification time and
 * a file id. What changed is for whoever is told to read.
 */

import { watch, watchFile, unwatchFile, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

/**
 * Long enough that a writer copying in chunks is reported once; short enough
 * that a listener hears well inside the second the done-test allows.
 */
const SETTLE_MS = 150

/** The fallback's interval, where `fs.watch` cannot run (a network share). */
const POLL_MS = 1_000

/** Stops this one listener. Calling it twice is harmless. */
export type StopWatching = () => void

/**
 * What says a file changed: its size, its modification time and its id. The
 * id is there for the rename — a save that lands inside the same millisecond
 * at the same size is still a different file.
 */
type Mark = string

interface Watched {
  readonly path: string
  readonly listeners: Set<() => void>
  known: Mark | undefined
  handle: FSWatcher | undefined
  polled: boolean
  timer: NodeJS.Timeout | undefined
}

/** Every document watched in this process, by its resolved path. */
const watching = new Map<string, Watched>()

/**
 * A file's mark, or `undefined` when there is none. Exported for `frame_copy`
 * (M44 U4), whose stamp is this same mark, so the frame's check and the watch
 * agree on what a change is.
 */
export async function markOf(path: string): Promise<Mark | undefined> {
  try {
    const info = await stat(path, { bigint: true })
    return `${info.size}:${info.mtimeNs}:${info.ino}`
  } catch {
    // Moved, renamed away or deleted: an answer, not a throw.
    return undefined
  }
}

/** Windows and macOS name files without regard to case by default. */
function sameName(a: string, b: string): boolean {
  return process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()
}

/** The key one document is watched under, however its path was spelled. */
function documentKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'linux' ? resolved : resolved.toLowerCase()
}

/**
 * Calls `onChange` each time the document at `path` changes on disk — a
 * rename-save included — and when it goes away. Returns the function that
 * stops it. The first call for a document starts its watch; the last stop
 * closes it.
 */
export async function watchDocument(path: string, onChange: () => void): Promise<StopWatching> {
  const key = documentKey(path)
  // A listener of its own, so the same function added twice stops twice.
  const listener = (): void => onChange()
  const existing = watching.get(key)
  const entry: Watched = existing ?? {
    path: resolve(path),
    listeners: new Set(),
    known: undefined,
    handle: undefined,
    polled: false,
    timer: undefined,
  }
  entry.listeners.add(listener)
  const stopThis: StopWatching = () => {
    if (!entry.listeners.delete(listener)) return
    if (entry.listeners.size === 0) stop(key, entry)
  }
  if (existing !== undefined) return stopThis

  watching.set(key, entry)
  // The mark it starts from, so the first event is compared with the file as
  // it was when watching began rather than with nothing.
  entry.known = await markOf(entry.path)
  if (watching.get(key) === entry && entry.listeners.size > 0) start(entry)
  return stopThis
}

/** How many documents this process is watching. For tests. */
export function watchedDocumentCount(): number {
  return watching.size
}

function start(entry: Watched): void {
  const name = basename(entry.path)
  try {
    const opened = watch(dirname(entry.path), { persistent: false }, (_event, changed) => {
      if (changed === null || sameName(basename(changed.toString()), name)) settle(entry)
    })
    opened.on('error', () => {
      opened.close()
      if (entry.handle === opened) entry.handle = undefined
      pollInstead(entry)
    })
    entry.handle = opened
  } catch {
    pollInstead(entry)
  }
}

/** A slower answer is still an answer; no answer is the failure. */
function pollInstead(entry: Watched): void {
  if (entry.polled || entry.listeners.size === 0) return
  entry.polled = true
  watchFile(entry.path, { persistent: false, interval: POLL_MS }, () => settle(entry))
}

function settle(entry: Watched): void {
  if (entry.timer !== undefined) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = undefined
    void compare(entry)
  }, SETTLE_MS)
  entry.timer.unref?.()
}

async function compare(entry: Watched): Promise<void> {
  const mark = await markOf(entry.path)
  if (mark === entry.known) return
  entry.known = mark
  for (const listener of [...entry.listeners]) {
    try {
      listener()
    } catch {
      // One listener's failure is not another's silence.
    }
  }
}

function stop(key: string, entry: Watched): void {
  entry.handle?.close()
  entry.handle = undefined
  if (entry.polled) unwatchFile(entry.path)
  entry.polled = false
  if (entry.timer !== undefined) clearTimeout(entry.timer)
  entry.timer = undefined
  if (watching.get(key) === entry) watching.delete(key)
}
