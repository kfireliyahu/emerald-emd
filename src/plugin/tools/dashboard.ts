/**
 * **A dashboard, to a conversation** — M53 U7, D-514, D-521.
 *
 * Parity (D-227): `arrange_views` with `view: dashboard` adds, sizes (M53 F4,
 * D-527), orders and removes a dashboard's blocks as the screen does — a format's with its
 * `format`, the document's without one — and `show_format view:dashboard`
 * draws it, its text naming each block with what it reads and what it holds
 * now, in the words the screen draws (`ui/formats/dashboard.ts`). `start_here`
 * is unchanged.
 */

import type { Database } from 'sql.js'

import { formatMoney, money } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import { filterQuery, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { readyData } from '@/data/repositories/formatLinkViewRepository.ts'
import { runRollup } from '@/data/repositories/formatRollupRepository.ts'
import { countRows, linkLabels, listRows, type RowQuery } from '@/data/repositories/formatRowRepository.ts'
import { dashboardBlocks, savedView, savedViews, viewSettings } from '@/data/repositories/formatViewRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { figureText } from '@/domain/format/rollup.ts'
import {
  blockNamed,
  blockSizeRefusal,
  blockSizeText,
  blocksInOrder,
  sameBlock,
  totalNameRefusal,
  type DashboardBlock,
} from '@/domain/format/view.ts'
import { addressView, canonicalAddress, filterAddress } from '@/ui/formats/addressFilter.ts'
import { blockGone, blockWhat, headline, ofText, summableColumns } from '@/ui/formats/dashboard.ts'
import { valueText } from '@/ui/formats/entryList.ts'
import { listOrder, listPicture } from '@/ui/formats/listView.ts'

import { plural } from '../format.ts'
import { today } from '../today.ts'

/** Whose dashboard, as a sentence says it. */
export function dashboardTitle(dashboard: string | undefined, declarations: readonly FormatDeclaration[]): string {
  if (dashboard === undefined) return 'The document’s dashboard'
  return `${declarations.find((each) => each.name === dashboard)?.title ?? dashboard}’s dashboard`
}

/** How many names a block's line gives before it says how many more. */
const NAMED = 5

/**
 * **A dashboard as text** — every block in its order, with what it reads and
 * what it holds now: a headline total's figure, a saved view's rows by name, a
 * rollup's figures by month. What `show_format view:dashboard` answers beside
 * the drawn page, so the model knows what the person sees.
 */
export function dashboardText(db: Database, dashboard: string | undefined, declarations: readonly FormatDeclaration[]): string {
  const blocks = dashboardBlocks(db, dashboard)
  const title = dashboardTitle(dashboard, declarations)
  if (blocks.length === 0) {
    return (
      `Nothing is on ${title.charAt(0).toLowerCase()}${title.slice(1)} yet. \`arrange_views\` with \`view: dashboard\`` +
      `${dashboard === undefined ? '' : ` and \`format: ${dashboard}\``} and \`add\` puts a saved view, a rollup or a headline total on it.`
    )
  }
  const day = toISODate(today())
  const lines = blocks.map((block, at) => {
    const what = blockWhat(db, block, declarations, dashboard === undefined)
    // A block given a size says it; one with none is drawn as before there were sizes.
    const size = block.width === undefined && block.height === undefined ? '' : ` (${blockSizeText(block)})`
    return `${String(at + 1)}. **${block.name}** — ${what}${size}: ${blockHolds(db, block, declarations, day)}`
  })
  return [`**${title}** — ${plural(blocks.length, 'block')}, in order:`, '', ...lines].join('\n')
}

