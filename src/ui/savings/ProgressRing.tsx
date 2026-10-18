/**
 * How far along a goal is, as a ring — docs/f07's progress ring, hand-rolled in
 * SVG like every other chart here (docs/02).
 *
 * **A goal with no target has no ring**, and the caller renders its running
 * total instead. A ring with nothing to be a fraction of would have to pick an
 * arc, and any arc it picked would be a claim.
 *
 * **Over 100% keeps drawing the full circle** rather than wrapping round again:
 * a goal that is 140% funded is finished, and a ring that started a second lap
 * would read as 40%. The figure beside it is what carries the overshoot.
 */
export function ProgressRing({
  basisPoints,
  size = 44,
  label,
}: {
  /** Balance ÷ target. Undefined draws nothing at all. */
  basisPoints: number | undefined
  size?: number
  label?: string | undefined
}) {
  if (basisPoints === undefined) return null

  const stroke = Math.max(3, Math.round(size / 12))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = Math.max(0, Math.min(1, basisPoints / 10_000))

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? `${Math.round(basisPoints / 100)}% of the target`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-hairline-strong"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        // Start at twelve o'clock rather than three, which is where every
        // progress ring anyone has ever seen starts.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="stroke-ink"
      />
    </svg>
  )
}
