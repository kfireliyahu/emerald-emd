import { currencySymbol, formatMoney, minorUnitDigits, type Money } from '@/core/money.ts'

import { CATEGORY_COLOR_SLOTS, CATEGORY_COLOR_TOKENS, slotOf, token, UNCATEGORIZED_COLOR_TOKEN } from './categoryColor.ts'

/**
 * **What the general chart draws, as plain data** (M53 U6, D-516): labels
 * along the bottom, one or more series of figures, and what the axis counts in.
 * Nothing here knows a ledger, a rollup or a format — whoever has figures says
 * them in these words, and `Chart.tsx` draws them.
 *
 * **Money stays Money until it is drawn** (D-003): a point is a `Money`, and it
 * becomes a number only in `drawnValue`, for a position on the screen, and is
 * printed with `formatMoney` everywhere a person reads it.
 */

/**
 * One point of a series: money, a plain figure, a word said in place of a
 * figure (`unchecked`) — drawn as nothing and read out as the word — or
 * nothing at all, which is a gap and never a zero.
 */
export type ChartPoint = Money | number | { readonly said: string } | undefined

export interface ChartSeries {
  /** What the legend and the table call it. */
  readonly name: string
  /**
   * What its colour is chosen from — a linked row's id — so a series is the
   * same colour whatever else is drawn beside it. The name when absent; `''`
   * is "none", drawn in the uncategorized grey.
   */
  readonly key?: string
  /** One per label, in the labels' order. */
  readonly points: readonly ChartPoint[]
}

/** What the axis counts in: a currency, or a unit (`rows`, `kg`) or nothing. */
export type ChartAxis = { readonly currency: string } | { readonly unit?: string | undefined }

export type ChartKind = 'bars' | 'line'

export function isMoney(point: ChartPoint): point is Money {
  return typeof point === 'object' && 'minor' in point
}

export function isSaid(point: ChartPoint): point is { readonly said: string } {
  return typeof point === 'object' && 'said' in point
}

/**
 * Where a point sits on the axis, or undefined when it is not drawn: nothing,
 * a word, money in another currency than the axis's, or a plain figure on a
 * money axis. **A chart that drew those would be lying**; the table beside it
 * still says each of them in full.
 */
export function drawnValue(point: ChartPoint, axis: ChartAxis): number | undefined {
  if (point === undefined || isSaid(point)) return undefined
  if (isMoney(point)) {
    if (!('currency' in axis) || axis.currency !== point.currency) return undefined
    return point.minor / 10 ** minorUnitDigits(point.currency)
  }
  return 'currency' in axis || !Number.isFinite(point) ? undefined : point
}

/** A point as a person reads it in full — `₪1,234.50`, `12 rows`, `unchecked`, `nothing`. */
export function pointText(point: ChartPoint, axis: ChartAxis): string {
  if (point === undefined) return 'nothing'
  if (isSaid(point)) return point.said
  if (isMoney(point)) return formatMoney(point)
  const figure = String(Number(point.toPrecision(12)))
  const unit = 'unit' in axis ? axis.unit : undefined
  return unit === undefined || unit === '' ? figure : `${figure} ${unit}`
}

/** `1.2k`, `3.4M`, `250`, `0.5` — a figure short enough for an axis or a bar's top. */
function compact(value: number): string {
  const magnitude = Math.abs(value)
  const trim = (figure: number, digits: number): string => String(Number(figure.toFixed(digits)))
  if (magnitude >= 1e9) return `${trim(value / 1e9, 1)}B`
  if (magnitude >= 1e6) return `${trim(value / 1e6, 1)}M`
  if (magnitude >= 1e4) return `${trim(value / 1e3, 0)}k`
  if (magnitude >= 1e3) return `${trim(value / 1e3, 1)}k`
  return trim(value, magnitude >= 10 ? 0 : 2)
}

