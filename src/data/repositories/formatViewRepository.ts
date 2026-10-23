/**
 * **A format's column widths, kept in the document** — M26 U2, D-289.
 *
 * Presentation rather than the domain layer, so it is kept beside the
 * declaration and never in it (`domain/format/view.ts`). Written by the sheet
 * and by `arrange_views` (M35 U4, D-403): the person a conversation works for is
 * looking at the page.
 */

import type { Database } from 'sql.js'

import {
  boundedCoordinate,
  boundedWidth,
  isBlockKind,
  isBoardPart,
  isSavedKind,
  isViewKind,
  isViewSetting,
  readEntrySetting,
  readListSetting,
  SAVED_ADDRESS_LONGEST,
  savedAddress,
  savedNameRefusal,
  soleWordOf,
  writeEntrySetting,
  writeListSetting,
  type ColumnWidth,
  type ShowAs,
  type EntrySetting,
  type GraphPlace,
  type BoardPart,
  type DashboardBlock,
  type SavedView,
  type ViewKind,
  type ViewSetting,
} from '@/domain/format/view.ts'
import { inTransaction, query } from '../db/database.ts'

/** Column name to its width, for one format. A column never sized has none. */
export function columnWidths(db: Database, format: string): ReadonlyMap<string, number> {
  return new Map(
    query(db, 'SELECT column_name, width FROM format_column_view WHERE format_name = ?', [format])
      .flatMap((row) => {
        const column = row['column_name']
        const width = row['width']
        return typeof column === 'string' && typeof width === 'number' ? [[column, width] as const] : []
      }),
  )
}

/** Size one column, or — given nothing — let it fall back to its type's width. */
export function setColumnWidth(
  db: Database,
  format: string,
  column: string,
  width: number | undefined,
): void {
  if (width === undefined) {
    db.run('DELETE FROM format_column_view WHERE format_name = ? AND column_name = ?', [format, column])
    return
  }
  db.run(
    `INSERT INTO format_column_view (format_name, column_name, width) VALUES (?, ?, ?)
       ON CONFLICT (format_name, column_name) DO UPDATE SET width = excluded.width`,
    [format, column, boundedWidth(width)],
  )
}

/** Every width in the document, for the text to carry (D-246). */
export function listColumnWidths(db: Database): readonly ColumnWidth[] {
  return query(
    db,
    'SELECT format_name, column_name, width FROM format_column_view ORDER BY format_name, column_name',
  ).flatMap((row) => {
    const format = row['format_name']
    const column = row['column_name']
    const width = row['width']
    if (typeof format !== 'string' || typeof column !== 'string' || typeof width !== 'number') return []
    return [{ format, column, width }]
  })
}

/** The inside of `applyDocument`: a text document's widths, after its formats. */
export function restoreColumnWidths(db: Database, widths: readonly ColumnWidth[]): void {
  if (widths.length === 0) return
  inTransaction(db, () => {
    for (const each of widths) setColumnWidth(db, each.format, each.column, each.width)
  })
}

/** Called by `deleteFormat`, for `forgetSeeds`'s reason. */
export function forgetColumnWidths(db: Database, format: string): void {
  db.run('DELETE FROM format_column_view WHERE format_name = ?', [format])
}

/**
 * **Where the bubbles sit on the connections canvas** — M26 U4, D-291.
 *
 * The same kind of thing as a width, kept the same way: per document, beside
 * the declarations, and written by the screen alone. A conversation draws no
 * canvas, so no tool writes here — `parity.test.ts` holds that refusal, which
 * D-403 left standing when it gave the other view settings a tool.
 */
export function graphPlaces(db: Database): readonly GraphPlace[] {
  return query(db, 'SELECT kind, name, x, y FROM format_graph_place ORDER BY kind, name').flatMap(
    (row) => {
      const kind = row['kind']
      const name = row['name']
      const x = row['x']
      const y = row['y']
      if (kind !== 'FORMAT' && kind !== 'PACK') return []
      if (typeof name !== 'string' || typeof x !== 'number' || typeof y !== 'number') return []
      return [{ kind, name, x, y }]
    },
  )
}

