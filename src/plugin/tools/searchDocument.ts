/**
 * **`search_document`: every row and column that holds a term, across the
 * whole document** — M47 U6.
 *
 * Two forms of one call. With `terms`, it is a search: what a person or a
 * conversation is looking for, each hit named by its format, its row and the
 * column that holds it, with the text around it. With `denylist`, it is **the
 * scan before a document is committed or handed to someone**: the terms come
 * from a file in `--replace-text` form (the one `src/privacy.test.ts` reads),
 * and the answer is hits only — where, never what. A row whose name is itself a
 * hit is not named, and a term is named by its line, never by itself.
 *
 * The scan also reads the file's own bytes, because a document stored as SQLite
 * bytes can still carry a value somebody deleted or rewrote, in pages SQLite
 * has not reused; a term that is in the bytes and in no value the document holds
 * is that, and it is said rather than missed.
 *
 * The repository is `documentSearchRepository`, which the palette's search
 * across the document shares (M37 U2c), so the two find the same rows (D-227).
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import {
  searchDocument,
  type DocumentSearch,
  type FormatHits,
  type RowHit,
} from '@/data/repositories/documentSearchRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { labelColumn } from '@/domain/format/declaration.ts'
import {
  DenylistError,
  denylistTerms,
  typedTerms,
  type SearchTerm,
} from '@/domain/format/searchTerms.ts'

import { readDocument } from '../document.ts'
import { count, paragraphs, plural, section, table } from '../format.ts'
import { PATH_PROP, ToolInputError, requireString, stringProp, type Args, type PluginTool } from './tool.ts'

export const TERMS_MAX = 50
/** Rows an answer lists in full; the counts above them are always of every one. */
export const HITS_SHOWN_MAX = 200
const AROUND = 40

function termsFrom(args: Args): { readonly terms: readonly SearchTerm[]; readonly scan: string | undefined } {
  const given = args['terms']
  const denylist = args['denylist']
  if ((given === undefined || given === null) === (denylist === undefined || denylist === null)) {
    throw new ToolInputError('Give `terms` to search, or `denylist` to scan — one of the two.')
  }
  if (denylist !== undefined && denylist !== null) {
    const file = requireString(args, 'denylist')
    if (!isAbsolute(file)) throw new ToolInputError('`denylist` is an absolute path to a file on this machine.')
    if (!existsSync(file)) throw new ToolInputError(`There is no denylist at ${file}.`)
    try {
      const terms = denylistTerms(readFileSync(file, 'utf8'))
      if (terms.length === 0) throw new ToolInputError(`The denylist at ${file} has no terms in it.`)
      return { terms, scan: file }
    } catch (error) {
      if (error instanceof DenylistError) throw new ToolInputError(error.message)
      throw error
    }
  }
  if (!Array.isArray(given) || given.some((each) => typeof each !== 'string')) {
    throw new ToolInputError('`terms` is a list of words or phrases.')
  }
  if (given.length > TERMS_MAX) throw new ToolInputError(`At most ${String(TERMS_MAX)} terms in one call.`)
  const terms = typedTerms(given as readonly string[])
  if (terms.length === 0) throw new ToolInputError('`terms` holds nothing to look for.')
  return { terms, scan: undefined }
}

