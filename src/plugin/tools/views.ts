/**
 * **`arrange_views`: a conversation arranges how a format is shown** — M35 U4,
 * D-403.
 *
 * D-289, D-294 and D-301 refused this on one reason: *a conversation draws no
 * page*. The reason stopped being true. The person a conversation works for is
 * on the other side of it, looking at the page — *show the steps as markdown
 * and kcal as a bar* — and a pack made in a conversation (M32) needs its views
 * set the way its formats were declared. So the settings the screens write are
 * written here too, through the same repository functions, and `formats` with a
 * `format` reads them back first.
 *
 * **They stay engine view settings** (`format_view_column`, `format_column_view`)
 * and not a declared format: rows of a "view" format would be the one built-in
 * thing carrying the `fmt_` prefix, which is what keeps *the engine touches
 * none of a pack* a grep (D-216).
 *
 * **And every kind a pack declares since M48 U3**: a roadmap's order, folds
 * and lines, a ready list's enum and waits, a start view's question — each a
 * column's `setting`, the word a pack's `views.md` writes. Until then a
 * document made in a conversation could not be given a start-here question at
 * all, and the screen could not either.
 */

import type { Database } from 'sql.js'

import { capitalize } from '@/core/text.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import {
  boardSettings,
  columnWidths,
  entryAsked,
  entryHeaders,
  entryHidden,
  entryInputs,
  entryPlaces,
  setBoardLanes,
  setAgendaDate,
  setColumnWidth,
  setEntryAsked,
  setEntryHeader,
  setEntryHidden,
  setEntryInput,
  setEntryOrder,
  setRoadmapOrder,
  setViewSetting,
  viewSettings,
  type WordView,
} from '@/data/repositories/formatViewRepository.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { compileDerived } from '@/domain/format/derived.ts'
import { rowWriteRefusal } from '@/domain/format/owner.ts'
import {
  boardOf,
  agendaOf,
  boundedWidth,
  entryLayout,
  entryOrder,
  isPercentWorkedOut,
  isShowAs,
  isViewSetting,
  orderColumns,
  readAgendaDone,
  readReadyState,
  roadmapOf,
  SETTING_LONGEST,
  soleWordOf,
  startOf,
  startQuestions,
  VIEW_PARTS,
  wayOf,
  waysFor,
  workedOutType,
  type ShowAs,
} from '@/domain/format/view.ts'
import type { ColumnDeclaration } from '@/domain/format/declaration.ts'
import type { OpenDocument } from '../document.ts'
import { paragraphs, plural, section, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { PATH_PROP, ToolInputError, booleanProp, requireString, stringProp, type PluginTool } from './tool.ts'

/** The views a setting may name: every kind but the page, which the entry replaced (D-401), and the table. */
const VIEWS = ['entry', 'board', 'table', 'roadmap', 'ready', 'start', 'agenda'] as const
type View = (typeof VIEWS)[number]
const WORD_VIEWS: readonly WordView[] = ['roadmap', 'ready', 'start', 'agenda']

const SETTINGS_MAX = 200
const KEYS = ['format', 'view', 'column', 'show_as', 'header', 'hidden', 'new_entry', 'order', 'width', 'setting'] as const

/** One change a setting makes, with what it was, so the dry run shows both. */
type Change =
  | { readonly kind: 'WAY'; readonly format: string; readonly column: string; readonly was: ShowAs | undefined; readonly now: ShowAs | undefined }
  | { readonly kind: 'HEADER'; readonly format: string; readonly column: string; readonly was: boolean; readonly now: boolean }
  | { readonly kind: 'HIDDEN'; readonly format: string; readonly column: string; readonly was: boolean; readonly now: boolean }
  | { readonly kind: 'ASKED'; readonly format: string; readonly column: string; readonly was: boolean; readonly now: boolean }
  | { readonly kind: 'ORDER'; readonly format: string; readonly was: readonly string[]; readonly now: readonly string[] | undefined }
  | { readonly kind: 'LANES'; readonly format: string; readonly was: string | undefined; readonly now: string | undefined }
  | { readonly kind: 'WIDTH'; readonly format: string; readonly column: string; readonly was: number | undefined; readonly now: number | undefined }
  | { readonly kind: 'WORD'; readonly format: string; readonly view: WordView; readonly column: string; readonly was: string | undefined; readonly now: string | undefined }

interface Refused {
  readonly index: number
  readonly reason: string
}

interface ViewPlan {
  readonly changes: readonly Change[]
  readonly refusals: readonly Refused[]
  /** What the roadmaps, ready lists and start questions the batch touches draw once it is written. */
  readonly after: readonly string[]
}

/** A column an entry or a table can name: a stored one, or a worked-out one with the ways of what it works out to. */
interface Shown {
  readonly name: string
  readonly worked: boolean
  readonly ways: readonly ShowAs[]
}

/** Every column of a format the entry shows, with the ways each offers — the default first. */
function shownColumns(db: Database, declaration: FormatDeclaration, others: readonly FormatDeclaration[]): readonly Shown[] {
  const { compiled } = compileDerived(
    declaration,
    others.filter((each) => each.name !== declaration.name),
    listUnits(db),
  )
  return [
    ...declaration.columns.map((column) => ({ name: column.name, worked: false, ways: waysFor(column) })),
    ...(declaration.derived ?? []).map((each) => {
      const found = compiled.find((one) => one.declaration.name === each.name)
      const type =
        found === undefined
          ? { type: 'real' }
          : workedOutType(found.type.kind, isPercentWorkedOut(found, declaration.columns))
      return { name: each.name, worked: true, ways: waysFor(type) }
    }),
  ]
}

/** `a board`, `an agenda`, `an entry`: a view's name with its article. */
function aView(view: string): string {
  return `${/^[aeiou]/.test(view) ? 'an' : 'a'} ${view}`
}

function namesOf(columns: readonly { readonly name: string }[]): string {
  return columns.map((each) => `\`${each.name}\``).join(', ')
}

/** One setting, judged against the document as it is: its changes, or why it is refused. */
function judge(
  document: OpenDocument,
  declared: readonly FormatDeclaration[],
  offered: unknown,
): { readonly changes: readonly Change[] } | { readonly reason: string } {
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { reason: 'Not an object with a `format` and a `view`.' }
  }
  const entry = offered as Record<string, unknown>
  const unknown = Object.keys(entry).filter((key) => !(KEYS as readonly string[]).includes(key))
  if (unknown.length > 0) return { reason: `Unknown ${unknown.join(', ')}; a setting takes ${KEYS.join(', ')}.` }

  const name = entry['format']
  const declaration = declared.find((each) => each.name === name)
  if (declaration === undefined) {
    return { reason: `This document has no format called ${String(name)}. It has ${namesOf(declared)}.` }
  }
  // `sheet` was the table's name to a model until M43 U3 (D-451), and is still taken.
  const view = entry['view'] === 'sheet' ? 'table' : entry['view']
  if (typeof view !== 'string' || !(VIEWS as readonly string[]).includes(view)) {
    return { reason: `\`view\` is one of ${VIEWS.join(', ')}.` }
  }
  const format = declaration.name
  const column = entry['column']
  if (column !== undefined && typeof column !== 'string') return { reason: '`column` is a column’s name.' }
  const extra = (allowed: readonly string[]): string | undefined => {
    const stray = Object.keys(entry).filter((key) => !['format', 'view', ...allowed].includes(key))
    return stray.length === 0 ? undefined : `${stray.join(', ')} is not ${aView(view)} setting; ${aView(view)} takes ${allowed.join(', ')}.`
  }
  const db = document.db

  if ((WORD_VIEWS as readonly string[]).includes(view)) {
    const wrong = extra(['column', 'setting'])
    if (wrong !== undefined) return { reason: wrong }
    return judgeWord(db, declaration, view as WordView, column, entry['setting'])
  }

  switch (view as View) {
    case 'board': {
      const wrong = extra(['column'])
      if (wrong !== undefined) return { reason: wrong }
      const enums = declaration.columns.filter((each) => each.type === 'enum')
      if (enums.length === 0) return { reason: `${format} has no enum column, so it has no board.` }
      if (column !== undefined && !enums.some((each) => each.name === column)) {
        return { reason: `${format}’s board lays its lanes by an enum: ${namesOf(enums)}. \`${column}\` is not one.` }
      }
      const was = [...boardSettings(db, format)].find(([, part]) => part === 'lanes')?.[0]
      return { changes: [{ kind: 'LANES', format, was, now: column }] }
    }

    case 'table': {
      const wrong = extra(['column', 'width'])
      if (wrong !== undefined) return { reason: wrong }
      const shown = shownColumns(db, declaration, declared)
      if (column === undefined || !shown.some((each) => each.name === column)) {
        return { reason: `${format} has no column called ${String(column)}. It has ${namesOf(shown)}.` }
      }
      const width = entry['width']
      if (width !== null && (typeof width !== 'number' || !Number.isFinite(width))) {
        return { reason: '`width` is a number of pixels, or null for its type’s.' }
      }
      return {
        changes: [
          { kind: 'WIDTH', format, column, was: columnWidths(db, format).get(column), now: width === null ? undefined : boundedWidth(width) },
        ],
      }
    }

    case 'entry': {
      const locked = rowWriteRefusal(declaration)
      if (locked !== undefined) return { reason: `${locked} Its entry is read-only, as on the screen.` }

      if (entry['order'] !== undefined) {
        const wrong = extra(['order'])
        if (wrong !== undefined) return { reason: `${wrong} (\`order\` goes alone)` }
        const order = entry['order']
        if (!Array.isArray(order) || order.some((each) => typeof each !== 'string')) {
          return { reason: '`order` is a list of column names; [] for the declaration’s order.' }
        }
        const names = order as readonly string[]
        const strange = names.filter((each) => !declaration.columns.some((one) => one.name === each))
        if (strange.length > 0) {
          return { reason: `${format} cannot place ${strange.join(', ')}; its entry places ${namesOf(declaration.columns)}.` }
        }
        const twice = names.filter((each, at) => names.indexOf(each) !== at)
        if (twice.length > 0) return { reason: `\`order\` names ${twice.join(', ')} twice.` }
        const places = entryPlaces(db, format)
        const was = places.size === 0 ? [] : entryOrder(declaration.columns, places).map((each) => each.name)
        return { changes: [{ kind: 'ORDER', format, was, now: names.length === 0 ? undefined : names }] }
      }

      const wrong = extra(['column', 'show_as', 'header', 'hidden', 'new_entry'])
      if (wrong !== undefined) return { reason: wrong }
      const shown = shownColumns(db, declaration, declared)
      const target = shown.find((each) => each.name === column)
      if (target === undefined) {
        return { reason: `${format} has no column called ${String(column)}. It has ${namesOf(shown)}.` }
      }
      const way = entry['show_as']
      const header = entry['header']
      const hidden = entry['hidden']
      const asked = entry['new_entry']
      if (way === undefined && header === undefined && hidden === undefined && asked === undefined) {
        return { reason: 'An entry setting takes `show_as`, `header`, `hidden`, `new_entry` or `order`.' }
      }
      const changes: Change[] = []
      if (way !== undefined) {
        if (way !== null && (typeof way !== 'string' || !isShowAs(way) || !target.ways.includes(way))) {
          return {
            reason:
              `\`${String(way)}\` is not a way to show \`${target.name}\`; it offers ` +
              `${target.ways.join(', ')} (the first its default), or null for its default.`,
          }
        }
        changes.push({ kind: 'WAY', format, column: target.name, was: entryInputs(db, format).get(target.name), now: way ?? undefined })
      }
      if (header !== undefined) {
        if (typeof header !== 'boolean') return { reason: '`header` is true or false.' }
        if (target.worked) return { reason: `\`${target.name}\` is computed; it sits with the figures, never in the header line.` }
        changes.push({ kind: 'HEADER', format, column: target.name, was: entryHeaders(db, format).has(target.name), now: header })
      }
      // Hidden and asked for on a new entry are the Fields list's (M53 U2, D-517):
      // a stored column's, and never the title's or a required one's when hiding.
      if (hidden !== undefined || asked !== undefined) {
        if (target.worked) {
          return { reason: `\`${target.name}\` is computed; it is drawn with the figures and never typed, so it is neither hidden nor asked for.` }
        }
        const stored = declaration.columns.find((each) => each.name === target.name)
        if (hidden !== undefined) {
          if (typeof hidden !== 'boolean') return { reason: '`hidden` is true or false.' }
          if (hidden && stored?.required === true) return { reason: `\`${target.name}\` is required, so ${format}’s entry always shows it.` }
          if (hidden && titleOf(db, declaration) === target.name) {
            return { reason: `\`${target.name}\` is the title of ${format}’s entry, so it is always shown.` }
          }
          changes.push({ kind: 'HIDDEN', format, column: target.name, was: entryHidden(db, format).has(target.name), now: hidden })
        }
        if (asked !== undefined) {
          if (typeof asked !== 'boolean') return { reason: '`new_entry` is true or false.' }
          changes.push({ kind: 'ASKED', format, column: target.name, was: entryAsked(db, format).has(target.name), now: asked })
        }
      }
      return { changes }
    }

    default:
      return { reason: `\`view\` is one of ${VIEWS.join(', ')}.` }
  }
}

