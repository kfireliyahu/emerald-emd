import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { PaycheckWithLines } from '@/domain/model/paycheck.ts'
import { inOrder, neighbour, shownSlip, slipOfMonth, tableRows } from '@/ui/paychecks/months.ts'

function slip(id: string, year: number, month: number, paidDay = 1): PaycheckWithLines {
  const paid = month === 12 ? localDate(year + 1, 1, paidDay) : localDate(year, month + 1, paidDay)
  return {
    paycheck: {
      id,
      period: { year, month },
      paymentDate: paid,
      employerName: undefined,
      gross: money(2000000, 'ILS'),
      net: money(1500000, 'ILS'),
      depositedToAccountId: undefined,
      note: undefined,
      sourceKind: 'MANUAL',
      attachmentRef: undefined,
      isIrregular: false,
    },
    lines: [],
  }
}

// Newest first, as the repository lists them, with March missing and two in May.
const listed = [slip('may-b', 2026, 5, 9), slip('may-a', 2026, 5, 1), slip('apr', 2026, 4), slip('feb', 2026, 2)]

describe('paging through the slips', () => {
  const ordered = inOrder(listed)

  it('runs oldest to newest, two slips of a month in the order they were paid', () => {
    expect(ordered.map((each) => each.paycheck.id)).toEqual(['feb', 'apr', 'may-a', 'may-b'])
  })

  it('opens on the newest, and on the one asked for while it exists', () => {
    expect(shownSlip(ordered, undefined)?.paycheck.id).toBe('may-b')
    expect(shownSlip(ordered, 'apr')?.paycheck.id).toBe('apr')
    expect(shownSlip(ordered, 'deleted')?.paycheck.id).toBe('may-b')
  })

  it('steps over a month with no slip and stops at either end', () => {
    expect(neighbour(ordered, 'apr', -1)?.paycheck.id).toBe('feb')
    expect(neighbour(ordered, 'feb', -1)).toBeUndefined()
    expect(neighbour(ordered, 'may-b', 1)).toBeUndefined()
  })

  it('opens the first slip of a month a point on the line names', () => {
    expect(slipOfMonth(ordered, { year: 2026, month: 5 })?.paycheck.id).toBe('may-a')
    expect(slipOfMonth(ordered, { year: 2026, month: 3 })).toBeUndefined()
  })

  it('lists a missing month in the table, newest first', () => {
    const rows = tableRows(ordered).map((row) =>
      row.kind === 'slip' ? row.entry.paycheck.id : `missing ${String(row.period.month)}`,
    )
    expect(rows).toEqual(['may-b', 'may-a', 'apr', 'missing 3', 'feb'])
  })

  it('has no rows for no slips', () => {
    expect(tableRows([])).toEqual([])
  })
})
