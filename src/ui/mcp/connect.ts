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
 *
 * **The server is the npm package** (M42 U2, D-497), so the command is the one
 * `docs/plugin.md` and the README give: `npx -y emerald-mcp` (M54 F6). It was
 * a placeholder path into a source checkout until then. A desktop assistant on
 * Windows starts `npx` through `cmd /c`, as `hosts/claude/README.md` says.
 */

import { CATALOG_SERVER_NAME, ENGINE_ONLY_FLAG } from '@/plugin/catalog.ts'

/** The npm package the server ships as. */
export const SERVER_PACKAGE = 'emerald-mcp'

export interface ConnectInput {
  /** The open document's absolute path, or `undefined` when it has none yet. */
  readonly documentPath: string | undefined
  /** True when the document keeps no ledger, so its tools are not worth offering. */
  readonly engineOnly: boolean
  /** True on Windows, where a desktop assistant starts `npx` through `cmd /c`. */
  readonly windows?: boolean
}

export interface ConnectSnippets {
  readonly claudeCode: string
  readonly desktop: string
  /** `undefined` when there is no path to name. */
  readonly firstMessage: string | undefined
}

export function connectSnippets(input: ConnectInput): ConnectSnippets {
  const npx = ['-y', SERVER_PACKAGE, ...(input.engineOnly ? [ENGINE_ONLY_FLAG] : [])]
  const claudeCode = ['claude mcp add', CATALOG_SERVER_NAME, '-- npx', ...npx].join(' ')
  const server = input.windows === true ? { command: 'cmd', args: ['/c', 'npx', ...npx] } : { command: 'npx', args: npx }
  const desktop = JSON.stringify({ mcpServers: { [CATALOG_SERVER_NAME]: server } }, null, 2)
  const firstMessage =
    input.documentPath === undefined
      ? undefined
      : `My Emerald document is at ${input.documentPath} — start with the formats it declares.`
  return { claudeCode, desktop, firstMessage }
}
