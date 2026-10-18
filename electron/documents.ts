/**
 * The document on the real filesystem: read it, write it, and notice when
 * something else writes it.
 *
 * This is the half of M9's third storage adapter that runs in the main
 * process. The renderer half is `src/data/storage/desktop.ts`, which sits
 * behind the same `StorageAdapter` seam the download and File-System-Access
 * adapters sit behind; nothing above that seam learns that the file is real.
 *
 * Three things here are worth more than the lines they cost:
 *
 * - **A write is a rename, not a truncate.** The bytes go to a sibling
 *   temporary file and are renamed over the document, which is atomic on one
 *   filesystem. A crash mid-save leaves the previous document intact instead
 *   of half a SQLite file, and a second reader — the Claude plugin (docs/f14)
 *   — never sees a partial database.
 * - **The watcher watches the directory, not the file.** Watching the file is
 *   the obvious thing and it breaks on exactly the write above: a rename
 *   replaces the inode, and a per-file watch either follows the old one or
 *   stops reporting. Every writer worth catching writes this way, so the
 *   directory is what has to be watched, filtered down to one basename.
 * - **The renderer has no ambient authority over the disk.** A path becomes
 *   usable only by coming back from a dialog the user answered, which is the
 *   File System Access API's handle model rebuilt out of paths. It costs a
 *   `Set`, and it means a bug in the renderer cannot read `~/.ssh`.
 */

import { constants, watch, watchFile, unwatchFile, type FSWatcher } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve } from 'node:path'

import {
  DOCUMENT_EXTENSION,
  NAMED_COPY_PREFIX,
  claimRollingCopy,
  documentBackupFolderName,
  marksDiffer,
  measureBackupsFolder,
  namedCopiesPast,
  namedCopyBefore,
  namedCopyMoment,
  namedCopyName,
  newestEarlierCopyFirst,
  rollingCopiesPast,
  rollingCopyMoment,
  recordBackupFolder,
  sweepBackupFolders,
  writeAtomically,
  type BackupFileSystem,
  type BackupsFolder,
  type DocumentFile,
  type EarlierCopy,
  type DocumentMark,
  type DocumentMarkReading,
} from './bridge.ts'

/**
 * Coalesces the burst of events one save produces into one question. Long
 * enough that a writer copying in chunks is asked about once; short enough
 * that the conflict bar is there before the user types another line into a
 * copy that is already stale.
 */
const SETTLE_MS = 150

/** The fallback watch's interval, used only where `fs.watch` cannot run. */
const POLL_MS = 2_000

/**
 * A save dialog answered without an extension still means an Emerald
 * document. Windows appends the filter's extension itself; macOS and Linux
 * hand back exactly what was typed, so a file called `finances` would carry no
 * file association and open in nothing.
 */
export function withDocumentExtension(path: string): string {
  return extname(path) === '' ? `${path}${DOCUMENT_EXTENSION}` : path
}

/**
 * The document the operating system launched us with, if any.
 *
 * A double-clicked `.emd` arrives as an argument on Windows and Linux —
 * macOS sends an `open-file` event instead — and so does a second launch while
 * one window is already open, which Electron forwards as `second-instance`.
 * Everything else in `argv` is ours: the executable, `.` in the dev loop,
 * Chromium's own switches, and the version argument the preload reads.
 */
export function documentFromArguments(argv: readonly string[]): string | undefined {
  return argv
    .slice(1)
    .find(
      (argument) =>
        !argument.startsWith('-') && argument.toLowerCase().endsWith(DOCUMENT_EXTENSION),
    )
}

/**
 * The paths the user has pointed at, this run.
 *
 * Every path the renderer sends has to have come from here first. Paths are
 * compared after `resolve`, so `x/../finances.emd` is the same grant as
 * `finances.emd` and neither is a way around the check.
 */
interface PathGrants {
  /** Records the path and returns it resolved, which is the form to keep. */
  grant(path: string): string
  isGranted(path: string): boolean
}

