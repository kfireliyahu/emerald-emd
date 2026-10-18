import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { ENGINE_INSTRUCTIONS, SERVER_INSTRUCTIONS } from './instructions.ts'
import { APP_TOOLS, ENGINE_TOOLS, LEDGER_TOOLS, listedDefinition } from './server.ts'

/**
 * **Every tool says what it does to the machine, the way a directory checks it**
 * (M42 U1).
 *
 * A directory's review fails a tool without a title and the hints that say
 * whether it reads, removes or reaches past the machine. What the hints mean
 * here, so that each one is a claim somebody can check:
 *
 * - `readOnlyHint` — the call never writes. **A write that dry-runs until
 *   `commit: true` is not read-only**: the same tool, called once more, writes.
 * - `destructiveHint` — the call can take away something a person kept: a row,
 *   a column or a claim, a saved reader, a plan, a category. Correcting a value
 *   is not, since every committed write copies the document first; neither is
 *   pruning the oldest of those copies, which the server made itself.
 * - `idempotentHint`, on every write — the same committed call twice leaves the
 *   document as the first one left it (a value set, an import that dedupes).
 *   One that refuses the second time, or makes a second thing, says false.
 * - `openWorldHint` — false everywhere: nothing here leaves the machine.
 *
 * Which tools remove is pinned name by name in `catalog.ts`, which the MCP screen
 * reads; `catalog.test.ts` holds it to these hints.
 */
function annotationFaults(definition: Tool): string[] {
  const faults: string[] = []
  const hints = definition.annotations
  if (typeof definition.title !== 'string' || definition.title.trim() === '') faults.push('no title')
  if (hints === undefined) return [...faults, 'no annotations']
  if (hints.title !== definition.title) faults.push('annotations.title is not its title')
  if (typeof hints.readOnlyHint !== 'boolean') faults.push('no readOnlyHint')
  if (typeof hints.destructiveHint !== 'boolean') faults.push('no destructiveHint')
  if (hints.openWorldHint !== false) faults.push('openWorldHint is not false')
  const properties = (definition.inputSchema.properties ?? {}) as Record<string, unknown>
  if (hints.readOnlyHint === true) {
    if (hints.destructiveHint === true) faults.push('read-only and destructive')
    if ('commit' in properties) faults.push('takes `commit`, so it writes')
  } else if (typeof hints.idempotentHint !== 'boolean') {
    faults.push('a write with no idempotentHint')
  }
  return faults
}

const EVERY_TOOL = [...LEDGER_TOOLS, ...ENGINE_TOOLS, ...APP_TOOLS]

describe('tool annotations', () => {
  it('are on every tool of both servers, and say true things', () => {
    const faults = EVERY_TOOL.flatMap((tool) =>
      annotationFaults(listedDefinition(tool.definition)).map((fault) => `${tool.definition.name}: ${fault}`),
    )
    expect(faults).toEqual([])
    // The engine-only server offers a subset of these, and the frame's own call is among them.
    expect(EVERY_TOOL.length).toBeGreaterThanOrEqual(80)
  })

  it('fail a tool that has none', () => {
    const bare: Tool = { name: 'bare', inputSchema: { type: 'object', properties: { commit: {} } } }
    expect(annotationFaults(listedDefinition(bare))).toEqual([
      'no title',
      'no readOnlyHint',
      'no destructiveHint',
      'openWorldHint is not false',
      'a write with no idempotentHint',
    ])
    const readOnlyWrite: Tool = {
      ...bare,
      title: 'Bare',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }
    expect(annotationFaults(listedDefinition(readOnlyWrite))).toEqual(['takes `commit`, so it writes'])
  })
})

/**
 * **A stranger reads the tools, and cannot look up this project's notes** (M42 U1).
 * A decision number or a milestone in a description or in the instructions is a
 * reference nobody outside the repository can follow.
 */
describe('what a model reads', () => {
  const INTERNAL = /\bD-\d{3}\b|\bM\d{1,2} ?[UF]\d+\b/g

  it('cites no decision or milestone, in a description or the instructions', () => {
    const texts: [string, string][] = [
      ['instructions', SERVER_INSTRUCTIONS],
      ['engine-only instructions', ENGINE_INSTRUCTIONS],
      ...EVERY_TOOL.map((tool): [string, string] => [tool.definition.name, JSON.stringify(tool.definition)]),
    ]
    const found = texts.flatMap(([where, text]) => (text.match(INTERNAL) ?? []).map((ref) => `${where}: ${ref}`))
    expect(found).toEqual([])
  })
})
