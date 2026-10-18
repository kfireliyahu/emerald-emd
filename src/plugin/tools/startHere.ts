/**
 * `start_here` — **the first call of a session, answered by the document**
 * (M27 U5, D-303).
 *
 * `CLAUDE.md` kept a table of five questions a session asks first, each a
 * `format_rows` call somebody wrote down by hand. The questions belong to the
 * pack that declares the formats, so they moved there: a pack declares a
 * `ready` view (what can be started now) and `start` views (what is open, the
 * latest decisions), and this tool answers every one the document declares in
 * one round trip — round trips being the bill.
 *
 * **Shaped, never a general query** (D-095). It takes a path and nothing else:
 * what it asks is what the document's views say, each one a member of one enum
 * and a count over one format, and the caller cannot widen it. The full list of
 * any answer is the `format_rows` call printed under it.
 */

import { documentHasLedger } from '@/data/packs/ledger/pack.ts'
import { agendaData, START_CAP, startHere, startPicture, type ViewLine } from '@/data/repositories/formatLinkViewRepository.ts'
import { PACKS, packsKeptBy } from '@/data/packs/packs.ts'
import { changeMarks, listFormats, rowCountOf } from '@/data/repositories/formatRepository.ts'
import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { documentNameOf, parseElsewhere } from '@/domain/format/elsewhere.ts'
import { SHEET_URI } from '@/frame/contract.ts'

import { readDocument } from '../document.ts'
import { elsewhereLabels, elsewhereValues } from '../elsewhere.ts'
import { paragraphs, plural } from '../format.ts'
import { clockRange } from '@/domain/format/clock.ts'
import { dayText } from '@/domain/format/view.ts'

import { askedOn, cellText, compactDeclarations, lastChanged } from './formats.ts'
import { drawnLine, withView } from './sheet.ts'
import { PATH_PROP, requireString, type PluginTool } from './tool.ts'

/**
 * Where work that is not money begins (M34 U1). A ledger's views answer only
 * the ledger's questions, so a stranger with a list of books who called this
 * first was handed card settlements and nowhere to go.
 */
const BEGIN =
  'Work that is not money begins with `formats`, which says what this document holds; then ' +
  '`read_onto_format` for any .csv or .xlsx the user already keeps — not only a statement — or ' +
  '`declare_format` for a kind of thing it has no format for.'

/** How many of a document's own formats the untouched-longest line names. */
const UNTOUCHED_SHOWN = 3

/**
 * **The formats nobody has touched longest** (M47 U5, D-462) — of the ones a
 * document declares beyond its packs', since a pack's formats are the ones
 * every session writes. site.emd's `copy_slot` went stale with thirty rows and
 * nothing said so; this line is what says so. Unmarked first: a text document
 * written before there were marks cannot say when, and that is the longest
 * anybody could have left it.
 */
function untouchedText(db: Parameters<typeof changeMarks>[0], declared: readonly FormatDeclaration[]): string | undefined {
  const kept = packsKeptBy(db)
  const packs = new Set(PACKS.filter((pack) => kept.has(pack.id)).flatMap((pack) => [...pack.formats()]))
  const own = declared.filter((each) => each.owner === undefined && !packs.has(each.name))
  if (own.length === 0) return undefined
  const marks = changeMarks(db)
  const oldest = [...own]
    .sort((a, b) => (marks.get(a.name) ?? 0) - (marks.get(b.name) ?? 0) || (a.name < b.name ? -1 : 1))
    .slice(0, UNTOUCHED_SHOWN)
  return (
    '**Untouched longest:** ' +
    oldest
      .map((each) => `\`${each.name}\` · ${plural(rowCountOf(db, each), 'row')} · ${lastChanged(marks.get(each.name))}`)
      .join('; ') +
    '. Every format: `formats`.'
  )
}

/** How much of a column other than the name a line shows. */
const LINE_MAX = 120