/** What one block holds now, in a clause. */
function blockHolds(db: Database, block: DashboardBlock, declarations: readonly FormatDeclaration[], day: string): string {
  const gone = blockGone(db, block, declarations)
  if (gone !== undefined) return `not drawn — ${gone}`
  const declaration = declarations.find((each) => each.name === block.format)
  if (declaration === undefined) return 'not drawn'
  if (block.kind === 'total') {
    const read = headline(db, block, declarations, day)
    if (!read.ok) return `not drawn — ${read.error}`
    return `**${read.value.figure}${read.value.unit === undefined ? '' : ` ${read.value.unit}`}** ${ofText(declaration, read.value.of)}` +
      (block.sum === undefined ? '.' : `, over ${plural(read.value.rows, 'row')}.`)
  }
  if (block.kind === 'rollup') {
    const result = runRollup(db, declaration, block.name, declarations, { today: day })
    if (result === undefined) return 'not drawn'
    if (result.groups.length === 0) return 'no row falls in it yet.'
    const moneyOf = (minor: number, currency: string): string => formatMoney(money(minor, currency))
    const shown = result.groups.slice(-12).map((group) => {
      const by = group.by === undefined ? '' : ` ${result.labels.get(group.by) ?? group.by}`
      const value = group.value.kind === 'VALUE' ? group.value.figures.map((figure) => figureText(figure, moneyOf)).join(' + ') : 'unchecked'
      return `${group.period ?? 'no month'}${by} ${value}`
    })
    return `${shown.join(', ')}${result.groups.length > 12 ? ` (the last 12 of ${String(result.groups.length)})` : ''}.`
  }
  const view = savedView(db, block.format, block.name)
  if (view === undefined) return 'not drawn'
  const held = addressView(view.address)
  const read = filterQuery(db, declaration, held.filter, declarations, day)
  if (!read.ok) return `not drawn — ${read.error.kind === 'NO_COLUMN' ? `no column ${read.error.name}` : read.error.reason}`
  const query: RowQuery = { ...read.value, ...(held.order === undefined ? {} : { order: held.order.column, descending: held.order.descending }) }
  const ready = view.kind === 'ready' ? readyData(db, declaration, declarations, query, day) : undefined
  // A list names its rows in the order the list draws them: open first, by due.
  const listed =
    view.kind === 'list'
      ? listOrder(listPicture(db, declaration, declarations, query, viewSettings(db, declaration.name, 'list'), day)).map((each) => each.row)
      : undefined
  const rows = ready !== undefined ? ready.ready.map((each) => each.row) : (listed ?? listRows(db, declaration, { ...query, limit: NAMED }))
  const total = ready !== undefined || listed !== undefined ? rows.length : countRows(db, declaration, query)
  if (total === 0) return 'no rows match.'
  const label = labelColumn(declaration)
  const named = rows.slice(0, NAMED)
  const labels = linkLabels(db, named, declaration, declarations)
  const names = named.map((row) => (label === undefined ? '' : valueText(label, row, labels)) || row.id)
  return `${plural(total, 'row')} — ${names.join(', ')}${total > named.length ? ` and ${String(total - named.length)} more` : ''}.`
}

/** One change `arrange_views view:dashboard` makes: the dashboard's blocks as they will stand, and what changed, a row each. */
export interface DashboardChange {
  readonly kind: 'DASHBOARD'
  readonly dashboard: string | undefined
  readonly now: readonly DashboardBlock[]
  /** Block, what it sets, was, becomes — the dry run's rows. */
  readonly said: readonly (readonly [string, string, string, string])[]
}

/** The keys a dashboard's setting takes. */
export const DASHBOARD_KEYS = ['format', 'view', 'add', 'size', 'order', 'remove'] as const

/** The keys one block in `size` takes. */
const SIZE_KEYS = ['name', 'width', 'height']

/** The keys one block in `add` takes. */
const BLOCK_KEYS = ['format', 'saved', 'rollup', 'total', 'count', 'sum', 'match', 'search']

/**
 * **One dashboard setting, judged** against the blocks as earlier settings in
 * the same call left them (`working`): `add` first, then `size`, then
 * `remove`, then `order`, so a size or an order may name a block the same
 * setting adds.
 */
