/**
 * The three things a person pastes to talk to this document from an
 * assistant (M26 U7): the line that adds the server to Claude Code, the block
 * a desktop assistant's configuration takes, and the sentence that tells the
 * conversation which file to open.
 *
 * **The document's path goes in the sentence and not in the configuration.**
 * Every tool takes an absolute `path` and the server holds nothing open
 * between calls (`tools/tool.ts`, `PATH_PROP`), so one server serves every
 * document and the path is part of each question rather than of the setup.
 */

import { CATALOG_SERVER_NAME, ENGINE_ONLY_FLAG } from '@/plugin/catalog.ts'

/**
 * Where the server is, until it ships with the app. `npm run build:plugin`
 * writes it into the source checkout and the installer does not carry it
 * (the open question *Engine server on its own*, D-284).
 */
export const SERVER_PLACEHOLDER = '<folder Emerald was built in>/dist-plugin/server.mjs'

export interface ConnectInput {
  /** The open document's absolute path, or `undefined` when it has none yet. */
  readonly documentPath: string | undefined
  /** True when the document keeps no ledger, so its tools are not worth offering. */
  readonly engineOnly: boolean
  readonly serverScript?: string
}

export interface ConnectSnippets {
  readonly claudeCode: string
  readonly desktop: string
  /** `undefined` when there is no path to name. */
  readonly firstMessage: string | undefined
}

export function connectSnippets(input: ConnectInput): ConnectSnippets {
  const script = input.serverScript ?? SERVER_PLACEHOLDER
  const args = input.engineOnly ? [script, ENGINE_ONLY_FLAG] : [script]
  const claudeCode = [
    'claude mcp add',
    CATALOG_SERVER_NAME,
    '-- node',
    quoted(script),
    ...(input.engineOnly ? [ENGINE_ONLY_FLAG] : []),
  ].join(' ')
  const desktop = JSON.stringify(
    { mcpServers: { [CATALOG_SERVER_NAME]: { command: 'node', args } } },
    null,
    2,
  )
  const firstMessage =
    input.documentPath === undefined
      ? undefined
      : `My Emerald document is at ${input.documentPath} — start with the formats it declares.`
  return { claudeCode, desktop, firstMessage }
}

/** Double quotes, so a path with a space survives a shell. */
function quoted(text: string): string {
  return `"${text.replace(/"/g, '\\"')}"`
}
