import type { ReactNode } from 'react'
import type { Database } from 'sql.js'

import { filterQuery, filterText, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { countRows } from '@/data/repositories/formatRowRepository.ts'
import { boardSettings } from '@/data/repositories/formatViewRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { rollupText } from '@/domain/format/rollup.ts'
import { boardOf, type DashboardBlock } from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'

import { canonicalAddress, filterAddress, type AddressOrder, type ColumnChoice } from './addressFilter.ts'
import { ColumnFilter } from './FilterBand.tsx'
import { ColumnsChoice } from './ColumnsChoice.tsx'
import { summableColumns } from './dashboard.ts'
import { cardChoosable, type Choosable } from './lineColumns.ts'
import {
  chartFilterColumns,
  chartPlan,
  linkColumns,
  MADE_KINDS,
  makeChart,
  makeView,
  periodColumns,
  rollupName,
  viewBlock,
  viewRefusal,
  type MadeKind,
} from './madeInPlace.ts'

/**
 * **New view and New chart, in Add a block** — M53 F2, D-525. Each is made in
 * the panel and placed in one step: *New view* saves a list, a table or a board
 * of the filter, order and columns given here — with the format tab's own
 * pieces, `ColumnFilter` (whose column menu sorts too) and `ColumnsChoice` — and
 * *New chart* declares a count or a sum by month as a rollup of its format.
 * Nothing here guesses a done: a list made here ticks where its format's list
 * says what done is, and only there (D-524).
 */

/** A view being made in the panel. */
export interface ViewMaking {
  readonly what: 'view'
  readonly format: string
  readonly kind: MadeKind
  readonly filter: RowFilter
  readonly order: AddressOrder | undefined
  readonly columns: ColumnChoice
  readonly name: string
  readonly refused?: string
}

/** A chart being made in the panel. */
export interface ChartMaking {
  readonly what: 'chart'
  readonly format: string
  readonly sum: string | undefined
  readonly period: string | undefined
  readonly by: string | undefined
  readonly filter: RowFilter
  readonly name: string
  readonly refused?: string
}

export function newView(format: FormatDeclaration): ViewMaking {
  return { what: 'view', format: format.name, kind: 'list', filter: {}, order: undefined, columns: {}, name: '' }
}

export function newChart(format: FormatDeclaration): ChartMaking {
  const periods = periodColumns(format)
  return {
    what: 'chart',
    format: format.name,
    sum: undefined,
    // One date to be by is that one; of several, the person says which.
    period: periods.length === 1 ? periods[0]?.name : undefined,
    by: undefined,
    filter: {},
    name: '',
  }
}

/** Write a made thing and place its block: the refusal, or nothing once it is written. */
export type Placing = (work: (db: Database) => void, block: DashboardBlock) => string | undefined

const RADIO = 'flex h-6 items-center gap-2 text-[13px]'

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label">{label}</span>
      {children}
    </div>
  )
}

function Heading({ children }: { readonly children: ReactNode }) {
  return <div className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[.08em] text-ink-tertiary uppercase">{children}</div>
}

/** On the document's dashboard, which format it is of: changing it starts over. */
function FormatChoice({
  formats,
  chosen,
  group,
  onChoose,
}: {
  readonly formats: readonly FormatDeclaration[]
  readonly chosen: FormatDeclaration
  readonly group: string
  readonly onChoose: (format: FormatDeclaration) => void
}) {
  return (
    <Field label="Of">
      <div className="flex flex-wrap items-center gap-x-3">
        {formats.map((each) => (
          <label key={each.name} className={RADIO}>
            <input type="radio" name={group} className="accent-ink" checked={each.name === chosen.name} onChange={() => onChoose(each)} />
            <Bidi>{each.title}</Bidi>
          </label>
        ))}
      </div>
    </Field>
  )
}

/** What the filter holds, in its own words, and the way to let it go. */
function Held({ filter, order, onClear }: { readonly filter: RowFilter; readonly order?: AddressOrder | undefined; readonly onClear: () => void }) {
  const words = [filterText(filter), ...(order === undefined ? [] : [`sorted by ${order.column} ${order.descending ? '↓' : '↑'}`])]
    .filter((each) => each !== '')
    .join(', ')
  if (words === '') return null
  return (
    <span className="flex items-baseline gap-2 text-caption text-ink-secondary">
      <Bidi className="min-w-0 flex-1">{words}</Bidi>
      <button
        type="button"
        className="underline decoration-hairline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={onClear}
      >
        Clear
      </button>
    </span>
  )
}

function NameField({
  value,
  placeholder,
  onChange,
  onSubmit,
}: {
  readonly value: string
  readonly placeholder: string
  readonly onChange: (name: string) => void
  readonly onSubmit: () => void
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label="Name"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSubmit()
      }}
      className="h-7 w-full border border-hairline-strong bg-background px-2 text-[13px] outline-none focus:border-accent"
    />
  )
}

