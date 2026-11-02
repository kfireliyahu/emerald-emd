import { describe, expect, it } from 'vitest'

import { connectSnippets } from './connect.ts'

describe('the snippets on the MCP screen', () => {
  const path = 'C:\\Users\\me\\My notes\\kitchen.emd'

  it('offers the engine alone to a document that keeps no ledger, from npm', () => {
    const snippets = connectSnippets({ documentPath: path, engineOnly: true })
    expect(snippets.claudeCode).toBe('claude mcp add emerald -- npx -y emerald-mcp --engine-only')
    expect(JSON.parse(snippets.desktop)).toEqual({
      mcpServers: { emerald: { command: 'npx', args: ['-y', 'emerald-mcp', '--engine-only'] } },
    })
  })

  it('offers the whole server to a document that keeps the ledger', () => {
    const snippets = connectSnippets({ documentPath: path, engineOnly: false })
    expect(snippets.claudeCode).not.toContain('--engine-only')
    expect(JSON.parse(snippets.desktop).mcpServers.emerald.args).toEqual(['-y', 'emerald-mcp'])
  })

  it('starts npx through cmd for a desktop assistant on Windows', () => {
    const snippets = connectSnippets({ documentPath: path, engineOnly: true, windows: true })
    expect(JSON.parse(snippets.desktop).mcpServers.emerald).toEqual({
      command: 'cmd',
      args: ['/c', 'npx', '-y', 'emerald-mcp', '--engine-only'],
    })
    expect(snippets.claudeCode).toBe('claude mcp add emerald -- npx -y emerald-mcp --engine-only')
  })

  it('points at no folder a source checkout would have', () => {
    const snippets = connectSnippets({ documentPath: path, engineOnly: true })
    expect(snippets.desktop).not.toMatch(/dist-plugin|server\.mjs/)
    expect(snippets.claudeCode).not.toMatch(/dist-plugin|server\.mjs/)
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
})
