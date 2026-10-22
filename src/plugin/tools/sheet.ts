/**
 * **`show_format`: a format's rows, drawn in the conversation** (M41 U1).
 *
 * An MCP App (SEP-1865): the definition names `ui://emerald/sheet.html`, a
 * page the server serves, and a client that draws MCP Apps draws it in a
 * sandboxed frame beside this result. The page is the app's own format page —
 * `FormatRows` and its `RowSheet` — opening a copy of the document with the
 * store's own `openBytes` on the same engine, so nothing about a row is
 * re-implemented for the frame. `view` opens it on the board, roadmap or ready
 * list instead of the sheet.
 *
 * **`match` and `search` draw only the rows asked for** (M44 U6): read by
 * `filterArgs`, the very reading `format_rows` makes of them, into the
 * `RowQuery` `listRows` answers — there is no second filter. The frame opens
 * on the format's address with the filter in it (`addressFilter.ts`), where
 * the app's own views read it back the same way, say that they are filtered
 * and keep it when the file changes and the view is drawn again.
 *
 * **No result carries the copy** (M41 F2, D-446): the page fetches it through
 * the host with `frame_copy`, presenting the key the server wrote into the
 * page (M41 F3, D-447) for the path the call's input named. And
 * **the text names every row the view shows and nothing longer**, because the
 * model reads only the text in every client, and the person has the view.
 *
 * A read: it opens the file to answer, and writes nothing, so it is no new
 * capability for `parity.test.ts` (D-227, D-234).
 *
 * **`columns` is which columns a format's lines draw** (M37 U5, D-478) —
 * `columns:{unit:[title,state]}` — the choice the roadmap's, the board's and
 * the ready list's *Columns* writes into the address, and a roadmap's `match`
 * holds its folded rows by `unit.state`, as the address does.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'

import type { Database } from 'sql.js'

import { filterText, heldAs, isFiltered, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { foldFilter as foldHeld, isFoldKey, type ColumnChoice } from '@/ui/formats/addressFilter.ts'
import { listOrder, listPicture, type ListLine } from '@/ui/formats/listView.ts'
import {
  agendaData,
  AGENDA_DATE,
  formatViews,
  readyData,
  roadmapAbove,
  roadmapData,
  type RoadmapAbove,
  type ViewLine,
} from '@/data/repositories/formatLinkViewRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { countRows, linkLabels, listRows, type RowQuery } from '@/data/repositories/formatRowRepository.ts'
import { boardSettings, viewSettings } from '@/data/repositories/formatViewRepository.ts'
import { labelColumn, type ColumnDeclaration, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { StoredRow } from '@/domain/format/row.ts'
import { boardOf, dayText } from '@/domain/format/view.ts'
import {
  COPY_TOOL,
  KEY_META,
  NOT_THIS_VIEW,
  SHEET_META,
  SHEET_URI,
  type CopyPayload,
  type FrameView,
  type SheetPayload,
} from '@/frame/contract.ts'

import { readDocument } from '../document.ts'
import { plural } from '../format.ts'
import { documentUri } from '../subscriptions.ts'
import { markOf } from '../watch.ts'
import { askedOn, cellText, filterArgs, formatRowsTool, MATCH_PROP, SEARCH_PROP } from './formats.ts'
import {
  optionalString,
  PATH_PROP,
  requireString,
  stringProp,
  ToolInputError,
  type PluginTool,
  type ToolAnswer,
  type ToolContext,
} from './tool.ts'

/** The views a tool may open the frame on, as `show_format` names them. */
const VIEWS = ['sheet', 'board', 'list', 'roadmap', 'ready', 'agenda'] as const
type SheetView = (typeof VIEWS)[number]

/**
 * **What a model calls each view** (M43 U3, D-451): the table is `table`, as
 * the app's view picker says it; `sheet` stays the code's word, and is still
 * taken from a model that says it.
 */
const SAID: Record<SheetView, string> = {
  sheet: 'table',
  board: 'board',
  list: 'list',
  roadmap: 'roadmap',
  ready: 'ready',
  agenda: 'agenda',
}
const saidOf = (view: string): string => SAID[view as SheetView] ?? view

/** How the read below tells its answer from a refusal's sentence. */
const VIEWS_SAID = 'views:'

/**
 * How many rows the text names before it says how many more (M41 F2). High:
 * a view the person sees whole is not named to the model cut at 25, but a
 * format of twenty thousand rows is not a sentence either.
 */
