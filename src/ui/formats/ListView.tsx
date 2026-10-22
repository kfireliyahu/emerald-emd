import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { listGroupable, tickValue, type ListGroup, type ListSetting, type ListShape } from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'
import type { LineCell, ListLine, ListPicture } from '@/ui/formats/listView.ts'
import { toneOf } from '@/ui/formats/tone.ts'

/**
 * **The list** — M53 U4, D-519, ported from U1's approved mockup
 * (`docs/mockups/m53-u1/tasks.html`: its `listView`, `listRow`, `qadd` and
 * `entryList`).
 *
 * One row per line: the tick, the name (which opens the entry), and the
 * line's columns right-aligned — a list of members as dot-chips, a link's name,
 * a due relative to today, late in negative. Grouped by one column, each group
 * folds, and its ticked rows fold at its foot as *N done*. A quick add line at
 * the top of each group that is one value writes a row with what typed and
 * what the group implies.
 *
 * **One list in two widths**: `wide` is the list view, `narrow` the list
 * beside an open entry (`EntryList`) — the same groups, ticks and quick add,
 * the title with due · link under it. Which groups are folded is kept per
 * format for the session, so it holds in both.
 *
 * A tick is the screen's `updateRow`, judged as `update_format_rows` judges it
 * (the caller's `onTick`), and a row added in place is `record_format_rows`'s
 * batch (`onAdd`).
 */

/** How long a ticked row stays in place, struck, before it sinks into *N done*. */
const SINK_MS = 1100

// ---------------------------------------------------------------- kept for the session

/** Folded groups and opened *N done*s, per format — one list in two widths shares them. */
const folds = new Map<string, { readonly shut: ReadonlySet<string>; readonly open: ReadonlySet<string> }>()
/** What a row held before it was ticked, per format and line — what an untick restores. */
const before = new Map<string, string>()
const listeners = new Set<() => void>()
const NONE = { shut: new Set<string>(), open: new Set<string>() }

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function useFolds(format: string) {
  const snapshot = (): { readonly shut: ReadonlySet<string>; readonly open: ReadonlySet<string> } => folds.get(format) ?? NONE
  const kept = useSyncExternalStore(subscribe, snapshot, snapshot)
  const change = (part: 'shut' | 'open', key: string): void => {
    const was = folds.get(format) ?? NONE
    folds.set(format, { ...was, [part]: toggled(was[part], key) })
    for (const listener of listeners) listener()
  }
  return { shut: kept.shut, open: kept.open, fold: (key: string) => change('shut', key), show: (key: string) => change('open', key) }
}

// ---------------------------------------------------------------- the list

export interface ListLinesProps {
  readonly format: string
  readonly shape: ListShape<ColumnDeclaration>
  readonly groups: readonly ListGroup<ListLine>[]
  readonly width: 'wide' | 'narrow'
  /** The row open beside the list, marked. */
  readonly current?: string | undefined
  /** A new entry being written, as the row it will be, in the group it will land in. */
  readonly draft?: { readonly title: string; readonly group: string | undefined; readonly one: string } | undefined
  /** Nothing is ticked or added — a pack's format, or the conversation's read-only copy. */
  readonly locked: boolean
  /** Write this value into the column that ticks a row. */
  readonly onTick: (line: ListLine, value: string) => void
  readonly onOpen: (line: ListLine) => void
  /** Write a row with this title in this group (`undefined` for the line at the top); true when it was written. */
  readonly onAdd: (group: ListGroup<ListLine> | undefined, title: string) => boolean
  /** Quick add's placeholder for a group, or the top's. */
  readonly placeholder: (group: ListGroup<ListLine> | undefined) => string
}