/**
 * Put bubbles where a drag left them — several at once, because moving a
 * pack's folded group moves every member that has a place of its own too.
 */
export function setGraphPlaces(db: Database, places: readonly GraphPlace[]): void {
  if (places.length === 0) return
  inTransaction(db, () => {
    for (const place of places) {
      db.run(
        `INSERT INTO format_graph_place (kind, name, x, y) VALUES (?, ?, ?, ?)
           ON CONFLICT (kind, name) DO UPDATE SET x = excluded.x, y = excluded.y`,
        [place.kind, place.name, boundedCoordinate(place.x), boundedCoordinate(place.y)],
      )
    }
  })
}

/** Forget every place, so the canvas draws by rank again. */
export function clearGraphPlaces(db: Database): void {
  db.run('DELETE FROM format_graph_place')
}

/** The inside of `applyDocument`: a text document's places, after its formats. */
export function restoreGraphPlaces(db: Database, places: readonly GraphPlace[]): void {
  setGraphPlaces(db, places)
}

/** Called by `deleteFormat`, for `forgetSeeds`'s reason. */
export function forgetGraphPlace(db: Database, format: string): void {
  db.run("DELETE FROM format_graph_place WHERE kind = 'FORMAT' AND name = ?", [format])
}

/**
 * **How each column is shown on the entry** — M26 U6, D-294; Show as since
 * M35 U3, D-402.
 *
 * Kept as a width and a place are: per document, beside the declaration, and
 * written by the entry view and by `arrange_views` (M35 U4, D-403). Column name
 * — a worked-out column's too — to its way; a column never given one has none
 * and draws with its type's default.
 */
export function entryInputs(db: Database, format: string): ReadonlyMap<string, ShowAs> {
  return new Map(
    [...entrySettings(db, format)].flatMap(([column, entry]) =>
      entry.way === undefined ? [] : [[column, entry.way] as const],
    ),
  )
}

/**
 * **Where each column comes on the entry page** — M26 F2, D-296. Column name
 * to its place, counting from 1; a page nobody arranged has none, and runs in
 * the declaration's order (`entryOrder`). Written as a way is.
 */
export function entryPlaces(db: Database, format: string): ReadonlyMap<string, number> {
  return new Map(
    [...entrySettings(db, format)].flatMap(([column, entry]) =>
      entry.place === undefined ? [] : [[column, entry.place] as const],
    ),
  )
}

/**
 * **Which columns sit in the entry's header line** beyond the ones their type
 * puts there (M35 U2, D-401) — what a page's `line` used to say. Written by a
 * pack's views, a text document's views part and `arrange_views` (D-403); no
 * screen sets it yet.
 */
export function entryHeaders(db: Database, format: string): ReadonlySet<string> {
  return new Set(
    [...entrySettings(db, format)].flatMap(([column, entry]) => (entry.header === true ? [column] : [])),
  )
}

/** Show a column one way on the entry, or — given nothing — its type's default back. */
export function setEntryInput(
  db: Database,
  format: string,
  column: string,
  way: ShowAs | undefined,
): void {
  const kept = entrySettings(db, format).get(column)
  writeEntry(db, format, column, { ...kept, way })
}

/** Put a column in the entry's header line, or take it out (M35 U4, D-403). */
export function setEntryHeader(db: Database, format: string, column: string, header: boolean): void {
  const kept = entrySettings(db, format).get(column)
  writeEntry(db, format, column, { ...kept, header: header ? true : undefined })
}

/**
 * **Which columns this entry view keeps off the page** (M53 U2, D-517) —
 * written by the entry's Fields list, a column's ⋯ and `arrange_views`. A
 * hidden column is still in the format, the table and every tool; the title
 * and a required column are drawn whatever this says.
 */
