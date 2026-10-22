import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Kbd } from '@/ui/components/Kbd.tsx'
import { withArticle, type ListGroup } from '@/domain/format/view.ts'
import { HeldValues } from '@/ui/formats/FilterBand.tsx'
import { ListLines } from '@/ui/formats/ListView.tsx'
import { listOrder, type ListLine, type ListPicture } from '@/ui/formats/listView.ts'

/**
 * **The entry keeps its format's list beside it** — M37 U2b (D-475, direction
 * 2B of `docs/mockups/m37/finding.html`: its `listPane` and `step`).
 *
 * The rows the entry's pager walks, drawn: 288px on the left of the entry,
 * its search writing the address's `?search=` (so a reload, Back, a bookmark
 * and the Table opened from here keep it), the entry marked, and the count in
 * its foot. Hidden by the button in the entry's bar (`useEntryList`), and by a
 * narrow window whatever that says.
 *
 * **↑ ↓ page whenever no field is being typed in** — the entry has no box until
 * a value is pressed — and from the list's own search box. That works with the
 * list hidden too, so this is mounted either way and draws nothing then.
 *
 * **Since M53 U4 (D-519) it is the list view, narrow**: the same groups, ticks
 * and quick add (one line at the top), the title with due · link under it, and
 * ↑ ↓ walking the rows in the order it draws them. Hundreds of rows draw as
 * they are; past a thousand it draws flat, only what is in view, every row the
 * same height.
 */

/** A row's height: its title over its line. Fixed, so a long list can be drawn in part. */
const ROW = 44
/** Past this many rows the list draws only the ones in view, and a few either side. */
const WINDOW_PAST = 1000
const SPARE = 20

