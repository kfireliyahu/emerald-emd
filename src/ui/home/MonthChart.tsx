import { formatMoney, type Money } from '@/core/money.ts'
import { compareYearMonths, formatMonthName, formatYearMonth, type YearMonth } from '@/core/time.ts'
import { useWidth } from '@/ui/charts/useWidth.ts'

/** Written out whole, so the stylesheet sees every class it has to make. */
const STROKE = { in: 'stroke-flow-in', out: 'stroke-flow-out' } as const
const FILL = { in: 'fill-flow-in', out: 'fill-flow-out' } as const
const PADDING = { top: 26, bottom: 26, left: 10, right: 10 } as const

export interface ChartMonth {
  readonly period: YearMonth
  /** Undefined for a month the document does not hold: a gap, not a zero. */
  readonly came: Money | undefined
  readonly went: Money | undefined
  /** A statement is missing for this month, so went out is short. */
  readonly part: boolean
}

/**
 * **Came in and went out, month by month, and the way between months** —
 * M28 U5. Two lines in their flows' colours (D-313: a chart is where the colour
 * reaches), and every month a column you press to open it; the month open is
 * the emerald plane with its two figures printed, the way Paychecks' point is.
 *
 * Measured rather than scaled, as `NetTrend` is, so an 11px label is 11px in a
 * narrow window too. A month not in the document breaks both lines.
 */
export function MonthChart({
  months,
  selected,
  onPick,
  height = 170,
}: {
  readonly months: readonly ChartMonth[]
  readonly selected: YearMonth | undefined
  readonly onPick: (period: YearMonth) => void
  readonly height?: number
}) {
  const width = useWidth()
  const frame = width.ref
  const W = width.value
  const values = months.flatMap((one) => [one.came, one.went].flatMap((m) => (m === undefined ? [] : [m.minor])))
  if (values.length === 0) return null

  const top = Math.max(...values) * 1.04
  const bottom = Math.min(...values) * 0.9
  const span = top - bottom || 1
  const n = months.length
  const step = n > 1 ? (W - PADDING.left - PADDING.right) / (n - 1) : W
  const x = (index: number): number => (n === 1 ? W / 2 : PADDING.left + index * step)
  const y = (minor: number): number =>
    PADDING.top + (height - PADDING.top - PADDING.bottom) * (1 - (minor - bottom) / span)

  const line = (pick: (one: ChartMonth) => Money | undefined): string => {
    let d = ''
    let open = false
    months.forEach((one, index) => {
      const value = pick(one)
      if (value === undefined) {
        open = false
        return
      }
      d += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(value.minor).toFixed(1)}`
      open = true
    })
    return d
  }

  return (
    <figure ref={frame} className="m-0">
      <svg
        viewBox={`0 0 ${String(W)} ${String(height)}`}
        className="block h-auto w-full overflow-visible"
        aria-label="Came in and went out by month. Choose a month to open it."
      >
        <path d={line((one) => one.went)} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="stroke-flow-out" />
        <path d={line((one) => one.came)} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="stroke-flow-in" />
        {months.map((one, index) => {
          const on = selected !== undefined && compareYearMonths(one.period, selected) === 0
          const has = one.came !== undefined || one.went !== undefined
          const cx = x(index)
          const anchor = index === 0 ? 'start' : index === n - 1 ? 'end' : 'middle'
          const name = formatYearMonth(one.period)
          const yearShown = one.period.month === 1 || index === 0
          return (
            <g
              key={name}
              className={`fc-col${on ? ' fc-col-on' : ''}`}
              {...(has
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': `${name}: came in ${one.came === undefined ? 'nothing' : formatMoney(one.came)}, went out ${one.went === undefined ? 'nothing' : formatMoney(one.went)}`,
                    'aria-pressed': on,
                    onClick: () => onPick(one.period),
                    onKeyDown: (event: React.KeyboardEvent) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onPick(one.period)
                      }
                    },
                  }
                : { 'aria-hidden': true })}
            >
              <rect className="fc-col-hit" x={cx - step / 2} y={0} width={step} height={height - PADDING.bottom + 4} />
              <rect
                className="fc-col-sel"
                x={cx - step / 2 + 0.5}
                y={0.5}
                width={Math.max(0, step - 1)}
                height={height - PADDING.bottom + 3}
              />
              {(
                [
                  ['in', one.came],
                  ['out', one.went],
                ] as const
              ).map(([flow, value]) =>
                value === undefined ? null : (
                  <circle
                    key={flow}
                    cx={cx}
                    cy={y(value.minor)}
                    r={on ? 4 : 2.5}
                    strokeWidth={1.5}
                    className={`${STROKE[flow]} ${on ? FILL[flow] : 'fill-background'}`}
                  />
                ),
              )}
              {on && one.came !== undefined && one.went !== undefined && (
                <>
                  <text
                    x={cx}
                    y={Math.min(y(one.came.minor), y(one.went.minor)) - 10}
                    textAnchor={anchor}
                    className="fc-col-val fill-flow-in"
                  >
                    {formatMoney(one.came)}
                  </text>
                  <text
                    x={cx}
                    y={Math.max(y(one.came.minor), y(one.went.minor)) + 20}
                    textAnchor={anchor}
                    className="fc-col-val fill-flow-out"
                  >
                    {formatMoney(one.went)}
                  </text>
                </>
              )}
              {one.part && one.went !== undefined && !on && (
                <text x={cx} y={y(one.went.minor) + 16} textAnchor="middle" className="fc-col-part">
                  part
                </text>
              )}
              <text className="fc-col-tick" x={cx} y={height - 6} textAnchor={anchor}>
                {formatMonthName(one.period).slice(0, 3)}
                {yearShown && step >= 40 ? ` ${String(one.period.year).slice(2)}` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