/** One row on one line: its name, its line columns, and its state unless the question already says it. */
function lineText(line: ViewLine, labels: ReadonlyMap<string, string>, said: readonly ColumnDeclaration[]): string {
  const { name, state, lines } = line.shape
  const shown = [name, ...lines, ...(state === undefined || said.includes(state) ? [] : [state])]
  return shown
    .flatMap((column) => {
      if (column === undefined) return []
      const elsewhere = elsewhereLine(column, line.row, labels)
      if (elsewhere !== undefined) return [elsewhere]
      const text = cellText(column, line.row, labels).replace(/\s+/g, ' ')
      if (text === '-') return []
      // A line is a pointer, not the row: the name is whole and the rest is
      // cut, because this answer is read at the top of every session and the
      // whole row is one `format_rows` call away.
      return [column === name || text.length <= LINE_MAX ? text : `${text.slice(0, LINE_MAX - 1).trimEnd()}…`]
    })
    .join(' · ')
}

/** How far ahead `start_here` asks the agenda: a week, today and the seven days after it (D-472's `within 7 days`). */
const DUE_WITHIN = 7

/**
 * **What is due within 7 days, and what is overdue** (M49 U3, D-473) — asked
 * of the agenda, and only of the formats whose views chose their agenda date:
 * a format's first date by default may be when a thing happened, and this
 * answer is read at the top of every session. Nothing when no format chose one.
 */
function dueText(db: Parameters<typeof agendaData>[0], declared: Parameters<typeof agendaData>[1]): string | undefined {
  const today = askedOn()
  const data = agendaData(db, declared, today, {}, 'chosen')
  if (data.formats.length === 0) return undefined
  const until = clockRange({ kind: 'WITHIN', days: DUE_WITHIN }, today)?.through ?? today
  const lines = [
    ...data.overdue.map((line) => `- overdue ${dayText(line.date)} · ${line.format.name} · ${lineText(line, data.labels, [])}`),
    ...data.days
      .filter((day) => day.date <= until)
      .flatMap((day) =>
        day.rows.map((line) => `- ${dayText(day.date)}${day.date === today ? ' (today)' : ''} · ${line.format.name} · ${lineText(line, data.labels, [])}`),
      ),
  ]
  return paragraphs(
    `### Due within ${String(DUE_WITHIN)} days — ${data.formats.map(({ declaration, shape }) => `${declaration.name} by ${shape.date.name}`).join(', ')}`,
    lines.length === 0
      ? `Nothing is due within ${String(DUE_WITHIN)} days, and nothing is overdue.`
      : lines.length <= START_CAP
        ? lines.join('\n')
        : `${lines.slice(0, START_CAP).join('\n')}\n- and ${String(lines.length - START_CAP)} more`,
    `Whole agenda: \`show_format view:agenda\`.`,
  )
}

/**
 * A row elsewhere on a line, short and whole (M47 U4, D-461): the document's
 * file name and what its row holds now — `site.emd: unit S1 U5 · built`. The
 * path is in `format_rows`; what a line is for is the state, which a cut
 * at `LINE_MAX` would have taken first.
 */
function elsewhereLine(
  column: ColumnDeclaration,
  row: ViewLine['row'],
  labels: ReadonlyMap<string, string>,
): string | undefined {
  if (column.type !== 'elsewhere') return undefined
  const value = row.cells[column.name]
  if (typeof value !== 'string') return undefined
  const parsed = parseElsewhere(value)
  const read = labels.get(value)
  if (!parsed.ok || read === undefined) return value
  const document = documentNameOf(parsed.value.path)
  return read.startsWith('unresolved')
    ? `${document} ${parsed.value.name}: ${read}`
    : `${document}: ${read}`
}

