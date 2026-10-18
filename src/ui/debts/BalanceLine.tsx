import { formatMoney } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import type { BalancePoint } from '@/domain/debt.ts'

const WIDTH = 720
const HEIGHT = 96
/** Room under the line for the two end dates, and over it for the first value. */
const PADDING = { top: 14, bottom: 16, left: 2, right: 2 } as const

/**
 * What was owed, over time — docs/f08's balance-over-time chart.
 *
 * **A step, not a slope**, and that is the whole design: a debt does not drift
 * downwards between payments, it sits still and then drops. A smooth line would
 * draw intermediate balances that were true on no day at all, and it would hide
 * the thing worth seeing — a payment that was mostly interest barely moves the
 * step, which is exactly what `principalOf` means and what a chart drawn from
 * the payment amounts would flatter away.
 *
 * One stroke, no gridlines, no axis, the figures printed beside it (docs/11).
 * The baseline is zero rather than the lowest point, because "how far down has
 * this come" is the question and a chart that started at the minimum would show
 * a debt 2% repaid as almost cleared.
 *
 * Fixed geometry inside a `viewBox`, like `NetTrend`: stretching it to the
 * container would give the stroke two different weights depending on the window.
 */
export function BalanceLine({ points }: { points: readonly BalancePoint[] }) {
  if (points.length < 2) return null

  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return null

  const top = Math.max(...points.map((point) => point.outstanding.minor), 0)
  if (top === 0) return null

  const x = (index: number): number =>
    PADDING.left + (index * (WIDTH - PADDING.left - PADDING.right)) / (points.length - 1)

  const y = (minor: number): number => {
    const usable = HEIGHT - PADDING.top - PADDING.bottom
    // Zero-based, and clamped: an overpaid debt goes negative and the line
    // rests on the floor rather than leaving the frame.
    return PADDING.top + usable - (Math.max(0, minor) / top) * usable
  }

  // Two commands per point: across at the old level, then down to the new one.
  const path = points
    .map((point, index) =>
      index === 0
        ? `M ${x(0)} ${y(point.outstanding.minor)}`
        : `L ${x(index)} ${y(points[index - 1]?.outstanding.minor ?? 0)} L ${x(index)} ${y(point.outstanding.minor)}`,
    )
    .join(' ')

  return (
    <figure className="m-0 max-w-3xl">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Owed, from ${formatMoney(first.outstanding)} on ${toISODate(first.date)} to ${formatMoney(last.outstanding)} on ${toISODate(last.date)}`}
      >
        <path d={path} fill="none" strokeWidth={1.5} className="stroke-ink" />
        <circle cx={x(points.length - 1)} cy={y(last.outstanding.minor)} r={2.5} className="fill-ink" />

        <text x={PADDING.left} y={10} className="fill-ink-tertiary text-[10px]">
          {formatMoney(first.outstanding)}
        </text>
        <text x={PADDING.left} y={HEIGHT - 4} className="fill-ink-tertiary text-[10px]">
          {toISODate(first.date)}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 4}
          textAnchor="end"
          className="fill-ink-tertiary text-[10px]"
        >
          {toISODate(last.date)}
        </text>
      </svg>
    </figure>
  )
}
