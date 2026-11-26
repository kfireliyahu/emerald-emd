import type { ReactNode } from 'react'
import type { Database } from 'sql.js'

import { filterQuery, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { countRows } from '@/data/repositories/formatRowRepository.ts'
import { indexOf } from '@/data/repositories/formatJoinRepository.ts'
import { boardSettings, savedViews } from '@/data/repositories/formatViewRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { InputShape } from '@/domain/format/inputView.ts'
import { boardOf, type DashboardBlock } from '@/domain/format/view.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'

import { canonicalAddress, filterAddress, type AddressOrder, type ColumnChoice } from './addressFilter.ts'
import { ColumnFilter } from './FilterBand.tsx'
import { ColumnsChoice } from './ColumnsChoice.tsx'
import { filterWords, rollupSentence, rollupWords, summableColumns } from './dashboard.ts'
import { inputBlock, inputMadeRefusal, makeInputView } from './inputBlock.ts'
import { draftShape, inputViewName } from './inputForm.ts'
import { InputFields } from './InputView.tsx'
import { linkChoices } from './linkTargets.ts'
import { cardChoosable, type Choosable } from './lineColumns.ts'
import {
  chartFilterColumns,
  chartPlan,
  linkColumns,
  MADE_KINDS,
  makeChart,
  makeView,
  periodUnsaid,
  periodColumns,
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

/** An input view being made in the panel (M55 U4): what it asks and sets, its name, and whether Add opens it. */
export interface InputMaking {
  readonly what: 'input'
  readonly format: string
  readonly shape: InputShape
  readonly name: string
  readonly isDefault: boolean
  readonly refused?: string
}

/** A new input view: every required column asked, named for its format — *Card charge 2* when that is taken. */
export function newInput(db: Database, format: FormatDeclaration): InputMaking {
  const taken = savedViews(db, format.name).map((each) => each.name)
  return { what: 'input', format: format.name, shape: draftShape(format), name: inputViewName(format, taken), isDefault: false }
}

/** Write a made thing and place its block: the refusal, or nothing once it is written. */
export type Placing = (work: (db: Database) => void, block: DashboardBlock) => string | undefined

const RADIO = 'flex h-6 items-center gap-2 text-body'

/** The kinds a saved view can be, each with its word in `dashboards.kinds`. */
const KIND_WORDS = ['list', 'table', 'board', 'roadmap', 'page', 'ready', 'start', 'agenda', 'entry', 'input'] as const

/** A saved view's kind in the reader's words; a kind this build does not know stays as stored. */
export function kindWord(t: Translate, kind: string): string {
  const known = KIND_WORDS.find((each) => each === kind)
  return known === undefined ? kind : t(`dashboards.kinds.${known}`)
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label">{label}</span>
      {children}
    </div>
  )
}

function Heading({ children }: { readonly children: ReactNode }) {
  // A popover's heading is a label a reader needs: ink-secondary (D-531, M54 F3).
  return <div className="px-3 pt-2 pb-1 text-label text-ink-secondary uppercase">{children}</div>
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
  const t = useT()
  return (
    <Field label={t('dashboards.make.of')}>
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
  const t = useT()
  const sorted = order === undefined ? [] : [t('dashboards.make.sortedBy', { column: order.column, arrow: order.descending ? '↓' : '↑' })]
  const words = [filterWords(filter, t), ...sorted]
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
        {t('dashboards.make.clear')}
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
  const t = useT()
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={t('dashboards.make.name')}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSubmit()
      }}
      className="h-7 w-full border border-hairline-strong bg-background px-2 text-body outline-none focus:border-accent"
    />
  )
}

