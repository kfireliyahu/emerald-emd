import { formatMoney } from '@/core/money.ts'
import { formatMonthShort } from '@/core/time.ts'
import type { CandidateMonth } from '@/domain/model/fixed.ts'

const WIDTH = 180
const HEIGHT = 28
const PADDING = 3

/**
 * A candidate's month-by-month amounts, as bars — docs/f09's amount history
 * sparkline.
 *
 * Bars rather than the line `NetTrend` draws, and the difference is meaning
 * rather than taste: net is a continuous quantity moving through time and the
 * line between two months is a real slope, while these are separate bills that
 * happen to be in order. A bimonthly bill has months with nothing in them, and
 * joining across those would draw a slope that is not a claim about anything.
 *
 * **Scaled from zero, not from the smallest month.** The whole question this
 * answers is "does this amount move", and a chart that stretches a 2% wobble to
 * full height answers it wrong. The proportions are the point.
 */
export function AmountHistory({ months }: { months: readonly CandidateMonth[] }) {
  if (months.length === 0) return null

  const top = Math.max(...months.map((month) => month.amount.minor), 1)
  const slot = (WIDTH - PADDING * 2) / months.length
  // A hairline of a bar for a month that is genuinely tiny beside its neighbours,
  // rather than nothing at all — absent and nearly-zero are different facts.
  const barWidth = Math.max(2, slot - 3)

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-7 w-45 shrink-0"
      role="img"
      aria-label={months
        .map((month) => `${formatMonthShort(month.period)} ${formatMoney(month.amount)}`)
        .join(', ')}
    >
      {months.map((month, index) => {
        const usable = HEIGHT - PADDING * 2
        const height = Math.max(1, (month.amount.minor / top) * usable)
        return (
          <rect
            key={`${month.period.year}-${month.period.month}`}
            x={PADDING + index * slot + (slot - barWidth) / 2}
            y={HEIGHT - PADDING - height}
            width={barWidth}
            height={height}
            rx={1}
            fill="var(--color-ink-tertiary)"
          />
        )
      })}
    </svg>
  )
}
