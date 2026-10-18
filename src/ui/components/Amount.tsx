import { formatMoney, isNegative, type Money } from '@/core/money.ts'
import { useAnimatedMoney } from '@/ui/useAnimatedNumber.ts'

/**
 * A money value, right-aligned and tabular.
 *
 * Outflows are rendered in plain ink, not red (D-017). Red is reserved for
 * problems — a reconciliation gap, an over-allocated split — and spending is
 * not a problem, it is the content. The minus sign carries the meaning.
 */
export function Amount({ value, className }: { value: Money; className?: string | undefined }) {
  return (
    <span
      className={`tabular-nums ${className ?? ''}`}
      // The sign is not conveyed by styling, so it needs to survive being read
      // aloud as much as being looked at.
      aria-label={`${isNegative(value) ? 'minus ' : ''}${formatMoney(value, { symbol: false })}`}
    >
      {formatMoney(value)}
    </span>
  )
}

/**
 * The same amount, counting to its new value when it changes.
 *
 * **Use it only where the figure changes while the user is looking at it** — a
 * slider being dragged, a filter narrowing. docs/11 calls that the app's
 * signature interaction and draws the line in the same breath: a figure that
 * merely *appears* is not animated, which `useAnimatedNumber` enforces by never
 * counting its first value. Reaching for this on a figure that only ever
 * arrives is the excess the rule exists to stop.
 *
 * **What a screen reader hears is the settled value, not the count.** The label
 * is built from the target rather than from the frame on screen, so twelve
 * frames of an approach are never announced as twelve numbers.
 */
export function CountingAmount({
  value,
  className,
}: {
  value: Money
  className?: string | undefined
}) {
  const shown = useAnimatedMoney(value)
  return (
    <span
      className={`tabular-nums ${className ?? ''}`}
      aria-label={`${isNegative(value) ? 'minus ' : ''}${formatMoney(value, { symbol: false })}`}
    >
      {formatMoney(shown)}
    </span>
  )
}
