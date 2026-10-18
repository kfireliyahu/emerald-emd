import { describe, expect, it } from 'vitest'

import { statementGaps, type AccountMonths } from './statementGaps.ts'

const ym = (text: string) => ({ year: Number(text.slice(0, 4)), month: Number(text.slice(5)) })
const account = (months: readonly string[], name = 'Card'): AccountMonths => ({
  accountId: name,
  name,
  last4: '7781',
  months: months.map(ym),
})
const periods = (gaps: ReturnType<typeof statementGaps>) =>
  gaps.map((gap) => `${gap.name} ${String(gap.period.year)}-${String(gap.period.month).padStart(2, '0')}`)

describe('statementGaps', () => {
  it('finds a month inside an account’s run that has nothing in it', () => {
    expect(periods(statementGaps([account(['2026-01', '2026-02', '2026-04'])], ym('2026-04')))).toEqual([
      'Card 2026-03',
    ])
  })

  it('finds the months after an account went quiet, while that was recent', () => {
    expect(periods(statementGaps([account(['2026-05', '2026-06'])], ym('2026-08')))).toEqual([
      'Card 2026-08',
      'Card 2026-07',
    ])
  })

  it('says nothing about a card put away long ago', () => {
    expect(statementGaps([account(['2025-01', '2025-02'])], ym('2026-08'))).toEqual([])
  })

  it('has nothing to say about an account with no rows, or a document with one month', () => {
    expect(statementGaps([account([])], ym('2026-08'))).toEqual([])
    expect(statementGaps([account(['2026-08'])], ym('2026-08'))).toEqual([])
  })

  it('lists the newest first, and accounts by name within a month', () => {
    const gaps = statementGaps(
      [account(['2026-01', '2026-03'], 'Bank'), account(['2026-01', '2026-03'], 'Amex')],
      ym('2026-03'),
    )
    expect(periods(gaps)).toEqual(['Amex 2026-02', 'Bank 2026-02'])
  })
})