/** The shown text around the first place a term is in it, on one line. */
function around(text: string, terms: readonly SearchTerm[], names: readonly string[]): string {
  const folded = text.toLowerCase()
  const at = terms
    .filter((term) => names.includes(term.name))
    .map((term) => folded.indexOf(term.name.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - AROUND)
  const end = Math.min(text.length, at + AROUND * 2)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

function rowCount(search: DocumentSearch): number {
  return search.formats.reduce((sum, each) => sum + each.rows.length, 0)
}

function formatSection(
  hits: FormatHits,
  rows: readonly RowHit[],
  terms: readonly SearchTerm[],
  scan: boolean,
): string {
  const label = labelColumn(hits.format)?.name
  const lines = rows.flatMap((row) =>
    row.columns.map((column, index) => {
      const named =
        index > 0
          ? '″'
          : row.label === null
            ? '—'
            : scan && row.columns.some((each) => each.column === label)
              ? '(its name is a hit)'
              : row.label
      const cells = [row.id, named, column.column, column.terms.join(', ')]
      return scan ? cells : [...cells, around(column.text, terms, column.terms)]
    }),
  )
  const headers = ['Id', 'Row', 'Column', scan ? 'Denylist' : 'Terms', ...(scan ? [] : ['Where'])]
  const shown = rows.length < hits.rows.length ? ` (showing ${count(rows.length)})` : ''
  return section(
    `${hits.format.title} (\`${hits.format.name}\`) — ${plural(hits.rows.length, 'row')}${shown}`,
    table(headers, lines),
  )
}

function answerText(search: DocumentSearch, terms: readonly SearchTerm[], scan: string | undefined, raw: string | undefined, formats: number): string {
  const rows = rowCount(search)
  const looked = scan === undefined
    ? terms.map((term) => `“${term.name}”`).join(', ')
    : `the ${plural(terms.length, 'term')} of ${scan}`

  // Rows in full up to the cap, format by format in the document's order.
  let left = HITS_SHOWN_MAX
  const sections = search.formats.map((hits) => {
    const shown = hits.rows.slice(0, Math.max(0, left))
    left -= shown.length
    return shown.length === 0 ? undefined : formatSection(hits, shown, terms, scan !== undefined)
  })

  const beyond =
    search.beyond.length === 0
      ? undefined
      : section(
          'Beyond the rows',
          'What the document says about its formats, the files it read and its settings — counted, not shown.\n\n' +
            table(
              ['Table', 'Column', 'Cells', scan === undefined ? 'Terms' : 'Denylist', 'About'],
              search.beyond.map((hit) => [hit.table, hit.column, count(hit.cells), hit.terms.join(', '), hit.formats.join(', ') || '—']),
            ),
        )

  // A term in the file's bytes and in no value it holds: a deleted or rewritten
  // value still in a file stored as SQLite bytes.
  const residue =
    raw === undefined ? [] : terms.filter((term) => !search.found.has(term.name) && term.holds(raw)).map((term) => term.name)
  const residueText =
    residue.length === 0
      ? undefined
      : `**In the file but in no value it holds: ${residue.join(', ')}.** A value deleted or rewritten in a document ` +
        'stored as SQLite bytes can stay in the file until SQLite reuses the space, and whoever is handed the file can read it there.'

  const missing = terms.filter((term) => !search.found.has(term.name) && !residue.includes(term.name))
  const head =
    rows === 0 && search.beyond.length === 0
      ? scan === undefined
        ? `Nothing in this document holds ${looked} — ${plural(formats, 'format')} and the rest of the file searched.`
        : `Clean: nothing in this document holds any of ${looked} — ${plural(formats, 'format')} and the rest of the file scanned.`
      : `${scan === undefined ? 'Searched for' : 'Scanned with'} ${looked}: ${plural(rows, 'row')} in ` +
        `${plural(search.formats.length, 'format')} hold ${scan === undefined ? 'them' : 'one'}` +
        `${search.beyond.length === 0 ? '' : `, and ${plural(search.beyond.reduce((sum, hit) => sum + hit.cells, 0), 'cell')} beyond the rows`}.` +
        (rows > HITS_SHOWN_MAX ? ` The first ${count(HITS_SHOWN_MAX)} rows are listed.` : '')
  const notFound =
    rows === 0 && search.beyond.length === 0
      ? undefined
      : missing.length === 0
        ? undefined
        : `Not found: ${missing.map((term) => (scan === undefined ? `“${term.name}”` : term.name)).join(', ')}.`

  return paragraphs(head, residueText, ...sections, beyond, notFound)
}

export const searchDocumentTool: PluginTool = {
  definition: {
    name: 'search_document',
    title: 'Search the whole document',
    description:
      'Every row of every format, and the rest of the file, that holds any of `terms`: each hit by format, row and ' +
      'column, columns searched as shown. One call where `format_rows`’ `search` is one a format. Or `denylist`, a ' +
      '`--replace-text` file: the scan before a document is shared — hits only, a term named by its line, and the ' +
      'file’s bytes checked for a deleted value. Reads only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        terms: {
          type: 'array',
          description: `Words or phrases, any case, up to ${String(TERMS_MAX)}.`,
          items: { type: 'string' },
        },
        denylist: stringProp('Instead of `terms`: a denylist’s absolute path, `literal==>x` or `regex:pattern==>x` a line.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const { terms, scan } = termsFrom(args)
    return readDocument(path, (document) => {
      const formats = listFormats(document.db)
      const search = searchDocument(document.db, terms, formats)
      const raw = scan === undefined ? undefined : readFileSync(path).toString('utf8')
      return answerText(search, terms, scan, raw, formats.length)
    })
  },
}
