import { describe, expect, it } from 'vitest'

import { SERVER_PLACEHOLDER, connectSnippets } from './connect.ts'

describe('the snippets on the MCP screen', () => {
  const path = 'C:\Users\me\My notes\kitchen.emd'

  it('offers the engine alone to a document that keeps no ledger', () => {
    const snippets = connectSnippets({ documentPath: path, engineOnly: true })
    expect(snippets.claudeCode).toBe(
      `claude mcp add emerald -- node "${SERVER_PLACEHOLDER}" --engine-only`,
    )
    expect(JSON.parse(snippets.desktop)).toEqual({
      mcpServers: { emerald: { command: 'node', args: [SERVER_PLACEHOLDER, '--engine-only'] } },
    })
  })

  it('offers the whole server to a document that keeps the ledger', () => {
    const snippets = connectSnippets({ documentPath: path, engineOnly: false })
    expect(snippets.claudeCode).not.toContain('--engine-only')
    expect(JSON.parse(snippets.desktop).mcpServers.emerald.args).toEqual([SERVER_PLACEHOLDER])
  })

  it('names the open document in the conversation, not in the configuration', () => {
    const snippets = connectSnippets({ documentPath: path, engineOnly: true })
    expect(snippets.firstMessage).toContain(path)
    expect(snippets.desktop).not.toContain('kitchen')
    expect(snippets.claudeCode).not.toContain('kitchen')
  })

  it('has no sentence to offer for a document with no path yet', () => {
    expect(connectSnippets({ documentPath: undefined, engineOnly: true }).firstMessage).toBeUndefined()
  })

  it('escapes a server path for JSON, backslashes and all', () => {
    const script = 'C:\src\emerald\dist-plugin\server.mjs'
    const snippets = connectSnippets({ documentPath: path, engineOnly: true, serverScript: script })
    expect(JSON.parse(snippets.desktop).mcpServers.emerald.args[0]).toBe(script)
  })
})
