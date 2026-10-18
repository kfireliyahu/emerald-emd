import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, SCHEMA_VERSION } from '@/data/db/database.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { OpenedDocument, StorageAdapter } from '@/data/storage/adapter.ts'
import type { FileMark, MarkReading } from '@/data/storage/externalChange.ts'
import { useDocumentStore } from '@/state/documentStore.ts'

/**
 * The two-writers case (D-092), driven through the store rather than the DOM:
 * a save that would clobber a file changed underneath us has to refuse, and
 * every way out of that has to leave the app pointing at a file it has read.
 */

interface FakeAdapter extends StorageAdapter {
  /** Someone else writes the file — a second tab, a sync client, the plugin. */
  writeFromElsewhere(bytes: Uint8Array): void
  readonly written: Uint8Array[]
  readonly savedAsNames: string[]
  vanish(): void
  detach(): void
}

function createFakeAdapter(initial: Uint8Array): FakeAdapter {
  let contents = initial
  let mark: FileMark | undefined = { lastModified: 1_000, size: initial.byteLength }
  let attached = true
  let gone = false
  const written: Uint8Array[] = []
  const savedAsNames: string[] = []

  const stamp = (bytes: Uint8Array): void => {
    contents = bytes
    mark = { lastModified: (mark?.lastModified ?? 0) + 1_000, size: bytes.byteLength }
  }

  return {
    id: 'file-system',
    canSaveSilently: true,
    describe: () => 'fake',
    written,
    savedAsNames,

    open: (): Promise<OpenedDocument | undefined> =>
      Promise.resolve({ bytes: contents, name: 'finances.emd' }),

    save(bytes: Uint8Array): Promise<string | undefined> {
      written.push(bytes)
      stamp(bytes)
      return Promise.resolve('finances.emd')
    },

    saveAs(bytes: Uint8Array, suggestedName: string): Promise<string | undefined> {
      savedAsNames.push(suggestedName)
      written.push(bytes)
      stamp(bytes)
      return Promise.resolve(suggestedName)
    },

    readMark(): Promise<MarkReading> {
      if (!attached) return Promise.resolve({ kind: 'unwatched' })
      if (gone) return Promise.resolve({ kind: 'unreadable', reason: 'A requested file was not found.' })
      return Promise.resolve(mark === undefined ? { kind: 'unwatched' } : { kind: 'mark', mark })
    },

    reread: (): Promise<OpenedDocument | undefined> =>
      Promise.resolve({ bytes: contents, name: 'finances.emd' }),

    writeFromElsewhere(bytes: Uint8Array) {
      stamp(bytes)
    },

    vanish() {
      gone = true
    },

    /** Behave like the download adapter: nothing to watch. */
    detach() {
      attached = false
    },
  }
}

let onDisk: Uint8Array
let secondVersion: Uint8Array

beforeEach(async () => {
  const db = await createLedgerDatabase()
  onDisk = exportDatabase(db)

  // A second, larger version of the same document — what another writer left.
  db.run("INSERT INTO fmt_setting (id, key, value) VALUES ('elsewhere', 'written-elsewhere', 'yes')")
  secondVersion = exportDatabase(db)

  useDocumentStore.setState({
    db: undefined,
    isDirty: false,
    busy: undefined,
    error: undefined,
    knownMark: undefined,
    diskState: { kind: 'unwatched' },
    pendingReplace: undefined,
  })
})

async function openFake(): Promise<FakeAdapter> {
  const adapter = createFakeAdapter(onDisk)
  useDocumentStore.setState({ adapter })
  await useDocumentStore.getState().openFile()
  return adapter
}

