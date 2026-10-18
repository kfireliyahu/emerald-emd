import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createDocumentWatcher,
  createPathGrants,
  documentFromArguments,
  earlierCopiesFolder,
  listEarlierCopies,
  measureEarlierCopies,
  readDocument,
  readDocumentMark,
  restoreEarlierCopy,
  withDocumentExtension,
  backupPathFor,
  writeBackup,
  writeDocument,
  type DocumentWatcher,
} from './documents.ts'
import { tempDir } from '../src/testing/tempDir'
import { BACKUP_RECORD_NAME, BACKUPS_KEPT, ORPHANED_COPIES_DAYS, marksDiffer, namedCopyLabel, rollingCopyName } from './bridge.ts'

/**
 * The filesystem half of the desktop adapter (D-127), against a real temporary
 * directory rather than a mock: an atomic write and a directory watch are
 * claims about the operating system, and a fake filesystem would agree with
 * whatever we wrote here.
 */

let directory: string
let document: string

beforeEach(async () => {
  directory = await tempDir('emerald-')
  document = join(directory, 'finances.emd')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** Resolves on the next notification, or rejects when the watch missed it. */
function nextChange(watched: { changes: number }, within = 4_000): Promise<void> {
  const start = watched.changes
  return new Promise((resolve, reject) => {
    const began = Date.now()
    const poll = setInterval(() => {
      if (watched.changes > start) {
        clearInterval(poll)
        resolve()
      } else if (Date.now() - began > within) {
        clearInterval(poll)
        reject(new Error('the watcher never reported a change'))
      }
    }, 25)
  })
}

function counting(): { changes: number; watcher: DocumentWatcher } {
  const counted = { changes: 0, watcher: undefined as unknown as DocumentWatcher }
  counted.watcher = createDocumentWatcher(() => {
    counted.changes += 1
  })
  return counted
}

describe('withDocumentExtension', () => {
  it('names a document a document, whatever the dialog handed back', () => {
    expect(withDocumentExtension('/home/k/finances')).toBe('/home/k/finances.emd')
  })

  it('leaves an answer that already has an extension alone', () => {
    expect(withDocumentExtension('/home/k/finances.emd')).toBe('/home/k/finances.emd')
    // Not ours, but the user typed it and this is not the place to argue.
    expect(withDocumentExtension('/home/k/finances.db')).toBe('/home/k/finances.db')
  })
})

describe('documentFromArguments', () => {
  it('finds the document a double-click passed in', () => {
    expect(documentFromArguments(['emerald.exe', 'C:\\Users\\k\\finances.emd'])).toBe(
      'C:\\Users\\k\\finances.emd',
    )
  })

  it('ignores our own arguments — the dev loop passes `.`, Chromium passes switches', () => {
    expect(documentFromArguments(['electron', '.', '--emerald-version=0.0.0'])).toBeUndefined()
    expect(documentFromArguments(['emerald.exe'])).toBeUndefined()
    expect(
      documentFromArguments(['emerald.exe', '--remote-debugging-port=9333', '/k/f.emd']),
    ).toBe('/k/f.emd')
  })

  it('is not fooled by a switch that happens to end in the extension', () => {
    expect(documentFromArguments(['emerald.exe', '--open=x.emd'])).toBeUndefined()
  })

  it('does not claim a file of some other kind', () => {
    expect(documentFromArguments(['emerald.exe', '/k/statement.xlsx'])).toBeUndefined()
  })
})

describe('path grants', () => {
  it('refuses a path the user never pointed at', () => {
    const grants = createPathGrants()
    expect(grants.isGranted('/etc/passwd')).toBe(false)
  })

  it('grants what came back from a dialog, and only that', () => {
    const grants = createPathGrants()
    grants.grant(document)
    expect(grants.isGranted(document)).toBe(true)
    expect(grants.isGranted(join(directory, 'other.emd'))).toBe(false)
  })

  it('is not fooled by a path that walks back to the same file', () => {
    const grants = createPathGrants()
    grants.grant(document)
    expect(grants.isGranted(join(directory, 'nested', '..', 'finances.emd'))).toBe(true)
    // …and the walk cannot manufacture a grant it did not have.
    expect(grants.isGranted(join(directory, '..', 'elsewhere.emd'))).toBe(false)
  })
})

describe('writeDocument', () => {
  it('writes the bytes and reports what is now on disk', async () => {
    const mark = await writeDocument(document, new Uint8Array([1, 2, 3, 4]))
    expect([...(await readFile(document))]).toEqual([1, 2, 3, 4])
    expect(mark.size).toBe(4)
  })

  it('leaves no temporary file behind', async () => {
    await writeDocument(document, new Uint8Array([1, 2, 3]))
    await writeDocument(document, new Uint8Array([9]))
    expect(await readdir(directory)).toEqual(['finances.emd'])
  })

  it('cleans up after itself when the write cannot land', async () => {
    const impossible = join(directory, 'no-such-directory', 'finances.emd')
    await expect(writeDocument(impossible, new Uint8Array([1]))).rejects.toThrow()
    expect(await readdir(directory)).toEqual([])
  })

  it('round-trips through readDocument, with the basename the header shows', async () => {
    await writeDocument(document, new Uint8Array([7, 7]))
    const opened = await readDocument(document)
    expect(opened.name).toBe('finances.emd')
    expect([...opened.bytes]).toEqual([7, 7])
  })
})

describe('readDocumentMark', () => {
  it('answers rather than throws when the file was moved or deleted', async () => {
    const reading = await readDocumentMark(join(directory, 'gone.emd'))
    expect(reading.kind).toBe('unreadable')
  })

  it('sees a change of size', async () => {
    await writeDocument(document, new Uint8Array([1]))
    const first = await readDocumentMark(document)
    await writeDocument(document, new Uint8Array([1, 2]))
    const second = await readDocumentMark(document)
    if (first.kind !== 'mark' || second.kind !== 'mark') throw new Error('unreadable')
    expect(marksDiffer(first.mark, second.mark)).toBe(true)
  })
})

describe('the watcher', () => {
  it('reports a write by somebody else', async () => {
    await writeDocument(document, new Uint8Array([1, 2, 3]))
    const watched = counting()
    await watched.watcher.watch(document)
    try {
      const change = nextChange(watched)
      await writeFile(document, new Uint8Array([4, 5, 6, 7, 8]))
      await change
    } finally {
      watched.watcher.close()
    }
  })

  it('survives the atomic replace every serious writer uses', async () => {
    await writeDocument(document, new Uint8Array([1]))
    const watched = counting()
    await watched.watcher.watch(document)
    try {
      // The rename swaps the inode. A watch on the file itself would have
      // stopped reporting here; the directory watch is why this passes.
      const change = nextChange(watched)
      await writeDocument(document, new Uint8Array([1, 2, 3]))
      await change
    } finally {
      watched.watcher.close()
    }
  })

  it('stays silent about our own save', async () => {
    await writeDocument(document, new Uint8Array([1]))
    const watched = counting()
    await watched.watcher.watch(document)
    try {
      const mark = await writeDocument(document, new Uint8Array([1, 2, 3, 4]))
      watched.watcher.noteOurWrite(document, mark)
      await new Promise((resolve) => setTimeout(resolve, 800))
      expect(watched.changes).toBe(0)
    } finally {
      watched.watcher.close()
    }
  })

  it('says nothing more once it is closed', async () => {
    await writeDocument(document, new Uint8Array([1]))
    const watched = counting()
    await watched.watcher.watch(document)
    watched.watcher.close()
    await writeFile(document, new Uint8Array([1, 2, 3, 4, 5]))
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(watched.changes).toBe(0)
  })

  it('reports the file disappearing, which is a conflict of its own', async () => {
    await writeDocument(document, new Uint8Array([1]))
    const watched = counting()
    await watched.watcher.watch(document)
    try {
      const change = nextChange(watched)
      await rm(document)
      await change
    } finally {
      watched.watcher.close()
    }
  })
})

describe('writeBackup (M25 U2; in the folder of earlier copies since M48 U4, D-470)', () => {
  it("keeps the copy in the document's folder of earlier copies, never beside it", async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    const written = await writeBackup(root, path, new TextEncoder().encode('as it was'), 'pre-M25')

    expect(written).toBe(join(earlierCopiesFolder(root, path), 'finances.pre-M25.emd'))
    expect(await readFile(written ?? '', 'utf8')).toBe('as it was')
    expect(await readdir(directory)).toEqual(['finances.emd'])
    expect(await readFile(join(earlierCopiesFolder(root, path), BACKUP_RECORD_NAME), 'utf8')).toContain('finances.emd')
  })

  it('never overwrites a copy that is already there — the first one is the one worth keeping', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeBackup(root, path, new TextEncoder().encode('first'), 'pre-M25')
    expect(await writeBackup(root, path, new TextEncoder().encode('second'), 'pre-M25')).toBeUndefined()
    expect(await readFile(backupPathFor(root, path, 'pre-M25'), 'utf8')).toBe('first')
  })

  it('takes a word for a label, never a path', () => {
    expect(() => backupPathFor(directory, join(directory, 'finances.emd'), '../elsewhere')).toThrow(/word/)
    expect(() => backupPathFor(directory, join(directory, 'finances.emd'), '')).toThrow(/word/)
  })

  it('keeps the last three named copies and nothing it did not name (M34 U6, D-399)', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    const folder = earlierCopiesFolder(root, path)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'finances.before-the-move.emd'), 'by hand')
    for (let k = 0; k < 5; k += 1) {
      const label = namedCopyLabel('reading tasks.csv', new Date(Date.UTC(2026, 9, 6, 12, 0, k)))
      await writeBackup(root, path, new TextEncoder().encode(String(k)), label)
    }
    const left = (await readdir(folder)).filter((one) => one !== BACKUP_RECORD_NAME).sort()
    expect(left).toEqual([
      'finances.before-20261006T120002-reading-tasks-csv.emd',
      'finances.before-20261006T120003-reading-tasks-csv.emd',
      'finances.before-20261006T120004-reading-tasks-csv.emd',
      'finances.before-the-move.emd',
    ])
    expect(await readdir(directory)).toEqual([])
  })
})