export function createPathGrants(): PathGrants {
  const granted = new Set<string>()
  return {
    grant(path: string): string {
      const full = resolve(path)
      granted.add(full)
      return full
    },
    isGranted(path: string): boolean {
      return granted.has(resolve(path))
    },
  }
}

export async function readDocument(path: string): Promise<DocumentFile> {
  const bytes = await readFile(path)
  return { path, name: basename(path), bytes: new Uint8Array(bytes) }
}

/**
 * Write, atomically (`writeAtomically`), and say what is on disk afterwards.
 *
 * The pid in the scratch name should never matter here, because the shell holds
 * a single-instance lock — but the plugin writes the same files from its own
 * process, and "should be impossible" is not a reason to name a scratch file
 * something a second writer would also choose.
 */
export async function writeDocument(path: string, bytes: Uint8Array): Promise<DocumentMark> {
  await writeAtomically({ pid: process.pid, writeFile, rename, unlink }, path, bytes)
  return markDocument(path)
}

/**
 * Where a copy of a document is kept: `finances.emd` with the label
 * `pre-M25` is `finances.pre-M25.emd`, the name older backups
 * already had — **in the document's folder of earlier copies, never beside
 * it** (M48 U4, D-470). The label is a word, never a path, so the copy cannot
 * land anywhere but that folder.
 */
export function backupPathFor(root: string, path: string, label: string): string {
  // Sixty, not forty, since a named copy's label carries its moment and a slug (D-399).
  if (!/^[A-Za-z0-9-]{1,60}$/.test(label)) throw new Error('A backup is labelled with a word.')
  return join(earlierCopiesFolder(root, path), namedCopyName(basename(path), label))
}

/**
 * Keep a copy of a document as it was, in its folder of earlier copies — once.
 * An existing copy is left as it is and `undefined` comes back: the `wx` flag
 * refuses rather than checking first, for `create_document`'s reason.
 *
 * **A named copy prunes its own kind** (M34 U6, D-399): a label `before-…` is
 * one of the copies kept before a read or when asked, and past
 * `NAMED_COPIES_KEPT` of them the oldest goes — by the moment in its name, and only
 * a file `isNamedCopyOf` recognises. Any other label is kept for good, as M25's
 * was. **Beside the rolling copies since M48 U4** (D-470): the File menu lists
 * both, and the folder records whose it is, as the plugin's copy does.
 */