/**
 * A drawn value said short, for a tick or the top of a bar: `₪1.2k`, `-₪40`,
 * `12 rows`. Never the figure a person reads as the answer — that is
 * `pointText`, in the table and the hover.
 */
export function shortText(value: number, axis: ChartAxis): string {
  if ('currency' in axis) {
    return `${value < 0 ? '-' : ''}${currencySymbol(axis.currency)}${compact(Math.abs(value))}`
  }
  const unit = axis.unit
  return unit === undefined || unit === '' ? compact(value) : `${compact(value)} ${unit}`
}

/**
 * Round ticks covering `low..high`: a step of 1, 2 or 5 times a power of ten,
 * about `count` of them, the first at or below `low` and the last at or above
 * `high`. One tick for a range of nothing.
 */
export function niceTicks(low: number, high: number, count = 4): readonly number[] {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0]
  if (low > high) return niceTicks(high, low, count)
  if (low === high) return [low]
  const rough = (high - low) / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((each) => each * power).find((each) => each >= rough) ?? 10 * power
  const first = Math.floor(low / step) * step
  const ticks: number[] = []
  // Rounded to the step's own digits, so 0.1 + 0.2 is printed as 0.3.
  const digits = Math.max(0, -Math.floor(Math.log10(step)))
  for (let index = 0; ; index += 1) {
    const tick = Number((first + index * step).toFixed(digits))
    ticks.push(tick)
    if (tick >= high) return ticks
  }
}

/**
 * The span the axis draws: bars stand on zero, so it is always inside; a line
 * reads its shape, so it spans only what it shows. Rounded out to ticks.
 */
export function axisSpan(values: readonly number[], kind: ChartKind): { low: number; high: number; ticks: readonly number[] } {
  if (values.length === 0) return { low: 0, high: 1, ticks: [0] }
  let low = Math.min(...values)
  let high = Math.max(...values)
  if (kind === 'bars') {
    low = Math.min(0, low)
    high = Math.max(0, high)
  }
  if (low === high) {
    // One figure, or several the same: a line through the middle of nothing.
    const pad = low === 0 ? 1 : Math.abs(low) / 2
    if (kind === 'bars') high = high === 0 ? 1 : high
    else {
      low -= pad
      high += pad
    }
  }
  const ticks = niceTicks(low, high, 4)
  return { low: Math.min(low, ticks[0] ?? low), high: Math.max(high, ticks[ticks.length - 1] ?? high), ticks }
}

/**
 * Which colour each series is drawn in, as a `var(--color-…)` reference.
 *
 * **One series is ink** — a chart is ink on nothing, and a hue on a lone
 * series would say a category where there is none. **Several take the category
 * palette**, the one exception to the monochrome rule: each starts at its key's
 * hash and takes the least taken slot from there, as `categoryPalette.ts`
 * resolves a level, so two series on one chart never share a hue while there
 * are hues to go round. In key order, so the order they were passed in never
 * repaints them. The key `''` — "none" — is the uncategorized grey.
 */
export function seriesColors(series: readonly ChartSeries[]): readonly string[] {
  if (series.length === 1) return [token('ink-secondary')]
  const keys = series.map((each) => each.key ?? each.name)
  const load = new Array<number>(CATEGORY_COLOR_SLOTS).fill(0)
  const chosen = new Map<string, string>()
  for (const key of [...new Set(keys)].sort()) {
    if (key === '') continue
    const start = slotOf(key)
    let best = start
    for (let step = 0; step < CATEGORY_COLOR_SLOTS; step += 1) {
      const candidate = (start + step) % CATEGORY_COLOR_SLOTS
      if ((load[candidate] ?? 0) < (load[best] ?? 0)) best = candidate
    }
    load[best] = (load[best] ?? 0) + 1
    chosen.set(key, CATEGORY_COLOR_TOKENS[best] ?? UNCATEGORIZED_COLOR_TOKEN)
  }
  return keys.map((key) => token(chosen.get(key) ?? UNCATEGORIZED_COLOR_TOKEN))
}
