import { useContext, useRef, useState } from 'react'

import type { RowAggregate } from '@/data/repositories/formatJoinRepository.ts'
import type { RowDerived } from '@/data/repositories/formatDerivedRepository.ts'
import { formatMoney, money } from '@/core/money.ts'
import type { DerivedValue } from '@/domain/format/derived.ts'
import { moneyText } from '@/domain/format/aggregate.ts'
import { figureText } from '@/domain/format/identity.ts'
import {
  isChoiceType,
  isLinkType,
  isListType,
  labelColumn,
  type ColumnDeclaration,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { foundByText } from '@/domain/format/foundBy.ts'
import { companionKeyOf, isList, readValue, type RowVerdict, type StoredRow } from '@/domain/format/row.ts'
import type { RowDraft } from '@/domain/format/rowDraft.ts'
import { boundedWidth, isPercentWorkedOut } from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ChoiceField, type Choice } from '@/ui/components/ChoiceField.tsx'
import { CurrencyField, TypedHint, useTyped } from '@/ui/formats/TypedField.tsx'
import { NativePicker, pickerOf, type PickerHandle } from '@/ui/components/NativePicker.tsx'
import { MembersField } from './MembersField.tsx'
import { ElsewhereLink } from './ElsewhereLink.tsx'
import { FileLink } from './FileLink.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { cellText, type LinkChoice } from '@/ui/formats/EntryView.tsx'
import { useRowCursor } from '@/ui/useRowCursor.ts'
import { Conversation, selects } from '@/ui/formats/conversation.ts'
import type { SheetMark } from '@/ui/formats/shape.ts'
import { Flip } from '@/ui/motion/Flip.tsx'
import { useMark, type MarkTone } from '@/ui/motion/useMark.ts'
import { useChanges } from '@/ui/useChanges.ts'

/** One stored entry, with what its identities and aggregates say. */
export interface JudgedRow {
  readonly row: StoredRow
  readonly verdicts: readonly RowVerdict[]
  readonly aggregates: readonly RowAggregate[]
  /** Its worked-out columns, out of the format's view (M29 U3b, D-334). */
  readonly derived?: readonly RowDerived[]
}

export interface Order {
  readonly column: string
  readonly descending: boolean
}

/** The cell a refused batch is about, by foot row. */
export interface FootRefusal {
  readonly row: number
  readonly column: string | undefined
}

/** The empty rows at the foot, and what typing or pasting into them does. */
export interface Foot {
  readonly drafts: readonly RowDraft[]
  readonly refused: FootRefusal | undefined
  readonly onChange: (row: number, key: string, text: string) => void
  /** Focus left a row, or Enter was pressed in it. */
  readonly onLeave: (row: number) => void
  readonly onPaste: (row: number, column: number, text: string) => void
}

/**
 * **A format's entries as a sheet** — M26 U2.
 *
 * Every declared column across, each as wide as somebody dragged it (kept in
 * the document, D-289) or as its type suggests; the entries a click opens in
 * the editor; and **empty rows at the foot to type straight into**, which is
 * what makes it a sheet rather than a report. A foot row is written when focus
 * leaves it, through the same batch a paste and `record_format_rows` go
 * through — so it is typed and checked like any write, and a refusal stays in
 * the cells it is about.
 *
 * Every foot cell is a text field, with its choices under it where the column
 * has some — a link's names narrowed as they are typed, an enum's values and
 * yes/no as a menu (M26 U3, `ChoiceField`). One kind of cell is what lets a
 * pasted block land on any of them.
 *
 * Keyboard movement over the stored entries is `useRowCursor`; a foot cell
 * keeps its own keys, Enter writing the row and moving down as a spreadsheet's
 * does. `accent` marks the resize handle under a pointer and colours no figure
 * (D-125).
 */