/** The column an entry draws as its title, which no setting hides — `entryLayout`'s reading of the view. */
function titleOf(db: Database, declaration: FormatDeclaration): string | undefined {
  const chosen = entryInputs(db, declaration.name)
  return entryLayout(
    entryOrder(declaration.columns, entryPlaces(db, declaration.name)),
    (each) => wayOf(each, chosen.get(each.name)),
    entryHeaders(db, declaration.name),
  ).title?.name
}

const LINKS: ReadonlySet<string> = new Set(['link', 'links'])

/**
 * Why a word does not fit the column it is set on, or nothing when it does —
 * the same reading `roadmapOf`, `readyOf` and `startOf` make, so a word the
 * view would skip is refused here rather than kept and quietly not drawn.
 */
function wordMisfit(declaration: FormatDeclaration, view: WordView, target: ColumnDeclaration, word: string): string | undefined {
  const format = declaration.name
  const named = `\`${target.name}\``
  const head = word.split(' ')[0]
  if (head === 'line') return undefined
  if (view === 'agenda') return agendaMisfit(target, word)
  if (view === 'roadmap' && head === 'order') {
    const numbers = orderColumns(declaration.columns)
    return numbers.includes(target)
      ? undefined
      : `A roadmap runs in a number column; ${format} has ${numbers.length === 0 ? 'none' : namesOf(numbers)}.`
  }
  if (view === 'roadmap') {
    return LINKS.has(target.type) && target.target !== format
      ? undefined
      : `\`under\` goes on a link to another format’s rows, which fold under the row it names; ${named} is not one.`
  }
  if (view === 'ready' && head === 'waits') {
    return LINKS.has(target.type) && target.target === format
      ? undefined
      : `\`waits\` goes on a link into ${format}’s own rows — the rows a row waits on; ${named} is not one.`
  }
  if (view === 'ready') {
    const members = readReadyState(word)
    if (target.type !== 'enum' || members === undefined) return `\`ready … done …\` goes on an enum; ${named} is not one.`
    const strange = [...members.ready, ...members.done].filter((each) => !(target.values ?? []).includes(each))
    return strange.length === 0 ? undefined : `${named} has no ${strange.join(', ')}; its members are ${(target.values ?? []).join(', ')}.`
  }
  const asked = startOf([target], new Map([[target.name, word]]))
  if (asked !== undefined && (asked.is.length > 0 || asked.latest !== undefined)) return undefined
  return head === 'is'
    ? `\`is\` names a member of an enum (${(target.values ?? []).join(', ') || 'none here'}), or true or false of a boolean; ${named} is ${target.type}.`
    : `\`latest\` counts by a date, a month, a time or a number, 1 to 50; ${named} is ${target.type}.`
}