export function entryHidden(db: Database, format: string): ReadonlySet<string> {
  return new Set(
    [...entrySettings(db, format)].flatMap(([column, entry]) => (entry.hidden === true ? [column] : [])),
  )
}

/** Keep a column off the entry view, or show it again (M53 U2). */
export function setEntryHidden(db: Database, format: string, column: string, hidden: boolean): void {
  const kept = entrySettings(db, format).get(column)
  writeEntry(db, format, column, { ...kept, hidden: hidden ? true : undefined })
}

/**
 * **Which columns a new entry asks for** beside the required ones — the
 * *New entry* tick in the Fields list (M53 U2, D-517); M53 U3's new entry
 * reads it.
 */
export function entryAsked(db: Database, format: string): ReadonlySet<string> {
  return new Set(
    [...entrySettings(db, format)].flatMap(([column, entry]) => (entry.asked === true ? [column] : [])),
  )
}

/** Have a new entry ask for a column, or not (M53 U2). */
export function setEntryAsked(db: Database, format: string, column: string, asked: boolean): void {
  const kept = entrySettings(db, format).get(column)
  writeEntry(db, format, column, { ...kept, asked: asked ? true : undefined })
}

/**
 * Put the entry page's columns in this order — every column, as the page
 * shows them after a drag — or, given nothing, back in the declaration's. A
 * way a column was given stays with it either way.
 */
export function setEntryOrder(db: Database, format: string, columns: readonly string[] | undefined): void {
  inTransaction(db, () => {
    const settings = entrySettings(db, format)
    for (const [column, entry] of settings) {
      writeEntry(db, format, column, { ...entry, place: undefined })
    }
    if (columns === undefined) return
    columns.forEach((column, at) => {
      writeEntry(db, format, column, { ...settings.get(column), place: at + 1 })
    })
  })
}

/** Every column's entry setting for one format, read into its parts. */
function entrySettings(db: Database, format: string): ReadonlyMap<string, EntrySetting> {
  return new Map(
    query(
      db,
      "SELECT column_name, setting FROM format_view_column WHERE format_name = ? AND view = 'entry'",
      [format],
    ).flatMap((row) => {
      const column = row['column_name']
      const setting = row['setting']
      if (typeof column !== 'string' || typeof setting !== 'string') return []
      const entry = readEntrySetting(setting)
      return entry === undefined ? [] : [[column, entry] as const]
    }),
  )
}

/** One column's entry setting, written whole — or its row gone when nothing is left in it. */
function writeEntry(db: Database, format: string, column: string, entry: EntrySetting): void {
  const setting = writeEntrySetting(entry)
  if (setting === undefined) {
    db.run(
      "DELETE FROM format_view_column WHERE format_name = ? AND view = 'entry' AND column_name = ?",
      [format, column],
    )
    return
  }
  db.run(
    `INSERT INTO format_view_column (format_name, view, column_name, setting) VALUES (?, 'entry', ?, ?)
       ON CONFLICT (format_name, view, column_name) DO UPDATE SET setting = excluded.setting`,
    [format, column, setting],
  )
}

/**
 * **What a format's board keeps** — M27 U3, D-301. Column name to `lanes` or
 * `card`; a board nobody declared keeps nothing and draws by its first enum
 * (`boardOf`). A pack declares one in its `views.md`, beside its formats.
 */
export function boardSettings(db: Database, format: string): ReadonlyMap<string, BoardPart> {
  return new Map(
    query(
      db,
      "SELECT column_name, setting FROM format_view_column WHERE format_name = ? AND view = 'board'",
      [format],
    ).flatMap((row) => {
      const column = row['column_name']
      const setting = row['setting']
      if (typeof column !== 'string' || typeof setting !== 'string' || !isBoardPart(setting)) return []
      return [[column, setting] as const]
    }),
  )
}

/**
 * Lay a format's board by this enum column, or — given nothing — by its first
 * enum again. Written by the board and by `arrange_views` (D-403). The columns
 * a card shows are left as they are.
 */
