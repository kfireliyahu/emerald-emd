import { useState } from 'react'

import { Bidi } from '@/ui/Bidi.tsx'

import {
  axisSpan,
  countOf,
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
/** How tall a label is, so a figure stood on its end fits a bar this wide. */
const LINE = 11
const TOP = 18
const BOTTOM = 22
const RIGHT = 4
/** A bar is never wider than this, however few there are. */
const MAX_BAR = 28
/** Two series' names at a line's end are kept at least this far apart. */
const NAME_GAP = 13

/**
 * **The general chart** (M53 U6, D-516): labels along the bottom, one or more
 * series of figures, bars or a line — hand-rolled SVG in the theme's tokens,
 * so it is right in the light and the dark alike.
 *
 * What it keeps of the `scope: ui` rule rows: ink on nothing — no axis lines
 * and no gridlines; a line 1.5pt with no fill and no marker but the column
 * under the pointer; drawn once on first appearance and never again.
 *
 * **Every bar carries its figure** (M54 F3, *Charts are ink, labelled
 * directly*): across its top when it fits, stood on its end when the bar is
 * too narrow for that, and where not even that fits the figures are said in
 * text beneath. **Several series are named where they are drawn** — a line's
 * name at its end, a bar's in the figures beneath, beside the dot it is drawn
 * in — and wear category colours (D-531). **Every chart has its numbers**:
 * whenever the picture alone does not say every figure — a line, several
 * series, a bar or a month left unlabelled — they are a table under it,
 * visible, never a hover's alone; where the caller already shows them
 * (`figures: 'elsewhere'`, the rollup's own tab) the table is a screen
 * reader's only. The picture is hidden from a screen reader either way.
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
  figures = 'below',
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
  /** Where its figures are said in text when the picture does not say them all: under it, or by the caller. */
  readonly figures?: 'below' | 'elsewhere'
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
  const count = series.length
  const span = axisSpan(values, kind, countOf(axis) !== undefined)
  const tickTexts = span.ticks.map((tick) => shortText(tick, axis))
  // A line has an axis on its left; bars say their own values and need none.
  const LEFT = kind === 'line' ? Math.ceil(Math.max(...tickTexts.map((text) => text.length)) * CHAR) + 10 : RIGHT
  // A line of several series names each at its end, so its right edge makes room.
  const named = kind === 'line' && count > 1
  const EDGE = named ? Math.ceil(Math.max(...series.map((each) => each.name.length)) * CHAR) + 16 : RIGHT
  const plot = Math.max(1, W - LEFT - EDGE)
  const column = plot / n
  const center = (index: number): number => LEFT + column * (index + 0.5)

  const bar = Math.min(MAX_BAR, (column * 0.72) / count)
  const gap = bar > 4 ? 1 : 0
  const barX = (index: number, which: number): number => center(index) - (bar * count) / 2 + which * bar

  // **Every bar's figure** (M54 F3): across its top when every one fits that
  // way, stood on its end when the bars are too narrow for that but wide enough
  // for a line of type; otherwise none, and the figures are said beneath.
  const barTexts = drawn.map((row) => row.map((value) => (value === undefined ? undefined : shortText(value, axis))))
  const longest = Math.max(0, ...barTexts.flat().map((text) => text?.length ?? 0)) * CHAR
  const across = longest <= (count === 1 ? column - 2 : bar + 2)
  const labelled: 'across' | 'up' | 'none' = kind !== 'bars' ? 'none' : across ? 'across' : bar >= LINE ? 'up' : 'none'
  // A figure stood on its end needs its length above the tallest bar — and, under
  // a bar below zero, between its foot and the months.
  const room = labelled === 'up' ? Math.ceil(longest) + 6 : labelled === 'across' ? 14 : 0
  const top = labelled === 'up' ? Math.max(TOP, room) : TOP
  const foot = BOTTOM + (values.some((value) => value < 0) ? room : 0)
  const y = (value: number): number => top + (H - top - foot) * ((span.high - value) / (span.high - span.low || 1))

  const shortLabels = ticks ?? labels
  const widest = Math.max(...shortLabels.map((text) => text.length)) * CHAR + 8
  // Every label when they fit; every second, third… when they do not.
  const every = Math.max(1, Math.ceil(widest / column))

  // The picture says every figure only as one series of bars, each labelled,
  // under a label for every month; anything else says them in text too.
  const whole = kind === 'bars' && count === 1 && labelled !== 'none' && every === 1
  const shown = figures === 'below' && !whole

  // Each series' name at its line's end, kept apart so two never print on each other.
  const ends: { readonly which: number; readonly x: number; y: number }[] = []
  if (named) {
    drawn.forEach((row, which) => {
      let last = row.length - 1
      while (last >= 0 && row[last] === undefined) last -= 1
      const value = row[last]
      if (value !== undefined) ends.push({ which, x: center(last) + 6, y: y(value) + 4 })
    })
    ends.sort((a, b) => a.y - b.y)
    ends.forEach((end, at) => {
      const above = ends[at - 1]
      if (above !== undefined && end.y - above.y < NAME_GAP) end.y = above.y + NAME_GAP
    })
  }

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
                    const high = y(Math.max(value, 0))
                    const low = y(Math.min(value, 0))
                    const x = barX(index, which)
                    const middle = x + bar / 2
                    const text = barTexts[which]?.[index]
                    return (
                      <g key={`${String(which)} ${String(index)}`}>
                        <rect
                          className={value < 0 ? 'fc-grow fc-grow-down' : 'fc-grow'}
                          x={x + gap / 2}
                          y={high}
                          width={Math.max(1, bar - gap)}
                          height={Math.max(value === 0 ? 0 : 1, low - high)}
                          fill={colors[which]}
                        />
                        {labelled === 'across' && (
                          <text className="fc-chart-val" x={middle} y={value < 0 ? low + 12 : high - 4} textAnchor="middle">
                            {text}
                          </text>
                        )}
                        {labelled === 'up' && (
                          // Stood on its end: reading up from a bar's top, or down from a negative one's foot.
                          <text
                            className="fc-chart-val"
                            transform={`translate(${String(middle + 4)} ${String(value < 0 ? low + 4 : high - 4)}) rotate(-90)`}
                            textAnchor={value < 0 ? 'end' : 'start'}
                          >
                            {text}
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

          {ends.map((end) => (
            <g key={`name ${String(end.which)}`}>
              <rect x={end.x} y={end.y - 5} width={6} height={2} fill={colors[end.which]} />
              <text className="fc-col-tick" x={end.x + 9} y={end.y} style={{ unicodeBidi: 'plaintext' }}>
                {series[end.which]?.name}
              </text>
            </g>
          ))}

          {shortLabels.map((label, index) => {
            if (index % every !== 0 && hovered !== index) return null
            const text = label.length * CHAR
            const anchor =
              index === 0 && text / 2 > column / 2 + LEFT
                ? 'start'
                : index === n - 1 && text / 2 > column / 2 + EDGE
                  ? 'end'
                  : 'middle'
            const x = anchor === 'start' ? LEFT : anchor === 'end' ? W - EDGE : center(index)
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

      {/* Several series of bars, their figures said by the caller: each named
          beside the dot it is drawn in, since the table that would name it is
          the caller's. */}
      {count > 1 && !shown && !named && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-ink-secondary" aria-hidden="true">
          {series.map((each, which) => (
            <li key={which} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: colors[which] }} />
              <Bidi>{each.name}</Bidi>
            </li>
          ))}
        </ul>
      )}

      {/* **Its figures, in text** (M54 F3, *Every chart has its numbers*): a
          series a row, named beside its dot, the months across — visible
          whenever the picture does not say every figure, and a screen
          reader's always. */}
      <div className={shown ? 'mt-1 overflow-x-auto' : 'sr-only'}>
        <table className="border-collapse text-caption tabular-nums">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-background pr-3 text-left font-normal">
                <span className="sr-only">{labelHeading}</span>
              </th>
              {labels.map((label, index) => (
                <th
                  key={`${label} ${String(index)}`}
                  scope="col"
                  className="border-b border-hairline px-2 py-0.5 text-right font-normal whitespace-nowrap text-ink-secondary"
                >
                  <span aria-hidden="true">{shortLabels[index]}</span>
                  <span className="sr-only">{label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((each, which) => (
              <tr key={which}>
                <th scope="row" className="sticky left-0 bg-background py-0.5 pr-3 text-left font-normal whitespace-nowrap text-ink-secondary">
                  {count > 1 && (
                    <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full" style={{ backgroundColor: colors[which] }} />
                  )}
                  <Bidi>{each.name}</Bidi>
                </th>
                {labels.map((label, index) => (
                  <td key={`${label} ${String(index)}`} className="border-b border-hairline px-2 py-0.5 text-right whitespace-nowrap">
                    {pointText(each.points[index], axis)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