/**
 * An agenda's word (M49 U3, D-473): `date` on a date column, `done` naming
 * members the column has — as `agendaOf` reads them.
 */
function agendaMisfit(target: ColumnDeclaration, word: string): string | undefined {
  const named = `\`${target.name}\``
  if (word === 'date') return target.type === 'date' ? undefined : `\`date\` goes on a date column; ${named} is ${target.type}.`
  const members = readAgendaDone(word) ?? []
  const has = target.type === 'boolean' ? ['true', 'false'] : target.type === 'enum' ? (target.values ?? []) : []
  if (members.length > 0 && members.every((each) => has.includes(each)) && (target.type !== 'boolean' || members.length === 1)) {
    return undefined
  }
  if (target.type === 'boolean') return `\`done\` on a boolean is \`done true\` or \`done false\`.`
  // An enum that lacks a member says which, rather than what `done` is (M42 F11).
  const strange = members.filter((each) => !has.includes(each))
  return target.type === 'enum' && strange.length > 0
    ? `${named} has no ${strange.join(', ')}; its members are ${has.join(', ')}.`
    : `\`done\` names members of an enum (${(target.values ?? []).join(', ') || 'none here'}) that say a row is finished; ${named} is ${target.type}.`
}

/** A roadmap's, a ready list's or a start view's word on one column, judged. */
function judgeWord(
  db: Database,
  declaration: FormatDeclaration,
  view: WordView,
  column: string | undefined,
  offered: unknown,
): { readonly changes: readonly Change[] } | { readonly reason: string } {
  const format = declaration.name
  const target = declaration.columns.find((each) => each.name === column)
  if (target === undefined) {
    return { reason: `${format} has no column called ${String(column)}. It has ${namesOf(declaration.columns)}.` }
  }
  if (offered === undefined) return { reason: `${capitalize(aView(view))} setting takes \`setting\`: ${VIEW_PARTS[view].join(', ')}, or null.` }
  if (offered !== null && typeof offered !== 'string') return { reason: '`setting` is a word, or null to clear it.' }
  const spaced = offered === null ? undefined : offered.trim().split(/\s+/).join(' ')
  // An agenda's `done` is kept as it reads back — `done done, dropped` as `done done dropped`.
  const members = view === 'agenda' && spaced !== undefined ? readAgendaDone(spaced) : undefined
  const word = members === undefined ? spaced : ['done', ...members].join(' ')
  if (word !== undefined) {
    if (word.length > SETTING_LONGEST) {
      return { reason: `\`${word}\` is longer than the ${String(SETTING_LONGEST)} characters a view keeps for a column; shorter member names fit.` }
    }
    if (!isViewSetting(view, word)) {
      return { reason: `\`${word}\` is not ${aView(view)} setting; ${aView(view)} keeps ${VIEW_PARTS[view].join(', ')}.` }
    }
    const misfit = wordMisfit(declaration, view, target, word)
    if (misfit !== undefined) return { reason: misfit }
  }
  const kept = viewSettings(db, format, view)
  const sole = word === undefined ? undefined : soleWordOf(view, word)
  const cleared: Change[] = [...kept]
    .filter(([other, was]) => other !== target.name && sole !== undefined && soleWordOf(view, was) === sole)
    .map(([other, was]) => ({ kind: 'WORD', format, view, column: other, was, now: undefined }))
  return { changes: [...cleared, { kind: 'WORD', format, view, column: target.name, was: kept.get(target.name), now: word }] }
}