const NAMED_CAP = 500

export const showFormatTool: PluginTool = {
  definition: {
    name: 'show_format',
    title: 'A declared format’s rows, drawn as the app draws them',
    description:
      'Shows the person one declared format as the app draws it — its table, its list (one line per row, a tick, ' +
      'grouped as `arrange_views view:list` says), or its board, roadmap or ready-to-start list when the format has one; ' +
      'or the agenda, every dated format’s rows from today — ' +
      'in the conversation, in a client that draws MCP Apps; the answer’s first line says whether this client said it draws them. ' +
      'Call it when they ask to see a format, or some of its rows: `match` and `search` filter exactly ' +
      'as `format_rows` does, and the view draws only those rows and says it is filtered. The text ' +
      'answer names every row the view shows, with its state or lane. The page is a read-only copy, ' +
      'drawn again as the file changes. Reads the file; never modifies it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name. `formats` lists them. The agenda takes none.'),
        view: {
          type: 'string',
          enum: VIEWS.map(saidOf),
          description: 'Which of the format’s views to open on. Defaults to the table.',
        },
        match: MATCH_PROP,
        search: SEARCH_PROP,
        columns: {
          type: 'object',
          description: 'Columns its lines draw, by format: `{unit:[title,state]}`. A roadmap’s `match` takes `unit.state`.',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: SHEET_URI } },
  },
  run: async (args) => (await sheetAnswer(args)).text,
  answer: async (args, context) => {
    const { text, drawn } = await sheetAnswer(args)
    if (drawn === undefined) return { text, meta: {} }
    const said = `${drawnLine(context.client)}

${text}`
    return withView(said, requireString(args, 'path'), drawn.format, drawn.view, drawn.filter, drawn.columns)
  },
}

/**
 * What every line meant for the model opens with (M51 F3, D-493): a drawing
 * tool's first line, and the `SessionStart` hook's. Text a model is told, never
 * text to pass on.
 */
export const FOR_THE_MODEL = '**For you, never the person — do not repeat or paraphrase this line.**'

/**
 * **Whether anything was drawn, said first** (M51 F1, D-489). A model cannot
 * see the person's screen, and on 2026-10-18 one told the person the ready
 * list was "drawn above" when nothing was. The server cannot see the screen
 * either, so this says only what it knows: what the client declared at
 * `initialize`. Measured on one machine, 2026-10-08 to 10-18: the
 * Claude desktop app's Code tab mounted a frame for nearly every call to the
 * server the app runs itself and for none of 28 calls to the one a project's
 * `.mcp.json` starts — and the claude CLI advertises MCP Apps to the latter
 * only when it is told to host them (docs/plugin.md's host table). Which host
 * does what is the docs'; the line reads only what the client declared, so
 * the server stays host-neutral (M42 U6).
 *
 * **And it is the model's, never the person's** (M51 F3, D-493). Worded as a
 * disclaimer, it was relayed as one: after F2 the board was drawn and the
 * session still told the person which server it had called and that it could
 * not check whether a view appeared. So the line is an instruction: where the
 * client draws, say nothing of drawing, never retype the view's rows (the
 * same day: drawn, the session still gave the details as text),
 * and add at most a line it does not show; where it does not, the rows are
 * the answer, with no word about why. The rows stay in the text either way:
 * the model reasons over them, and a client that draws nothing needs them.
 * Saying nothing about drawing is also how a model never claims a view that
 * was not drawn.
 */
export function drawnLine(client: ToolContext['client']): string {
  const unsaid = 'say nothing to the person about drawing, views, servers or tools'
  if (client?.saysItDraws === true) {
    return (
      `${FOR_THE_MODEL} This client draws, so the view sits beside your answer and is the answer: ${unsaid}, ` +
      'and never retype what it shows — no list or table of these rows. Reply with at most a line that adds ' +
      'what the view does not show, or nothing. The rows below are for you to reason over, not to repeat.'
    )
  }
  const known =
    client === undefined
      ? 'Whether a view is drawn here is unknown, so answer'
      : 'This client did not say it draws. If this session has this tool on a server you have not called it on, call it there ' +
        'instead; otherwise answer'
  return (
    `${FOR_THE_MODEL} ${known} with the rows below as text: ${unsaid}, and never call anything drawn or ` +
    'above — at most, if they asked to see a board, one plain sentence that it is shown here as a list.'
  )
}

