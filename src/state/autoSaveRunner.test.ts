import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import type { OpenedDocument, StorageAdapter } from '@/data/storage/adapter.ts'
import type { FileMark, MarkReading } from '@/data/storage/externalChange.ts'
import { startAutoSave } from '@/state/autoSaveRunner.ts'
import { useDocumentStore } from '@/state/documentStore.ts'

/**
 * D-155, driven through the store with a clock we control.
 *
 * The interesting cases are all refusals. A save that happens is one line of
 * evidence; a save that must **not** happen — into a document with no path,
 * through the download adapter, over a file somebody else wrote — is the whole
 * of what keeps auto-save from breaking D-115, and none of those can be seen by
 * looking at the screen.
 */

/** Short enough that a test never waits, long enough to be two distinct ticks. */
const TIMING = { idleMs: 20, ceilingMs: 100 } as const

interface FakeAdapter extends StorageAdapter {
  writeFromElsewhere(): void
  readonly written: Uint8Array[]
}

function createFakeAdapter(initial: Uint8Array, canSaveSilently = true): FakeAdapter {
  let mark: FileMark = { lastModified: 1_000, size: initial.byteLength }
  const written: Uint8Array[] = []

  return {
    id: 'file-system',
    canSaveSilently,
    describe: () => 'fake',
    written,
    open: (): Promise<OpenedDocument | undefined> =>
      Promise.resolve({ bytes: initial, name: 'finances.emd' }),
    save(bytes: Uint8Array): Promise<string | undefined> {
      written.push(bytes)
      mark = { lastModified: mark.lastModified + 1_000, size: bytes.byteLength }
      return Promise.resolve('finances.emd')
    },
    saveAs: (): Promise<string | undefined> => Promise.resolve('finances (copy).emd'),
    readMark: (): Promise<MarkReading> => Promise.resolve({ kind: 'mark', mark }),
    reread: (): Promise<OpenedDocument | undefined> =>
      Promise.resolve({ bytes: initial, name: 'finances.emd' }),
    writeFromElsewhere() {
      mark = { lastModified: mark.lastModified + 5_000, size: mark.size + 4_096 }
    },
  }
}

let onDisk: Uint8Array
let stop: (() => void) | undefined

beforeEach(async () => {
  vi.useFakeTimers()
  const db = await createDatabase()
  onDisk = exportDatabase(db)
  useDocumentStore.setState({
    db: undefined,
    isDirty: false,
    busy: undefined,
    error: undefined,
    knownMark: undefined,
    lastSavedAt: undefined,
    diskState: { kind: 'unwatched' },
  })
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
})

/** Open the fake document and start watching it, the way `App` does. */
async function opened(canSaveSilently = true): Promise<FakeAdapter> {
  const adapter = createFakeAdapter(onDisk, canSaveSilently)
  useDocumentStore.setState({ adapter })
  await useDocumentStore.getState().openFile()
  stop = startAutoSave(TIMING)
  return adapter
}

describe('the app writing the document by itself', () => {
  it('writes once the edits stop', async () => {
    const adapter = await opened()

    useDocumentStore.getState().mutate(() => {})
    expect(adapter.written).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(TIMING.idleMs + 5)

    expect(adapter.written).toHaveLength(1)
    const state = useDocumentStore.getState()
    expect(state.isDirty).toBe(false)
    expect(state.lastSavedAt).toBeDefined()
  })

  it('folds a run of edits into one write, not one per edit', async () => {
    const adapter = await opened()

    for (let edit = 0; edit < 5; edit += 1) {
      useDocumentStore.getState().mutate(() => {})
      await vi.advanceTimersByTimeAsync(TIMING.idleMs / 2)
    }
    await vi.advanceTimersByTimeAsync(TIMING.idleMs + 5)

    expect(adapter.written).toHaveLength(1)
  })

  /**
   * A slider dragged for a minute: the last edit is always a moment ago, so the
   * debounce alone would never fire and the whole drag would sit in memory.
   */
  it('writes at the ceiling when the edits never stop', async () => {
    const adapter = await opened()

    for (let edit = 0; edit < 20; edit += 1) {
      useDocumentStore.getState().mutate(() => {})
      await vi.advanceTimersByTimeAsync(TIMING.idleMs / 2)
    }

    expect(adapter.written.length).toBeGreaterThanOrEqual(1)
  })

  it('is quiet when nothing changed', async () => {
    const adapter = await opened()

    await vi.advanceTimersByTimeAsync(TIMING.ceilingMs * 2)

    expect(adapter.written).toHaveLength(0)
  })

  /**
   * Opening a document bumps `revision` exactly as a mutation does. It must not
   * be read as work to save — the bytes on screen are the bytes on disk.
   */
  it('does not write a document back the moment it is opened', async () => {
    const adapter = await opened()

    await vi.advanceTimersByTimeAsync(TIMING.ceilingMs * 2)

    expect(adapter.written).toHaveLength(0)
    expect(useDocumentStore.getState().isDirty).toBe(false)
  })
})

