import { formatMoney } from '@/core/money.ts'
import type { DeductionType } from '@/domain/model/paycheck.ts'
import type { WaterfallStep } from '@/domain/paycheck.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { typeLabel } from '@/ui/paychecks/DeductionTypeSelect.tsx'

/**
 * Gross to net, one step per deduction — docs/f04's waterfall, and the clearest
 * presentation of a payslip there is.
 *
 * Rows rather than columns. Eight deductions with names like
 * `קרן השתלמות · Study fund` need the width for their labels, and a horizontal
 * bar puts the amount, the name and the running total on one line where they
 * can be read together.
 *
 * Each bar floats: it starts where the running total ends up and reaches back
 * to where it started, so its length *is* the deduction and its position shows
 * how far down the slip that money came out. Gross is the full width, net is
 * what is left, and the eye can compare the two ends without reading a number.
 *
 * **The steps always reach net** (`grossToNetSteps`). When the itemization does
 * not account for the whole difference, the remainder is a step of its own,
 * drawn as an outline rather than a filled bar because it is the one row that
 * describes what the app does *not* know.
 */
export function Waterfall({
  steps,
  types,
}: {
  steps: readonly WaterfallStep[]
  types: readonly DeductionType[]
}) {
  const gross = steps[0]?.amount.minor ?? 0
  if (gross <= 0) return null

  const byId = new Map(types.map((type) => [type.id, type]))

  // Percentages for layout only. Money stays in minor units everywhere it
  // matters (D-003); this is a CSS width, and a rounding error here is a
  // fraction of a pixel rather than an agora.
  const percent = (minor: number): number => (minor / gross) * 100

  return (
    <ol className="max-w-4xl">
      {steps.map((step, index) => {
        const before = index === 0 ? gross : (steps[index - 1]?.runningTotal.minor ?? gross)
        const isEnd = step.kind === 'GROSS' || step.kind === 'NET'
        const from = isEnd ? 0 : Math.min(step.runningTotal.minor, before)
        const to = isEnd ? step.runningTotal.minor : Math.max(step.runningTotal.minor, before)

        return (
          <li
            key={`${step.kind}-${step.lineId ?? index}`}
            className="flex items-center gap-3 border-b border-hairline py-1.5 last:border-b-0"
          >
            <span className={`w-48 shrink-0 ${isEnd ? 'font-medium' : 'text-ink-secondary'}`}>
              {label(step, byId)}
            </span>

            <span className="relative h-3 min-w-0 flex-1" aria-hidden="true">
              <span
                className={`absolute inset-y-0 rounded-sm ${bar(step)}`}
                // A minimum in pixels rather than percent: a ₪12 union fee
                // against a ₪26,000 gross is a real row of the slip, and a bar
                // too thin to see would read as a rendering fault.
                style={{ left: `${percent(from)}%`, width: `${percent(to - from)}%`, minWidth: '3px' }}
              />
            </span>

            <span
              className={`w-28 shrink-0 text-right tabular-nums ${
                step.kind === 'UNEXPLAINED' ? 'text-negative' : ''
              }`}
            >
              {isEnd || step.isAddBack ? '' : '−'}
              {formatMoney(step.amount)}
            </span>

            {/* The running total, which is what makes it a waterfall rather than
                a bar chart: each row says where the slip stands after it. */}
            <span className="w-28 shrink-0 text-right text-ink-tertiary tabular-nums">
              {isEnd ? '' : formatMoney(step.runningTotal)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function label(step: WaterfallStep, byId: ReadonlyMap<string, DeductionType>): React.ReactNode {
  switch (step.kind) {
    case 'GROSS':
      return 'Gross'
    case 'NET':
      return 'Net'
    case 'UNEXPLAINED':
      return step.isAddBack ? 'Itemized beyond net' : 'Not itemized'
    default: {
      const type = step.deductionTypeId === undefined ? undefined : byId.get(step.deductionTypeId)
      return <Bidi>{type === undefined ? 'Unknown deduction' : typeLabel(type)}</Bidi>
    }
  }
}

function bar(step: WaterfallStep): string {
  switch (step.kind) {
    case 'GROSS':
      return 'bg-hairline-strong'
    case 'NET':
      return 'bg-ink'
    case 'UNEXPLAINED':
      // An outline, not a fill: this row is the part the app cannot account for,
      // and it should not look like a deduction the slip actually printed.
      return 'border border-dashed border-negative'
    default:
      return 'bg-ink-tertiary'
  }
}
