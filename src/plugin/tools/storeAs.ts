/**
 * **`store_document_as`: text or SQLite bytes, from a conversation** — M47 U7.
 *
 * The per-file choice (D-246) had a screen and no tool: a session could say a
 * document was SQLite and could not make it text, and it was done in the
 * app. Parity (D-227) owes the conversation the same act, refused where the app
 * refuses it — a ledger, which the text does not carry (open question M25 U1 #2).
 */

import type { DocumentEncoding } from '@/data/storage/encoding.ts'

import { storeDocumentAs } from '../write.ts'
import { booleanProp, PATH_PROP, requireString, ToolInputError, type PluginTool } from './tool.ts'

const ENCODINGS: readonly DocumentEncoding[] = ['text', 'sqlite']

export const storeDocumentAsTool: PluginTool = {
  definition: {
    name: 'store_document_as',
    title: 'Store a document as text or as SQLite bytes',
    description:
      'Writes the document again as `text` (diffs in git) or as `sqlite` bytes, and every later write ' +
      'keeps that shape — the app’s Save as text. Refused when the text would not carry it — a ' +
      'document keeping the ledger, for one. Writes nothing until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        as: { type: 'string', enum: [...ENCODINGS], description: 'How the file is stored from now on.' },
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path', 'as'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const as = requireString(args, 'as')
    if (!(ENCODINGS as readonly string[]).includes(as)) throw new ToolInputError(`\`as\` is text or sqlite; got ${as}.`)
    return storeDocumentAs(path, as as DocumentEncoding, args['commit'] === true)
  },
}
