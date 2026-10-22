import { useMemo, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { readyData, roadmapData } from '@/data/repositories/formatLinkViewRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { setRoadmapOrder } from '@/data/repositories/formatViewRepository.ts'
import { orderColumns } from '@/domain/format/view.ts'
import { countRows, type RowQuery } from '@/data/repositories/formatRowRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ColumnFilter, FilterBand, filteredQuery, useAddressFilter } from '@/ui/formats/FilterBand.tsx'
import { filterAddress, foldFilter, isFoldKey, withFold } from '@/ui/formats/addressFilter.ts'
import { roadmapOf, type RoadmapShape } from '@/domain/format/view.ts'
import { viewSettings } from '@/data/repositories/formatViewRepository.ts'
import type { ColumnDeclaration } from '@/domain/format/declaration.ts'
import { FIELD } from '@/ui/components/fieldLook.ts'
import type { Database } from 'sql.js'
import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { ReadyView, RoadmapView } from '@/ui/formats/LinkViews.tsx'
import { dashboardBack, entryPath, formatPath } from '@/ui/nav.ts'
import { useSaving } from '@/ui/formats/savedView.ts'

/**
 * **A format's roadmap, as a screen** — M27 U4, D-302. Read on every revision
 * and kept nowhere, so whatever wrote to the document last is what it draws.
 * A format that cannot have one (no number, or nothing naming it) goes back to
 * its sheet, as a board asked of a format with no enum does.
 *
 * **The rows under each row are held and drawn as the address says** (M37
 * U5, D-478): `unit.state=planned` holds the units folded under every
 * milestone — the band says it beside the milestones' own filter — and
 * `columns:unit=title,state` is what each unit's line draws.
 */
export function FormatRoadmap() {
  const { name } = useParams<{ name: string }>()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const { filter, folds, columns, address, set, setFolds, setColumns } = useAddressFilter()
  const navigate = useNavigate()
  const saving = useSaving(name, 'roadmap')

  const data = useMemo(() => {
    if (db === undefined || name === undefined) return undefined
    const declarations = listFormats(db)
    const declaration = declarations.find((each) => each.name === name)
    if (declaration === undefined) return { declaration: undefined, declarations, roadmap: undefined }
    const { query, refusal } = filteredQuery(db, declaration, filter, declarations)
    // Each folded format's own filter, read as its own format's (`filterQuery`);
    // one it cannot read is said in the band and holds nothing back.
    const held = new Map<string, RowQuery>()
    const refused: string[] = []
    for (const format of foldedFormats(db, declaration, declarations)) {
      const asked = foldFilter(folds, format.name)
      if (asked.match === undefined) continue
      const read = filteredQuery(db, format, asked, declarations)
      if (read.refusal === undefined) held.set(format.name, read.query)
      else refused.push(read.refusal)
    }
    const roadmap = roadmapData(db, declaration, declarations, query, held)
    const said = [refusal, ...refused].filter((each) => each !== undefined)
    return { declaration, declarations, roadmap, counted: counted(db, declaration, query, said.length === 0 ? undefined : said.join(' ')) }
    // `revision` is the dependency that matters: every write bumps it.
  }, [db, name, revision, filter, folds])

  if (db === undefined || data === undefined) return <Centered>Open a document to see what it holds.</Centered>
  if (data.declaration === undefined) return <Navigate to="/formats" replace />
  if (data.roadmap === undefined) return <Navigate to={formatPath(data.declaration.name) + address} replace />
  const format = data.declaration.name
  const shape = data.roadmap.shape
  // The band says both: the milestones' filter and the units', `unit.state: planned`.
  const both: RowFilter = { ...filter, ...(Object.keys(folds).length === 0 ? {} : { match: { ...filter.match, ...folds } }) }
  const fromBand = (next: RowFilter): void => {
    const match = next.match ?? {}
    const own = Object.fromEntries(Object.entries(match).filter(([key]) => !isFoldKey(key)))
    const held = Object.fromEntries(Object.entries(match).filter(([key]) => isFoldKey(key)))
    const ownFilter: RowFilter = { ...(Object.keys(own).length === 0 ? {} : { match: own }), ...(next.search === undefined ? {} : { search: next.search }) }
    navigate({ search: filterAddress(ownFilter, { folds: held, columns }) })
  }
  return (
    <Frame
      declaration={data.declaration}
      what="Roadmap"
      // The table is not the milestones' units: the way back keeps the
      // milestones' filter and lets the folds' go.
      address={filterAddress(filter)}
      action={
        <>
          <Filtering db={db} declaration={data.declaration} declarations={data.declarations} filter={filter} set={set} />
          {foldsOf(shape).map((fold) => (
            <ColumnFilter
              key={fold.name}
              db={db}
              declaration={fold}
              declarations={data.declarations}
              filter={foldFilter(folds, fold.name)}
              onChange={(next, replace) => setFolds(withFold(folds, fold.name, next), replace)}
              rows={fold.title.toLowerCase()}
            />
          ))}
        </>
      }
    >
      <FilterBand
        filter={both}
        {...data.counted}
        onClear={() => navigate({ search: filterAddress({}, { columns }) })}
        onChange={fromBand}
        declaration={data.declaration}
        saving={saving}
      />
      <RoadmapView
        data={data.roadmap}
        orders={orderColumns(data.declaration.columns)}
        onOrder={(column) => mutate((database) => setRoadmapOrder(database, format, column))}
        columns={columns}
        onColumns={setColumns}
      />
    </Frame>
  )
}

/** The formats a roadmap folds, each once. */
function foldsOf(shape: RoadmapShape<FormatDeclaration, ColumnDeclaration>): readonly FormatDeclaration[] {
  return shape.folds.map((fold) => fold.format).filter((format, at, all) => all.findIndex((each) => each.name === format.name) === at)
}

/** The formats a format's roadmap folds, read before its rows are. */
function foldedFormats(db: Database, declaration: FormatDeclaration, declarations: readonly FormatDeclaration[]): readonly FormatDeclaration[] {
  const shape = roadmapOf<ColumnDeclaration, FormatDeclaration>(declaration, declarations, (format) => viewSettings(db, format, 'roadmap'))
  return shape === undefined ? [] : foldsOf(shape)
}

/**
 * **What is ready, as a screen** — M27 U5, D-303. A format that declares no
 * ready view goes back to its sheet, as a roadmap asked of one that cannot
 * have one does.
 */
export function FormatReady() {
  const { name } = useParams<{ name: string }>()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const { filter, columns, address, set, clear, setColumns } = useAddressFilter()
  const saving = useSaving(name, 'ready')

  const data = useMemo(() => {
    if (db === undefined || name === undefined) return undefined
    const declarations = listFormats(db)
    const declaration = declarations.find((each) => each.name === name)
    if (declaration === undefined) return { declaration: undefined, declarations, ready: undefined }
    const { query, refusal } = filteredQuery(db, declaration, filter, declarations)
    return { declaration, declarations, ready: readyData(db, declaration, declarations, query), counted: counted(db, declaration, query, refusal) }
    // `revision` is the dependency that matters: every write bumps it.
  }, [db, name, revision, filter])

  if (db === undefined || data === undefined) return <Centered>Open a document to see what it holds.</Centered>
  if (data.declaration === undefined) return <Navigate to="/formats" replace />
  if (data.ready === undefined) return <Navigate to={formatPath(data.declaration.name) + address} replace />
  return (
    <Frame
      declaration={data.declaration}
      what="Ready to start"
      address={address}
      action={<Filtering db={db} declaration={data.declaration} declarations={data.declarations} filter={filter} set={set} />}
    >
      <FilterBand filter={filter} {...data.counted} onClear={clear} onChange={set} declaration={data.declaration} saving={saving} />
      <ReadyView data={data.ready} columns={columns} choosing={{ format: data.declaration, onChange: setColumns }} />
    </Frame>
  )
}

/**
 * **A row's page is its entry now** — M35 U2, D-401. `page/:id` was the page
 * (M27 U4, D-302), a read-only view beside the entry; the two are one view, and
 * the route stays only so a link kept anywhere still lands.
 */
export function FormatPage() {
  const { name, entry } = useParams<{ name: string; entry: string }>()
  if (name === undefined || entry === undefined) return <Navigate to="/formats" replace />
  return <Navigate to={entryPath(name, entry)} replace />
}

/**
 * How many rows the filter keeps of how many there are — `countRows` with the
 * query the view drew from, as the table's band counts them (M44 U6).
 */
function counted(
  db: Parameters<typeof countRows>[0],
  declaration: FormatDeclaration,
  query: RowQuery,
  refusal: string | undefined,
): { readonly shown: number; readonly total: number; readonly refusal: string | undefined } {
  const total = countRows(db, declaration, {})
  return { shown: query.match === undefined && query.windows === undefined && query.search === undefined ? total : countRows(db, declaration, query), total, refusal }
}

/**
 * **The table's two filters, on the roadmap and the ready list too** (M44 U7):
 * a column held to a value, and the search, both written into the address.
 * The search replaces the entry it types into, so Back is not a keystroke.
 */
function Filtering({
  db,
  declaration,
  declarations,
  filter,
  set,
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly filter: RowFilter
  readonly set: (next: RowFilter, replace?: boolean) => void
}) {
  return (
    <>
      <ColumnFilter db={db} declaration={declaration} declarations={declarations} filter={filter} onChange={set} />
      <input
        className={`${FIELD} w-48`}
        type="search"
        value={filter.search ?? ''}
        onChange={(event) => set({ ...filter, search: event.target.value }, true)}
        placeholder="Search"
        aria-label="Search"
        title="Every column, as it is shown"
      />
    </>
  )
}

function Frame({
  declaration,
  what,
  address,
  action,
  children,
}: {
  declaration: FormatDeclaration
  what: string
  /** The address's filter, which the way back to the table carries. */
  address: string
  action?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  // Opened from a dashboard's block (M53 U7): the way back is to the dashboard.
  const fromDashboard = dashboardBack(useLocation().state)
  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-6 py-2">
        <button
          type="button"
          className="text-caption text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => navigate(fromDashboard ?? formatPath(declaration.name) + address)}
        >
          ← {fromDashboard === undefined ? <Bidi>{declaration.title}</Bidi> : 'Dashboard'}
        </button>
        <span className="font-medium">{what}</span>
        {action !== undefined && <span className="ml-auto flex items-center gap-2">{action}</span>}
      </div>
      {children}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-prose">{children}</p>
    </div>
  )
}
