import { useState, type KeyboardEvent } from 'react'

import { arrowStep, pageIsRtl } from '@/ui/direction.ts'

import { niceTicks } from './chart.ts'
import { useWidth } from './useWidth.ts'

export interface TrendMonth {
  readonly key: string
  /** Under the axis: `Mar`. */
  readonly label: string
  /** In the tooltip and the table: `March 2026`. */
  readonly long: string
  /** The month still running: its segment is dashed. */
  readonly running?: boolean | undefined
}

export interface TrendSeries {
  readonly key: string
  readonly name: string
  /** One per month, in major units; nothing where the month has no value. */
  readonly values: readonly (number | undefined)[]
  /** The line's colour token: `bar` by default, a flow's (`flow-in`) beside its name. */
  readonly hue?: string | undefined
}

const HEIGHT = 200
const TOP = 16
const BOTTOM = 28
const END = 72

/**
 * **A trend over months** (M64 U4, D-615): one to four series as 2px lines,
 * each named at its end and in a key above when there are two or more; round
 * hairline gridlines with compact ticks; the running month dashed; the open
 * month a rule with a ringed dot per series. Every month has a tooltip, and
 * the chart is one stop for the keyboard: ← → move between months (in the
 * reading order, so mirrored in Hebrew), Enter opens one. Its values are also
 * a table a screen reader reads, so nothing lives only in the picture.
 */