/**
 * The `columns` a call asked for, checked against the document (M37 U5): each
 * key a format it declares, each value columns that format has.
 */
function askedColumns(args: Record<string, unknown>, declarations: readonly FormatDeclaration[]): ColumnChoice {
  const raw = args['columns']
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolInputError('`columns` is an object of format name to the columns its lines draw: `{unit:[title,state]}`.')
  }
  const choice: Record<string, readonly string[]> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const format = declarations.find((each) => each.name === name)
    if (format === undefined) throw new ToolInputError(`\`columns\` names ${name}, which this document does not declare.`)
    const list = Array.isArray(value) ? value : [value]
    const missing = list.filter((each) => typeof each !== 'string' || !format.columns.some((column) => column.name === each))
    if (missing.length > 0) {
      throw new ToolInputError(
        `\`columns.${name}\` names ${missing.map(String).join(', ')}, which ${name} has not got. It has ${format.columns.map((one) => one.name).join(', ')}.`,
      )
    }
    choice[name] = list as string[]
  }
  return choice
}

/** A roadmap's `match` split: its own columns, and `unit.state` for the rows it folds (M37 U5). */
function splitFolds(args: Record<string, unknown>): { own: Record<string, unknown>; folds: Readonly<Record<string, unknown>> } {
  const raw = args['match']
  const match = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    own: { ...args, ...(raw === undefined ? {} : { match: Object.fromEntries(Object.entries(match).filter(([key]) => !isFoldKey(key))) }) },
    folds: Object.fromEntries(Object.entries(match).filter(([key]) => isFoldKey(key))),
  }
}

/** The filter a call asked for, as it asked — checked by `filterArgs` before anything is drawn. */
function askedFilter(args: Record<string, unknown>): RowFilter {
  const match = args['match']
  const search = optionalString(args, 'search')
  return {
    ...(match === undefined || match === null || typeof match !== 'object' ? {} : { match: match as Record<string, unknown> }),
    ...(search === undefined || search.trim() === '' ? {} : { search }),
  }
}

/**
 * The text, and what the page draws — or the text alone when the document was
 * refused or declares no such format: then it is `format_rows`' own sentence,
 * and a page drawn over it would say less.
 */
async function sheetAnswer(
  args: Record<string, unknown>,
): Promise<{ text: string; drawn?: { format: string; view: SheetView; filter: RowFilter; columns: ColumnChoice } }> {
  const path = requireString(args, 'path')
  const asked = optionalString(args, 'view') ?? 'table'
  const view = asked === 'table' ? 'sheet' : asked
  if (!(VIEWS as readonly string[]).includes(view)) {
    throw new ToolInputError(`\`view\` is one of ${VIEWS.map(saidOf).join(', ')}; got ${asked}.`)
  }
  if (view === 'agenda') {
    const filter = askedFilter(args)
    const text = await readDocument(path, (document) => agendaText(document.db, filter))
    return { text, drawn: { format: '', view: 'agenda', filter, columns: {} } }
  }
  const format = requireString(args, 'format')
  // Set when the roadmap drawn is the one this format's rows fold under.
  let drawnIn: { format: string; filter: RowFilter } | undefined
  let columns: ColumnChoice = {}
  const read = await readDocument(path, (document) => {
    const declarations = listFormats(document.db)
    columns = askedColumns(args, declarations)
    const declaration = declarations.find((each) => each.name === format)
    if (declaration === undefined) return ''
    const has = formatViews(document.db, declaration, declarations)
    const said = `${VIEWS_SAID}${has.join(' ')}\n`
    if (!(has as readonly string[]).includes(view)) {
      const above = view === 'roadmap' ? roadmapAbove(document.db, declaration, declarations) : undefined
      if (above === undefined) return said
      const filter = foldFilter(format, above, has, args)
      const { query } = filterArgs(document.db, above.format, { ...filter }, declarations)
      drawnIn = { format: above.format.name, filter }
      return (
        `${VIEWS_SAID}roadmap\n${format} has no roadmap of its own: its rows fold under ${above.format.name}'s, so this is that one.\n\n` +
        viewText(document.db, above.format, declarations, 'roadmap', { filter, query, columns }, format)
      )
    }
    if (view !== 'roadmap') {
      const { filter, query } = filterArgs(document.db, declaration, args, declarations)
      return said + viewText(document.db, declaration, declarations, view as SheetView, { filter, query, columns })
    }
    const { own, folds } = splitFolds(args)
    const { filter, query } = filterArgs(document.db, declaration, own, declarations)
    const held = new Map<string, RowQuery>()
    for (const key of Object.keys(folds)) {
      const name = key.slice(0, key.indexOf('.'))
      const folded = declarations.find((each) => each.name === name)
      if (folded === undefined) throw new ToolInputError(`\`match\` names ${key}, and this document declares no ${name}.`)
      if (!held.has(name)) held.set(name, filterArgs(document.db, folded, { match: foldHeld(folds, name).match }, declarations).query)
    }
    return said + viewText(document.db, declaration, declarations, 'roadmap', { filter, query, columns, folds, held })
  })
  if (!read.startsWith(VIEWS_SAID)) return { text: await formatRowsTool.run({ path, format }, {}) }
  const newline = read.indexOf('\n')
  const has = read.slice(VIEWS_SAID.length, newline).split(' ')
  if (!has.includes(view)) throw new ToolInputError(`${format} has no ${asked}. Its views: ${has.map(saidOf).join(', ')}.`)
  return {
    text: read.slice(newline + 1),
    drawn: { format: drawnIn?.format ?? format, view: view as SheetView, filter: drawnIn?.filter ?? askedFilter(args), columns },
  }
}

