import { describe, expect, it } from 'vitest'

import * as english from '@/core/time.ts'

import { dateWords, formatDayMonth, formatMonthAbbrev, formatMonthName, formatMonthShort, formatYearMonth } from './dates.ts'

const MONTHS = Array.from({ length: 12 }, (_, index) => ({ year: 2026, month: index + 1 }))

describe('the months in Hebrew (M60 U1, D-583)', () => {
  it('names the twelve Gregorian months', () => {
    expect(MONTHS.map((period) => formatMonthName(period, 'he'))).toEqual([
      'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
    ])
  })

  it('writes the year in Western digits after the month', () => {
    expect(formatYearMonth({ year: 2026, month: 7 }, 'he')).toBe('יולי 2026')
    expect(formatMonthShort({ year: 2026, month: 10 }, 'he')).toBe('אוק׳ 2026')
    expect(formatMonthAbbrev({ year: 2026, month: 2 }, 'he')).toBe('פבר׳')
  })

  it('puts a day in its month', () => {
    expect(formatDayMonth({ year: 2026, month: 10, day: 3 }, 'he')).toBe('3 באוק׳')
    expect(dateWords('he').dayMonth({ year: 2026, month: 1, day: 31 })).toBe('31 בינו׳')
  })

  it('a month that is not one falls back to the stored form', () => {
    expect(formatYearMonth({ year: 2026, month: 13 }, 'he')).toBe('2026-13')
  })
})

describe('the months in English', () => {
  it('say what src/core/time.ts says, which a model still reads', () => {
    for (const period of MONTHS) {
      expect(formatYearMonth(period, 'en')).toBe(english.formatYearMonth(period))
      expect(formatMonthName(period, 'en')).toBe(english.formatMonthName(period))
      expect(formatMonthShort(period, 'en')).toBe(english.formatMonthShort(period))
      expect(formatMonthAbbrev(period, 'en')).toBe(english.formatMonthAbbrev(period))
      expect(formatDayMonth({ ...period, day: 3 }, 'en')).toBe(english.formatDayMonth({ ...period, day: 3 }))
    }
  })
})