describe('earlier copies (M45 U4, D-455)', () => {
  /** A copy as the plugin leaves one: in the document's folder inside the root, named for its moment. */
  async function copyAt(root: string, path: string, second: number, text: string): Promise<string> {
    const folder = earlierCopiesFolder(root, path)
    await mkdir(folder, { recursive: true })
    const name = rollingCopyName('finances.emd', new Date(Date.UTC(2026, 9, 9, 12, 0, second)))
    await writeFile(join(folder, name), text)
    return name
  }

  it('lists the copies newest first, with when and how large, and none for a document with no folder', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    expect(await listEarlierCopies(root, path)).toEqual([])

    await copyAt(root, path, 1, 'one')
    const newer = await copyAt(root, path, 2, 'two!')
    await writeFile(join(earlierCopiesFolder(root, path), 'notes.txt'), 'not a copy')

    const listed = await listEarlierCopies(root, path)
    expect(listed.map((one) => one.name)).toEqual([newer, rollingCopyName('finances.emd', new Date(Date.UTC(2026, 9, 9, 12, 0, 1)))])
    expect(listed[0]).toEqual({ name: newer, at: Date.UTC(2026, 9, 9, 12, 0, 2), size: 4 })
  })

  it('restores: a copy of the file as it is first, then the earlier bytes over it — and nothing beside it', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    const earlier = await copyAt(root, path, 1, 'as it was')
    const before = (await readdir(directory)).sort()

    const restored = await restoreEarlierCopy(root, path, earlier, new Date(Date.UTC(2026, 9, 9, 13, 0, 0)))

    expect(await readFile(path, 'utf8')).toBe('as it was')
    expect(await readFile(restored.safetyCopy, 'utf8')).toBe('now')
    expect(restored.safetyCopy.startsWith(earlierCopiesFolder(root, path))).toBe(true)
    expect(restored.mark.size).toBe('as it was'.length)
    expect((await readdir(directory)).sort()).toEqual(before)
  })

  it('restores the oldest of a full folder, though the copy taken first prunes it', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    const names: string[] = []
    for (let k = 0; k < BACKUPS_KEPT; k += 1) names.push(await copyAt(root, path, k, `copy ${String(k)}`))

    await restoreEarlierCopy(root, path, names[0] ?? '', new Date(Date.UTC(2026, 9, 9, 13, 0, 0)))

    expect(await readFile(path, 'utf8')).toBe('copy 0')
    expect(await listEarlierCopies(root, path)).toHaveLength(BACKUPS_KEPT)
  })

  it('a restore in the same millisecond as a copy keeps both, and the list puts the later first (M45 F2)', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    const moment = new Date(Date.UTC(2026, 9, 9, 12, 0, 1))
    const earlier = await copyAt(root, path, 1, 'as it was')

    const restored = await restoreEarlierCopy(root, path, earlier, moment)

    expect(restored.safetyCopy.endsWith(rollingCopyName('finances.emd', moment, 2))).toBe(true)
    expect((await listEarlierCopies(root, path)).map((one) => one.name)).toEqual([
      rollingCopyName('finances.emd', moment, 2),
      earlier,
    ])
  })

  it('a restore sweeps too: a folder with no record goes when the recents name its document and it is gone (M45 F3)', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    const earlier = await copyAt(root, path, 1, 'as it was')
    const gone = join(directory, 'moved-away.emd')
    const goneFolder = earlierCopiesFolder(root, gone)
    await mkdir(goneFolder, { recursive: true })
    await writeFile(join(goneFolder, rollingCopyName('moved-away.emd', new Date(Date.UTC(2026, 8, 1)))), 'old')
    const later = new Date(Date.UTC(2026, 8, 1) + (ORPHANED_COPIES_DAYS + 1) * 86_400_000)

    await restoreEarlierCopy(root, path, earlier, later, [path])
    expect((await readdir(root)).length).toBe(2)

    await restoreEarlierCopy(root, path, earlier, later, [path, gone])
    expect(await readdir(root)).toEqual([earlierCopiesFolder(root, path).slice(root.length + 1)])
    expect(await readFile(join(earlierCopiesFolder(root, path), BACKUP_RECORD_NAME), 'utf8')).toContain('finances.emd')

    const measured = await measureEarlierCopies(root)
    expect(measured).toMatchObject({ path: root, documents: 1 })
    expect(measured.bytes).toBeGreaterThan(0)
  })

  it('lists a named copy beside the rolling ones, marked by what it came before, and restores it (M48 U4, D-470)', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    const rolling = await copyAt(root, path, 1, 'rolled')
    const named = await writeBackup(
      root,
      path,
      new TextEncoder().encode('before the read'),
      namedCopyLabel('reading tasks.csv', new Date(Date.UTC(2026, 9, 9, 12, 0, 5))),
    )
    const hebrew = await writeBackup(
      root,
      path,
      new TextEncoder().encode('before'),
      namedCopyLabel('קריאה', new Date(Date.UTC(2026, 9, 9, 11, 0, 0))),
    )

    const listed = await listEarlierCopies(root, path)
    expect(listed.map((one) => [one.name, one.before])).toEqual([
      ['finances.before-20261009T120005-reading-tasks-csv.emd', 'reading tasks csv'],
      [rolling, undefined],
      ['finances.before-20261009T110000.emd', ''],
    ])
    expect(named?.endsWith(listed[0]?.name ?? '?')).toBe(true)
    expect(hebrew?.endsWith(listed[2]?.name ?? '?')).toBe(true)

    const restored = await restoreEarlierCopy(root, path, listed[0]?.name ?? '', new Date(Date.UTC(2026, 9, 9, 13, 0, 0)))
    expect(await readFile(path, 'utf8')).toBe('before the read')
    expect(await readFile(restored.safetyCopy, 'utf8')).toBe('now')
    expect((await listEarlierCopies(root, path)).map((one) => one.name)).toContain(listed[0]?.name)
    expect(await readdir(directory)).toEqual(['finances.emd'])
  })

  it("a gone document's folder of only named copies goes 30 days after the newest, like any other (D-470)", async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    const earlier = await copyAt(root, path, 1, 'as it was')
    const gone = join(directory, 'moved-away.emd')
    const taken = new Date(Date.UTC(2026, 8, 1))
    await writeBackup(root, gone, new TextEncoder().encode('old'), namedCopyLabel('the cleanup', taken))

    await restoreEarlierCopy(root, path, earlier, new Date(taken.getTime() + (ORPHANED_COPIES_DAYS - 1) * 86_400_000))
    expect((await readdir(root)).length).toBe(2)

    await restoreEarlierCopy(root, path, earlier, new Date(taken.getTime() + (ORPHANED_COPIES_DAYS + 1) * 86_400_000))
    expect(await readdir(root)).toEqual([earlierCopiesFolder(root, path).slice(root.length + 1)])
  })

  it('takes a name the list gave, never a path', async () => {
    const root = await tempDir('emerald-copies-')
    const path = join(directory, 'finances.emd')
    await writeFile(path, 'now')
    await expect(restoreEarlierCopy(root, path, '../../elsewhere.emd')).rejects.toThrow(/not an earlier copy/)
    await expect(restoreEarlierCopy(root, path, 'other.emd.20261009T120000.bak')).rejects.toThrow(/not an earlier copy/)
    expect(await readFile(path, 'utf8')).toBe('now')
  })
})
