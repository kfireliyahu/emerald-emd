import { money } from '@/core/money.ts'
import {
  addMonths,
  compareYearMonths,
  formatMonthShort,
  formatYearMonth,
  monthsBetween,
  parseYearMonth,
  toYearMonthString,
  type YearMonth,
} from '@/core/time.ts'
import type { RollupGroup } from '@/domain/format/rollup.ts'
import type { ChartAxis, ChartPoint, ChartSeries } from '@/ui/charts/chart.ts'

/** Past this many series a chart is a smear; the rest stay in the table. */
export const MOST_SERIES = 8

/** A gap between two months is filled with empty months up to this span, and no further. */
const MOST_MONTHS = 240

/** A rollup's groups as the general chart's plain series, and what it leaves out. */
export interface RollupChart {
  /** `March 2026`, one per month from the first to the last. */
  readonly labels: readonly string[]
  /** `Mar 2026`, for under the columns. */
  readonly ticks: readonly string[]
  readonly series: readonly ChartSeries[]
  readonly axis: ChartAxis
  /** What the table has and the chart does not draw, a sentence each. */
  readonly left: readonly string[]
}

/**
 * **Bars by month, one series per group when the rollup groups by a link**
 * (M53 U6, D-516) — the screen's own reading of `format_rollup`'s answer.
 *
 * Money becomes `Money` here, from the figure's minor units and currency, and
 * a number only when the chart draws it. **Nothing is made up to fill a
 * chart**: a month with no row is a gap, an unchecked group is the word, and
 * what the axis cannot hold — rows with no month, a second currency, series
 * past the eighth — is said in `left`, never summed into something new.
 */
export function rollupChart(
  groups: readonly RollupGroup[],
  options: {
    /** The linked rows' names by id, as `runRollup` answers them. */
    readonly names: ReadonlyMap<string, string>
    /** Whether the rollup groups by a link — one series per linked row. */
    readonly by: boolean
    /** The rollup's own name, its one series when there is no link. */
    readonly name: string
    /** What a plain figure counts — `rows` for a count. */
    readonly unit?: string | undefined
  },
): RollupChart {
  // The months, first to last, with every month between them.
  const periods = [...new Set(groups.flatMap((group) => (group.period === undefined ? [] : [group.period])))]
  const parsed = periods
    .map((text) => parseYearMonth(text))
    .filter((each): each is YearMonth => each !== undefined)
    .sort(compareYearMonths)
  const first = parsed[0]
  const last = parsed[parsed.length - 1]
  const months =
    first !== undefined && last !== undefined && monthsBetween(first, last) <= MOST_MONTHS
      ? Array.from({ length: monthsBetween(first, last) + 1 }, (_, index) => addMonths(first, index))
      : parsed
  const keys = months.map(toYearMonthString)

  // The axis: the currency most figures are in, or a plain figure's unit.
  const currencies = new Map<string, number>()
  for (const group of groups) {
    if (group.value.kind !== 'VALUE') continue
    for (const figure of group.value.figures) {
      if (figure.currency !== undefined) currencies.set(figure.currency, (currencies.get(figure.currency) ?? 0) + 1)
    }
  }
  const currency = [...currencies].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0]
  const axis: ChartAxis = currency !== undefined ? { currency } : { unit: options.unit }

  const point = (group: RollupGroup | undefined): ChartPoint => {
    if (group === undefined) return undefined
    if (group.value.kind === 'UNCHECKED') return { said: 'unchecked' }
    const figures = group.value.figures
    if (currency === undefined) return figures[0]?.value
    const own = figures.find((figure) => figure.currency === currency)
    if (own !== undefined && Number.isSafeInteger(own.value)) return money(own.value, own.currency ?? currency)
    const others = figures.flatMap((figure) => (figure.currency === undefined ? [] : [figure.currency]))
    return { said: others.length === 0 ? 'nothing' : `only in ${others.join(', ')}` }
  }

  // The series: one per linked row (and "none"), or the rollup's own.
  const seriesKeys = options.by ? [...new Set(groups.map((group) => group.by ?? ''))] : ['']
  const byKey = new Map(groups.map((group) => [JSON.stringify([group.period, options.by ? (group.by ?? '') : '']), group]))
  const all: ChartSeries[] = seriesKeys.map((key) => ({
    name: options.by ? (key === '' ? 'none' : (options.names.get(key) ?? key)) : options.name,
    key: options.by ? key : options.name,
    points: keys.map((month) => point(byKey.get(JSON.stringify([month, key])))),
  }))

  // The largest series by what they draw; the rest are the table's.
  const weight = (each: ChartSeries): number =>
    each.points.reduce<number>((total, one) => {
      if (one === undefined || typeof one !== 'object') return total + Math.abs(one ?? 0)
      return 'minor' in one ? total + Math.abs(one.minor) : total
    }, 0)
  const series =
    all.length > MOST_SERIES ? [...all].sort((a, b) => weight(b) - weight(a)).slice(0, MOST_SERIES) : all

  const left: string[] = []
  const monthless = groups.filter((group) => group.period === undefined).reduce((total, group) => total + group.rows, 0)
  if (monthless > 0) {
    left.push(`${monthless === 1 ? '1 row has' : `${String(monthless)} rows have`} no month, so ${monthless === 1 ? 'it is' : 'they are'} in the table and not the chart.`)
  }
  const unplaced = groups
    .filter((group) => group.period !== undefined && parseYearMonth(group.period) === undefined)
    .reduce((total, group) => total + group.rows, 0)
  if (unplaced > 0) {
    left.push(`${unplaced === 1 ? '1 row has' : `${String(unplaced)} rows have`} a month that is not a year and a month, so the chart cannot place ${unplaced === 1 ? 'it' : 'them'}.`)
  }
  const elsewhere = [...currencies.keys()].filter((each) => each !== currency).sort()
  if (currency !== undefined && elsewhere.length > 0) {
    left.push(`The chart draws ${currency}; figures in ${elsewhere.join(', ')} are in the table.`)
  }
  if (all.length > series.length) {
    left.push(`The ${String(series.length)} largest of ${String(all.length)} are drawn; every one is in the table.`)
  }

  return { labels: months.map(formatYearMonth), ticks: months.map(formatMonthShort), series, axis, left }
}
