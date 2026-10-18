import { useContext, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type {
  AgendaData,
  AgendaLine,
  FoldedLines,
  LinkedLines,
  ReadyData,
  RoadmapData,
  ViewLine,
} from '@/data/repositories/formatLinkViewRepository.ts'
import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { idsIn, readValue } from '@/domain/format/row.ts'
import { dayText, relativeDay } from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import type { ColumnChoice } from '@/ui/formats/addressFilter.ts'
import { cardText } from '@/ui/formats/BoardView.tsx'
import { ColumnsChoice } from '@/ui/formats/ColumnsChoice.tsx'
import { Conversation, selects } from '@/ui/formats/conversation.ts'
import { chosenLines, lineChoosable } from '@/ui/formats/lineColumns.ts'
import { StateChip } from '@/ui/formats/StateChip.tsx'
import { liveIndex, memberText, toneOf } from '@/ui/formats/tone.ts'
import { entryPath } from '@/ui/nav.ts'
import { changeClass, useChanges, type Change } from '@/ui/useChanges.ts'

/**
 * **The roadmap** — M27 U4, D-302; drawn as a timeline since M27 U8, D-306.
 *
 * One format's rows in the order of a number column, each a dot on one
 * vertical line, with the rows that name it folded beneath. Drawn the same for
 * any format that has a number and is named by another — the development pack
 * only says which column is the order, which link folds, and what a line shows.
 *
 * The line is solid up to the live row and dashed after it (`liveIndex`): what
 * happened, then what is ahead. Each row carries a bar with a segment per row
 * folded under it, so a milestone folded shut still says how far it got —
 * which is what keeps thirty of them scannable.
 *
 * A row whose state is its enum's **last** member starts folded shut (D-302);
 * the rest start open. A click on the dot or the chevron folds any of them.
 *
 * It keeps nothing: every line comes from `roadmapData`, read again on every
 * revision, so a write from anywhere is on the next render (M27 U6) — and the
 * row it changed is the one that pulses (`useChanges`), keyed by what the row
 * is called, because a text document renews its ids on every write.
 *
 * **Which number it runs in is the screen's to choose too** (M48 U3): given
 * `orders` — the format's number columns — and more than one of them, *In the
 * order of* is a menu, as a board's *Lanes by* is, writing what
 * `arrange_views` writes.
 *
 * **And which columns the rows under each row draw** (M37 U5, D-478):
 * `columns`, per folded format, from the address — a unit by its title and
 * state alone. Given `onColumns`, *Columns* chooses them.
 */
export function RoadmapView({
  data,
  orders = [],
  onOrder,
  columns = {},
  onColumns,
}: {
  data: RoadmapData
  orders?: readonly ColumnDeclaration[]
  onOrder?: (column: string) => void
  columns?: ColumnChoice
  onColumns?: (next: ColumnChoice) => void
}) {
  const { shape, labels } = data
  const last = shape.state?.values?.at(-1)
  // The rows whose fold differs from where they start, by key.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())

  const keys = uniqueKeys(data.rows.map(({ line }) => line))
  const startsOpen = (line: ViewLine) => last === undefined || stateText(line) !== last
  const isOpen = (line: ViewLine, key: string) => startsOpen(line) !== toggled.has(key)
  const toggle = (key: string) =>
    setToggled((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const folded = [...data.rows.flatMap(({ folds }) => folds), ...data.loose].flatMap((each) => each.lines)
  const changes = useChanges(
    [...data.rows.map(({ line }) => line), ...folded].map((line) => [keyOf(line), signatureOf(line, labels)] as const),
  )

  const tones = data.rows.map(({ line }) => toneOf(stateText(line)))
  const at = liveIndex(tones)
  const allOpen = data.rows.every(({ line }, index) => isOpen(line, keys[index] ?? ''))
  const setAll = (open: boolean) =>
    setToggled(new Set(data.rows.filter(({ line }) => startsOpen(line) !== open).map((_, index) => keys[index] ?? '')))

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col px-6 pt-8 pb-24">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-6">
          <div className="flex flex-col gap-2">
            <div className="fc-label">
              <Bidi>{data.rows[0]?.line.format.title ?? ''}</Bidi> · in the order of {memberText(shape.order.name)}
            </div>
            <h1 className="text-title">Roadmap</h1>
            <Counts data={data} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {onOrder !== undefined && orders.length > 1 && (
              <label className="flex items-center gap-2 text-caption text-ink-secondary">
                In the order of
                <select
                  className={`${FIELD} w-40`}
                  value={shape.order.name}
                  onChange={(event) => onOrder(event.target.value)}
                  aria-label="In the order of"
                >
                  {orders.map((each) => (
                    <option key={each.name} value={each.name}>
                      {each.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {onColumns !== undefined && (
              <ColumnsChoice
                formats={shape.folds.map((fold) => lineChoosable(fold.format, fold, [fold.through]))}
                chosen={columns}
                onChange={onColumns}
              />
            )}
            {data.rows.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setAll(!allOpen)}>
                {allOpen ? 'Fold all' : 'Unfold all'}
              </Button>
            )}
          </div>
        </header>
        {data.rows.length === 0 ? (
          <p className="pt-6 text-ink-secondary">Nothing here yet.</p>
        ) : (
          <ol className="pt-6" aria-label="Roadmap">
            {data.rows.map(({ line, folds }, index) => {
              const key = keys[index] ?? ''
              const open = isOpen(line, key)
              const change = changes.get(keyOf(line))
              const lines = folds.flatMap((each) => each.lines)
              const { lead, rest } = splitLines(line, labels)
              return (
                // The demo tour's anchor (M33 F5): `roadmap-M4`, a row and what is folded under it.
                <li key={key} className="fc-tl" data-tour={`roadmap-${nameText(line)}`}>
                  <div
                    className="fc-tl-rail"
                    data-above={index === 0 ? 'none' : index <= at ? 'solid' : 'dashed'}
                    data-below={index === data.rows.length - 1 ? 'none' : index < at ? 'solid' : 'dashed'}
                  >
                    <button
                      type="button"
                      className={`fc-tl-dot fc-pulse ${changeClass('fc-pulse', change)}`}
                      data-tone={tones[index]}
                      aria-label={`${open ? 'Fold' : 'Unfold'} ${nameText(line)}`}
                      onClick={() => toggle(key)}
                    />
                  </div>
                  <div className="min-w-0 pb-2">
                    <div
                      className={`-ml-3 cursor-pointer px-3 pt-2.5 pb-3 transition-colors duration-[var(--duration-micro)] hover:bg-surface ${changeClass('fc-changed', change)}`}
                      onClick={() => toggle(key)}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <button
                          type="button"
                          className="fc-chev w-2.5"
                          data-open={open}
                          aria-expanded={open}
                          aria-label={`${open ? 'Fold' : 'Unfold'} ${nameText(line)}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggle(key)
                          }}
                        >
                          ›
                        </button>
                        <NameLink line={line} className="font-mono text-caption text-ink-secondary" />
                        {lead !== undefined && <span className="text-heading font-medium">{lead}</span>}
                        <StateChip member={stateText(line)} />
                        {rest.links}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 pt-1.5 pl-[22px]">
                        <SegmentBar lines={lines} />
                        <span className="text-caption text-ink-secondary">{countsText(folds)}</span>
                      </div>
                      {rest.texts.length > 0 && (
                        <p className={`max-w-[720px] pt-1.5 pl-[22px] text-ink-secondary ${open ? '' : 'line-clamp-1'}`}>
                          {rest.texts.map((each) => (
                            <span key={each.column}>
                              <Bidi>{each.text}</Bidi>{' '}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <Fold open={open}>
                      <div className="pt-1 pb-3 pl-2.5">
                        <FoldGroups folds={folds} labels={labels} changes={changes} columns={columns} />
                      </div>
                    </Fold>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {data.loose.length > 0 && (
          <section className="mt-6 border-t border-hairline pt-4" aria-label="Under none">
            <h3 className="fc-label pb-2">Under none of these</h3>
            <FoldGroups folds={data.loose} labels={labels} changes={changes} columns={columns} />
          </section>
        )}
      </div>
    </div>
  )
}

/** The roadmap's own rows counted by state, then each fold's rows that are done. */
function Counts({ data }: { data: RoadmapData }) {
  const members = data.shape.state?.values ?? []
  const states = data.rows.map(({ line }) => stateText(line))
  const parts: ReactNode[] = members
    .map((member) => [member, states.filter((each) => each === member).length] as const)
    .filter(([, count]) => count > 0)
    .map(([member, count]) => (
      <span key={member}>
        <span className="font-medium text-ink tabular-nums">{count}</span> {memberText(member)}
      </span>
    ))
  for (const fold of data.shape.folds) {
    const under = data.rows.flatMap(({ folds }) => folds.filter((each) => each.fold === fold))
    const lines = under.flatMap((each) => each.lines)
    if (lines.length === 0) continue
    const done = lines.filter((line) => toneOf(stateText(line)) === 'done').length
    // A fold held to some of its rows says so (M37 U5): the count is of those.
    const total = under.reduce((sum, each) => sum + each.total, 0)
    parts.push(
      <span key={`${fold.format.name}.${fold.through.name}`}>
        <span className="font-medium text-ink tabular-nums">{done}</span> of {lines.length}{' '}
        <Bidi>{fold.format.title}</Bidi> rows done
        {total > lines.length && ` · ${String(lines.length)} of ${String(total)} shown`}
      </span>,
    )
  }
  return parts.length === 0 ? null : (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-secondary">{parts}</div>
  )
}

/** Each fold's rows under one row, headed by the format's name when there is more than one. */
function FoldGroups({
  folds,
  labels,
  changes,
  columns,
}: {
  folds: readonly FoldedLines[]
  labels: ReadonlyMap<string, string>
  changes: ReadonlyMap<string, Change>
  columns: ColumnChoice
}) {
  const shown = folds.filter((each) => each.lines.length > 0)
  if (shown.length === 0) {
    const held = folds.some((each) => each.total > 0)
    return (
      <p className="border-t border-hairline py-2 text-caption text-ink-secondary">
        {held ? 'Nothing under it matches the filter.' : 'Nothing names it yet.'}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {shown.map(({ fold, lines }) => (
        <section key={`${fold.format.name}.${fold.through.name}`} aria-label={fold.format.title}>
          {folds.length > 1 && (
            <h4 className="fc-label pb-1">
              <Bidi>{fold.format.title}</Bidi>
            </h4>
          )}
          <ul>
            {uniqueKeys(lines).map((key, index) => {
              const line = lines[index]
              return line === undefined ? null : (
                <RowLine
                  key={key}
                  line={line}
                  labels={labels}
                  change={changes.get(keyOf(line))}
                  chosen={columns[line.format.name]}
                />
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * One row as a line of a list: a dot in its tone, its name as a link to its
 * page, its first line column as its title with the rest beneath it, then its
 * links and its state. The roadmap's folds and the ready view both draw these.
 * `chosen` is which columns it draws (M37 U5); the name and the dot stay.
 */
function RowLine({
  line,
  labels,
  change,
  after,
  chosen,
  act,
}: {
  line: ViewLine
  labels: ReadonlyMap<string, string>
  change?: Change | undefined
  after?: ReactNode
  chosen?: readonly string[] | undefined
  /** What the row's end offers beside its state (M51 U7: *Start this unit*). */
  act?: ReactNode
}) {
  const conversation = useContext(Conversation)
  const selected = conversation.selection?.has(line.row.id)
  const state = stateText(line)
  const tone = toneOf(state)
  const drawn = chosenLines(line.format, line.shape, chosen)
  const { lead, rest } = splitLines(line, labels, drawn.lines)
  return (
    <li
      // The demo tour's anchor (M33 U6): `line-M2 U3`, a unit on the roadmap.
      data-tour={`line-${nameText(line)}`}
      aria-selected={selected}
      className={`-ml-3 grid grid-cols-[18px_auto_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-hairline px-3 py-[7px] ${selected === true ? 'bg-accent-soft' : ''} ${changeClass('fc-changed', change)}`}
      // Ctrl-click selects the row for the conversation (M51 U7), before the
      // name's link would open it.
      onClickCapture={(event) => {
        if (!selects(event, conversation)) return
        event.preventDefault()
        event.stopPropagation()
        conversation.selection?.toggle(line.format, line.row)
      }}
    >
      <span className="fc-dot fc-pulse justify-self-center" data-tone={tone} aria-hidden />
      <NameLink line={line} className="font-mono text-caption text-ink-secondary" />
      <span className="min-w-0">
        {lead !== undefined && (
          <span className={tone === 'struck' ? 'text-ink-secondary line-through' : ''}>{lead}</span>
        )}
        {rest.texts.length > 0 && (
          <span className="block text-caption text-ink-secondary">
            {rest.texts.map((each, at) => (
              <span key={each.column}>
                {at > 0 && ' · '}
                {memberText(each.column)} <Bidi>{each.text}</Bidi>
              </span>
            ))}
          </span>
        )}
        {after}
      </span>
      <span className="flex items-center justify-end gap-3">
        {act}
        {drawn.state && <StateChip member={state} />}
        {rest.links}
      </span>
    </li>
  )
}

/** A segment per row, in its tone — the folded row's progress at a glance. */
function SegmentBar({ lines }: { lines: readonly ViewLine[] }) {
  if (lines.length === 0) return null
  return (
    <span className="fc-bar" data-dense={lines.length > 40} aria-hidden>
      {lines.map((line, index) => (
        <span key={index} className="fc-seg" data-tone={toneOf(stateText(line))} />
      ))}
    </span>
  )
}

/** "12 built · 1 in progress · 2 planned", in the order the enum declares — and "2 of 12 shown" when a filter held some back. */
function countsText(folds: readonly FoldedLines[]): string {
  const parts: string[] = []
  for (const { fold, lines, total } of folds) {
    const states = lines.map((line) => stateText(line))
    const members = [...(fold.state?.values ?? []), ...new Set(states.filter((each) => each !== undefined))]
    for (const member of new Set(members)) {
      const count = states.filter((each) => each === member).length
      if (count > 0) parts.push(`${String(count)} ${memberText(member)}`)
    }
    const none = states.filter((each) => each === undefined).length
    if (none > 0) parts.push(`${String(none)} with no ${fold.state?.name ?? 'state'}`)
    if (total > lines.length) parts.push(`${String(lines.length)} of ${String(total)} shown`)
  }
  return parts.length === 0 ? 'nothing beneath' : parts.join(' · ')
}

/** A fold that opens and shuts with a grid-rows transition, and is inert while shut. */
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="fc-fold" data-open={open}>
      <div
        ref={(element) => {
          element?.toggleAttribute('inert', !open)
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * **What is ready** — M27 U5, D-303.
 *
 * The rows in a ready member that wait on nothing still open, and under them
 * the ones that are held, each with what holds it. Held is drawn rather than
 * left out: a row missing from *ready* with no reason given is the quiet kind
 * of wrong. Read on every revision, like the roadmap.
 *
 * Which columns its lines draw is `columns` (M37 U5), as on the roadmap; given
 * `choosing`, *Columns* chooses them.
 */
export function ReadyView({
  data,
  columns = {},
  choosing,
}: {
  data: ReadyData
  columns?: ColumnChoice
  choosing?: { readonly format: FormatDeclaration; readonly onChange: (next: ColumnChoice) => void }
}) {
  const { shape, labels } = data
  const { start } = useContext(Conversation)
  const named = choosing?.format.name ?? (data.ready[0] ?? data.held[0]?.line)?.format.name
  const own = named === undefined ? undefined : columns[named]
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-6 pt-8 pb-24">
        <header className="flex flex-col gap-2 border-b border-hairline pb-6">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h1 className="text-title">Ready to start</h1>
            {choosing !== undefined && (
              <ColumnsChoice
                formats={[lineChoosable(choosing.format, shape, [shape.waits])]}
                chosen={columns}
                onChange={choosing.onChange}
              />
            )}
          </div>
          <p className="text-ink-secondary">
            <code>{shape.state.name}</code> is {shape.members.ready.map(memberText).join(' or ')}, and nothing in{' '}
            <code>{shape.waits.name}</code> is still open — open being anything but{' '}
            {shape.members.done.map(memberText).join(' or ')}.
          </p>
        </header>
        <section aria-label="Ready to start">
          <h3 className="fc-label pb-2">Ready to start · {data.ready.length}</h3>
          {data.ready.length === 0 ? (
            <p className="border-t border-hairline py-2.5 text-caption text-ink-secondary">Nothing</p>
          ) : (
            <ul>
              {uniqueKeys(data.ready).map((key, index) => {
                const line = data.ready[index]
                return line === undefined ? null : (
                  <RowLine
                    key={key}
                    line={line}
                    labels={labels}
                    chosen={own}
                    // Where the frame's host takes a message (M51 U7): one line
                    // naming the row and its brief, sent as the person.
                    act={
                      start === undefined ? undefined : (
                        <Button variant="secondary" size="sm" onClick={() => start(line.format, line.row)}>
                          Start this {line.format.title.toLowerCase()}
                        </Button>
                      )
                    }
                  />
                )
              })}
            </ul>
          )}
        </section>
        {data.held.length > 0 && (
          <section aria-label="Held">
            <h3 className="fc-label pb-2">Held · {data.held.length}</h3>
            <ul>
              {uniqueKeys(data.held.map(({ line }) => line)).map((key, index) => {
                const held = data.held[index]
                return held === undefined ? null : (
                  <RowLine
                    key={key}
                    line={held.line}
                    labels={labels}
                    chosen={own}
                    after={
                      <span className="flex flex-wrap items-baseline gap-x-2 text-caption text-ink-secondary">
                        waits on
                        {held.by.map((each) => (
                          <span key={each.row.id} className="flex items-baseline gap-x-1.5">
                            <NameLink line={each} className="font-mono text-ink-secondary" />
                            {stateText(each) !== undefined && <StateChip member={stateText(each)} />}
                          </span>
                        ))}
                      </span>
                    }
                  />
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

/**
 * **The agenda** — M49 U3, D-473: every dated format's rows on one list of
 * days, today first, and above today what a format says it still owes.
 *
 * A list grouped by day rather than a week's grid: a day with nothing on it is
 * not drawn, a row's name is a format's own text and is never cut to fit a
 * seventh of the width, overdue has a place to be, and it reads the same in a
 * conversation's narrow frame as in the window. Each row is a dot in its
 * state's tone, its format, its name opening its entry, its lines and its
 * state — the roadmap's line with the format said, since several share a day.
 */
export function AgendaView({
  data,
  onDate,
}: {
  data: AgendaData
  /** Put a format on the agenda by another of its dates — the agenda's *by*, what `arrange_views` writes. */
  onDate?: (format: string, column: string) => void
}) {
  const { labels } = data
  const empty = data.overdue.length === 0 && data.days.length === 0
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-6 pt-8 pb-24">
        <header className="flex flex-col gap-2 border-b border-hairline pb-6">
          <div className="fc-label">{dayText(data.today)}</div>
          <h1 className="text-title">Agenda</h1>
          <p className="text-ink-secondary">
            {data.formats.length === 0 ? (
              'No format here is on the agenda.'
            ) : (
              <>
                From today on —{' '}
                {data.formats.map(({ declaration, shape }, at) => (
                  <span key={declaration.name}>
                    {at > 0 && ', '}
                    <Bidi>{declaration.title}</Bidi> by{' '}
                    <DateChoice declaration={declaration} chosen={shape.date.name} onDate={onDate} />
                  </span>
                ))}
                {data.formats.some((each) => each.shape.done !== undefined) && ', and what is overdue above it'}.
              </>
            )}
          </p>
          {data.left.length > 0 && (
            <p className="text-caption text-ink-secondary">
              Left off: {data.left.map((each) => each.reason).join(' ')}
            </p>
          )}
        </header>
        {empty && <p className="text-ink-secondary">Nothing on the agenda from today on.</p>}
        {data.overdue.length > 0 && (
          <section aria-label="Overdue">
            <h3 className="fc-label pb-2">Overdue · {data.overdue.length}</h3>
            <ul>
              {uniqueKeys(data.overdue).map((key, index) => {
                const line = data.overdue[index]
                return line === undefined ? null : <AgendaRow key={key} line={line} labels={labels} today={data.today} />
              })}
            </ul>
          </section>
        )}
        {data.days.map((day) => {
          const near = relativeDay(day.date, data.today)
          const said = near === 'today' || near === 'tomorrow' ? `${near === 'today' ? 'Today' : 'Tomorrow'} · ${dayText(day.date)}` : `${dayText(day.date)}${near === undefined ? '' : ` · ${near}`}`
          return (
            <section key={day.date} aria-label={dayText(day.date)} data-day={day.date}>
              <h3 className={`fc-label pb-2 ${day.date === data.today ? 'text-ink' : ''}`}>
                {said} · {day.rows.length}
              </h3>
              <ul>
                {uniqueKeys(day.rows).map((key, index) => {
                  const line = day.rows[index]
                  return line === undefined ? null : <AgendaRow key={key} line={line} labels={labels} today={data.today} />
                })}
              </ul>
            </section>
          )
        })}
        {data.formats.some((each) => each.more > 0) && (
          <p className="text-caption text-ink-secondary">
            {data.formats
              .filter((each) => each.more > 0)
              .map((each) => `${each.declaration.title} has ${String(each.more)} more after these.`)
              .join(' ')}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Which date puts a format on the agenda: a menu when it has more than one
 * date and the screen can write, as the roadmap's *In the order of* is; the
 * column's name otherwise.
 */
function DateChoice({
  declaration,
  chosen,
  onDate,
}: {
  declaration: AgendaData['formats'][number]['declaration']
  chosen: string
  onDate: ((format: string, column: string) => void) | undefined
}) {
  const dates = declaration.columns.filter((column) => column.type === 'date')
  if (onDate === undefined || dates.length < 2) return <code>{chosen}</code>
  return (
    <select
      className={`${FIELD} inline-block w-auto py-0`}
      value={chosen}
      onChange={(event) => onDate(declaration.name, event.target.value)}
      aria-label={`${declaration.title} is on the agenda by`}
    >
      {dates.map((each) => (
        <option key={each.name} value={each.name}>
          {each.name}
        </option>
      ))}
    </select>
  )
}

/** One row of the agenda: its tone, its format, its name and lines, its state — and on an overdue row, its day. */
function AgendaRow({ line, labels, today }: { line: AgendaLine; labels: ReadonlyMap<string, string>; today: string }) {
  const state = stateText(line)
  const tone = toneOf(state)
  const { lead, rest } = splitLines(line, labels)
  return (
    <li
      data-agenda={`${line.format.name}-${nameText(line)}`}
      className="-ml-3 grid grid-cols-[18px_minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-hairline px-3 py-[7px]"
    >
      <span className="fc-dot justify-self-center" data-tone={tone} aria-hidden />
      <Bidi className="block truncate text-caption text-ink-secondary">{line.format.title}</Bidi>
      <span className="min-w-0">
        <Link
          to={entryPath(line.format.name, line.row.id)}
          className={`underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${tone === 'struck' ? 'text-ink-secondary line-through' : ''}`}
        >
          <Bidi>{nameText(line)}</Bidi>
        </Link>
        {(line.overdue || lead !== undefined || rest.texts.length > 0) && (
          <span className="block text-caption text-ink-secondary">
            {line.overdue && (
              <span>
                {dayText(line.date)} · {relativeDay(line.date, today) ?? ''}
                {(lead !== undefined || rest.texts.length > 0) && ' · '}
              </span>
            )}
            {lead}
            {rest.texts.map((each, at) => (
              <span key={each.column}>
                {(at > 0 || lead !== undefined) && ' · '}
                {memberText(each.column)} <Bidi>{each.text}</Bidi>
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="flex items-center justify-end gap-3">
        <StateChip member={state} />
        {rest.links}
      </span>
    </li>
  )
}

/**
 * **What names this row**, in the right-hand column of its entry — M35 U2,
 * D-401; it was the page's (M27 U4, D-302).
 *
 * Every link column, in any format, that names this one gets a section headed
 * by its format and column. **Where nothing does, it is still answered, once**:
 * the empty ones are named together on one line under *Nothing yet from*
 * (M33 U2) rather than each as a heading over the word *Nothing* — a card line
 * with six of the ledger's own links empty was six headings saying so, above
 * the one that held something. An empty answer is still an answer; it is just
 * not a section. Each row is a dot in its
 * tone, its name opening its own entry, its state, and the title its entry
 * draws beneath when that is not its name. **One hop**: a link from a format to
 * itself — a decision's `supersedes` — shows its next step, never the chain.
 */
export function NamedBy({
  groups,
  title,
  fresh,
  labels,
}: {
  groups: readonly LinkedLines[]
  /** The format's title, for the sentence when nothing can name it. */
  title: string
  /** A row not added yet, which nothing can name. */
  fresh: boolean
  labels: ReadonlyMap<string, string>
}) {
  if (fresh || groups.length === 0) {
    return (
      <section className="flex flex-col">
        <h3 className="fc-label pb-2">Links here</h3>
        <p className="border-t border-hairline py-2.5 text-caption text-ink-secondary">
          {fresh ? (
            'Nothing yet. A row has to be added before anything can name it.'
          ) : (
            <>
              No format links to <Bidi>{title.toLowerCase()}</Bidi>.
            </>
          )}
        </p>
      </section>
    )
  }
  const held = groups.filter((group) => group.lines.length > 0)
  const empty = groups.filter((group) => group.lines.length === 0)
  return (
    <>
      {held.map((group) => (
        <section
          key={`${group.format.name}.${group.column.name}`}
          className="flex flex-col"
          aria-label={`${group.format.title} · ${group.column.name}`}
          data-tour={`links-here-${group.format.name}-${group.column.name}`}
        >
          <h3 className="fc-label pb-2">
            <Bidi>{group.format.title}</Bidi> · <Bidi>{group.column.name}</Bidi>
          </h3>
          {group.lines.map((each) => {
              const { lead } = splitLines(each, labels)
              const state = stateText(each)
              return (
                <div
                  key={`${each.format.name}.${each.row.id}`}
                  className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2.5 border-t border-hairline py-2.5"
                >
                  <span className="fc-dot mt-1.5" data-tone={toneOf(state)} aria-hidden />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <NameLink line={each} className="text-accent" />
                      <StateChip member={state} />
                    </div>
                    {lead !== undefined && <div className="text-caption text-ink-secondary">{lead}</div>}
                  </div>
                </div>
              )
            })}
        </section>
      ))}
      {empty.length > 0 && (
        <section className="flex flex-col" aria-label="Nothing yet from">
          <h3 className="fc-label pb-2">{held.length === 0 ? 'Links here' : 'Nothing yet from'}</h3>
          <p className="border-t border-hairline py-2.5 text-caption text-ink-secondary">
            {held.length === 0 ? 'Nothing yet from ' : ''}
            {empty.map((group, at) => (
              <span key={`${group.format.name}.${group.column.name}`}>
                {at === 0 ? '' : ', '}
                <Bidi>{group.format.title}</Bidi> · <Bidi>{group.column.name}</Bidi>
              </span>
            ))}
            .
          </p>
        </section>
      )}
    </>
  )
}

/** A row's name as a link to its entry — the one view of a row (M35 U2, D-401). */
function NameLink({ line, className }: { line: ViewLine; className: string }) {
  return (
    <Link
      to={entryPath(line.format.name, line.row.id)}
      // The demo tour's anchor (M33 U6): `name-M2 U2`, the line's own link.
      data-tour={`name-${nameText(line)}`}
      className={`${className} underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
      onClick={(event) => event.stopPropagation()}
    >
      <Bidi>{nameText(line)}</Bidi>
    </Link>
  )
}

interface Rest {
  readonly texts: readonly { readonly column: string; readonly text: string }[]
  readonly links: ReactNode
}

/**
 * A line's columns split for drawing: the first one that is text is the row's
 * title, the rest of the text goes beneath it, and its links are drawn as
 * links — one hop, and no further.
 */
function splitLines(
  line: ViewLine,
  labels: ReadonlyMap<string, string>,
  columns: readonly ColumnDeclaration[] = line.shape.lines,
): { lead: ReactNode; rest: Rest } {
  let lead: ReactNode
  const texts: { column: string; text: string }[] = []
  const links: ReactNode[] = []
  for (const column of columns) {
    if (isLink(column)) {
      const target = column.target
      const ids = idsIn(line.row.cells[column.name])
      if (target === undefined || ids.length === 0) continue
      links.push(
        <span key={column.name} className="flex flex-wrap gap-x-2">
          {ids.map((id) => (
            <Link
              key={id}
              to={entryPath(target, id)}
              className="font-mono text-caption text-ink-secondary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={(event) => event.stopPropagation()}
            >
              <Bidi>{labels.get(id) ?? id}</Bidi>
            </Link>
          ))}
        </span>,
      )
      continue
    }
    const text = cardText(column, line.row, labels)
    if (text === '') continue
    if (lead === undefined) lead = <Bidi>{text}</Bidi>
    else texts.push({ column: column.name, text })
  }
  return { lead, rest: { texts, links: links.length === 0 ? null : <>{links}</> } }
}

/**
 * **A row a link names, as words** — its name, its state, and the first line
 * of text its entry draws under the title — for a link shown as a card, and
 * several shown as a list or as cards (M35 U3, D-402).
 */
export interface LinkedRow {
  readonly name: string
  readonly state: string | undefined
  readonly lead: string | undefined
}

export function linkedRowOf(line: ViewLine, labels: ReadonlyMap<string, string>): LinkedRow {
  const lead = line.shape.lines
    .filter((column) => !isLink(column))
    .map((column) => cardText(column, line.row, labels))
    .find((text) => text !== '')
  return { name: nameText(line), state: stateText(line), lead }
}

function isLink(column: ColumnDeclaration): boolean {
  return column.type === 'link' || column.type === 'links'
}

/** What a row is called in its format — stable across a text document's renewed ids. */
function keyOf(line: ViewLine): string {
  return `${line.format.name}\u0000${nameText(line)}`
}

/** Keys for a list, made unique when two rows share a name. */
function uniqueKeys(lines: readonly ViewLine[]): readonly string[] {
  const seen = new Map<string, number>()
  return lines.map((line) => {
    const key = keyOf(line)
    const times = seen.get(key) ?? 0
    seen.set(key, times + 1)
    return times === 0 ? key : `${key}\u0000${String(times)}`
  })
}

/** What a row says, as `useChanges` compares it: its state and every line, by text. */
function signatureOf(line: ViewLine, labels: ReadonlyMap<string, string>): string {
  return JSON.stringify([stateText(line) ?? '', ...line.shape.lines.map((column) => cardText(column, line.row, labels))])
}

function nameText(line: ViewLine): string {
  const column = line.shape.name
  const value = column === undefined ? undefined : readValue(column, line.row)
  return typeof value === 'string' && value !== '' ? value : line.row.id
}

function stateText(line: ViewLine): string | undefined {
  const column = line.shape.state
  const value = column === undefined ? undefined : readValue(column, line.row)
  return typeof value === 'string' && value !== '' ? value : undefined
}
