import { readFileSync } from 'node:fs'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { createServer, type ServerOptions } from '@/plugin/server.ts'

import { en } from './copy/en.ts'

/**
 * **A figure on the public page is pinned by a test** (M54 F8). The page, the
 * npm package's README and the repository's say how many tools the server
 * offers — "28 for any document, 85 with the ledger" — and the only thing that
 * may say it is the server's own `tools/list`, with `--engine-only` and
 * without. A tool added or removed fails here until the three are changed.
 */
async function listed(options: ServerOptions): Promise<number> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} })
  await Promise.all([createServer(options).connect(serverTransport), client.connect(clientTransport)])
  const { tools } = await client.listTools()
  await client.close()
  return tools.length
}

describe('the tool counts the page states', () => {
  it('are the server’s own, on the page, in the npm README and in the repository’s', async () => {
    const engine = await listed({ engineOnly: true })
    const all = await listed({})
    const claim = `${String(engine)} for any document, ${String(all)} with the ledger`
    expect(en.words.mcp.body.join('\n')).toContain(claim)
    expect(readFileSync('scripts/npm-package.mjs', 'utf8')).toContain(claim)
    expect(readFileSync('README.md', 'utf8')).toContain(claim)
  })
})
