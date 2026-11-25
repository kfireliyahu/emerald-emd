import { currencySymbol, formatMoney, minorUnitDigits, type Money } from '@/core/money.ts'

/**
 * **The data display kit** (M64 U4, D-615): one display per shape of data the
 * inventory found (docs/redesign/screens.md), hand-drawn SVG and HTML in the
 * theme's tokens, no chart library (D-608). A screen picks a display by the
 * shape of what it shows, never by what looks busy enough: `DISPLAYS` says
 * when each one is the right one and when it is not, and the specimen page
 * (`#/specimen`) draws every one in every state.
 *
 * What every display keeps: its numbers in text beside or under it (*Every
 * chart has its numbers*); ink marks with colour only for meaning or a
 * category; a mark's data end rounded `--radius-mark` and its baseline square;
 * names from a document in `Bidi`; an empty state that is the caller's one
 * sentence; and a negative value that keeps its minus sign and a word.
 */

/** A figure's parts, so a large one can set its symbol and decimals smaller. */
export interface MoneyParts {
  /** `−` (U+2212, a minus and not a hyphen) or nothing. */
  readonly sign: '' | '−'
  readonly symbol: string
  readonly whole: string
  /** `.40`, or nothing for a currency with no minor unit. */
  readonly fraction: string
}

export function moneyParts(value: Money): MoneyParts {
  const text = formatMoney({ minor: Math.abs(value.minor), currency: value.currency }, { symbol: false })
  const [whole = text, fraction] = text.split('.')
  return {
    sign: value.minor < 0 ? '−' : '',
    symbol: currencySymbol(value.currency),
    whole,
    fraction: fraction === undefined ? '' : `.${fraction}`,
  }
}

/**
 * The amount as the kit prints it: `formatMoney`'s, with a true minus (U+2212)
 * rather than a hyphen, so a display's figures and its labels carry one sign.
 */
export function kitMoney(value: Money): string {
  return formatMoney(value).replace(/^-/, '−')
}

/** The amount rounded to whole units, `₪1,235` — for a label beside a mark, never a total. */
export function wholeMoney(value: Money): string {
  const scale = 10 ** minorUnitDigits(value.currency)
  const rounded = Math.round(value.minor / scale) * scale
  return kitMoney({ minor: rounded, currency: value.currency }).replace(/\.\d+$/, '')
}

/** A part's share of a whole in whole percent; nothing of a whole of nothing. */
export function share(part: number, whole: number): number {
  if (!(whole > 0) || !Number.isFinite(part)) return 0
  return Math.round((100 * part) / whole)
}

/**
 * How wide a bar is, in percent of the widest: 0 for nothing, and never under
 * 2 for something, so a small value is still a mark you can see.
 */
export function barPercent(value: number, widest: number): number {
  if (!(widest > 0) || !(Math.abs(value) > 0)) return 0
  return Math.max(2, Math.min(100, (100 * Math.abs(value)) / widest))
}

/** A money value as the plain number a mark is drawn at, in major units. */
export function drawn(value: Money): number {
  return value.minor / 10 ** minorUnitDigits(value.currency)
}

/** One display of the kit: its component, the shape it is for, and when not to use it. */
export interface Display {
  readonly name: string
  readonly shape: string
  readonly use: string
  readonly not: string
}

/**
 * Every display, in the order the specimen page draws them. A new shape of
 * data gets a display here, with its `use` and `not`, before a screen draws it.
 */
export const DISPLAYS: readonly Display[] = [
  {
    name: 'HeadlineFigure',
    shape: 'a single headline, or a total against its usual',
    use: 'The one figure a screen answers with (display size, once a screen), or a row of totals each against a named base, with its change and, where it helps, a small trend of the months before.',
    not: 'A figure that is one of many in a list — that is a table cell — or two display figures on one screen.',
  },
  {
    name: 'Sparkline',
    shape: 'a trend, beside the figure it explains',
    use: 'The months behind a figure, drawn small inside a HeadlineFigure or a ranked row: the direction, never the values.',
    not: 'Anything someone has to read a value off — that is a MonthTrend.',
  },
  {
    name: 'RankedBars',
    shape: 'a part of a whole read as a ranked list',
    use: 'Where it went: the largest first, one ink bar each, the amount at the end, the rest folded into one line that opens them.',
    not: 'Fewer than three parts (say them in a sentence), or parts that must add up to a whole you show (a PartOfWhole).',
  },
  {
    name: 'PartOfWhole',
    shape: 'a part of a whole',
    use: 'A whole split into a few named parts — what the saving was made of — as one thin bar of category hues over a list of the parts with each share.',
    not: 'More than six parts, or parts compared with each other rather than with the whole (RankedBars).',
  },
  {
    name: 'PlanAgainst',
    shape: 'a plan against what happened, or a ratio against a limit',
    use: 'Each planned line, what was spent of it and what is left or over, as a meter on its own track; one row for a single limit.',
    not: 'Lines with no plan at all, or a plan nobody acts on this month.',
  },
  {
    name: 'MonthTrend',
    shape: 'a trend over months',
    use: 'One to four series over months, 2px lines named at their ends, the open month marked, a tooltip and arrow keys on every month.',
    not: 'A single month (a HeadlineFigure), or series of different units on one chart.',
  },
  {
    name: 'MonthStrip',
    shape: 'a trend over months that is also the way to page them',
    use: 'Fourteen months as columns, the open one in ink and the rest quiet, each a button that opens its month; the value on the open month and in the tooltip.',
    not: 'Comparing exact values between months (a MonthTrend), or where nothing opens.',
  },
  {
    name: 'MonthFlow',
    shape: 'a flow from one whole to the places it went',
    use: 'What came in, divided into where it went and what is left — the month (spent, put aside, left over) or a payslip (deductions, net) — with the part that went past the whole said in red with a word.',
    not: 'Parts that are not drawn from one whole, or a flow through more than one stage.',
  },
]
