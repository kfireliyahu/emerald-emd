import { useContext, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Database } from 'sql.js'

import { toISODate } from '@/core/time.ts'
import { filterQuery } from '@/data/repositories/formatFilterRepository.ts'
import { danglingLinks, indexOf } from '@/data/repositories/formatJoinRepository.ts'
import { readyData } from '@/data/repositories/formatLinkViewRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { runRollup } from '@/data/repositories/formatRollupRepository.ts'
import {
  countRows,
  linkLabels,
  listRows,
  readRow,
  repeatedValues,
  updateRow,
  type RowQuery,
} from '@/data/repositories/formatRowRepository.ts'
import { withRules } from '@/data/repositories/formatRuleRepository.ts'
import {
  boardSettings,
  dashboardBlocks,
  savedView,
  setDashboardBlocks,
  viewSettings,
} from '@/data/repositories/formatViewRepository.ts'
import { labelColumn, type ColumnDeclaration, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { rowWriteRefusal } from '@/domain/format/owner.ts'
import { brokenConstraints, type StoredRow } from '@/domain/format/row.ts'
import {
  BLOCK_COLUMNS,
  BLOCK_GAP,
  blockDropped,
  blockMoved,
  blockPixels,
  boardOf,
  defaultBlockWidth,
  sameBlock,
  tickValue,
  tickWords,
  totalNameRefusal,
  type DashboardBlock,
  type SavedView,
} from '@/domain/format/view.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'
import { Chart } from '@/ui/charts/Chart.tsx'
import { drawnValue } from '@/ui/charts/chart.ts'
import { addressView } from '@/ui/formats/addressFilter.ts'
import {
  blockGone,
  blockResized,
  blockWhat,
  conditionsAddress,
  conditionsOf,
  headline,
  offeredOf,
  ofText,
  savedWords,
  snappedSize,
  steppedSize,
  summableColumns,
  type BlockSize,
  type Condition,
  type Edge,
  type GridMeasure,
} from '@/ui/formats/dashboard.ts'
import { valueText } from '@/ui/formats/entryList.ts'
import { listPicture, type ListLine } from '@/ui/formats/listView.ts'
import { ReadOnly } from '@/ui/formats/readOnly.ts'
import { ChartForm, newChart, newView, ViewForm, type ChartMaking, type Placing, type ViewMaking } from '@/ui/formats/MakeBlock.tsx'
import { rollupChart } from '@/ui/formats/rollupChart.ts'
import { formatPath, listPath, savedViewPath } from '@/ui/nav.ts'
import { today } from '@/ui/today.ts'

/**
 * **A dashboard** — M53 U7, D-514, D-521, ported from the approved mockup
 * (`docs/mockups/m53-u7/dashboard.html`).
 *
 * An ordered set of blocks in a four-column grid — a headline total takes one
 * column, every other block two, until it is given a size — and nothing else:
 * a saved view drawn compact in its kind, a rollup's chart, a headline total.
 * **Arranged in place, never in a mode**: *Add a block* at the end of the grid,
 * a block dragged by its grip, resized by its right edge, its bottom edge or
 * its corner and snapped to the grid's columns and rows (M53 F4, D-527), and
 * its ⋯ holding *Move earlier*, *Move later* and *Remove from this dashboard*.
 * A block's title opens it in full, and *← Dashboard* comes back.
 *
 * One component for both: a format's (`dashboard` its name — its blocks read
 * it alone) and the document's (`dashboard` absent — any format's, each saying
 * which under its title).
 */
export function DashboardView({ dashboard }: { readonly dashboard: string | undefined }) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const readOnly = useContext(ReadOnly)
  const navigate = useNavigate()
  const [menu, setMenu] = useState<string | undefined>(undefined)
  const [adding, setAdding] = useState<Making | undefined>(undefined)
  const [fresh, setFresh] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState<string | undefined>(undefined)
  const [over, setOver] = useState<string | undefined>(undefined)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const grid = useRef<HTMLDivElement>(null)

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const declarations = listFormats(db)
    return { declarations, blocks: dashboardBlocks(db, dashboard) }
    // `revision` is the dependency that matters: every write bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, dashboard, revision])
  if (db === undefined || data === undefined) return null
  const { declarations, blocks } = data
  const document = dashboard === undefined
  const formats = document ? declarations : declarations.filter((each) => each.name === dashboard)
  const day = toISODate(today())
  const back = { from: 'dashboard', dashboard: dashboard ?? '' }

  const write = (next: readonly DashboardBlock[]): boolean => {
    try {
      mutate((database) => setDashboardBlocks(database, dashboard, next))
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error))
      return false
    }
    setRefusal(undefined)
    return true
  }
  const close = (): void => {
    setMenu(undefined)
    setAdding(undefined)
  }

  const open = (block: DashboardBlock): void => {
    close()
    if (block.kind === 'saved') {
      const view = savedView(db, block.format, block.name)
      if (view !== undefined) navigate(savedViewPath(block.format, view.kind, view.address), { state: back })
    } else if (block.kind === 'rollup') {
      navigate(formatPath(block.format), { state: { ...back, rollup: block.name } })
    } else navigate(listPath(block.format) + block.address, { state: back })
  }

  const add = (block: DashboardBlock): void => {
    if (write([...blocks, block])) {
      setFresh(keyOf(block))
      close()
    }
  }
  // A view or a chart made in place (M53 F2): its own write and its block, together.
  const place: Placing = (work, block) => {
    try {
      mutate(work)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    setRefusal(undefined)
    setFresh(keyOf(block))
    close()
    return undefined
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div ref={grid} className="grid max-w-[1000px] grid-cols-4 items-start gap-4 px-6 pt-5 pb-16 max-[720px]:grid-cols-2">
        {blocks.length === 0 && (
          <div className="col-span-full flex max-w-[60ch] flex-col gap-1.5 pt-6 pb-2">
            <span className="font-medium">Nothing on this dashboard yet.</span>
            <span className="text-caption text-ink-secondary">
              A dashboard holds {document ? 'any format’s' : 'this format’s'} saved views, its rollups’ charts and
              headline totals, in the order you put them.
            </span>
          </div>
        )}
        {blocks.map((block, at) => {
          const key = keyOf(block)
          return (
            <Block
              key={key}
              db={db}
              block={block}
              declarations={declarations}
              withFormat={document}
              day={day}
              fresh={fresh === key}
              dragging={dragging === key}
              over={over === key}
              locked={readOnly !== undefined}
              menu={menu === key ? { at, count: blocks.length } : undefined}
              onMenu={() => setMenu(menu === key ? undefined : key)}
              onClose={close}
              onOpen={() => open(block)}
              onMove={(by) => {
                write(blockMoved(blocks, at, at + by))
                close()
              }}
              onRemove={() => {
                write(blocks.filter((each) => !sameBlock(each, block)))
                close()
              }}
              grid={grid}
              onResize={(size) => {
                const next = blockResized(blocks, block, size)
                if (next !== blocks) write(next)
              }}
              onTick={(declaration, row, column, value) => {
                const refused = tick(db, declarations, declaration, row, column, value, mutate)
                setRefusal(refused)
              }}
              drag={
                readOnly !== undefined
                  ? undefined
                  : {
                      start: () => setDragging(key),
                      over: () => setOver(key),
                      drop: () => {
                        const moving = blocks.find((each) => keyOf(each) === dragging)
                        if (moving !== undefined) write(blockDropped(blocks, moving, block))
                        setDragging(undefined)
                        setOver(undefined)
                      },
                      end: () => {
                        setDragging(undefined)
                        setOver(undefined)
                      },
                    }
              }
            />
          )
        })}
        {readOnly === undefined && (
          <div
            className={`relative col-span-1 ${over === ADD ? 'shadow-[-3px_0_0_var(--color-accent)]' : ''}`}
            onDragOver={(event) => {
              if (dragging === undefined) return
              event.preventDefault()
              setOver(ADD)
            }}
            onDrop={(event) => {
              event.preventDefault()
              const moving = blocks.find((each) => keyOf(each) === dragging)
              if (moving !== undefined) write(blockDropped(blocks, moving, undefined))
              setDragging(undefined)
              setOver(undefined)
            }}
          >
            <button
              type="button"
              aria-expanded={menu === ADD}
              onClick={() => {
                setAdding(undefined)
                setMenu(menu === ADD ? undefined : ADD)
              }}
              className="flex min-h-24 w-full items-center justify-center gap-1.5 border border-dashed border-hairline-strong text-[13px] text-ink-secondary hover:border-ink-tertiary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ActionGlyph name="plus" size={14} />
              Add a block
            </button>
            {menu === ADD && (
              <AddMenu
                db={db}
                formats={formats}
                declarations={declarations}
                blocks={blocks}
                document={document}
                day={day}
                adding={adding}
                onAdding={setAdding}
                onAdd={add}
                onPlace={place}
                onClose={close}
              />
            )}
          </div>
        )}
      </div>
      {refusal !== undefined && (
        <p role="alert" className="px-6 pb-6 text-caption text-negative">
          {refusal}
        </p>
      )}
    </div>
  )
}