/**
 * **What the views a batch touches draw once it is written** — each start-here
 * question a touched format asks, and each roadmap a touched setting reaches,
 * or why it has none yet. Read from the settings as they will be, so the dry
 * run says what `start_here` and `show_format` will answer.
 */
function afterText(db: Database, declared: readonly FormatDeclaration[], changes: readonly Change[]): readonly string[] {
  const words = changes.filter((each): each is Extract<Change, { kind: 'WORD' }> => each.kind === 'WORD')
  if (words.length === 0) return []
  const settingsOf =
    (view: WordView) =>
    (format: string): ReadonlyMap<string, string> => {
      const map = new Map(viewSettings(db, format, view))
      for (const each of words) {
        if (each.format !== format || each.view !== view) continue
        if (each.now === undefined) map.delete(each.column)
        else map.set(each.column, each.now)
      }
      return map
    }
  const lines: string[] = []
  const asking = new Set(words.filter((each) => each.view === 'ready' || each.view === 'start').map((each) => each.format))
  const questions = startQuestions<ColumnDeclaration, FormatDeclaration>(declared, settingsOf('ready'), settingsOf('start'))
  for (const format of asking) {
    const asked = questions.filter((each) => each.format === format)
    lines.push(
      ...asked.map((each) => `\`start_here\` asks of ${format}: ${each.what}.`),
      ...(asked.length > 0
        ? []
        : [
            `${format} asks \`start_here\` nothing yet: a ready list needs an enum’s \`ready … done …\` and a link ` +
              'into its own rows; a start view an `is`, a `latest` or a `line`.',
          ]),
    )
  }
  const reached = new Set(
    words
      .filter((each) => each.view === 'roadmap')
      .flatMap((each) => {
        const link = declared.find((one) => one.name === each.format)?.columns.find((one) => one.name === each.column)
        return each.now === 'under' && link?.target !== undefined ? [link.target] : [each.format]
      }),
  )
  for (const format of new Set(words.filter((each) => each.view === 'agenda').map((each) => each.format))) {
    const declaration = declared.find((each) => each.name === format)
    const shape = declaration === undefined ? undefined : agendaOf(declaration.columns, settingsOf('agenda')(format))
    lines.push(
      shape === undefined
        ? `${format} is on no agenda: it has no date column.`
        : `${format} is on the agenda by \`${shape.date.name}\`` +
            (shape.done === undefined
              ? ', from today on; nothing before today is overdue until a `done` says what finished is.'
              : `; overdue is before today with \`${shape.done.column.name}\` not ${shape.done.members.join(' or ')}.`) +
            (shape.chosen ? ' `start_here` asks what is due within 7 days.' : ''),
    )
  }
  for (const format of reached) {
    const declaration = declared.find((each) => each.name === format)
    if (declaration === undefined) continue
    const shape = roadmapOf<ColumnDeclaration, FormatDeclaration>(declaration, declared, settingsOf('roadmap'))
    lines.push(
      shape === undefined
        ? `${format} draws no roadmap: it needs a number column, and another format whose link names its rows.`
        : `${format}’s roadmap runs in \`${shape.order.name}\`, folding ` +
            `${shape.folds.map((each) => `${each.format.name} by \`${each.through.name}\``).join(', ')}.`,
    )
  }
  return lines
}

function planOf(document: OpenDocument, settings: readonly unknown[]): ViewPlan {
  const declared = listFormats(document.db)
  const changes: Change[] = []
  const refusals: Refused[] = []
  settings.forEach((offered, index) => {
    const judged = judge(document, declared, offered)
    if ('reason' in judged) refusals.push({ index, reason: judged.reason })
    else changes.push(...judged.changes)
  })
  return { changes, refusals, after: refusals.length > 0 ? [] : afterText(document.db, declared, changes) }
}

function wayText(way: ShowAs | undefined): string {
  return way ?? 'its default'
}

function widthText(width: number | undefined): string {
  return width === undefined ? 'its type’s' : `${String(width)} px`
}

function orderText(order: readonly string[] | undefined): string {
  return order === undefined || order.length === 0 ? 'the declaration’s' : order.join(', ')
}

/** One change as a row of the diff: format, view, column, what, was, becomes. */
function changeRow(change: Change): readonly string[] {
  switch (change.kind) {
    case 'WAY':
      return [change.format, 'entry', change.column, 'show as', wayText(change.was), wayText(change.now)]
    case 'HEADER':
      return [change.format, 'entry', change.column, 'header line', change.was ? 'in' : 'out', change.now ? 'in' : 'out']
    case 'HIDDEN':
      return [change.format, 'entry', change.column, 'shown', change.was ? 'hidden' : 'shown', change.now ? 'hidden' : 'shown']
    case 'ASKED':
      return [change.format, 'entry', change.column, 'new entry', change.was ? 'asks' : '-', change.now ? 'asks' : '-']
    case 'ORDER':
      return [change.format, 'entry', '-', 'order', orderText(change.was), orderText(change.now)]
    case 'LANES':
      return [change.format, 'board', '-', 'lanes by', change.was ?? 'its first enum', change.now ?? 'its first enum']
    case 'WIDTH':
      return [change.format, 'table', change.column, 'width', widthText(change.was), widthText(change.now)]
    case 'WORD':
      return [change.format, change.view, change.column, 'setting', change.was ?? '-', change.now ?? '-']
  }
}

function describe(plan: ViewPlan): string {
  if (plan.refusals.length > 0) {
    return paragraphs(
      `**Nothing was written.** ${plural(plan.refusals.length, 'setting was', 'settings were')} refused, ` +
        'and this tool applies a batch whole or not at all.',
      table(['Setting', 'Why'], plan.refusals.map((each) => [`#${String(each.index + 1)}`, each.reason])),
      'Fix them and send the whole batch again.',
    )
  }
  return paragraphs(
    `${plural(plan.changes.length, 'view setting')} — the app draws ${plan.changes.length === 1 ? 'it' : 'them'} the next time the page is shown.`,
    table(['Format', 'View', 'Column', 'Sets', 'Was', 'Becomes'], plan.changes.map(changeRow)),
    plan.after.length === 0 ? undefined : plan.after.join('\n\n'),
  )
}

