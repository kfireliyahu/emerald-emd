import { useRef, useState, type ReactNode } from 'react'

import { instantDay } from '@/core/instant.ts'
import { formatMoney, fromDecimalString } from '@/core/money.ts'
import type { RowDerived } from '@/data/repositories/formatDerivedRepository.ts'
import { figureText } from '@/domain/format/identity.ts'
import { PERCENT_PLACES, percentFigure, readPercent } from '@/domain/format/percent.ts'
import { membersOfDraft } from '@/domain/format/rowDraft.ts'
import { convert, type UnitTable } from '@/domain/format/unit.ts'
import { dayText, isPercentWorkedOut, monthText, relativeDay, relativeMonth, type ShowAs } from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ChoiceField, type Choice } from '@/ui/components/ChoiceField.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'
import type { LinkedRow } from '@/ui/formats/LinkViews.tsx'
import { StateChip } from '@/ui/formats/StateChip.tsx'
import { memberText, toneOf } from '@/ui/formats/tone.ts'
import { parseMarkdown, type Block, type Inline } from '@/ui/formats/markdown.ts'

/**
 * **A value, shown one way** — M35 U3, D-402: the drawing half of Show as, the
 * approved mockup's `shown()` (`docs/mockups/m35/entry.html`).
 *
 * What is drawn here is what a value *reads as*: an entry nobody writes here (a
 * pack's, D-269) draws every field with it, and an entry that is written draws
 * with it the ways that open a field when pressed — a bar, a ring, a relative
 * day, a quantity in one unit — and the ways that are pressed where they stand:
 * buttons, steps, a tick (`onPick`). The editing half is `EntryView`'s.
 *
 * `accent` marks what can be pressed and colours no figure (D-125).
 */

/** The part of a column a way draws from — a `ColumnDeclaration` is one. */
export interface ShownColumn {
  readonly name: string
  readonly type: string
  readonly values: readonly string[]
  readonly minimum?: number | undefined
  readonly maximum?: number | undefined
  readonly unit?: string | undefined
  readonly target?: string | undefined
}

/** Which part of the entry a field is drawn in, which decides how it sits. */
export type Part = 'title' | 'header' | 'figure' | 'text' | 'links'

export interface ShownProps {
  readonly column: ShownColumn
  readonly way: ShowAs
  /** The value as the form keeps it: `12.5%`, `2026-10-09`, a JSON list of ids. */
  readonly value: string
  /** The cell beside it — a money's currency, a quantity's unit. */
  readonly beside?: string | undefined
  readonly part?: Part | undefined
  /** What a bar is measured against: the declared maximum or the largest on the page. */
  readonly top?: number | undefined
  /** The unit a quantity is shown in, *in one unit*. */
  readonly oneUnit?: string | undefined
  readonly units?: UnitTable | undefined
  /** `YYYY-MM-DD`, read by the caller: nothing here reads the clock but `now`. */
  readonly today: string
  /** Milliseconds, for a moment against now. */
  readonly now?: number | undefined
  readonly named?: ((id: string) => string) | undefined
  readonly linked?: ((id: string) => LinkedRow | undefined) | undefined
  /** Underlined, in red, while a check it is named in fails (S4). */
  readonly marked?: boolean | undefined
  /** A worked-out column's expression, marked so and said on hover (D-334). */
  readonly worked?: string | undefined
  readonly onOpen?: ((id: string) => void) | undefined
  /** Buttons, steps and a tick are pressed where they stand. */
  readonly onPick?: ((text: string) => void) | undefined
  /** A list's or cards' member taken out by its ×. */
  readonly onTakeOut?: ((id: string) => void) | undefined
}

/** The underline a figure wears while a check it is named in fails (S4). */
export const MARKED = 'shadow-[inset_0_-2px_0_var(--color-negative)]'

/**
 * Whether a worked-out figure is made of percents alone, and so is one — a
 * figure in no unit whose every column is a percent (D-402).
 */
export function isPercentFigure(each: RowDerived, columns: readonly { readonly name: string; readonly type: string }[]): boolean {
  return isPercentWorkedOut(each.compiled, columns)
}

