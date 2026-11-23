/**
 * **`export_format_rows`: the command line's `export`, from a conversation**
 * (M63 U1, D-601) — `exportCommand.ts` does the work, and this is its arguments
 * as JSON.
 *
 * **It writes only inside the document's folder and the folders under it** (the
 * maintainer's pick in D-601): `to` is read against that folder, and a path
 * that leaves it is refused with a sentence. The command line writes wherever it
 * is told, because a person typed it; a model asked by a document someone sent
 * should not be able to write anywhere else on the machine.
 *
 * **It reads the document and never writes it**, so it is a read for parity
 * (D-227) — but it writes a file, so its hints say it writes (D-602): a client
 * shows `readOnlyHint` to a person before a call, and a file appearing on disk
 * is not what *reads* promises.
 */

import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path'

import { checkAnswer, exportFrom, fileState, shownPath, writeExport, wroteLine, type ExportAsk } from '../exportCommand.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  optionalBoolean,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

/** `to` against the document's folder, or the sentence refusing it. */
export function exportTarget(documentPath: string, to: string): string {
  const folder = dirname(resolvePath(documentPath))
  const target = resolvePath(folder, to)
  const inside = relative(folder, target)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new ToolInputError(
      `\`to\` is ${to}, which is outside ${shownPath(folder)}. This tool writes only inside the document's folder and the folders under it; ` +
        'the command line `export` writes anywhere a person tells it.',
    )
  }
  return target
}

function askOf(args: Args): ExportAsk {
  const columns = args['columns']
  if (columns !== undefined && (!Array.isArray(columns) || columns.some((each) => typeof each !== 'string'))) {
    throw new ToolInputError('`columns` must be an array of column names.')
  }
  const link = args['link']
  if (link !== undefined && (typeof link !== 'object' || link === null || Array.isArray(link) || Object.values(link).some((each) => typeof each !== 'string'))) {
    throw new ToolInputError('`link` must be an object of link column to a column of the format it links to.')
  }
  const match = args['match']
  if (match !== undefined && match !== null && (typeof match !== 'object' || Array.isArray(match))) {
    throw new ToolInputError('`match` must be an object of column name to value.')
  }
  const search = optionalString(args, 'search')
  const order = optionalString(args, 'order')
  return {
    format: requireString(args, 'format'),
    ...(match === undefined || match === null ? {} : { match: match as Record<string, unknown> }),
    ...(search === undefined ? {} : { search }),
    ...(order === undefined ? {} : { order }),
    descending: optionalBoolean(args, 'descending') ?? false,
    ...(columns === undefined ? {} : { columns: columns as string[] }),
    ...(link === undefined ? {} : { link: link as Record<string, string> }),
    ids: optionalBoolean(args, 'ids') ?? false,
  }
}

export const exportFormatRowsTool: PluginTool = {
  definition: {
    name: 'export_format_rows',
    title: 'Export a format’s rows to JSON',
    description:
      'Writes the rows `format_rows` would match to a JSON file, the same bytes every time: keys in declaration order, ' +
      'empty columns left out, money as text beside `<column>_currency`, a link as its row’s name. Never modifies the document.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name.'),
        to: stringProp('The file, inside the document’s folder.'),
        match: { type: 'object', description: 'As `format_rows` takes it.', additionalProperties: true },
        search: stringProp('As `format_rows` takes it.'),
        order: stringProp('A column to sort by.'),
        descending: booleanProp('Sort the other way.'),
        columns: { type: 'array', description: 'Columns to write, computed too; omit for every stored one.', items: { type: 'string' } },
        link: { type: 'object', description: 'A link to the linked column it is written as: `{milestone: "ref"}`.', additionalProperties: { type: 'string' } },
        ids: booleanProp('Each row’s id as `id`.'),
        check: booleanProp('Write nothing; say whether the file is current.'),
      },
      required: ['path', 'format', 'to'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const to = exportTarget(path, requireString(args, 'to'))
    const ask = askOf(args)
    const exported = await exportFrom(path, ask)
    if (!exported.ok) return exported.error
    const state = await fileState(to, exported.value.text)
    if (optionalBoolean(args, 'check') === true) return checkAnswer(state, to, exported.value).line
    if (state !== 'current') await writeExport(to, exported.value.text)
    return wroteLine(state, to, exported.value)
  },
}