export function ListLines(props: ListLinesProps) {
  const { format, shape, groups, width, locked } = props
  const narrow = width === 'narrow'
  const { shut, open, fold, show } = useFolds(format)
  // Ticked a moment ago, and still drawn in place, struck (the mockup's (d)).
  const [sinking, setSinking] = useState<ReadonlySet<string>>(new Set())
  // The title last added in place, which grows into place once.
  const [fresh, setFresh] = useState<string | undefined>(undefined)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((each) => window.clearTimeout(each)), [])

  const done = shape.done
  const tick = (line: ListLine): void => {
    if (done === undefined || locked) return
    const memory = `${format}\u0000${line.key}`
    const ticking = !line.ticked
    if (ticking && line.value !== undefined) before.set(memory, line.value)
    const value = tickValue(done, ticking, ticking ? undefined : before.get(memory))
    if (!ticking) before.delete(memory)
    setSinking((was) => {
      const next = new Set(was)
      if (ticking) next.add(line.key)
      else next.delete(line.key)
      return next
    })
    if (ticking) {
      timers.current.push(
        window.setTimeout(() => {
          setSinking((was) => {
            const next = new Set(was)
            next.delete(line.key)
            return next
          })
        }, SINK_MS),
      )
    }
    props.onTick(line, value)
  }

  const add = (group: ListGroup<ListLine> | undefined, title: string): boolean => {
    const written = props.onAdd(group, title)
    if (written) setFresh(title)
    return written
  }

  const row = (line: ListLine): ReactNode => {
    const struck = line.ticked || sinking.has(line.key)
    const common = {
      line,
      struck,
      fresh: fresh !== undefined && line.title === fresh,
      done: done !== undefined,
      locked,
      onTick: () => tick(line),
      onOpen: () => props.onOpen(line),
    }
    return narrow ? (
      <NarrowRow key={line.key} {...common} current={line.id === props.current} />
    ) : (
      <WideRow key={line.key} {...common} />
    )
  }

  const draftRow =
    props.draft === undefined ? null : (
      <div
        aria-current="page"
        className="relative flex w-full items-start gap-2.5 bg-accent-soft px-3 py-1.5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent"
      >
        {done !== undefined && <span className="mt-0.5 inline-flex size-4 flex-none border-[1.5px] border-ink-secondary" aria-hidden />}
        <Bidi className={`min-w-0 truncate text-[13px] leading-[1.35] ${props.draft.title === '' ? 'text-ink-tertiary italic' : 'text-ink'}`}>
          {props.draft.title === '' ? `A new ${props.draft.one}` : props.draft.title}
        </Bidi>
      </div>
    )
  const draftKey = props.draft === undefined ? undefined : groups.some((group) => group.key === props.draft?.group) ? props.draft.group : groups[0]?.key

  return (
    <div className="flex flex-col" role="list" aria-label="Rows">
      {narrow && !locked && <QuickAddLine narrow placeholder={props.placeholder(undefined)} onAdd={(title) => add(undefined, title)} />}
      {groups.map((group) => {
        const bare = shape.group === undefined
        const isShut = shut.has(group.key)
        const opened = group.ticked ? group.rows : group.rows.filter((line) => !line.ticked || sinking.has(line.key))
        const ticked = group.ticked ? [] : group.rows.filter((line) => line.ticked && !sinking.has(line.key))
        const showing = open.has(group.key)
        const count = group.ticked ? group.rows.length : opened.filter((line) => !line.ticked).length
        return (
          <section key={group.key} className="flex flex-col" aria-label={bare ? undefined : group.name}>
            {!bare && (
              <button
                type="button"
                aria-expanded={!isShut}
                onClick={() => fold(group.key)}
                className={
                  narrow
                    ? 'mt-2 flex h-6 w-full items-center gap-1.5 px-3 text-left text-[11px] tracking-[.06em] text-ink-secondary uppercase hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
                    : 'mt-3.5 flex h-8 w-full items-center gap-2 text-left text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
                }
              >
                <span className="fc-chev text-[10px]" data-open={!isShut} aria-hidden>
                  ▸
                </span>
                {group.member !== undefined && !narrow && <span className="fc-dot" data-tone={toneOf(group.member)} aria-hidden />}
                <Bidi className="min-w-0 truncate">{group.name}</Bidi>
                <span className="font-normal text-ink-tertiary tabular-nums">{String(count)}</span>
              </button>
            )}
            <div className="fc-fold" data-open={!isShut}>
              <div>
                {!narrow && !locked && !group.ticked && group.implies !== undefined && (
                  <QuickAddLine placeholder={props.placeholder(group)} onAdd={(title) => add(group, title)} />
                )}
                {draftKey === group.key && draftRow}
                {opened.map(row)}
                {ticked.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={showing}
                    onClick={() => show(group.key)}
                    className={
                      narrow
                        ? 'flex h-6 w-full items-center px-3 text-left text-[11px] text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
                        : 'flex h-8 w-full items-center gap-2 border-t border-hairline px-1 text-left text-[12px] text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
                    }
                  >
                    {showing ? 'Hide ' : ''}
                    {String(ticked.length)} done
                  </button>
                )}
                {showing && ticked.map(row)}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

interface RowProps {
  readonly line: ListLine
  readonly struck: boolean
  readonly fresh: boolean
  readonly done: boolean
  readonly locked: boolean
  readonly onTick: () => void
  readonly onOpen: () => void
}

/** The tick: a 16px square, filled ink when ticked. */
function Tick({ line, struck, done, locked, onTick, className = '' }: RowProps & { readonly className?: string }) {
  if (!done) return null
  const look = `inline-flex size-4 flex-none items-center justify-center border-[1.5px] ${
    struck ? 'border-ink bg-ink text-background' : 'border-ink-secondary'
  } ${className}`
  if (locked) {
    return (
      <span className={look} aria-label={struck ? 'Done' : 'Not done'} role="img">
        {struck && <ActionGlyph name="check" size={12} />}
      </span>
    )
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={struck}
      aria-label={`${struck ? 'Done' : 'Mark done'}: ${line.title}`}
      title={struck ? 'Untick: back to what it was' : 'Tick: mark it done'}
      onClick={onTick}
      className={`${look} hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      {struck && <ActionGlyph name="check" size={12} />}
    </button>
  )
}

function WideRow(props: RowProps) {
  const { line, struck, fresh, onOpen } = props
  return (
    <div
      role="listitem"
      data-line={line.title}
      className={`relative flex h-10 items-center gap-3 border-t border-hairline px-1 hover:bg-surface ${fresh ? 'fc-fresh' : ''}`}
    >
      <Tick {...props} />
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-w-0 flex-1 text-left decoration-hairline-strong underline-offset-[3px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
          struck ? 'text-ink-tertiary line-through decoration-ink-tertiary' : ''
        }`}
      >
        <Bidi className="min-w-0 truncate">{line.title}</Bidi>
      </button>
      <span className="flex flex-none items-center gap-4 text-[12px] text-ink-secondary">
        {line.cells.map((cell) => (
          <Cell key={cell.column} cell={cell} />
        ))}
      </span>
    </div>
  )
}

function NarrowRow(props: RowProps & { readonly current: boolean }) {
  const { line, struck, fresh, current, onOpen } = props
  // Under the title: the dates and links on the line — due · project.
  const under = line.cells.filter((cell) => cell.kind === 'date' || (cell.kind === 'text' && cell.link))
  return (
    <div
      role="listitem"
      data-line={line.title}
      className={`relative flex w-full items-start gap-2.5 px-3 py-1.5 ${
        current ? 'bg-accent-soft before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent' : 'hover:bg-surface'
      } ${fresh ? 'fc-fresh' : ''}`}
    >
      <Tick {...props} className="mt-0.5" />
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Bidi className={`min-w-0 truncate text-[13px] leading-[1.35] ${struck ? 'text-ink-tertiary line-through' : 'text-ink'}`}>
          {line.title}
        </Bidi>
        {under.length > 0 && (
          <span className="flex flex-wrap gap-1.5 text-[11px] text-ink-secondary">
            {under.map((cell, index) => (
              <span key={cell.column} className="inline-flex items-center gap-1.5">
                {index > 0 && <span className="text-ink-tertiary">·</span>}
                {cell.kind === 'date' ? (
                  <span className={cell.late ? 'text-negative' : ''}>{cell.text}</span>
                ) : (
                  cell.kind === 'text' && <Bidi>{cell.text}</Bidi>
                )}
              </span>
            ))}
          </span>
        )}
      </button>
    </div>
  )
}

/** One value on the wide line: chips with a dot, a member with its tone, a due right-aligned. */
function Cell({ cell }: { cell: LineCell }) {
  switch (cell.kind) {
    case 'chips':
      return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {cell.members.map((member) => (
            <span key={member} className="inline-flex items-center gap-[5px] whitespace-nowrap">
              <i className="inline-block size-1.5 rounded-full bg-ink-tertiary" aria-hidden />
              <Bidi>{member.replace(/_/g, ' ')}</Bidi>
            </span>
          ))}
        </span>
      )
    case 'member':
      return (
        <span className="inline-flex items-center gap-[5px] whitespace-nowrap">
          <span className="fc-dot" data-tone={toneOf(cell.member)} aria-hidden />
          {cell.member.replace(/_/g, ' ')}
        </span>
      )
    case 'date':
      return (
        <span className={`min-w-[84px] text-right tabular-nums ${cell.late ? 'text-negative' : ''}`} title={cell.long}>
          {cell.text}
        </span>
      )
    case 'text':
      return <Bidi className="max-w-[16rem] truncate">{cell.text}</Bidi>
  }
}

/**
 * **Quick add** (the mockup's (e)): Enter writes the title with what the group
 * implies and keeps the line for the next; Esc clears. Its placeholder names
 * every value the row will take besides its title.
 */
function QuickAddLine({
  placeholder,
  onAdd,
  narrow = false,
}: {
  placeholder: string
  onAdd: (title: string) => boolean
  narrow?: boolean
}) {
  const [text, setText] = useState('')
  return (
    <label
      className={
        narrow
          ? 'mx-3 flex h-8 items-center border-b border-hairline text-[13px] text-ink-tertiary focus-within:shadow-[inset_2px_0_0_var(--color-accent)]'
          : 'group flex h-10 items-center gap-3 border-t border-hairline px-1 text-ink-tertiary focus-within:shadow-[inset_2px_0_0_var(--color-accent)]'
      }
    >
      {!narrow && (
        <span className="inline-flex w-4 justify-center" aria-hidden>
          <ActionGlyph name="add" size={14} />
        </span>
      )}
      <input
        value={text}
        data-arrows={narrow ? undefined : ''}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text !== '') {
            event.stopPropagation()
            setText('')
            return
          }
          if (event.key !== 'Enter' || text.trim() === '') return
          event.preventDefault()
          if (onAdd(text.trim())) setText('')
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none placeholder:text-ink-tertiary"
      />
      {!narrow && <span className="text-[11px] whitespace-nowrap opacity-0 group-focus-within:opacity-100">Enter adds · Esc clears</span>}
    </label>
  )
}

// ---------------------------------------------------------------- the settings, in place

/**
 * **The list's settings, in place** (the mockup's (a)): one 32px row of menus
 * above the list — *Group by*, *Ticked when*, *Line* — never a settings screen.
 */
export function ListSettings({
  shape,
  columns,
  locked,
  onGroup,
  onDone,
  onLine,
}: {
  shape: ListShape<ColumnDeclaration>
  columns: readonly ColumnDeclaration[]
  /** The conversation's read-only copy: the settings are said, not offered. */
  locked: boolean
  onGroup: (column: string | undefined) => void
  onDone: (column: string, member: string) => void
  onLine: (columns: readonly string[]) => void
}) {
  const groupable = columns.filter(listGroupable)
  const lineable = columns.filter((column) => column !== shape.name)
  const doneable = columns.flatMap((column) =>
    column.type === 'enum'
      ? (column.values ?? []).map((member) => ({ column: column.name, member }))
      : column.type === 'boolean'
        ? [{ column: column.name, member: 'true' }]
        : [],
  )
  const doneText = (column: string, member: string): string =>
    member === 'true' ? `${column.replace(/_/g, ' ')} is yes` : `${column.replace(/_/g, ' ')} is ${member.replace(/_/g, ' ')}`
  const lines = shape.lines.map((column) => column.name)
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-[18px] gap-y-1.5 border-b border-hairline px-6 py-1 text-[12px] text-ink-secondary">
      <span className="inline-flex items-center gap-1">
        Group by
        <Menu label="Group by" said={shape.group === undefined ? 'nothing' : shape.group.name.replace(/_/g, ' ')} locked={locked}>
          {(close) => (
            <>
              {groupable.map((column) => (
                <MenuItem
                  key={column.name}
                  on={shape.group === column}
                  hint={column.type === 'date' ? 'late, today, tomorrow…' : column.type === 'link' ? 'a link' : 'an enum'}
                  onPick={() => {
                    onGroup(column.name)
                    close()
                  }}
                >
                  {column.name.replace(/_/g, ' ')}
                </MenuItem>
              ))}
              <MenuItem
                on={shape.group === undefined}
                onPick={() => {
                  onGroup(undefined)
                  close()
                }}
              >
                Nothing
              </MenuItem>
            </>
          )}
        </Menu>
      </span>
      {shape.done !== undefined && (
        <span className="inline-flex items-center gap-1">
          Ticked when
          <Menu
            label="Ticked when"
            said={shape.done.members.map((member) => doneText(shape.done?.column.name ?? '', member)).join(' or ')}
            locked={locked || doneable.length < 2}
          >
            {(close) =>
              doneable.map((each) => (
                <MenuItem
                  key={`${each.column}:${each.member}`}
                  on={shape.done?.column.name === each.column && shape.done.members.includes(each.member)}
                  onPick={() => {
                    onDone(each.column, each.member)
                    close()
                  }}
                >
                  {doneText(each.column, each.member)}
                </MenuItem>
              ))
            }
          </Menu>
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        Line
        <Menu label="Line: after the title" said={lines.length === 0 ? 'nothing' : lines.map((name) => name.replace(/_/g, ' ')).join(', ')} locked={locked}>
          {() =>
            lineable.map((column) => {
              const on = lines.includes(column.name)
              return (
                <MenuItem
                  key={column.name}
                  on={on}
                  onPick={() => onLine(on ? lines.filter((name) => name !== column.name) : [...lines, column.name])}
                >
                  {column.name.replace(/_/g, ' ')}
                </MenuItem>
              )
            })
          }
        </Menu>
      </span>
    </div>
  )
}

/** A setting's value that opens its menu. */
function Menu({
  label,
  said,
  locked,
  children,
}: {
  label: string
  said: string
  locked: boolean
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const dismiss = useDismiss(open, box, () => setOpen(false))
  if (locked) return <Bidi className="px-1 text-ink">{said}</Bidi>
  return (
    <span ref={box} className="relative inline-flex" onKeyDown={dismiss}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${said}`}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex h-6 items-center gap-1 px-1 text-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Bidi>{said}</Bidi>
        <span className="text-[10px] text-ink-tertiary" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="fc-pop-enter absolute top-full left-0 z-30 mt-1 flex max-h-[60vh] w-60 flex-col overflow-y-auto rounded-md border border-hairline-strong bg-elevated p-1 text-[13px] text-ink shadow-[var(--shadow-pop)]"
        >
          <div className="px-2 pt-1 pb-1.5 text-[11px] tracking-[.06em] text-ink-tertiary uppercase">{label}</div>
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  )
}

function MenuItem({ on, hint, onPick, children }: { on: boolean; hint?: string; onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={onPick}
      className="flex h-7 items-center gap-2 rounded px-2 text-left hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="inline-flex w-3.5 justify-center text-ink" aria-hidden>
        {on && <ActionGlyph name="check" size={12} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && <span className="text-[11px] text-ink-tertiary">{hint}</span>}
    </button>
  )
}

// ---------------------------------------------------------------- the list view

/**
 * **The list view** — `#/formats/<name>/list`: the settings in place, what the
 * last tick or quick add was refused with, and the list, wide. Clicking a name
 * opens the entry with the same list beside it, narrow.
 */
export function ListPage({
  picture,
  declaration,
  locked,
  refusal,
  onTick,
  onAdd,
  placeholder,
  onOpen,
  onSetting,
}: {
  picture: ListPicture
  declaration: FormatDeclaration
  locked: boolean
  refusal: string | undefined
  onTick: (picture: ListPicture, line: ListLine, value: string) => void
  onAdd: (picture: ListPicture, group: ListGroup<ListLine> | undefined, title: string) => boolean
  placeholder: (picture: ListPicture, group: ListGroup<ListLine> | undefined) => string
  onOpen: (line: ListLine) => void
  /** Change these columns' list settings, each from what it holds — one write. */
  onSetting: (columns: readonly string[], change: (column: string, was: ListSetting) => ListSetting) => void
}) {
  const { shape } = picture
  const names = declaration.columns.map((column) => column.name)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListSettings
        shape={shape}
        columns={declaration.columns}
        locked={locked}
        onGroup={(column) =>
          onSetting(
            [...new Set([...(shape.group === undefined ? [] : [shape.group.name]), ...(column === undefined ? [] : [column])])],
            (name, was) => ({ ...was, group: name === column }),
          )
        }
        onDone={(column, member) => onSetting([column], (_name, was) => ({ ...was, done: [member] }))}
        onLine={(chosen) =>
          onSetting(
            names.filter((name) => name !== shape.name?.name),
            (name, was) => ({ ...was, line: chosen.includes(name) }),
          )
        }
      />
      {refusal !== undefined && (
        <p className="fc-pop-enter shrink-0 border-b border-hairline px-6 py-2 text-caption text-negative" role="status">
          <Bidi>{refusal}</Bidi>
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[980px] px-6 pt-2 pb-16">
          <ListLines
            format={declaration.name}
            shape={shape}
            groups={picture.groups}
            width="wide"
            locked={locked}
            onTick={(line, value) => onTick(picture, line, value)}
            onOpen={onOpen}
            onAdd={(group, title) => onAdd(picture, group, title)}
            placeholder={(group) => placeholder(picture, group)}
          />
        </div>
      </div>
    </div>
  )
}
