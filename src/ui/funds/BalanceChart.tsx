import { formatMoney } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import type { FundBalanceSnapshot } from '@/domain/model/funds.ts'
import type { PeriodReturn } from '@/domain/funds.ts'
import { countKey } from '@/i18n/count.ts'
import type { RefObject } from 'react'
import { useT } from '@/i18n/current.ts'
import { useWidth } from '@/ui/charts/useWidth.ts'

const BALANCE_HEIGHT = 96
const MOVEMENT_HEIGHT = 56
const PADDING = { top: 12, bottom: 14, left: 4, right: 4 } as const
/** Half the width of a movement bar, in viewBox units. */
const BAR = 7

/**
 * A fund's balance over time, with what was **paid in** and what was **earned**
 * drawn separately underneath — docs/f13's balance-over-time chart.
 *
 * The separation is the whole point and the reason this is two rows rather than
 * one line. A balance that climbed ₪18,000 while ₪18,000 was deposited did not
 * grow; drawn as a single rising line it looks exactly like one that did, which
 * is the misreading D-066 built the entire return calculation to prevent. So the
 * line says what the fund is worth, and the bars beneath say which of the two
 * reasons it moved.
 *
 * Contributions sit above the baseline and gains below it or above it by sign —
 * a losing quarter draws downward and is never smoothed or hidden (docs/f13).
 *
 * A window whose contributions are unknown draws **no bars at all**. Not zero
 * bars: nothing, with the gap named in the caption. The chart has no way to
 * split a movement it cannot account for, and drawing it as pure gain would be
 * the flattering lie.
 *
 * Drawn at the width it is shown (`useWidth`, M64 F70), so it grows with its
 * column and the strokes keep their weight — a `viewBox` stretched to the
 * container would give them two different weights depending on the window.
 */
export function BalanceChart({
  snapshots,
  periods,
}: {
  /** Oldest first, as the repository returns them. */
  snapshots: readonly FundBalanceSnapshot[]
  /** One per consecutive pair, so `periods[i]` ends at `snapshots[i + 1]`. */
  periods: readonly PeriodReturn[]
}) {
  const t = useT()
  const width = useWidth()
  const WIDTH = width.value
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  if (snapshots.length < 2 || first === undefined || last === undefined) return null

  const balances = snapshots.map((snapshot) => snapshot.totalBalance.minor)
  const top = Math.max(...balances)
  const bottom = Math.min(...balances)
  const span = top - bottom

  const x = (index: number): number =>
    PADDING.left + (index * (WIDTH - PADDING.left - PADDING.right)) / (snapshots.length - 1)

  const y = (minor: number): number => {
    const usable = BALANCE_HEIGHT - PADDING.top - PADDING.bottom
    if (span === 0) return PADDING.top + usable / 2
    return PADDING.top + usable - ((minor - bottom) / span) * usable
  }

  const line = snapshots
    .map((snapshot, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(snapshot.totalBalance.minor)}`)
    .join(' ')

  // Both bar kinds share one scale, so a contribution and a gain of the same
  // size are the same height — which is the comparison the reader is making.
  const movements = periods.flatMap((period) =>
    period.kind === 'APPROXIMATE' ? [period.contributions.minor, period.gain.minor] : [],
  )
  const reach = Math.max(1, ...movements.map(Math.abs))
  const zero = MOVEMENT_HEIGHT / 2
  const barHeight = (minor: number): number =>
    (Math.abs(minor) / reach) * (MOVEMENT_HEIGHT / 2 - 4)

  const unknown = periods.filter((period) => period.kind === 'CONTRIBUTIONS_UNKNOWN').length

  return (
    <figure ref={width.ref as RefObject<HTMLElement>} className="m-0" dir="ltr">
      <svg
        viewBox={`0 0 ${WIDTH} ${BALANCE_HEIGHT + MOVEMENT_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={t('wealth.charts.balance', {
          from: formatMoney(first.totalBalance),
          fromDay: toISODate(first.asOfDate),
          to: formatMoney(last.totalBalance),
          toDay: toISODate(last.asOfDate),
        })}
      >
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-ink" />

        {snapshots.map((snapshot, index) => (
          <circle
            key={snapshot.id}
            cx={x(index)}
            cy={y(snapshot.totalBalance.minor)}
            r={index === snapshots.length - 1 ? 3 : 2}
            className="fill-ink"
          />
        ))}

        <g transform={`translate(0 ${BALANCE_HEIGHT})`}>
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={zero}
            y2={zero}
            stroke="currentColor"
            strokeWidth={0.75}
            className="text-ink-tertiary"
          />

          {periods.map((period, index) => {
            if (period.kind !== 'APPROXIMATE') return null
            // The pair straddles the snapshot the window ends at, so the bars
            // sit under the point whose movement they explain.
            const centre = x(index + 1)
            const paid = barHeight(period.contributions.minor)
            const gain = barHeight(period.gain.minor)
            const gainUp = period.gain.minor >= 0

            return (
              <g key={`${period.from.year}-${period.from.month}-${period.to.day}-${String(index)}`}>
                <rect
                  x={centre - BAR - 1}
                  y={zero - paid}
                  width={BAR}
                  height={paid}
                  className="fill-ink-tertiary"
                />
                <rect
                  x={centre + 1}
                  y={gainUp ? zero - gain : zero}
                  width={BAR}
                  height={gain}
                  className={gainUp ? 'fill-ink' : 'fill-negative'}
                />
              </g>
            )
          })}
        </g>
      </svg>

      {/* Its key and its window report something, so they read at 4.5:1 (ink-secondary), never tertiary. */}
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-4 text-caption text-ink-secondary">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-xs bg-ink-tertiary" />
          {t('wealth.charts.paidIn')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-xs bg-ink" />
          {t('wealth.charts.earned')}
        </span>
        <span>
          {toISODate(first.asOfDate)} — {toISODate(last.asOfDate)}
        </span>
        {unknown > 0 && <span>{t(countKey('wealth.charts.notDrawn', unknown), { count: unknown })}</span>}
      </figcaption>
    </figure>
  )
}