function apply(document: OpenDocument, plan: ViewPlan): string {
  // Re-checked here, as every mutation does: a commit runs `apply` whatever
  // `refuses` said, and half a batch is the thing the gate is for.
  if (plan.refusals.length > 0) return describe(plan)
  const db = document.db
  for (const change of plan.changes) {
    switch (change.kind) {
      case 'WAY':
        setEntryInput(db, change.format, change.column, change.now)
        break
      case 'HEADER':
        setEntryHeader(db, change.format, change.column, change.now)
        break
      case 'HIDDEN':
        setEntryHidden(db, change.format, change.column, change.now)
        break
      case 'ASKED':
        setEntryAsked(db, change.format, change.column, change.now)
        break
      case 'ORDER':
        setEntryOrder(db, change.format, change.now)
        break
      case 'LANES':
        setBoardLanes(db, change.format, change.now)
        break
      case 'WIDTH':
        setColumnWidth(db, change.format, change.column, change.now)
        break
      case 'WORD':
        // The roadmap's order is the screen's write too (*In the order of*).
        if (change.view === 'roadmap' && change.now === 'order') setRoadmapOrder(db, change.format, change.column)
        // The agenda's date is the screen's too (*by*, M49 U3).
        else if (change.view === 'agenda' && change.now === 'date') setAgendaDate(db, change.format, change.column)
        else setViewSetting(db, change.format, change.view, change.column, change.now)
        break
    }
  }
  return describe(plan)
}

