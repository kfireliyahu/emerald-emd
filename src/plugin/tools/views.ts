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
  setListSetting,
  setRoadmapOrder,
  setViewSetting,
  viewSettings,
  deleteSavedView,
  renameSavedView,
  savedView,
  savedViews,
  saveView,
  setDashboardBlocks,
  type WordView,
} from '@/data/repositories/formatViewRepository.ts'
import { filterQuery } from '@/data/repositories/formatFilterRepository.ts'
import { formatViews } from '@/data/repositories/formatLinkViewRepository.ts'
import { toISODate } from '@/core/time.ts'
import { canonicalAddress, filterAddress, foldFilter, isFoldKey } from '@/ui/formats/addressFilter.ts'
import { today } from '../today.ts'
import { savedViewSaid } from './saved.ts'
import { dashboardLine, judgeDashboard, type DashboardChange } from './dashboard.ts'
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
  listGroupable,
  listOf,
  orderColumns,
  readAgendaDone,
  readListSetting,
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
  writeListSetting,
  isSavedKind,
  SAVED_ADDRESS_LONGEST,
  SAVED_KINDS,
  savedNameRefusal,
  type SavedView,
  type DashboardBlock,
  type ShowAs,
} from '@/domain/format/view.ts'
import type { ColumnDeclaration } from '@/domain/format/declaration.ts'
import type { OpenDocument } from '../document.ts'
import { paragraphs, plural, section, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { PATH_PROP, ToolInputError, booleanProp, requireString, stringProp, type PluginTool } from './tool.ts'

/**
 * The views a setting may name: every kind but the page, which the entry
 * replaced (D-401), and the table — and `saved`, a view saved under a name
 * (M53 U5, D-520).
 */
const VIEWS = ['entry', 'board', 'list', 'table', 'roadmap', 'ready', 'start', 'agenda', 'saved', 'dashboard'] as const
type View = (typeof VIEWS)[number]
const WORD_VIEWS: readonly WordView[] = ['roadmap', 'ready', 'start', 'agenda']

const SETTINGS_MAX = 200
const KEYS = [
  'format',
  'view',
  'column',
  'show_as',
  'header',
  'hidden',
  'new_entry',
  'order',
  'width',
  'setting',
  'name',
  'kind',
  'match',
  'search',
  'descending',
  'columns',
  'rename',
  'delete',
  'add',
  'remove',
] as const

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
  | { readonly kind: 'LIST'; readonly format: string; readonly column: string; readonly was: string | undefined; readonly now: string | undefined }
  | { readonly kind: 'SAVED'; readonly format: string; readonly name: string; readonly was: SavedView | undefined; readonly now: SavedView | undefined }
  | { readonly kind: 'RENAMED'; readonly format: string; readonly from: string; readonly to: string }
  | DashboardChange

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
  working: Map<string, readonly DashboardBlock[]>,
): { readonly changes: readonly Change[] } | { readonly reason: string } {
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { reason: 'Not an object with a `format` and a `view`.' }
  }
  const entry = offered as Record<string, unknown>
  const unknown = Object.keys(entry).filter((key) => !(KEYS as readonly string[]).includes(key))
  if (unknown.length > 0) return { reason: `Unknown ${unknown.join(', ')}; a setting takes ${KEYS.join(', ')}.` }

  // **A dashboard** (M53 U7, D-521): a format's, or the document's with no `format`.
  if (entry['view'] === 'dashboard') return judgeDashboard(document.db, declared, entry, working)

  const name = entry['format']
  if (name === undefined) return { reason: '`format` names the format; only a dashboard takes none, for the document’s own.' }
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
    case 'saved': {
      const wrong = extra(['name', 'kind', 'match', 'search', 'order', 'descending', 'columns', 'rename', 'delete'])
      if (wrong !== undefined) return { reason: wrong }
      return judgeSaved(db, declaration, declared, entry)
    }

    case 'list': {
      const wrong = extra(['column', 'setting'])
      if (wrong !== undefined) return { reason: wrong }
      return judgeList(db, declaration, column, entry['setting'])
    }

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
 * **A list's words on one column** (M53 U4, D-519): the column's whole setting
 * — `group`, `line`, `done <members>`, together — or null to clear it. `group`
 * and `done` are one column's each, so saying one takes it off the column that
 * held it, keeping that column's other words, as the screen's menus do.
 */
