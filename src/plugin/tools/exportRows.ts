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

import { dirname, resolve as resolvePath } from 'node:path'

import {
  NEST_ONE_LEVEL,
  checkAnswer,
  exportFrom,
  fileState,
  parseNest,
  runSaved,
  shownPath,
  withinFolder,
  writeExport,
  wroteLine,
  type ExportAsk,
  type NestAsk,
} from '../exportCommand.ts'
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
  const target = withinFolder(documentPath, to)
  if (target === undefined) {
    throw new ToolInputError(
      `\`to\` is ${to}, which is outside ${shownPath(dirname(resolvePath(documentPath)))}. This tool writes only inside the document's folder and the folders under it; ` +
        'the command line `export` writes anywhere a person tells it.',
    )
  }
  return target
}

/** The arguments that shape one export, and so go with `format`. */
const ONE_EXPORT = ['to', 'match', 'search', 'order', 'descending', 'columns', 'link', 'ids', 'nest']

const NEST_KEYS = ['format', 'as', 'order', 'descending', 'columns']

/**
 * **`nest`'s items** (M63 U2): an object of `format`, `as`, `order`,
 * `descending` and `columns`, or the command line's one string,
 * `keyword.card as=keywords order=position`. One level only.
 */
function nestOf(given: unknown): NestAsk {
  if (typeof given === 'string') {
    const parsed = parseNest(given)
    if (!parsed.ok) throw new ToolInputError(parsed.error)
    return parsed.value
  }
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    throw new ToolInputError('Each `nest` is an object — `{format: "keyword", as: "keywords", order: "position"}` — or the same as one string.')
  }
  const item = given as Record<string, unknown>
  const format = item['format']
  if (typeof format !== 'string' || format === '') throw new ToolInputError('Each `nest` names the `format` folded in.')
  if ('nest' in item) {
    throw new ToolInputError(NEST_ONE_LEVEL(format))
  }
  const unknown = Object.keys(item).find((key) => !NEST_KEYS.includes(key))
  if (unknown !== undefined) throw new ToolInputError(`A nest does not know ${unknown}; it takes ${NEST_KEYS.join(', ')}.`)
  const columns = item['columns']
  if (columns !== undefined && (!Array.isArray(columns) || columns.some((each) => typeof each !== 'string'))) {
    throw new ToolInputError('A nest\'s `columns` must be an array of column names.')
  }
  const as = optionalString(item, 'as')
  const order = optionalString(item, 'order')
  if (as === '') throw new ToolInputError('A nest\'s `as` is the key its rows go out under; leave it out for the format\'s name.')
  return {
    format,
    ...(as === undefined ? {} : { as }),
    ...(order === undefined ? {} : { order }),
    ...(optionalBoolean(item, 'descending') === true ? { descending: true } : {}),
    ...(columns === undefined ? {} : { columns: columns as string[] }),
  }
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
  const nest = args['nest']
  if (nest !== undefined && !Array.isArray(nest)) throw new ToolInputError('`nest` must be an array, one child format each.')
  return {
    format: requireString(args, 'format'),
    ...(match === undefined || match === null ? {} : { match: match as Record<string, unknown> }),
    ...(search === undefined ? {} : { search }),
    ...(order === undefined ? {} : { order }),
    descending: optionalBoolean(args, 'descending') ?? false,
    ...(columns === undefined ? {} : { columns: columns as string[] }),
    ...(link === undefined ? {} : { link: link as Record<string, string> }),
    ids: optionalBoolean(args, 'ids') ?? false,
    ...(nest === undefined || nest.length === 0 ? {} : { nest: (nest as unknown[]).map(nestOf) }),
  }
}

export const exportFormatRowsTool: PluginTool = {
  definition: {
    name: 'export_format_rows',
    title: 'Export a format’s rows to JSON',
    description:
      'Writes the rows `format_rows` would match to a JSON file, the same bytes every time: empty columns left out, ' +
      'money as text beside `<column>_currency`, a link as its row’s name. No `format`: every saved export. Never modifies the document.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name.'),
        to: stringProp('The file, inside the document’s folder.'),
        match: { type: 'object', description: 'As `format_rows`.', additionalProperties: true },
        search: stringProp('As `format_rows`.'),
        order: stringProp('A column to sort by.'),
        descending: booleanProp('Sort the other way.'),
        columns: { type: 'array', description: 'Columns to write, computed too.', items: { type: 'string' } },
        link: { type: 'object', description: 'A link to the linked column it is written as: `{milestone: "ref"}`.', additionalProperties: { type: 'string' } },
        ids: booleanProp('Each row’s id as `id`.'),
        nest: {
          type: 'array',
          description:
            'Child formats folded in: each row’s children, as an array under `as` (default its name), by `order`; `descending`, `columns` too. ' +
            '`format` is `child.link` when it links here twice. One level.',
          items: { type: 'object', properties: { format: { type: 'string' } }, required: ['format'] },
        },
        check: booleanProp('Write nothing; say if current.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const check = optionalBoolean(args, 'check') === true
    if (args['format'] === undefined) {
      // **Every saved export** (M63 U3, D-601): each row's file held to the
      // document's folder, a refused one reported and the others written.
      const given = ONE_EXPORT.filter((key) => args[key] !== undefined)
      if (given.length > 0) {
        throw new ToolInputError(`${given.map((key) => `\`${key}\``).join(', ')} ${given.length === 1 ? 'goes' : 'go'} with \`format\`; without it, every saved export is written.`)
      }
      const run = await runSaved(path, check)
      return run.ok ? run.value.outcomes.map((each) => each.line).join('\n') : run.error
    }
    const to = exportTarget(path, requireString(args, 'to'))
    const ask = askOf(args)
    const exported = await exportFrom(path, ask)
    if (!exported.ok) return exported.error
    const state = await fileState(to, exported.value.text)
    if (check) return checkAnswer(state, to, exported.value).line
    if (state !== 'current') await writeExport(to, exported.value.text)
    return wroteLine(state, to, exported.value)
  },
}
