import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { toISODate } from '@/core/time.ts'
import {
  aggregatesOf,
  danglingLinks,
  indexOf,
  inputsFor,
  inputsWithAggregates,
} from '@/data/repositories/formatJoinRepository.ts'
import { stageRows } from '@/data/repositories/formatBatchRepository.ts'
import { adoptFormat, listFormats, planFor } from '@/data/repositories/formatRepository.ts'
import {
  countRows,
  deleteRows,
  describeTableError,
  insertRows,
  linkingSentences,
  linkLabels,
  listRows,
  readRow,
  repeatedValues,
  rowsLinkingTo,
  tableRefusals,
  updateRow,
} from '@/data/repositories/formatRowRepository.ts'
import {
  applyRuleSet,
  planRuleSet,
  withRules,
  type RuleSetPlan,
} from '@/data/repositories/formatRuleRepository.ts'
import { documentCurrency, listUnits, setDocumentCurrency } from '@/data/repositories/unitRepository.ts'
import { listReaders } from '@/data/repositories/formatIntakeRepository.ts'
import {
  boardSettings,
  columnWidths,
  entryAsked,
  entryHeaders,
  entryHidden,
  entryInputs,
  entryPlaces,
  setBoardLanes,
  setListSetting,
  viewSettings,
  setColumnWidth,
  setEntryAsked,
  setEntryHidden,
  setEntryInput,
  setEntryOrder,
} from '@/data/repositories/formatViewRepository.ts'
import {
  isLinkType,
  labelColumn,
  orderChange,
  tableNameFor,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { write } from '@/domain/format/artefact.ts'
import { evaluateIdentity } from '@/domain/format/identity.ts'
import { inputsWithTotals } from '@/domain/format/aggregate.ts'
import { gridOf, pasted } from '@/domain/format/paste.ts'
import {
  brokenConstraints,
  coerceRow,
  currencyKeyOf,
  identityInputsOf,
  readValue,
  screenWords,
  selfLinks,
  unitKeyOf,
  type RowVerdict,
  type StoredRow,
} from '@/domain/format/row.ts'
import {
  declarationOf,
  draftOf,
  draftProblems,
  followingRenames,
  moveColumn,
  newColumn,
  originOf,
  renamesOf,
  type FormatDraft,
} from '@/domain/format/draft.ts'
import {
  blankDraft,
  draftOfRow,
  isEmpty,
  offeredOf,
  withField,
  type RowDraft,
} from '@/domain/format/rowDraft.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { rowWriteRefusal } from '@/domain/format/owner.ts'
import { Chip } from '@/ui/components/Chip.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { cellText, EntryView, type LinkChoice } from '@/ui/formats/EntryView.tsx'
import { RollupView } from '@/ui/formats/RollupView.tsx'
import { RowSheet, type FootRefusal, type Order } from '@/ui/formats/RowSheet.tsx'
import { derivedOf } from '@/data/repositories/formatDerivedRepository.ts'
import { boardPath, entryPath, formatPath, listPath, NEW_ENTRY, readPath, readyPath, roadmapPath, tablePath } from '@/ui/nav.ts'
import { BoardView } from '@/ui/formats/BoardView.tsx'
import {
  boardOf,
  entryDefaults,
  entryNeeds,
  entryOrder,
  oneUnitOf,
  readListSetting,
  readsAsMarkdown,
  readyOf,
  roadmapOf,
  writeListSetting,
  type ListGroup,
} from '@/domain/format/view.ts'
import { ListPage } from '@/ui/formats/ListView.tsx'
import { groupKeyOf, listOrder, listPicture, quickAdd, type ListLine, type ListPicture } from '@/ui/formats/listView.ts'
import { entryLinked, entryLinks } from '@/data/repositories/formatLinkViewRepository.ts'
import { figureOf, isPercentFigure } from '@/ui/formats/EntryValue.tsx'
import { linkedRowOf, type LinkedRow } from '@/ui/formats/LinkViews.tsx'
import type { RowDerived } from '@/data/repositories/formatDerivedRepository.ts'
import { convert, type UnitTable } from '@/domain/format/unit.ts'
import { today } from '@/ui/today.ts'
import type { RowQuery } from '@/data/repositories/formatRowRepository.ts'
import type { Database } from 'sql.js'

import { ReadersLine } from '@/ui/formats/ReadersLine.tsx'
import { ShapePanel, type ShapeFocus } from '@/ui/formats/ShapePanel.tsx'
import { inDraftOrder, sheetMark } from '@/ui/formats/shape.ts'
import { WhatLooksWrong } from '@/ui/formats/WhatLooksWrong.tsx'
import { auditFormat, joinedTally } from '@/data/repositories/formatAuditRepository.ts'
import { Reveal } from '@/ui/motion/Reveal.tsx'
import { AddsUpPlace } from '@/ui/formats/AddsUpPlace.tsx'
import { ReadOnly } from '@/ui/formats/readOnly.ts'
import { ColumnFilter, ColumnMenu, FilterBand, filteredQuery, useAddressFilter } from '@/ui/formats/FilterBand.tsx'
import { isFiltered, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { EntryList } from '@/ui/formats/EntryList.tsx'
import { heldIds, listColumns, listQuery } from '@/ui/formats/entryList.ts'
import { filterAddress } from '@/ui/formats/addressFilter.ts'
import { toggleEntryList, useEntryListHidden } from '@/ui/useEntryList.ts'

/**
 * **A format's rows, on the format's own screen** — M20 U1
 * ([D-227](../../../docs/09-decision-log.md)).
 *
 * This is the hole D-227 named, filled. M19 built an engine that could declare a
 * kind of thing and then print `31 columns · 0 rows` about it: a row was only
 * ever visible, and only ever writable, from a conversation, so every verdict
 * the engine computed arrived in the app as a tally on a list or not at all.
 * **A document app that cannot show its own rows is not one.**
 *
 * So a format's name is a place. It has a route, it is a child of `Formats` in
 * the rail, and the four things `record_format_rows`, `format_rows`,
 * `update_format_rows` and `delete_format_rows` have been able to do since M19
 * U2 are the four things on it.
 *
 * ## Every write goes through the engine's own coercion
 *
 * `coerceRow`, then `danglingLinks`, then `insertRows` or `updateRow` — the same
 * three the plugin runs, in the same order, with the same sentences printed
 * verbatim (D-217). **The form checks nothing of its own**, which is M20's
 * parity rule at the smallest scale it has: two implementations of *is this a
 * valid date* is how a screen and a tool come to hold different opinions about
 * one document.
 *
 * ## The verdicts are folded, not merely evaluated
 *
 * A row's proof is computed through `inputsWithAggregates`, so an identity that
 * names a total across a link says the same thing here as it does in the editor
 * and in a conversation. Evaluating without the fold would have been cheaper and
 * would have printed `unchecked` on this screen for a row that proves elsewhere
 * — a verifier reporting something other than what it checked, which is the law
 * this project keeps rediscovering (D-138).
 *
 * **That is a query per aggregate per row**, which is why the table is capped
 * and says so. A declared table has never been in `scale.test.ts`.
 *
 * ## A sheet, since M26 U2
 *
 * The entries are `RowSheet`: columns as wide as somebody dragged them (kept in
 * the document beside the declaration, D-289), empty rows at the foot to type
 * straight into, and a block pasted from a spreadsheet landing in the cells it
 * was pasted over. **A foot row and a paste are the batch `record_format_rows`
 * writes** — `stageRows`, whole or not at all — and a refusal stays on the cell
 * it names. Search reads every column as it is shown, and Ctrl+F finds it.
 *
 * ## And the format is changed here too, since M26 U3
 *
 * There is no declaration panel and no separate edit. A column's header opens
 * its name, type and checks under the sheet; the `+` after the last header adds
 * one; the band under the toolbar, *What has to add up*, opens the identities
 * (M29 U1, D-331 — it was a small `=` icon). Each is `ShapePanel`, which says what
 * saving would do to the entries already here before anything is written, and
 * saves through the same `adoptFormat` a new format and the tools use — with a
 * rename passed as one, so a column keeps its values under its new name.
 *
 * ## And one entry is a page, since M26 U6
 *
 * `#/formats/:name/entry/:id` is the same screen showing one row as
 * `EntryView` — a view the format has, beside the sheet, which stays the
 * default (D-294). Every row has a button to it, and Add opens it for a row not
 * written yet (`entry/new`). It writes through the same `coerceRow` and the
 * same `insertRows` and `updateRow` the sheet does, which is why it is here and
 * not a screen of its own.
 *
 * `accent` marks the actions and colours no figure (D-125).
 */
export function FormatRows({ board = false, list = false }: { readonly board?: boolean; readonly list?: boolean } = {}) {
  const { name, entry } = useParams<{ name: string; entry: string }>()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  // Drawn where nothing is written — the MCP App's frame (M41 U2) — or not.
  const readOnly = useContext(ReadOnly)

  // What has been typed on an entry page and not written, by the entry it is for.
  const [typed, setTyped] = useState<{ readonly key: string; readonly draft: RowDraft } | undefined>()
  // **The filter is the address's** (M44 U6, U7): `?state=open&search=bidi`,
  // so back, a reload and a bookmark keep it, and the frame opens on it.
  // The sort rides there too (M42 F14): the table and an entry are two routes,
  // and this screen is drawn afresh between them.
  const { filter, address, set: setFilter, clear: clearFilter, columns, setColumns, order, setOrder } = useAddressFilter()
  const search = filter.search ?? ''
  const setSearch = (text: string): void => setFilter({ ...filter, search: text }, true)
  const filtered = isFiltered(filter)
  // The rows, or one of the format's rollups by name (M25 E2, D-271).
  const [view, setView] = useState<string | undefined>(undefined)
  const [deleting, setDeleting] = useState<StoredRow | undefined>(undefined)
  // A rule set's dry run, shown before it writes (M25 E4, D-273).
  const [applying, setApplying] = useState<RuleSetPlan | undefined>(undefined)
  // What is typed or pasted at the foot and not written yet (M26 U2).
  const [foot, setFoot] = useState<FootState>(EMPTY_FOOT)
  const searchField = useRef<HTMLInputElement>(null)
  // The drafts a write last took. Enter writes a row and moves down, and the
  // move is a blur that asks again from the same render — so the second ask
  // sees the very array the first one wrote, and is not a second insert.
  const spent = useRef<readonly RowDraft[] | undefined>(undefined)

  // The format's shape, being changed under the sheet (M26 U3), or nothing.
  const [shaping, setShaping] = useState<Shaping | undefined>(undefined)
  // What the last card moved on the board was refused with (M27 U3) — or the
  // last tick, or row added in place, on the list (M53 U4).
  const [moveRefusal, setMoveRefusal] = useState<string | undefined>(undefined)
  // A write the checks passed and the document still refused — said on the
  // page that asked for it, never swallowed (M29 F2, D-343).
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // **A field left with a value the format refused** (M35 U2, D-401): which
  // field, and the sentence — said there, and nothing written.
  const [refused, setRefused] = useState<{ readonly column: string; readonly text: string } | undefined>()
  // When this entry was last written from here, as the bar says it.
  const [written, setWritten] = useState<string | undefined>(undefined)
  // Asked about one entry's delete from its own view.
  const [deletingEntry, setDeletingEntry] = useState(false)
  useEffect(() => {
    setRefused(undefined)
    setWritten(undefined)
    setDeletingEntry(false)
  }, [name, entry])

  // A different format is a different sheet: nothing typed at one foot follows,
  // and nothing half-changed about the last one either.
  useEffect(() => {
    setFoot(EMPTY_FOOT)
    setShaping(undefined)
    setMoveRefusal(undefined)
  }, [name, board, list])

  /**
   * **A declaration read in for a format this document already has** (M29 U1,
   * D-331) arrives as the change waiting under its sheet, not written: the
   * walk used to be where it was read, and this panel is where a change to
   * one is read now. Taken once, and the history entry forgets it, so going
   * back does not open it a second time.
   */
  const location = useLocation()
  useEffect(() => {
    const imported = (location.state as ImportedShape | null)?.imported
    if (imported === undefined || imported.name !== name) return
    const draft = draftOf(imported)
    setShaping({ draft, focus: { kind: 'ADDS_UP' }, origin: originOf(draft) })
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, name])

  // **Ctrl+F is this page's search**, not the window's find bar — which the
  // shell does not have, and which would find only the entries drawn.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      const field = searchField.current
      if (field === null) return
      event.preventDefault()
      field.focus()
      field.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const data = useMemo(() => {
    if (db === undefined || name === undefined) return undefined
    const declarations = listFormats(db)
    const declaration = declarations.find((each) => each.name === name)
    if (declaration === undefined) return { declaration: undefined }

    const formats = indexOf(declarations)
    const units = listUnits(db)
    const sort = sortOf(declaration, order)
    const { query: asked, refusal } = filteredQuery(db, declaration, filter, declarations)
    const query: RowQuery = {
      ...asked,
      ...(sort === undefined ? {} : { order: sort.column, descending: sort.descending }),
    }
    const total = countRows(db, declaration, query)
    const entries = asked.match === undefined && asked.windows === undefined && asked.search === undefined ? total : countRows(db, declaration, {})
    const rows = listRows(db, declaration, { ...query, limit: PAGE })
    // The worked-out columns of the rows shown, out of the format's view (D-334).
    const worked = derivedOf(db, declaration, rows, formats, units, toISODate(today()))
    const measures = entryMeasures(declaration, rows, worked, units)

    return {
      declaration,
      declarations,
      formats,
      units,
      // What a new amount starts in when no entry above says (M29 F3, D-344).
      currency: documentCurrency(db),
      total,
      entries,
      refusal,
      // Every row the filter holds, uncapped: what the entry's list reads (M37 U2b).
      query,
      rows: rows.map((row) => ({
        row,
        verdicts: foldedVerdicts(db, declaration, row, formats, units),
        aggregates: aggregatesOf(db, declaration, row, formats, units),
        derived: worked.get(row.id) ?? [],
      })),
      // Only the formats a `link` column of this one actually targets, and only
      // once each: two columns pointing at `ingredient` are one list.
      links: linkChoices(db, declaration, formats),
      // **What the rows this page's links point at are called.** The picker
      // above has had this since U1 and the table never did, so a column of
      // uuids was the one thing on this screen nobody could read (M22 U1).
      labels: linkLabels(db, rows, declaration, declarations),
      widths: columnWidths(db, declaration.name),
      // What this format is read from (M26 U5): its readers live on it, not in
      // settings.
      readers: listReaders(db, declaration.name),
      // How each column is filled in on the entry page (M26 U6).
      chosen: entryInputs(db, declaration.name),
      // The columns its header line takes beyond their type's (M35 U2, D-401).
      headers: entryHeaders(db, declaration.name),
      // What its entry hides, and what a new entry asks for (M53 U2, D-517).
      hidden: entryHidden(db, declaration.name),
      asked: entryAsked(db, declaration.name),
      // **A text reads as markdown** unless somebody chose (D-401): any value
      // of it on the page of rows holding a line break, a line's worth, or
      // inline markdown (D-402).
      long: new Set(
        declaration.columns
          .filter((column) => column.type === 'text')
          .filter((column) =>
            readsAsMarkdown(
              rows.map((row) => {
                const value = readValue(column, row)
                return typeof value === 'string' ? value : ''
              }),
            ),
          )
          .map((column) => column.name),
      ),
      // What a bar is measured against, and the one unit a quantity is shown
      // in, over the page of rows (D-402).
      largest: measures.largest,
      oneUnit: measures.oneUnit,
      // Where each column comes on it, if somebody moved one (M26 F2, D-296).
      places: entryPlaces(db, declaration.name),
      // The board, when it is the view (M27 U3, D-301): every row up to its
      // own cap rather than the sheet's, since a lane is read whole.
      board: board ? boardData(db, declaration, declarations, query) : undefined,
      // The list, when it is the view (M53 U4, D-519): every row the filter
      // holds, uncapped, as the list beside an entry reads them.
      list: list
        ? listPicture(db, declaration, declarations, query, viewSettings(db, declaration.name, 'list'), toISODate(today()))
        : undefined,
      // Whether the tab strip offers a roadmap (M27 U4, D-302): a number to
      // run in, and another format naming this one.
      hasRoadmap:
        roadmapOf(declaration, declarations, (format) => viewSettings(db, format, 'roadmap')) !== undefined,
      // And a ready view (M27 U5, D-303), when the format declares one.
      hasReady: readyOf(declaration, viewSettings(db, declaration.name, 'ready')) !== undefined,
      // What the identities say across every entry, for the band that names
      // them (M29 U1) — the same tally the list of formats draws.
      proof:
        declaration.identities.length === 0
          ? undefined
          : joinedTally(db, declaration, formats, units),
      // What the engine can see is wrong without being asked (M34 U3, D-396).
      audit: auditFormat(db, declaration, formats, units),
    }
    // `revision` is the dependency that matters: every mutation bumps it.
  }, [db, name, revision, filter, order, board, list])

  /**
   * **The entry the route names** (M26 U6), as a draft: what was typed on its
   * page if anything was, and otherwise the stored row — or, for `new`, a blank
   * one carrying the last entry's currency and unit, as the foot does. An id
   * this format has no row for is `MISSING`, and the page goes back to the sheet.
   */
  const editing = useMemo(() => {
    if (db === undefined || entry === undefined || data?.declaration === undefined) return undefined
    const declaration = data.declaration
    const key = `${declaration.name}/${entry}`
    if (entry === NEW_ENTRY) {
      return {
        key,
        existing: undefined,
        // **A required enum starts at its first member** (M53 U3, D-518): a
        // default the view applies, drawn in its field, never a value a model makes.
        draft:
          typed?.key === key
            ? typed.draft
            : { ...blankDraft(declaration, data.rows[data.rows.length - 1]?.row, data.currency), ...entryDefaults(declaration.columns) },
        stored: undefined,
        aggregates: [],
        derived: [],
        named: undefined,
        linked: new Map<string, LinkedRow>(),
      }
    }
    const row = readRow(db, declaration, entry)
    if (row === undefined) return 'MISSING' as const
    return {
      key,
      existing: row.id,
      draft: typed?.key === key ? typed.draft : draftOfRow(declaration, row),
      stored: draftOfRow(declaration, row),
      // Read for this row, not looked up among the ones the sheet drew: a row
      // past the cap or outside a search has its totals too.
      aggregates: aggregatesOf(db, declaration, row, data.formats, data.units),
      derived: derivedOf(db, declaration, [row], data.formats, data.units, toISODate(today())).get(row.id) ?? [],
      // What names it, one hop — the page's, before the two were one (D-401).
      named: entryLinks(db, declaration, data.declarations, row.id),
      // What its own links name, for a card or a list to draw (D-402).
      linked: linkedRows(db, declaration, data.declarations, row),
    }
  }, [db, entry, data, typed])

  /**
   * The draft, coerced — on every keystroke, because a refusal is useful while
   * it is being caused rather than after.
   *
   * The verdicts come off the same cells that would be stored, so what the panel
   * says the row proves is what the row will prove.
   */
  const judgeEntry = (draft: RowDraft) => {
    if (db === undefined || editing === undefined || editing === 'MISSING' || data?.declaration === undefined) {
      return undefined
    }
    const declaration = data.declaration
    // **A new entry says what it needs in one line** (M53 U3, D-518): the first
    // required column that holds nothing — "A task needs a title." — said once
    // Add is pressed.
    if (editing.existing === undefined) {
      const needs = entryNeeds(declaration.title, entryOrder(declaration.columns, data.places), (column) => {
        const text = (draft[column] ?? '').trim()
        return text !== '' && text !== '[]'
      })
      if (needs !== undefined) return { problem: needs, verdicts: [] as readonly RowVerdict[] }
    }
    // **An untouched row is refused before it is coerced.** A format with no
    // required column would otherwise accept an entirely blank row, and no
    // message about it would be useful — nothing is wrong with it, it is just a
    // row nobody meant. Asked of the *offered* row, so a currency the form
    // carried forward by itself does not count as having been typed — nor a
    // member a new entry starts at (D-518).
    const offered = offeredOf(declaration, draft)
    const defaults = editing.existing === undefined ? entryDefaults(declaration.columns) : {}
    const touched = Object.fromEntries(
      Object.entries(offered).filter(([column, value]) => defaults[column] === undefined || defaults[column] !== value),
    )
    if (isEmpty(touched)) {
      return {
        problem: 'Nothing has been filled in yet.',
        verdicts: [] as readonly RowVerdict[],
      }
    }
    const typed = coerceRow(declaration, offered, data.units)
    if (!typed.ok) return { problem: typed.error, verdicts: [] as readonly RowVerdict[] }
    // A rule set over this format sets what it matches, and a link a person
    // changed here is theirs from now on (M25 E4, D-273).
    const before = editing.existing === undefined ? undefined : readRow(db, declaration, editing.existing)
    const ruled = withRules(db, declaration, typed.value, before?.cells)
    const coerced = { value: ruled.cells }

    const dangling = [
      // A link found by a date that found no row, or two (D-350).
      ...ruled.refusals.map((each) => each.reason),
      ...danglingLinks(db, declaration, coerced.value, data.formats),
      // A row may not name itself (M27 U5, D-303) — only an edit has an id to.
      ...(editing.existing === undefined ? [] : selfLinks(declaration, editing.existing, coerced.value)),
    ]
    // A unique column the form has no control for yet (D-255) still refuses a
    // repeat here, in words, rather than as SQLite's constraint error.
    const repeated = repeatedValues(db, declaration, [coerced.value], [editing.existing])
    // A row constraint (D-259) the form has no control for until M26.
    const broken = brokenConstraints(declaration, coerced.value)
    const checked = [...dangling, ...repeated.map((each) => each.message), ...broken]
    // **And the table's own word** (M29 F2, D-343): the row written and taken
    // back, so what SQLite would refuse is a sentence here before Add, rather
    // than an exception after it.
    const refused =
      checked.length > 0
        ? checked
        : tableRefusals(
            db,
            declaration,
            [coerced.value],
            editing.existing === undefined ? undefined : { existing: editing.existing },
          ).map((each) => each.reason)
    const staged: StoredRow = { id: editing.existing ?? '', cells: coerced.value }
    // The draft's own figures, one hop through its links, and **its totals** —
    // which fold other rows and not this one, so the stored row's are the
    // draft's too. Without them an identity naming a total said `unchecked`
    // here while the sheet beside it said `proved` (M29 F7).
    const [hopped] = inputsFor(db, declaration, [staged], data.formats)
    const inputs = inputsWithTotals(hopped ?? identityInputsOf(declaration, staged), editing.aggregates)
    return {
      problem: refused.length > 0 ? refused.join(' ') : undefined,
      verdicts: declaration.identities.map((identity) => ({
        identity,
        verdict: evaluateIdentity(identity, inputs, data.units),
      })),
      // The same row, as the numbers the verdicts came off — so the balance
      // beside each one is a picture of that verdict rather than of another
      // reading of the draft (D-232).
      inputs,
      cells: coerced.value,
    }
  }
  const judged = useMemo(
    () => (editing === undefined || editing === 'MISSING' ? undefined : judgeEntry(editing.draft)),
    [db, editing, data?.declaration, data?.formats, data?.units, revision],
  )

  /**
   * **The entry's list** (M37 U2b, D-475 2B): every row the pager walks — the
   * address's filter in the Table's order, uncapped — as the list draws them.
   * Read once per change of the rows, not of the entry: paging reads nothing.
   */
  const onEntry = entry !== undefined && entry !== NEW_ENTRY
  const listHidden = useEntryListHidden()
  // A new entry keeps the list beside it too (M53 U3), with its draft as a row.
  // **It is the list view, narrow** (M53 U4, D-519): the same groups and ticks.
  const pictured = useMemo(() => {
    if (entry === undefined || db === undefined || data === undefined || data.declaration === undefined) return undefined
    return listPicture(
      db,
      data.declaration,
      data.declarations,
      data.query,
      viewSettings(db, data.declaration.name, 'list'),
      toISODate(today()),
    )
  }, [entry, db, data])
  const listed = useMemo(() => (pictured === undefined ? undefined : listOrder(pictured)), [pictured])

  /**
   * **An entry opened from outside the list's search lets the search go** —
   * the palette, *Links here*, the rail's folder — so the list always holds
   * the entry beside it and its foot never says *– of 20*. Asked on arriving
   * at an entry only: a search typed in the list that holds nothing stays.
   * A column held as well is kept when the entry is in it, and let go too
   * when it is not.
   */
  useEffect(() => {
    if (!onEntry || listed === undefined || entry === undefined || name === undefined) return
    if (db === undefined || data?.declaration === undefined || !isFiltered(filter)) return
    if (listed.some((row) => row.id === entry)) return
    const kept: RowFilter = filter.match === undefined ? {} : { match: filter.match }
    const query = listQuery(db, data.declaration, data.declarations, kept, sortOf(data.declaration, order), toISODate(today()))
    const holds = isFiltered(kept) && heldIds(db, data.declaration, query).includes(entry)
    navigate(entryPath(name, entry) + filterAddress(holds ? kept : {}, order === undefined ? {} : { order }), {
      replace: true,
    })
  }, [name, entry])

  /**
   * The changed shape, judged on every keystroke as a new format's is, and the
   * plan asked for only once it is a declaration the document would accept.
   */
  const shaped = useMemo(() => {
    if (db === undefined || shaping === undefined || data?.declaration === undefined) return undefined
    const renames = renamesOf(shaping.draft, shaping.origin)
    const followed = followingRenames(shaping.draft, renames)
    const problems = draftProblems(followed, data.declarations, data.units)
    const next = declarationOf(followed)
    return {
      problems,
      renames,
      next,
      // The identities a rename rewrote, said under the plan.
      followed: followed.identities
        .filter((each, at) => each.expression !== shaping.draft.identities[at]?.expression)
        .map((each) => each.name),
      plan: problems.length > 0 ? undefined : planFor(db, next, renames),
      // What a move does to the order, and to what the entries are called by (D-332).
      order: orderChange(data.declaration, next, renames),
      changed: JSON.stringify(next) !== JSON.stringify(declarationOf(draftOf(data.declaration))),
    }
  }, [db, shaping, data?.declaration, data?.declarations, data?.units, revision])

  if (db === undefined || data === undefined) {
    return <Centered>Open a document to see what it holds.</Centered>
  }

  // A hash naming a format this document has not got — a stale bookmark, or one
  // that was deleted from a conversation while the tab was open.
  if (data.declaration === undefined) {
    return <Navigate to="/formats" replace />
  }

  const declaration = data.declaration
  // A pack's format is read here and written only through the pack (M25 E5,
  // D-269): no add, no edit, no remove, and the sentence saying where instead.
  // A copy nothing is saved from is locked the same way (M41 U2), and says
  // so once, at the top of the frame, rather than here.
  const locked = rowWriteRefusal(declaration) ?? readOnly
  // A view named by a rollup the format no longer declares falls back to the rows.
  const shownRollup =
    !board && (declaration.rollups ?? []).some((each) => each.name === view) ? view : undefined
  // Every format with an enum has a board (M27 U3, D-301).
  const enums = declaration.columns.filter((each) => each.type === 'enum')
  const hasBoard = enums.length > 0

  // A board asked of a format with no enum — a stale bookmark, or one retyped.
  if (board && data.board === undefined) {
    return <Navigate to={formatPath(declaration.name)} replace />
  }

  /**
   * **A card moved to another lane** (M27 U3): one column of one row changed,
   * judged by what `update_format_rows` judges it by — the rules, the links,
   * the row's constraints and its unique columns, on the row as it would
   * stand — and written by the same `updateRow`.
   */
  const move = (row: StoredRow, column: string, member: string | number): boolean => {
    if (locked !== undefined) return false
    const before = readRow(db, declaration, row.id)
    if (before === undefined) return false
    const ruled = withRules(db, declaration, { [column]: member }, before.cells)
    const cells = ruled.cells
    const standing = { ...before.cells, ...cells }
    const refused = [
      ...ruled.refusals.map((each) => each.reason),
      ...danglingLinks(db, declaration, cells, data.formats),
      ...brokenConstraints(declaration, standing),
      ...repeatedValues(db, declaration, [standing], [row.id]).map((each) => each.message),
    ]
    if (refused.length > 0) {
      setMoveRefusal(refused.join(' '))
      return false
    }
    setMoveRefusal(undefined)
    mutate((database) => {
      updateRow(database, declaration, row.id, cells)
    })
    return true
  }

  /**
   * **A tick on the list** (M53 U4, D-519): the column that ticks a row set to
   * what `tickValue` says — a move, as a card's is, through the same checks.
   */
  const tickLine = (picture: ListPicture, line: ListLine, value: string): void => {
    const done = picture.shape.done
    if (done === undefined) return
    move(line.row, done.column.name, done.column.type === 'boolean' ? (value === 'true' ? 1 : 0) : value)
  }

  /**
   * **A row added in place** (M53 U4, D-519): the title typed, the group's
   * value, the filter's exact values and a required enum's first member — the
   * batch `record_format_rows` writes, whole or not at all. A required column
   * nothing fills opens entry/new with what it has, rather than refusing.
   */
  const addLine = (picture: ListPicture, group: ListGroup<ListLine> | undefined, title: string): boolean => {
    if (locked !== undefined) return false
    const asked = quickAdd(
      declaration,
      picture.shape,
      group?.implies ?? {},
      filter,
      toISODate(today()),
      picture.names,
      data.rows[data.rows.length - 1]?.row,
      data.currency,
    )
    const named = picture.shape.name
    const draft = named === undefined ? asked.draft : { ...asked.draft, [named.name]: title }
    if (asked.missing.length > 0 || named === undefined) {
      setTyped({ key: `${declaration.name}/${NEW_ENTRY}`, draft })
      navigate(entryPath(declaration.name, NEW_ENTRY) + address)
      return false
    }
    const batch = stageRows(db, declaration, [offeredOf(declaration, draft)], data.declarations)
    const [first] = batch.refusals
    if (first !== undefined) {
      setMoveRefusal(`Not added: ${first.reason}`)
      return false
    }
    try {
      mutate((database) => {
        insertRows(
          database,
          declaration,
          batch.accepted.map((each) => each.cells),
          batch.accepted.map((each) => each.id),
        )
      })
    } catch (error) {
      setMoveRefusal(`Not added: ${describeTableError(declaration, error).reason}`)
      return false
    }
    setMoveRefusal(undefined)
    return true
  }

  /** Quick add's placeholder for a group, naming every value the row will take. */
  const placeholderOf = (picture: ListPicture, group: ListGroup<ListLine> | undefined): string =>
    quickAdd(declaration, picture.shape, group?.implies ?? {}, filter, toISODate(today()), picture.names).placeholder

  // An entry the format has no row for — deleted, or a stale bookmark. A delete
  // lands here too: the router moves the address in a transition, so the
  // document's write is drawn first, on the entry's own address (M42 F12) —
  // the table it goes to keeps the filter the entry was opened from.
  if (editing === 'MISSING') {
    return <Navigate to={tablePath(declaration.name, address)} replace />
  }

  if (editing !== undefined && judged !== undefined) {
    const key = editing.key
    const existing = editing.existing
    const back = (): void => {
      setTyped(undefined)
      navigate(tablePath(declaration.name, address))
    }
    /**
     * **A field left, or a pick made** (M35 U2, D-401): the draft judged as
     * it stands, and — for a row that exists — the columns it changed written
     * by the same `updateRow` the sheet and the tools use. Refused, it stays
     * typed with the sentence under the field, and nothing is written. A new
     * entry only keeps what was typed until Add.
     */
    const commit = (column: string, next?: RowDraft): void => {
      const draft = next ?? editing.draft
      if (existing === undefined || locked !== undefined) {
        if (next !== undefined) setTyped({ key, draft })
        return
      }
      const stored = readRow(db, declaration, existing)
      if (stored === undefined) return
      const verdict = judgeEntry(draft)
      if (verdict === undefined) return
      const cells = 'cells' in verdict ? verdict.cells : undefined
      if (verdict.problem !== undefined || cells === undefined) {
        setTyped({ key, draft })
        setRefused({ column, text: verdict.problem ?? 'Nothing has been filled in yet.' })
        return
      }
      const changed = Object.fromEntries(
        Object.entries(cells).filter(
          ([name, value]) => JSON.stringify(value ?? null) !== JSON.stringify(stored.cells[name] ?? null),
        ),
      )
      setRefused(undefined)
      if (Object.keys(changed).length === 0) {
        setTyped(undefined)
        return
      }
      try {
        mutate((database) => {
          updateRow(database, declaration, existing, changed)
        })
      } catch (error) {
        setTyped({ key, draft })
        setRefused({ column, text: describeTableError(declaration, error).reason })
        return
      }
      setTyped(undefined)
      setWritten(clockNow())
    }
    // The rows the list holds — the sheet's filter and order, uncapped: where this one is.
    const ids = (listed ?? []).map((row) => row.id)
    const at = existing === undefined ? -1 : ids.indexOf(existing)
    const storedRow = existing === undefined ? undefined : readRow(db, declaration, existing)
    const openHere = (id: string): void => {
      setTyped(undefined)
      navigate(entryPath(declaration.name, id) + address)
    }
    /**
     * The list's search, written to the address as the Table's is. When it
     * stops holding the entry, the entry beside it becomes the first it holds
     * (the mockup's `input`); holding nothing, the entry stays.
     */
    const searchList = (next: RowFilter): void => {
      if (existing === undefined) return
      const query = listQuery(db, declaration, data.declarations, next, sortOf(declaration, order), toISODate(today()))
      const held = heldIds(db, declaration, query)
      const to = held.length === 0 || held.includes(existing) ? existing : (held[0] ?? existing)
      if (to !== existing) setTyped(undefined)
      navigate(entryPath(declaration.name, to) + filterAddress(next, order === undefined ? {} : { order }), {
        replace: true,
      })
    }
    const view = (
      <EntryView
        // Each entry is drawn afresh as it arrives: nothing half-typed in one
        // field follows the list to the next entry.
        key={existing ?? NEW_ENTRY}
        declaration={declaration}
        draft={editing.draft}
        units={data.units}
        links={data.links}
        labels={editing.named?.labels ?? data.labels}
        chosen={data.chosen}
        places={data.places}
        headers={data.headers}
        hidden={data.hidden}
        asked={data.asked}
        long={data.long}
        largest={data.largest}
        oneUnit={data.oneUnit}
        linked={editing.linked}
        today={toISODate(today())}
        problem={spoken(judged.problem ?? failure, declaration)}
        refused={refused}
        inputs={'inputs' in judged ? judged.inputs : undefined}
        verdicts={judged.verdicts}
        aggregates={editing.aggregates}
        derived={editing.derived}
        named={editing.named}
        findings={
          existing === undefined
            ? []
            : data.audit.findings.filter((finding) =>
                finding.kind === 'LINK_GAP'
                  ? finding.empty.some((row) => row.id === existing)
                  : finding.rows.some((row) => row.id === existing),
              )
        }
        existing={existing}
        locked={locked}
        pager={
          at < 0
            ? undefined
            : { at: at + 1, of: ids.length, previous: ids[at - 1], next: ids[at + 1] }
        }
        list={{ hidden: listHidden, onToggle: toggleEntryList }}
        written={written}
        below={
          deletingEntry && storedRow !== undefined ? (
            <DeleteRowPanel
              declaration={declaration}
              row={storedRow}
              linking={linkingSentences(
                db,
                declaration,
                rowsLinkingTo(db, declaration, [storedRow.id], data.declarations),
              )}
              onCancel={() => setDeletingEntry(false)}
              onDelete={() => {
                const declarations = data.declarations
                setDeletingEntry(false)
                mutate((database) => deleteRows(database, declaration, [storedRow.id], declarations))
                back()
              }}
            />
          ) : undefined
        }
        onChange={(draft) => {
          setFailure(undefined)
          setTyped({ key, draft })
        }}
        onCommit={commit}
        onRevert={(column) => {
          const stored = editing.stored
          if (stored === undefined) return
          const keys = [column.name, currencyKeyOf(column), unitKeyOf(column)]
          const draft = Object.fromEntries(
            Object.entries(editing.draft).map(([name, value]) => [name, keys.includes(name) ? (stored[name] ?? '') : value]),
          )
          setRefused(undefined)
          setTyped(JSON.stringify(draft) === JSON.stringify(stored) ? undefined : { key, draft })
        }}
        onChoose={(column, input) =>
          mutate((database) => setEntryInput(database, declaration.name, column, input))
        }
        onOrder={(columns) =>
          mutate((database) => setEntryOrder(database, declaration.name, columns))
        }
        onHide={(column, hidden) =>
          mutate((database) => setEntryHidden(database, declaration.name, column, hidden))
        }
        onAsk={(column, asked) =>
          mutate((database) => setEntryAsked(database, declaration.name, column, asked))
        }
        onBack={back}
        onDelete={existing === undefined || locked !== undefined ? undefined : () => setDeletingEntry(true)}
        onOpen={(format, id) => {
          setTyped(undefined)
          // Within the format, the filter goes along: its pager walks the rows it holds.
          navigate(entryPath(format, id) + (format === declaration.name ? address : ''))
        }}
        onAdd={() => {
          const cells = 'cells' in judged ? judged.cells : undefined
          if (cells === undefined || locked !== undefined) return
          // **Every Add writes or says why** (M29 F2): a write that throws
          // after every check passed stays on the page with its sentence.
          let added: string | undefined
          try {
            mutate((database) => {
              added = insertRows(database, declaration, [cells])[0]
            })
          } catch (error) {
            setFailure(describeTableError(declaration, error).reason)
            return
          }
          setFailure(undefined)
          setTyped(undefined)
          // **The entry it became** — a draft until Add, and the row after.
          if (added === undefined) back()
          else navigate(entryPath(declaration.name, added) + address, { replace: true })
        }}
      />
    )
    if (pictured === undefined) return view
    // The draft's row in the list: its title as typed, or "A new task" until it
    // has one — in the group it will land in (M53 U4).
    const titled = listColumns(declaration, data).title
    const grouped = pictured.shape.group
    const drafted =
      existing === undefined
        ? {
            title: titled === undefined ? '' : (editing.draft[titled.name] ?? '').trim(),
            group: groupKeyOf(pictured.shape, grouped === undefined ? undefined : editing.draft[grouped.name], toISODate(today())),
          }
        : undefined
    return (
      <div className="flex h-full min-h-0">
        <EntryList
          declaration={declaration}
          picture={pictured}
          current={existing}
          draft={drafted}
          locked={locked !== undefined}
          refusal={spoken(moveRefusal, declaration)}
          onTick={(line, value) => tickLine(pictured, line, value)}
          onAdd={(group, title) => addLine(pictured, group, title)}
          placeholder={(group) => placeholderOf(pictured, group)}
          onNew={locked !== undefined ? undefined : () => {
            setTyped(undefined)
            navigate(entryPath(declaration.name, NEW_ENTRY) + address)
          }}
          entries={data.entries}
          filter={filter}
          shown={!listHidden}
          onOpen={openHere}
          onSearch={(text) => searchList({ ...filter, search: text })}
          onFilter={searchList}
        />
        <div className="min-w-0 flex-1">{view}</div>
      </div>
    )
  }

  // **The foot** (M26 U2). The drafts typed or pasted and not yet written,
  // padded with empty rows so there are always a few to type into and one
  // below the last that holds anything. A blank row carries the currency and
  // unit of the last entry, as Add does (`blankDraft`).
  const blank = blankDraft(declaration, data.rows[data.rows.length - 1]?.row, data.currency)
  const lastTyped = foot.drafts.reduce(
    (last, draft, at) => (isEmpty(offeredOf(declaration, draft)) ? last : at),
    -1,
  )
  const shownFoot = [
    ...foot.drafts,
    ...Array.from(
      { length: Math.max(0, Math.max(FOOT_ROWS, lastTyped + 2) - foot.drafts.length) },
      () => blank,
    ),
  ]

  /**
   * **What still stops the rows that were left and refused** (M29 F2). Every
   * refused batch is held until it is written, and judged again as it now
   * stands — so a cell stops being red the moment it holds what was missing,
   * the mark moves to whatever still stops it, and **a row written after a
   * refused one never wipes the refused one's sentence**, which is how a page
   * of rows typed one after another used to leave a row behind unwritten with
   * nothing saying so.
   */
  const judge = (
    drafts: readonly RowDraft[],
    groups: readonly number[],
    held: readonly number[],
    said?: { readonly group: number; readonly refusal: NonNullable<FootState['refusal']> },
  ): FootState['refusal'] => {
    const found: NonNullable<FootState['refusal']>[] = []
    for (const group of held) {
      if (said?.group === group) {
        found.push(said.refusal)
        continue
      }
      const typed = groups
        .flatMap((each, at) => (each === group ? [at] : []))
        .filter((at) => !isEmpty(offeredOf(declaration, drafts[at] ?? blank)))
      if (typed.length === 0) continue
      const refusals = stageRows(
        db,
        declaration,
        typed.map((at) => offeredOf(declaration, drafts[at] ?? blank)),
        data.declarations,
      ).refusals
      for (const each of refusals) {
        found.push({ row: typed[each.index] ?? 0, column: each.column, reason: each.reason, more: 0 })
      }
    }
    found.sort((a, b) => a.row - b.row)
    const [first] = found
    return first === undefined ? undefined : { ...first, more: found.length - 1 }
  }

  /** Write these foot rows as one batch, or write none of them and say why. */
  const commit = (
    drafts: readonly RowDraft[],
    groups: readonly number[],
    rows: readonly number[],
    dropped = 0,
  ): void => {
    if (drafts === spent.current) return
    const group = groups[rows[0] ?? -1]
    const others = foot.held.filter((each) => each !== group && groups.includes(each))
    const typed = rows.filter((at) => !isEmpty(offeredOf(declaration, drafts[at] ?? blank)))
    if (typed.length === 0) {
      setFoot({ drafts, groups, held: others, refusal: judge(drafts, groups, others), dropped })
      return
    }
    const batch = stageRows(
      db,
      declaration,
      typed.map((at) => offeredOf(declaration, drafts[at] ?? blank)),
      data.declarations,
    )
    const refuse = (refusal: NonNullable<FootState['refusal']>): void => {
      const held = group === undefined ? others : [...others, group]
      setFoot({
        drafts,
        groups,
        dropped,
        held,
        refusal: judge(drafts, groups, held, group === undefined ? undefined : { group, refusal }),
      })
    }
    const [first] = batch.refusals
    if (first !== undefined) {
      refuse({ row: typed[first.index] ?? 0, column: first.column, reason: first.reason, more: 0 })
      return
    }
    // A write the batch's checks passed and the document still refused is a
    // refusal of the first row like any other, never an exception nobody sees.
    try {
      mutate((database) => {
        insertRows(
          database,
          declaration,
          batch.accepted.map((each) => each.cells),
          batch.accepted.map((each) => each.id),
        )
      })
    } catch (error) {
      const said = describeTableError(declaration, error)
      refuse({ row: typed[0] ?? 0, column: said.column, reason: said.reason, more: 0 })
      return
    }
    spent.current = drafts
    const written = new Set(typed)
    const left = drafts.filter((_, at) => !written.has(at))
    const leftGroups = groups.filter((_, at) => !written.has(at))
    setFoot({
      drafts: left,
      groups: leftGroups,
      held: others,
      refusal: judge(left, leftGroups, others),
      dropped,
    })
  }

  const typeAt = (row: number, key: string, text: string): void => {
    const drafts = [...foot.drafts]
    const groups = [...foot.groups]
    while (drafts.length <= row) {
      drafts.push(blank)
      groups.push(nextGroup())
    }
    drafts[row] = withField(drafts[row] ?? blank, key, text)
    setFoot({
      ...foot,
      drafts,
      groups,
      refusal: foot.held.length === 0 ? undefined : judge(drafts, groups, foot.held),
    })
  }

  // A row typed alone is its own batch; a pasted block is one batch, and a
  // fix to any row of it writes the whole block or none of it.
  const leave = (row: number): void => {
    const group = foot.groups[row]
    if (group === undefined) return
    commit(
      foot.drafts,
      foot.groups,
      foot.groups.flatMap((each, at) => (each === group ? [at] : [])),
    )
  }

  const paste = (row: number, column: number, text: string): void => {
    const laid = pasted(foot.drafts, declaration.columns, gridOf(text), row, column, blank)
    const group = nextGroup()
    const groups = laid.drafts.map((_, at) =>
      laid.touched.includes(at) ? group : (foot.groups[at] ?? nextGroup()),
    )
    commit(laid.drafts, groups, laid.touched, laid.dropped)
  }

  /**
   * Open the shape under the sheet, or move it to another column — keeping
   * what was already changed, so two columns can be changed in one save.
   */
  const shape = (pick: (draft: FormatDraft) => { draft: FormatDraft; focus: ShapeFocus }): void => {
    const base = shaping?.draft ?? draftOf(declaration)
    const origin = shaping?.origin ?? originOf(base)
    setShaping({ ...pick(base), origin })
  }

  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-6 py-2">
        <span className="font-medium">
          <Bidi>{declaration.title}</Bidi>
        </span>
        <code className="text-caption text-ink-tertiary">{tableNameFor(declaration)}</code>
        <Chip>
          {declaration.columns.length === 1
            ? '1 column'
            : `${String(declaration.columns.length)} columns`}
        </Chip>
        <span className="text-caption text-ink-secondary tabular-nums">
          {data.total === 1 ? '1 entry' : `${String(data.total)} entries`}
          {data.total > PAGE ? `, showing ${String(PAGE)}` : ''}
        </span>
        {locked === undefined && <ReadersLine readers={data.readers} />}
        <span className="ml-auto flex items-center gap-2">
          {(declaration.ruleSets ?? []).map((each) => {
            const target = data.declarations.find((format) => format.name === each.target)
            // A pack's target is sorted by the pack, on its own write (D-269).
            return target === undefined || rowWriteRefusal(target) !== undefined || readOnly !== undefined ? null : (
              <Button
                key={each.name}
                size="sm"
                variant="ghost"
                onClick={() => setApplying(planRuleSet(db, declaration, each, target))}
              >
                Apply {each.name}
              </Button>
            )
          })}
          {shownRollup === undefined && (
            <ColumnFilter
              db={db}
              declaration={declaration}
              declarations={data.declarations}
              filter={filter}
              onChange={setFilter}
            />
          )}
          {shownRollup === undefined && (
          <input
            ref={searchField}
            className={`${FIELD} w-48`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            aria-label="Search"
            title="Every column, as it is shown (Ctrl+F)"
          />
          )}
          {locked === undefined && (
            <IconAction label="Read" onClick={() => navigate(readPath(declaration.name))}>
              <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" />
              <path d="M14 3v5h5" />
              <path d="M12 11v6" />
              <path d="m9 14 3 3 3-3" />
            </IconAction>
          )}
          {locked === undefined && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => navigate(entryPath(declaration.name, NEW_ENTRY) + address)}
          >
            Add
          </Button>
          )}
        </span>
      </div>
      {/* **The format's one tab strip** (M53 U4, U1's mockup (a)): Table, Board
          and List, then the views a format has only when it has them, then its
          rollups — what the View menu held. A view of its own is a route, so it
          can be bookmarked; a rollup is a choice on the table's. */}
      <nav aria-label="Views" className="flex h-8 shrink-0 items-stretch gap-[18px] overflow-x-auto border-b border-hairline px-6">
        {[
          {
            label: 'Table',
            on: !board && !list && shownRollup === undefined,
            go: () => {
              setView(undefined)
              if (board || list) navigate(formatPath(declaration.name) + address)
            },
          },
          ...(hasBoard ? [{ label: 'Board', on: board, go: () => navigate(boardPath(declaration.name) + address) }] : []),
          { label: 'List', on: list, go: () => navigate(listPath(declaration.name) + address) },
          ...(data.hasRoadmap ? [{ label: 'Roadmap', on: false, go: () => navigate(roadmapPath(declaration.name) + address) }] : []),
          ...(data.hasReady ? [{ label: 'Ready to start', on: false, go: () => navigate(readyPath(declaration.name) + address) }] : []),
          ...(declaration.rollups ?? []).map((each) => ({
            label: each.name,
            on: shownRollup === each.name,
            go: () => {
              setView(each.name)
              if (board || list) navigate(formatPath(declaration.name) + address)
            },
          })),
        ].map((tab) => (
          <button
            key={tab.label}
            type="button"
            aria-current={tab.on ? 'page' : undefined}
            onClick={tab.on ? undefined : tab.go}
            className={`text-[13px] whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
              tab.on
                ? 'text-ink shadow-[inset_0_-2px_0_var(--color-accent)]'
                : 'text-ink-tertiary shadow-[inset_0_-2px_0_transparent] hover:text-ink'
            }`}
          >
            <Bidi>{tab.label}</Bidi>
          </button>
        ))}
      </nav>
      {locked !== undefined && readOnly === undefined && (
        <p className="shrink-0 border-b border-hairline px-6 py-2 text-caption text-ink-secondary">
          {locked}
        </p>
      )}

      <FilterBand
        filter={filter}
        shown={data.total}
        total={data.entries}
        refusal={data.refusal}
        onClear={clearFilter}
        onChange={setFilter}
        declaration={declaration}
      />

      {/* **What has to add up is a place, not an icon** (M29 U1, D-331): the
          `=` in the toolbar was found *"small and not intuitive"*. */}
      <AddsUpPlace
        identities={declaration.identities}
        proof={data.proof}
        open={shaping?.focus.kind === 'ADDS_UP'}
        onOpen={readOnly !== undefined ? undefined : () => shape((draft) => ({ draft, focus: { kind: 'ADDS_UP' } }))}
      />
      <WhatLooksWrong audits={[data.audit]} onOpen={(format, row) => navigate(entryPath(format, row))} />

      {board && data.board !== undefined ? (
        <BoardView
          board={data.board.shape}
          enums={enums}
          rows={data.board.rows}
          labels={data.board.labels}
          capped={data.board.capped}
          locked={locked}
          refusal={spoken(moveRefusal, declaration)}
          onLanes={(column) => mutate((database) => setBoardLanes(database, declaration.name, column))}
          onMove={(row, member) => {
            const lanes = data.board?.shape.lanes.name
            if (lanes !== undefined) move(row, lanes, member)
          }}
          onOpen={(row) => navigate(entryPath(declaration.name, row.id) + address)}
          format={declaration}
          columns={columns}
          onColumns={setColumns}
        />
      ) : list && data.list !== undefined ? (
        <ListPage
          picture={data.list}
          declaration={declaration}
          locked={locked !== undefined}
          refusal={spoken(moveRefusal, declaration)}
          onTick={tickLine}
          onAdd={addLine}
          placeholder={placeholderOf}
          onOpen={(line) => navigate(entryPath(declaration.name, line.id) + address)}
          onSetting={(column, change) =>
            mutate((database) => {
              for (const name of column) {
                const kept = viewSettings(database, declaration.name, 'list').get(name) ?? ''
                const was = readListSetting(kept) ?? { group: false, line: false }
                setListSetting(database, declaration.name, name, writeListSetting(change(name, was)))
              }
            })
          }
        />
      ) : shownRollup !== undefined ? (
        <RollupView
          db={db}
          declaration={declaration}
          formats={data.declarations}
          name={shownRollup}
          revision={revision}
        />
      ) : data.rows.length === 0 && ((filtered && data.refusal === undefined) || locked !== undefined) ? (
        <Centered>
          {!filtered || data.refusal !== undefined ? (
            <>
              No <Bidi>{declaration.title}</Bidi> yet.
            </>
          ) : search.trim() !== '' && filter.match === undefined ? (
            <>
              Nothing matches “<Bidi>{search}</Bidi>”.
            </>
          ) : (
            <>Nothing matches this filter.</>
          )}
        </Centered>
      ) : (
        <RowSheet
          // In the order being saved, while it is (M29 U2, D-332).
          declaration={
            shaping === undefined ? declaration : inDraftOrder(declaration, shaping.draft, shaping.origin)
          }
          rows={data.rows}
          first={data.rows.length + 1}
          labels={data.labels ?? new Map()}
          links={data.links}
          order={sortOf(declaration, order)}
          widths={data.widths}
          foot={
            locked !== undefined || filtered
              ? undefined
              : {
                  drafts: shownFoot,
                  refused: foot.refusal,
                  onChange: typeAt,
                  onLeave: leave,
                  onPaste: paste,
                }
          }
          onSort={setOrder}
          // Each header opens its column's values (M37 U4) — the toolbar's
          // filter by another door, writing the same address.
          columnMenu={
            shaping !== undefined
              ? undefined
              : {
                  held: new Set(Object.keys(filter.match ?? {})),
                  render: (column, close) => (
                    <ColumnMenu
                      key={column.name}
                      db={db}
                      declaration={declaration}
                      declarations={data.declarations}
                      column={column}
                      filter={filter}
                      onChange={setFilter}
                      onClose={close}
                      order={sortOf(declaration, order)}
                      onSort={setOrder}
                    />
                  ),
                }
          }
          onWidth={(column, width) =>
            mutate((database) => setColumnWidth(database, declaration.name, column, width))
          }
          // Every row opens as its entry (M26 U6) — a pack's too, to be read.
          onOpen={(row) => navigate(entryPath(declaration.name, row.id) + address)}
          onDelete={locked === undefined ? setDeleting : undefined}
          onShape={readOnly !== undefined ? undefined : (column) =>
            shape((draft) => ({
              draft,
              focus: {
                kind: 'COLUMN',
                key:
                  draft.columns.find((each) => each.name === column)?.key ??
                  [...(shaping?.origin ?? [])].find(([, was]) => was === column)?.[0] ??
                  '',
                chosen: true,
              },
            }))
          }
          // A header moved (M29 U2, D-332) is a change to the shape like any
          // other, saved from the panel: open on the order when it was shut, and
          // left on what it was open on otherwise, so the arrows keep the grip.
          onMove={readOnly !== undefined ? undefined : (column, before) => {
            const base = shaping?.draft ?? draftOf(declaration)
            const origin = shaping?.origin ?? originOf(base)
            const keyOf = (name: string): string | undefined =>
              [...origin].find(([, was]) => was === name)?.[0]
            const key = keyOf(column)
            if (key === undefined) return
            const next = moveColumn(base, key, before === undefined ? undefined : keyOf(before))
            if (next === base) return
            setShaping({ draft: next, focus: shaping?.focus ?? { kind: 'ORDER' }, origin })
          }}
          onShapeDerived={readOnly !== undefined ? undefined : (name) =>
            shape((draft) => ({
              draft,
              focus: { kind: 'DERIVED', key: draft.derived?.find((each) => each.name === name)?.key ?? '' },
            }))
          }
          marked={
            shaping === undefined
              ? undefined
              : sheetMark(shaping, shaping.origin, declaration)
          }
          onAddColumn={readOnly !== undefined ? undefined : () =>
            shape((draft) => {
              const column = newColumn()
              return {
                draft: { ...draft, columns: [...draft.columns, column] },
                focus: { kind: 'COLUMN', key: column.key, chosen: false },
              }
            })
          }
        />
      )}

      {(foot.refusal !== undefined || foot.dropped > 0) && shownRollup === undefined && (
        <div className="fc-pop-enter shrink-0 border-t border-hairline px-6 py-2 text-caption" role="status">
          {foot.refusal !== undefined && (
            <p className="text-negative" data-tour="refusal">
              <span className="font-medium">Nothing was written.</span> Row{' '}
              {String(data.rows.length + 1 + foot.refusal.row)}
              {foot.refusal.column === undefined ? '' : `, ${foot.refusal.column}`}:{' '}
              <Bidi>{screenWords(foot.refusal.reason, declaration)}</Bidi>
              {foot.refusal.more > 0 ? ` And ${String(foot.refusal.more)} more.` : ''}
            </p>
          )}
          {foot.dropped > 0 && (
            <p className="text-ink-secondary">
              {foot.dropped === 1
                ? '1 pasted cell was past the last column and was left out.'
                : `${String(foot.dropped)} pasted cells were past the last column and were left out.`}
            </p>
          )}
        </div>
      )}

      {/* M39: a panel opens by making room and closes by fading out of it
          (src/ui/motion/Reveal.tsx); under reduced motion it is there at once. */}
      <Reveal>
      {shaping !== undefined && shaped !== undefined && (
        <ShapePanel
          draft={shaping.draft}
          focus={shaping.focus}
          origin={shaping.origin}
          others={data.declarations.filter((each) => each.name !== declaration.name)}
          units={data.units}
          currency={{
            code: data.currency,
            onChange: (code) => mutate((database) => void setDocumentCurrency(database, code)),
          }}
          entries={data.entries}
          problems={shaped.problems}
          plan={shaped.plan}
          changed={shaped.changed}
          followed={shaped.followed}
          order={shaped.order}
          onShape={(next) => setShaping((was) => (was === undefined ? was : { ...was, ...next }))}
          onCancel={() => setShaping(undefined)}
          // The one export a screen has had since the walk carried it (D-219).
          onCopy={() => {
            void navigator.clipboard?.writeText(write(shaped.next))
          }}
          onSave={() => {
            const { next, renames } = shaped
            setShaping(undefined)
            // A column the order or a foot draft names may be gone or renamed.
            setOrder(undefined)
            setFoot(EMPTY_FOOT)
            mutate((database) => {
              adoptFormat(database, next, Date.now(), renames)
            })
          }}
        />
      )}
      </Reveal>

      <Reveal>
      {applying !== undefined && (
        <ApplyRulesPanel
          plan={applying}
          onCancel={() => setApplying(undefined)}
          onApply={() => {
            const { set, target } = applying
            setApplying(undefined)
            mutate((database) => {
              applyRuleSet(database, declaration, set, target)
            })
          }}
        />
      )}
      </Reveal>

      <Reveal>
      {deleting !== undefined && (
        <DeleteRowPanel
          declaration={declaration}
          row={deleting}
          linking={
            db === undefined
              ? []
              : linkingSentences(
                  db,
                  declaration,
                  rowsLinkingTo(db, declaration, [deleting.id], data.declarations),
                )
          }
          onCancel={() => setDeleting(undefined)}
          onDelete={() => {
            const id = deleting.id
            const declarations = data.declarations
            setDeleting(undefined)
            mutate((database) => deleteRows(database, declaration, [id], declarations))
          }}
        />
      )}
      </Reveal>
    </div>
  )
}

