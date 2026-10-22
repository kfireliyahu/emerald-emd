import { useState } from 'react'

import { Bidi } from '@/ui/Bidi.tsx'

import {
  axisSpan,
  drawnValue,
  pointText,
  seriesColors,
  shortText,
  type ChartAxis,
  type ChartKind,
  type ChartSeries,
} from './chart.ts'
import { useWidth } from './useWidth.ts'

/** Roughly how wide a character of an 11px label is, to know what fits. */
const CHAR = 6.4
const TOP = 18
const BOTTOM = 22
const RIGHT = 4
/** A bar is never wider than this, however few there are. */
const MAX_BAR = 28

/**
 * **The general chart** (M53 U6, D-516): labels along the bottom, one or more
 * series of figures, bars or a line — hand-rolled SVG in the theme's tokens,
 * so it is right in the light and the dark alike.
 *
 * What it keeps of docs/11 (the `scope: ui` rule rows): ink on nothing — no
 * axis lines and no gridlines; a line 1.5pt with no fill and no marker but the
 * column under the pointer; bars labelled directly, every one when every label
 * fits and otherwise the tallest and the column under the pointer; drawn once
 * on first appearance and never again; and **read by a screen reader as a
 * table**, the picture hidden from it, so nothing it shows is lost to anybody.
 *
 * It takes plain series (`chart.ts`) and knows no ledger, rollup or format.
 */