/** The *Add a block* tile's key, among the blocks' own. */
const ADD = '\u0000add'

/** What a block is known by on its dashboard: its format and its name. */
function keyOf(block: Pick<DashboardBlock, 'format' | 'name'>): string {
  return `${block.format}/${block.name}`
}

/**
 * A tick on a dashboard's list: the column that ticks a row set to what
 * `tickValue` says, judged as the list's own tick is — the rules, the links,
 * the row's constraints and its unique columns — and written by `updateRow`.
 */
function tick(
  db: Database,
  declarations: readonly FormatDeclaration[],
  declaration: FormatDeclaration,
  row: StoredRow,
  column: ColumnDeclaration,
  value: string,
  mutate: (work: (db: Database) => void) => void,
): string | undefined {
  if (rowWriteRefusal(declaration) !== undefined) return rowWriteRefusal(declaration)
  const before = readRow(db, declaration, row.id)
  if (before === undefined) return undefined
  const asked = { [column.name]: column.type === 'boolean' ? (value === 'true' ? 1 : 0) : value }
  const ruled = withRules(db, declaration, asked, before.cells)
  const standing = { ...before.cells, ...ruled.cells }
  const refused = [
    ...ruled.refusals.map((each) => each.reason),
    ...danglingLinks(db, declaration, ruled.cells, indexOf(declarations)),
    ...brokenConstraints(declaration, standing),
    ...repeatedValues(db, declaration, [standing], [row.id]).map((each) => each.message),
  ]
  if (refused.length > 0) return refused.join(' ')
  mutate((database) => {
    updateRow(database, declaration, row.id, ruled.cells)
  })
  return undefined
}

type Ticking = (declaration: FormatDeclaration, row: StoredRow, column: ColumnDeclaration, value: string) => void

/** A width's span: on a narrow window the grid has two columns, and a wider block takes both. */
const SPANS: Readonly<Record<number, string>> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3 max-[720px]:col-span-2',
  4: 'col-span-4 max-[720px]:col-span-2',
}

/** A tall block's chart: its block's height less its title, its padding and the labels under the bars, and never shorter than this. */
const CHART_CHROME = 88
const CHART_MIN = 72

/** How many rows a block given a height draws before *N more* — it scrolls inside past what fits. */
const TALL = 200

/** The columns a saved table shows beside its name, by its width: a wider one shows more. */
function tableColumns(width: number): number {
  return width <= 1 ? 1 : width === 2 ? 2 : width === 3 ? 4 : 6
}

