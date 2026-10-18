import { describe, expect, it } from 'vitest'

import { CATALOG_SERVER_NAME, TOOL_GROUPS, type ToolEffect, type ToolHalf } from './catalog.ts'
import { ENGINE_TOOLS, LEDGER_TOOLS, SERVER_NAME } from './server.ts'
import type { PluginTool } from './tools/tool.ts'

/**
 * **The MCP screen cannot drift from the server** (M26 U7, D-295).
 *
 * The screen reads `catalog.ts` because it may not import the server; this is
 * what makes that a reading of the server's own definitions rather than a
 * second list somebody keeps: every tool the server offers has exactly one
 * line, in the right half, saying what its annotations say it does.
 */
describe('the catalog the MCP screen reads', () => {
  const inCatalog = (half: ToolHalf): string[] =>
    TOOL_GROUPS.filter((group) => group.half === half)
      .flatMap((group) => group.tools.map((tool) => tool.name))
      .sort()
  const onServer = (tools: readonly PluginTool[]): string[] =>
    tools.map((tool) => tool.definition.name).sort()

  it('names every engine tool the server offers, and no other', () => {
    expect(inCatalog('engine')).toEqual(onServer(ENGINE_TOOLS))
  })

  it('names every ledger tool the server offers, and no other', () => {
    expect(inCatalog('ledger')).toEqual(onServer(LEDGER_TOOLS))
  })

  it('says a tool reads, writes or removes exactly when its definition does', () => {
    const effectOf = (tool: PluginTool): ToolEffect => {
      const hints = tool.definition.annotations
      if (hints?.readOnlyHint === true) return 'reads'
      return hints?.destructiveHint === true ? 'removes' : 'writes'
    }
    const server = new Map([...ENGINE_TOOLS, ...LEDGER_TOOLS].map((t) => [t.definition.name, effectOf(t)]))
    for (const tool of TOOL_GROUPS.flatMap((group) => group.tools)) {
      expect([tool.name, tool.effect]).toEqual([tool.name, server.get(tool.name)])
    }
  })

  it('says each tool in one short sentence, for a person', () => {
    for (const tool of TOOL_GROUPS.flatMap((group) => group.tools)) {
      expect(tool.plain.length, tool.name).toBeLessThanOrEqual(80)
      expect(tool.plain, tool.name).toMatch(/\.$/)
    }
  })

  it('connects under the name the server answers to', () => {
    expect(CATALOG_SERVER_NAME).toBe(SERVER_NAME)
  })
})
