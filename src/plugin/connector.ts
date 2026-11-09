/**
 * **The Google Drive connector's tool list** (M57 U2, D-562): the one document,
 * no path, and no tool that needs another file.
 *
 * The local server's tools each take the `path` of a `.emd` on this machine.
 * The connector has one document — `Emerald/Emerald.emd` in the person's own
 * Drive — and its store (U3) supplies it, so every tool it offers loses its
 * `path` and is handed this one. What it cannot offer is anything that reaches
 * a file other than that document: a statement, a spreadsheet, a folder of
 * notes, another `.emd`, a copy made on request, the document stored another
 * way, and the page that reads the document straight off this machine's disk.
 *
 * **What a tool takes is what it is offered under**, and `connector.test.ts`
 * holds the list to it: a connector tool with a parameter that names a file
 * fails it, whichever list it slipped in from.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import { ToolInputError, type Args } from './tools/tool.ts'

/**
 * The one document, as the connector's tools are handed it. **A name the store
 * reads, not a path on any disk**: the Drive store finds the folder and the file
 * by these names (D-562), and an answer that names its document names this.
 */
export const CONNECTOR_DOCUMENT = 'Emerald/Emerald.emd'

/**
 * Every tool the connector leaves out, and why, by name (D-562). Each needs a
 * file other than the one document — so each is a capability of the local
 * server and of the app, never of a document in Drive.
 */
export const NOT_ON_THE_CONNECTOR: ReadonlyMap<string, string> = new Map([
  // Intake and the readers: a spreadsheet, a JSON file or a folder of notes read
  // where it is, and the two that name or take back what such a read wrote.
  ['read_onto_format', 'reads a spreadsheet, a JSON file or a folder of notes'],
  ['supersede_reading', 'takes back what a file read wrote'],
  ['readers', 'names the readers files were read with'],
  // The ledger's statements: a file the reader opens, or one hashed to be known again.
  ['statement_preview', 'reads a statement file'],
  ['import_statement', 'reads a statement file'],
  ['record_holdings_statement', 'hashes the statement file it was read from'],
  // The document as a file: another one made, a copy kept beside it, or its
  // bytes stored another way. Drive's version history is the earlier copies.
  ['create_document', 'makes another document'],
  ['keep_copy', 'keeps a copy beside the document'],
  ['store_document_as', 'stores the file another way'],
  // The drawn page's copy, read off this machine's disk and watched by its mark.
  ['frame_copy', 'reads the document off this machine’s disk'],
])

/**
 * Parameters a connector tool loses besides `path`, each naming a file on the
 * machine the server runs on.
 */
const DROPPED: ReadonlyMap<string, readonly string[]> = new Map([['search_document', ['denylist']]])

/** Whether the connector offers this tool. */
export function onTheConnector(name: string): boolean {
  return !NOT_ON_THE_CONNECTOR.has(name)
}

interface Schema {
  readonly properties?: Record<string, unknown>
  readonly required?: readonly string[]
}

/**
 * A tool as the connector lists it: `path` gone, and any parameter naming a
 * file; and **no page** — `_meta.ui` names the frame, whose copy is
 * `frame_copy`, which the connector does not offer.
 */
export function connectorDefinition(definition: Tool): Tool {
  const gone = new Set(['path', ...(DROPPED.get(definition.name) ?? [])])
  const schema = definition.inputSchema as Schema & Tool['inputSchema']
  const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([name]) => !gone.has(name)))
  const required = (schema.required ?? []).filter((name) => !gone.has(name))
  const { required: _required, ...rest } = schema
  const inputSchema = { ...rest, properties, ...(required.length === 0 ? {} : { required }) }
  const { ui: _ui, ...meta } = (definition._meta ?? {}) as Record<string, unknown>
  const { _meta: _dropped, ...tool } = definition
  return { ...tool, inputSchema, ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }) }
}

/**
 * A call's arguments as the tool is run with them: `path` is the one document,
 * whatever the caller sent, and a parameter the connector dropped is refused
 * rather than read.
 */
export function connectorArgs(name: string, args: Args): Args {
  for (const dropped of DROPPED.get(name) ?? []) {
    if (args[dropped] !== undefined && args[dropped] !== null) {
      throw new ToolInputError(
        `\`${dropped}\` names a file, and this connector reaches only ${CONNECTOR_DOCUMENT} in the person's Google Drive.`,
      )
    }
  }
  return { ...args, path: CONNECTOR_DOCUMENT }
}

/** The answer to a call for a tool the connector leaves out. */
export function notOnTheConnector(name: string): string {
  const why = NOT_ON_THE_CONNECTOR.get(name) ?? 'needs a file other than the one document'
  return (
    `${name} is not offered on the Google Drive connector: it ${why}, and this connector works on ` +
    `${CONNECTOR_DOCUMENT} in the person's Google Drive alone.`
  )
}