/**
 * **A block's edges** (M53 F4, D-527): its right edge sets its width, its
 * bottom edge its height, its corner both, each snapped to the grid's columns
 * and rows while it is dragged, and written once when it is let go. Each is
 * also a handle the keyboard moves a column or a row at a time.
 */
function Edges({
  box,
  grid,
  width,
  height,
  resizing,
  onSizing,
  onSized,
}: {
  readonly box: RefObject<HTMLDivElement | null>
  readonly grid: RefObject<HTMLDivElement | null>
  readonly width: number
  readonly height: number | undefined
  readonly resizing: { current: boolean }
  readonly onSizing: (size: BlockSize | undefined) => void
  readonly onSized: (size: BlockSize) => void
}) {
  /** The grid's columns now and one column's width, and the block as it is drawn. */
  const measure = (): (GridMeasure & { readonly rect: DOMRect }) | undefined => {
    const block = box.current
    const area = grid.current
    if (block === null || area === null) return undefined
    const style = getComputedStyle(area)
    const columns = Math.max(1, Math.min(BLOCK_COLUMNS, style.gridTemplateColumns.split(' ').filter(Boolean).length))
    const inner = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    return { columns, column: (inner - BLOCK_GAP * (columns - 1)) / columns, rect: block.getBoundingClientRect() }
  }

  const down = (edge: Edge) => (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    const at = measure()
    if (at === undefined) return
    event.preventDefault()
    event.stopPropagation()
    resizing.current = true
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const x = event.clientX
    const y = event.clientY
    let last = snappedSize(edge, at.rect, { x: 0, y: 0 }, at)
    const move = (moved: globalThis.PointerEvent): void => {
      last = snappedSize(edge, at.rect, { x: moved.clientX - x, y: moved.clientY - y }, at)
      onSizing(last)
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      resizing.current = false
      onSized(last)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    onSizing(last)
  }

  const key = (edge: Edge) => (event: KeyboardEvent<HTMLSpanElement>) => {
    const at = measure()
    if (at === undefined) return
    const stepped = steppedSize(edge, event.key, { width, height }, at.rect.height, at.columns)
    if (stepped === undefined) return
    event.preventDefault()
    event.stopPropagation()
    onSized(stepped)
  }

  const tall = height === undefined ? 'as tall as it holds' : `${String(height)} rows`
  const wide = `${String(width)} ${width === 1 ? 'column' : 'columns'}`
  const line = 'bg-accent opacity-0 transition-opacity duration-[var(--micro)] group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100'
  return (
    <>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Width: ${wide}. Drag, or press the left and right arrows.`}
        tabIndex={0}
        onPointerDown={down('right')}
        onKeyDown={key('right')}
        className="group/edge absolute top-0 -right-[5px] z-10 flex h-full w-[9px] cursor-ew-resize justify-center focus-visible:outline-none"
      >
        <span className={`h-full w-[2px] ${line}`} />
      </span>
      <span
        role="separator"
        aria-orientation="horizontal"
        aria-label={`Height: ${tall}. Drag, or press the up and down arrows.`}
        tabIndex={0}
        onPointerDown={down('bottom')}
        onKeyDown={key('bottom')}
        className="group/edge absolute -bottom-[5px] left-0 z-10 flex h-[9px] w-full cursor-ns-resize items-center focus-visible:outline-none"
      >
        <span className={`h-[2px] w-full ${line}`} />
      </span>
      <span
        role="separator"
        aria-label={`Size: ${wide}, ${tall}. Drag, or press the arrows.`}
        tabIndex={0}
        onPointerDown={down('corner')}
        onKeyDown={key('corner')}
        title="Drag to resize"
        className="absolute -right-[5px] -bottom-[5px] z-20 flex size-[14px] cursor-nwse-resize items-end justify-end p-[3px] text-ink-tertiary opacity-0 transition-opacity duration-[var(--micro)] group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:text-accent focus-visible:outline-none"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2" aria-hidden>
          <path d="M7 1 1 7M7 4.5 4.5 7" />
        </svg>
      </span>
    </>
  )
}

function Block({
  db,
  block,
  declarations,
  withFormat,
  day,
  fresh,
  dragging,
  over,
  locked,
  menu,
  onMenu,
  onClose,
  onOpen,
  onMove,
  onRemove,
  onTick,
  grid,
  onResize,
  drag,
}: {
  readonly db: Database
  readonly block: DashboardBlock
  readonly declarations: readonly FormatDeclaration[]
  readonly withFormat: boolean
  readonly day: string
  readonly fresh: boolean
  readonly dragging: boolean
  readonly over: boolean
  readonly locked: boolean
  readonly menu: { readonly at: number; readonly count: number } | undefined
  readonly onMenu: () => void
  readonly onClose: () => void
  readonly onOpen: () => void
  readonly onMove: (by: number) => void
  readonly onRemove: () => void
  readonly onTick: Ticking
  readonly grid: RefObject<HTMLDivElement | null>
  readonly onResize: (size: BlockSize) => void
  readonly drag:
    | { readonly start: () => void; readonly over: () => void; readonly drop: () => void; readonly end: () => void }
    | undefined
}) {
  const box = useRef<HTMLDivElement>(null)
  const dismiss = useDismiss(menu !== undefined, box, onClose)
  const declaration = declarations.find((each) => each.name === block.format)
  const gone = blockGone(db, block, declarations)
  const what = blockWhat(db, block, declarations, withFormat)
  // While an edge is dragged, the size it snaps to; written when it is let go.
  const [sizing, setSizing] = useState<BlockSize | undefined>(undefined)
  const resizing = useRef(false)
  const width = sizing?.width ?? block.width ?? defaultBlockWidth(block)
  const height = sizing === undefined ? block.height : (sizing.height ?? block.height)
  const fill = height !== undefined
  return (
    <div
      ref={box}
      onKeyDown={dismiss}
      data-block={block.name}
      data-size={`${String(width)}x${height === undefined ? 'auto' : String(height)}`}
      draggable={drag !== undefined && sizing === undefined}
      onDragStart={(event) => {
        // An edge being dragged resizes; it never moves the block.
        if (resizing.current) {
          event.preventDefault()
          return
        }
        if (drag === undefined) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', block.name)
        drag.start()
      }}
      onDragOver={(event) => {
        if (drag === undefined) return
        event.preventDefault()
        drag.over()
      }}
      onDrop={(event) => {
        if (drag === undefined) return
        event.preventDefault()
        drag.drop()
      }}
      onDragEnd={drag?.end}
      className={[
        'group relative flex min-w-0 flex-col border border-hairline bg-background',
        SPANS[width] ?? 'col-span-2',
        dragging ? 'opacity-40' : '',
        over ? 'shadow-[-3px_0_0_var(--color-accent)]' : '',
        fresh ? 'fc-pop-enter' : '',
      ].join(' ')}
      style={height === undefined ? undefined : { height: blockPixels(height) }}
    >
      <div className="flex min-h-11 items-start gap-1.5 pt-2.5 pr-2 pb-2 pl-3.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={onOpen}
            disabled={gone !== undefined}
            title={`Open ${block.name} in full`}
            className="flex min-w-0 text-left text-[13px] font-semibold decoration-hairline-strong underline-offset-[3px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:no-underline"
          >
            <Bidi className="min-w-0 truncate">{block.name}</Bidi>
          </button>
          <span className="truncate text-[11px] text-ink-tertiary" title={what}>
            {what}
          </span>
        </div>
        {!locked && (
          <span
            className={`flex transition-opacity duration-[var(--micro)] ${
              menu !== undefined ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
            }`}
          >
            <span className="inline-flex size-[26px] cursor-grab items-center justify-center text-ink-secondary" title="Drag to move" aria-hidden>
              <Grip />
            </span>
            <button
              type="button"
              aria-label={`${block.name}: more`}
              aria-expanded={menu !== undefined}
              onClick={onMenu}
              className="inline-flex size-[26px] items-center justify-center text-ink-secondary hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ActionGlyph name="more" size={14} />
            </button>
          </span>
        )}
      </div>
      <div className={`min-w-0 px-3.5 pb-3 ${fill ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>
        {gone !== undefined || declaration === undefined ? (
          <Nothing>{gone}</Nothing>
        ) : block.kind === 'total' ? (
          <TotalBody db={db} block={block} declaration={declaration} declarations={declarations} day={day} />
        ) : block.kind === 'rollup' ? (
          <RollupBody
            db={db}
            declaration={declaration}
            declarations={declarations}
            name={block.name}
            height={height === undefined ? undefined : Math.max(CHART_MIN, blockPixels(height) - CHART_CHROME)}
          />
        ) : (
          <SavedBody
            db={db}
            declaration={declaration}
            declarations={declarations}
            name={block.name}
            day={day}
            locked={locked}
            onTick={onTick}
            onMore={onOpen}
            fill={fill}
            width={width}
          />
        )}
      </div>
      {!locked && (
        <Edges
          box={box}
          grid={grid}
          width={width}
          height={height}
          resizing={resizing}
          onSizing={setSizing}
          onSized={(size) => {
            setSizing(undefined)
            onResize(size)
          }}
        />
      )}
      {sizing !== undefined && (
        <span className="pointer-events-none absolute right-3 bottom-2 z-10 border border-hairline-strong bg-elevated px-1.5 py-0.5 text-[11px] text-ink-secondary tabular-nums shadow-pop">
          {width} {width === 1 ? 'column' : 'columns'} · {height === undefined ? 'as tall as it holds' : `${String(height)} rows`}
        </span>
      )}
      {menu !== undefined && (
        <div role="menu" className="fc-pop-enter absolute top-[34px] right-1.5 z-20 min-w-[230px] border border-hairline-strong bg-elevated py-1 shadow-pop">
          <MenuItem onClick={onOpen} disabled={gone !== undefined}>
            Open in full
          </MenuItem>
          <Sep />
          <MenuItem onClick={() => onMove(-1)} disabled={menu.at === 0}>
            Move earlier
          </MenuItem>
          <MenuItem onClick={() => onMove(1)} disabled={menu.at === menu.count - 1}>
            Move later
          </MenuItem>
          <Sep />
          <MenuItem onClick={onRemove}>Remove from this dashboard</MenuItem>
          <p className="mt-1 max-w-[300px] border-t border-hairline px-3 pt-2 pb-1 text-[11px] text-ink-tertiary">
            {block.kind === 'total'
              ? 'A headline total lives only on this dashboard, so it goes with the block.'
              : block.kind === 'saved'
                ? 'The saved view itself stays.'
                : // M53 F3: and where it is deleted, since it stays.
                  `The chart itself stays — delete it under ${declaration?.title ?? block.format} in the rail, or on its tab.`}
          </p>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  disabled = false,
  check,
  aside,
}: {
  readonly children: ReactNode
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly check?: ReactNode
  readonly aside?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] enabled:hover:bg-accent-soft disabled:cursor-default disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <span className="inline-flex w-3.5 text-accent">{check}</span>
      <span className="min-w-0 truncate">{children}</span>
      {aside !== undefined && <span className="ml-auto pl-3 text-caption whitespace-nowrap text-ink-tertiary">{aside}</span>}
    </button>
  )
}

function Sep() {
  return <div className="my-1 h-px bg-hairline" />
}

function Heading({ children, strong = false }: { readonly children: ReactNode; readonly strong?: boolean }) {
  return (
    <div className={`px-3 pt-2 pb-1 text-[11px] font-medium tracking-[.08em] uppercase ${strong ? 'text-ink-secondary' : 'text-ink-tertiary'}`}>
      {children}
    </div>
  )
}

function Nothing({ children }: { readonly children: ReactNode }) {
  return <p className="py-2 text-caption text-ink-tertiary">{children}</p>
}

function Grip() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
      <circle cx="4" cy="4" r="1.2" />
      <circle cx="8" cy="4" r="1.2" />
      <circle cx="4" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="4" cy="12" r="1.2" />
      <circle cx="8" cy="12" r="1.2" />
    </svg>
  )
}

/** A headline total: its figure, large, and what it is of. */
function TotalBody({
  db,
  block,
  declaration,
  declarations,
  day,
}: {
  readonly db: Database
  readonly block: DashboardBlock
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly day: string
}) {
  const read = headline(db, block, declarations, day)
  if (!read.ok) return <Nothing>{read.error}</Nothing>
  return (
    <>
      <Figure figure={read.value.figure} unit={read.value.unit} />
      <div className="text-caption text-ink-secondary">{ofText(declaration, read.value.of)}</div>
    </>
  )
}

function Figure({ figure, unit, small = false }: { readonly figure: string; readonly unit?: string | undefined; readonly small?: boolean }) {
  return (
    <div className={`${small ? 'text-[22px]' : 'text-[32px]'} leading-[1.1] font-medium tracking-[-0.01em] tabular-nums`}>
      {figure}
      {unit !== undefined && unit !== '' && <small className="ml-1 text-[14px] font-normal text-ink-secondary">{unit}</small>}
    </div>
  )
}

/** A rollup's chart, as its own tab draws it (U6), shorter. */
function RollupBody({
  db,
  declaration,
  declarations,
  name,
  height,
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly name: string
  /** A block given a height draws its chart to it; one with none, as before. */
  readonly height: number | undefined
}) {
  const result = runRollup(db, declaration, name, declarations, { today: toISODate(today()) })
  if (result === undefined) return <Nothing>{declaration.title} has no rollup called {name} any more.</Nothing>
  const chart = rollupChart(result.groups, {
    names: result.labels,
    by: result.rollup.by !== undefined,
    name: result.rollup.name,
    unit: result.rollup.kind === 'COUNT' ? 'rows' : undefined,
  })
  const drawable = chart.series.some((each) => each.points.some((one) => drawnValue(one, chart.axis) !== undefined))
  if (!drawable) return <Nothing>No row falls in it yet.</Nothing>
  return (
    <Chart
      labels={chart.labels}
      ticks={chart.ticks}
      series={chart.series}
      axis={chart.axis}
      kind="bars"
      title={`${result.rollup.name} by month`}
      labelHeading="month"
      height={height ?? 150}
    />
  )
}

/** A saved view, compact in its kind — what its address holds, drawn small. */
function SavedBody({
  db,
  declaration,
  declarations,
  name,
  day,
  locked,
  onTick,
  onMore,
  fill,
  width,
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly name: string
  readonly day: string
  readonly locked: boolean
  readonly onTick: Ticking
  readonly onMore: () => void
  /** Given a height: every row, scrolling inside past what fits. */
  readonly fill: boolean
  readonly width: number
}) {
  const view = savedView(db, declaration.name, name)
  if (view === undefined) return <Nothing>{declaration.title} has no saved view called {name} any more.</Nothing>
  const held = addressView(view.address)
  const read = filterQuery(db, declaration, held.filter, declarations, day)
  if (!read.ok) return <Nothing>{read.error.kind === 'NO_COLUMN' ? `${declaration.title} has no column ${read.error.name} any more.` : read.error.reason}</Nothing>
  const query: RowQuery = {
    ...read.value,
    ...(held.order === undefined ? {} : { order: held.order.column, descending: held.order.descending }),
  }
  const more = (count: number): ReactNode =>
    count > 0 ? (
      <button
        type="button"
        onClick={onMore}
        className="text-caption text-accent hover:underline hover:underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {count} more
      </button>
    ) : null
  const nothing = <Nothing>Nothing matches: {savedWords(view)}.</Nothing>

  if (view.kind === 'list') return <ListBody db={db} declaration={declaration} declarations={declarations} query={query} day={day} locked={locked} onTick={onTick} more={more} nothing={nothing} fill={fill} />
  if (view.kind === 'table') return <TableBody db={db} declaration={declaration} declarations={declarations} view={view} query={query} more={more} nothing={nothing} fill={fill} width={width} />
  if (view.kind === 'board') return <BoardBody db={db} declaration={declaration} declarations={declarations} query={query} nothing={nothing} fill={fill} width={width} />
  // A roadmap and a ready list, compact, are the names they hold, in order.
  const label = labelColumn(declaration)
  const ready = view.kind === 'ready' ? readyData(db, declaration, declarations, query, day) : undefined
  const rows = ready !== undefined ? ready.ready.map((each) => each.row) : listRows(db, declaration, query)
  if (rows.length === 0) return nothing
  const shown = rows.slice(0, fill ? TALL : 5)
  const labels = linkLabels(db, shown, declaration, declarations)
  return (
    <>
      {shown.map((row) => (
        <Line key={row.id}>
          <span className="flex min-w-0 flex-1">
            <Bidi className="min-w-0 truncate">{(label === undefined ? '' : valueText(label, row, labels)) || row.id}</Bidi>
          </span>
        </Line>
      ))}
      {rows.length > shown.length && <Foot>{more(rows.length - shown.length)}</Foot>}
    </>
  )
}

function Line({ children, done = false }: { readonly children: ReactNode; readonly done?: boolean }) {
  return (
    <div className={`flex h-[34px] items-center gap-2.5 border-t border-hairline text-[13px] ${done ? 'text-ink-tertiary line-through' : ''}`}>
      {children}
    </div>
  )
}

function Foot({ children }: { readonly children: ReactNode }) {
  return <div className="flex items-center gap-3 border-t border-hairline pt-1.5 text-caption text-ink-secondary">{children}</div>
}

/** A saved list: its first five open lines and *N more*, or two lines a group when it is grouped. */
function ListBody({
  db,
  declaration,
  declarations,
  query,
  day,
  locked,
  onTick,
  more,
  nothing,
  fill,
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly query: RowQuery
  readonly day: string
  readonly locked: boolean
  readonly onTick: Ticking
  readonly more: (count: number) => ReactNode
  readonly nothing: ReactNode
  readonly fill: boolean
}) {
  const picture = listPicture(db, declaration, declarations, query, viewSettings(db, declaration.name, 'list'), day)
  const done = picture.shape.done
  const all = picture.groups.flatMap((group) => group.rows)
  if (all.length === 0) return <>{nothing}</>
  const line = (each: ListLine) => (
    <Line key={each.key} done={each.ticked}>
      {done !== undefined &&
        (locked || rowWriteRefusal(declaration) !== undefined ? (
          <span className={`inline-flex size-4 flex-none items-center justify-center border-[1.5px] ${each.ticked ? 'border-ink bg-ink text-background' : 'border-ink-secondary'}`} role="img" aria-label={each.ticked ? 'Done' : 'Not done'}>
            {each.ticked && <ActionGlyph name="check" size={12} />}
          </span>
        ) : (
          <button
            type="button"
            role="checkbox"
            aria-checked={each.ticked}
            aria-label={`${each.ticked ? tickWords(done).undo : tickWords(done).mark}: ${each.title}`}
            title={each.ticked ? tickWords(done).undo : tickWords(done).mark}
            onClick={() => onTick(declaration, each.row, done.column, tickValue(done, !each.ticked, each.ticked ? undefined : each.value))}
            className={`inline-flex size-4 flex-none items-center justify-center border-[1.5px] hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              each.ticked ? 'border-ink bg-ink text-background' : 'border-ink-secondary'
            }`}
          >
            {each.ticked && <ActionGlyph name="check" size={12} />}
          </button>
        ))}
      <span className="flex min-w-0 flex-1">
        <Bidi className="min-w-0 truncate">{each.title}</Bidi>
      </span>
      <span className="text-caption whitespace-nowrap text-ink-secondary tabular-nums">
        {each.ticked
          ? ''
          : each.cells.flatMap((cell) => (cell.kind === 'date' ? [cell] : [])).map((cell) => (
              <span key={cell.column} className={cell.late ? 'text-negative' : ''}>
                {cell.text}
              </span>
            ))}
      </span>
    </Line>
  )
  if (picture.shape.group === undefined) {
    const open = all.filter((each) => !each.ticked)
    const ticked = all.length - open.length
    const shown = open.slice(0, fill ? TALL : 5)
    const rest = open.length - shown.length
    return (
      <>
        {shown.map(line)}
        {(rest > 0 || ticked > 0) && (
          <Foot>
            {more(rest)}
            {ticked > 0 && <span>{ticked} done</span>}
          </Foot>
        )}
      </>
    )
  }
  let hidden = 0
  const groups = picture.groups.filter((group) => group.rows.length > 0)
  return (
    <>
      {groups.map((group) => {
        const ordered = [...group.rows.filter((each) => !each.ticked), ...group.rows.filter((each) => each.ticked)]
        const each = fill ? TALL : 2
        hidden += Math.max(0, ordered.length - each)
        return (
          <div key={group.key}>
            <div className="mt-1.5 flex h-[26px] items-center gap-1.5 text-[11px] font-medium tracking-[.06em] text-ink-secondary uppercase">
              <Bidi>{group.name}</Bidi>
              <span className="text-ink-tertiary tabular-nums">{group.rows.length}</span>
            </div>
            {ordered.slice(0, each).map(line)}
          </div>
        )
      })}
      {hidden > 0 && <Foot>{more(hidden)}</Foot>}
    </>
  )
}

/** A saved table: four rows of its name and two more columns — the ones it chose, or the first two. */
function TableBody({
  db,
  declaration,
  declarations,
  view,
  query,
  more,
  nothing,
  fill,
  width,
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly view: SavedView
  readonly query: RowQuery
  readonly more: (count: number) => ReactNode
  readonly nothing: ReactNode
  readonly fill: boolean
  readonly width: number
}) {
  const total = countRows(db, declaration, query)
  if (total === 0) return <>{nothing}</>
  const rows = listRows(db, declaration, { ...query, limit: fill ? TALL : 4 })
  const labels = linkLabels(db, rows, declaration, declarations)
  const label = labelColumn(declaration)
  const chosen = addressView(view.address).columns[declaration.name]
  const others = (chosen === undefined
    ? declaration.columns.filter((each) => each !== label)
    : chosen.flatMap((name) => declaration.columns.filter((each) => each.name === name && each !== label))
  ).slice(0, tableColumns(width))
  const columns = [...(label === undefined ? [] : [label]), ...others]
  const figure = (column: ColumnDeclaration): boolean => ['integer', 'real', 'decimal', 'money', 'percent', 'quantity'].includes(column.type)
  return (
    <>
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.name}
                className={`border-b border-hairline py-1.5 pr-3 text-[11px] font-medium tracking-[.06em] text-ink-secondary uppercase ${figure(column) ? 'text-right' : 'text-left'}`}
              >
                {column.name.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.name} className={`border-b border-hairline py-[7px] pr-3 ${figure(column) ? 'text-right tabular-nums' : ''}`}>
                  <Bidi className="block truncate">{valueText(column, row, labels)}</Bidi>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length && <Foot>{more(total - rows.length)}</Foot>}
    </>
  )
}

