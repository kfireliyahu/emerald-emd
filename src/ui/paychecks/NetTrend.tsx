import { formatMoney, type Money } from '@/core/money.ts'
import { compareYearMonths, formatMonthName, formatYearMonth, type YearMonth } from '@/core/time.ts'
import type { NetPoint } from '@/domain/paycheck.ts'
import { useWidth } from '@/ui/charts/useWidth.ts'

/** Drawn at the width it is given, so its labels stay 11px at any window. */
const HEIGHT = 150
const PADDING = { top: 24, bottom: 26, left: 10, right: 10 } as const

/**
 * Net by salary month, **and the way between months** (M28 U4).
 *
 * A line, 1.5pt ink, no fill, no gridlines and no axis (docs/11); every month
 * a point, and every point a button that opens its month — asked: *"the
 * paychecks should have pagination or points in the graph clickable"*. The
 * month open is filled emerald with a ring and its net printed over it, and
 * its name goes ink beneath.
 *
 * **A gap is a dashed bridge, not a trend.** A month with no slip ends the
 * solid line; a dashed hairline spans it, and its point is hollow and dashed
 * and goes nowhere, because there is nothing there to open.
 *
 * Measured rather than scaled: the `viewBox` is the width it is drawn at, so a
 * month's name is 11px in a narrow window too. Draws once, on first
 * appearance, and never again.
 */
export function NetTrend({
  points,
  selected,
  onPick,
}: {
  readonly points: readonly NetPoint[]
  readonly selected: YearMonth | undefined
  readonly onPick: (period: YearMonth) => void
}) {
  const { ref: frame, value: WIDTH } = useWidth()
  const values = points.flatMap((point) => (point.net === undefined ? [] : [point.net.minor]))
  if (values.length === 0) return null

  const top = Math.max(...values)
  const bottom = Math.min(...values)
  const span = top - bottom
  const x = (index: number): number =>
    points.length === 1 ? WIDTH / 2 : PADDING.left + (index * (WIDTH - PADDING.left - PADDING.right)) / (points.length - 1)
  const y = (minor: number): number => {
    const usable = HEIGHT - PADDING.top - PADDING.bottom
    // A flat line sits in the middle: one month, or twelve the same, is not a rise.
    if (span === 0) return PADDING.top + usable / 2
    return PADDING.top + usable - ((minor - bottom) / span) * usable
  }

  // Runs of months that have a slip: each is its own path, so a gap breaks it.
  const runs: { index: number; net: Money }[][] = [[]]
  points.forEach((point, index) => {
    if (point.net === undefined) {
      if ((runs.at(-1) ?? []).length > 0) runs.push([])
    } else {
      runs.at(-1)?.push({ index, net: point.net })
    }
  })

  /** Where a missing month's point sits: halfway along the bridge over it. */
  const gapY = (index: number): number => {
    const before = points.slice(0, index).reverse().find((point) => point.net !== undefined)?.net
    const after = points.slice(index + 1).find((point) => point.net !== undefined)?.net
    const ys = [before, after].flatMap((each) => (each === undefined ? [] : [y(each.minor)]))
    return ys.length === 0 ? HEIGHT / 2 : ys.reduce((sum, each) => sum + each, 0) / ys.length
  }

  const bridges = runs
    .filter((run) => run.length > 0)
    .flatMap((run, at, all) => {
      const next = all[at + 1]?.[0]
      const last = run.at(-1)
      if (next === undefined || last === undefined) return []
      return [{ from: last, to: next }]
    })

  // A January says its year; so does the first month, where there is room.
  const step = points.length > 1 ? (WIDTH - PADDING.left - PADDING.right) / (points.length - 1) : WIDTH
  const yearShown = (index: number): boolean => points[index]?.period.month === 1 || (index === 0 && step >= 60)

  return (
    <figure ref={frame} className="m-0">
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="block h-auto w-full overflow-visible"
        aria-label="Net pay by month. Choose a point to open that month."
      >
        {bridges.map(({ from, to }) => (
          <path
            key={`bridge-${String(from.index)}`}
            d={`M${String(x(from.index))},${String(y(from.net.minor))}L${String(x(to.index))},${String(y(to.net.minor))}`}
            stroke="var(--color-ink-tertiary)"
            strokeWidth={1}
            strokeDasharray="3 3"
            fill="none"
          />
        ))}
        {runs
          .filter((run) => run.length > 1)
          .map((run) => (
            <path
              key={`run-${String(run[0]?.index ?? 0)}`}
              d={run.map((p, i) => `${i === 0 ? 'M' : 'L'}${String(x(p.index))},${String(y(p.net.minor))}`).join(' ')}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={1.5}
              strokeLinejoin="round"
              className="fc-draw"
              style={{ '--fc-draw-length': `${String(WIDTH * 2)}` } as React.CSSProperties}
            />
          ))}

        {points.map((point, index) => {
          const on = selected !== undefined && compareYearMonths(point.period, selected) === 0
          const gap = point.net === undefined
          const cy = gap ? gapY(index) : y(point.net.minor)
          const cx = x(index)
          const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'
          const name = formatYearMonth(point.period)
          return (
            <g
              key={name}
              className={`fc-pt${on ? ' fc-pt-on' : ''}${gap ? ' fc-pt-gap' : ''}`}
              {...(gap
                ? { 'aria-hidden': true }
                : {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': `${name}, net ${formatMoney(point.net)}`,
                    'aria-pressed': on,
                    onClick: () => onPick(point.period),
                    onKeyDown: (event: React.KeyboardEvent) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onPick(point.period)
                      }
                    },
                  })}
            >
              <rect x={cx - 18} y={0} width={36} height={HEIGHT} fill="transparent" />
              <circle className="fc-pt-ring" cx={cx} cy={cy} r={9} />
              <circle className="fc-pt-dot" cx={cx} cy={cy} r={on ? 5 : 3} />
              {on && point.net !== undefined && (
                <text className="fc-pt-val" x={cx} y={cy - 14} textAnchor={index === points.length - 1 ? 'end' : index === 0 ? 'start' : 'middle'}>
                  {formatMoney(point.net)}
                </text>
              )}
              <text className="fc-pt-tick" x={cx} y={HEIGHT - 6} textAnchor={anchor}>
                {formatMonthName(point.period).slice(0, 3)}
                {yearShown(index) ? ` ${String(point.period.year).slice(2)}` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