function viewMutation(settings: readonly unknown[]): Mutation<ViewPlan> {
  return {
    plan: (document) => planOf(document, settings),
    describe,
    apply,
    refuses: (plan) => plan.refusals.length > 0 || plan.changes.length === 0,
  }
}

/**
 * **How a format is arranged now** — the section `formats` adds for one
 * format, so a conversation reads the arrangement before it changes it: each
 * column's Show as and the ways it offers, its place, the header line, its
 * width, and the board's lanes.
 */
export function arrangementText(document: OpenDocument, declaration: FormatDeclaration): string {
  const db = document.db
  const format = declaration.name
  const shown = shownColumns(db, declaration, listFormats(db))
  const ways = entryInputs(db, format)
  const places = entryPlaces(db, format)
  const headers = entryHeaders(db, format)
  const hidden = entryHidden(db, format)
  const asked = entryAsked(db, format)
  const widths = columnWidths(db, format)
  const board = boardOf(declaration.columns, boardSettings(db, format))
  return section(
    'How it is shown — `arrange_views` changes it',
    paragraphs(
      table(
        ['Column', 'Show as', 'Ways (default first)', 'Place', 'Header', 'Shown', 'New entry', 'Width'],
        shown.map((each) => [
          each.worked ? `${each.name} (computed)` : each.name,
          ways.get(each.name) ?? '-',
          each.ways.join(', '),
          places.has(each.name) ? `#${String(places.get(each.name))}` : '-',
          headers.has(each.name) ? 'yes' : '-',
          hidden.has(each.name) ? 'hidden' : '-',
          asked.has(each.name) ? 'asks' : '-',
          widths.has(each.name) ? String(widths.get(each.name)) : '-',
        ]),
      ),
      board === undefined ? undefined : `**Board:** lanes by \`${board.lanes.name}\`.`,
      ...WORD_VIEWS.map((view) => {
        const kept = [...viewSettings(db, format, view)]
        const label = view === 'roadmap' ? 'Roadmap' : view === 'ready' ? 'Ready' : view === 'agenda' ? 'Agenda' : 'Start'
        return kept.length === 0 ? undefined : `**${label}:** ${kept.map(([column, word]) => `\`${column}: ${word}\``).join(', ')}.`
      }),
    ),
  )
}

export const arrangeViewsTool: PluginTool = {
  definition: {
    name: 'arrange_views',
    title: 'Arrange a format’s views',
    description:
      'How the app shows a format: on its entry, a column’s `show_as`, `header` line, `hidden`, ' +
      '`new_entry` and the `order`; a board’s lanes; a table column’s `width`; a column’s `setting` in a roadmap, a ' +
      'ready list or a start-here question. `formats` with a `format` shows the ' +
      'arrangement and each column’s ways. Dry-runs until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        settings: {
          type: 'array',
          description: `Up to ${String(SETTINGS_MAX)}.`,
          items: {
            type: 'object',
            properties: {
              format: { type: 'string' },
              view: { type: 'string', enum: [...VIEWS] },
              column: stringProp('On a board, the enum for lanes; omit for its first.'),
              show_as: { type: ['string', 'null'], description: 'entry: a way the column offers; null resets.' },
              header: booleanProp('entry: in the line under the title.'),
              hidden: booleanProp('entry: kept off the page, still in the table and every tool.'),
              new_entry: booleanProp('entry: a new entry asks for it.'),
              order: {
                type: 'array',
                items: { type: 'string' },
                description: 'entry, alone: these columns first; [] resets.',
              },
              width: { type: ['number', 'null'], description: 'table: pixels; null resets.' },
              setting: {
                type: ['string', 'null'],
                description:
                  'roadmap: order, under, line; ready: waits, ready <members> done <members>, line; ' +
                  'start: is <member>, latest <n>, line; agenda: date, done <members>, line. null clears.',
              },
            },
            required: ['format', 'view'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Write it; omit for the dry run.'),
      },
      required: ['path', 'settings'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const settings = args['settings']
    if (!Array.isArray(settings) || settings.length === 0) {
      throw new ToolInputError('`settings` is a list of at least one setting.')
    }
    if (settings.length > SETTINGS_MAX) {
      throw new ToolInputError(`${String(settings.length)} settings is more than the ${String(SETTINGS_MAX)} this takes in one call.`)
    }
    return mutatingCall(path, args['commit'] === true, viewMutation(settings))
  },
}