export function setBoardLanes(db: Database, format: string, column: string | undefined): void {
  inTransaction(db, () => {
    db.run(
      "DELETE FROM format_view_column WHERE format_name = ? AND view = 'board' AND setting = 'lanes'",
      [format],
    )
    if (column === undefined) return
    db.run(
      `INSERT INTO format_view_column (format_name, view, column_name, setting) VALUES (?, 'board', ?, 'lanes')
         ON CONFLICT (format_name, view, column_name) DO UPDATE SET setting = excluded.setting`,
      [format, column],
    )
  })
}

/**
 * **What one view of one format keeps**, column name to its word — the
 * roadmap's and the page's (M27 U4, D-302), read the same way as a board's.
 * A word the kind does not keep is skipped rather than trusted.
 */
export function viewSettings(db: Database, format: string, view: ViewKind): ReadonlyMap<string, string> {
  return new Map(
    query(
      db,
      'SELECT column_name, setting FROM format_view_column WHERE format_name = ? AND view = ?',
      [format, view],
    ).flatMap((row) => {
      const column = row['column_name']
      const setting = row['setting']
      if (typeof column !== 'string' || typeof setting !== 'string' || !isViewSetting(view, setting)) return []
      return [[column, setting] as const]
    }),
  )
}

/** The kinds whose settings are a word per column that `setViewSetting` writes as it is. */
export type WordView = 'roadmap' | 'ready' | 'start' | 'agenda'

/**
 * **Set one column's word in a roadmap, a ready list or a start view, or clear
 * it** — M48 U3. What a pack's `views.md` writes, written by `arrange_views`
 * so a document made in a conversation gets the same views a pack declares. A
 * word only one column may hold (`soleWordOf`) is taken off the others first.
 * The word is the caller's to have checked against the column (`isViewSetting`
 * says only that the kind keeps it).
 */
export function setViewSetting(
  db: Database,
  format: string,
  view: WordView,
  column: string,
  setting: string | undefined,
): void {
  inTransaction(db, () => {
    const sole = setting === undefined ? undefined : soleWordOf(view, setting)
    if (sole !== undefined) {
      for (const [other, word] of viewSettings(db, format, view)) {
        if (other !== column && soleWordOf(view, word) === sole) {
          db.run('DELETE FROM format_view_column WHERE format_name = ? AND view = ? AND column_name = ?', [format, view, other])
        }
      }
    }
    if (setting === undefined) {
      db.run('DELETE FROM format_view_column WHERE format_name = ? AND view = ? AND column_name = ?', [format, view, column])
      return
    }
    db.run(
      `INSERT INTO format_view_column (format_name, view, column_name, setting) VALUES (?, ?, ?, ?)
         ON CONFLICT (format_name, view, column_name) DO UPDATE SET setting = excluded.setting`,
      [format, view, column, setting],
    )
  })
}

/**
 * Run a format's roadmap in this number column, or — given nothing — in its
 * first number again (M48 U3). Written by the roadmap's *In the order of* and
 * by `arrange_views`, as a board's lanes are. A column's `line` is left alone.
 */
export function setRoadmapOrder(db: Database, format: string, column: string | undefined): void {
  if (column !== undefined) {
    setViewSetting(db, format, 'roadmap', column, 'order')
    return
  }
  db.run("DELETE FROM format_view_column WHERE format_name = ? AND view = 'roadmap' AND setting = 'order'", [format])
}

/**
 * Put a format on the agenda by this date column, or — given nothing — by its
 * first date again (M49 U3, D-473). Written by the agenda's *by* and by
 * `arrange_views`, as a roadmap's order is. A `done` or a `line` is left alone.
 */
export function setAgendaDate(db: Database, format: string, column: string | undefined): void {
  if (column !== undefined) {
    setViewSetting(db, format, 'agenda', column, 'date')
    return
  }
  db.run("DELETE FROM format_view_column WHERE format_name = ? AND view = 'agenda' AND setting = 'date'", [format])
}

