import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { Database } from 'sql.js'

import {
  filterQuery,
  heldValue,
  heldAs,
  isFiltered,
  type FilterRefusal,
  type RowFilter,
} from '@/data/repositories/formatFilterRepository.ts'
import type { RowQuery } from '@/data/repositories/formatRowRepository.ts'
import { columnValues, otherHolds, type ColumnUnit, type ColumnValue } from '@/data/repositories/formatValuesRepository.ts'
import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { figureRangeSaid, figureRangeText, parseFigureRange } from '@/domain/format/figureRange.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { useDismiss } from '@/ui/components/useDismiss.ts'

import { addressView, filterAddress, type AddressOrder, type ColumnChoice } from './addressFilter.ts'
import type { Saving } from './savedView.ts'
import { toISODate } from '@/core/time.ts'
import { parseClockWords } from '@/domain/format/clock.ts'
import { today } from '@/ui/today.ts'

/** `within 14 days`, `before today` — a held value that is a window, said with `is` (D-472). */
function isClockWords(value: unknown): boolean {
  return typeof value === 'string' && parseClockWords(value) !== undefined
}

/** Words as a conversation types them: one space, lower case — `this week`. */
function wordsSaid(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * **The filter the address holds, and the way to change it** (M44 U6, U7).
 * `set` writes a new one into the address — replacing the entry while a search
 * is typed, so Back is not a keystroke — and `clear` drops it. `address` is the
 * query as it stands, which a link to another view of the same format carries
 * so the filter follows the person from the table to the board.
 *
 * **What a roadmap's folds are held to and which columns a line draws ride
 * beside it** (M37 U5): `folds` and `columns`, each with its own setter, and a
 * change to any one keeps the other two — a filter changed on the roadmap
 * keeps the units' columns chosen.
 *
 * **And the table's sort** (M42 F14): `order`, absent for the format's default,
 * and `setOrder`, which replaces the entry as a search does — Back is not a
 * click on a header. Every other change keeps it, so a filter cleared is the
 * same rows in the same order.
 */
export function useAddressFilter() {
  const location = useLocation()
  const navigate = useNavigate()
  const { filter, folds, columns, order } = useMemo(() => addressView(location.search), [location.search])
  const go = (
    next: {
      filter?: RowFilter
      folds?: Readonly<Record<string, unknown>>
      columns?: ColumnChoice
      order?: AddressOrder | null
    },
    replace: boolean,
  ): void => {
    const sort = next.order === null ? undefined : (next.order ?? order)
    const search = filterAddress(next.filter ?? filter, {
      folds: next.folds ?? folds,
      columns: next.columns ?? columns,
      ...(sort === undefined ? {} : { order: sort }),
    })
    navigate({ pathname: location.pathname, search }, { replace })
  }
  const set = (next: RowFilter, replace = false): void => go({ filter: next }, replace)
  return {
    filter,
    folds,
    columns,
    order,
    address: location.search,
    set,
    setFolds: (next: Readonly<Record<string, unknown>>, replace = false): void => go({ folds: next }, replace),
    setColumns: (next: ColumnChoice): void => go({ columns: next }, false),
    /** `undefined` is the format's default order again. */
    setOrder: (next: AddressOrder | undefined): void => go({ order: next ?? null }, true),
    clear: () => set({}),
  }
}

/**
 * The filter as the `RowQuery` that finds its rows — `filterQuery`, the one
 * reading `format_rows` and `show_format` use — or, when the address names a
 * column the format has not got or a value it cannot hold, no filter and the
 * sentence saying why: an address kept from before a column was renamed shows
 * every row and says so, rather than nothing and silence.
 */
export function filteredQuery(
  db: Database,
  declaration: FormatDeclaration,
  filter: RowFilter,
  declarations: readonly FormatDeclaration[],
): { readonly query: RowQuery; readonly refusal?: string } {
  // The app's clock, read at the edge (D-472): a window around today is the
  // same rows here as in a conversation asked on the same day.
  const day = toISODate(today())
  const read = filterQuery(db, declaration, filter, declarations, day)
  return read.ok ? { query: read.value } : { query: { today: day }, refusal: refusalSaid(declaration, read.error) }
}

function refusalSaid(declaration: FormatDeclaration, refusal: FilterRefusal): string {
  return refusal.kind === 'NO_COLUMN'
    ? `${declaration.title} has no column ${refusal.name}, so this filter holds nothing back.`
    : `${refusal.reason} This filter holds nothing back.`
}

/**
 * **That the view is filtered, by what, how many of how many, and one way
 * out** (M44 U6). Drawn under a view's bar whenever its address holds a
 * filter, on every view of a format — the frame's included, where a person
 * reading `show_format`'s answer sees why it is not the whole format. Every
 * value is a document's, so each goes through `Bidi`.
 */
export function FilterBand({
  filter,
  shown,
  total,
  refusal,
  onClear,
  onChange,
  declaration,
  saving,
  back,
}: {
  readonly filter: RowFilter
  readonly shown: number
  readonly total: number
  readonly refusal?: string | undefined
  readonly onClear: () => void
  /** Drop one held column or the search, leaving the rest (M44 U7). */
  readonly onChange?: ((next: RowFilter) => void) | undefined
  /** The format filtered, so an enum's member is said as its words — `in progress` (M37 U3). */
  readonly declaration?: FormatDeclaration | undefined
  /**
   * **Save this view** (M53 U5, D-520): offered while the address holds
   * anything — a sort alone too, which draws the band with every entry —
   * and *Saved as …* while it is a saved view. Absent where nothing is written.
   */
  readonly saving?: Saving | undefined
  /**
   * **The way back to where the view was opened from** (M53 U7): `← Dashboard`
   * when a dashboard's block opened it, first in the band, which is drawn for
   * it even when nothing is filtered.
   */
  readonly back?: { readonly label: string; readonly go: () => void } | undefined
}) {
  const filtered = isFiltered(filter)
  if (!filtered && saving?.held !== true && back === undefined) return null
  const held = Object.entries(filter.match ?? {})
  const search = filter.search?.trim() ?? ''
  // Drawn only for the way back: nothing is filtered or kept to say.
  const bare = !filtered && saving?.held !== true
  return (
    <div
      role="status"
      aria-label="Filter"
      className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-6 py-1.5 text-caption text-ink-secondary"
    >
      {back !== undefined && (
        <button
          type="button"
          onClick={back.go}
          className="text-caption text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          ← {back.label}
        </button>
      )}
      {!bare && (
      <span>
        {!filtered && 'Every entry'}
        {filtered && 'Filtered by '}
        {held.map(([name, value], at) => (
          <span key={name}>
            {at > 0 && ', '}
            <HeldSaid name={name} value={value} column={declaration?.columns.find((each) => each.name === name)} />
            {onChange !== undefined && (
              <Drop
                what={name}
                onClick={() => {
                  const rest = Object.fromEntries(held.filter(([other]) => other !== name))
                  onChange({ ...(Object.keys(rest).length === 0 ? {} : { match: rest }), ...(search === '' ? {} : { search }) })
                }}
              />
            )}
          </span>
        ))}
        {search !== '' && (
          <>
            {held.length > 0 && ', '}
            search “<span className="text-ink"><Bidi>{search}</Bidi></span>”
            {onChange !== undefined && (
              <Drop what="the search" onClick={() => onChange(filter.match === undefined ? {} : { match: filter.match })} />
            )}
          </>
        )}
      </span>
      )}
      {!bare && (
      <span className="tabular-nums">
        {refusal === undefined ? `${String(shown)} of ${String(total)} ${total === 1 ? 'entry' : 'entries'}` : refusal}
      </span>
      )}
      {filtered && (
        <button
          type="button"
          className="text-ink-secondary underline decoration-hairline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onClear}
        >
          Clear
        </button>
      )}
      {saving !== undefined && saving.held && <SaveView saving={saving} />}
    </div>
  )
}

/**
 * **Save this view, with its name asked in place** (M53 U5): the button opens
 * a field where it stood; Enter saves, Escape lets it go. A name the format's
 * views already have is offered as a replace, said on the button, so changing
 * a saved view is saving it again under its name.
 */
function SaveView({ saving }: { readonly saving: Saving }) {
  const [naming, setNaming] = useState<string | undefined>(undefined)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  if (saving.current !== undefined) {
    return (
      <span className="ml-auto">
        Saved as <span className="text-ink"><Bidi>{saving.current}</Bidi></span>
      </span>
    )
  }
  if (naming === undefined) {
    return (
      <button
        type="button"
        className="ml-auto text-accent hover:underline hover:underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => {
          setNaming('')
          setRefusal(undefined)
        }}
      >
        Save this view
      </button>
    )
  }
  const replaces = saving.names.includes(naming.trim())
  const save = (): void => {
    const said = saving.save(naming)
    if (said === undefined) setNaming(undefined)
    setRefusal(said)
  }
  return (
    <span className="ml-auto inline-flex flex-wrap items-baseline gap-x-2">
      <input
        autoFocus
        value={naming}
        onChange={(event) => {
          setNaming(event.target.value)
          setRefusal(undefined)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            save()
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            setNaming(undefined)
            setRefusal(undefined)
          }
        }}
        placeholder="Name this view"
        aria-label="Name this view"
        maxLength={60}
        className="w-44 border-0 border-b border-hairline-strong bg-transparent px-0 py-0 text-caption text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
      />
      <button
        type="button"
        className="text-accent hover:underline hover:underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={save}
      >
        {replaces ? 'Replace' : 'Save'}
      </button>
      <button
        type="button"
        className="text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => {
          setNaming(undefined)
          setRefusal(undefined)
        }}
      >
        Cancel
      </button>
      {refusal !== undefined && (
        <span className="text-negative" role="alert">
          {refusal}
        </span>
      )}
    </span>
  )
}