export function MonthTrend({
  months,
  series,
  open,
  label,
  empty,
  format,
  tick,
  onOpen,
}: {
  readonly months: readonly TrendMonth[]
  readonly series: readonly TrendSeries[]
  /** The open month's index, marked on the chart. */
  readonly open?: number | undefined
  /** What the chart shows, for its accessible name: `Came in and went out, by month`. */
  readonly label: string
  readonly empty: string
  /** A value as a person reads it, for the tooltip and the table. */
  readonly format: (value: number) => string
  /** A value as an axis tick says it: compact. */
  readonly tick: (value: number) => string
  readonly onOpen?: ((index: number) => void) | undefined
}) {
  const width = useWidth()
  const [at, setAt] = useState<number | undefined>(undefined)
  const values = series.flatMap((each) => each.values.filter((value): value is number => value !== undefined && Number.isFinite(value)))
  if (months.length === 0 || values.length === 0) return <p className="m-0 text-ink-secondary">{empty}</p>

  const W = Math.max(320, width.value || 640)
  const rtl = pageIsRtl()
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 3)
  const low = ticks[0] ?? 0
  const high = ticks[ticks.length - 1] ?? 1
  const span = W - END - 8
  const x = (index: number) => {
    const along = 8 + (months.length === 1 ? span / 2 : (index * span) / (months.length - 1))
    return rtl ? W - along : along
  }
  const y = (value: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - (value - low) / (high - low || 1))
  const shown = at ?? open
  // **Names at the lines' ends, in the margin past the last month** so the
  // running month's dashes never cross them; where two would touch, the key
  // above names them instead — never nudged apart from their lines.
  const done = lastDoneOf(months)
  const ends = series.map((each) => {
    const value = [...each.values.slice(0, done + 1)].reverse().find((point) => point !== undefined)
    return value === undefined ? undefined : y(value)
  })
  const drawn = ends.filter((end): end is number => end !== undefined).sort((a, b) => a - b)
  const named = drawn.every((end, index) => index === 0 || end - drawn[index - 1]! >= 14)

  const onKey = (event: KeyboardEvent) => {
    const step = arrowStep(event.key)
    const from = at ?? open ?? months.length - 1
    if (step !== 0) {
      event.preventDefault()
      setAt(Math.max(0, Math.min(months.length - 1, from + step)))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setAt(event.key === 'Home' ? 0 : months.length - 1)
    } else if (event.key === 'Enter' && onOpen !== undefined) {
      event.preventDefault()
      onOpen(from)
    } else if (event.key === 'Escape') setAt(undefined)
  }

  const path = (each: TrendSeries, from: number, to: number) => {
    let d = ''
    for (let index = from; index <= to; index += 1) {
      const value = each.values[index]
      if (value === undefined) continue
      d += `${d === '' ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`
    }
    return d
  }

  return (
    <figure className="m-0 flex flex-col gap-2">
      {series.length > 1 && (
        <ul aria-hidden className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-ink-secondary">
          {series.map((each) => (
            <li key={each.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3" style={{ backgroundColor: `var(--color-${each.hue ?? 'bar'})` }} />
              {each.name}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={width.ref as React.RefObject<HTMLDivElement>}
        role="group"
        tabIndex={0}
        aria-label={label}
        aria-describedby={undefined}
        onKeyDown={onKey}
        onBlur={() => setAt(undefined)}
        onMouseLeave={() => setAt(undefined)}
        className="relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        <svg aria-hidden viewBox={`0 0 ${String(W)} ${String(HEIGHT)}`} className="block h-auto w-full overflow-visible">
          {ticks.map((value) => (
            <g key={value}>
              <line x1={0} x2={W} y1={y(value)} y2={y(value)} className={value === 0 && low < 0 ? 'stroke-hairline-strong' : 'stroke-hairline'} strokeWidth="1" />
              <text x={rtl ? W : 0} y={y(value) - 4} textAnchor={rtl ? 'end' : 'start'} className="fc-col-tick">
                {tick(value)}
              </text>
            </g>
          ))}
          {shown !== undefined && (
            <line x1={x(shown)} x2={x(shown)} y1={TOP} y2={HEIGHT - BOTTOM} className="stroke-ink" strokeWidth="1" />
          )}
          {series.map((each, which) => {
            const stroke = { stroke: `var(--color-${each.hue ?? 'bar'})` }
            const end = ends[which]
            return (
              <g key={each.key}>
                <path d={path(each, 0, done)} fill="none" style={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="fc-draw" />
                {done < months.length - 1 && (
                  <path d={path(each, Math.max(0, done), months.length - 1)} fill="none" style={stroke} strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" />
                )}
                {named && end !== undefined && (
                  <text x={x(months.length - 1) + (rtl ? -12 : 12)} y={end + 4} textAnchor={rtl ? 'end' : 'start'} className="fc-chart-val">
                    {each.name}
                  </text>
                )}
                {shown !== undefined && each.values[shown] !== undefined && (
                  <circle cx={x(shown)} cy={y(each.values[shown]!)} r="4.5" style={{ fill: `var(--color-${each.hue ?? 'bar'})` }} className="stroke-background" strokeWidth="2" />
                )}
              </g>
            )
          })}
          {months.map((month, index) => (
            <text key={month.key} x={x(index)} y={HEIGHT - 8} textAnchor="middle" className={`fc-col-tick${index === shown ? ' fc-chart-tick-on' : ''}`}>
              {month.label}
            </text>
          ))}
          {months.map((month, index) => {
            const band = span / Math.max(1, months.length - 1)
            return (
              <rect
                key={month.key}
                x={x(index) - band / 2}
                y={TOP}
                width={band}
                height={HEIGHT - TOP}
                fill="transparent"
                className={onOpen === undefined ? '' : 'cursor-pointer'}
                onMouseEnter={() => setAt(index)}
                onClick={onOpen === undefined ? undefined : () => onOpen(index)}
              />
            )
          })}
        </svg>
        {at !== undefined && months[at] !== undefined && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 flex min-w-40 flex-col gap-1 border border-hairline-strong bg-elevated px-3 py-2 text-caption tabular-nums shadow-[var(--shadow-pop)]"
            style={{ insetInlineStart: `${String(Math.min(80, Math.max(0, (100 * x(at)) / W - (rtl ? 20 : 0))))}%` }}
          >
            <span className="font-semibold">{months[at]!.long}</span>
            {series.map((each) => (
              <span key={each.key} className="flex justify-between gap-4">
                <span className="flex items-center gap-1.5 text-ink-secondary">
                  <span className="inline-block h-0.5 w-2.5" style={{ backgroundColor: `var(--color-${each.hue ?? 'bar'})` }} />
                  {each.name}
                </span>
                <span dir="ltr">{each.values[at] === undefined ? '—' : format(each.values[at]!)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col" />
            {series.map((each) => (
              <th key={each.key} scope="col">{each.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((month, index) => (
            <tr key={month.key}>
              <th scope="row">{month.long}</th>
              {series.map((each) => (
                <td key={each.key}>{each.values[index] === undefined ? '—' : format(each.values[index]!)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** The last month that is not still running; the last month when every one is. */
function lastDoneOf(months: readonly TrendMonth[]): number {
  const done = months.reduce((last, month, index) => (month.running === true ? last : index), -1)
  return done < 0 ? months.length - 1 : done
}
