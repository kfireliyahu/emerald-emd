import { formatMoney } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import type { BalancePoint } from '@/domain/debt.ts'
import type { RefObject } from 'react'
import { useT } from '@/i18n/current.ts'
import { useWidth } from '@/ui/charts/useWidth.ts'

const HEIGHT = 96
/** Room for the line's width at its ends; the value and the dates are words outside the drawing (M64 F46). */
const PADDING = { top: 4, bottom: 4, left: 2, right: 2 } as const

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
 * Drawn at the width it is shown (`useWidth`, M64 F70), so it grows with its
 * column and the stroke stays 2px: a `viewBox` stretched to the container would
 * give the stroke two different weights depending on the window.
 */
export function BalanceLine({ points }: { points: readonly BalancePoint[] }) {
  const t = useT()
  const width = useWidth()
  const WIDTH = width.value
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
    <figure ref={width.ref as RefObject<HTMLElement>} className="m-0 flex flex-col gap-1 text-caption text-ink-secondary tabular-nums" dir="ltr">
      <span>{formatMoney(first.outstanding)}</span>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={t('wealth.charts.owed', {
          from: formatMoney(first.outstanding),
          fromDay: toISODate(first.date),
          to: formatMoney(last.outstanding),
          toDay: toISODate(last.date),
        })}
      >
        <path d={path} fill="none" strokeWidth={2} className="stroke-ink" />
        <circle cx={x(points.length - 1)} cy={y(last.outstanding.minor)} r={2.5} className="fill-ink" />

      </svg>
      <span className="flex justify-between gap-4">
        <span>{toISODate(first.date)}</span>
        <span>{toISODate(last.date)}</span>
      </span>
    </figure>
  )
}