describe('the document store, with a file that can change underneath it', () => {
  it('knows the file it opened, and reports it in sync', async () => {
    await openFake()
    const state = useDocumentStore.getState()
    expect(state.db).toBeDefined()
    expect(state.knownMark).toBeDefined()
    expect(state.diskState).toEqual({ kind: 'in-sync' })
  })

  it('refuses to save over a file that changed, and writes nothing', async () => {
    const adapter = await openFake()
    useDocumentStore.getState().mutate(() => {})
    adapter.writeFromElsewhere(secondVersion)

    await useDocumentStore.getState().save()

    expect(adapter.written).toHaveLength(0)
    expect(useDocumentStore.getState().diskState).toEqual({
      kind: 'changed',
      hasUnsavedWork: true,
    })
    // The work is still here, unsaved, waiting for an answer.
    expect(useDocumentStore.getState().isDirty).toBe(true)
  })

  it('saves when told to overwrite, and trusts the file again afterwards', async () => {
    const adapter = await openFake()
    useDocumentStore.getState().mutate(() => {})
    adapter.writeFromElsewhere(secondVersion)
    await useDocumentStore.getState().save()

    await useDocumentStore.getState().save({ overwrite: true })

    expect(adapter.written).toHaveLength(1)
    const state = useDocumentStore.getState()
    expect(state.isDirty).toBe(false)
    expect(state.diskState).toEqual({ kind: 'in-sync' })
    // The mark moved with the write, so the next save does not re-accuse.
    expect(await useDocumentStore.getState().checkDisk()).toEqual({ kind: 'in-sync' })
  })

  it('saves a copy under a new name, leaving the changed file alone', async () => {
    const adapter = await openFake()
    useDocumentStore.getState().mutate(() => {})
    adapter.writeFromElsewhere(secondVersion)
    await useDocumentStore.getState().save()

    await useDocumentStore.getState().saveCopyAs()

    expect(adapter.savedAsNames).toEqual(['finances (copy).emd'])
    const state = useDocumentStore.getState()
    expect(state.documentName).toBe('finances (copy).emd')
    expect(state.isDirty).toBe(false)
    expect(state.diskState).toEqual({ kind: 'in-sync' })
  })

  it('reloads what the other writer left, and is clean afterwards', async () => {
    const adapter = await openFake()
    useDocumentStore.getState().mutate(() => {})
    adapter.writeFromElsewhere(secondVersion)

    await useDocumentStore.getState().reloadFromDisk()

    const state = useDocumentStore.getState()
    expect(state.isDirty).toBe(false)
    expect(state.diskState).toEqual({ kind: 'in-sync' })
    const value = state.db?.exec("SELECT value FROM fmt_setting WHERE key = 'written-elsewhere'")
    expect(value?.[0]?.values[0]?.[0]).toBe('yes')
  })

  it('opens a document the shell handed it when nothing is unsaved (D-128)', async () => {
    const adapter = await openFake()
    adapter.openPath = (path) => Promise.resolve({ bytes: secondVersion, name: path })

    await useDocumentStore.getState().requestOpen('/home/k/other.emd')

    const state = useDocumentStore.getState()
    expect(state.pendingOpen).toBeUndefined()
    expect(state.documentName).toBe('/home/k/other.emd')
    const value = state.db?.exec("SELECT value FROM fmt_setting WHERE key = 'written-elsewhere'")
    expect(value?.[0]?.values[0]?.[0]).toBe('yes')
  })

  it('holds a document the shell handed it rather than discarding unsaved work', async () => {
    const adapter = await openFake()
    let opened = 0
    adapter.openPath = (path) => {
      opened += 1
      return Promise.resolve({ bytes: secondVersion, name: path })
    }
    useDocumentStore.getState().mutate(() => {})

    await useDocumentStore.getState().requestOpen('/home/k/other.emd')

    expect(opened).toBe(0)
    expect(useDocumentStore.getState().pendingOpen).toBe('/home/k/other.emd')
    expect(useDocumentStore.getState().isDirty).toBe(true)

    // …and the user says open it anyway.
    await useDocumentStore.getState().openDocumentAt('/home/k/other.emd')

    expect(opened).toBe(1)
    const state = useDocumentStore.getState()
    expect(state.pendingOpen).toBeUndefined()
    expect(state.isDirty).toBe(false)
  })

  it('makes a new document at once when nothing is unsaved (M38 F1)', async () => {
    await openFake()
    const before = useDocumentStore.getState().db

    await useDocumentStore.getState().requestNew()

    const state = useDocumentStore.getState()
    expect(state.pendingReplace).toBeUndefined()
    expect(state.db).not.toBe(before)
    expect(state.documentName).toMatch(/^untitled-\d{4}-\d{2}\.emd$/)
  })

  it('holds a new document rather than discarding unsaved work (M38 F1)', async () => {
    await openFake()
    const before = useDocumentStore.getState().db
    useDocumentStore.getState().mutate(() => {})

    await useDocumentStore.getState().requestNew()

    expect(useDocumentStore.getState().pendingReplace).toBe('new')
    expect(useDocumentStore.getState().db).toBe(before)
    expect(useDocumentStore.getState().isDirty).toBe(true)

    // Stay here keeps everything as it was…
    useDocumentStore.getState().dismissPendingReplace()
    expect(useDocumentStore.getState().pendingReplace).toBeUndefined()
    expect(useDocumentStore.getState().db).toBe(before)

    // …and Discard mine, new is `createNew`, which answers the question.
    await useDocumentStore.getState().requestNew()
    await useDocumentStore.getState().createNew()
    const state = useDocumentStore.getState()
    expect(state.pendingReplace).toBeUndefined()
    expect(state.db).not.toBe(before)
    expect(state.isDirty).toBe(false)
  })

  it('asks before the picker when Open… would replace unsaved work (M38 U3)', async () => {
    const adapter = await openFake()
    const before = useDocumentStore.getState().db
    let picked = 0
    const open = adapter.open.bind(adapter)
    adapter.open = () => {
      picked += 1
      return open()
    }
    useDocumentStore.getState().mutate(() => {})

    await useDocumentStore.getState().requestOpenFile()

    // Held: no picker, nothing replaced, the work still unsaved.
    expect(picked).toBe(0)
    expect(useDocumentStore.getState().pendingReplace).toBe('pick')
    expect(useDocumentStore.getState().db).toBe(before)
    expect(useDocumentStore.getState().isDirty).toBe(true)

    // Stay here keeps everything as it was…
    useDocumentStore.getState().dismissPendingReplace()
    expect(useDocumentStore.getState().pendingReplace).toBeUndefined()
    expect(useDocumentStore.getState().db).toBe(before)

    // …and Discard mine, open… is the picker, which answers the question.
    await useDocumentStore.getState().requestOpenFile()
    await useDocumentStore.getState().openFile()
    expect(picked).toBe(1)
    const state = useDocumentStore.getState()
    expect(state.pendingReplace).toBeUndefined()
    expect(state.db).not.toBe(before)
    expect(state.isDirty).toBe(false)
  })

  it('shows the picker at once when nothing is unsaved (M38 U3)', async () => {
    const adapter = await openFake()
    let picked = 0
    const open = adapter.open.bind(adapter)
    adapter.open = () => {
      picked += 1
      return open()
    }

    await useDocumentStore.getState().requestOpenFile()

    expect(picked).toBe(1)
    expect(useDocumentStore.getState().pendingReplace).toBeUndefined()
  })

  it('keeps the work unsaved when the save dialog is cancelled', async () => {
    const adapter = await openFake()
    useDocumentStore.getState().mutate(() => {})
    // What the desktop adapter does on a cancelled native dialog (D-127); the
    // two browser adapters cannot reach this branch, which is how it went four
    // milestones without being noticed.
    adapter.save = () => Promise.resolve(undefined)

    await useDocumentStore.getState().save()

    const state = useDocumentStore.getState()
    expect(state.isDirty).toBe(true)
    expect(state.lastSavedAt).toBeUndefined()
  })

  it('reports a change even with nothing unsaved, so the copy on screen is not trusted', async () => {
    const adapter = await openFake()
    adapter.writeFromElsewhere(secondVersion)

    expect(await useDocumentStore.getState().checkDisk()).toEqual({
      kind: 'changed',
      hasUnsavedWork: false,
    })
  })

  it('says a file it can no longer read is unreadable, rather than unchanged', async () => {
    const adapter = await openFake()
    adapter.vanish()

    expect(await useDocumentStore.getState().checkDisk()).toEqual({
      kind: 'unreadable',
      reason: 'A requested file was not found.',
    })
  })

  it('never blocks a save on an adapter with nothing to watch', async () => {
    const adapter = await openFake()
    adapter.detach()
    useDocumentStore.getState().mutate(() => {})

    await useDocumentStore.getState().save()

    expect(adapter.written).toHaveLength(1)
    expect(useDocumentStore.getState().isDirty).toBe(false)
  })
})