/** The figure a value is, in what a bar measures: a percent's percent, a quantity's amount. */
export function figureOf(column: { readonly type: string }, value: string): number | undefined {
  if (value.trim() === '') return undefined
  if (column.type === 'percent') {
    const read = readPercent(value)
    return read.ok ? read.value / 10 ** PERCENT_PLACES : undefined
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

/** A value as words and the quieter mark after (or before) it: `40` and `%`, `6.5` and `h`. */
function figureParts(column: ShownColumn, value: string, beside: string | undefined): { readonly figure: string; readonly small?: string | undefined } {
  if (column.type === 'percent') {
    const read = readPercent(value)
    return read.ok ? { figure: percentFigure(read.value), small: '%' } : { figure: value }
  }
  if (column.type === 'money') {
    const amount = beside === undefined || beside === '' ? undefined : fromDecimalString(value, beside)
    return amount === undefined ? { figure: value, small: beside } : { figure: formatMoney(amount) }
  }
  if (column.type === 'quantity') return { figure: value, small: beside }
  return { figure: value, small: column.unit }
}

/** A figure with its mark, as one string — what a bar or a ring prints beside itself. */
function figureWords(column: ShownColumn, value: string, beside: string | undefined): string {
  const { figure, small } = figureParts(column, value, beside)
  if (small === undefined || small === '') return figure
  return small === '%' ? `${figure}%` : `${figure} ${small}`
}

/** A moment as the entry's *Date and time* reads it, here: `Fri 9 Oct 2026 09:30`. */
export function instantText(value: string): string {
  const moment = new Date(value)
  if (Number.isNaN(moment.getTime())) return value
  return `${dayText(instantDay(moment.getTime()))} ${pad(moment.getHours())}:${pad(moment.getMinutes())}`
}

/** A moment against now: `just now`, `40 minutes ago`, `in 3 hours`, and past a day as a day is. */
export function relativeInstant(value: string, now: number, today: string): string | undefined {
  const moment = new Date(value)
  if (Number.isNaN(moment.getTime())) return undefined
  const minutes = Math.round((moment.getTime() - now) / 60_000)
  const span = Math.abs(minutes)
  if (span < 1) return 'just now'
  if (span < 60 * 24) {
    const said = span < 60 ? `${String(span)} minutes` : `${String(Math.round(span / 60))} hours`
    return minutes > 0 ? `in ${said}` : `${said} ago`
  }
  return relativeDay(instantDay(moment.getTime()), today)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The ways that draw something to press even when there is nothing in them yet. */
const PRESSED_EMPTY: ReadonlySet<ShowAs> = new Set(['buttons', 'steps', 'tick'])

export function Shown(props: ShownProps) {
  const { column, way, value, beside, part, onPick } = props
  const empty = value.trim() === '' || (membersOfDraft(value)?.length ?? 1) === 0
  if (empty && !(onPick !== undefined && PRESSED_EMPTY.has(way))) {
    return <span className="inline-flex min-h-8 items-center text-ink-tertiary">Empty</span>
  }
  const named = props.named ?? ((id: string) => id)
  const mark = props.marked === true ? MARKED : ''

  switch (way) {
    case 'markdown': {
      const blocks = parseMarkdown(value)
      return <Markdown blocks={blocks} />
    }
    case 'mono':
      return (
        // A line per reference keeps its lines (M51 U4): a unit's `paths`
        // is one path per line, and run together they read as one.
        <span className="inline-flex min-h-8 items-center whitespace-pre-line font-mono text-caption">
          <Bidi>{value}</Bidi>
        </span>
      )
    case 'line':
      return (
        <span className={`inline-flex min-h-8 items-center ${part === 'title' ? 'text-title font-semibold' : ''}`}>
          <Bidi>{value}</Bidi>
        </span>
      )

    case 'figure':
    case 'large':
    case 'written': {
      const { figure, small } = figureParts(column, value, beside)
      return (
        <span className="inline-flex min-h-8 items-baseline">
          <span className={`${way === 'large' ? 'text-[28px]' : 'text-[20px]'} font-medium tabular-nums ${mark}`}>
            {figure}
            {small !== undefined && small !== '' && (
              <small className={`text-[13px] font-normal text-ink-secondary ${small === '%' ? '' : 'ms-[3px]'}`}>{small}</small>
            )}
          </span>
          {props.worked !== undefined && (
            <span className="ms-1 text-label text-ink-tertiary normal-case" title={`= ${props.worked}`}>
              computed
            </span>
          )}
        </span>
      )
    }
    case 'unit': {
      const amount = Number(value)
      const into = props.oneUnit
      const converted =
        into === undefined || beside === undefined || beside === '' || into === beside || props.units === undefined
          ? undefined
          : convert(props.units, amount, beside, into)
      const shown = converted !== undefined && 'value' in converted ? { figure: figureText(converted.value), small: into } : { figure: value, small: beside }
      return (
        <span className="inline-flex min-h-8 items-baseline" title={`${value} ${beside ?? ''}`.trim()}>
          <span className={`text-[20px] font-medium tabular-nums ${mark}`}>
            {shown.figure}
            {shown.small !== undefined && <small className="ms-[3px] text-[13px] font-normal text-ink-secondary">{shown.small}</small>}
          </span>
        </span>
      )
    }
    case 'bar': {
      const measured = barFigure(props)
      const top = props.top !== undefined && props.top > 0 ? props.top : measured
      const share = measured === undefined || top === undefined || top <= 0 ? 0 : Math.max(0, Math.min(1, measured / top))
      return (
        <span className="flex min-h-8 w-full items-center gap-2.5">
          <span className="relative h-1.5 min-w-[60px] flex-1 bg-hairline" aria-hidden>
            <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${String(share * 100)}%` }} />
          </span>
          <span className={`min-w-[44px] text-right text-caption font-medium tabular-nums ${mark}`}>
            {figureWords(column, value, beside)}
          </span>
        </span>
      )
    }
    case 'ring': {
      const figure = figureOf(column, value) ?? 0
      const share = Math.max(0, Math.min(1, figure / (column.maximum ?? 100)))
      const radius = 9
      const around = 2 * Math.PI * radius
      return (
        <span className="inline-flex min-h-8 items-center gap-2.5">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r={radius} fill="none" stroke="var(--color-hairline)" strokeWidth="3" />
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth="3"
              strokeDasharray={`${(around * share).toFixed(1)} ${around.toFixed(1)}`}
              transform="rotate(-90 12 12)"
            />
          </svg>
          <span className={`font-medium tabular-nums ${mark}`}>{figureWords(column, value, beside)}</span>
        </span>
      )
    }
    case 'slider':
      return (
        <span className="flex min-h-8 w-full items-center gap-2.5">
          <input
            type="range"
            disabled
            className="flex-1 accent-[var(--color-ink)]"
            aria-label={column.name}
            min={column.minimum ?? 0}
            max={column.maximum ?? 100}
            value={figureOf(column, value) ?? column.minimum ?? 0}
            readOnly
          />
          <span className="min-w-[44px] text-right font-medium tabular-nums">{figureWords(column, value, beside)}</span>
        </span>
      )

    case 'date':
      return <span className="inline-flex min-h-8 items-center tabular-nums">{dayText(value)}</span>
    case 'both':
      return (
        <span className="inline-flex min-h-8 items-baseline gap-2">
          <span className="tabular-nums">{dayText(value)}</span>
          <span className="text-caption text-ink-secondary">{relativeDay(value, props.today) ?? ''}</span>
        </span>
      )
    case 'month':
      return <span className="inline-flex min-h-8 items-center tabular-nums">{monthText(value)}</span>
    case 'datetime':
      return <span className="inline-flex min-h-8 items-center tabular-nums">{instantText(value)}</span>
    case 'relative': {
      const said =
        column.type === 'month'
          ? relativeMonth(value, props.today)
          : column.type === 'instant'
            ? relativeInstant(value, props.now ?? Date.now(), props.today)
            : relativeDay(value, props.today)
      const exact = column.type === 'month' ? monthText(value) : column.type === 'instant' ? instantText(value) : dayText(value)
      return (
        <span className="inline-flex min-h-8 items-center" title={exact}>
          {said ?? value}
        </span>
      )
    }
    case 'clock':
      return <span className="inline-flex min-h-8 items-center tabular-nums">{value}</span>

    case 'chip':
      return (
        <span className="inline-flex min-h-8 items-center">
          <StateChip member={value} />
        </span>
      )
    case 'menu':
      return (
        <span className="inline-flex h-7 min-w-[150px] items-center gap-2 border border-hairline-strong bg-elevated ps-2.5 pe-2 text-body">
          <span className="flex-1">
            <Bidi>{column.type === 'boolean' ? yesNo(value) : memberText(value)}</Bidi>
          </span>
          <Chevron />
        </span>
      )
    case 'buttons': {
      const choices =
        column.type === 'boolean'
          ? [
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ]
          : column.values.map((each) => ({ value: each, label: each }))
      return (
        <span className="inline-flex min-h-8 flex-wrap items-center gap-1" role={onPick === undefined ? undefined : 'radiogroup'} aria-label={column.name}>
          {choices.map((each) => {
            const on = each.value === value
            const look = `border px-[9px] py-0.5 text-[12px] ${on ? 'border-ink bg-surface text-ink' : 'border-hairline text-ink-secondary'}`
            return onPick === undefined ? (
              <span key={each.value} className={look}>
                <Bidi>{each.label}</Bidi>
              </span>
            ) : (
              <button
                key={each.value}
                type="button"
                role="radio"
                aria-checked={on}
                className={`${look} transition-colors duration-[var(--duration-micro)] hover:border-hairline-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
                onClick={() => onPick(on ? '' : each.value)}
              >
                <Bidi>{each.label}</Bidi>
              </button>
            )
          })}
        </span>
      )
    }
    case 'steps':
      return <Steps members={column.values} value={value} label={column.name} onPick={onPick} />

    case 'tick': {
      const on = value === 'true'
      const box = (
        <span className="inline-flex h-4 w-4 items-center justify-center border-[1.5px] border-ink-secondary" aria-hidden>
          {on && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 5 5L20 7" />
            </svg>
          )}
        </span>
      )
      return onPick === undefined ? (
        <span className="inline-flex min-h-8 items-center" role="img" aria-label={on ? 'Yes' : value === 'false' ? 'No' : 'Empty'}>
          {box}
        </span>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          aria-label={column.name}
          className="inline-flex min-h-8 items-center px-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => onPick(on ? 'false' : 'true')}
        >
          {box}
        </button>
      )
    }
    case 'word':
      return <span className="inline-flex min-h-8 items-center">{yesNo(value)}</span>

    case 'name':
      return (
        <span className="inline-flex min-h-8 items-center">
          <NameOf id={value} named={named} onOpen={props.onOpen} />
        </span>
      )
    case 'card':
      return <LinkCard id={value} {...props} named={named} />

    case 'chips': {
      const members = membersOfDraft(value) ?? [value]
      return (
        <span className="flex min-h-8 flex-wrap items-center gap-1.5">
          {members.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-md border border-hairline px-1.5 py-0.5 text-caption">
              {column.type === 'links' ? <NameOf id={id} named={named} onOpen={props.onOpen} /> : <Bidi>{id}</Bidi>}
            </span>
          ))}
        </span>
      )
    }
    case 'list':
      return (
        <div className="flex w-full flex-col">
          {(membersOfDraft(value) ?? [value]).map((id) => {
            const row = props.linked?.(id)
            return (
              <div key={id} className="flex items-center gap-2 border-t border-hairline py-[5px] first:border-t-0">
                <span className="fc-dot" data-tone={toneOf(row?.state)} aria-hidden />
                <NameOf id={id} named={named} onOpen={props.onOpen} />
                <StateChip member={row?.state} />
                <TakeOut id={id} named={named} onTakeOut={props.onTakeOut} />
              </div>
            )
          })}
        </div>
      )
    case 'cards':
      return (
        <div className="flex w-full flex-col gap-1.5">
          {(membersOfDraft(value) ?? [value]).map((id) => (
            <LinkCard key={id} id={id} {...props} named={named}>
              <TakeOut id={id} named={named} onTakeOut={props.onTakeOut} />
            </LinkCard>
          ))}
        </div>
      )
  }
}