export function RowSheet({
  declaration,
  rows,
  first,
  labels,
  links,
  order,
  widths,
  foot,
  onSort,
  onWidth,
  onOpen,
  onDelete,
  onShape,
  onAddColumn,
  onMove,
  onShapeDerived,
  marked,
  columnKeys,
  columnMenu,
}: {
  declaration: FormatDeclaration
  rows: readonly JudgedRow[]
  /** The number the first foot row carries — the entries shown, plus one. */
  first: number
  labels: ReadonlyMap<string, string>
  links: ReadonlyMap<string, readonly LinkChoice[]>
  order: Order | undefined
  widths: ReadonlyMap<string, number>
  /** Absent on a pack's format, whose rows are written only through the pack (D-269). */
  foot: Foot | undefined
  onSort: (order: Order) => void
  onWidth: (column: string, width: number | undefined) => void
  onOpen: ((row: StoredRow) => void) | undefined
  onDelete: ((row: StoredRow) => void) | undefined
  /** Open a column's name, type and checks under the sheet (M26 U3). */
  onShape: ((column: string) => void) | undefined
  /** The `+` after the last column: a new one, asked the same questions. */
  onAddColumn: (() => void) | undefined
  /**
   * A column dragged by its grip, or moved with the arrows while the grip has
   * focus (M29 U2, D-332): it goes just before `before`, or last. Absent where
   * the order is not this sheet's to change.
   */
  onMove?: ((column: string, before: string | undefined) => void) | undefined
  /** Open a worked-out column's expression under the sheet (M29 U3b, D-334). */
  onShapeDerived?: ((name: string) => void) | undefined
  /**
   * The one header the panel underneath is open on, and no other (M29 F4,
   * D-345) — a column not on the sheet yet gets a header of its own, after
   * the worked-out ones, where it will land.
   */
  marked?: SheetMark | undefined
  /**
   * What a drawn column is while its name is being typed — a draft's key, by
   * the name the sheet draws it under (M39 F1). Without it a column is its
   * name, which is right wherever a name changes only on a save.
   */
  columnKeys?: ReadonlyMap<string, string> | undefined
  /**
   * **A column's values, from its header** (M37 U4): which columns the filter
   * holds, so their funnel stays in sight, and the menu one opens — drawn
   * under the header, and closed by `close`.
   */
  columnMenu?:
    | {
        readonly held: ReadonlySet<string>
        readonly render: (column: ColumnDeclaration, close: () => void) => React.ReactNode
      }
    | undefined
}) {
  // Selecting rows for the conversation (M51 U7): only in a frame whose host
  // takes model context; Ctrl-click or `x` on the cursor's row.
  const conversation = useContext(Conversation)
  const selection = conversation.selection
  const cursor = useRowCursor(rows.length, {
    onActivate: (index) => {
      const row = rows[index]?.row
      if (row !== undefined) onOpen?.(row)
    },
    ...(selection === undefined
      ? {}
      : {
          keys: {
            x: (index: number) => {
              const row = rows[index]?.row
              if (row !== undefined) selection.toggle(declaration, row)
            },
          },
        }),
  })
  // The width under a drag, drawn live and written once, on release: one
  // write per drag rather than one per pixel, each of which would dirty the
  // document and bump every reader's revision.
  const [dragging, setDragging] = useState<{ column: string; width: number } | undefined>()
  // The one column whose menu is open, from its header (M37 U4).
  const [menuOf, setMenuOf] = useState<string | undefined>()
  const widthOf = (column: ColumnDeclaration): number => widthNamed(column.name, defaultWidth(column))
  // **A worked-out column sizes like any other** (M29 F5, D-346), kept by its
  // name beside the stored ones — a derived name never repeats a column's.
  const widthNamed = (name: string, fallback: number): number =>
    dragging?.column === name ? dragging.width : (widths.get(name) ?? fallback)

  const columns = declaration.columns
  // **M39's motion** (src/ui/motion/, D-421, D-423): rows and cells carry a key
  // to be FLIPped by, and a verdict that changed is marked once. On everywhere
  // since U2; under reduced motion the keys are drawn and nothing moves.
  const keys = motionKeys(rows, declaration)
  const keyOf = (row: StoredRow): string => keys.get(row.id) ?? row.id
  const verdictChanges = useChanges(rows.map(({ row, verdicts }) => [keyOf(row), worstOf(verdicts)?.verdict.kind ?? ''] as const))
  const col = (key: string): Record<string, string> => ({ 'data-motion-col': key })
  // **A keystroke changes no motion key** (M39 F1): a column being typed is
  // its draft's key, not its name, so the sheet's motion measures and plays
  // nothing until a column actually arrives, moves or goes.
  const colKey = (kind: 'c' | 'd', name: string): string => {
    const key = columnKeys?.get(name)
    return key === undefined ? `${kind}:${name}` : `k:${key}`
  }
  const newKey = marked?.kind === 'NEW' && marked.key !== undefined ? `k:${marked.key}` : 'new'
  // The column under a drag, and where it would land, drawn as a bar on the
  // leading edge of the column it would go before — or the trailing edge of
  // the last one. Written once, on the drop, like a width.
  const [moving, setMoving] = useState<{ column: string; before: string | undefined } | undefined>()
  const after = (name: string): string | undefined =>
    columns[columns.findIndex((each) => each.name === name) + 1]?.name
  const landsAt = (name: string, event: React.DragEvent<HTMLElement>): string | undefined => {
    const box = event.currentTarget.getBoundingClientRect()
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const leading = rtl ? event.clientX > box.left + box.width / 2 : event.clientX < box.left + box.width / 2
    return leading ? name : after(name)
  }
  const identities = declaration.identities.length > 0
  const derived = declaration.derived ?? []
  const adding = marked?.kind === 'NEW' ? marked.name : undefined
  const marks = (kind: 'COLUMN' | 'DERIVED', name: string): boolean =>
    marked?.kind === kind && marked.name === name
  const total =
    GUTTER +
    columns.reduce((sum, column) => sum + widthOf(column), 0) +
    derived.reduce((sum, each) => sum + widthNamed(each.name, DERIVED), 0) +
    (adding === undefined ? 0 : ADDING) +
    declaration.aggregates.length * AGGREGATE +
    (identities ? HOLDS : 0) +
    ACTIONS +
    (onAddColumn === undefined ? 0 : PLUS)

  const focusCell = (row: number, column: number): void => {
    document
      .querySelector<HTMLInputElement>(`[data-foot="${String(row)}:${String(column)}"]`)
      ?.focus()
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto" {...cursor.container}>
      <Flip
        as="table"
        className="border-collapse text-left"
        style={{ tableLayout: 'fixed', width: total }}
        // A column moved, added or worked out: the cells glide sideways. Never a
        // width - a drag is a hand on the edge and follows it already.
        flipKey={[
          ...columns.map((each) => colKey('c', each.name)),
          ...derived.map((each) => colKey('d', each.name)),
          adding === undefined ? '' : newKey,
          ...declaration.aggregates.map((each) => `a:${each.name}`),
          identities ? 'holds' : '',
        ].join('|')}
        attr="data-motion-col"
        groups="tr"
        // A column is every cell down the sheet, and is one piece: never a crowd.
        crowd={100_000}
        ghosts={false}
      >
        <colgroup>
          <col style={{ width: GUTTER }} />
          {columns.map((column) => (
            <col key={column.name} style={{ width: widthOf(column) }} />
          ))}
          {derived.map((each) => (
            <col key={`derived-${each.name}`} style={{ width: widthNamed(each.name, DERIVED) }} />
          ))}
          {adding !== undefined && <col style={{ width: ADDING }} />}
          {declaration.aggregates.map((each) => (
            <col key={each.name} style={{ width: AGGREGATE }} />
          ))}
          {identities && <col style={{ width: HOLDS }} />}
          <col style={{ width: ACTIONS }} />
          {onAddColumn !== undefined && <col style={{ width: PLUS }} />}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-hairline">
            <th className="border-r border-hairline" />
            {columns.map((column, index) => (
              <th
                key={column.name}
                {...col(`head|${colKey('c', column.name)}`)}
                className={`group/head relative border-r border-hairline py-2 pr-1 pl-3 text-label whitespace-nowrap ${marks('COLUMN', column.name) ? MARKED : ''}`}
                data-column={column.name}
                aria-current={marks('COLUMN', column.name) ? 'true' : undefined}
                onDragOver={
                  onMove === undefined || moving === undefined
                    ? undefined
                    : (event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        const before = landsAt(column.name, event)
                        if (before !== moving.before) setMoving({ ...moving, before })
                      }
                }
                onDrop={
                  onMove === undefined || moving === undefined
                    ? undefined
                    : (event) => {
                        event.preventDefault()
                        const before = landsAt(column.name, event)
                        setMoving(undefined)
                        if (before !== moving.column && before !== after(moving.column)) {
                          onMove(moving.column, before)
                        }
                      }
                }
              >
                {moving !== undefined &&
                  moving.column !== column.name &&
                  (moving.before === column.name ||
                    (moving.before === undefined && index === columns.length - 1)) &&
                  moving.before !== after(moving.column) && (
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 z-20 w-0.5 bg-accent ${moving.before === undefined ? '-end-px' : '-start-px'}`}
                    />
                  )}
                <span className="flex items-center">
                {/* **A column moves by its grip** (M29 U2, D-332): dragged
                    with a pointer, or focused and moved with the arrows, as a
                    width is. Shown under a pointer or a focus, like Edit —
                    and **taking no width until then** (M29 F6), so a narrow
                    column gives its name the room. */}
                {onMove !== undefined && (
                  <span className={`${UNTIL_HOVER} group-hover/head:-ml-2 focus-within:-ml-2`}>
                    <span
                      role="button"
                      tabIndex={0}
                      draggable
                      aria-label={`Move ${column.name}`}
                      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                      title={`Move ${column.name} — drag it, or press ← → while it has focus`}
                      className="fc-icon-action cursor-grab"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/x-emerald-column', column.name)
                        setMoving({ column: column.name, before: after(column.name) })
                      }}
                      onDragEnd={() => setMoving(undefined)}
                      onKeyDown={(event) => {
                        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
                        const step =
                          event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : event.key === 'ArrowRight' ? (rtl ? -1 : 1) : 0
                        let before: string | null = null
                        if (step === -1 && index > 0) before = columns[index - 1]?.name ?? null
                        else if (step === 1 && index < columns.length - 1) before = columns[index + 2]?.name ?? ''
                        else if (event.key === 'Home' && index > 0) before = columns[0]?.name ?? null
                        else if (event.key === 'End' && index < columns.length - 1) before = ''
                        if (step !== 0 || event.key === 'Home' || event.key === 'End') {
                          event.preventDefault()
                          event.stopPropagation()
                        }
                        if (before !== null) onMove(column.name, before === '' ? undefined : before)
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
                        <circle cx="9" cy="6" r="1.5" />
                        <circle cx="15" cy="6" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" />
                        <circle cx="15" cy="12" r="1.5" />
                        <circle cx="9" cy="18" r="1.5" />
                        <circle cx="15" cy="18" r="1.5" />
                      </svg>
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 text-left text-label underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  title={headed(
                    `${column.name}${column.unit === undefined ? '' : ` (${column.unit})`}${
                      column.foundBy === undefined
                        ? ''
                        : ` — found by ${foundByText(column.foundBy)}: filled on a write while it is empty`
                    }`,
                    column.note,
                  )}
                  onClick={() =>
                    onSort({
                      column: column.name,
                      descending: order?.column === column.name && !order.descending,
                    })
                  }
                >
                  <Bidi className="min-w-0 truncate">
                    {column.name}
                    {column.unit === undefined ? '' : ` (${column.unit})`}
                    {/* A link that fills itself says how (D-350). */}
                    {column.foundBy === undefined ? null : (
                      <span className="text-ink-tertiary"> · found by {column.foundBy.from}</span>
                    )}
                  </Bidi>
                  {order?.column === column.name ? (
                    <span className="shrink-0 ps-1">{order.descending ? '↓' : '↑'}</span>
                  ) : null}
                </button>
                {/* **A column's values are a click away from its name** (M37
                    U4): counted, ticked and sorted by. In sight while the
                    filter holds the column, and under a pointer otherwise. */}
                {columnMenu !== undefined && (
                  <span
                    className={
                      columnMenu.held.has(column.name) ? 'ml-1 shrink-0 text-ink' : `${UNTIL_HOVER} group-hover/head:ml-1 focus-within:ml-1`
                    }
                    data-held={columnMenu.held.has(column.name) ? 'true' : undefined}
                  >
                    <IconAction
                      label={`${column.name}: values and filter${columnMenu.held.has(column.name) ? ' (held)' : ''}`}
                      onClick={() => setMenuOf(column.name)}
                    >
                      <path d="M3 5h18l-7 8v6l-4 2v-8Z" fill={columnMenu.held.has(column.name) ? 'currentColor' : 'none'} />
                    </IconAction>
                  </span>
                )}
                {/* **The header is where a column is changed** (M26 U3): its
                    name, its type, its checks. Shown under a pointer or a
                    focus, so a sheet at rest reads as entries. */}
                {onShape !== undefined && (
                  <span className={`${UNTIL_HOVER} group-hover/head:ml-1 focus-within:ml-1`}>
                    <IconAction label={`Edit ${column.name}`} onClick={() => onShape(column.name)}>
                      <path d="m6 9 6 6 6-6" />
                    </IconAction>
                  </span>
                )}
                </span>
                {columnMenu !== undefined &&
                  menuOf === column.name &&
                  columnMenu.render(column, () => setMenuOf(undefined))}
                <ResizeHandle
                  column={column.name}
                  width={widthOf(column)}
                  onDrag={(width) => setDragging({ column: column.name, width })}
                  onDone={(width) => {
                    setDragging(undefined)
                    onWidth(column.name, width)
                  }}
                />
              </th>
            ))}
            {/* **A worked-out column is read, never typed** (M29 U3b, D-334):
                its header says what it works out under a pointer, and opens
                that expression under the sheet. **Sorted like a typed one**
                (M49 U1, D-471), by the SQL its view is — a computed date is a
                list's order. **Greyer than a typed one, and resized like one**
                (M29 F5, D-346): nobody could tell it computed, nor widen it. */}
            {derived.map((each) => (
              <th
                key={`derived-${each.name}`}
                {...col(`head|${colKey('d', each.name)}`)}
                className={`group/head relative border-r border-hairline py-2 pr-1 pl-3 text-label whitespace-nowrap ${marks('DERIVED', each.name) ? MARKED : DERIVED_LOOK}`}
                data-derived={each.name}
                aria-current={marks('DERIVED', each.name) ? 'true' : undefined}
              >
                <span className="flex items-center">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 text-left italic underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    title={headed(`${each.name} = ${each.expression}`, each.note)}
                    onClick={() =>
                      onSort({ column: each.name, descending: order?.column === each.name && !order.descending })
                    }
                  >
                    <Bidi className="min-w-0 truncate">{each.name}</Bidi>
                    {order?.column === each.name ? (
                      <span className="shrink-0 ps-1 not-italic">{order.descending ? '↓' : '↑'}</span>
                    ) : null}
                  </button>
                  {onShapeDerived !== undefined && (
                    <span className={`${UNTIL_HOVER} group-hover/head:ml-1 focus-within:ml-1`}>
                      <IconAction label={`Edit ${each.name}`} onClick={() => onShapeDerived(each.name)}>
                        <path d="m6 9 6 6 6-6" />
                      </IconAction>
                    </span>
                  )}
                </span>
                <ResizeHandle
                  column={each.name}
                  width={widthNamed(each.name, DERIVED)}
                  onDrag={(width) => setDragging({ column: each.name, width })}
                  onDone={(width) => {
                    setDragging(undefined)
                    onWidth(each.name, width)
                  }}
                />
              </th>
            ))}
            {adding !== undefined && (
              <th
                {...col(`head|${newKey}`)}
                className={`border-r border-hairline py-2 pr-1 pl-3 text-label whitespace-nowrap ${MARKED}`}
                data-adding=""
                aria-current="true"
              >
                <span className={`block truncate ${adding === '' ? 'text-ink-tertiary italic' : ''}`}>
                  {adding === '' ? 'new column' : adding}
                </span>
              </th>
            )}
            {/* **An aggregate is not sortable and is not offered as though it
                were.** It is folded on read, so ordering by one would mean
                folding every row in the table and sorting in memory. */}
            {declaration.aggregates.map((each) => (
              <th
                key={each.name}
                {...col(`head|a:${each.name}`)}
                title={
                  each.over.column === undefined
                    ? `A total of every ${each.over.format} row, added up on every read`
                    : `A total of ${each.over.format} rows, added up on every read`
                }
                className="truncate px-3 py-2 text-label whitespace-nowrap"
              >
                {each.name}
              </th>
            ))}
            {identities && (
              <th {...col('head|holds')} className="px-3 py-2 text-label whitespace-nowrap">
                holds
              </th>
            )}
            <th />
            {onAddColumn !== undefined && (
              <th className="border-l border-hairline px-1">
                <IconAction label="Add a column" tour="add-column" onClick={onAddColumn}>
                  <path d="M12 5v14M5 12h14" />
                </IconAction>
              </th>
            )}
          </tr>
        </thead>
        <Flip
          as="tbody"
          // Rows added or removed grow or shrink into place, and the rows below
          // slide. A new sort is the list replaced, and snaps.
          flipKey={`${rows.map(({ row }) => keyOf(row)).join('\n')}|${String(foot?.drafts.length ?? 0)}`}
          resetKey={JSON.stringify(order ?? null)}
        >
          {rows.map(({ row, verdicts, aggregates, derived: worked }, index) => (
            <tr
              key={row.id}
              data-motion-key={keyOf(row)}
              {...cursor.row(index)}
              aria-selected={selection === undefined ? undefined : selection.has(row.id)}
              onClick={(event) => {
                cursor.set(index)
                if (selects(event, conversation)) selection?.toggle(declaration, row)
                else onOpen?.(row)
              }}
              // No tint of its own: `tokens.css` draws the cursor as a 2px
              // `accent` rule inside the first cell, and a whole row filled with
              // `accent-soft` would put the accent behind a column of figures.
              className={`${onOpen === undefined ? '' : 'cursor-pointer '}group border-b border-hairline transition-colors duration-[var(--duration-micro)] ${selection?.has(row.id) === true ? 'bg-accent-soft' : 'hover:bg-surface'}`}
            >
              <td className="border-r border-hairline px-2 py-1.5 text-right align-top text-caption text-ink-tertiary tabular-nums">
                {index + 1}
              </td>
              {columns.map((column) => (
                <td
                  key={column.name}
                  {...col(`${keyOf(row)}|${colKey('c', column.name)}`)}
                  className={`overflow-hidden border-r border-hairline px-3 py-1.5 align-top whitespace-nowrap ${numeric(column.type) ? 'text-right tabular-nums' : ''}`}
                >
                  {/* Written by somebody else — typed here, read off a
                      receipt, or sent by a model — and half of them Hebrew. The
                      ellipsis is on the isolated span, so a Hebrew cell keeps
                      its start (M28 F21). */}
                  {column.type === 'elsewhere' && typeof row.cells[column.name] === 'string' ? (
                    <ElsewhereLink value={String(row.cells[column.name])} />
                  ) : column.type === 'file' && typeof row.cells[column.name] === 'string' ? (
                    <FileLink value={String(row.cells[column.name])} />
                  ) : (
                    <Bidi className="block truncate">{cellFor(column, row, labels)}</Bidi>
                  )}
                </td>
              ))}
              {derived.map((each) => {
                const found = worked?.find((one) => one.compiled.declaration.name === each.name)
                const value = found?.value
                return (
                  <td
                    key={`derived-${each.name}`}
                    {...col(`${keyOf(row)}|${colKey('d', each.name)}`)}
                    data-derived-cell={each.name}
                    className={`truncate border-r border-hairline px-3 py-1.5 text-right align-top tabular-nums whitespace-nowrap text-ink-secondary ${DERIVED_LOOK}`}
                    title={
                      value === undefined || value.kind !== 'EMPTY'
                        ? `= ${each.expression}`
                        : `Empty: ${value.reason}`
                    }
                  >
                    {value === undefined || value.kind === 'EMPTY' ? (
                      <span className="text-ink-tertiary">—</span>
                    ) : (
                      derivedText(value, found !== undefined && isPercentWorkedOut(found.compiled, declaration.columns))
                    )}
                  </td>
                )
              })}
              {adding !== undefined && <td {...col(`${keyOf(row)}|${newKey}`)} className="border-r border-hairline" />}
              {aggregates.map((each) => (
                <td
                  key={each.aggregate.name}
                  {...col(`${keyOf(row)}|a:${each.aggregate.name}`)}
                  className="truncate px-3 py-1.5 text-right align-top tabular-nums whitespace-nowrap"
                >
                  {each.value.kind === 'VALUE' ? (
                    <span title={`over ${String(each.value.rows)} ${each.value.rows === 1 ? 'entry' : 'entries'}`}>
                      {/* A total of money is an amount, never its minor units (M29 F7). */}
                      {each.value.currency !== undefined
                        ? moneyText(each.value.value, each.value.currency)
                        : `${trim(each.value.value)}${each.value.unit === undefined ? '' : ` ${each.value.unit}`}`}
                    </span>
                  ) : (
                    <span className="text-ink-tertiary" title={each.value.reason}>
                      unchecked
                    </span>
                  )}
                </td>
              ))}
              {identities && (
                <td {...col(`${keyOf(row)}|holds`)} className="px-3 py-1.5 align-top whitespace-nowrap">
                  <RowProof verdicts={verdicts} marked={verdictChanges.get(keyOf(row))?.times} />
                </td>
              )}
              <td {...col(`${keyOf(row)}|act`)} className="px-1 align-top text-right whitespace-nowrap">
                {/* **Every row has a door to its page** (M26 U6, D-294): the
                    sheet stays the default view, and this is the readable one. */}
                {onOpen !== undefined && (
                  <IconAction
                    label="Open"
                    tour="row-open"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(row)
                    }}
                  >
                    <path d="M6 3h9l4 4v14H6z" />
                    <path d="M9 11h7M9 15h7M9 7h3" />
                  </IconAction>
                )}
                {onDelete !== undefined && (
                  <span className="opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 focus-within:opacity-100">
                    <IconAction
                      label="Delete"
                      tone="negative"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDelete(row)
                      }}
                    >
                      <path d="M4 7h16" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M6 7l1 13h10l1-13" />
                      <path d="M9 7V4h6v3" />
                    </IconAction>
                  </span>
                )}
              </td>
              {onAddColumn !== undefined && <td className="border-l border-hairline" />}
            </tr>
          ))}

          {foot?.drafts.map((draft, at) => (
            <tr
              key={`foot-${String(at)}`}
              data-motion-key={`foot-${String(at)}`}
              className="border-b border-hairline"
              onBlur={(event) => {
                // Leaving the row, not moving between its cells.
                const next = event.relatedTarget
                if (next instanceof Node && event.currentTarget.contains(next)) return
                foot.onLeave(at)
              }}
              // The cursor's keys are the stored rows'; a field keeps its own.
              onKeyDown={(event) => event.stopPropagation()}
            >
              <td className="border-r border-hairline px-2 py-1.5 text-right align-top text-caption text-ink-tertiary tabular-nums">
                {first + at}
              </td>
              {columns.map((column, across) => (
                <FootCell
                  key={column.name}
                  motion={col(`foot-${String(at)}|${colKey('c', column.name)}`)}
                  column={column}
                  draft={draft}
                  row={at}
                  across={across}
                  choices={choicesFor(column, links)}
                  wrong={foot.refused?.row === at && foot.refused.column === column.name}
                  onChange={(key, text) => foot.onChange(at, key, text)}
                  onEnter={() => {
                    foot.onLeave(at)
                    focusCell(at + 1, across)
                  }}
                  onMove={(down) => focusCell(at + (down ? 1 : -1), across)}
                  onPaste={(text) => foot.onPaste(at, across, text)}
                />
              ))}
              <td
                {...col(`foot-${String(at)}|rest`)}
                colSpan={
                  derived.length +
                  (adding === undefined ? 0 : 1) +
                  declaration.aggregates.length +
                  (identities ? 1 : 0) +
                  1 +
                  (onAddColumn === undefined ? 0 : 1)
                }
              />
            </tr>
          ))}
        </Flip>
      </Flip>
    </div>
  )
}

/**
 * One cell of a foot row: a field, and beside a money or quantity figure the
 * currency or unit it is in — carried from the entry above, as the editor does.
 */
function FootCell({
  motion,
  column,
  draft,
  row,
  across,
  choices,
  wrong,
  onChange,
  onEnter,
  onMove,
  onPaste,
}: {
  /** M39's key to be FLIPped by (src/ui/motion/). */
  motion: Record<string, string>
  column: ColumnDeclaration
  draft: RowDraft
  row: number
  across: number
  choices: readonly Choice[] | undefined
  wrong: boolean
  onChange: (key: string, text: string) => void
  onEnter: () => void
  onMove: (down: boolean) => void
  onPaste: (text: string) => void
}) {
  const companion = companionKeyOf(column)
  // A date, a month or a time opens its picker on a click (M29 F2).
  const kind = pickerOf(column.type)
  const picker = useRef<PickerHandle>(null)
  // A percent or a time shows what it will be kept as while it is typed, and
  // becomes that when the cell is left (M29 F3, D-344).
  const typed = useTyped(column.type, draft[column.name] ?? '')
  const look = `w-full min-w-0 bg-transparent px-3 py-1.5 outline-none focus:bg-surface ${numeric(column.type) ? 'text-right tabular-nums' : ''} ${wrong ? 'text-negative' : ''}`
  const shared = {
    'data-foot': `${String(row)}:${String(across)}`,
    // The demo tour's anchor (M33 U2): the first foot row's cells only.
    'data-tour': row === 0 ? `foot-${column.name}` : undefined,
    'aria-label': column.name,
    'aria-invalid': wrong,
    // A time of day is typed as it is said — `9`, `17:30` (D-335).
    placeholder: column.type === 'time' ? '09:00' : undefined,
    dir: 'auto',
    spellCheck: false,
    onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => {
      const text = event.clipboardData.getData('text/plain')
      // One cell's worth is an ordinary paste into this field.
      if (!/[\t\r\n]/.test(text.replace(/[\r\n]+$/, ''))) return
      event.preventDefault()
      onPaste(text)
    },
  }

  return (
    <td
      {...motion}
      className={`relative border-r p-0 align-top border-hairline ${wrong ? 'shadow-[inset_0_0_0_1px_var(--color-negative)]' : ''}`}
    >
      <div className="flex">
        {isListType(column.type) ? (
          /* **A list is chips, each found the way a link is** (M27 U2,
             D-300), or picked from what is left of the list (M34 U5, D-398).
             A pasted name lands as one member. */
          <MembersField
            compact
            value={draft[column.name] ?? ''}
            label={column.name}
            choices={choices ?? []}
            onChange={(text) => onChange(column.name, text)}
            onEnter={onEnter}
          />
        ) : choices === undefined ? (
          <span className="relative flex min-w-0 flex-1">
            <input
              {...shared}
              className={look}
              style={typed.style}
              value={draft[column.name] ?? ''}
              onChange={(event) => onChange(column.name, event.target.value)}
              onBlur={(event) => {
                const settled = typed.settle(event.target.value)
                if (settled !== event.target.value) onChange(column.name, settled)
              }}
              onClick={kind === undefined ? undefined : () => picker.current?.open()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onEnter()
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  onMove(true)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  onMove(false)
                }
              }}
            />
            <TypedHint completion={typed.completion} />
          </span>
        ) : (
          /* **A link is typed and narrowed; an enum and yes/no are a menu**
             (M26 U3) — and either is still a field, so a paste lands on it. */
          <ChoiceField
            {...shared}
            className={look}
            // A link keeps the id of the row picked and shows its name: two
            // rows may share a name, and the one picked is the one meant.
            text={labelIn(choices, draft[column.name] ?? '')}
            choices={choices}
            filter={column.type === 'link'}
            onText={(text) => {
              const named = choices.filter((each) => each.label === text)
              onChange(column.name, named.length === 1 && named[0] !== undefined ? named[0].value : text)
            }}
            onPick={(choice) => onChange(column.name, choice.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onEnter()
              }
            }}
          />
        )}
        {kind !== undefined && (
          <NativePicker
            ref={picker}
            kind={kind}
            value={draft[column.name] ?? ''}
            label={column.name}
            onPick={(value) => onChange(column.name, value)}
          />
        )}
        {companion !== undefined && column.type === 'money' && (
          /* **A currency is searched and picked** (M29 F3, D-344) — its code,
             its sign and its name — and still typed when the list has not got it. */
          <CurrencyField
            className="w-12 shrink-0 bg-transparent px-1 py-1.5 font-mono text-caption text-ink-secondary outline-none focus:bg-surface"
            value={draft[companion] ?? ''}
            label={`${column.name} currency`}
            tour={row === 0 ? `foot-${column.name}-currency` : undefined}
            onChange={(code) => onChange(companion, code)}
            onEnter={onEnter}
          />
        )}
        {companion !== undefined && column.type !== 'money' && (
          <input
            className="w-12 shrink-0 bg-transparent px-1 py-1.5 font-mono text-caption text-ink-secondary outline-none focus:bg-surface"
            value={draft[companion] ?? ''}
            aria-label={`${column.name} unit`}
            placeholder="unit"
            spellCheck={false}
            onChange={(event) => onChange(companion, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onEnter()
              }
            }}
          />
        )}
      </div>
    </td>
  )
}

/**
 * The drag handle on a header's trailing edge, and a separator a keyboard can
 * move: arrows by 16px, double-click or Delete back to the type's width.
 */
function ResizeHandle({
  column,
  width,
  onDrag,
  onDone,
}: {
  column: string
  width: number
  onDrag: (width: number) => void
  onDone: (width: number | undefined) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Width of ${column}`}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none transition-colors duration-[var(--duration-micro)] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const start = event.clientX
        const target = event.currentTarget
        target.setPointerCapture(event.pointerId)
        let last = width
        const move = (each: PointerEvent): void => {
          // Right-to-left, the trailing edge is on the left and a drag right narrows.
          const sign = getComputedStyle(target).direction === 'rtl' ? -1 : 1
          last = boundedWidth(width + sign * (each.clientX - start))
          onDrag(last)
        }
        const up = (): void => {
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
          target.removeEventListener('pointercancel', up)
          onDone(last)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
        target.addEventListener('pointercancel', up)
      }}
      onDoubleClick={() => onDone(undefined)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          onDone(boundedWidth(width + (event.key === 'ArrowRight' ? 16 : -16)))
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          onDone(undefined)
        }
      }}
    />
  )
}

const GUTTER = 48
const AGGREGATE = 120
/** A worked-out column's width: a figure, like a total's, with room for a currency. */
const DERIVED = 128
/**
 * A worked-out column's ground: `surface`, a step greyer than a typed cell's,
 * so it reads as computed at a glance (M29 F5, D-346). Not `accent` — nothing
 * in it can be typed — and not `positive`, which reports a verdict.
 */
const DERIVED_LOOK = 'bg-surface'
const HOLDS = 104
const ACTIONS = 72
const PLUS = 40
/** A column being added, before it is on the sheet (M29 F4, D-345). */
const ADDING = 160
/**
 * The header the panel underneath is open on: lifted onto the surface and
 * underlined in ink — not `accent`, which marks what can be pressed (D-125).
 */
const MARKED = 'bg-surface shadow-[inset_0_-2px_0_var(--color-ink)]'
/**
 * **A header's hidden controls take no width until they show** (M29 F6): the
 * move grip and Edit kept their space while invisible, so a time column at
 * 80px truncated its name to one letter. At rest a control is zero wide and
 * clipped — still focusable, and a focus or a pointer on the header opens it.
 */
const UNTIL_HOVER =
  'w-0 shrink-0 overflow-hidden opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover/head:w-auto group-hover/head:overflow-visible group-hover/head:opacity-100 focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100'

/** A header's title: its whole name, so a truncated one reads in full, then its note. */
function headed(name: string, note: string): string {
  return note === '' ? name : `${name} — ${note}`
}

/** A column nobody has sized, by what it holds. */
function defaultWidth(column: ColumnDeclaration): number {
  switch (column.type) {
    case 'text':
    case 'links':
    case 'enums':
      return 200
    case 'link':
    case 'elsewhere':
    case 'file':
    case 'instant':
      return 180
    case 'enum':
    case 'money':
      return 140
    case 'quantity':
    case 'date':
      return 120
    case 'time':
      return 80
    case 'integer':
    case 'real':
    case 'decimal':
    case 'percent':
    case 'month':
      return 100
    case 'boolean':
      return 72
  }
}

/** What a foot cell offers as a list: an enum's values, yes/no, a link's names. */
function choicesFor(
  column: ColumnDeclaration,
  links: ReadonlyMap<string, readonly LinkChoice[]>,
): readonly Choice[] | undefined {
  const plain = (each: string): Choice => ({ value: each, label: each })
  if (isChoiceType(column.type)) return column.values.map(plain)
  if (column.type === 'boolean') return ['yes', 'no'].map(plain)
  if (isLinkType(column.type) && column.target !== undefined) {
    // By id, shown by name. A name typed or pasted that is no row's own stays
    // text, and the batch resolves it by name or refuses it (D-289).
    return (links.get(column.target) ?? []).map((each) => ({ value: each.id, label: each.label }))
  }
  return undefined
}

/** What a cell holding `value` shows: a choice's name, or what was typed. */
function labelIn(choices: readonly Choice[], value: string): string {
  return choices.find((each) => each.value === value)?.label ?? value
}

/**
 * One row's answer, at its worst — the same rule `tally` counts by (D-222). A
 * row with a failed identity is a failed row whatever else holds.
 */
function RowProof({ verdicts, marked }: { verdicts: readonly RowVerdict[]; marked?: number | undefined }) {
  const worst = worstOf(verdicts)
  const kind = worst?.verdict.kind
  const tone: MarkTone = kind === 'FAILED' ? 'negative' : kind === 'PROVED' ? 'positive' : 'neutral'
  // M39: a verdict that changed is marked once (src/ui/motion/useMark.ts).
  const mark = useMark<HTMLSpanElement>(marked, tone)
  if (worst === undefined) return <span className="text-ink-tertiary">&mdash;</span>

  const title = verdicts
    .map((each) => `${each.identity.name}: ${each.verdict.kind.toLowerCase()}`)
    .join('\n')

  if (worst.verdict.kind === 'FAILED') {
    return (
      <span ref={mark} className="text-negative" title={title}>
        failed
      </span>
    )
  }
  if (worst.verdict.kind === 'UNCHECKED') {
    return (
      <span ref={mark} className="text-ink-secondary" title={worst.verdict.reason}>
        unchecked
      </span>
    )
  }
  return (
    <span ref={mark} className="text-positive" title={title}>
      proved
    </span>
  )
}

/** The verdict a row is shown with: a failed claim is a failed row whatever else holds. */
function worstOf(verdicts: readonly RowVerdict[]): RowVerdict | undefined {
  return (
    verdicts.find((each) => each.verdict.kind === 'FAILED') ??
    verdicts.find((each) => each.verdict.kind === 'UNCHECKED') ??
    verdicts[0]
  )
}

/**
 * What a row is called, for motion (M39): its name and which of that name it
 * is, the way `useChanges` keys a roadmap - **never its id**, which a text
 * document renews when the row changes (D-247), so an edit from a conversation
 * would read as one row leaving and another arriving. A format with nothing to
 * call a row by keys it by id.
 */
function motionKeys(rows: readonly JudgedRow[], declaration: FormatDeclaration): ReadonlyMap<string, string> {
  const naming = labelColumn(declaration)
  const keys = new Map<string, string>()
  if (naming === undefined) {
    for (const { row } of rows) keys.set(row.id, row.id)
    return keys
  }
  const seen = new Map<string, number>()
  for (const { row } of rows) {
    const value = row.cells[naming.name]
    const name = typeof value === 'string' && value !== '' ? value : row.id
    const nth = (seen.get(name) ?? 0) + 1
    seen.set(name, nth)
    keys.set(row.id, `${name}#${String(nth)}`)
  }
  return keys
}

/** One cell as the table prints it, a link by what it names (D-227). */
function cellFor(
  column: ColumnDeclaration,
  row: StoredRow,
  labels: ReadonlyMap<string, string>,
): string {
  const value = readValue(column, row)
  if (column.type === 'link' && typeof value === 'string') return labels.get(value) ?? value
  // Several rows, each by its name (M27 U2, D-300).
  if (isList(value)) return value.map((id) => labels.get(id) ?? id).join(', ')
  return cellText(value)
}

/** The numeric types, which line up on the right. */
function numeric(type: ColumnDeclaration['type']): boolean {
  return (
    type === 'integer' ||
    type === 'real' ||
    type === 'decimal' ||
    type === 'percent' ||
    type === 'money' ||
    type === 'quantity'
  )
}

/** Six significant digits, the same as every other figure the engine prints. */
function trim(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return String(Number(value.toPrecision(6)))
}

/**
 * A worked-out figure as the sheet prints it (D-334) — a figure made of
 * percents alone as the percent it is, `55%` and not `0.55`, as the entry does
 * (D-402).
 */
function derivedText(value: Exclude<DerivedValue, { kind: 'EMPTY' }>, percent: boolean): string {
  if (value.kind === 'MONEY') {
    return value.currency === undefined ? figureText(value.minor / 100) : formatMoney(money(value.minor, value.currency))
  }
  if (value.kind === 'DATE') return value.date
  if (percent) return `${figureText(value.value * 100)}%`
  return `${figureText(value.value)}${value.unit === undefined ? '' : ` ${value.unit}`}`
}