/**
 * **Set one column's words in a format's list, or clear them** — M53 U4,
 * D-519. The whole setting of the column (`group line`, `line done done`), as
 * `readListSetting` reads it; nothing clears it. `group` and `done` are one
 * column's each, so saying either here takes it off whichever other column
 * held it, and leaves that column's other words. Written by the list's
 * *Group by*, its tick (*Tick to mark…*, *No ticks*) and *Line*, and by `arrange_views`.
 */
export function setListSetting(db: Database, format: string, column: string, setting: string | undefined): void {
  const next = setting === undefined ? undefined : readListSetting(setting)
  inTransaction(db, () => {
    if (next !== undefined) {
      for (const [other, word] of viewSettings(db, format, 'list')) {
        const was = readListSetting(word)
        if (other === column || was === undefined) continue
        const kept = {
          group: was.group && !next.group,
          line: was.line,
          done: next.done === undefined ? was.done : undefined,
        }
        const written = writeListSetting(kept)
        if (written === word) continue
        if (written === undefined) {
          db.run("DELETE FROM format_view_column WHERE format_name = ? AND view = 'list' AND column_name = ?", [format, other])
        } else {
          db.run("UPDATE format_view_column SET setting = ? WHERE format_name = ? AND view = 'list' AND column_name = ?", [
            written,
            format,
            other,
          ])
        }
      }
    }
    const written = next === undefined ? undefined : writeListSetting(next)
    if (written === undefined) {
      db.run("DELETE FROM format_view_column WHERE format_name = ? AND view = 'list' AND column_name = ?", [format, column])
      return
    }
    db.run(
      `INSERT INTO format_view_column (format_name, view, column_name, setting) VALUES (?, 'list', ?, ?)
         ON CONFLICT (format_name, view, column_name) DO UPDATE SET setting = excluded.setting`,
      [format, column, written],
    )
  })
}

/** Every view's settings in the document, for the text to carry (D-246). */
export function listViewSettings(db: Database): readonly ViewSetting[] {
  return query(
    db,
    'SELECT format_name, view, column_name, setting FROM format_view_column ORDER BY format_name, view, column_name',
  ).flatMap((row) => {
    const format = row['format_name']
    const view = row['view']
    const column = row['column_name']
    const setting = row['setting']
    if (typeof format !== 'string' || typeof column !== 'string' || typeof setting !== 'string') return []
    if (typeof view !== 'string' || !isViewKind(view)) return []
    return [{ format, view, column, setting }]
  })
}

/** The inside of `applyDocument`: a text document's view settings, after its formats. */
export function restoreViewSettings(db: Database, settings: readonly ViewSetting[]): void {
  if (settings.length === 0) return
  inTransaction(db, () => {
    for (const each of settings) {
      db.run(
        `INSERT INTO format_view_column (format_name, view, column_name, setting) VALUES (?, ?, ?, ?)
           ON CONFLICT (format_name, view, column_name) DO UPDATE SET setting = excluded.setting`,
        [each.format, each.view, each.column, each.setting],
      )
    }
  })
}

/**
 * **Write view settings as a pack declares them, or take them off** (M51 U9,
 * D-491): each one's word, or — given none — its line gone. What keeping a pack
 * again writes where the document still held an earlier build's word; the
 * caller has already left out every place a person chose.
 */
export function writeViewSettings(
  db: Database,
  settings: readonly (Omit<ViewSetting, 'setting'> & { readonly setting: string | undefined })[],
): void {
  if (settings.length === 0) return
  inTransaction(db, () => {
    for (const each of settings) {
      if (each.setting === undefined) {
        db.run('DELETE FROM format_view_column WHERE format_name = ? AND view = ? AND column_name = ?', [
          each.format,
          each.view,
          each.column,
        ])
        continue
      }
      restoreViewSettings(db, [{ ...each, setting: each.setting }])
    }
  })
}

