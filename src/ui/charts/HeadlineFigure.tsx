import type { Money } from '@/core/money.ts'

import { moneyParts } from './kit.ts'
import { Sparkline } from './Sparkline.tsx'

/**
 * **A headline figure** (M64 U4, D-615): a label, one figure, its change
 * against a named base, and, where the months behind it help, a sparkline.
 *
 * `size: 'display'` is the one figure a screen answers with (D-614: Home's
 * left over) — the light face at the display step, proportional figures, the
 * symbol and the decimals at the hero step in `ink-secondary` so the eye lands
 * on the magnitude. `size: 'tile'` is a row of totals: the title step,
 * tabular, and the same parts.
 *
 * The figure is ink whatever it reports (D-614 retires the flows on figures);
 * a flow's colour, when a screen wants one, is the `mark` beside the label.
 * A negative figure keeps its minus sign; no figure at all is a dash and the
 * caller's one sentence in place of the change. With `onOpen` the whole tile
 * is a button and its arrow is visible at rest (D-614, from C).
 */
export function HeadlineFigure({
  label,
  value,
  change,
  trend,
  size = 'tile',
  mark,
  empty,
  onOpen,
}: {
  readonly label: string
  readonly value: Money | undefined
  /** Said in words against a named base: `+12% on the three months before`. */
  readonly change?: string | undefined
  readonly trend?: readonly (number | undefined)[] | undefined
  readonly size?: 'display' | 'tile'
  /** A colour token for a small mark beside the label (`flow-in`), never the figure. */
  readonly mark?: string | undefined
  /** What to say when there is no figure: `No paycheck this month`. */
  readonly empty: string
  readonly onOpen?: (() => void) | undefined
}) {
  const parts = value === undefined ? undefined : moneyParts(value)
  const display = size === 'display'
  const figure = (
    <span
      dir="ltr"
      data-figure
      className={
        display
          ? 'text-display [font-variant-numeric:proportional-nums]'
          : 'text-title font-medium tabular-nums'
      }
    >
      {parts === undefined ? (
        '—'
      ) : (
        <>
          {parts.sign}
          <span className={display ? 'text-hero font-normal tracking-normal text-ink-secondary' : 'text-heading font-normal text-ink-secondary'}>
            {parts.symbol}
          </span>
          {parts.whole}
          <span className={display ? 'text-hero font-normal tracking-normal text-ink-secondary' : 'text-heading font-normal text-ink-secondary'}>
            {parts.fraction}
          </span>
        </>
      )}
    </span>
  )
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-caption text-ink-secondary group-hover:text-ink">
        {mark !== undefined && (
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-${mark})` }} />
        )}
        {label}
        {onOpen !== undefined && (
          <svg aria-hidden viewBox="0 0 16 16" className="size-3 shrink-0 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        )}
      </span>
      <span className={display ? 'flex flex-wrap items-baseline gap-4' : 'flex items-end justify-between gap-3'}>
        {figure}
        {trend !== undefined && <Sparkline values={trend} />}
      </span>
      <span className="text-caption text-ink-secondary">{parts === undefined ? empty : change}</span>
    </>
  )
  const frame = 'group flex min-w-0 flex-col gap-1 text-start'
  return onOpen === undefined ? (
    <div className={frame}>{body}</div>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      className={`${frame} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      {body}
    </button>
  )
}