/** The time of day as the bar says a write happened: `09:41`. */
function clockNow(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/**
 * How many rows the screen draws at once.
 *
 * A cap rather than a pager, and it is honest about what it is: a row costs a
 * fold per aggregate, so an uncapped table over a format with a total on it is
 * a query count linear in the rows. The search box is the way past it, and it
 * is the filter the repository already had (`RowQuery.search`).
 */
const PAGE = 200

/**
 * How many rows a board draws (M27 U3). Higher than the sheet's cap: a board
 * folds no aggregate per row, and a lane cut short is a lane that lies about
 * what is in it — so it says so above the lanes rather than quietly.
 */
const BOARD_PAGE = 1000

/** A format's board, or nothing when it has no enum to lay lanes by. */
function boardData(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  query: RowQuery,
) {
  const shape = boardOf(declaration.columns, boardSettings(db, declaration.name))
  if (shape === undefined) return undefined
  const rows = listRows(db, declaration, { ...query, limit: BOARD_PAGE })
  const total = countRows(db, declaration, query)
  return {
    shape,
    rows,
    capped: total > rows.length ? total : undefined,
    labels: linkLabels(db, rows, declaration, declarations),
  }
}

/**
 * Which column the table is in the order of.
 *
 * **It needs a default and the default cannot be the row's id.** `listRows`
 * orders by `id` when nobody says otherwise, which is right for a repository —
 * it is the one column every declared table has — and useless on a screen,
 * because an id here is a UUID and a table in UUID order is a table in no order
 * at all. So the first text column, which is what every format written against
 * this engine has been using as a name since D-216 — and since M22 U1 the
 * language does have a word for it: `labelColumn`, the same one a link is read
 * back through. This comment used to end "without the language having a word
 * for it", which is how the fourth copy of the rule got written.
 */
function defaultOrder(declaration: FormatDeclaration): Order | undefined {
  const first = labelColumn(declaration)
  return first === undefined ? undefined : { column: first.name, descending: false }
}

/**
 * **The order the table is in: the address's, when it names a column the
 * format has** (M42 F14) — stored or worked out — and the default otherwise:
 * a bookmark kept from before a column was renamed sorts by the name, not by id.
 */
function sortOf(declaration: FormatDeclaration, order: Order | undefined): Order | undefined {
  if (order === undefined) return defaultOrder(declaration)
  const named = (each: { readonly name: string }): boolean => each.name === order.column
  return declaration.columns.some(named) || (declaration.derived ?? []).some(named) ? order : defaultOrder(declaration)
}

/** The foot's drafts, the batch each belongs to, and the last refusal. */
interface FootState {
  readonly drafts: readonly RowDraft[]
  readonly groups: readonly number[]
  readonly refusal: (FootRefusal & { readonly reason: string; readonly more: number }) | undefined
  /** The batches left and refused, by group, until they are written (M29 F2). */
  readonly held: readonly number[]
  /** Cells a paste had past the last column. */
  readonly dropped: number
}

const EMPTY_FOOT: FootState = { drafts: [], groups: [], refusal: undefined, held: [], dropped: 0 }

/** Empty rows at the foot, at the least. */
const FOOT_ROWS = 3

let groupCount = 0
/** A batch's name. Only ever compared for equality, inside one screen. */
function nextGroup(): number {
  groupCount += 1
  return groupCount
}

/**
 * What the formats screen hands this one when a declaration it read in names a
 * format the document already has (M29 U1): the declaration, to open as a
 * change. Location state, so nothing about it lives in the document.
 */
export interface ImportedShape {
  readonly imported: FormatDeclaration
}

/** The format's shape while it is being changed, and each column's name when it opened. */
interface Shaping {
  readonly draft: FormatDraft
  readonly focus: ShapeFocus
  readonly origin: ReadonlyMap<string, string>
}

/**
 * Removing one row.
 *
 * **It says what points at it and does not cascade.** Nothing in this app is
 * auto-deleted, and a row another format's `link` names is one whose id is
 * sitting in that other table — so the panel says how many, and leaves the
 * deciding to the person, exactly as the format-level delete does (D-224).
 */
/**
 * What applying a rule set would change, before it does (M25 E4, D-273) — the
 * same counts `apply_rules` prints on its dry run.
 */
function ApplyRulesPanel({
  plan,
  onCancel,
  onApply,
}: {
  plan: RuleSetPlan
  onCancel: () => void
  onApply: () => void
}) {
  const rows = (count: number): string => (count === 1 ? '1 entry' : `${String(count)} entries`)
  return (
    <div className="shrink-0 border-t border-hairline bg-elevated px-6 py-4">
      <p className="mb-3 max-w-prose text-body">
        <span className="font-medium">{plan.set.name}</span> over {rows(plan.rows)} of{' '}
        <Bidi>{plan.target.title}</Bidi>: {rows(plan.changes.length)} would be set,{' '}
        {rows(plan.unmatched)} no rule matches, and {rows(plan.kept)} somebody else set, which
        stay as they are.
        {plan.ties.length > 0 &&
          ` ${rows(plan.ties.length)} two rules tie on, naming different rows — left as they are until one of the rules comes first.`}
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={onApply} disabled={plan.changes.length === 0}>
          Apply the rules
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Not now
        </Button>
      </div>
    </div>
  )
}

function DeleteRowPanel({
  declaration,
  row,
  linking,
  onCancel,
  onDelete,
}: {
  declaration: FormatDeclaration
  row: StoredRow
  /** What still links to this row, as sentences; empty when nothing does (D-263). */
  linking: readonly string[]
  onCancel: () => void
  onDelete: () => void
}) {
  const first = declaration.columns
    .map((column) => cellText(readValue(column, row)))
    .find((text) => text !== '')

  if (linking.length > 0) {
    return (
      <div className="shrink-0 border-t border-hairline bg-elevated px-6 py-4">
        <p className="mb-2 max-w-prose text-body">
          <span className="font-medium">
            <Bidi>{first ?? row.id}</Bidi>
          </span>{' '}
          cannot be deleted while other entries link to it &mdash; they would be left naming nothing.
          Re-link or clear them first; nothing is removed on your behalf.
        </p>
        <ul className="mb-3 max-w-prose list-disc pl-5 text-body text-ink-secondary">
          {linking.map((sentence) => (
            <li key={sentence}>
              <Bidi>{sentence}</Bidi>
            </li>
          ))}
        </ul>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="shrink-0 border-t border-hairline bg-elevated px-6 py-4">
      <p className="mb-3 max-w-prose text-body">
        Delete{' '}
        <span className="font-medium">
          <Bidi>{first ?? row.id}</Bidi>
        </span>{' '}
        from <Bidi>{declaration.title}</Bidi>? Nothing else goes &mdash; no other entry links to it.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * One row's identities, judged through the join.
 *
 * `verdictsOf` alone would be cheaper and would be wrong for any identity that
 * names a total: it would say `unchecked` on this screen for a row a
 * conversation reports as `proved`. See the head of this file.
 */
function foldedVerdicts(
  db: Parameters<typeof inputsWithAggregates>[0],
  declaration: FormatDeclaration,
  row: StoredRow,
  formats: Parameters<typeof inputsWithAggregates>[3],
  units: Parameters<typeof inputsWithAggregates>[4],
): readonly RowVerdict[] {
  if (declaration.identities.length === 0) return []
  const inputs = inputsWithAggregates(db, declaration, row, formats, units)
  return declaration.identities.map((identity) => ({
    identity,
    verdict: evaluateIdentity(identity, inputs, units),
  }))
}

/**
 * What each `link` column of this format may point at.
 *
 * Labelled by the target's first text column, falling back to its id: a select
 * of thirty UUIDs is a control nobody can use, and the first text column is what
 * every one of these formats has been calling its name since D-216 without the
 * language having a word for it. **Capped**, because this is a select and a
 * format with four thousand rows in it is not one you pick from a list — the
 * refusal for a link nobody could pick is `danglingLinks`, and a conversation
 * can always name the id.
 */
function linkChoices(
  db: Parameters<typeof listRows>[0],
  declaration: FormatDeclaration,
  formats: ReadonlyMap<string, FormatDeclaration>,
): ReadonlyMap<string, readonly LinkChoice[]> {
  const choices = new Map<string, readonly LinkChoice[]>()
  for (const column of declaration.columns) {
    if (!isLinkType(column.type) || column.target === undefined) continue
    if (choices.has(column.target)) continue
    const target = formats.get(column.target)
    if (target === undefined) continue

    const label = labelColumn(target)
    choices.set(
      column.target,
      listRows(db, target, { limit: PAGE }).map((row) => ({
        id: row.id,
        label: label === undefined ? row.id : (cellText(readValue(label, row)) || row.id),
      })),
    )
  }
  return choices
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-prose">{children}</p>
    </div>
  )
}

/**
 * **What the entry's ways measure against, over the page of rows** (D-402): the
 * largest figure of each number column and worked-out figure — a percent's in
 * percent, a quantity's in the one unit it is shown in — and that one unit.
 */
function entryMeasures(
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  worked: ReadonlyMap<string, readonly RowDerived[]>,
  units: UnitTable,
): { largest: ReadonlyMap<string, number>; oneUnit: ReadonlyMap<string, string> } {
  const largest = new Map<string, number>()
  const oneUnit = new Map<string, string>()
  const keep = (name: string, figure: number | undefined): void => {
    if (figure === undefined || !Number.isFinite(figure)) return
    largest.set(name, Math.max(largest.get(name) ?? figure, figure))
  }
  for (const column of declaration.columns) {
    if (column.type === 'quantity') {
      const read = rows.map((row) => readValue(column, row))
      const amounts = read.flatMap((value) =>
        typeof value === 'object' && value !== null && 'amount' in value ? [value] : [],
      )
      const into = oneUnitOf(column.unit, amounts.map((each) => each.unit))
      if (into === undefined) continue
      oneUnit.set(column.name, into)
      for (const each of amounts) {
        const converted = each.unit === into ? { value: each.amount } : convert(units, each.amount, each.unit, into)
        if ('value' in converted) keep(column.name, converted.value)
      }
      continue
    }
    if (!['integer', 'real', 'decimal', 'percent'].includes(column.type)) continue
    for (const row of rows) {
      const value = readValue(column, row)
      if (typeof value === 'number' || typeof value === 'string') keep(column.name, figureOf(column, String(value)))
    }
  }
  for (const derived of worked.values()) {
    for (const each of derived) {
      if (each.value.kind !== 'NUMBER') continue
      keep(each.compiled.declaration.name, isPercentFigure(each, declaration.columns) ? each.value.value * 100 : each.value.value)
    }
  }
  return { largest, oneUnit }
}

/** The rows one row's links name, as words a card or a list draws (D-402). */
function linkedRows(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  row: StoredRow,
): ReadonlyMap<string, LinkedRow> {
  const lines = entryLinked(db, declaration, declarations, row)
  const labels = new Map([...lines].map(([id, line]) => [id, linkedRowOf(line, new Map()).name]))
  return new Map([...lines].map(([id, line]) => [id, linkedRowOf(line, labels)]))
}

/** A refusal as the screen says it: the conversation's keys and tool names left out (M33 U2). */
function spoken(reason: string | undefined, declaration: FormatDeclaration): string | undefined {
  return reason === undefined ? undefined : screenWords(reason, declaration)
}