export async function writeBackup(
  root: string,
  path: string,
  bytes: Uint8Array,
  label: string,
): Promise<string | undefined> {
  const target = backupPathFor(root, path, label)
  const folder = dirname(target)
  await mkdir(folder, { recursive: true })
  try {
    await writeFile(target, bytes, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined
    throw error
  }
  if (label.startsWith(NAMED_COPY_PREFIX)) await pruneNamedCopies(path, target)
  await recordBackupFolder(backupFileSystem, folder, resolve(path))
  return target
}

/** Remove this document's named copies past the newest `NAMED_COPIES_KEPT`, `keep` among them. */
async function pruneNamedCopies(path: string, keep: string): Promise<readonly string[]> {
  const folder = dirname(keep)
  const pruned = namedCopiesPast(basename(path), await readdir(folder), basename(keep)).map((each) => join(folder, each))
  // A copy that cannot be removed now is removed by the next one; it never fails the copy just kept.
  for (const file of pruned) await unlink(file).catch(() => undefined)
  return pruned
}

/**
 * This document's folder of earlier copies inside Emerald's own (M45 U4, D-455):
 * the folder the plugin copies into before a write, computed alike from the
 * same pure pieces in `bridge.ts`.
 */
export function earlierCopiesFolder(root: string, path: string): string {
  return join(root, documentBackupFolderName(resolve(path), process.platform))
}

/**
 * The copies taken of this document, newest first; none when its folder is not
 * there. The rolling ones and, since M48 U4 (D-470), the named ones, which carry
 * what they came before.
 */
export async function listEarlierCopies(root: string, path: string): Promise<readonly EarlierCopy[]> {
  const folder = earlierCopiesFolder(root, path)
  const name = basename(path)
  let names: readonly string[]
  try {
    names = await readdir(folder)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const copies: EarlierCopy[] = []
  for (const each of names) {
    const rolling = rollingCopyMoment(name, each)
    const named = rolling === undefined ? namedCopyMoment(name, each) : undefined
    const at = rolling ?? named
    if (at === undefined) continue
    const size = (await stat(join(folder, each))).size
    const before = named === undefined ? undefined : namedCopyBefore(name, each)
    copies.push(before === undefined ? { name: each, at, size } : { name: each, at, size, before })
  }
  return copies.sort(newestEarlierCopyFirst(name))
}

/**
 * Put an earlier copy back over the document (M45 U4, D-455).
 *
 * Three steps, in an order that loses nothing: the earlier copy's bytes are read
 * first — so the copy of the current file, which may prune the oldest, cannot
 * prune the one being restored — then the file as it is now is copied into the
 * same folder, then the earlier bytes are written over the document atomically.
 * The copy is named by a name `listEarlierCopies` gave, never a path: a name that
 * is not one of this document's copies is refused, so this reaches nothing but
 * that folder.
 */
export async function restoreEarlierCopy(
  root: string,
  path: string,
  copy: string,
  at: Date = new Date(),
  known: readonly string[] = [],
): Promise<{ readonly safetyCopy: string; readonly mark: DocumentMark }> {
  const name = basename(path)
  if (rollingCopyMoment(name, copy) === undefined && namedCopyMoment(name, copy) === undefined) {
    throw new Error('That is not an earlier copy of this document.')
  }
  const folder = earlierCopiesFolder(root, path)
  const bytes = new Uint8Array(await readFile(join(folder, copy)))

  await mkdir(folder, { recursive: true })
  const safetyCopy = join(
    folder,
    await claimRollingCopy(name, at, async (candidate) => {
      try {
        await copyFile(path, join(folder, candidate), constants.COPYFILE_EXCL)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw error
      }
    }),
  )
  const pruned = rollingCopiesPast(name, await readdir(folder), basename(safetyCopy))
  // A copy that cannot be removed now is removed by the next one; it never fails the restore.
  for (const each of pruned) await unlink(join(folder, each)).catch(() => undefined)
  // The plugin's housekeeping, the same function (M45 F3, D-457): this folder
  // says whose it is, and the folders of documents gone past the limit go.
  // `known` is the recents, which names a folder made before records were.
  await recordBackupFolder(backupFileSystem, folder, resolve(path))
  await sweepBackupFolders(backupFileSystem, {
    root,
    keep: basename(folder),
    now: at.getTime(),
    platform: process.platform,
    known,
  })

  return { safetyCopy, mark: await writeDocument(path, bytes) }
}

/** `node:fs` and `node:path`, as the sweep in `bridge.ts` asks for them. */
const backupFileSystem: BackupFileSystem = {
  readdir: (path) => readdir(path),
  lstat: (path) => lstat(path),
  stat: (path) => stat(path),
  readFile: (path, encoding) => readFile(path, encoding),
  writeFile: (path, text, options) => writeFile(path, text, options),
  rm: (path, options) => rm(path, options),
  join: (...parts) => join(...parts),
  rootOf: (path) => parse(path).root,
}

/** Emerald's whole folder of earlier copies, for Help › About: where, how large, for how many documents. */
export function measureEarlierCopies(root: string): Promise<BackupsFolder> {
  return measureBackupsFolder(backupFileSystem, root)
}

async function markDocument(path: string): Promise<DocumentMark> {
  const info = await stat(path)
  // Rounded, because `mtimeMs` carries sub-millisecond digits on some
  // filesystems and the renderer's mark is a whole-millisecond `lastModified`
  // from the File System Access API. Two marks of the same file have to be
  // equal whichever half of the app took them.
  return { lastModified: Math.round(info.mtimeMs), size: info.size }
}

/**
 * `markDocument`, but a file that has been moved, renamed, deleted or locked
 * is an answer rather than a throw — the store has a state for it and the
 * conflict bar has words for it.
 */
export async function readDocumentMark(path: string): Promise<DocumentMarkReading> {
  try {
    return { kind: 'mark', mark: await markDocument(path) }
  } catch (error) {
    return { kind: 'unreadable', reason: error instanceof Error ? error.message : String(error) }
  }
}

export interface DocumentWatcher {
  /** Watch this document, or stop watching when `undefined`. */
  watch(path: string | undefined): Promise<void>
  /** What we just wrote, so our own save is not reported back as someone else's. */
  noteOurWrite(path: string, mark: DocumentMark): void
  close(): void
}

/**
 * One watch at a time, because there is one open document at a time.
 *
 * `notify` fires only when the file's mark actually moved off what we last
 * saw. That is what makes our own saves silent — `noteOurWrite` moves the mark
 * before the write's own event arrives — and it is also what keeps a touch
 * that changed nothing from putting a conflict bar in front of someone.
 */
export function createDocumentWatcher(notify: () => void): DocumentWatcher {
  let watched: string | undefined
  let known: DocumentMark | undefined
  let handle: FSWatcher | undefined
  let polled: string | undefined
  let timer: NodeJS.Timeout | undefined
  let closed = false

  function stop(): void {
    handle?.close()
    handle = undefined
    if (polled !== undefined) {
      unwatchFile(polled)
      polled = undefined
    }
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    watched = undefined
    known = undefined
  }

  function settle(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void compare()
    }, SETTLE_MS)
    timer.unref?.()
  }

  async function compare(): Promise<void> {
    const path = watched
    if (path === undefined || closed) return
    const reading = await readDocumentMark(path)
    // The document changed underneath the watcher itself while we were asking.
    if (watched !== path) return

    if (reading.kind === 'unreadable') {
      // Moved, renamed or deleted. The renderer's own `readMark` says the same
      // thing when it asks; what matters here is that it is prompted to ask.
      if (known === undefined) return
      known = undefined
      notify()
      return
    }

    if (known !== undefined && !marksDiffer(known, reading.mark)) return
    // Noted before notifying: the renderer compares against its own mark, and
    // this one exists only to stop the same change being reported twice.
    known = reading.mark
    notify()
  }

  /**
   * `fs.watch` on the containing directory, filtered to one name. Where it
   * cannot run at all — a network share, an exhausted inotify budget —
   * `fs.watchFile` polls instead. A slower answer is still an answer; no
   * answer is the failure D-092 exists to prevent.
   */
  function start(path: string): void {
    const name = basename(path)
    try {
      const opened = watch(dirname(path), { persistent: false }, (_event, changed) => {
        if (changed === null || basename(changed.toString()) === name) settle()
      })
      opened.on('error', () => {
        opened.close()
        if (handle === opened) handle = undefined
        pollInstead(path)
      })
      handle = opened
    } catch {
      pollInstead(path)
    }
  }

  function pollInstead(path: string): void {
    if (closed || watched !== path || polled !== undefined) return
    polled = path
    watchFile(path, { persistent: false, interval: POLL_MS }, () => settle())
  }

  return {
    async watch(path: string | undefined): Promise<void> {
      stop()
      if (path === undefined || closed) return
      watched = path
      // The mark we start from, so the first event is compared against the
      // file as it was when watching began rather than against nothing.
      const reading = await readDocumentMark(path)
      if (watched !== path) return
      known = reading.kind === 'mark' ? reading.mark : undefined
      start(path)
    },

    noteOurWrite(path: string, mark: DocumentMark): void {
      if (watched !== undefined && resolve(watched) === resolve(path)) known = mark
    },

    close(): void {
      closed = true
      stop()
    },
  }
}