/**
 * **A roadmap of rows that fold under another's** (M47 U7): `show_format unit
 * view:roadmap match:{milestone:M9}` draws the milestone roadmap at M9 with its
 * units named. Only the folding link carries over — it is the lane — so any
 * other filter is refused with the call that draws one.
 */
function foldFilter(format: string, above: RoadmapAbove, has: readonly string[], args: Record<string, unknown>): RowFilter {
  const raw = args['match']
  const match = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const lane = match[above.through.name]
  const keyed = above.name?.name
  if (
    keyed === undefined ||
    (optionalString(args, 'search') ?? '').trim() !== '' ||
    Object.keys(match).some((name) => name !== above.through.name) ||
    (lane !== undefined && typeof lane !== 'string')
  ) {
    throw new ToolInputError(
      `${format} has no roadmap of its own: its rows fold under ${above.format.name}'s, a lane each, so only ` +
        `\`match:{${above.through.name}:…}\` carries over. \`show_format ${above.format.name} view:roadmap ` +
        `match:{${keyed ?? 'id'}:…}\` draws one lane; ${format}'s own views: ${has.map(saidOf).join(', ')}.`,
    )
  }
  return lane === undefined ? {} : { match: { [keyed]: lane } }
}

/**
 * **The text a model reads beside a drawn view** (M41 F2): every row the view
 * shows, by its name and its state — by its lane, on a board — and nothing
 * longer. It was `format_rows`' whole answer, which for `docs/memory.emd`'s
 * milestone roadmap was 14.9 KB and cut at 25 rows while the page drew 27; a
 * host saved it to a file rather than read it. The person sees the view; the
 * model needs to know what is in it, and where the rest is.
 */
