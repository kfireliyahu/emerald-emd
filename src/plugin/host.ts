/**
 * **What a host's own code may use of the server** (M42 U6).
 *
 * The MCP server is host-neutral: any client that runs a local server gets the
 * same tools, and MCP Apps (the frame) is an open extension, so it stays here.
 * What only one host reads — Claude Code's hooks, its status line, its skills,
 * the plugin's manifest — lives in `hosts/<host>/`, and reaches the server
 * through this file and nothing else (and the shell through `bridge.ts`, the
 * constants every layer shares). Nothing in `src/` imports from `hosts/`.
 * `src/plugin/hostBoundary.test.ts` holds both halves.
 *
 * A host gets the engine's answers the way a client does — a tool's `run` —
 * so what a hook prints is what the tool says, never a second rendering.
 */

export { err, ok, type Result } from '@/core/result.ts'

export { matching, readFormat, readFormats, type RowMatch, type WatchedRow } from './formatWatch.ts'
export { formatRowsTool, recordFormatRowsTool, updateFormatRowsTool } from './tools/formats.ts'
export { createDocumentTool } from './tools/setup.ts'
export { FOR_THE_MODEL } from './tools/sheet.ts'
export { startHereTool } from './tools/startHere.ts'
export { NO_CLIENT } from './tools/tool.ts'
