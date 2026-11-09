import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { ok } from '@/core/result.ts'

import { CONNECTOR_DOCUMENT, NOT_ON_THE_CONNECTOR, connectorDefinition } from './connector.ts'
import { connectorInstructions } from './instructions.ts'
import { APP_TOOLS, ENGINE_TOOLS, LEDGER_TOOLS, createServer } from './server.ts'
import type { DocumentStore } from './store.ts'
import { createDocumentFile } from './write.ts'
import { tempDir } from '../testing/tempDir'

/**
 * The Google Drive connector's list (M57 U2, D-562): the one document, no
 * path, and no tool that needs another file.
 */

/** A parameter's own name that is a file: the local server's `path`, a reader's `file`, a scan's `denylist`. */
const FILE_NAMES = /^(path|paths|file|files|folder|denylist)$/

/**
 * A description, at any depth, that asks for a file. Not `.emd` alone: `declare_format`'s column
 * types say what an `elsewhere` value looks like, which is a column a format may have, not a file
 * the call reads.
 */
const FILE_WORDS = /absolute path|on this machine|\.xlsx|\.csv|folder of notes/i

/** Every parameter of a definition that names a file, as `tool.parameter`. */
function fileParameters(definition: Tool): readonly string[] {
  const found: string[] = []
  const walk = (schema: unknown, where: string, top: boolean): void => {
    if (typeof schema !== 'object' || schema === null) return
    const { properties, items, description } = schema as {
      properties?: Record<string, unknown>
      items?: unknown
      description?: unknown
    }
    if (typeof description === 'string' && FILE_WORDS.test(description)) found.push(where)
    for (const [name, inner] of Object.entries(properties ?? {})) {
      if (top && FILE_NAMES.test(name)) found.push(`${where}.${name}`)
      walk(inner, `${where}.${name}`, false)
    }
    walk(items, `${where}[]`, false)
  }
  walk(definition.inputSchema, definition.name, true)
  return found
}

/** A store holding one document in memory, as the Drive store holds the person's. */
function memoryStore(bytes: Uint8Array): DocumentStore & { reads: string[]; writes: number; bytes: Uint8Array } {
  const store = {
    reads: [] as string[],
    writes: 0,
    bytes,
    read(path: string) {
      store.reads.push(path)
      return Promise.resolve(ok({ bytes: store.bytes, version: String(store.writes) }))
    },
    write(_path: string, written: Uint8Array) {
      store.bytes = written
      store.writes += 1
      return Promise.resolve(ok(undefined))
    },
    exclusive<T>(_path: string, work: () => Promise<T>): Promise<T> {
      return work()
    },
  }
  return store
}

async function emptyDocument(): Promise<Uint8Array> {
  const path = join(await tempDir('emerald-connector-'), 'Emerald.emd')
  // SQLite bytes: a document that declares nothing has no text to be yet (D-246).
  const made = await createDocumentFile(path, [], 'sqlite')
  if (!made.ok) throw new Error(made.error.message)
  return readFile(path)
}

async function connected(store?: DocumentStore): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} })
  await Promise.all([
    createServer({ connector: true, ...(store === undefined ? {} : { store }) }).connect(serverTransport),
    client.connect(clientTransport),
  ])
  return client
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string =>
  (result.content as { type: string; text: string }[]).map((part) => part.text).join('\n')

