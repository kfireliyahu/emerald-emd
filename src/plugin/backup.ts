/**
 * The copy taken before a mutating batch, and where it goes.
 *
 * D-098 decided the copy and put it **beside the document**, named with a
 * timestamp, the last five kept, and the tool saying so in its own output — *a
 * backup the user cannot find is not a backup*. **D-455 moved it** (M45 U4): a
 * folder of timestamped copies beside every document a model writes to is a
 * folder nobody recognises as theirs, so the copy goes to Emerald's own
 * per-user folder (`backupsRoot` in `electron/bridge.ts`), one folder per
 * document, and the reason D-098 gave is answered by the app instead: File ›
 * *Earlier copies of this document* lists them to restore. Still timestamped,
 * still the last five, and the tool still names the full path — on the first
 * write to a document in a server's run, since M52 F2 (`write.ts`). **The named
 * copies followed them there** (M48 U4, D-470).
 *
 * Why a copy at all, when the plugin also dry-runs: the two protect against
 * different mistakes. A dry run catches the change you can see is wrong before
 * you make it. The backup catches the one you only recognise afterwards.
 *
 * `create_document` and the onboarding tools take none, deliberately. A backup
 * of a file that did not exist a moment ago restores nothing (D-096, D-097).
 */

import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, parse, resolve } from 'node:path'

import {
  backupsRoot,
  claimRollingCopy,
  documentBackupFolderName,
  recordBackupFolder,
  sweepBackupFolders,
  type BackupFileSystem,
  namedCopiesPast,
  namedCopyLabel,
  namedCopyName,
  newestRollingCopyFirst,
  rollingCopiesPast,
  rollingCopyMoment,
} from '../../electron/bridge.ts'

export { BACKUPS_KEPT } from '../../electron/bridge.ts'

/**
 * The folder this document's copies go to: Emerald's own, per user
 * (`EMERALD_BACKUPS_DIR` moves it, which is how the tests keep out of the real
 * one), then one folder per document.
 */
export function backupFolderFor(documentPath: string): string {
  return join(backupsRootHere(), documentBackupFolderName(resolve(documentPath), process.platform))
}

function backupsRootHere(): string {
  return backupsRoot(process.platform, process.env, homedir())
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

export interface BackupResult {
  readonly path: string
  /** Older copies removed to keep the folder from growing without end. */
  readonly pruned: readonly string[]
  /**
   * Other documents' folders removed: their document is gone and their newest
   * copy is past `ORPHANED_COPIES_DAYS` (M45 F3, D-457). Empty for a named copy.
   */
  readonly swept?: readonly string[]
}

/**
 * Copy the document into its folder, then prune the oldest copies past
 * `BACKUPS_KEPT` — by the moment in their names (`rollingCopiesPast`). Named to
 * the millisecond, and never over a copy already there: two batches inside one
 * millisecond take `-2` (M45 F2 — to the second, the later copy replaced the
 * earlier one).
 *
 * Then the housekeeping (M45 F3, D-457): the folder records whose it is, if it
 * does not yet, and the other folders of documents that are gone are swept once
 * their newest copy is past `ORPHANED_COPIES_DAYS` — `at` is the sweep's clock
 * too. Neither can fail the copy, which is the part that matters.
 */
export async function backupDocument(documentPath: string, at: Date = new Date()): Promise<BackupResult> {
  const resolved = resolve(documentPath)
  const root = backupsRootHere()
  const folderName = documentBackupFolderName(resolved, process.platform)
  const folder = join(root, folderName)
  const name = basename(documentPath)
  await mkdir(folder, { recursive: true })
  const path = join(
    folder,
    await claimRollingCopy(name, at, (candidate) => copyExclusive(documentPath, join(folder, candidate))),
  )

  const pruned = rollingCopiesPast(name, await readdir(folder), basename(path)).map((one) => join(folder, one))
  for (const one of pruned) await unlink(one).catch(() => undefined)

  await recordBackupFolder(backupFileSystem, folder, resolved)
  const swept = await sweepBackupFolders(backupFileSystem, {
    root,
    keep: folderName,
    now: at.getTime(),
    platform: process.platform,
  })

  return { path, pruned, swept }
}

/**
 * **A copy kept before something, by name** (M34 U6, D-399): before a read or a
 * batch of `NAMED_COPY_ROWS` rows or more, and whenever `keep_copy` is asked.
 *
 * The rolling five above could not be it. The Notion trial made thirty of
 * them, five were left, and none was the document before the import — the
 * model had to make that copy itself. So this one is named for what it came
 * before, is an `.emd` that opens like any other, and is pruned only against
 * its own kind: the last `NAMED_COPIES_KEPT`, oldest first, and never a file
 * `isNamedCopyOf` does not recognise, so a copy somebody named by hand stays.
 * **Oldest by the moment in its name, not its mtime**, and for a reason:
 * `copyFile` keeps the document's own modification time on Windows, so every
 * copy of one document claims the same moment, and the stamp is one this
 * function wrote. The rolling copies prune the same way since D-455.
 *
 * **In the document's folder of earlier copies, beside the rolling ones, never
 * beside the document** (M48 U4, D-470, reversing D-455's last clause): the
 * first big write of a session left one in a project folder that was a git
 * repository. Still named for what it came before, still outside the rolling
 * five, and the answer still names its full path; File › *Earlier copies of
 * this document* lists it, marked as named, with the same Restore. The folder
 * records whose it is, so a gone document's named copies are swept as its
 * rolling ones are (D-457); the sweep itself rides on the rolling copy.
 *
 * A copy of the bytes on disk, like the rolling one, so it keeps the file's
 * encoding (D-246). Two in one second with the same slug are one moment: the
 * first is kept and its path returned.
 */
export async function keepNamedCopy(
  documentPath: string,
  what: string,
  at: Date = new Date(),
): Promise<BackupResult> {
  const folder = backupFolderFor(documentPath)
  const name = basename(documentPath)
  const path = join(folder, namedCopyName(name, namedCopyLabel(what, at)))
  await mkdir(folder, { recursive: true })

  try {
    await copyFile(documentPath, path, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }

  const pruned = namedCopiesPast(name, await readdir(folder), basename(path)).map((one) => join(folder, one))
  for (const one of pruned) await unlink(one).catch(() => undefined)
  await recordBackupFolder(backupFileSystem, folder, resolve(documentPath))

  return { path, pruned }
}

/** Copy `from` to `to` unless `to` is there already; `false` when it was. */
export async function copyExclusive(from: string, to: string): Promise<boolean> {
  try {
    await copyFile(from, to, constants.COPYFILE_EXCL)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

/** The names of this document's copies in its folder, oldest first — none when the folder is not there yet. */
export async function listBackups(documentPath: string): Promise<readonly string[]> {
  const name = basename(documentPath)
  try {
    return (await readdir(backupFolderFor(documentPath)))
      .filter((one) => rollingCopyMoment(name, one) !== undefined)
      .sort(newestRollingCopyFirst(name))
      .reverse()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
