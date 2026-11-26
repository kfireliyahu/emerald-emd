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
 * The one exception is `tone` (M64 F11, D-633): a figure that sums a period
 * up — left over, to split, net worth — is drawn in `positive` or `negative`
 * by its sign, and a statement's gap in `negative` whenever it is not nothing.
 * The minus sign and the label still say it; colour is never the only signal.
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
  tone,
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
  /**
   * Only for a figure that sums a period up (D-633): `sign` draws it in
   * `positive` above nothing and `negative` below; `gap` draws a difference
   * that should be nothing in `negative` whenever it is not. Nothing is ink.
   */
  readonly tone?: 'sign' | 'gap' | undefined
}) {
  const parts = value === undefined ? undefined : moneyParts(value)
  const display = size === 'display'
  const toned = figureTone(tone, value)
  const figure = (
    <span
      dir="ltr"
      data-figure
      data-tone={toned}
      className={`${
        display
          ? 'text-display [font-variant-numeric:proportional-nums]'
          : 'text-title font-medium tabular-nums'
      }${toned === 'positive' ? ' text-positive' : toned === 'negative' ? ' text-negative' : ''}`}
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
  // The display figure says what it is beside it, never above (D-614 dropped
  // Home's eyebrow; M64 U5's taste check): the figure first, then its name at
  // the heading step and its change under the name.
  const body = display ? (
    <span className="flex flex-wrap items-end gap-x-6 gap-y-2">
      {figure}
      <span className="flex flex-col gap-1 pb-4">
        <span className="text-heading font-semibold">{label}</span>
        <span className="text-ink-secondary">{parts === undefined ? empty : change}</span>
      </span>
    </span>
  ) : (
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

/**
 * The colour a summing figure is drawn in (D-633): `positive` or `negative` by
 * its sign, a gap `negative` unless it is nothing, and ink (nothing) otherwise.
 */
export function figureTone(tone: 'sign' | 'gap' | undefined, value: Money | undefined): 'positive' | 'negative' | undefined {
  if (tone === undefined || value === undefined || value.minor === 0) return undefined
  if (tone === 'gap') return 'negative'
  return value.minor > 0 ? 'positive' : 'negative'
}