function viewText(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  view: SheetView,
  {
    filter,
    query,
    columns = {},
    folds = {},
    held = new Map(),
  }: {
    readonly filter: RowFilter
    readonly query: RowQuery
    readonly columns?: ColumnChoice
    /** What a roadmap's folded rows are held to, as asked and as read (M37 U5). */
    readonly folds?: Readonly<Record<string, unknown>>
    readonly held?: ReadonlyMap<string, RowQuery>
  },
  /** A folded format whose rows are named one a line rather than counted (M47 U7). */
  naming?: string,
): string {
  const format = declaration.name
  const filtered = isFiltered(filter)
  const asked = filtered ? callFilter(filter) : ''
  const whole = (call: string): string => `Every column of these rows is one call away: \`${call}${asked}\`.`
  // **What the view is filtered by, and how many of how many** (M44 U6): the
  // model reads that the person sees part of the format, and which part.
  const by = filtered
    ? `Filtered by ${filterText(filter)}: ${String(countRows(db, declaration, query))} of ${plural(countRows(db, declaration), 'row')}.`
    : undefined
  const none = filtered ? 'No rows match.' : 'No rows yet.'
  // Which columns a format's lines draw, when the call chose (M37 U5).
  const drawing = Object.entries(columns).map(
    ([name, list]) => `Each ${name} line draws ${list.length === 0 ? 'its name alone' : `its name and ${list.join(', ')}`}.`,
  )

  if (view === 'roadmap') {
    const data = roadmapData(db, declaration, declarations, query, held)
    if (data !== undefined) {
      const lines = data.rows.map(({ line, folds }) => {
        const under = folds
          .filter((fold) => fold.total > 0)
          .map((fold) =>
            fold.lines.length === 0
              ? `${fold.fold.format.name}: 0 of ${String(fold.total)} shown`
              : `${fold.fold.format.name}: ${tally(fold.lines, data.labels)}` +
                (fold.total > fold.lines.length ? ` (${String(fold.lines.length)} of ${String(fold.total)} shown)` : ''),
          )
        const head = `- ${[lineName(line, data.labels), stateOf(line, data.labels), ...under].filter((part) => part !== '').join(' · ')}`
        const listed = folds
          .filter((fold) => fold.fold.format.name === naming)
          .flatMap((fold) => fold.lines)
          .map((each) => `  - ${[lineName(each, data.labels), stateOf(each, data.labels)].filter((part) => part !== '').join(' · ')}`)
        return [head, ...listed].join('\n')
      })
      const loose = data.loose.map(
        (fold) => `Under no ${format}: ${fold.fold.format.name} ${named(fold.lines.map((each) => lineName(each, data.labels)))}.`,
      )
      return [
        `${format} as its roadmap — ${plural(data.rows.length, 'row')} in ${data.shape.order.name} order, each with what folds under it.`,
        ...(by === undefined ? [] : [by]),
        ...(Object.keys(folds).length === 0 ? [] : [`The rows folded under each are filtered by ${filterText({ match: folds })}.`]),
        ...drawing,
        lines.length === 0 ? none : capped(lines),
        ...loose,
        whole(`format_rows ${format} order:${data.shape.order.name}`),
      ].join('\n\n')
    }
  }

  if (view === 'ready') {
    const data = readyData(db, declaration, declarations, query)
    if (data !== undefined) {
      const ready = data.ready.map((line) => lineName(line, data.labels))
      const held = data.held.map(
        (each) => `${lineName(each.line, data.labels)} (waits on ${each.by.map((by) => lineName(by, data.labels)).join(', ')})`,
      )
      return [
        `${format} as its ready-to-start list — ${String(ready.length)} ready, ${String(held.length)} held.`,
        ...(by === undefined ? [] : [by]),
        ...drawing,
        `Ready to start: ${ready.length === 0 ? 'none' : named(ready)}.`,
        ...(held.length === 0 ? [] : [`Held: ${named(held)}.`]),
        whole(`format_rows ${format}`),
      ].join('\n\n')
    }
  }

  if (view === 'list') {
    // **The list** (M53 U4, D-519): its groups in order, each row with its tick.
    const picture = listPicture(db, declaration, declarations, query, viewSettings(db, declaration.name, 'list'), askedOn())
    const { shape } = picture
    const said = (line: ListLine): string => (line.ticked ? `${line.title} (done)` : line.title)
    const grouped = picture.groups.flatMap((group) => {
      const lines = group.ticked ? group.rows : [...group.rows.filter((line) => !line.ticked), ...group.rows.filter((line) => line.ticked)]
      if (lines.length === 0) return []
      return shape.group === undefined ? [capped(lines.map((line) => `- ${said(line)}`))] : [`- ${group.name} (${String(lines.length)}): ${named(lines.map(said))}`]
    })
    const ticks =
      shape.done === undefined
        ? 'Nothing ticks a row: it has no enum and no yes/no.'
        : `A row is ticked when ${shape.done.column.name} is ${shape.done.members.join(' or ')}.`
    return [
      `${format} as its list — ${plural(listOrder(picture).length, 'row')}` +
        (shape.group === undefined ? ', one line each.' : `, grouped by ${shape.group.name}.`),
      ...(by === undefined ? [] : [by]),
      ticks + (shape.shown.length === 0 ? '' : ` Each line shows ${shape.shown.map((column) => column.name).join(', ')}.`),
      ...(grouped.length === 0 ? [none] : [grouped.join('\n')]),
      whole(`format_rows ${format}`),
    ].join('\n\n')
  }

  const name = labelColumn(declaration)
  const rows = listRows(db, declaration, name === undefined ? query : { ...query, order: name.name })
  const labels = linkLabels(db, rows, declaration, declarations)
  const nameOf = (row: StoredRow): string => (name === undefined ? row.id : textOf(name, row, labels) || row.id)

  if (view === 'board') {
    const lanes = boardOf(declaration.columns, boardSettings(db, declaration.name))?.lanes
    if (lanes !== undefined) {
      const members: readonly (string | undefined)[] = [...(lanes.values ?? []), undefined]
      const grouped = members.flatMap((member) => {
        const inLane = rows.filter((row) => (textOf(lanes, row, labels) || undefined) === member)
        return inLane.length === 0 ? [] : [`- ${member ?? `no ${lanes.name}`} (${String(inLane.length)}): ${named(inLane.map(nameOf))}`]
      })
      return [
        `${format} as its board — ${plural(rows.length, 'row')} in lanes by ${lanes.name}.`,
        ...(by === undefined ? [] : [by]),
        ...drawing,
        ...(grouped.length === 0 ? [none] : [grouped.join('\n')]),
        whole(`format_rows ${format}`),
      ].join('\n\n')
    }
  }

  const state = declaration.columns.find((column) => column.type === 'enum')
  const listed = rows.map((row) => {
    const said = state === undefined ? '' : textOf(state, row, labels)
    return `- ${said === '' ? nameOf(row) : `${nameOf(row)} · ${said}`}`
  })
  return [
    `${format} as its sheet — ${plural(rows.length, 'row')}${state === undefined ? '' : `, each with its ${state.name}`}.`,
    ...(by === undefined ? [] : [by]),
    listed.length === 0 ? none : capped(listed),
    whole(`format_rows ${format}`),
  ].join('\n\n')
}