export function judgeDashboard(
  db: Database,
  declared: readonly FormatDeclaration[],
  entry: Record<string, unknown>,
  working: Map<string, readonly DashboardBlock[]>,
): { readonly changes: readonly DashboardChange[] } | { readonly reason: string } {
  const stray = Object.keys(entry).filter((key) => !(DASHBOARD_KEYS as readonly string[]).includes(key))
  if (stray.length > 0) return { reason: `${stray.join(', ')} is not a dashboard setting; a dashboard takes format, add, size, order and remove.` }
  const named = entry['format']
  if (named !== undefined && typeof named !== 'string') return { reason: '`format` is a format’s name, or left out for the document’s dashboard.' }
  if (named !== undefined && !declared.some((each) => each.name === named)) {
    return { reason: `This document has no format called ${named}. It has ${declared.map((each) => `\`${each.name}\``).join(', ')}.` }
  }
  const dashboard = named
  const key = dashboard ?? ''
  const was = working.get(key) ?? dashboardBlocks(db, dashboard)
  const add = entry['add']
  const remove = entry['remove']
  const order = entry['order']
  const size = entry['size']
  if (add === undefined && size === undefined && remove === undefined && order === undefined) {
    return { reason: 'A dashboard setting takes `add`, `size`, `order` or `remove` — what to put on it, how big, the order, or what to take off.' }
  }
  const said: (readonly [string, string, string, string])[] = []
  let blocks = was
  const day = toISODate(today())

  if (add !== undefined) {
    if (!Array.isArray(add) || add.length === 0) return { reason: '`add` is a list of blocks: `{saved}`, `{rollup}` or `{total, count|sum, match}`.' }
    for (const offered of add as readonly unknown[]) {
      const judged = judgeBlock(db, declared, dashboard, offered, day)
      if ('reason' in judged) return judged
      const block = judged.block
      if (blocks.some((each) => sameBlock(each, block))) {
        return { reason: `${block.name} is on ${dashboardTitle(dashboard, declared).replace(/^The/, 'the')} already.` }
      }
      blocks = [...blocks, block]
      said.push([block.name, 'added', '-', judged.what])
    }
  }

  if (size !== undefined) {
    const sizing = '`size` is a list of `{name, width, height}`: a block’s name, its width in columns and its height in rows, either alone.'
    if (!Array.isArray(size) || size.length === 0) return { reason: sizing }
    for (const offered of size as readonly unknown[]) {
      if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) return { reason: sizing }
      const item = offered as Record<string, unknown>
      const strayed = Object.keys(item).filter((each) => !SIZE_KEYS.includes(each))
      if (strayed.length > 0) return { reason: `A size takes ${SIZE_KEYS.join(', ')}; ${strayed.join(', ')} is none of them.` }
      const name = item['name']
      if (typeof name !== 'string') return { reason: sizing }
      const found = blockNamed(blocks, name)
      if ('reason' in found) return found
      if (item['width'] === undefined && item['height'] === undefined) return { reason: `${name}: a size gives a \`width\`, a \`height\` or both.` }
      const wrong = blockSizeRefusal(item)
      if (wrong !== undefined) return { reason: `${name}: ${wrong}` }
      const was = found.block
      const now: DashboardBlock = {
        ...was,
        ...(typeof item['width'] === 'number' ? { width: item['width'] } : {}),
        ...(typeof item['height'] === 'number' ? { height: item['height'] } : {}),
      }
      if (now.width === was.width && now.height === was.height) continue
      blocks = blocks.map((each) => (sameBlock(each, was) ? now : each))
      said.push([was.name, 'size', blockSizeText(was), blockSizeText(now)])
    }
  }

  if (remove !== undefined) {
    if (!Array.isArray(remove) || remove.some((each) => typeof each !== 'string')) return { reason: '`remove` is a list of blocks’ names.' }
    for (const name of remove as readonly string[]) {
      const found = blockNamed(blocks, name)
      if ('reason' in found) return found
      blocks = blocks.filter((each) => !sameBlock(each, found.block))
      said.push([found.block.name, 'removed', found.block.kind === 'total' ? 'headline total' : found.block.kind === 'saved' ? 'saved view' : 'rollup', '-'])
    }
  }

  if (order !== undefined) {
    if (!Array.isArray(order) || order.some((each) => typeof each !== 'string')) return { reason: '`order` is the blocks’ names in the order they stand; any left out keep theirs after them.' }
    const first: DashboardBlock[] = []
    for (const name of order as readonly string[]) {
      const found = blockNamed(blocks, name)
      if ('reason' in found) return found
      if (!first.some((each) => sameBlock(each, found.block))) first.push(found.block)
    }
    const before = blocks.map((each) => each.name).join(', ')
    blocks = blocksInOrder(blocks, first)
    const after = blocks.map((each) => each.name).join(', ')
    if (before !== after) said.push(['-', 'order', before, after])
  }

  if (said.length === 0) return { changes: [] }
  working.set(key, blocks)
  return { changes: [{ kind: 'DASHBOARD', dashboard, now: blocks, said }] }
}