function judgeList(
  db: Database,
  declaration: FormatDeclaration,
  column: string | undefined,
  offered: unknown,
): { readonly changes: readonly Change[] } | { readonly reason: string } {
  const format = declaration.name
  const target = declaration.columns.find((each) => each.name === column)
  if (target === undefined) {
    return { reason: `${format} has no column called ${String(column)}. It has ${namesOf(declaration.columns)}.` }
  }
  if (offered === undefined) return { reason: `A list setting takes \`setting\`: ${VIEW_PARTS.list.join(', ')} — together, as \`group line\` — or null.` }
  if (offered !== null && typeof offered !== 'string') return { reason: '`setting` is a column’s words, or null to clear them.' }
  const read = offered === null ? undefined : readListSetting(offered)
  if (offered !== null && read === undefined) {
    return { reason: `\`${offered}\` is not a list setting; a list keeps ${VIEW_PARTS.list.join(', ')}, together on one column, \`done\` last.` }
  }
  const named = `\`${target.name}\``
  if (read?.group === true && !listGroupable(target)) {
    return { reason: `A list groups by an enum, one link or a date; ${named} is ${target.type}.` }
  }
  if (read?.done !== undefined) {
    const has = target.type === 'boolean' ? ['true', 'false'] : target.type === 'enum' ? (target.values ?? []) : []
    const strange = read.done.filter((each) => !has.includes(each))
    if (target.type === 'boolean' && read.done.length !== 1) return { reason: '`done` on a boolean is `done true` or `done false`.' }
    if (has.length === 0) return { reason: `\`done\` names members of an enum, or true of a boolean, that tick a row; ${named} is ${target.type}.` }
    if (strange.length > 0) return { reason: `${named} has no ${strange.join(', ')}; its members are ${has.join(', ')}.` }
  }
  const now = read === undefined ? undefined : writeListSetting(read)
  if (now !== undefined && now.length > SETTING_LONGEST) {
    return { reason: `\`${now}\` is longer than the ${String(SETTING_LONGEST)} characters a view keeps for a column; shorter member names fit.` }
  }
  const kept = viewSettings(db, format, 'list')
  const cleared: Change[] = [...kept].flatMap(([other, word]): Change[] => {
    const was = readListSetting(word)
    if (other === target.name || was === undefined || read === undefined) return []
    const left = writeListSetting({ group: was.group && !read.group, line: was.line, done: read.done === undefined ? was.done : undefined })
    return left === word ? [] : [{ kind: 'LIST', format, column: other, was: word, now: left }]
  })
  return { changes: [...cleared, { kind: 'LIST', format, column: target.name, was: kept.get(target.name), now }] }
}

/**
 * **A view saved under a name** (M53 U5, D-514, D-520): `name` with what it
 * holds — `kind`, `match`, `search`, `order` and `descending`, `columns` —
 * saves it, writing over one of that name; `rename` alone gives it another
 * name, and `delete: true` removes it. What it holds is checked as
 * `format_rows` checks a filter, and kept as the address spells it, so a
 * window around today — `match:{due:"today"}` — stays the phrase.
 */