describe('the Google Drive connector', () => {
  it('lists every tool on the one document, and none that needs another file', async () => {
    const client = await connected()
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)

    // The local server's tools, less the ones that need another file: the
    // engine's first, as on the local server.
    const expected = [...ENGINE_TOOLS, ...LEDGER_TOOLS]
      .map((tool) => tool.definition.name)
      .filter((name) => !NOT_ON_THE_CONNECTOR.has(name))
    expect(names).toEqual(expected)
    for (const left of ['read_onto_format', 'readers', 'import_statement', 'statement_preview', 'record_holdings_statement']) {
      expect(names).not.toContain(left)
    }
    for (const left of ['store_document_as', 'keep_copy', 'create_document', 'frame_copy']) expect(names).not.toContain(left)

    // **The test the brief asks for**: no tool here takes a file path, whatever
    // list it came from.
    expect(tools.flatMap((tool) => fileParameters(tool))).toEqual([])
    // And no page: the frame's copy reads a file on this machine.
    expect(tools.filter((tool) => tool._meta?.['ui'] !== undefined).map((tool) => tool.name)).toEqual([])
    await client.close()
  })

  it('catches a tool taking a file path, had one slipped in', () => {
    // The check above is only worth what it catches. Every tool taking a file,
    // put through the connector's definition, is still caught by it — so one
    // left off `NOT_ON_THE_CONNECTOR` fails the list.
    const all = [...ENGINE_TOOLS, ...LEDGER_TOOLS, ...APP_TOOLS]
    const caught = all
      .filter((tool) => fileParameters(connectorDefinition(tool.definition)).length > 0)
      .map((tool) => tool.definition.name)
    expect(caught).toEqual(
      expect.arrayContaining(['read_onto_format', 'statement_preview', 'import_statement', 'record_holdings_statement']),
    )
    // The local server's `path` is caught on every tool, which is what makes
    // a definition the connector forgot to strip fail too.
    for (const tool of all) expect(fileParameters(tool.definition)).toContain(`${tool.definition.name}.path`)
    // The scan's denylist, the one parameter the connector drops beside `path`.
    const search = all.find((tool) => tool.definition.name === 'search_document')
    expect(search === undefined ? [] : fileParameters(search.definition)).toContain('search_document.denylist')
  })

  it('says the document is Emerald/Emerald.emd in their Drive, and nothing about local files', async () => {
    const client = await connected()
    const instructions = client.getInstructions() ?? ''
    expect(instructions).toBe(connectorInstructions())
    expect(instructions).toContain('`Emerald/Emerald.emd`')
    expect(instructions).toMatch(/Google Drive/)
    expect(instructions).toMatch(/version history/)
    expect(instructions).not.toMatch(/this machine|local|absolute|Emerald's own folder|#\//i)

    // It names no tool it does not offer (D-104, D-109), as the other two blocks.
    const { tools } = await client.listTools()
    const offered = new Set(tools.map((tool) => tool.name))
    const named = [...instructions.matchAll(/`([a-z_]+)`/g)]
      .map((match) => match[1] ?? '')
      .filter((word) => word.includes('_'))
    expect(named.length).toBeGreaterThan(10)
    for (const name of named) expect(offered).toContain(name)
    await client.close()
  })

  it('runs each tool on the store’s one document, with no path given', async () => {
    const store = memoryStore(await emptyDocument())
    const client = await connected(store)

    const declared = await client.callTool({
      name: 'declare_format',
      arguments: { format: 'book', title: 'Book', columns: [{ name: 'title', type: 'text', required: true }], commit: true },
    })
    expect(declared.isError).toBeFalsy()
    await client.callTool({ name: 'record_format_rows', arguments: { format: 'book', rows: [{ title: 'Dune' }], commit: true } })
    const rows = await client.callTool({ name: 'format_rows', arguments: { format: 'book' } })
    expect(textOf(rows)).toContain('Dune')
    // A drawing tool hands out no copy of a page: the path and URI stay here.
    const shown = await client.callTool({ name: 'show_format', arguments: { format: 'book' } })
    expect(shown._meta).toBeUndefined()
    expect(shown.structuredContent).toBeUndefined()

    expect(store.writes).toBeGreaterThanOrEqual(2)
    expect(new Set(store.reads)).toEqual(new Set([CONNECTOR_DOCUMENT]))
    // A path the caller sends anyway names nothing: it is the one document.
    await client.callTool({ name: 'formats', arguments: { path: 'C:/elsewhere/other.emd' } })
    expect(new Set(store.reads)).toEqual(new Set([CONNECTOR_DOCUMENT]))
    await client.close()
  })

  it('refuses a tool it leaves out, and a file named anyway', async () => {
    const store = memoryStore(await emptyDocument())
    const client = await connected(store)

    const read = await client.callTool({ name: 'read_onto_format', arguments: { file: 'C:/notes', format: 'book' } })
    expect(read.isError).toBe(true)
    expect(textOf(read)).toMatch(/not offered on the Google Drive connector/)

    const scan = await client.callTool({ name: 'search_document', arguments: { denylist: 'C:/deny.txt' } })
    expect(scan.isError).toBe(true)
    expect(textOf(scan)).toMatch(/`denylist` names a file/)
    expect(store.reads).toEqual([])
    await client.close()
  })

  it('reads no row in another document', async () => {
    const store = memoryStore(await emptyDocument())
    const client = await connected(store)
    await client.callTool({
      name: 'declare_format',
      arguments: {
        format: 'task',
        title: 'Task',
        columns: [
          { name: 'title', type: 'text', required: true },
          { name: 'upstream', type: 'elsewhere' },
        ],
        commit: true,
      },
    })
    await client.callTool({
      name: 'record_format_rows',
      arguments: { format: 'task', rows: [{ title: 'Ship', upstream: 'C:/other/site.emd S1 U5' }], commit: true },
    })
    const rows = await client.callTool({ name: 'format_rows', arguments: { format: 'task' } })
    expect(textOf(rows)).toMatch(/unresolved — site\.emd is another document, and only this one is reachable here/)
    expect(new Set(store.reads)).toEqual(new Set([CONNECTOR_DOCUMENT]))
    await client.close()
  })
})
