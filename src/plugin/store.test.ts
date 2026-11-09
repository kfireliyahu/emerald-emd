import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { err, ok } from '@/core/result.ts'
import { createDatabase, exportDatabase } from '@/data/db/database.ts'

import { createServer } from './server.ts'
import { documentStore, localFileStore, withDocumentStore, type DocumentStore } from './store.ts'
import { declareFormatTool, formatsTool, recordFormatRowsTool } from './tools/formats.ts'
import { NO_CLIENT } from './tools/tool.ts'

/**
 * **The document behind a seam** (M57 U1, D-560): a store that is not the
 * file on this machine. The local store's behaviour is the rest of the suite,
 * which runs through it unchanged; these are what a store of another kind
 * meets — its bytes, its versions, its refusal, and no copies of ours.
 */

/** A document held in memory, at a revision that moves on every write it takes. */
class MemoryStore implements DocumentStore {
  revision = 1
  readonly writes: { readonly version: string }[] = []

  constructor(
    public bytes: Uint8Array,
    /** What it says instead of taking a write; it takes every one when absent. */
    private readonly refusal?: string,
  ) {}

  read(): ReturnType<DocumentStore['read']> {
    return Promise.resolve(ok({ bytes: this.bytes, version: String(this.revision) }))
  }

  write(_path: string, bytes: Uint8Array, version: string): ReturnType<DocumentStore['write']> {
    this.writes.push({ version })
    if (this.refusal !== undefined) return Promise.resolve(err(this.refusal))
    if (version !== String(this.revision)) return Promise.resolve(err(`It changed since revision ${version}.`))
    this.bytes = bytes
    this.revision += 1
    return Promise.resolve(ok(undefined))
  }

  exclusive<T>(_path: string, work: () => Promise<T>): Promise<T> {
    return work()
  }
}

async function emptyBytes(): Promise<Uint8Array> {
  const db = await createDatabase()
  const bytes = exportDatabase(db)
  db.close()
  return bytes
}

/** Not a file anywhere: a store that reads it from disk would fail to. */
const NOWHERE = '/nowhere/Emerald.emd'

const BOOK = {
  path: NOWHERE,
  format: 'book',
  title: 'Book',
  columns: [{ name: 'title', type: 'text', required: true }],
  nothing_must_hold: true,
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text: string }[]).map((one) => one.text).join('\n')
}

async function connected(store: DocumentStore): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} })
  await Promise.all([createServer({ store }).connect(serverTransport), client.connect(clientTransport)])
  return client
}

describe('a document behind a store (M57 U1)', () => {
  it('is the file on this machine unless a call runs with another', async () => {
    const store = new MemoryStore(await emptyBytes())
    expect(documentStore()).toBe(localFileStore)
    await withDocumentStore(store, async () => {
      await Promise.resolve()
      expect(documentStore()).toBe(store)
    })
    expect(documentStore()).toBe(localFileStore)
  })

  it('reads and writes the store’s bytes, handing back the version it read, and takes no copy of ours', async () => {
    const store = new MemoryStore(await emptyBytes())

    const declared = await withDocumentStore(store, () => declareFormatTool.run({ ...BOOK, commit: true }, NO_CLIENT))
    expect(declared).not.toContain('REFUSED')
    // The store keeps no copies, so the answer names none.
    expect(declared).not.toContain('copied to')
    expect(store.writes).toEqual([{ version: '1' }])

    const recorded = await withDocumentStore(store, () =>
      recordFormatRowsTool.run({ path: NOWHERE, format: 'book', rows: [{ title: 'Dune' }], commit: true }, NO_CLIENT),
    )
    expect(recorded).not.toContain('REFUSED')
    expect(store.writes).toEqual([{ version: '1' }, { version: '2' }])

    // Read back through the store: the format and its row are in the bytes it holds.
    const formats = await withDocumentStore(store, () => formatsTool.run({ path: NOWHERE }, NO_CLIENT))
    expect(formats).toContain('| Book | book | fmt_book | 1 |')
  })

  it('brings a refused write to the tool as a refusal, never as a success or a tool error', async () => {
    const before = await emptyBytes()
    const store = new MemoryStore(before, 'The document changed in Drive since this call read it.')
    const client = await connected(store)

    const result = await client.callTool({ name: 'declare_format', arguments: { ...BOOK, commit: true } })
    const text = textOf(result)

    // A refusal is an answer, like a refused schema: in the conversation's own words.
    expect(result.isError).toBeFalsy()
    expect(text).toContain(`REFUSED — nothing was written to ${NOWHERE}.`)
    expect(text).toContain('The document changed in Drive since this call read it.')
    expect(text).toContain('Reason code: WRITE_REFUSED.')
    // Not the answer the work would have given, and nothing about a schema or a copy.
    expect(text).not.toContain('Schema version')
    expect(text).not.toContain('copied to')
    expect(store.writes).toHaveLength(1)
    expect(store.bytes).toBe(before)

    // And what it holds is still what it held: the format was never declared.
    const formats = await client.callTool({ name: 'formats', arguments: { path: NOWHERE } })
    expect(textOf(formats)).toContain(`${NOWHERE} declares no formats.`)
    await client.close()
  })

  it('refuses a write given a version the store has moved past', async () => {
    const store = new MemoryStore(await emptyBytes())
    const client = await connected(store)

    // The person's other device writes between this call's read and its write.
    const realRead = store.read.bind(store)
    store.read = async () => {
      const read = await realRead()
      store.revision += 1
      return read
    }

    const result = await client.callTool({ name: 'declare_format', arguments: { ...BOOK, commit: true } })
    expect(textOf(result)).toContain('REFUSED — nothing was written')
    expect(textOf(result)).toContain('It changed since revision 1.')
    await client.close()
  })
})