/** One block of `add`, checked: the block, and how the dry run says it. */
function judgeBlock(
  db: Database,
  declared: readonly FormatDeclaration[],
  dashboard: string | undefined,
  offered: unknown,
  day: string,
): { readonly block: DashboardBlock; readonly what: string } | { readonly reason: string } {
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { reason: 'A block in `add` is an object: `{saved: "Due today"}`, `{rollup: "Done by month"}` or `{total: "Open", count: true, match: {…}}`.' }
  }
  const item = offered as Record<string, unknown>
  const stray = Object.keys(item).filter((key) => !BLOCK_KEYS.includes(key))
  if (stray.length > 0) return { reason: `A block takes ${BLOCK_KEYS.join(', ')}; ${stray.join(', ')} is none of them.` }
  const kinds = (['saved', 'rollup', 'total'] as const).filter((kind) => item[kind] !== undefined)
  const [kind] = kinds
  if (kind === undefined || kinds.length > 1) return { reason: 'A block is one of `saved`, `rollup` or `total`, with its name.' }
  const name = item[kind]
  if (typeof name !== 'string' || name.trim() === '') return { reason: `\`${kind}\` is a name.` }
  const asked = item['format'] ?? dashboard
  if (asked === undefined) return { reason: `${name}: a block on the document’s dashboard names the \`format\` it reads.` }
  if (typeof asked !== 'string') return { reason: '`format` is a format’s name.' }
  if (dashboard !== undefined && asked !== dashboard) return { reason: `${dashboard}’s dashboard holds ${dashboard}’s own views; ${name} would read ${asked}.` }
  const declaration = declared.find((each) => each.name === asked)
  if (declaration === undefined) return { reason: `This document has no format called ${asked}.` }
  const format = declaration.name
  const totalOnly = ['count', 'sum', 'match', 'search'].filter((key) => item[key] !== undefined)
  if (kind !== 'total' && totalOnly.length > 0) return { reason: `${totalOnly.join(', ')} is a headline total’s; a ${kind === 'saved' ? 'saved view' : 'rollup'} keeps its own.` }

  if (kind === 'saved') {
    if (savedView(db, format, name) === undefined) {
      const have = savedViews(db, format).map((each) => `\`${each.name}\``)
      return {
        reason:
          have.length === 0
            ? `${format} has no saved views yet; \`arrange_views\` with \`view: saved\` saves one.`
            : `${format} has no saved view called ${name}; it has ${have.join(', ')}.`,
      }
    }
    return { block: { dashboard, format, kind, name, address: '' }, what: `saved view of ${format}` }
  }
  if (kind === 'rollup') {
    const rollups = (declaration.rollups ?? []).map((each) => each.name)
    if (!rollups.includes(name)) {
      return {
        reason:
          rollups.length === 0
            ? `${format} declares no rollup; one is declared with the format (\`extend_format\`).`
            : `${format} has no rollup called ${name}; it has ${rollups.map((each) => `\`${each}\``).join(', ')}.`,
      }
    }
    return { block: { dashboard, format, kind, name, address: '' }, what: `rollup of ${format}, as a chart` }
  }

  const refusal = totalNameRefusal(name)
  if (refusal !== undefined) return { reason: refusal }
  const sum = item['sum']
  const count = item['count']
  if (count !== undefined && count !== true) return { reason: '`count` is true, or left out with a `sum`.' }
  if (sum !== undefined && count !== undefined) return { reason: `${name} is a count or a sum, not both.` }
  if (sum !== undefined) {
    const summable = summableColumns(declaration)
    if (typeof sum !== 'string' || !summable.some((each) => each.name === sum)) {
      return {
        reason:
          summable.length === 0
            ? `${format} has no number or money column to sum; a headline total of it is a \`count\`.`
            : `\`sum\` is a number or money column of ${format}: ${summable.map((each) => `\`${each.name}\``).join(', ')}.`,
      }
    }
  }
  const match = item['match']
  if (match !== undefined && (match === null || typeof match !== 'object' || Array.isArray(match))) {
    return { reason: '`match` is an object of column name to value, as `format_rows` takes it.' }
  }
  const search = item['search']
  if (search !== undefined && typeof search !== 'string') return { reason: '`search` is the text looked for.' }
  const filter: RowFilter = {
    ...(match === undefined || Object.keys(match).length === 0 ? {} : { match: match as Record<string, unknown> }),
    ...(search === undefined || search.trim() === '' ? {} : { search }),
  }
  const read = filterQuery(db, declaration, filter, declared, day)
  if (!read.ok) {
    return {
      reason:
        read.error.kind === 'NO_COLUMN'
          ? `\`match\` names ${read.error.name}, which ${format} has not got.`
          : `\`match\`: ${read.error.reason}`,
    }
  }
  const address = canonicalAddress(filterAddress(filter))
  const block: DashboardBlock = { dashboard, format, kind: 'total', name, ...(typeof sum === 'string' ? { sum } : {}), address }
  return { block, what: `headline total: ${blockWhat(db, block, declared, false)}` }
}

/** The dashboard a format has, in a line — `formats`' arrangement says it. */
export function dashboardLine(db: Database, format: string): string | undefined {
  const blocks = dashboardBlocks(db, format)
  return blocks.length === 0
    ? undefined
    : `**Dashboard** — \`show_format view:dashboard\` draws it: ${blocks.map((each) => `\`${each.name}\` (${each.kind === 'total' ? 'headline total' : each.kind === 'saved' ? 'saved view' : 'rollup'})`).join(', ')}.`
}
