/**
 * **A sparkline** (M64 U4, D-615): the months behind a figure, drawn small —
 * a 2px `ink-secondary` line and the last month an ink dot with a surface ring.
 * It shows a direction and no value, so it is hidden from a screen reader; the
 * figure beside it says what it is. Fewer than two drawn months draws nothing.
 */
export function Sparkline({
  values,
  width = 96,
  height = 24,
}: {
  readonly values: readonly (number | undefined)[]
  readonly width?: number
  readonly height?: number
}) {
  const drawn = values.flatMap((value, index) => (value === undefined || !Number.isFinite(value) ? [] : [{ value, index }]))
  if (drawn.length < 2) return null
  const low = Math.min(...drawn.map((point) => point.value))
  const high = Math.max(...drawn.map((point) => point.value))
  const pad = 4
  const x = (index: number) => pad + ((width - pad * 2) * index) / Math.max(1, values.length - 1)
  const y = (value: number) => (high === low ? height / 2 : pad + (height - pad * 2) * (1 - (value - low) / (high - low)))
  const path = drawn.map((point, at) => `${at === 0 ? 'M' : 'L'}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join('')
  const last = drawn[drawn.length - 1]!
  return (
    <svg aria-hidden viewBox={`0 0 ${String(width)} ${String(height)}`} width={width} height={height} className="shrink-0 overflow-visible rtl:-scale-x-100">
      <path d={path} fill="none" className="stroke-ink-secondary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.index)} cy={y(last.value)} r="4" className="fill-ink stroke-background" strokeWidth="2" />
    </svg>
  )
}