/**
 * **One held column, as the band says it** (M37 U3, D-476): `state: planned,
 * in progress` — any of them — and `state: anything but planned`, which an
 * empty cell passes; `owner: empty`. A window around today keeps its `is`:
 * `due is within 14 days` (D-472).
 */
function HeldSaid({
  name,
  value,
  column,
}: {
  readonly name: string
  readonly value: unknown
  readonly column: ColumnDeclaration | undefined
}) {
  if (isClockWords(value)) {
    return (
      <>
        <Bidi>{name}</Bidi> is <span className="text-ink"><Bidi>{String(value)}</Bidi></span>
      </>
    )
  }
  return (
    <>
      <Bidi>{name}</Bidi>: <HeldValues value={value} column={column} />
    </>
  )
}

/**
 * What one column is held to, without its name — `planned, in progress`,
 * `anything but built`, `empty` — for the band and the list beside an entry,
 * so the two say a filter alike (M37 U3).
 */
export function HeldValues({
  value,
  column,
  className = 'text-ink',
}: {
  readonly value: unknown
  readonly column: ColumnDeclaration | undefined
  readonly className?: string
}) {
  if (isClockWords(value)) return <span className={className}><Bidi>{String(value)}</Bidi></span>
  // An amount held to a range says it in words: `10 to 50 ILS` (M37 U4).
  const range = typeof value === 'string' && (column?.type === 'money' || column?.type === 'quantity') ? parseFigureRange(value) : undefined
  if (range !== undefined) return <span className={className}><Bidi>{figureRangeSaid(range)}</Bidi></span>
  const { values, not } = heldAs(value)
  return (
    <>
      {not && 'anything but '}
      {values.map((each, at) => (
        <span key={at} className={className}>
          {at > 0 && ', '}
          {isEmptyValue(each) ? 'empty' : <Bidi>{memberSaid(column, String(each))}</Bidi>}
        </span>
      ))}
    </>
  )
}