/** A bar's figure, in the unit it is measured in: a quantity's in one unit. */
function barFigure(props: ShownProps): number | undefined {
  const figure = figureOf(props.column, props.value)
  if (props.column.type !== 'quantity' || figure === undefined) return figure
  const { beside, oneUnit, units } = props
  if (oneUnit === undefined || beside === undefined || beside === '' || oneUnit === beside || units === undefined) return figure
  const converted = convert(units, figure, beside, oneUnit)
  return 'value' in converted ? converted.value : figure
}

/** The × that takes one member out of a list, quiet until pointed at. */
function TakeOut({ id, named, onTakeOut }: { id: string; named: (id: string) => string; onTakeOut?: ((id: string) => void) | undefined }) {
  if (onTakeOut === undefined) return null
  return (
    <button
      type="button"
      aria-label={`Take ${named(id)} out`}
      title={`Take ${named(id)} out`}
      className="ms-auto inline-flex h-5 w-5 items-center justify-center text-ink-tertiary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => onTakeOut(id)}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  )
}

function yesNo(value: string): string {
  return value === 'true' ? 'Yes' : value === 'false' ? 'No' : value
}

/** A row's name, pressed to open it in this same view. */
function NameOf({ id, named, onOpen }: { id: string; named: (id: string) => string; onOpen?: ((id: string) => void) | undefined }) {
  if (onOpen === undefined) return <Bidi>{named(id)}</Bidi>
  return (
    <button
      type="button"
      className="text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => onOpen(id)}
    >
      <Bidi>{named(id)}</Bidi>
    </button>
  )
}

/** A row a link names, as a card: its dot, its name, its state, and its line under them. */
function LinkCard(props: ShownProps & { readonly id: string; readonly named: (id: string) => string; readonly children?: ReactNode }) {
  const row = props.linked?.(props.id)
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 border border-hairline-strong bg-elevated px-2.5 py-2">
      <span className="flex flex-wrap items-center gap-2">
        {row?.state !== undefined && <span className="fc-dot" data-tone={toneOf(row.state)} aria-hidden />}
        <NameOf id={props.id} named={props.named} onOpen={props.onOpen} />
        <StateChip member={row?.state} />
        {props.children}
      </span>
      {row?.lead !== undefined && (
        <span className="text-caption text-ink-secondary">
          <Bidi>{row.lead}</Bidi>
        </span>
      )}
    </span>
  )
}