/**
 * **The agenda, as text** (M49 U3, D-473): each day from today with the rows
 * on it — format, name, state — and above today what is overdue. The same
 * `agendaData` the screen draws, on the plugin's clock, and under it the
 * `format_rows` call per format that lists the same rows whole.
 */
function agendaText(db: Database, filter: RowFilter): string {
  const declarations = listFormats(db)
  const today = askedOn()
  const data = agendaData(db, declarations, today, filter)
  if (data.formats.length === 0 && data.left.length === 0) {
    return 'The agenda is empty: no format here has a date column. A format with a date is on it from today, by its first date or the one `arrange_views view:agenda setting:date` chooses.'
  }
  const lineOf = (line: (typeof data.overdue)[number]): string =>
    `- ${[line.format.name, lineName(line, data.labels), stateOf(line, data.labels)].filter((part) => part !== '').join(' · ')}`
  const said: string[] = []
  if (data.overdue.length > 0) {
    said.push(`Overdue (${String(data.overdue.length)}):\n${data.overdue.map((line) => `${lineOf(line).slice(0, 2)}${dayText(line.date)} · ${lineOf(line).slice(2)}`).join('\n')}`)
  }
  for (const day of data.days) {
    const when = day.date === today ? ' — today' : ''
    said.push(`${dayText(day.date)}${when} (${String(day.rows.length)}):\n${day.rows.map(lineOf).join('\n')}`)
  }
  const more = data.formats.filter((each) => each.more > 0).map((each) => `${each.declaration.name} has ${String(each.more)} more after these`)
  const held = isFiltered(filter) ? callFilter(filter) : ''
  const calls = data.formats.map(({ declaration, shape }) => `\`format_rows ${declaration.name}${held.replaceAll(`${AGENDA_DATE}:`, `${shape.date.name}:`)} order:${shape.date.name}\``)
  return [
    `The agenda on ${dayText(today)} — ${data.formats.map(({ declaration, shape }) => `${declaration.name} by ${shape.date.name}`).join(', ') || 'no format'}, from today on` +
      (data.formats.some((each) => each.shape.done !== undefined) ? ', and what is overdue above it.' : '.'),
    ...(isFiltered(filter) ? [`Filtered by ${filterText(filter)}; on the agenda \`${AGENDA_DATE}\` is each format’s own date.`] : []),
    ...(data.left.length === 0 ? [] : [`Left off: ${data.left.map((each) => each.reason).join(' ')}`]),
    said.length === 0 ? (isFiltered(filter) ? 'Nothing on the agenda matches.' : 'Nothing on the agenda from today on.') : capped(said.join('\n\n').split('\n')),
    ...(more.length === 0 ? [] : [`${more.join('; ')}.`]),
    ...(calls.length === 0 ? [] : [`Every column of these rows is one call away: ${calls.join(', ')}.`]),
  ].join('\n\n')
}

