import { describe, expect, it } from 'vitest'

import type {
  DocumentFile,
  DocumentMarkReading,
  EmeraldDocuments,
  RecentDocument,
  ShellCommand,
} from '../../../electron/bridge.ts'
import { createDesktopAdapter } from './desktop.ts'

/**
 * The renderer half of the desktop adapter (D-127), against a fake shell.
 *
 * What is worth testing here is not the filesystem — `electron/documents.test.ts`
 * uses a real one — but the state this side keeps: which file we are saving to,
 * and whether the shell's watch is still pointed at it. Both are the kind of
 * thing that goes wrong quietly, days later, in the one case that matters:
 * saving a copy while the original is being written by somebody else.
 */

interface FakeShell extends EmeraldDocuments {
  /** What the user will answer the next save dialog with. */
  nextSavePath: string | undefined
  readonly writes: { path: string; bytes: Uint8Array }[]
  readonly watched: (string | undefined)[]
  readonly listeners: (() => void)[]
  readonly files: Map<string, Uint8Array>
}

function createFakeShell(open?: string): FakeShell {
  const files = new Map<string, Uint8Array>()
  const writes: { path: string; bytes: Uint8Array }[] = []
  const watched: (string | undefined)[] = []
  const listeners: (() => void)[] = []
  if (open !== undefined) files.set(open, new Uint8Array([1, 2, 3]))

  const shell: FakeShell = {
    nextSavePath: undefined,
    writes,
    watched,
    listeners,
    files,

    open(): Promise<DocumentFile | undefined> {
      if (open === undefined) return Promise.resolve(undefined)
      return Promise.resolve({ path: open, name: base(open), bytes: files.get(open) ?? new Uint8Array() })
    },

    read(path: string): Promise<DocumentFile> {
      const bytes = files.get(path)
      if (bytes === undefined) return Promise.reject(new Error('no such file'))
      return Promise.resolve({ path, name: base(path), bytes })
    },

    chooseSavePath(): Promise<string | undefined> {
      return Promise.resolve(shell.nextSavePath)
    },

    write(path: string, bytes: Uint8Array): Promise<void> {
      writes.push({ path, bytes })
      files.set(path, bytes)
      return Promise.resolve()
    },

    backup(path: string, bytes: Uint8Array, label: string): Promise<string | undefined> {
      const target = path.replace(/\.emd$/, `.${label}.emd`)
      if (files.has(target)) return Promise.resolve(undefined)
      files.set(target, bytes)
      return Promise.resolve(target)
    },

    mark(path: string): Promise<DocumentMarkReading> {
      const bytes = files.get(path)
      return Promise.resolve(
        bytes === undefined
          ? { kind: 'unreadable', reason: 'no such file' }
          : { kind: 'mark', mark: { lastModified: 1_000, size: bytes.byteLength } },
      )
    },

    watch(path: string | undefined): Promise<void> {
      watched.push(path)
      return Promise.resolve()
    },

    onChanged(listener: () => void): () => void {
      listeners.push(listener)
      return () => {
        listeners.splice(listeners.indexOf(listener), 1)
      }
    },

    earlierCopies: () => Promise.resolve([]),
    restoreEarlierCopy: () => Promise.reject(new Error('no earlier copy')),
    recents: (): Promise<readonly RecentDocument[]> => Promise.resolve([]),
    onCommand: (_listener: (command: ShellCommand) => void) => () => undefined,
    ready: () => undefined,
    setUnsaved: () => undefined,
    closeWindow: () => undefined,
  }
  return shell
}

function base(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

const HOME = '/home/k/finances.emd'

describe('the desktop adapter', () => {
  it('has nothing to compare before a file is open', async () => {
    const adapter = createDesktopAdapter(createFakeShell())
    expect(await adapter.readMark()).toEqual({ kind: 'unwatched' })
    expect(await adapter.reread()).toBeUndefined()
  })

  it('points the shell at the file it opened', async () => {
    const shell = createFakeShell(HOME)
    const adapter = createDesktopAdapter(shell)

    const opened = await adapter.open()
    expect(opened?.name).toBe('finances.emd')
    expect(shell.watched).toEqual([HOME])
    expect(await adapter.readMark()).toEqual({ kind: 'mark', mark: { lastModified: 1_000, size: 3 } })
  })

  it('asks where to save once, and never again', async () => {
    const shell = createFakeShell()
    shell.nextSavePath = HOME
    const adapter = createDesktopAdapter(shell)

    expect(await adapter.save(new Uint8Array([1]), 'untitled-2026-08.emd')).toBe(
      'finances.emd',
    )
    shell.nextSavePath = '/home/k/somewhere-else.emd'
    expect(await adapter.save(new Uint8Array([2]), 'untitled-2026-08.emd')).toBe(
      'finances.emd',
    )

    expect(shell.writes.map((write) => write.path)).toEqual([HOME, HOME])
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    const shell = createFakeShell()
    shell.nextSavePath = undefined
    const adapter = createDesktopAdapter(shell)

    expect(await adapter.save(new Uint8Array([1]), 'finances.emd')).toBeUndefined()
    expect(shell.writes).toEqual([])
    expect(shell.watched).toEqual([])
  })

  it('names the file a document even when the dialog did not', async () => {
    const shell = createFakeShell()
    shell.nextSavePath = HOME
    const adapter = createDesktopAdapter(shell)

    let suggested: string | undefined
    shell.chooseSavePath = (name: string) => {
      suggested = name
      return Promise.resolve(HOME)
    }
    await adapter.save(new Uint8Array([1]), 'untitled-2026-08')
    expect(suggested).toBe('untitled-2026-08.emd')
  })

  it('stops watching the file it left behind when a copy is saved (D-092)', async () => {
    const shell = createFakeShell(HOME)
    const adapter = createDesktopAdapter(shell)
    await adapter.open()

    const copy = '/home/k/finances (copy).emd'
    shell.nextSavePath = copy
    expect(await adapter.saveAs(new Uint8Array([9]), 'finances (copy).emd')).toBe(
      'finances (copy).emd',
    )

    // The watch moved with the document: the file the other writer took is no
    // longer ours to be warned about, and the copy is.
    expect(shell.watched).toEqual([HOME, copy])
    expect(shell.writes.map((write) => write.path)).toEqual([copy])
    expect((await adapter.reread())?.name).toBe('finances (copy).emd')
  })

  it('opens a path the shell handed it, with no picker, and watches it (D-128)', async () => {
    const shell = createFakeShell(HOME)
    const adapter = createDesktopAdapter(shell)

    const opened = await adapter.openPath?.(HOME)

    expect(opened?.name).toBe('finances.emd')
    expect(shell.watched).toEqual([HOME])
    // Saving now writes back to the document that was double-clicked, rather
    // than asking where to put it.
    shell.nextSavePath = '/somewhere/else.emd'
    await adapter.save(new Uint8Array([5]), 'finances.emd')
    expect(shell.writes.map((write) => write.path)).toEqual([HOME])
  })

  it('passes the shell notification through to whoever is listening', async () => {
    const shell = createFakeShell(HOME)
    const adapter = createDesktopAdapter(shell)
    await adapter.open()

    let told = 0
    const stop = adapter.watch?.(() => {
      told += 1
    })
    for (const listener of shell.listeners) listener()
    expect(told).toBe(1)

    stop?.()
    for (const listener of shell.listeners) listener()
    expect(told).toBe(1)
  })
})