/** Called by `deleteFormat`, for `forgetSeeds`'s reason. */
export function forgetViewSettings(db: Database, format: string): void {
  db.run('DELETE FROM format_view_column WHERE format_name = ?', [format])
}

/**
 * **A format's saved views** — M53 U5, D-514, D-520: a filter, order, columns
 * and kind under a name, kept beside the format's other views and written by
 * the FilterBand and the rail, and by `arrange_views`. In name order, which is
 * the order the rail lists them and a text document writes them.
 */
export function savedViews(db: Database, format?: string): readonly SavedView[] {
  const rows =
    format === undefined
      ? query(db, 'SELECT format_name, name, kind, address FROM format_saved_view ORDER BY format_name, name')
      : query(db, 'SELECT format_name, name, kind, address FROM format_saved_view WHERE format_name = ? ORDER BY name', [format])
  return rows.flatMap((row) => {
    const owner = row['format_name']
    const name = row['name']
    const kind = row['kind']
    const address = row['address']
    if (typeof owner !== 'string' || typeof name !== 'string' || typeof kind !== 'string' || typeof address !== 'string') return []
    if (!isSavedKind(kind)) return []
    return [{ format: owner, name, kind, address }]
  })
}

/** One saved view by its name, or nothing. Case is kept, as a column's is. */
export function savedView(db: Database, format: string, name: string): SavedView | undefined {
  return savedViews(db, format).find((each) => each.name === name)
}

/**
 * Save a view, or write over the one of that name. Refused with a thrown
 * sentence when the name or the kind is not one a saved view takes — the
 * screen and the tool both ask `savedNameRefusal` first, so this is the gate
 * behind them.
 */
export function saveView(db: Database, view: SavedView): void {
  const refusal = savedNameRefusal(view.name)
  if (refusal !== undefined) throw new Error(refusal)
  if (!isSavedKind(view.kind)) throw new Error(`${String(view.kind)} is not a view a saved view opens.`)
  const address = savedAddress(view.address)
  if (address.length > SAVED_ADDRESS_LONGEST) throw new Error(`A saved view keeps at most ${String(SAVED_ADDRESS_LONGEST)} characters of address.`)
  db.run(
    `INSERT INTO format_saved_view (format_name, name, kind, address) VALUES (?, ?, ?, ?)
       ON CONFLICT (format_name, name) DO UPDATE SET kind = excluded.kind, address = excluded.address`,
    [view.format, view.name, view.kind, address],
  )
}

/** Give a saved view another name; one already called that is refused, never written over. */
export function renameSavedView(db: Database, format: string, from: string, to: string): void {
  const refusal = savedNameRefusal(to)
  if (refusal !== undefined) throw new Error(refusal)
  if (from === to) return
  if (savedView(db, format, to) !== undefined) throw new Error(`${format} already has a view called ${to}.`)
  db.run('UPDATE format_saved_view SET name = ? WHERE format_name = ? AND name = ?', [to, format, from])
  // A dashboard's block points at it by name (M53 U7), and follows it.
  db.run("UPDATE format_dashboard_block SET name = ? WHERE kind = 'saved' AND format_name = ? AND name = ?", [to, format, from])
}

export function deleteSavedView(db: Database, format: string, name: string): void {
  db.run('DELETE FROM format_saved_view WHERE format_name = ? AND name = ?', [format, name])
  // Its blocks go with it (M53 U7): a dashboard holds views, and this one is gone.
  db.run("DELETE FROM format_dashboard_block WHERE kind = 'saved' AND format_name = ? AND name = ?", [format, name])
}

/** The inside of `applyDocument`: a text document's saved views, after its formats. */
export function restoreSavedViews(db: Database, views: readonly SavedView[]): void {
  if (views.length === 0) return
  inTransaction(db, () => {
    for (const each of views) saveView(db, each)
  })
}

