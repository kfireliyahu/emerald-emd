import { describe, expect, it } from 'vitest'

import { instantDate, instantDay } from './instant.ts'
import {
  compareDates,
  daysBetween,
  daysInMonth,
  formatDayMonth,
  formatMonthAbbrev,
  formatMonthName,
  formatMonthShort,
  formatYearMonth,
  inferNumericDateOrder,
  isLeapYear,
  isValidDate,
  localDate,
  monthRange,
  monthsBetween,
  parseISODate,
  parseNumericDate,
  parseYearMonth,
  toISODate,
  toYearMonthString,
  tryLocalDate,
  yearMonthOf,
} from './time.ts'

describe('calendar validity', () => {
  it('rejects days that do not exist rather than rolling them over', () => {
    // `new Date(2026, 1, 30)` silently becomes 2 March. That is the behaviour
    // this type exists to avoid.
    expect(isValidDate(2026, 2, 30)).toBe(false)
    expect(isValidDate(2026, 4, 31)).toBe(false)
    expect(isValidDate(2026, 13, 1)).toBe(false)
    expect(isValidDate(2026, 0, 1)).toBe(false)
    expect(tryLocalDate(2026, 2, 30)).toBeUndefined()
    expect(() => localDate(2026, 2, 30)).toThrow()
  })

  it('knows its leap years', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2026)).toBe(false)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(isValidDate(2024, 2, 29)).toBe(true)
  })
})

describe('formatting and parsing', () => {
  it('round-trips ISO', () => {
    expect(toISODate(localDate(2026, 7, 3))).toBe('2026-07-03')
    expect(parseISODate('2026-07-03')).toEqual({ year: 2026, month: 7, day: 3 })
    expect(parseISODate('2026-7-3')).toBeUndefined()
    expect(parseISODate('not a date')).toBeUndefined()
    expect(parseISODate('2026-02-30')).toBeUndefined()
  })

  it('has no timezone to get wrong', () => {
    // The value is calendar parts, so nothing about the host machine can shift
    // it. This is the invariant the whole type exists for.
    expect(toISODate(localDate(2026, 1, 1))).toBe('2026-01-01')
    expect(toISODate(localDate(2026, 12, 31))).toBe('2026-12-31')
  })
})

describe('ordering and periods', () => {
  it('orders by year, then month, then day', () => {
    expect(compareDates(localDate(2026, 7, 3), localDate(2026, 7, 4))).toBeLessThan(0)
    expect(compareDates(localDate(2026, 8, 1), localDate(2026, 7, 31))).toBeGreaterThan(0)
    expect(compareDates(localDate(2026, 7, 3), localDate(2026, 7, 3))).toBe(0)
  })

  it('derives a year-month', () => {
    expect(yearMonthOf(localDate(2026, 7, 3))).toEqual({ year: 2026, month: 7 })
    expect(toYearMonthString({ year: 2026, month: 7 })).toBe('2026-07')
  })

  it('reads a year-month back, and round-trips it', () => {
    expect(parseYearMonth('2026-07')).toEqual({ year: 2026, month: 7 })
    expect(parseYearMonth(' 2026-07 ')).toEqual({ year: 2026, month: 7 })
    expect(toYearMonthString(parseYearMonth('2025-12') ?? { year: 0, month: 1 })).toBe('2025-12')
    expect(parseYearMonth('2026-13')).toBeUndefined()
    expect(parseYearMonth('2026-7')).toBeUndefined()
    expect(parseYearMonth('')).toBeUndefined()
  })

  it('turns a month into the days it covers, February included', () => {
    // Two screens turn a picked month into a date filter — the ledger and
    // re-apply's scope — and February is why that is one function and not two.
    expect(monthRange('2026-07')).toEqual({
      from: localDate(2026, 7, 1),
      to: localDate(2026, 7, 31),
    })
    expect(monthRange('2026-02')?.to).toEqual(localDate(2026, 2, 28))
    expect(monthRange('2024-02')?.to).toEqual(localDate(2024, 2, 29))
  })

  it('refuses anything that is not a month', () => {
    expect(monthRange('2026-13')).toBeUndefined()
    expect(monthRange('2026-00')).toBeUndefined()
    expect(monthRange('2026-7')).toBeUndefined()
    expect(monthRange('')).toBeUndefined()
  })
})

describe('monthsBetween', () => {
  it('counts whole months across a year boundary', () => {
    expect(monthsBetween({ year: 2025, month: 11 }, { year: 2026, month: 2 })).toBe(3)
    expect(monthsBetween({ year: 2026, month: 7 }, { year: 2026, month: 7 })).toBe(0)
  })

  it('goes negative backwards, which is what both callers check for', () => {
    expect(monthsBetween({ year: 2026, month: 2 }, { year: 2025, month: 11 })).toBe(-3)
  })
})

/**
 * D-172: a month reads as a month, and the **stored** form does not move.
 *
 * The whole risk in this unit is one of these two leaking into the other's job,
 * so the tests are about the seam rather than about the strings.
 */