function judgeSaved(
  db: Database,
  declaration: FormatDeclaration,
  declared: readonly FormatDeclaration[],
  entry: Record<string, unknown>,
): { readonly changes: readonly Change[] } | { readonly reason: string } {
  const format = declaration.name
  const name = entry['name']
  if (typeof name !== 'string' || name.trim() === '') return { reason: 'A saved view takes its `name`.' }
  const was = savedView(db, format, name)
  const others = savedViews(db, format).map((each) => `\`${each.name}\``)
  const missing = `${format} has no saved view called ${name}${others.length === 0 ? '' : `; it has ${others.join(', ')}`}.`
  const holds = ['kind', 'match', 'search', 'order', 'descending', 'columns'].filter((key) => entry[key] !== undefined)

  if (entry['delete'] !== undefined) {
    if (entry['delete'] !== true) return { reason: '`delete` is true, or left out.' }
    if (holds.length > 0 || entry['rename'] !== undefined) return { reason: '`delete` goes with the `name` alone.' }
    if (was === undefined) return { reason: missing }
    return { changes: [{ kind: 'SAVED', format, name, was, now: undefined }] }
  }

  const rename = entry['rename']
  if (rename !== undefined) {
    if (typeof rename !== 'string') return { reason: '`rename` is the view’s new name.' }
    if (holds.length > 0) return { reason: '`rename` goes with the `name` alone; save it again to change what it holds.' }
    if (was === undefined) return { reason: missing }
    const refusal = savedNameRefusal(rename)
    if (refusal !== undefined) return { reason: refusal }
    if (rename !== name && savedView(db, format, rename) !== undefined) return { reason: `${format} already has a view called ${rename}.` }
    return { changes: rename === name ? [] : [{ kind: 'RENAMED', format, from: name, to: rename }] }
  }

  const refusal = savedNameRefusal(name)
  if (refusal !== undefined) return { reason: refusal }
  const offeredKind = entry['kind'] === undefined ? (was?.kind ?? 'table') : entry['kind'] === 'sheet' ? 'table' : entry['kind']
  const has = formatViews(db, declaration, declared).map((each) => (each === 'sheet' ? 'table' : each))
  if (typeof offeredKind !== 'string' || !isSavedKind(offeredKind)) {
    return { reason: `\`kind\` is the view it opens as: ${SAVED_KINDS.join(', ')}.` }
  }
  if (!(has as readonly string[]).includes(offeredKind)) return { reason: `${format} has no ${offeredKind}; its views are ${has.join(', ')}.` }

  const match = entry['match']
  if (match !== undefined && (match === null || typeof match !== 'object' || Array.isArray(match))) {
    return { reason: '`match` is an object of column name to value, as `format_rows` takes it.' }
  }
  const search = entry['search']
  if (search !== undefined && typeof search !== 'string') return { reason: '`search` is the text looked for.' }
  const held = (match ?? {}) as Record<string, unknown>
  const own = Object.fromEntries(Object.entries(held).filter(([key]) => !isFoldKey(key)))
  const folds = Object.fromEntries(Object.entries(held).filter(([key]) => isFoldKey(key)))
  const filter = {
    ...(Object.keys(own).length === 0 ? {} : { match: own }),
    ...(search === undefined || search.trim() === '' ? {} : { search }),
  }
  const day = toISODate(today())
  const read = filterQuery(db, declaration, filter, declared, day)
  if (!read.ok) {
    return {
      reason:
        read.error.kind === 'NO_COLUMN'
          ? `\`match\` names ${read.error.name}, which ${format} has not got. It has ${namesOf(declaration.columns)}.`
          : `\`match\`: ${read.error.reason}`,
    }
  }
  for (const key of new Set(Object.keys(folds).map((each) => each.slice(0, each.indexOf('.'))))) {
    const folded = declared.find((each) => each.name === key)
    if (folded === undefined) return { reason: `\`match\` names ${key}.…, and this document declares no ${key}.` }
    const foldRead = filterQuery(db, folded, foldFilter(folds, key), declared, day)
    if (!foldRead.ok) {
      return { reason: `\`match\` on ${key}: ${foldRead.error.kind === 'NO_COLUMN' ? `${key} has no column ${foldRead.error.name}.` : foldRead.error.reason}` }
    }
  }

  const order = entry['order']
  const descending = entry['descending']
  const sortable = [...declaration.columns.map((each) => each.name), ...(declaration.derived ?? []).map((each) => each.name)]
  if (order !== undefined && (typeof order !== 'string' || !sortable.includes(order))) {
    return { reason: `\`order\` is a column of ${format} to sort by: ${sortable.map((each) => `\`${each}\``).join(', ')}.` }
  }
  if (descending !== undefined && typeof descending !== 'boolean') return { reason: '`descending` is true or false.' }
  if (descending !== undefined && order === undefined) return { reason: '`descending` turns an `order` round; name the `order` too.' }

  const columnsOffered = entry['columns']
  let columns: Record<string, readonly string[]> = {}
  if (columnsOffered !== undefined) {
    const byFormat: Record<string, unknown> = Array.isArray(columnsOffered)
      ? { [format]: columnsOffered }
      : columnsOffered !== null && typeof columnsOffered === 'object'
        ? (columnsOffered as Record<string, unknown>)
        : { '': undefined }
    for (const [owner, list] of Object.entries(byFormat)) {
      const of = declared.find((each) => each.name === owner)
      if (of === undefined || !Array.isArray(list) || list.some((each) => typeof each !== 'string')) {
        return { reason: '`columns` is the column names its lines draw — a list, or `{format: [names]}` for a roadmap’s folds.' }
      }
      const names = list as readonly string[]
      const strange = names.filter((each) => !of.columns.some((one) => one.name === each))
      if (strange.length > 0) return { reason: `${owner} has no ${strange.join(', ')}; it has ${namesOf(of.columns)}.` }
      columns = { ...columns, [owner]: names }
    }
  }

  const address = canonicalAddress(
    filterAddress(filter, {
      folds,
      columns,
      ...(typeof order === 'string' ? { order: { column: order, descending: descending === true } } : {}),
    }),
  )
  if (address.length > SAVED_ADDRESS_LONGEST) {
    return { reason: `A saved view keeps at most ${String(SAVED_ADDRESS_LONGEST)} characters of address; this one is ${String(address.length)}.` }
  }
  const now: SavedView = { format, name, kind: offeredKind, address }
  if (was !== undefined && was.kind === now.kind && was.address === now.address) return { changes: [] }
  return { changes: [{ kind: 'SAVED', format, name, was, now }] }
}

/** A saved view as the dry run's table says it: its kind and address, or `-` for none. */
function savedText(view: SavedView | undefined): string {
  return view === undefined ? '-' : `${view.kind}${view.address === '' ? '' : ` ${view.address}`}`
}

/**
 * **What the views a batch touches draw once it is written** — each start-here
 * question a touched format asks, and each roadmap a touched setting reaches,
 * or why it has none yet. Read from the settings as they will be, so the dry
 * run says what `start_here` and `show_format` will answer.
 */
function afterText(db: Database, declared: readonly FormatDeclaration[], changes: readonly Change[]): readonly string[] {
  const lists = changes.filter((each): each is Extract<Change, { kind: 'LIST' }> => each.kind === 'LIST')
  const listed = [...new Set(lists.map((each) => each.format))].flatMap((format) => {
    const declaration = declared.find((each) => each.name === format)
    if (declaration === undefined) return []
    const map = new Map(viewSettings(db, format, 'list'))
    for (const each of lists) {
      if (each.format !== format) continue
      if (each.now === undefined) map.delete(each.column)
      else map.set(each.column, each.now)
    }
    return [listText(declaration, map)]
  })
  const words = changes.filter((each): each is Extract<Change, { kind: 'WORD' }> => each.kind === 'WORD')
  if (words.length === 0) return listed
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
  return [...listed, ...lines]
}

/** What a format's list draws under these settings, in one sentence — the dry run's, and `formats`'. */
function listText(declaration: FormatDeclaration, settings: ReadonlyMap<string, string>): string {
  const shape = listOf(declaration.columns, settings)
  return (
    `${declaration.name}’s list is ${shape.group === undefined ? 'one list' : `grouped by \`${shape.group.name}\``}` +
    (shape.done === undefined ? ', with no tick' : `, ticked when \`${shape.done.column.name}\` is ${shape.done.members.join(' or ')}`) +
    (shape.lines.length === 0 ? ', each line its name alone.' : `, each line showing ${shape.lines.map((each) => `\`${each.name}\``).join(', ')}${shape.lineChosen ? '' : ' (its default)'}.`)
  )
}

function planOf(document: OpenDocument, settings: readonly unknown[]): ViewPlan {
  const declared = listFormats(document.db)
  const changes: Change[] = []
  const refusals: Refused[] = []
  // What each dashboard holds after the settings before, so one call can add and then order.
  const working = new Map<string, readonly DashboardBlock[]>()
  settings.forEach((offered, index) => {
    const judged = judge(document, declared, offered, working)
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
    case 'LIST':
      return [change.format, 'list', change.column, 'setting', change.was ?? '-', change.now ?? '-']
    case 'SAVED':
      return [change.format, 'saved', change.name, change.now === undefined ? 'deleted' : 'view', savedText(change.was), savedText(change.now)]
    case 'RENAMED':
      return [change.format, 'saved', change.from, 'name', change.from, change.to]
    case 'DASHBOARD':
      // One row per thing it changes; `describe` spreads them.
      return [change.dashboard ?? 'the document', 'dashboard', ...(change.said[0] ?? ['-', '-', '-', '-'])]
  }
}

/** A change as the diff's rows: a dashboard's are one per block it touches. */
function changeRows(change: Change): readonly (readonly string[])[] {
  if (change.kind !== 'DASHBOARD') return [changeRow(change)]
  return change.said.map((each) => [change.dashboard ?? 'the document', 'dashboard', ...each])
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
    table(['Format', 'View', 'Column', 'Sets', 'Was', 'Becomes'], plan.changes.flatMap(changeRows)),
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
      case 'LIST':
        setListSetting(db, change.format, change.column, change.now)
        break
      case 'SAVED':
        if (change.now === undefined) deleteSavedView(db, change.format, change.name)
        else saveView(db, change.now)
        break
      case 'RENAMED':
        renameSavedView(db, change.format, change.from, change.to)
        break
      case 'DASHBOARD':
        setDashboardBlocks(db, change.dashboard, change.now)
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
      `**List:** ${listText(declaration, viewSettings(db, format, 'list'))}`,
      ((): string | undefined => {
        const saved = savedViews(db, format)
        return saved.length === 0
          ? undefined
          : `**Saved views** — \`show_format view:"<name>"\` draws one, \`format_rows view:"<name>"\` reads it: ` +
              `${saved.map((each) => `\`${each.name}\` (${savedViewSaid(each)})`).join(', ')}.`
      })(),
      dashboardLine(db, format),
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
      '`new_entry` and the `order`; a board’s lanes; a table column’s `width`; a column’s `setting` in a list, a roadmap, a ' +
      'ready list or a start-here question; `view: saved`, a `name` and what it keeps (`today` stays that phrase), or ' +
      '`rename`, or `delete: true`; `view: dashboard` `add`s, `order`s and `remove`s blocks (no `format`: the document’s). ' +
      '`formats` with a `format` shows the ' +
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
                type: ['array', 'string'],
                items: { type: 'string' },
                description: 'entry, alone: these columns first; [] resets. saved: the column it sorts by. dashboard: blocks’ names.',
              },
              width: { type: ['number', 'null'], description: 'table: pixels; null resets.' },
              setting: {
                type: ['string', 'null'],
                description:
                  'list: group, line, done <members>, together (`group line`); roadmap: order, under, line; ready: waits, ready <members> done <members>, line; ' +
                  'start: is <member>, latest <n>, line; agenda: date, done <members>, line. null clears.',
              },
              name: stringProp('saved: the view’s name.'),
              kind: { type: 'string', enum: [...SAVED_KINDS], description: 'saved: the view it opens as; defaults to table.' },
              match: { type: 'object', description: 'saved: as `format_rows`.' },
              search: stringProp('saved: as `format_rows`.'),
              descending: booleanProp('saved: as `format_rows`.'),
              columns: { type: ['array', 'object'], items: { type: 'string' }, description: 'saved: what its lines draw.' },
              rename: stringProp('saved, alone: a new name.'),
              delete: booleanProp('saved, alone.'),
              add: {
                type: 'array',
                items: { type: 'object' },
                description: 'dashboard: `{saved}`, `{rollup}` or `{total, count|sum, match}`, with `format` on the document’s.',
              },
              remove: { type: 'array', items: { type: 'string' }, description: 'dashboard: blocks’ names.' },
            },
            required: ['view'],
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