/**
 * A migration held only in memory is lost on close, and the file stays at the
 * old schema for the plugin, which refuses it rather than migrate — which is
 * how `docs/memory.emd` stayed at 46 after the app had opened it at 47.
 */
describe('a document from an older schema', () => {
  async function openBytes(bytes: Uint8Array): Promise<void> {
    useDocumentStore.setState({ adapter: createFakeAdapter(bytes) })
    await useDocumentStore.getState().openFile()
  }

  it('opens as unsaved work, so it is saved at the new schema', async () => {
    await openBytes(exportDatabase(await createDatabase(SCHEMA_VERSION - 1)))
    expect(useDocumentStore.getState().isDirty).toBe(true)
  })

  it('does the same for a text document', async () => {
    // The project's own memory, with its header one schema behind this build.
    const memory = fileURLToPath(new URL('../../docs/memory.emd', import.meta.url))
    const header = /^<!-- emerald document, schema \d+ -->/
    const text = readFileSync(memory, 'utf8')
    expect(text).toMatch(header)
    const older = text.replace(header, `<!-- emerald document, schema ${SCHEMA_VERSION - 1} -->`)

    await openBytes(new TextEncoder().encode(older))
    expect(useDocumentStore.getState().error).toBeUndefined()
    expect(useDocumentStore.getState().isDirty).toBe(true)
  })

  it('leaves one already at this schema clean', async () => {
    await openBytes(onDisk)
    expect(useDocumentStore.getState().isDirty).toBe(false)
  })
})