/** Whether a held value is the empty cell. */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/** An enum's member as its words — `in_progress` is `in progress` — and anything else as held. */
function memberSaid(column: ColumnDeclaration | undefined, value: string): string {
  return column?.type === 'enum' || column?.type === 'enums' ? value.replace(/_/g, ' ') : value
}

/** The × after one held value: drops it alone. */
function Drop({ what, onClick }: { readonly what: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Stop filtering by ${what}`}
      title={`Stop filtering by ${what}`}
      className="ml-1 px-0.5 text-ink-tertiary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      onClick={onClick}
    >
      ×
    </button>
  )
}

/**
 * The columns a row can be held to: every declared one — an amount and a
 * quantity by a range in what they are in since M37 U4, where `coerceMatch`
 * refuses them a value.
 */
export function filterableColumns(declaration: FormatDeclaration): readonly ColumnDeclaration[] {
  return declaration.columns
}

/** The most values a menu draws at once; past it, typing narrows them. */
const VALUES_DRAWN = 200

/**
 * **Hold a column to some of its values, in place** (M44 U7; several since M37
 * U3, D-476): one field names the column — a menu of the format's columns, a
 * held one marked — and then the same place opens the column's menu, the one
 * its header opens on the table (M37 U4). Two doors to one filter: both write
 * the address, and the band reads it.
 */
export function ColumnFilter({
  db,
  declaration,
  declarations,
  filter,
  onChange,
  rows,
  offered,
  order,
  onSort,
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly filter: RowFilter
  readonly onChange: (next: RowFilter, replace?: boolean) => void
  /** Whose rows it holds, when not the view's own — a roadmap's folded `units` (M37 U5). */
  readonly rows?: string | undefined
  /** The columns it offers, when not every one — a chart's filter takes fewer (M53 F2). */
  readonly offered?: readonly ColumnDeclaration[] | undefined
  /** The order being made, and its setter: the column's menu offers *Sort* as the table's header does (M53 F2). */
  readonly order?: { readonly column: string; readonly descending: boolean } | undefined
  readonly onSort?: ((order: { readonly column: string; readonly descending: boolean }) => void) | undefined
}) {
  const [column, setColumn] = useState<ColumnDeclaration | undefined>(undefined)
  const held = filter.match ?? {}
  const columns = offered ?? filterableColumns(declaration)
  if (columns.length === 0) return null
  const by = onSort === undefined ? 'Filter' : 'Filter or sort'

  return (
    <span className="relative inline-flex">
      <ChoiceField
        key="column"
        className={`${FIELD} w-32`}
        type="search"
        readOnly
        text={column?.name ?? ''}
        placeholder={rows === undefined ? 'Filter by…' : `Filter ${rows} by…`}
        aria-label={rows === undefined ? `${by} by` : `Filter ${rows} by`}
        title={rows === undefined ? 'Hold a column to some of its values' : `Hold the ${rows} under each row to some of their values`}
        choices={columns.map((each) => ({
          value: each.name,
          label: each.name,
          ...(each.name in held ? { detail: 'held' } : {}),
        }))}
        filter={false}
        onText={() => undefined}
        onPick={(choice) => setColumn(columns.find((each) => each.name === choice.value))}
      />
      {column !== undefined && (
        <ColumnMenu
          key={column.name}
          db={db}
          declaration={declaration}
          declarations={declarations}
          column={column}
          filter={filter}
          onChange={onChange}
          onClose={() => setColumn(undefined)}
          order={order}
          onSort={onSort}
        />
      )}
    </span>
  )
}

/** The key a tick is kept under: the empty cell is `''`, and text is compared folded, as `match` compares it. */
function tickKey(value: unknown): string {
  return isEmptyValue(value) ? '' : String(value).toLocaleLowerCase()
}

/** A count as the menu prints it. */
function counted(count: number): string {
  return count.toLocaleString()
}

/**
 * **A column's menu** (M37 U4): every value the column holds, each with how
 * many rows hold it under the other filters — counted in SQL by `columnValues`,
 * the reading `format_rows`' `values` gives a conversation — with a search over
 * them, a tick per value, and *is* / *is not*. A date lists its words around
 * today above its ticks — `today`, `this week`, `before today`, each with the
 * rows it names now (M53 F6, D-528) — and choosing one writes the words, so a
 * view saved from it is current tomorrow. An enum lists every member in
 * the order declared, a zero dimmed; a link its rows by name; money and a
 * quantity a range in one currency or unit; a column of passages the search
 * alone. Sorting by the column sits at the top when the table is what opened
 * it. Each change writes the address at once — U3's filter, so the band says
 * what was ticked here, and ticks what the band holds. The first change is a
 * step Back can undo; the ones after it replace it.
 */
export function ColumnMenu({
  db,
  declaration,
  declarations,
  column,
  filter,
  onChange,
  onClose,
  order,
  onSort,
  align = 'start',
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly column: ColumnDeclaration
  readonly filter: RowFilter
  readonly onChange: (next: RowFilter, replace?: boolean) => void
  readonly onClose: () => void
  /** The table's order, when the table opened the menu. */
  readonly order?: { readonly column: string; readonly descending: boolean } | undefined
  readonly onSort?: ((order: { readonly column: string; readonly descending: boolean }) => void) | undefined
  /** Which edge of its anchor the menu hangs from. */
  readonly align?: 'start' | 'end'
}) {
  const box = useRef<HTMLDivElement>(null)
  const changed = useRef(false)
  const [text, setText] = useState('')
  const dismiss = useDismiss(true, box, onClose)
  const others = JSON.stringify(otherHolds(filter, column.name))
  const read = useMemo(
    () => columnValues(db, declaration, column.name, JSON.parse(others) as RowFilter, declarations, toISODate(today())),
    [db, declaration, column.name, others, declarations],
  )

  const held = filter.match ?? {}
  const write = (value: unknown): void => {
    const { [column.name]: _was, ...rest } = held
    const match = value === undefined ? rest : { ...rest, [column.name]: value }
    onChange({ ...(Object.keys(match).length === 0 ? {} : { match }), ...(filter.search === undefined ? {} : { search: filter.search }) }, changed.current)
    changed.current = true
  }

  const sorts = onSort === undefined ? null : (
    <div role="group" aria-label={`Sort by ${column.name}`} className="flex gap-1">
      {([false, true] as const).map((descending) => {
        const on = order?.column === column.name && order.descending === descending
        return (
          <button
            key={String(descending)}
            type="button"
            aria-pressed={on}
            className={`flex-1 rounded-md border border-hairline-strong px-2 py-0.5 text-caption focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
              on ? 'bg-accent-soft text-ink' : 'text-ink-secondary hover:text-ink'
            }`}
            onClick={() => onSort({ column: column.name, descending })}
          >
            {descending ? 'Sort ↓' : 'Sort ↑'}
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`${column.name}, its values`}
      onKeyDown={dismiss}
      className={`fc-pop-enter absolute top-full ${align === 'end' ? 'right-0' : 'left-0'} z-30 mt-1 flex w-72 flex-col gap-2 rounded-md border border-hairline-strong bg-elevated p-2 text-left text-[13px] font-normal whitespace-normal shadow-[var(--shadow-pop)]`}
    >
      {!read.ok ? (
        <>
          <Bidi className="min-w-0 truncate font-medium">{column.name}</Bidi>
          {sorts}
          <p className="text-caption text-ink-secondary">{refusalSaid(declaration, read.error)}</p>
        </>
      ) : read.value.kind === 'RANGE' ? (
        <RangeBody column={column} units={read.value.units} empty={read.value.empty} held={held[column.name]} sorts={sorts} onWrite={write} />
      ) : read.value.kind === 'PASSAGES' ? (
        <>
          <Bidi className="min-w-0 truncate font-medium">{column.name}</Bidi>
          {sorts}
          <input
            autoFocus
            className={`${FIELD} h-7 w-full`}
            type="search"
            value={filter.search ?? ''}
            placeholder="Search…"
            aria-label="Search"
            title="A passage is found by searching — in every column, as shown"
            onChange={(event) => {
              const search = event.target.value
              onChange({ ...(filter.match === undefined ? {} : { match: filter.match }), ...(search === '' ? {} : { search }) }, true)
            }}
          />
          <p className="text-caption text-ink-tertiary">
            <Bidi>{column.name}</Bidi> holds passages, so it is searched rather than listed.
          </p>
        </>
      ) : (
        <ValuesBody
          column={column}
          values={read.value.values}
          words={read.value.words}
          empty={read.value.empty}
          held={column.name in held ? held[column.name] : undefined}
          text={text}
          onText={setText}
          sorts={sorts}
          onWrite={write}
        />
      )}
      <div className="flex justify-end">
        <button
          type="button"
          className="text-caption text-ink-secondary underline decoration-hairline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  )
}

/** A column's values as ticks, each with its count, and the search over them. */
function ValuesBody({
  column,
  values,
  words,
  empty,
  held,
  text,
  onText,
  sorts,
  onWrite,
}: {
  readonly column: ColumnDeclaration
  readonly values: readonly ColumnValue[]
  /** A date's words around today, each with its rows (D-528). */
  readonly words?: readonly ColumnValue[] | undefined
  readonly empty: number
  readonly held: unknown
  readonly text: string
  readonly onText: (text: string) => void
  readonly sorts: React.ReactNode
  readonly onWrite: (value: unknown) => void
}) {
  const holding = held === undefined ? { values: [] as readonly unknown[], not: false } : heldAs(held)
  // A window around today, or a range, is not a tick: it is shown as held, and a tick replaces it.
  const ticked = holding.values.filter((each) => !isClockWords(each)).map((each) => (isEmptyValue(each) ? '' : String(each)))
  const tickedKeys = new Set(ticked.map(tickKey))
  // *is not* chosen before anything is ticked is kept here until a tick writes it.
  const [notChosen, setNotChosen] = useState(holding.not)
  const not = ticked.length > 0 ? holding.not : notChosen
  // What is held and not offered — typed, or no row holds it now — is listed too, ticked.
  const offered = new Set(values.map((each) => tickKey(each.value)))
  const extra = ticked.filter((each) => each !== '' && !offered.has(tickKey(each)))
  const needle = text.trim().toLocaleLowerCase()
  const narrowed = needle === '' ? values : values.filter((each) => memberSaid(column, each.label).toLocaleLowerCase().includes(needle) || each.value.toLocaleLowerCase().includes(needle))
  const drawn = narrowed.slice(0, VALUES_DRAWN)
  // The words held, when they are words — one window, asked alone (D-472) — and
  // listed first when the menu does not offer them (`within 14 days`).
  const heldWords = typeof held === 'string' && isClockWords(held) ? wordsSaid(held) : undefined
  const wordsShown = (words ?? []).filter((each) => needle === '' || each.value.includes(needle))
  const heldExtra = heldWords !== undefined && words !== undefined && !words.some((each) => each.value === heldWords) ? heldWords : undefined
  const pickWords = (value: string): void => onWrite(heldWords === value ? undefined : value)

  const writeTicks = (next: readonly string[], turned: boolean): void =>
    onWrite(next.length === 0 ? undefined : heldValue({ values: next.map((each) => (each === '' ? null : each)), not: turned }))
  const toggle = (value: string): void => {
    const key = tickKey(value)
    writeTicks(tickedKeys.has(key) ? ticked.filter((each) => tickKey(each) !== key) : [...ticked, value], not)
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Bidi className="min-w-0 flex-1 truncate font-medium">{column.name}</Bidi>
        <div role="group" aria-label="Held as" className="flex overflow-hidden rounded-md border border-hairline-strong">
          {([false, true] as const).map((turned) => (
            <button
              key={String(turned)}
              type="button"
              aria-pressed={not === turned}
              className={`px-2 py-0.5 text-caption focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                not === turned ? 'bg-accent-soft text-ink' : 'text-ink-secondary hover:text-ink'
              }`}
              onClick={() => {
                setNotChosen(turned)
                if (not !== turned && ticked.length > 0) writeTicks(ticked, turned)
              }}
            >
              {turned ? 'is not' : 'is'}
            </button>
          ))}
        </div>
      </div>
      {sorts}
      <input
        // The keyboard is already in the place the values are.
        autoFocus
        className={`${FIELD} h-7 w-full`}
        type="search"
        value={text}
        placeholder="Find a value…"
        aria-label={`Find a value of ${column.name}`}
        title="Narrow the values; Enter ticks what is typed"
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || text.trim() === '') return
          event.preventDefault()
          // Words typed — `last 3 weeks` — are written as the words, never a value (D-528).
          if (words !== undefined && isClockWords(text)) {
            onWrite(wordsSaid(text))
            onText('')
            return
          }
          const exact = values.find((each) => each.label.toLocaleLowerCase() === needle || each.value.toLocaleLowerCase() === needle)
          const value = exact?.value ?? text.trim()
          if (!tickedKeys.has(tickKey(value))) toggle(value)
          onText('')
        }}
      />
      {(wordsShown.length > 0 || heldExtra !== undefined) && (
        <ul className="flex max-h-48 flex-col overflow-y-auto border-b border-hairline pb-1" aria-label={`Around today, for ${column.name}`}>
          {heldExtra !== undefined && <Word value={heldExtra} column={column.name} checked onPick={() => pickWords(heldExtra)} />}
          {wordsShown.map((each) => (
            <Word key={each.value} value={each.value} count={each.count} column={column.name} checked={heldWords === each.value} onPick={() => pickWords(each.value)} />
          ))}
        </ul>
      )}
      <ul className="flex max-h-64 flex-col overflow-y-auto" aria-label={`Values of ${column.name}`}>
        <Tick label={<i>(empty)</i>} count={empty} checked={tickedKeys.has('')} onToggle={() => toggle('')} />
        {extra.map((value) => (
          <Tick key={`typed-${value}`} label={<Bidi>{memberSaid(column, value)}</Bidi>} checked onToggle={() => toggle(value)} />
        ))}
        {drawn.map((choice) => (
          <Tick
            key={choice.value}
            label={<Bidi>{memberSaid(column, choice.label)}</Bidi>}
            count={choice.count}
            checked={tickedKeys.has(tickKey(choice.value))}
            onToggle={() => toggle(choice.value)}
          />
        ))}
      </ul>
      {narrowed.length > drawn.length && (
        <p className="text-caption text-ink-tertiary">
          {counted(narrowed.length - drawn.length)} more — type to narrow them.
        </p>
      )}
    </>
  )
}

/**
 * **An amount or a quantity, held to a range** (M37 U4): in one currency or
 * unit — those the column holds, each with its rows and its least and most —
 * from one figure to another, either end left open. Written as `10..50 ILS`
 * when the field is left or Enter pressed; both ends cleared lets it go.
 */
function RangeBody({
  column,
  units,
  empty,
  held,
  sorts,
  onWrite,
}: {
  readonly column: ColumnDeclaration
  readonly units: readonly ColumnUnit[]
  readonly empty: number
  readonly held: unknown
  readonly sorts: React.ReactNode
  readonly onWrite: (value: unknown) => void
}) {
  const was = typeof held === 'string' ? parseFigureRange(held) : undefined
  const [unit, setUnit] = useState(was?.unit ?? units[0]?.unit ?? '')
  const [from, setFrom] = useState(was?.from ?? '')
  const [to, setTo] = useState(was?.to ?? '')
  const kind = column.type === 'money' ? 'currency' : 'unit'
  const apply = (next: { unit?: string; from?: string; to?: string } = {}): void => {
    const words = { unit: next.unit ?? unit, from: (next.from ?? from).trim(), to: (next.to ?? to).trim() }
    if (words.from === '' && words.to === '') {
      if (held !== undefined) onWrite(undefined)
      return
    }
    const written = figureRangeText({ unit: words.unit, from: words.from === '' ? undefined : words.from, to: words.to === '' ? undefined : words.to })
    if (written !== held) onWrite(written)
  }
  const end = (label: string, value: string, set: (text: string) => void, key: 'from' | 'to') => (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-caption text-ink-secondary">
      {label}
      <input
        className={`${FIELD} h-7 w-full tabular-nums`}
        inputMode="decimal"
        value={value}
        aria-label={`${column.name} ${label.toLowerCase()}`}
        onChange={(event) => set(event.target.value)}
        onBlur={() => apply({ [key]: value })}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          apply({ [key]: value })
        }}
      />
    </label>
  )

  return (
    <>
      <Bidi className="min-w-0 truncate font-medium">{column.name}</Bidi>
      {sorts}
      {units.length === 0 ? (
        <p className="text-caption text-ink-secondary">No row holds an amount here yet.</p>
      ) : (
        <>
          <ul className="flex flex-col" aria-label={`The ${kind} it is in`}>
            {units.map((each) => (
              <li key={each.unit}>
                <label className="flex h-7 cursor-pointer items-center gap-2 rounded px-1 select-none hover:bg-accent-soft">
                  <input
                    type="radio"
                    name={`${column.name}-unit`}
                    checked={unit === each.unit}
                    onChange={() => {
                      setUnit(each.unit)
                      apply({ unit: each.unit })
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <Bidi>{each.unit}</Bidi>
                    <span className="text-ink-tertiary tabular-nums">
                      {' '}
                      · {each.least} to {each.most}
                    </span>
                  </span>
                  <span className="text-ink-tertiary tabular-nums">{counted(each.count)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            {end('From', from, setFrom, 'from')}
            {end('To', to, setTo, 'to')}
          </div>
        </>
      )}
      {empty > 0 && <p className="text-caption text-ink-tertiary">{counted(empty)} with none.</p>}
    </>
  )
}

/**
 * **Words around today, one of them chosen** (M53 F6, D-528): a radio, since a
 * window is asked alone, that lets go when chosen again. Written exactly as a
 * conversation types it — `before today`, never a gloss.
 */
function Word({
  value,
  count,
  column,
  checked,
  onPick,
}: {
  readonly value: string
  readonly count?: number | undefined
  readonly column: string
  readonly checked: boolean
  readonly onPick: () => void
}) {
  return (
    <li>
      <label
        className={`flex h-7 cursor-pointer items-center gap-2 rounded px-1 select-none hover:bg-accent-soft ${count === 0 && !checked ? 'text-ink-tertiary' : ''}`}
      >
        <input type="radio" name={`${column}-words`} checked={checked} onChange={onPick} onClick={() => checked && onPick()} />
        <span className="min-w-0 flex-1 truncate">{value}</span>
        {count !== undefined && <span className="text-caption text-ink-tertiary tabular-nums">{counted(count)}</span>}
      </label>
    </li>
  )
}

/** One value, its tick, and how many rows hold it — dimmed when none do. */
function Tick({
  label,
  count,
  checked,
  onToggle,
}: {
  readonly label: React.ReactNode
  readonly count?: number | undefined
  readonly checked: boolean
  readonly onToggle: () => void
}) {
  return (
    <li>
      <label
        className={`flex h-7 cursor-pointer items-center gap-2 rounded px-1 select-none hover:bg-accent-soft ${count === 0 && !checked ? 'text-ink-tertiary' : ''}`}
      >
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && <span className="text-caption text-ink-tertiary tabular-nums">{counted(count)}</span>}
      </label>
    </li>
  )
}