export function EntryList({
  declaration,
  picture,
  current,
  draft,
  entries,
  filter,
  shown,
  locked,
  refusal,
  onOpen,
  onNew,
  onTick,
  onAdd,
  placeholder,
  onSearch,
  onFilter,
}: {
  declaration: FormatDeclaration
  /** Every row the address's filter holds, as the list's groups (M53 U4). */
  picture: ListPicture
  /** The entry beside the list — nothing while a new one is being written. */
  current: string | undefined
  /**
   * A new entry's title as typed, when one is being written (M53 U3): drawn as
   * a row in the group it will land in and marked, "A new task" until it has a title.
   */
  draft?: { readonly title: string; readonly group: string | undefined } | undefined
  /** Nothing is ticked or added from here. */
  locked: boolean
  /** What the last tick or quick add was refused with, or nothing. */
  refusal?: string | undefined
  onTick: (line: ListLine, value: string) => void
  onAdd: (group: ListGroup<ListLine> | undefined, title: string) => boolean
  placeholder: (group: ListGroup<ListLine> | undefined) => string
  /** How many entries the format holds, filter or not. */
  entries: number
  filter: RowFilter
  /** Drawn, or only listening for ↑ ↓. */
  shown: boolean
  onOpen: (id: string) => void
  /** The list's "+": a new entry beside it (M53 U3), two steps from an open one. */
  onNew?: (() => void) | undefined
  onSearch: (text: string) => void
  /** The filter with one thing let go of. */
  onFilter: (next: RowFilter) => void
}) {
  const rows = listOrder(picture)
  const at = rows.findIndex((row) => row.id === current)
  const box = useRef<HTMLDivElement>(null)

  // **The step** (the mockup's `step`): the next or previous row, kept at the ends.
  const step = useRef<(by: number) => void>(() => undefined)
  step.current = (by) => {
    // A draft is not paged away from: ↑ ↓ would drop what was typed.
    if (draft !== undefined) return
    const to = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at + by)))]
    if (to !== undefined && to.id !== current) onOpen(to.id)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      // A dialog over the page — the palette, a question — has the keys.
      if (document.querySelector('[aria-modal="true"]') !== null) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (
        target !== null &&
        target.dataset['arrows'] === undefined &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]') !== null
      ) {
        return
      }
      event.preventDefault()
      step.current(event.key === 'ArrowDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // What a long list draws: the rows in view, measured as it scrolls.
  const windowed = rows.length > WINDOW_PAST
  const [view, setView] = useState({ top: 0, height: 800 })
  const measure = (): void => {
    const list = box.current
    if (list !== null) setView({ top: list.scrollTop, height: list.clientHeight })
  }

  // **The list scrolls itself, never the page**, so the marked row is in view.
  useLayoutEffect(() => {
    const list = box.current
    if (list === null || at < 0) return
    if (!windowed) {
      const marked = list.querySelector<HTMLElement>('[aria-current="page"]')
      const item = marked?.closest<HTMLElement>('[role="listitem"]') ?? marked
      if (item === null || item === undefined) return
      const top = item.offsetTop
      if (top < list.scrollTop) list.scrollTop = top
      else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + item.offsetHeight - list.clientHeight
      return
    }
    const top = at * ROW
    if (top < list.scrollTop) list.scrollTop = top
    else if (top + ROW > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW - list.clientHeight
    measure()
  }, [current, rows.length, shown])

  if (!shown) return null

  const first = windowed ? Math.max(0, Math.floor(view.top / ROW) - SPARE) : 0
  const last = windowed ? Math.min(rows.length, Math.ceil((view.top + view.height) / ROW) + SPARE) : rows.length
  const search = filter.search ?? ''
  const held = Object.entries(filter.match ?? {})
  const filtered = search !== '' || held.length > 0
  const name = declaration.title
  const one = declaration.title.toLowerCase()
  const addLabel = `Add ${withArticle(one)}`

  return (
    <div
      className="hidden w-[288px] flex-none flex-col border-r border-hairline bg-background lg:flex"
      aria-label={`${name}, the list`}
    >
      <div className="flex flex-none flex-col gap-2 border-b border-hairline px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          <b className="text-[14px] font-semibold">
            <Bidi>{name}</Bidi>
          </b>
          <span className="text-caption text-ink-tertiary tabular-nums">
            {filtered ? `${String(rows.length)} of ${String(entries)}` : String(entries)}
          </span>
          {onNew !== undefined && (
            <button
              type="button"
              aria-label={addLabel}
              title={addLabel}
              onClick={onNew}
              className="ms-auto inline-flex h-7 w-7 items-center justify-center text-ink-secondary hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ActionGlyph name="add" size={16} />
            </button>
          )}
        </div>
        <label className="flex h-7 min-w-0 items-center gap-1.5 border border-hairline-strong bg-elevated px-2 text-ink-tertiary">
          <ActionGlyph name="search" size={14} />
          <input
            type="search"
            data-arrows=""
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && search !== '') {
                event.stopPropagation()
                onSearch('')
              }
            }}
            placeholder={`Search ${String(entries)} entries`}
            aria-label={`Search ${name}`}
            className="w-full min-w-0 border-0 bg-transparent p-0 text-[13px] text-ink outline-none placeholder:text-ink-tertiary"
          />
        </label>
        {filtered && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-caption text-ink-secondary">Held:</span>
            {search !== '' && (
              <HeldChip label="Clear the search" onClear={() => onSearch('')}>
                search “<Bidi>{search}</Bidi>”
              </HeldChip>
            )}
            {held.map(([column, value]) => (
              <HeldChip
                key={column}
                label={`Let go of ${column}`}
                onClear={() => {
                  const match = Object.fromEntries(held.filter(([each]) => each !== column))
                  onFilter({ ...(held.length > 1 ? { match } : {}), ...(search === '' ? {} : { search }) })
                }}
              >
                {column.replace(/_/g, ' ')}{' '}
                <HeldValues value={value} column={declaration.columns.find((each) => each.name === column)} className="" />
              </HeldChip>
            ))}
          </div>
        )}
      </div>

      <div
        ref={box}
        className="relative min-h-0 flex-1 overflow-auto outline-none"
        onScroll={windowed ? measure : undefined}
      >
        {refusal !== undefined && (
          <p className="fc-pop-enter border-b border-hairline px-3 py-1.5 text-[12px] text-negative" role="status">
            <Bidi>{refusal}</Bidi>
          </p>
        )}
        {!windowed ? (
          <div className="pb-6">
            <ListLines
              format={declaration.name}
              shape={picture.shape}
              groups={picture.groups}
              width="narrow"
              current={current}
              draft={draft === undefined ? undefined : { ...draft, one }}
              locked={locked}
              onTick={onTick}
              onOpen={(line) => onOpen(line.id)}
              onAdd={onAdd}
              placeholder={placeholder}
            />
            {rows.length === 0 && draft === undefined && filtered && (
              <div className="p-4 text-[13px] text-ink-secondary">Nothing in this format holds it.</div>
            )}
          </div>
        ) : (
          <div style={{ paddingTop: first * ROW, paddingBottom: (rows.length - last) * ROW }}>
            {rows.slice(first, last).map((row) => {
              const on = row.id === current
              const under = row.cells.flatMap((cell) =>
                cell.kind === 'date' || (cell.kind === 'text' && cell.link) ? [cell.text] : [],
              )
              return (
                <button
                  key={row.id}
                  type="button"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => onOpen(row.id)}
                  className={`relative flex w-full flex-col justify-center border-b border-hairline pr-3 pl-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                    on
                      ? 'bg-accent-soft before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent'
                      : 'hover:bg-surface'
                  }`}
                  style={{ height: ROW }}
                >
                  <Bidi className={`truncate text-[13px] ${row.ticked ? 'text-ink-tertiary line-through' : 'text-ink'}`}>{row.title}</Bidi>
                  {under.length > 0 && (
                    <Bidi className="block truncate text-[12px] text-ink-secondary">{under.join(' · ')}</Bidi>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-none gap-2.5 border-t border-hairline px-3 py-1.5 text-[11px] text-ink-tertiary">
        <span className="tabular-nums">
          {at < 0 ? '–' : String(at + 1)} of {String(rows.length)}
        </span>
        <span className="ml-auto">
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to page
        </span>
      </div>
    </div>
  )
}

/** One thing the list is held to, and the way to let go of it. */
function HeldChip({ label, onClear, children }: { label: string; onClear: () => void; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[22px] max-w-full items-center gap-1 border border-accent bg-accent-soft pr-1 pl-2 text-[12px]">
      <span className="truncate">{children}</span>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClear}
        className="inline-flex h-4 w-4 flex-none items-center justify-center text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ActionGlyph name="close" size={12} />
      </button>
    </span>
  )
}