/** A filter as the arguments of the `format_rows` call that reads the same rows: ` match:{state:open} search:"bidi"`. */
function callFilter(filter: RowFilter): string {
  const held = Object.entries(filter.match ?? {}).map(([name, value]) => {
    const { values, not } = heldAs(value)
    const said = values.map((each) => (each === null || each === undefined || each === '' ? 'null' : String(each)))
    const one = said.length === 1 ? (said[0] ?? 'null') : `[${said.join(', ')}]`
    return `${name}:${not ? `{not:${one}}` : one}`
  })
  const search = filter.search?.trim() ?? ''
  return `${held.length === 0 ? '' : ` match:{${held.join(', ')}}`}${search === '' ? '' : ` search:${JSON.stringify(search)}`}`
}

/** Names in a sentence, up to the cap. */
function named(names: readonly string[]): string {
  return names.length <= NAMED_CAP
    ? names.join(', ')
    : `${names.slice(0, NAMED_CAP).join(', ')} and ${String(names.length - NAMED_CAP)} more`
}

/** Lines, up to the cap. */
function capped(lines: readonly string[]): string {
  return lines.length <= NAMED_CAP
    ? lines.join('\n')
    : `${lines.slice(0, NAMED_CAP).join('\n')}\n- and ${String(lines.length - NAMED_CAP)} more`
}

/** A column as one line of text, or empty when the row holds nothing there. */
function textOf(column: ColumnDeclaration, row: StoredRow, labels: ReadonlyMap<string, string>): string {
  const text = cellText(column, row, labels)
  return text === '-' ? '' : text.replace(/\s+/g, ' ')
}

function lineName(line: ViewLine, labels: ReadonlyMap<string, string>): string {
  const name = line.shape.name
  return (name === undefined ? '' : textOf(name, line.row, labels)) || line.row.id
}

function stateOf(line: ViewLine, labels: ReadonlyMap<string, string>): string {
  return line.shape.state === undefined ? '' : textOf(line.shape.state, line.row, labels)
}