/**
 * **An enum's members as a path**, the one it is at marked — what came before
 * it filled, what is still ahead hollow. Pressed, a step is picked.
 */
function Steps({
  members,
  value,
  label,
  onPick,
}: {
  members: readonly string[]
  value: string
  label: string
  onPick?: ((text: string) => void) | undefined
}) {
  const at = members.indexOf(value)
  return (
    <span className="flex min-h-8 min-w-[260px] items-center" role={onPick === undefined ? undefined : 'radiogroup'} aria-label={label}>
      {members.map((member, index) => {
        const tone = index === at ? 'live' : index < at ? 'done' : 'waiting'
        const look = `flex flex-none flex-col items-center gap-1 text-[11px] uppercase tracking-[.06em] ${
          index === at ? 'text-accent' : index < at ? 'text-ink-secondary' : 'text-ink-tertiary'
        }`
        const step = (
          <>
            <span className="fc-dot" data-tone={tone} aria-hidden />
            <Bidi>{memberText(member)}</Bidi>
          </>
        )
        return (
          <span key={member} className="contents">
            {index > 0 && <span className={`mb-[18px] h-0.5 min-w-[18px] flex-1 ${index <= at ? 'bg-ink-tertiary' : 'bg-hairline-strong'}`} aria-hidden />}
            {onPick === undefined ? (
              <span className={look}>{step}</span>
            ) : (
              <button
                type="button"
                role="radio"
                aria-checked={index === at}
                className={`${look} hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
                onClick={() => onPick(member)}
              >
                {step}
              </button>
            )}
          </span>
        )
      })}
    </span>
  )
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="text-ink-tertiary" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/**
 * **A value pressed to pick another** — a chip, or a yes-or-no in words: the
 * value as it is shown, and under it, when pressed, the members to pick from.
 * Drawn by the app, not the platform's dark list.
 */
export function PickMenu({
  label,
  choices,
  value,
  children,
  tour,
  onPick,
}: {
  label: string
  choices: readonly Choice[]
  value: string
  children: ReactNode
  /** The demo tour's anchor (M33 U6), a `data-tour` on the button. */
  tour?: string | undefined
  onPick: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const dismissKey = useDismiss(open, box, () => setOpen(false))
  return (
    <span ref={box} className="relative inline-flex" onKeyDown={dismissKey}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${value === '' ? 'empty' : value}`}
        data-tour={tour}
        className="inline-flex min-h-8 items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => setOpen(!open)}
      >
        {children}
        <Chevron />
      </button>
      {open && (
        <span role="menu" className="fc-pop-enter absolute top-full left-0 z-20 flex min-w-[160px] flex-col border border-hairline-strong bg-elevated py-1 shadow-[var(--shadow-pop)]">
          {choices.map((each) => (
            <button
              key={each.value}
              type="button"
              role="menuitemradio"
              aria-checked={each.value === value}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body hover:bg-accent-soft"
              onClick={() => {
                setOpen(false)
                onPick(each.value)
              }}
            >
              <span className="w-3.5 text-accent">{each.value === value ? '✓' : ''}</span>
              <Bidi>{each.label}</Bidi>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * **One more row, found by name** — a list's or cards' Add: a field that finds
 * a row the way a link's does, and is gone again once one is picked.
 */
export function AddMember({
  label,
  choices,
  onAdd,
}: {
  label: string
  choices: readonly Choice[]
  onAdd: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [typed, setTyped] = useState('')
  if (!adding) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 self-start py-1 text-caption text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => setAdding(true)}
      >
        + Add
      </button>
    )
  }
  return (
    <ChoiceField
      className="min-h-8 w-56 border border-hairline bg-elevated px-1.5 py-0.5 outline-none focus:border-accent"
      filter
      dir="auto"
      autoFocus
      aria-label={`Add to ${label}`}
      placeholder="Type to find one to add"
      text={typed}
      choices={choices}
      onText={setTyped}
      onPick={(choice) => {
        setTyped('')
        setAdding(false)
        onAdd(choice.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setTyped('')
          setAdding(false)
        }
        if (event.key === 'Enter' && typed.trim() !== '') {
          event.preventDefault()
          // A name typed whole is that row; anything else is kept as typed,
          // and the write resolves it by name or refuses it, naming it.
          const exact = choices.filter((each) => each.label === typed.trim())
          setTyped('')
          setAdding(false)
          onAdd(exact.length === 1 && exact[0] !== undefined ? exact[0].value : typed.trim())
        }
      }}
      onBlur={() => {
        if (typed === '') setAdding(false)
      }}
    />
  )
}

/** Blocks as elements. Every string is a text node; nothing is HTML (D-114). */
export function Markdown({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="grid gap-2">
      {blocks.map((block, at) => {
        switch (block.kind) {
          case 'heading': {
            const size = block.level === 1 ? 'text-title' : block.level === 2 ? 'text-heading' : 'font-medium'
            return (
              <p key={at} dir="auto" className={`${size} mt-2 first:mt-0`} role="heading" aria-level={block.level + 1}>
                <Inlines inlines={block.children} />
              </p>
            )
          }
          case 'paragraph':
            return (
              <p key={at} dir="auto" className="max-w-prose">
                <Inlines inlines={block.children} />
              </p>
            )
          case 'list': {
            const items = block.items.map((item, index) => (
              <li key={index} dir="auto">
                <Inlines inlines={item} />
              </li>
            ))
            return block.ordered ? (
              <ol key={at} className="max-w-prose list-decimal ps-5">
                {items}
              </ol>
            ) : (
              <ul key={at} className="max-w-prose list-disc ps-5">
                {items}
              </ul>
            )
          }
          case 'quote':
            return (
              <blockquote key={at} dir="auto" className="max-w-prose border-s-2 border-hairline-strong ps-3 text-ink-secondary">
                <Inlines inlines={block.children} />
              </blockquote>
            )
          case 'code':
            return (
              <pre key={at} className="overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-caption">
                {block.text}
              </pre>
            )
          case 'rule':
            return <hr key={at} className="border-hairline" />
        }
      })}
    </div>
  )
}

function Inlines({ inlines }: { inlines: readonly Inline[] }) {
  return (
    <>
      {inlines.map((each, at) => {
        switch (each.kind) {
          case 'text':
            return <span key={at}>{each.text}</span>
          case 'strong':
            return (
              <strong key={at} className="font-semibold">
                <Inlines inlines={each.children} />
              </strong>
            )
          case 'em':
            return (
              <em key={at}>
                <Inlines inlines={each.children} />
              </em>
            )
          case 'code':
            return (
              <code key={at} className="rounded bg-surface px-1 font-mono text-caption">
                {each.text}
              </code>
            )
          case 'link':
            // **Not followed** — the app makes no request it did not serve
            // itself — so its words, underlined, with where it points on hover.
            return (
              <span key={at} className="underline decoration-hairline-strong underline-offset-2" title={each.href}>
                <Inlines inlines={each.children} />
              </span>
            )
        }
      })}
    </>
  )
}