export const startHereTool: PluginTool = {
  definition: {
    name: 'start_here',
    title: 'What to start from',
    description:
      'Call first. Answers the questions this document’s own views say a session starts from — ' +
      'what is ready to start, what is open, the latest entries — each with the `format_rows` call that ' +
      'lists it whole; then what a row of each format looks like, enough to write one; and where work ' +
      'that is not money begins: `formats`, then ' +
      '`read_onto_format` or `declare_format`. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { path: PATH_PROP },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    // **The first picture** (M41 U2): in a client that draws MCP Apps, the
    // answer is drawn too — the roadmaps the ready rows fold under, the open
    // milestone unfolded, then what is ready — the app's own views of a copy.
    _meta: { ui: { resourceUri: SHEET_URI } },
  },
  answer: async (args, context) => {
    const text = await startHereTool.run(args, context)
    const path = requireString(args, 'path')
    // A copy only when the views draw something; otherwise the text is all.
    const drawn = await readDocument(path, (document) => {
      const picture = startPicture(document.db, listFormats(document.db))
      return picture.roadmaps.length + picture.ready.length > 0 ? 'yes' : ''
    })
    // Whether it was drawn is said first (M51 F1, D-489), as `show_format` says it.
    return drawn === 'yes' ? withView(`${drawnLine(context.client)}

${text}`, path, '', 'start') : { text, meta: {} }
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    return readDocument(path, async (document) => {
      const declared = listFormats(document.db)
      const answers = startHere(document.db, declared)
      // **What a row elsewhere holds now** (M47 U4, D-461): an inbox row about
      // a unit in the sender's document is listed with that unit's state.
      const shown = answers.flatMap((answer) => [
        ...answer.lines,
        ...answer.held.flatMap((each) => [each.line, ...each.by]),
      ])
      const elsewhere = await elsewhereLabels(
        shown.flatMap((line) => elsewhereValues(line.format, [line.row])),
        path,
      )
      // What a row looks like, after the views (M47 U2, D-460): the first call
      // is then enough to write one.
      const shapes = compactDeclarations(declared)
      const due = dueText(document.db, declared)
      if (answers.length === 0 && due === undefined) {
        return paragraphs(
          'This document declares no start-here questions.',
          `${BEGIN} Ask for the file; the user will not think to offer it.`,
          'A format is given a start-here question by its views: `ready` on a format with a state and ' +
            'a link to its own rows, `start` on any format (`state: is open`, `date: latest 5`) — ' +
            '`arrange_views` sets them.',
          untouchedText(document.db, declared),
          shapes,
        )
      }
      const answered = answers
        .map((answer) => {
          const { question, declaration, lines, total, held, asked } = answer
          const labels = elsewhere.size === 0 ? answer.labels : new Map([...answer.labels, ...elsewhere])
          const heading =
            question.kind === 'ready' ? `### Ready to start — ${declaration.name}` : `### ${declaration.name} — ${question.what}`
          const body =
            lines.length === 0
              ? question.kind === 'ready'
                ? 'Nothing is ready to start.'
                : 'None.'
              : lines.map((line) => `- ${lineText(line, labels, asked)}`).join('\n')
          const waiting =
            held.length === 0
              ? undefined
              : [
                  'Held:',
                  ...held.map(
                    (each) =>
                      `- ${lineText(each.line, labels, asked)} — waits on ${each.by
                        .map((by) => lineText(by, labels, []))
                        .join(', ')}`,
                  ),
                ].join('\n')
          const whole =
            question.call === undefined
              ? undefined
              : `${total > lines.length ? `${plural(total, 'row')} in all. ` : ''}Whole list: \`${question.call}\`.`
          return paragraphs(
            heading,
            question.kind === 'ready' ? `_${question.what}._` : undefined,
            body,
            waiting,
            whole,
          )
        })
        .join('\n\n')
      return paragraphs(
        answered === '' ? undefined : answered,
        due,
        documentHasLedger(document.db) ? BEGIN : undefined,
        untouchedText(document.db, declared),
        shapes,
      )
    })
  },
}