/** How many rows fold under one, by state: `10 built, 2 planned`, or `3 rows` when they have none. */
function tally(lines: readonly ViewLine[], labels: ReadonlyMap<string, string>): string {
  const counts = new Map<string, number>()
  let stateless = 0
  for (const line of lines) {
    const state = stateOf(line, labels)
    if (state === '') stateless++
    else counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  const parts = [...counts].map(([state, count]) => `${String(count)} ${state}`)
  if (parts.length === 0) return plural(lines.length, 'row')
  return [...parts, ...(stateless === 0 ? [] : [`${String(stateless)} with none`])].join(', ')
}

/**
 * **Which document and view the page draws, and no copy of it** (M41 F2,
 * D-446) — and no proof either (M41 F3, D-447).
 *
 * VS Code hands a drawn view the result without its `_meta`, so the frame
 * takes what to draw from the call's input, which it does pass, and reads this
 * only where a host passed no input. The proof that the caller is the drawn
 * view is in the page (`servedPage`), which a model is never handed.
 */
export function withView(
  text: string,
  path: string,
  format: string,
  view: FrameView,
  filter: RowFilter = {},
  columns: ColumnChoice = {},
): ToolAnswer {
  const sheet: SheetPayload = {
    name: basename(path),
    format,
    view,
    path,
    uri: documentUri(path),
    ...(filter.match === undefined ? {} : { match: filter.match }),
    ...(filter.search === undefined ? {} : { search: filter.search }),
    ...(Object.keys(columns).length === 0 ? {} : { columns }),
  }
  return { text, meta: { [SHEET_META]: sheet } }
}

/**
 * **This process's key**, made when it starts and written nowhere but into the
 * page it serves (M41 F3, D-447). A page a host kept from before a restart
 * carries the old one and is refused, and says so, rather than the server
 * keeping a key on disk to remember it by (D-115).
 *
 * **The key itself, not a signature over the path.** What it keeps out is a
 * model pulling a megabyte into its own context, not an adversary: the page
 * is read with `resources/read`, which no host puts in a model's context, and
 * a frame's own `tools/call` is not shown to a model either. A signature would
 * need `crypto.subtle` in the frame, which only a secure context has — and a
 * sandboxed `srcdoc` frame need not be one — so it could fail in exactly the
 * host this cannot be tried in, to guard against a leak that would hand over
 * nothing a model could not already ask `format_rows` for.
 */
const KEY = randomBytes(32).toString('base64url')

/**
 * **The page as served: the frame, with this process's key in it** (M41 F3).
 * Written as a `<meta>` just inside `<head>`, where the frame reads it.
 */
export function servedPage(page: string): string {
  const tag = `<meta name="${KEY_META}" content="${KEY}" />`
  const head = /<head(\s[^>]*)?>/i.exec(page)
  if (head !== null) return page.slice(0, head.index + head[0].length) + tag + page.slice(head.index + head[0].length)
  const doctype = /^<!doctype html>/i.exec(page)
  return doctype === null ? tag + page : doctype[0] + tag + page.slice(doctype[0].length)
}

function keyHolds(key: string | undefined): boolean {
  if (key === undefined) return false
  const expected = Buffer.from(KEY)
  const given = Buffer.from(key)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * The file's bytes and the mark they were read under. Marked before and
 * after: a save landing mid-read is read again, and a file still moving after
 * three tries is handed over with no stamp, so the frame's next check fetches
 * it again rather than believing a copy that may be torn.
 */
async function stampedRead(path: string): Promise<{ bytes: Buffer; stamp: string }> {
  let bytes = await readFile(path)
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await markOf(path)
    bytes = await readFile(path)
    const after = await markOf(path)
    if (before !== undefined && before === after) return { bytes, stamp: after }
  }
  return { bytes, stamp: '' }
}

/** What `frame_copy` says to a caller without this process's key — a model, or a page from before a restart. */
export const NO_KEY =
  `${NOT_THIS_VIEW}, by the server that drew it, while it runs. ` +
  'To read this document’s rows, call format_rows; to show them, show_format.'

/**
 * **`frame_copy`: the frame's own call, and never the model's** (M44 U4,
 * D-442; M41 F2, D-446). How a drawn view gets its document — first when it is
 * drawn, and again when the file changes. Asked with `since`, the stamp of the
 * copy it holds, it answers with the stamp alone while the file has not moved.
 *
 * **Listed to every client and guarded by a key** (D-446, D-447). It was
 * listed only to a client advertising MCP Apps; a host that draws without
 * saying so would then refuse the page's call to a tool it was never shown. So
 * it is listed to all, `_meta.ui.visibility: ["app"]` keeps it from the model
 * in a host that reads visibility, and in one that does not — the claude CLI —
 * a model calling it is refused: the copy goes only to a caller holding the
 * key the server wrote into the page it served (M41 F3; until then a ticket in
 * the result's `_meta`, which VS Code does not pass a view). The answer rides
 * in `structuredContent`, for the same reason. A read: no capability for
 * `parity.test.ts`.
 */
export const frameCopyTool: PluginTool = {
  definition: {
    name: COPY_TOOL,
    title: 'The document, for a view drawn in the conversation',
    description:
      'Not for a model: a view drawn in the conversation calls it with its own key to fetch its ' +
      'document, and any other call is refused. Read rows with `format_rows`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        key: stringProp('The drawn view’s own key.'),
        since: stringProp('The stamp of the copy the view holds; no copy comes back while it still holds.'),
      },
      required: ['path', 'key'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } },
  },
  run: async (args) => (await frameCopyTool.answer?.(args, {}))?.text ?? '',
  answer: async (args) => {
    const path = requireString(args, 'path')
    if (!keyHolds(optionalString(args, 'key'))) throw new ToolInputError(NO_KEY)
    return frameCopy(path, optionalString(args, 'since'))
  },
}

async function frameCopy(path: string, since: string | undefined): Promise<ToolAnswer> {
  if (!isAbsolute(path)) throw new ToolInputError(`\`path\` is an absolute path; got ${path}.`)
  const now = await markOf(path)
  if (now === undefined) throw new ToolInputError(`No document at ${path}.`)
  const named = { name: basename(path), uri: documentUri(path) }
  if (since !== undefined && since !== '' && since === now) {
    const copy: CopyPayload = { stamp: now, ...named }
    return { text: `${basename(path)} has not changed.`, meta: {}, structured: { ...copy } }
  }
  const { bytes, stamp } = await stampedRead(path)
  const copy: CopyPayload = { stamp, ...named, bytes: bytes.toString('base64') }
  return { text: `A copy of ${basename(path)}, ${String(Math.round(bytes.length / 1024))} KB.`, meta: {}, structured: { ...copy } }
}