export function Chart({
  labels,
  ticks,
  series,
  axis,
  kind,
  title,
  labelHeading = 'label',
  height = 180,
}: {
  /** One per point, in full: the table's row heads and the readout's. */
  readonly labels: readonly string[]
  /** The same, short, for under the columns — `Mar 26`. The labels when absent. */
  readonly ticks?: readonly string[]
  readonly series: readonly ChartSeries[]
  readonly axis: ChartAxis
  readonly kind: ChartKind
  /** What it is a chart of, said to a screen reader as the table's caption. */
  readonly title: string
  /** What the labels are — `month` — the table's first column. */
  readonly labelHeading?: string
  readonly height?: number
}) {
  const width = useWidth()
  const [hovered, setHovered] = useState<number | undefined>(undefined)

  const drawn = series.map((each) => labels.map((_, index) => drawnValue(each.points[index], axis)))
  const values = drawn.flat().filter((value): value is number => value !== undefined)
  const colors = seriesColors(series)
  const n = labels.length
  if (n === 0 || values.length === 0) return null

  const W = width.value
  const H = height
  const span = axisSpan(values, kind)
  const tickTexts = span.ticks.map((tick) => shortText(tick, axis))
  // A line has an axis on its left; bars say their own values and need none.
  const LEFT = kind === 'line' ? Math.ceil(Math.max(...tickTexts.map((text) => text.length)) * CHAR) + 10 : RIGHT
  const plot = Math.max(1, W - LEFT - RIGHT)
  const column = plot / n
  const center = (index: number): number => LEFT + column * (index + 0.5)
  const y = (value: number): number => TOP + (H - TOP - BOTTOM) * ((span.high - value) / (span.high - span.low || 1))

  const shortLabels = ticks ?? labels
  const widest = Math.max(...shortLabels.map((text) => text.length)) * CHAR + 8
  // Every label when they fit; every second, third… when they do not.
  const every = Math.max(1, Math.ceil(widest / column))

  const count = series.length
  const bar = Math.min(MAX_BAR, (column * 0.72) / count)
  const gap = bar > 4 ? 1 : 0
  const barX = (index: number, which: number): number => center(index) - (bar * count) / 2 + which * bar

  // Bars are labelled directly: all of them when every label fits its bar,
  // otherwise only the tallest — so the chart still has a scale — and the
  // column under the pointer.
  const labelFits = drawn.every((row) =>
    row.every((value) => value === undefined || shortText(value, axis).length * CHAR <= (count === 1 ? column - 2 : bar + 2)),
  )
  let tallest: [number, number] | undefined
  drawn.forEach((row, which) =>
    row.forEach((value, index) => {
      if (value === undefined) return
      const best = tallest === undefined ? undefined : drawn[tallest[0]]?.[tallest[1]]
      if (best === undefined || Math.abs(value) > Math.abs(best)) tallest = [which, index]
    }),
  )

  const linePath = (row: readonly (number | undefined)[]): string => {
    let d = ''
    let open = false
    row.forEach((value, index) => {
      if (value === undefined) {
        open = false
        return
      }
      d += `${open ? 'L' : 'M'}${center(index).toFixed(1)},${y(value).toFixed(1)}`
      open = true
    })
    return d
  }
  const alone = (row: readonly (number | undefined)[], index: number): boolean =>
    row[index] !== undefined && row[index - 1] === undefined && row[index + 1] === undefined

  return (
    <figure className="m-0">
      <div ref={width.ref as React.RefObject<HTMLDivElement>} className="relative">
        <svg
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          className="block h-auto w-full overflow-visible"
          aria-hidden="true"
          onMouseLeave={() => setHovered(undefined)}
        >
          {labels.map((label, index) => (
            <rect
              key={`hit ${label}`}
              className={`fc-chart-col${hovered === index ? ' fc-chart-col-on' : ''}`}
              x={LEFT + column * index}
              y={0}
              width={column}
              height={H - BOTTOM + 4}
              onMouseEnter={() => setHovered(index)}
              onClick={() => setHovered(index)}
            />
          ))}

          {kind === 'line' &&
            span.ticks.map((tick, index) => (
              <text key={`tick ${String(tick)}`} className="fc-col-tick" x={LEFT - 6} y={y(tick) + 4} textAnchor="end">
                {tickTexts[index]}
              </text>
            ))}

          {/* Keyed by the kind, so a switch is a first appearance and draws
              in once, and a hover is not. */}
          <g key={kind} pointerEvents="none">
            {kind === 'bars'
              ? drawn.map((row, which) =>
                  row.map((value, index) => {
                    if (value === undefined) return null
                    const top = y(Math.max(value, 0))
                    const bottom = y(Math.min(value, 0))
                    const shown =
                      labelFits || hovered === index || (tallest?.[0] === which && tallest[1] === index)
                    const x = barX(index, which)
                    return (
                      <g key={`${String(which)} ${String(index)}`}>
                        <rect
                          className={value < 0 ? 'fc-grow fc-grow-down' : 'fc-grow'}
                          x={x + gap / 2}
                          y={top}
                          width={Math.max(1, bar - gap)}
                          height={Math.max(value === 0 ? 0 : 1, bottom - top)}
                          fill={colors[which]}
                        />
                        {shown && (
                          <text
                            className="fc-chart-val"
                            x={x + bar / 2}
                            y={value < 0 ? bottom + 12 : top - 4}
                            textAnchor="middle"
                          >
                            {shortText(value, axis)}
                          </text>
                        )}
                      </g>
                    )
                  }),
                )
              : drawn.map((row, which) => (
                  <g key={String(which)}>
                    <path
                      d={linePath(row)}
                      fill="none"
                      stroke={colors[which]}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className="fc-draw"
                      style={{ '--fc-draw-length': String(Math.ceil(W * 3)) } as React.CSSProperties}
                    />
                    {row.map((value, index) =>
                      value !== undefined && (hovered === index || alone(row, index)) ? (
                        <circle
                          key={index}
                          cx={center(index)}
                          cy={y(value)}
                          r={hovered === index ? 3.5 : 2}
                          fill={colors[which]}
                        />
                      ) : null,
                    )}
                  </g>
                ))}
          </g>

          {shortLabels.map((label, index) => {
            if (index % every !== 0 && hovered !== index) return null
            const text = label.length * CHAR
            const anchor =
              index === 0 && text / 2 > column / 2 + LEFT
                ? 'start'
                : index === n - 1 && text / 2 > column / 2 + RIGHT
                  ? 'end'
                  : 'middle'
            const x = anchor === 'start' ? LEFT : anchor === 'end' ? W - RIGHT : center(index)
            return (
              <text
                key={`label ${String(index)}`}
                className={`fc-col-tick${hovered === index ? ' fc-chart-tick-on' : ''}`}
                x={x}
                y={H - 6}
                textAnchor={anchor}
              >
                {label}
              </text>
            )
          })}
        </svg>
      </div>

      {/* What the column under the pointer says in full — the table's row,
          for the eye; a screen reader has the table itself. */}
      <p className="m-0 min-h-5 text-caption text-ink-secondary tabular-nums" aria-hidden="true">
        {hovered === undefined ? (
          ' '
        ) : (
          <>
            <span className="text-ink">{labels[hovered]}</span>
            {series.map((each, which) => (
              <span key={which}>
                {' · '}
                {count > 1 && (
                  <>
                    <Bidi>{each.name}</Bidi>{' '}
                  </>
                )}
                {pointText(each.points[hovered], axis)}
              </span>
            ))}
          </>
        )}
      </p>

      {count > 1 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-ink-secondary" aria-hidden="true">
          {series.map((each, which) => (
            <li key={which} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: colors[which] }} />
              <Bidi>{each.name}</Bidi>
            </li>
          ))}
        </ul>
      )}

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{labelHeading}</th>
            {series.map((each, which) => (
              <th key={which} scope="col">
                <Bidi>{each.name}</Bidi>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, index) => (
            <tr key={`${label} ${String(index)}`}>
              <th scope="row">{label}</th>
              {series.map((each, which) => (
                <td key={which}>{pointText(each.points[index], axis)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