/** A saved board: each lane's count and its first two cards. */
function BoardBody({
  db,
  declaration,
  declarations,
  query,
  nothing,
  fill,
  width,
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly query: RowQuery
  readonly nothing: ReactNode
  readonly fill: boolean
  readonly width: number
}) {
  const shape = boardOf(declaration.columns, boardSettings(db, declaration.name))
  const rows = listRows(db, declaration, query)
  if (shape === undefined || rows.length === 0) return <>{nothing}</>
  const labels = linkLabels(db, rows, declaration, declarations)
  const lanes = shape.lanes
  const nameOf = (row: StoredRow): string => (shape.name === undefined ? '' : valueText(shape.name, row, labels)) || row.id
  // A wider board puts its lanes side by side, as its own tab does.
  const across = width - 1
  return (
    <div className={across > 1 ? 'grid gap-x-4' : undefined} style={across > 1 ? { gridTemplateColumns: `repeat(${String(across)}, minmax(0, 1fr))` } : undefined}>
      {(lanes.values ?? []).map((member) => {
        const held = rows.filter((row) => row.cells[lanes.name] === member)
        if (held.length === 0) return null
        return (
          <div key={member}>
            <div className="mt-1.5 flex h-[26px] items-center gap-1.5 text-[11px] font-medium tracking-[.06em] text-ink-secondary uppercase">
              <Bidi>{member.replace(/_/g, ' ')}</Bidi>
              <span className="text-ink-tertiary tabular-nums">{held.length}</span>
            </div>
            {held.slice(0, fill ? TALL : 2).map((row) => (
              <Line key={row.id}>
                <span className="flex min-w-0 flex-1">
                  <Bidi className="min-w-0 truncate">{nameOf(row)}</Bidi>
                </span>
              </Line>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** The headline total being made in place: of which format, what figure, where, and its name. */
interface Adding {
  readonly what: 'total'
  readonly format: string
  readonly sum: string | undefined
  readonly ticked: readonly number[]
  readonly name: string
  readonly refused?: string
}

/** What *Add a block* is making in place: a headline total, a view or a chart. */
type Making = Adding | ViewMaking | ChartMaking

/**
 * **Add a block**: the formats' saved views and rollups — a ticked one is on
 * this dashboard already — grouped by format on the document's, then what is
 * made in place: *New view* and *New chart* (M53 F2, D-525), each saved and
 * placed in one step, and *Headline total*.
 */
function AddMenu({
  db,
  formats,
  declarations,
  blocks,
  document,
  day,
  adding,
  onAdding,
  onAdd,
  onPlace,
  onClose,
}: {
  readonly db: Database
  readonly formats: readonly FormatDeclaration[]
  readonly declarations: readonly FormatDeclaration[]
  readonly blocks: readonly DashboardBlock[]
  readonly document: boolean
  readonly day: string
  readonly adding: Making | undefined
  readonly onAdding: (next: Making | undefined) => void
  readonly onAdd: (block: DashboardBlock) => void
  readonly onPlace: Placing
  readonly onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const dismiss = useDismiss(true, box, onClose)
  const dashboard = document ? undefined : formats[0]?.name
  const on = (format: string, name: string): boolean => blocks.some((each) => each.format === format && each.name === name)
  const offered = formats.map((each) => offeredOf(db, each)).filter((each) => !document || each.saved.length > 0 || each.rollups.length > 0)
  return (
    <div ref={box} onKeyDown={dismiss} className="fc-pop-enter absolute top-[calc(100%+4px)] left-0 z-20 min-w-[270px] border border-hairline-strong bg-elevated py-1 shadow-pop">
      {adding?.what === 'total' ? (
        <HeadlineForm db={db} formats={formats} declarations={declarations} blocks={blocks} document={document} day={day} adding={adding} onAdding={onAdding} onAdd={onAdd} dashboard={dashboard} />
      ) : adding?.what === 'view' ? (
        <ViewForm db={db} formats={formats} declarations={declarations} blocks={blocks} document={document} dashboard={dashboard} day={day} making={adding} onMaking={onAdding} onPlace={onPlace} />
      ) : adding?.what === 'chart' ? (
        <ChartForm db={db} formats={formats} declarations={declarations} blocks={blocks} document={document} dashboard={dashboard} making={adding} onMaking={onAdding} onPlace={onPlace} />
      ) : (
        <>
          {offered.map((each, at) => (
            <div key={each.format.name}>
              {at > 0 && <Sep />}
              {document && (
                <Heading strong>
                  <Bidi>{each.format.title}</Bidi>
                </Heading>
              )}
              {each.saved.length > 0 && <Heading>Saved views</Heading>}
              {each.saved.map((view) => (
                <MenuItem
                  key={view.name}
                  disabled={on(each.format.name, view.name)}
                  check={on(each.format.name, view.name) ? <ActionGlyph name="check" size={12} /> : undefined}
                  aside={view.kind}
                  onClick={() => onAdd({ dashboard, format: each.format.name, kind: 'saved', name: view.name, address: '' })}
                >
                  <Bidi>{view.name}</Bidi>
                </MenuItem>
              ))}
              {each.rollups.length > 0 && <Heading>Rollups</Heading>}
              {each.rollups.map((name) => (
                <MenuItem
                  key={name}
                  disabled={on(each.format.name, name)}
                  check={on(each.format.name, name) ? <ActionGlyph name="check" size={12} /> : undefined}
                  aside="chart"
                  onClick={() => onAdd({ dashboard, format: each.format.name, kind: 'rollup', name, address: '' })}
                >
                  <Bidi>{name}</Bidi>
                </MenuItem>
              ))}
              {!document && each.saved.length === 0 && each.rollups.length === 0 && (
                <p className="px-3 py-1.5 text-caption text-ink-tertiary">No saved views or rollups yet.</p>
              )}
            </div>
          ))}
          {offered.length > 0 && <Sep />}
          <MenuItem
            check={<ActionGlyph name="plus" size={12} />}
            aside="a list, table or board"
            disabled={formats.length === 0}
            onClick={() => {
              const first = formats[0]
              if (first !== undefined) onAdding(newView(first))
            }}
          >
            New view
          </MenuItem>
          <MenuItem
            check={<ActionGlyph name="plus" size={12} />}
            aside="a count or a sum by month"
            disabled={formats.length === 0}
            onClick={() => {
              const first = formats[0]
              if (first !== undefined) onAdding(newChart(first))
            }}
          >
            New chart
          </MenuItem>
          <MenuItem
            check={<ActionGlyph name="plus" size={12} />}
            aside="a count or a sum"
            disabled={formats.length === 0}
            onClick={() => {
              const first = formats[0]
              if (first !== undefined) onAdding({ what: 'total', format: first.name, sum: undefined, ticked: [], name: '' })
            }}
          >
            Headline total
          </MenuItem>
        </>
      )}
    </div>
  )
}

function HeadlineForm({
  db,
  formats,
  declarations,
  blocks,
  document,
  day,
  adding,
  onAdding,
  onAdd,
  dashboard,
}: {
  readonly db: Database
  readonly formats: readonly FormatDeclaration[]
  readonly declarations: readonly FormatDeclaration[]
  readonly blocks: readonly DashboardBlock[]
  readonly document: boolean
  readonly day: string
  readonly adding: Adding
  readonly onAdding: (next: Adding | undefined) => void
  readonly onAdd: (block: DashboardBlock) => void
  readonly dashboard: string | undefined
}) {
  const declaration = formats.find((each) => each.name === adding.format) ?? formats[0]
  if (declaration === undefined) return null
  const conditions: readonly Condition[] = conditionsOf(db, declaration)
  const sums = summableColumns(declaration)
  const ticked = adding.ticked.flatMap((at) => (conditions[at] === undefined ? [] : [conditions[at]]))
  const address = conditionsAddress(ticked)
  const block: DashboardBlock = {
    dashboard,
    format: declaration.name,
    kind: 'total',
    name: adding.name.trim(),
    ...(adding.sum === undefined ? {} : { sum: adding.sum }),
    address,
  }
  const preview = headline(db, block, declarations, day)
  const submit = (): void => {
    const name = adding.name.trim()
    const refusal = totalNameRefusal(name)
    if (refusal !== undefined) return onAdding({ ...adding, refused: refusal })
    if (blocks.some((each) => each.format === declaration.name && each.name === name)) {
      return onAdding({ ...adding, refused: `A block here is called ${name} already.` })
    }
    onAdd(block)
  }
  const radio = 'flex h-6 items-center gap-2 text-[13px]'
  return (
    <>
      <Heading>Headline total</Heading>
      <div className="flex w-[340px] flex-col gap-2.5 px-3 pt-1 pb-3">
        {document && formats.length > 1 && (
          <div className="flex flex-col gap-1">
            <span className="text-label">Of</span>
            <div className="flex flex-wrap items-center gap-x-3">
              {formats.map((each) => (
                <label key={each.name} className={radio}>
                  <input
                    type="radio"
                    name="headline-format"
                    className="accent-ink"
                    checked={each.name === declaration.name}
                    onChange={() => onAdding({ what: 'total', format: each.name, sum: undefined, ticked: [], name: adding.name })}
                  />
                  <Bidi>{each.title}</Bidi>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-label">Figure</span>
          <label className={radio}>
            <input type="radio" name="headline-figure" className="accent-ink" checked={adding.sum === undefined} onChange={() => onAdding({ ...adding, sum: undefined })} />
            Count of rows
          </label>
          {sums.map((column) => (
            <label key={column.name} className={radio}>
              <input
                type="radio"
                name="headline-figure"
                className="accent-ink"
                checked={adding.sum === column.name}
                onChange={() => onAdding({ ...adding, sum: column.name })}
              />
              Sum of {column.name.replace(/_/g, ' ')}
            </label>
          ))}
        </div>
        {conditions.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-label">Where</span>
            {conditions.map((condition, at) => (
              <label key={condition.words} className={radio}>
                <input
                  type="checkbox"
                  className="accent-ink"
                  checked={adding.ticked.includes(at)}
                  onChange={(event) =>
                    onAdding({
                      ...adding,
                      ticked: event.target.checked ? [...adding.ticked, at] : adding.ticked.filter((each) => each !== at),
                    })
                  }
                />
                <Bidi>{condition.words}</Bidi>
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-label">Name</span>
          <input
            type="text"
            autoFocus
            value={adding.name}
            placeholder="What the figure is, e.g. Open"
            onChange={(event) => {
              const { refused: _gone, ...rest } = adding
              onAdding({ ...rest, name: event.target.value })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
            className="h-7 w-full border border-hairline-strong bg-background px-2 text-[13px] outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-baseline gap-2.5 bg-surface px-2.5 py-2">
          {preview.ok ? (
            <>
              <Figure figure={preview.value.figure} unit={preview.value.unit} small />
              <span className="text-caption text-ink-secondary">
                {ticked.length > 0 ? ticked.map((each) => each.words).join(', ') : `every ${declaration.title.toLowerCase()}`}
              </span>
            </>
          ) : (
            <span className="text-caption text-negative">{preview.error}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" icon="plus" onClick={submit}>
            Add
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onAdding(undefined)}>
            Cancel
          </Button>
          {adding.refused !== undefined && (
            <span role="alert" className="text-caption text-negative">
              {adding.refused}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