describe('what auto-save refuses, which is the part that matters', () => {
  /**
   * D-155 rule 1, which is the decision rather than a limitation: a document
   * with no path has nothing to save *to*, and inventing somewhere is the
   * D-115 mistake in one line.
   */
  it('never creates a file — a document that has never been saved stays unsaved', async () => {
    const adapter = createFakeAdapter(onDisk)
    useDocumentStore.setState({ adapter })
    await useDocumentStore.getState().createNew()
    stop = startAutoSave(TIMING)

    useDocumentStore.getState().mutate(() => {})
    await vi.advanceTimersByTimeAsync(TIMING.ceilingMs * 2)

    expect(adapter.written).toHaveLength(0)
    expect(useDocumentStore.getState().isDirty).toBe(true)
  })

  /** Rule 6. The download adapter cannot write silently and never pretends to. */
  it('leaves the download adapter alone', async () => {
    const adapter = await opened(false)

    useDocumentStore.getState().mutate(() => {})
    await vi.advanceTimersByTimeAsync(TIMING.ceilingMs * 2)

    expect(adapter.written).toHaveLength(0)
    expect(useDocumentStore.getState().isDirty).toBe(true)
  })

  /**
   * Rule 2, and it is D-092's refusal reused rather than a second one. An
   * automatic write that loses another writer's work is worse than every prompt
   * it ever saved.
   */
  it('refuses into the notice when the file changed underneath, and writes nothing', async () => {
    const adapter = await opened()
    useDocumentStore.getState().mutate(() => {})
    adapter.writeFromElsewhere()

    await vi.advanceTimersByTimeAsync(TIMING.ceilingMs * 2)

    expect(adapter.written).toHaveLength(0)
    expect(useDocumentStore.getState().diskState).toEqual({
      kind: 'changed',
      hasUnsavedWork: true,
    })
    expect(useDocumentStore.getState().isDirty).toBe(true)
  })

  it('does not go back and try again while the conflict still stands', async () => {
    const adapter = await opened()
    useDocumentStore.getState().mutate(() => {})
    adapter.writeFromElsewhere()
    await vi.advanceTimersByTimeAsync(TIMING.ceilingMs * 2)

    let reads = 0
    const readMark = adapter.readMark.bind(adapter)
    adapter.readMark = (): Promise<MarkReading> => {
      reads += 1
      return readMark()
    }
    await vi.advanceTimersByTimeAsync(TIMING.ceilingMs * 5)

    // No timer is left running, so nothing asks the disk anything.
    expect(reads).toBe(0)
    expect(adapter.written).toHaveLength(0)
  })

  it('stops for good when it is torn down', async () => {
    const adapter = await opened()
    useDocumentStore.getState().mutate(() => {})

    stop?.()
    stop = undefined
    await vi.advanceTimersByTimeAsync(TIMING.ceilingMs * 2)

    expect(adapter.written).toHaveLength(0)
    expect(useDocumentStore.getState().isDirty).toBe(true)
  })
})