describe('a month as a person reads it', () => {
  it('is prose, in three widths for three amounts of room', () => {
    const july = { year: 2026, month: 7 }
    expect(formatYearMonth(july)).toBe('July 2026')
    expect(formatMonthShort(july)).toBe('Jul 2026')
    expect(formatMonthName(july)).toBe('July')
  })

  it('leaves the stored form exactly where it was', () => {
    // The catch the whole unit turns on: a paycheck's salary month is
    // persisted in this, the ledger filters by it, and the plugin's arguments
    // use it. A display string that leaks in here is a migration.
    expect(toYearMonthString({ year: 2026, month: 7 })).toBe('2026-07')
    expect(parseYearMonth(toYearMonthString({ year: 2026, month: 7 }))).toEqual({
      year: 2026,
      month: 7,
    })
  })

  it('never produces something the reader would take back', () => {
    // Belt and braces on the same seam: nothing a display function returns
    // parses as a stored month, so a value that took the wrong path fails
    // loudly instead of being read as some other month.
    for (const month of [1, 7, 12]) {
      const period = { year: 2026, month }
      expect(parseYearMonth(formatYearMonth(period))).toBeUndefined()
      expect(parseYearMonth(formatMonthShort(period))).toBeUndefined()
      expect(parseYearMonth(formatMonthName(period))).toBeUndefined()
    }
  })

  it('falls back to the stored form rather than printing undefined', () => {
    // A month out of range cannot come from `YearMonth`'s own producers, and a
    // screen printing "undefined 2026" would be worse than printing the key.
    expect(formatYearMonth({ year: 2026, month: 13 })).toBe('2026-13')
  })
})

describe('counting days on the calendar', () => {
  it('counts a fortnight either way, which is the window a purchase is funded in', () => {
    expect(daysBetween(localDate(2026, 3, 1), localDate(2026, 3, 15))).toBe(14)
    expect(daysBetween(localDate(2026, 3, 15), localDate(2026, 3, 1))).toBe(-14)
    expect(daysBetween(localDate(2026, 3, 1), localDate(2026, 3, 1))).toBe(0)
  })

  it('crosses a month, a year and a leap day without a special case', () => {
    expect(daysBetween(localDate(2026, 1, 25), localDate(2026, 2, 4))).toBe(10)
    expect(daysBetween(localDate(2025, 12, 28), localDate(2026, 1, 3))).toBe(6)
    // 2024 is a leap year and 2100 is not, which is the rule a naive ÷4 misses.
    expect(daysBetween(localDate(2024, 2, 28), localDate(2024, 3, 1))).toBe(2)
    expect(daysBetween(localDate(2100, 2, 28), localDate(2100, 3, 1))).toBe(1)
  })
})

describe('a month or a day said short (M45 U3)', () => {
  it('names a month without its year', () => {
    expect(formatMonthAbbrev({ year: 2026, month: 7 })).toBe('Jul')
    expect(formatMonthAbbrev({ year: 2026, month: 13 })).toBe('2026-13')
  })

  it('says a day and its month', () => {
    expect(formatDayMonth({ year: 2026, month: 10, day: 1 })).toBe('1 Oct')
    expect(formatDayMonth({ year: 2027, month: 3, day: 31 })).toBe('31 Mar')
  })
})

describe('an instant as the day it fell on here (M45 U3)', () => {
  it('reads local parts, not UTC', () => {
    const moment = new Date(2026, 9, 9, 23, 30).getTime()
    expect(instantDate(moment)).toEqual({ year: 2026, month: 10, day: 9 })
    expect(instantDay(moment)).toBe('2026-10-09')
  })
})

describe('written dates — the one reader the importer and the engine share (M45 F1)', () => {
  it('reads every separator, a space included, in the order it is told', () => {
    expect(parseNumericDate('03/07/2026', 'dmy')).toEqual({ year: 2026, month: 7, day: 3 })
    expect(parseNumericDate('03 07 2026', 'dmy')).toEqual({ year: 2026, month: 7, day: 3 })
    expect(parseNumericDate('03-07-2026', 'mdy')).toEqual({ year: 2026, month: 3, day: 7 })
    expect(parseNumericDate('2026.07.03', 'ymd')).toEqual({ year: 2026, month: 7, day: 3 })
  })

  it('expands a two-digit year, and refuses a day that is not one', () => {
    expect(parseNumericDate('03/07/26', 'dmy')).toEqual({ year: 2026, month: 7, day: 3 })
    expect(parseNumericDate('03/07/85', 'dmy')).toEqual({ year: 1985, month: 7, day: 3 })
    expect(parseNumericDate('31/09/2026', 'dmy')).toBeUndefined()
    expect(parseNumericDate('3 July 2026', 'dmy')).toBeUndefined()
  })

  it('guesses the order from the dates that read only one way', () => {
    expect(inferNumericDateOrder(['2026-07-03'])).toBe('ymd')
    expect(inferNumericDateOrder(['03/07/26', '18/07/26'])).toBe('dmy')
    expect(inferNumericDateOrder(['07/18/26', '07/03/26'])).toBe('mdy')
    expect(inferNumericDateOrder(['03/07/26'])).toBe('dmy')
    // Both parts over twelve is no date either way, and weighs for neither.
    expect(inferNumericDateOrder(['13/13/26', '07/18/26'])).toBe('mdy')
    expect(inferNumericDateOrder(['18 07 2026', '07 03 2026'])).toBe('dmy')
  })
})