function Actions({ add, refused, onAdd, onCancel }: { readonly add: string; readonly refused: string | undefined; readonly onAdd: () => void; readonly onCancel: () => void }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" icon="plus" onClick={onAdd}>
          {add}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('dashboards.make.cancel')}
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
 * by *Add* (one word for the act in the menu, M55 U7).
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
  place = true,
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
  /** False from a format's + (M55 U3): saved, and placed on no dashboard. */
  readonly place?: boolean
}) {
  const t = useT()
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
    const refused = viewRefusal(db, declaration, blocks, made, t) ?? onPlace((database) => makeView(database, blocks, made, place), viewBlock(made))
    if (refused !== undefined) onMaking({ ...making, refused })
  }
  return (
    <>
      <Heading>{t('dashboards.menu.newView')}</Heading>
      <div className="flex w-[360px] flex-col gap-2.5 px-3 pt-1 pb-3">
        {document && formats.length > 1 && (
          <FormatChoice formats={formats} chosen={declaration} group="view-format" onChoose={(each) => onMaking({ ...newView(each), name: making.name })} />
        )}
        <Field label={t('dashboards.make.as')}>
          <div className="flex flex-wrap items-center gap-x-3">
            {MADE_KINDS.map((kind) => (
              <label
                key={kind}
                className={`${RADIO} ${kind === 'board' && !boardable ? 'opacity-45' : ''}`}
                title={kind === 'board' && !boardable ? t('dashboards.make.noLanes', { format: declaration.title }) : undefined}
              >
                <input
                  type="radio"
                  name="view-kind"
                  className="accent-ink"
                  checked={making.kind === kind}
                  disabled={kind === 'board' && !boardable}
                  onChange={() => set({ kind, columns: {} })}
                />
                {t(`dashboards.madeKinds.${kind}`)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('dashboards.make.which')}>
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
        <Field label={t('dashboards.make.name')}>
          <NameField value={making.name} placeholder={t('dashboards.make.viewPlaceholder')} onChange={(name) => set({ name })} onSubmit={submit} />
        </Field>
        <div className="bg-surface px-2.5 py-2 text-caption text-ink-secondary">
          {read.ok ? (
            t('dashboards.make.preview', { held: String(held ?? 0), all: String(countRows(db, declaration)), kind: kindWord(t, making.kind) })
          ) : read.error.kind === 'NO_COLUMN' ? (
            <Phrase text={t('dashboards.make.noColumn')} parts={{ format: <Bidi>{declaration.title}</Bidi>, name: <Bidi>{read.error.name}</Bidi> }} />
          ) : (
            read.error.reason
          )}
        </div>
        <Actions add={t('dashboards.make.add')} refused={making.refused} onAdd={submit} onCancel={() => onMaking(undefined)} />
      </div>
    </>
  )
}

/**
 * **New chart**: a count or a sum, by month of which date, per which link,
 * under which filter, and its name — declared as a rollup of its format and
 * placed by *Add* (one word for the act in the menu, M55 U7).
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
  place = true,
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
  /** False from a format's + (M55 U3): declared, and placed on no dashboard. */
  readonly place?: boolean
}) {
  const t = useT()
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
  const plan = making.name.trim() === '' ? undefined : chartPlan(db, declarations, blocks, made, t)
  const submit = (): void => {
    const judged = chartPlan(db, declarations, blocks, made, t)
    const refused = !judged.ok ? judged.error : onPlace((database) => makeChart(database, blocks, judged.value, place), judged.value.block)
    if (refused !== undefined) onMaking({ ...making, refused })
  }
  // A refusal is said once, where it is mended (M55 U7): a missing month at
  // *By month of*, after an attempt; the preview's own refusal not again under the buttons.
  const unsaid = periodUnsaid(t)
  const periodNotSaid = making.refused === unsaid
  const previewSays = plan !== undefined && !plan.ok && plan.error !== unsaid ? plan.error : undefined
  const refused = periodNotSaid || making.refused === previewSays ? undefined : making.refused
  return (
    <>
      <Heading>{t('dashboards.menu.newChart')}</Heading>
      <div className="flex w-[360px] flex-col gap-2.5 px-3 pt-1 pb-3">
        {document && formats.length > 1 && (
          <FormatChoice formats={formats} chosen={declaration} group="chart-format" onChoose={(each) => onMaking({ ...newChart(each), name: making.name })} />
        )}
        <Field label={t('dashboards.make.figure')}>
          <label className={RADIO}>
            <input type="radio" name="chart-figure" className="accent-ink" checked={making.sum === undefined} onChange={() => set({ sum: undefined })} />
            {t('dashboards.make.countRows')}
          </label>
          {sums.map((column) => (
            <label key={column.name} className={RADIO}>
              <input type="radio" name="chart-figure" className="accent-ink" checked={making.sum === column.name} onChange={() => set({ sum: column.name })} />
              <Phrase text={t('dashboards.make.sumOf')} parts={{ column: <Bidi>{column.name.replace(/_/g, ' ')}</Bidi> }} />
            </label>
          ))}
        </Field>
        <Field label={t('dashboards.make.byMonth')}>
          {periods.length === 0 ? (
            <span className="text-caption text-ink-secondary">
              <Phrase text={t('dashboards.make.noPeriod')} parts={{ format: <Bidi>{declaration.title}</Bidi> }} />
            </span>
          ) : (
            periods.map((column) => (
              <label key={column.name} className={RADIO}>
                <input
                  type="radio"
                  name="chart-period"
                  className="accent-ink"
                  checked={making.period === column.name}
                  aria-invalid={periodNotSaid || undefined}
                  aria-describedby={periodNotSaid ? 'chart-period-unsaid' : undefined}
                  onChange={() => set({ period: column.name })}
                />
                {column.name.replace(/_/g, ' ')}
              </label>
            ))
          )}
          {periodNotSaid && (
            <span id="chart-period-unsaid" role="alert" className="text-caption text-negative">
              {unsaid}
            </span>
          )}
        </Field>
        {links.length > 0 && (
          <Field label={t('dashboards.make.per')}>
            <label className={RADIO}>
              <input type="radio" name="chart-by" className="accent-ink" checked={making.by === undefined} onChange={() => set({ by: undefined })} />
              {t('dashboards.make.nothingElse')}
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
          <Field label={t('dashboards.make.onlyWhere')}>
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
        <Field label={t('dashboards.make.name')}>
          <NameField value={making.name} placeholder={t('dashboards.make.chartPlaceholder')} onChange={(each) => set({ name: each })} onSubmit={submit} />
        </Field>
        <div className="bg-surface px-2.5 py-2 text-caption text-ink-secondary">
          {plan !== undefined && plan.ok ? (
            t('dashboards.make.chartPreview', { name: rollupWords(plan.value.rollup.name), sentence: rollupSentence(plan.value.rollup, declaration, t) })
          ) : previewSays !== undefined ? (
            <span className="text-negative">{previewSays}</span>
          ) : (
            t('dashboards.make.chartName')
          )}
        </div>
        <Actions add={t('dashboards.make.add')} refused={refused} onAdd={submit} onCancel={() => onMaking(undefined)} />
      </div>
    </>
  )
}

/**
 * **New input view, in Add a block** (M55 U4, D-535): of which format, what
 * it asks and sets — U3's *Fields*, with *Ask* and *Default*, inline — its
 * name, and whether Add opens it; saved and placed by *Add* in one step,
 * refused by what `arrange_views` refuses.
 */
export function InputViewForm({
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
  readonly making: InputMaking
  readonly onMaking: (next: InputMaking | undefined) => void
  readonly onPlace: Placing
}) {
  const t = useT()
  const declaration = formats.find((each) => each.name === making.format) ?? formats[0]
  if (declaration === undefined) return null
  const set = (next: Partial<InputMaking>): void => {
    const { refused: _gone, ...rest } = making
    onMaking({ ...rest, ...next })
  }
  const made = { dashboard, format: declaration.name, name: making.name, shape: making.shape, isDefault: making.isDefault }
  const submit = (): void => {
    const refused = inputMadeRefusal(db, declaration, made, t) ?? onPlace((database) => makeInputView(database, blocks, made), inputBlock(made))
    if (refused !== undefined) onMaking({ ...making, refused })
  }
  return (
    <>
      <Heading>{t('dashboards.menu.newInput')}</Heading>
      <div className="flex w-[400px] max-w-[calc(100vw-48px)] flex-col gap-2.5 px-3 pt-1 pb-3">
        {document && formats.length > 1 && (
          <FormatChoice formats={formats} chosen={declaration} group="input-format" onChoose={(each) => onMaking(newInput(db, each))} />
        )}
        <Field label={t('dashboards.make.name')}>
          <NameField value={making.name} placeholder={t('dashboards.make.inputPlaceholder')} onChange={(name) => set({ name })} onSubmit={submit} />
        </Field>
        <div className="-mx-3">
          <InputFields
            declaration={declaration}
            shape={making.shape}
            links={linkChoices(db, declaration, indexOf(declarations))}
            onChange={(shape) => set({ shape })}
          />
        </div>
        <label className="flex items-center gap-1.5 text-caption text-ink-secondary">
          <input type="checkbox" className="accent-[var(--color-ink)]" checked={making.isDefault} onChange={(event) => set({ isDefault: event.target.checked })} />
          {t('dashboards.make.useForAdd')}
        </label>
        <Actions add={t('dashboards.make.add')} refused={making.refused} onAdd={submit} onCancel={() => onMaking(undefined)} />
      </div>
    </>
  )
}
