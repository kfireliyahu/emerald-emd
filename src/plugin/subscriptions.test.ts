import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'

import { createServer } from './server.ts'
import { documentPathOf, documentUri } from './subscriptions.ts'
import { watchDocument, watchedDocumentCount } from './watch.ts'
import { tempDir } from '../testing/tempDir'

/**
 * **A subscription is proved against a real directory and another process**
 * (M44 U2): the save that matters is somebody else's, made the way every
 * writer here makes one — a sibling written, then renamed over the document —
 * which is exactly the save a watch on the file itself goes deaf to (D-127).
 */

const run = promisify(execFile)

/** Saves `path` from another Node process, as a rename over it. */
async function renameSaveElsewhere(path: string, text: string): Promise<void> {
  const script =
    "const fs = require('node:fs');" +
    'const [target, text] = process.argv.slice(1);' +
    "const sibling = target + '.saving';" +
    'fs.writeFileSync(sibling, text);' +
    'fs.renameSync(sibling, target);'
  await run(process.execPath, ['-e', script, path, text])
}

async function aDocument(): Promise<string> {
  const path = join(await tempDir('emerald-subscribe-'), 'notes.emd')
  await writeFile(path, 'the first version')
  return path
}

/** Every URI a client is told about, with when. */
function listening(client: Client): { uris: string[]; heard: Promise<number> } {
  const told = { uris: [] as string[], heard: undefined as unknown as Promise<number> }
  let resolveHeard: (at: number) => void = () => undefined
  told.heard = new Promise((resolve) => (resolveHeard = resolve))
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
    told.uris.push(notification.params.uri)
    resolveHeard(Date.now())
  })
  return told
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`nothing within ${ms}ms`)), ms)),
  ])
}

const quiet = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function connected(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([createServer({ engineOnly: true }).connect(serverTransport), client.connect(clientTransport)])
  return client
}

afterEach(() => {
  expect(watchedDocumentCount()).toBe(0)
})

describe('a document as a resource you subscribe to (M44 U2)', () => {
  it('says it takes subscriptions', async () => {
    const client = await connected()
    expect(client.getServerCapabilities()?.resources?.subscribe).toBe(true)
    await client.close()
  })

  it('addresses a document by its file:// URI or its absolute path', () => {
    const path = join(process.cwd(), 'notes.emd')
    expect(documentUri(path)).toMatch(/^file:\/\/\//)
    expect(documentPathOf(documentUri(path))).toBe(path)
    expect(documentPathOf(path)).toBe(path)
    expect(documentPathOf('ui://emerald/sheet.html')).toBeUndefined()
    expect(documentPathOf('notes.emd')).toBeUndefined()
  })

  it('tells a subscriber within a second of another process saving by rename, and nothing after unsubscribing', async () => {
    const path = await aDocument()
    const uri = documentUri(path)
    const client = await connected()
    const told = listening(client)

    await client.subscribeResource({ uri })
    const saved = Date.now()
    await renameSaveElsewhere(path, 'the second version')
    // Timed from before the other process was started, so the bound covers
    // starting it as well; the second the done-test allows is the stdio one's.
    const heard = await within(told.heard, 2_000)
    expect(heard - saved).toBeLessThan(2_000)
    expect(told.uris).toEqual([uri])

    // A second rename-save: the watch did not go deaf on the first.
    await renameSaveElsewhere(path, 'the third version')
    await quiet(600)
    expect(told.uris).toEqual([uri, uri])

    await client.unsubscribeResource({ uri })
    expect(watchedDocumentCount()).toBe(0)
    await renameSaveElsewhere(path, 'the fourth version')
    await quiet(600)
    expect(told.uris).toEqual([uri, uri])
    await client.close()
  })

  it('answers with the URI as the client spelled it, a bare path included', async () => {
    const path = await aDocument()
    const client = await connected()
    const told = listening(client)
    await client.subscribeResource({ uri: path })
    await renameSaveElsewhere(path, 'changed')
    await within(told.heard, 2_000)
    expect(told.uris).toEqual([path])
    await client.unsubscribeResource({ uri: path })
    await client.close()
  })

  it('stops watching when the client goes', async () => {
    const path = await aDocument()
    const client = await connected()
    await client.subscribeResource({ uri: documentUri(path) })
    expect(watchedDocumentCount()).toBe(1)
    await client.close()
    expect(watchedDocumentCount()).toBe(0)
  })

  it('refuses what is not a document', async () => {
    const client = await connected()
    await expect(client.subscribeResource({ uri: 'ui://emerald/sheet.html' })).rejects.toThrow(/file:\/\/ URI/)
    const missing = join(await tempDir('emerald-subscribe-'), 'gone.emd')
    await expect(client.subscribeResource({ uri: documentUri(missing) })).rejects.toThrow(/No document/)
    expect(watchedDocumentCount()).toBe(0)
    await client.close()
  })
})

describe('the watch underneath it', () => {
  it('is one watch however many listen, and hears nothing of the file beside it', async () => {
    const path = await aDocument()
    let first = 0
    let second = 0
    const stopFirst = await watchDocument(path, () => (first += 1))
    const stopSecond = await watchDocument(path, () => (second += 1))
    expect(watchedDocumentCount()).toBe(1)

    // The directory is watched, so the directory's other files are heard and
    // dropped: a neighbour's save is not this document's.
    await renameSaveElsewhere(join(dirname(path), 'neighbour.emd'), 'not this one')
    await quiet(600)
    expect([first, second]).toEqual([0, 0])

    await renameSaveElsewhere(path, 'changed once')
    await quiet(600)
    expect([first, second]).toEqual([1, 1])

    stopFirst()
    stopFirst()
    expect(watchedDocumentCount()).toBe(1)
    await renameSaveElsewhere(path, 'changed twice')
    await quiet(600)
    expect([first, second]).toEqual([1, 2])

    stopSecond()
    expect(watchedDocumentCount()).toBe(0)
  })
})

describe('over stdio, the way a client runs it', () => {
  it('subscribes, hears a rename-save from another process within a second, and nothing after', async () => {
    const path = await aDocument()
    const uri = documentUri(path)
    // The server from source, under vite-node, so no build is needed: the same
    // `main.ts` that `build:plugin` bundles.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join('node_modules', 'vite-node', 'vite-node.mjs'), join('src', 'plugin', 'main.ts'), '--', '--engine-only'],
      cwd: process.cwd(),
      stderr: 'ignore',
    })
    const client = new Client({ name: 'stdio-test', version: '0' })
    await client.connect(transport)
    try {
      const told = listening(client)
      await client.subscribeResource({ uri })

      const saved = Date.now()
      await renameSaveElsewhere(path, 'saved by somebody else')
      const heard = await within(told.heard, 3_000)
      // From before the other process started to the word arriving — the
      // process's own start included — inside the second.
      expect(heard - saved).toBeLessThan(1_000)
      process.stderr.write(`[M44 U2] save to notification over stdio: ${heard - saved}ms
`)
      expect(told.uris).toEqual([uri])

      await client.unsubscribeResource({ uri })
      await renameSaveElsewhere(path, 'saved again')
      await quiet(800)
      expect(told.uris).toEqual([uri])
    } finally {
      await client.close()
    }
  }, 60_000)
})
