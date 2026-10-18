import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { budgetLines } from './budgets.ts'

const ILS = 'ILS'

describe('budgetLines', () => {
  const names = new Map([
    ['cat:food', 'Food'],
    ['cat:fun', 'Fun'],
  ])

  it('sets spent against budget, over only when spent is more, biggest budget first', () => {
    const lines = budgetLines(
      new Map([
        ['cat:fun', money(50_000, ILS)],
        ['cat:food', money(250_000, ILS)],
      ]),
      names,
      (id) => (id === 'cat:fun' ? money(50_001, ILS) : money(250_000, ILS)),
      ILS,
    )
    expect(lines.map((one) => [one.name, one.over])).toEqual([
      ['Food', false],
      ['Fun', true],
    ])
  })

  it('a category that spent nothing is a line of zero, not an absence', () => {
    const [line] = budgetLines(new Map([['cat:food', money(100, ILS)]]), names, () => undefined, ILS)
    expect(line?.spent).toEqual(money(0, ILS))
    expect(line?.over).toBe(false)
  })
})
