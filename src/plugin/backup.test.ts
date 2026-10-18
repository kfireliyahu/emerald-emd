/**
 * The rolling copy's name is unique (M45 F2): named to the second, two batches
 * inside one second wrote one name and the later copy replaced the earlier —
 * seen live, two writes at 12:11:12 left one copy.
 */

import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { backupDocument, backupFolderFor, listBackups } from './backup.ts'
import {
  BACKUP_RECORD_NAME,
  BACKUPS_ROOT_VARIABLE,
  ORPHANED_COPIES_DAYS,
  documentBackupFolderName,
  rollingCopyName,
} from '../../electron/bridge.ts'
import { tempDir } from '../testing/tempDir'

describe('backupDocument', () => {
  it('keeps two copies taken inside one millisecond, and lists them oldest first', async () => {
    const path = join(await tempDir('emerald-backup-'), 'work.emd')
    const at = new Date(Date.UTC(2026, 9, 9, 12, 11, 12, 315))

    await writeFile(path, 'first')
    const one = await backupDocument(path, at)
    await writeFile(path, 'second')
    const two = await backupDocument(path, at)

    expect(one.path).not.toBe(two.path)
    expect(await readFile(one.path, 'utf8')).toBe('first')
    expect(await readFile(two.path, 'utf8')).toBe('second')
    expect(await listBackups(path)).toEqual(['work.emd.20261009T121112.315.bak', 'work.emd.20261009T121112.315-2.bak'])
  })
})

/**
 * **The folder cleans up after itself** (M45 F3, D-457): a gone document's
 * folder goes once its newest copy is past `ORPHANED_COPIES_DAYS`, and nothing
 * else does. Each test has its own root — never the real per-user folder — and
 * the clock is the `at` a copy is taken with.
 */
describe('the sweep a copy takes with it', () => {
  const DAY = 86_400_000
  const taken = Date.UTC(2026, 8, 1, 9, 0, 0)
  const daysLater = (days: number): Date => new Date(taken + days * DAY)
  let root: string
  let saved: string | undefined
  let place: string

  beforeEach(async () => {
    saved = process.env[BACKUPS_ROOT_VARIABLE]
    root = await tempDir('emerald-sweep-root-')
    place = await tempDir('emerald-sweep-docs-')
    process.env[BACKUPS_ROOT_VARIABLE] = root
  })
  afterEach(() => {
    process.env[BACKUPS_ROOT_VARIABLE] = saved
  })

  /** A folder of copies for a document at `path`, its newest copy taken at `taken`, with a record unless told otherwise. */
  async function folderFor(path: string, record: string | null = resolve(path)): Promise<string> {
    const folder = join(root, documentBackupFolderName(resolve(path), process.platform))
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, rollingCopyName(basename(path), new Date(taken - DAY))), 'older')
    await writeFile(join(folder, rollingCopyName(basename(path), new Date(taken))), 'newest')
    if (record !== null) await writeFile(join(folder, BACKUP_RECORD_NAME), `${record}\n`)
    return folder
  }

  async function exists(path: string): Promise<boolean> {
    return readdir(path).then(
      () => true,
      () => false,
    )
  }

  async function writeTo(name: string): Promise<string> {
    const path = join(place, name)
    await writeFile(path, 'bytes')
    return path
  }

  it(`keeps a gone document's folder at ${String(ORPHANED_COPIES_DAYS - 1)} days and removes it at ${String(ORPHANED_COPIES_DAYS + 1)}`, async () => {
    const gone = await folderFor(join(place, 'renamed-away.emd'))
    const working = await writeTo('work.emd')

    const early = await backupDocument(working, daysLater(ORPHANED_COPIES_DAYS - 1))
    expect(early.swept).toEqual([])
    expect(await exists(gone)).toBe(true)

    const late = await backupDocument(working, daysLater(ORPHANED_COPIES_DAYS + 1))
    expect(late.swept).toEqual([basename(gone)])
    expect(await exists(gone)).toBe(false)
    // The copy itself was taken, and its folder now says whose it is.
    expect(await readFile(late.path, 'utf8')).toBe('bytes')
    expect(await readFile(join(backupFolderFor(working), BACKUP_RECORD_NAME), 'utf8')).toBe(`${resolve(working)}\n`)
  })

  it("never sweeps a live document's folder, however old its copies", async () => {
    const live = await writeTo('kept.emd')
    const folder = await folderFor(live)
    const working = await writeTo('work.emd')

    const result = await backupDocument(working, daysLater(400))

    expect(result.swept).toEqual([])
    expect((await readdir(folder)).length).toBe(3)
  })

  it('leaves a folder whose record cannot be read, or does not name its folder', async () => {
    const garbled = await folderFor(join(place, 'garbled.emd'), 'not a path\nat all')
    const elsewhere = await folderFor(join(place, 'elsewhere.emd'), resolve(join(place, 'another.emd')))
    const directory = await folderFor(join(place, 'directory.emd'), null)
    await mkdir(join(directory, BACKUP_RECORD_NAME))
    const working = await writeTo('work.emd')

    expect((await backupDocument(working, daysLater(400))).swept).toEqual([])
    for (const folder of [garbled, elsewhere, directory]) expect(await exists(folder)).toBe(true)
  })

  it('leaves a folder with no record when nothing names its document, and the next copy into it writes one', async () => {
    const path = await writeTo('older.emd')
    const unrecorded = await folderFor(path, null)
    await rm(path)
    const working = await writeTo('work.emd')

    expect((await backupDocument(working, daysLater(400))).swept).toEqual([])
    expect(await exists(unrecorded)).toBe(true)

    // The same document back, and copied: its folder now says whose it is.
    await writeFile(path, 'back')
    await backupDocument(path, daysLater(400))
    expect(await readFile(join(unrecorded, BACKUP_RECORD_NAME), 'utf8')).toBe(`${resolve(path)}\n`)
  })

  it('never follows a link out of the folder, and never touches what it points at', async () => {
    const outside = await tempDir('emerald-sweep-outside-')
    const gonePath = join(place, 'linked.emd')
    const name = documentBackupFolderName(resolve(gonePath), process.platform)
    await writeFile(join(outside, rollingCopyName('linked.emd', new Date(taken))), 'not ours')
    await writeFile(join(outside, BACKUP_RECORD_NAME), `${resolve(gonePath)}\n`)
    // A junction needs no privilege on Windows; elsewhere it is a plain directory link.
    await symlink(outside, join(root, name), 'junction')
    const working = await writeTo('work.emd')

    expect((await backupDocument(working, daysLater(400))).swept).toEqual([])
    expect((await readdir(outside)).length).toBe(2)
  })

  it('touches nothing in the folder that this code did not name', async () => {
    await mkdir(join(root, 'Somebody else'))
    await writeFile(join(root, 'Somebody else', rollingCopyName('x.emd', new Date(taken))), 'x')
    await writeFile(join(root, 'notes.txt'), 'a person put this here')
    const working = await writeTo('work.emd')

    await backupDocument(working, daysLater(400))

    expect((await readdir(root)).sort()).toEqual(
      ['Somebody else', basename(backupFolderFor(working)), 'notes.txt'].sort(),
    )
  })
})