describe('following the disk (M27 U6)', () => {
  const written = (): unknown =>
    useDocumentStore.getState().db?.exec("SELECT value FROM fmt_setting WHERE key = 'written-elsewhere'")[0]
      ?.values[0]?.[0]

  it('re-reads a file somebody else wrote, without asking, when nothing here is unsaved', async () => {
    const adapter = await openFake()
    const before = useDocumentStore.getState().revision
    adapter.writeFromElsewhere(secondVersion)

    expect(await useDocumentStore.getState().followDisk()).toEqual({ kind: 'in-sync' })
    const state = useDocumentStore.getState()
    expect(state.revision).toBeGreaterThan(before)
    expect(state.isDirty).toBe(false)
    expect(written()).toBe('yes')
  })

  it('only asks when there is unsaved work, and keeps it', async () => {
    const adapter = await openFake()
    useDocumentStore.getState().mutate(() => {})
    adapter.writeFromElsewhere(secondVersion)

    expect(await useDocumentStore.getState().followDisk()).toEqual({ kind: 'changed', hasUnsavedWork: true })
    expect(useDocumentStore.getState().isDirty).toBe(true)
    expect(written()).toBeUndefined()
  })

  it('does nothing to a file that has not changed', async () => {
    await openFake()
    const before = useDocumentStore.getState().revision
    expect(await useDocumentStore.getState().followDisk()).toEqual({ kind: 'in-sync' })
    expect(useDocumentStore.getState().revision).toBe(before)
  })
})

describe('a copy kept before something (M34 U6, D-399)', () => {
  it('in the shell, is a file beside the document named for what it came before', async () => {
    const adapter = await openFake()
    const labels: string[] = []
    adapter.backup = (bytes: Uint8Array, label: string): Promise<string | undefined> => {
      labels.push(label)
      expect(bytes.byteLength).toBeGreaterThan(0)
      return Promise.resolve(`C:/docs/finances.${label}.emd`)
    }
    const kept = await useDocumentStore.getState().keepCopy('reading tasks.csv')

    expect(labels[0]).toMatch(/^before-\d{8}T\d{6}-reading-tasks-csv$/)
    expect(kept).toMatchObject({ where: 'earlier-copies', what: 'reading tasks.csv', name: `finances.${labels[0] ?? ''}.emd` })
    expect(useDocumentStore.getState().keptCopy).toEqual(kept)
    // A copy is not a save: the document is exactly as unsaved as it was.
    expect(useDocumentStore.getState().isDirty).toBe(false)
  })

  it('in a browser, is held in the page until it is downloaded or discarded', async () => {
    await openFake()
    const kept = await useDocumentStore.getState().keepCopy('now')
    expect(kept?.where).toBe('held')
    expect(kept?.name).toMatch(/^finances\.before-\d{8}T\d{6}-now\.emd$/)
    useDocumentStore.getState().dismissKeptCopy()
    expect(useDocumentStore.getState().keptCopy).toBeUndefined()
  })

  it('goes with the document it was kept from', async () => {
    await openFake()
    await useDocumentStore.getState().keepCopy('now')
    await useDocumentStore.getState().openFile()
    expect(useDocumentStore.getState().keptCopy).toBeUndefined()
  })
})
