import { toYearMonthString, yearMonthOf, type LocalDate, type YearMonth } from '@/core/time.ts'

import { translate, translateList } from './catalogue.ts'
import type { Language } from './language.ts'

/**
 * **A month as a person reads it, in their language** — M60 U1 (D-583, D-584).
 *
 * The same four shapes as `src/core/time.ts` (D-172) — *July 2026*, *July*,
 * *Jul 2026*, *Jul* — and *3 Oct*, with the names and the order of the parts
 * from the catalogue: Gregorian months only, Western digits, in Hebrew too.
 * `core/time.ts` keeps its English for what a model reads (D-583's tool text
 * stays English); a screen formats here, through `useDates()`.
 */

function nameOf(period: YearMonth, language: Language, list: 'dates.months' | 'dates.monthsShort'): string | undefined {
  return translateList(language, list)[period.month - 1]
}

/** **July 2026** · **יולי 2026**. */
export function formatYearMonth(period: YearMonth, language: Language): string {
  const month = nameOf(period, language, 'dates.months')
  return month === undefined ? toYearMonthString(period) : translate(language, 'dates.yearMonth', { month, year: period.year })
}

/** **July** · **יולי**. */
export function formatMonthName(period: YearMonth, language: Language): string {
  return nameOf(period, language, 'dates.months') ?? toYearMonthString(period)
}

/** **Jul 2026** · **יולי 2026**: the year stays, since a window crosses one. */
export function formatMonthShort(period: YearMonth, language: Language): string {
  const month = nameOf(period, language, 'dates.monthsShort')
  return month === undefined ? toYearMonthString(period) : translate(language, 'dates.yearMonth', { month, year: period.year })
}

/** **Jul** · **יולי**. */
export function formatMonthAbbrev(period: YearMonth, language: Language): string {
  return nameOf(period, language, 'dates.monthsShort') ?? toYearMonthString(period)
}

/** **3 Oct** · **3 באוק׳**: a day of this year. */
export function formatDayMonth(date: LocalDate, language: Language): string {
  return translate(language, 'dates.dayMonth', { day: date.day, month: formatMonthAbbrev(yearMonthOf(date), language) })
}

/** The five, bound to one language — what `useDates()` hands a screen. */
export interface DateWords {
  readonly yearMonth: (period: YearMonth) => string
  readonly monthName: (period: YearMonth) => string
  readonly monthShort: (period: YearMonth) => string
  readonly monthAbbrev: (period: YearMonth) => string
  readonly dayMonth: (date: LocalDate) => string
}

export function dateWords(language: Language): DateWords {
  return {
    yearMonth: (period) => formatYearMonth(period, language),
    monthName: (period) => formatMonthName(period, language),
    monthShort: (period) => formatMonthShort(period, language),
    monthAbbrev: (period) => formatMonthAbbrev(period, language),
    dayMonth: (date) => formatDayMonth(date, language),
  }
}