/** Called by `deleteFormat`, for `forgetSeeds`'s reason. */
export function forgetSavedViews(db: Database, format: string): void {
  db.run('DELETE FROM format_saved_view WHERE format_name = ?', [format])
}

/**
 * **A dashboard's blocks, in order** — M53 U7, D-514, D-521: a format's when
 * `dashboard` names it, the document's own when it is `undefined`. Written by
 * the dashboard's own screen and by `arrange_views view:dashboard`.
 */
export function dashboardBlocks(db: Database, dashboard: string | undefined): readonly DashboardBlock[] {
  const rows =
    dashboard === undefined
      ? query(db, 'SELECT * FROM format_dashboard_block WHERE dashboard IS NULL ORDER BY position, rowid')
      : query(db, 'SELECT * FROM format_dashboard_block WHERE dashboard = ? ORDER BY position, rowid', [dashboard])
  return rows.flatMap(blockOf)
}

/** Every dashboard's blocks — the document's first, then each format's by name, each in order. */
export function allDashboardBlocks(db: Database): readonly DashboardBlock[] {
  return query(db, "SELECT * FROM format_dashboard_block ORDER BY ifnull(dashboard, ''), position, rowid").flatMap(blockOf)
}

function blockOf(row: Readonly<Record<string, unknown>>): readonly DashboardBlock[] {
  const dashboard = row['dashboard']
  const format = row['format_name']
  const kind = row['kind']
  const name = row['name']
  const sum = row['sum']
  const address = row['address']
  const width = row['width']
  const height = row['height']
  if (typeof format !== 'string' || typeof kind !== 'string' || typeof name !== 'string' || !isBlockKind(kind)) return []
  return [
    {
      dashboard: typeof dashboard === 'string' ? dashboard : undefined,
      format,
      kind,
      name,
      ...(typeof sum === 'string' ? { sum } : {}),
      address: typeof address === 'string' ? address : '',
      // Its size (M53 F4, D-527); NULL is the size it had before there were sizes.
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
    },
  ]
}

/**
 * A dashboard's blocks, all of them, in this order — what adding one, moving
 * one and removing one each write. A block on a format's dashboard reads that
 * format; two blocks of one name and format are refused by the index.
 */
export function setDashboardBlocks(db: Database, dashboard: string | undefined, blocks: readonly DashboardBlock[]): void {
  inTransaction(db, () => {
    if (dashboard === undefined) db.run('DELETE FROM format_dashboard_block WHERE dashboard IS NULL')
    else db.run('DELETE FROM format_dashboard_block WHERE dashboard = ?', [dashboard])
    blocks.forEach((block, position) => {
      if (dashboard !== undefined && block.format !== dashboard) {
        throw new Error(`${dashboard}’s dashboard holds ${dashboard}’s own views; ${block.name} reads ${block.format}.`)
      }
      db.run(
        'INSERT INTO format_dashboard_block (dashboard, position, format_name, kind, name, sum, address, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          dashboard ?? null,
          position,
          block.format,
          block.kind,
          block.name,
          block.kind === 'total' ? (block.sum ?? null) : null,
          block.kind === 'total' ? savedAddress(block.address) : '',
          block.width ?? null,
          block.height ?? null,
        ],
      )
    })
  })
}

/** The inside of `applyDocument`: a text document's dashboards, after its formats and saved views. */
export function restoreDashboardBlocks(db: Database, blocks: readonly DashboardBlock[]): void {
  if (blocks.length === 0) return
  const keys = [...new Set(blocks.map((each) => each.dashboard ?? ''))]
  for (const key of keys) {
    const dashboard = key === '' ? undefined : key
    setDashboardBlocks(db, dashboard, blocks.filter((each) => (each.dashboard ?? '') === key))
  }
}

/** Called by `deleteFormat`: its dashboard, and every block anywhere that reads it. */
export function forgetDashboardBlocks(db: Database, format: string): void {
  db.run('DELETE FROM format_dashboard_block WHERE dashboard = ? OR format_name = ?', [format, format])
}
