/**
 * **A saved view, as a tool's arguments** — M53 U5, D-514, D-520.
 *
 * A saved view is what an address holds under a name: `format_rows` and
 * `show_format` take that name as `view` and read it here as the `match`,
 * `search`, `order` and `columns` they already take — so a conversation
 * draws *Due today* by its name and gets tomorrow's rows tomorrow, because a
 * window around today is kept as its phrase and worked out when it is asked.
 * Anything the call gives as well is laid over it: a `match` adds to the
 * view's, and a `search`, `order` or `columns` given replaces the view's.
 */

import type { Database } from 'sql.js'

import { savedView, savedViews } from '@/data/repositories/formatViewRepository.ts'
import type { SavedView } from '@/domain/format/view.ts'
import { addressView } from '@/ui/formats/addressFilter.ts'

import { ToolInputError } from './tool.ts'

/** A format's saved view by name, or the sentence naming the ones it has. */
export function savedViewNamed(db: Database, format: string, name: string): SavedView {
  const found = savedView(db, format, name)
  if (found !== undefined) return found
  const views = savedViews(db, format)
  throw new ToolInputError(
    views.length === 0
      ? `${format} has no saved views; \`arrange_views\` with \`view: saved\` saves one, and \`view\` here also takes table, board, list, roadmap or ready.`
      : `${format} has no saved view called ${name}. Its saved views: ${views.map((each) => each.name).join(', ')}.`,
  )
}

/**
 * The call's arguments with the saved view laid under them, and the view.
 * `folds` (a roadmap's `unit.state`) ride in `match`, as `show_format` takes
 * them; `withFolds: false` leaves them out, for `format_rows`, which reads one
 * format.
 */
export function savedViewArgs(
  view: SavedView,
  args: Record<string, unknown>,
  { withFolds = true, columnsAsList = false }: { readonly withFolds?: boolean; readonly columnsAsList?: boolean } = {},
): Record<string, unknown> {
  const held = addressView(view.address)
  const given = args['match']
  const match = {
    ...(held.filter.match ?? {}),
    ...(withFolds ? held.folds : {}),
    ...(given !== null && typeof given === 'object' && !Array.isArray(given) ? (given as Record<string, unknown>) : {}),
  }
  const own = held.columns[view.format]
  const rest: Record<string, unknown> = { ...args }
  delete rest['view']
  return {
    ...rest,
    ...(Object.keys(match).length === 0 ? {} : { match }),
    ...(args['search'] === undefined && held.filter.search !== undefined ? { search: held.filter.search } : {}),
    ...(args['order'] === undefined && held.order !== undefined
      ? { order: held.order.column, ...(args['descending'] === undefined ? { descending: held.order.descending } : {}) }
      : {}),
    ...(args['columns'] === undefined && Object.keys(held.columns).length > 0
      ? columnsAsList
        ? own === undefined || own.length === 0
          ? {}
          : { columns: own }
        : { columns: held.columns }
      : {}),
  }
}

/** A saved view in a line: `list, due is today` — its kind and what its address holds, as a model reads it. */
export function savedViewSaid(view: SavedView): string {
  const held = addressView(view.address)
  const parts = [
    ...Object.entries({ ...(held.filter.match ?? {}), ...held.folds }).map(([column, value]) => `${column}: ${JSON.stringify(value)}`),
    ...(held.filter.search === undefined ? [] : [`search "${held.filter.search}"`]),
    ...(held.order === undefined ? [] : [`order ${held.order.column}${held.order.descending ? ' descending' : ''}`]),
    ...Object.entries(held.columns).map(([format, columns]) => `${format} columns ${columns.join(', ') || 'name only'}`),
  ]
  return parts.length === 0 ? `${view.kind}, every row` : `${view.kind}, ${parts.join('; ')}`
}