function Actions({ add, refused, onAdd, onCancel }: { readonly add: string; readonly refused: string | undefined; readonly onAdd: () => void; readonly onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" icon="plus" onClick={onAdd}>
          {add}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {refused !== undefined && (
        <span role="alert" className="text-caption text-negative">
          {refused}
        </span>
      )}
    </div>
  )
}

/** The columns a view's kind can choose — a table's beside its name, a board's cards; a list draws none. */
function choosableOf(db: Database, declaration: FormatDeclaration, kind: MadeKind): Choosable | undefined {
  if (kind === 'board') {
    const board = boardOf(declaration.columns, boardSettings(db, declaration.name))
    return board === undefined ? undefined : cardChoosable(declaration, board)
  }
  if (kind === 'table') {
    const label = labelColumn(declaration)
    const columns = declaration.columns.filter((each) => each !== label)
    return { format: declaration, columns, drawn: columns.slice(0, 2).map((each) => each.name) }
  }
  return undefined
}

/**
 * **New view**: of which format, as a list, a table or a board, holding which
 * rows in which order, drawing which columns, and its name — saved and placed
 * by *Save and add*.
 */
export function ViewForm({
  db,
  formats,
  declarations,
  blocks,
  document,
  dashboard,
  day,
  making,
  onMaking,
  onPlace,
}: {
  readonly db: Database
  readonly formats: readonly FormatDeclaration[]
  readonly declarations: readonly FormatDeclaration[]
  readonly blocks: readonly DashboardBlock[]
  readonly document: boolean
  readonly dashboard: string | undefined
  readonly day: string
  readonly making: ViewMaking
  readonly onMaking: (next: ViewMaking | undefined) => void
  readonly onPlace: Placing
}) {
  const declaration = formats.find((each) => each.name === making.format) ?? formats[0]
  if (declaration === undefined) return null
  const set = (next: Partial<ViewMaking>): void => {
    const { refused: _gone, ...rest } = making
    onMaking({ ...rest, ...next })
  }
  const boardable = boardOf(declaration.columns, boardSettings(db, declaration.name)) !== undefined
  const choosable = choosableOf(db, declaration, making.kind)
  const address = canonicalAddress(
    filterAddress(making.filter, {
      ...(choosable === undefined ? {} : { columns: making.columns }),
      ...(making.order === undefined ? {} : { order: making.order }),
    }),
  )
  const read = filterQuery(db, declaration, making.filter, declarations, day)
  const held = read.ok ? countRows(db, declaration, read.value) : undefined
  const submit = (): void => {
    const made = { dashboard, format: declaration.name, kind: making.kind, name: making.name.trim(), address }
    const refused = viewRefusal(db, declaration, blocks, made) ?? onPlace((database) => makeView(database, blocks, made), viewBlock(made))
    if (refused !== undefined) onMaking({ ...making, refused })
  }
  return (
    <>
      <Heading>New view</Heading>
      <div className="flex w-[360px] flex-col gap-2.5 px-3 pt-1 pb-3">
        {document && formats.length > 1 && (
          <FormatChoice formats={formats} chosen={declaration} group="view-format" onChoose={(each) => onMaking({ ...newView(each), name: making.name })} />
        )}
        <Field label="As">
          <div className="flex flex-wrap items-center gap-x-3">
            {MADE_KINDS.map((kind) => (
              <label
                key={kind}
                className={`${RADIO} ${kind === 'board' && !boardable ? 'opacity-45' : ''}`}
                title={kind === 'board' && !boardable ? `${declaration.title} has no choice column to make the board’s lanes of.` : undefined}
              >
                <input
                  type="radio"
                  name="view-kind"
                  className="accent-ink"
                  checked={making.kind === kind}
                  disabled={kind === 'board' && !boardable}
                  onChange={() => set({ kind, columns: {} })}
                />
                {kind.charAt(0).toUpperCase() + kind.slice(1)}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Which rows, in what order">
          <span className="flex flex-wrap items-center gap-2">
            <ColumnFilter
              db={db}
              declaration={declaration}
              declarations={declarations}
              filter={making.filter}
              onChange={(filter) => set({ filter })}
              order={making.order}
              onSort={(order) => set({ order })}
            />
            {choosable !== undefined && (
              <ColumnsChoice formats={[choosable]} chosen={making.columns} onChange={(columns) => set({ columns })} />
            )}
          </span>
          <Held filter={making.filter} order={making.order} onClear={() => set({ filter: {}, order: undefined })} />
        </Field>
        <Field label="Name">
          <NameField value={making.name} placeholder="What it shows, e.g. Due today" onChange={(name) => set({ name })} onSubmit={submit} />
        </Field>
        <div className="bg-surface px-2.5 py-2 text-caption text-ink-secondary">
          {read.ok
            ? `${String(held ?? 0)} of ${String(countRows(db, declaration))} rows, as a ${making.kind}`
            : read.error.kind === 'NO_COLUMN'
              ? `${declaration.title} has no column ${read.error.name}.`
              : read.error.reason}
        </div>
        <Actions add="Save and add" refused={making.refused} onAdd={submit} onCancel={() => onMaking(undefined)} />
      </div>
    </>
  )
}

/**
 * **New chart**: a count or a sum, by month of which date, per which link,
 * under which filter, and its name — declared as a rollup of its format and
 * placed by *Declare and add*.
 */
export function ChartForm({
  db,
  formats,
  declarations,
  blocks,
  document,
  dashboard,
  making,
  onMaking,
  onPlace,
}: {
  readonly db: Database
  readonly formats: readonly FormatDeclaration[]
  readonly declarations: readonly FormatDeclaration[]
  readonly blocks: readonly DashboardBlock[]
  readonly document: boolean
  readonly dashboard: string | undefined
  readonly making: ChartMaking
  readonly onMaking: (next: ChartMaking | undefined) => void
  readonly onPlace: Placing
}) {
  const declaration = formats.find((each) => each.name === making.format) ?? formats[0]
  if (declaration === undefined) return null
  const set = (next: Partial<ChartMaking>): void => {
    const { refused: _gone, ...rest } = making
    onMaking({ ...rest, ...next })
  }
  const sums = summableColumns(declaration)
  const periods = periodColumns(declaration)
  const links = linkColumns(declaration)
  const made = {
    dashboard,
    format: declaration.name,
    sum: making.sum,
    period: making.period,
    by: making.by,
    filter: making.filter,
    name: making.name,
  }
  const plan = making.name.trim() === '' ? undefined : chartPlan(db, declarations, blocks, made)
  const submit = (): void => {
    const judged = chartPlan(db, declarations, blocks, made)
    const refused = !judged.ok ? judged.error : onPlace((database) => makeChart(database, blocks, judged.value), judged.value.block)
    if (refused !== undefined) onMaking({ ...making, refused })
  }
  const name = rollupName(making.name)
  return (
    <>
      <Heading>New chart</Heading>
      <div className="flex w-[360px] flex-col gap-2.5 px-3 pt-1 pb-3">
        {document && formats.length > 1 && (
          <FormatChoice formats={formats} chosen={declaration} group="chart-format" onChoose={(each) => onMaking({ ...newChart(each), name: making.name })} />
        )}
        <Field label="Figure">
          <label className={RADIO}>
            <input type="radio" name="chart-figure" className="accent-ink" checked={making.sum === undefined} onChange={() => set({ sum: undefined })} />
            Count of rows
          </label>
          {sums.map((column) => (
            <label key={column.name} className={RADIO}>
              <input type="radio" name="chart-figure" className="accent-ink" checked={making.sum === column.name} onChange={() => set({ sum: column.name })} />
              Sum of {column.name.replace(/_/g, ' ')}
            </label>
          ))}
        </Field>
        <Field label="By month of">
          {periods.length === 0 ? (
            <span className="text-caption text-ink-tertiary">{declaration.title} has no date or month column to chart by.</span>
          ) : (
            periods.map((column) => (
              <label key={column.name} className={RADIO}>
                <input type="radio" name="chart-period" className="accent-ink" checked={making.period === column.name} onChange={() => set({ period: column.name })} />
                {column.name.replace(/_/g, ' ')}
              </label>
            ))
          )}
        </Field>
        {links.length > 0 && (
          <Field label="And per">
            <label className={RADIO}>
              <input type="radio" name="chart-by" className="accent-ink" checked={making.by === undefined} onChange={() => set({ by: undefined })} />
              Nothing else
            </label>
            {links.map((column) => (
              <label key={column.name} className={RADIO}>
                <input type="radio" name="chart-by" className="accent-ink" checked={making.by === column.name} onChange={() => set({ by: column.name })} />
                {column.name.replace(/_/g, ' ')}
              </label>
            ))}
          </Field>
        )}
        {chartFilterColumns(declaration).length > 0 && (
          <Field label="Only rows where">
            <span className="flex flex-wrap items-center gap-2">
              <ColumnFilter
                db={db}
                declaration={declaration}
                declarations={declarations}
                filter={making.filter}
                offered={chartFilterColumns(declaration)}
                onChange={(filter) => set({ filter })}
              />
            </span>
            <Held filter={making.filter} onClear={() => set({ filter: {} })} />
          </Field>
        )}
        <Field label="Name">
          <NameField value={making.name} placeholder="What it counts, e.g. Done by month" onChange={(each) => set({ name: each })} onSubmit={submit} />
        </Field>
        <div className="bg-surface px-2.5 py-2 text-caption text-ink-secondary">
          {plan === undefined ? (
            'Its name is the rollup’s, declared on the format.'
          ) : plan.ok ? (
            <>
              Declares <code>{name}</code>: <code>{rollupText(plan.value.rollup)}</code>
            </>
          ) : (
            <span className="text-negative">{plan.error}</span>
          )}
        </div>
        <Actions add="Declare and add" refused={making.refused} onAdd={submit} onCancel={() => onMaking(undefined)} />
      </div>
    </>
  )
}
