import { describe, expect, it } from 'vitest'

import {
  starterBuckets,
  starterProposal,
  starterShareOf,
  starterWhy,
  starterWindow,
  unplacedHeadings,
  type StarterHeading,
} from './starterPlan.ts'

const heading = (id: string, name: string, spentMinor: number, kind = 'EXPENSE', isSystem = false): StarterHeading => ({
  id,
  name,
  kind,
  isSystem,
  spentMinor,
})

const seeded: readonly StarterHeading[] = [
  heading('cat:living', 'Living', 300_000),
  heading('cat:transport', 'Transport', 100_000),
  heading('cat:health', 'Health & Fitness', 0),
  heading('cat:family', 'Family', 0),
  heading('cat:obligations', 'Obligations', 0),
  heading('cat:lifestyle', 'Lifestyle', 80_000),
  heading('cat:income', 'Income', 0, 'INCOME'),
  heading('cat:savings', 'Savings', 0, 'SAVING'),
  heading('cat:uncategorized', 'Uncategorized', 40_000, 'EXPENSE', true),
  heading('cat:transfer', 'Internal Transfer', 0, 'TRANSFER', true),
]

describe('the 50/30/20 starter, onto the categories', () => {
  it('places every seeded heading by itself, and leaves income, transfers and system ones out', () => {
    expect(unplacedHeadings(seeded)).toEqual([])
    expect(starterShareOf(heading('cat:income', 'Income', 0, 'INCOME'))).toBe('NONE')
    expect(starterShareOf(heading('mine', 'Loans', 0, 'DEBT_PAYMENT'))).toBe('NEEDS')
    expect(starterShareOf(heading('mine', 'Jar', 0, 'SAVING'))).toBe('SAVING')
  })

  it('divides each share by what went out, and skips a heading that spent nothing beside one that did', () => {
    const buckets = starterBuckets(seeded, new Map())
    expect(buckets).toEqual([
      { share: 'NEEDS', name: 'Living', categoryId: 'cat:living', basisPoints: 3750 },
      { share: 'NEEDS', name: 'Transport', categoryId: 'cat:transport', basisPoints: 1250 },
      { share: 'WANTS', name: 'Lifestyle', categoryId: 'cat:lifestyle', basisPoints: 3000 },
      // Nothing went out under Savings, and it is the only saving heading: it takes the whole share.
      { share: 'SAVING', name: 'Savings', categoryId: 'cat:savings', basisPoints: 2000 },
    ])
    expect(buckets.reduce((n, one) => n + one.basisPoints, 0)).toBe(10_000)
  })

  it('divides evenly when nothing has gone out yet, and adds up exactly', () => {
    const fresh = seeded.map((one) => ({ ...one, spentMinor: 0 }))
    const needs = starterBuckets(fresh, new Map()).filter((one) =>
      ['cat:living', 'cat:transport', 'cat:health', 'cat:family', 'cat:obligations'].includes(one.categoryId ?? ''),
    )
    expect(needs.map((one) => one.basisPoints)).toEqual([1000, 1000, 1000, 1000, 1000])
  })

  it('asks about a heading of the person’s own, and follows the answer', () => {
    const mine = [...seeded, heading('cat:mine', 'Hobbies', 20_000)]
    expect(unplacedHeadings(mine).map((one) => one.name)).toEqual(['Hobbies'])

    const wants = starterBuckets(mine, new Map([['cat:mine', 'WANTS']]))
    expect(wants.filter((one) => one.basisPoints > 0 && ['cat:lifestyle', 'cat:mine'].includes(one.categoryId ?? ''))).toEqual([
      { share: 'WANTS', name: 'Lifestyle', categoryId: 'cat:lifestyle', basisPoints: 2400 },
      { share: 'WANTS', name: 'Hobbies', categoryId: 'cat:mine', basisPoints: 600 },
    ])
    // Left out, or not answered, it is in no bucket.
    expect(starterBuckets(mine, new Map([['cat:mine', 'NONE']])).some((one) => one.categoryId === 'cat:mine')).toBe(false)
    expect(starterBuckets(mine, new Map()).some((one) => one.categoryId === 'cat:mine')).toBe(false)
  })

  it('keeps a share that no heading answers to as one bucket in its own name', () => {
    const noSaving = seeded.filter((one) => one.id !== 'cat:savings')
    expect(starterBuckets(noSaving, new Map()).at(-1)).toEqual({ share: 'SAVING', name: 'Saving', categoryId: undefined, basisPoints: 2000 })
    expect(starterBuckets([], new Map())).toEqual([
      { share: 'NEEDS', name: 'Needs', categoryId: undefined, basisPoints: 5000 },
      { share: 'WANTS', name: 'Wants', categoryId: undefined, basisPoints: 3000 },
      { share: 'SAVING', name: 'Saving', categoryId: undefined, basisPoints: 2000 },
    ])
  })
})

describe('the starter’s order (M31 U4)', () => {
  it('puts the biggest first inside each share, and the shares in order', () => {
    const flipped = seeded.map((one) => (one.id === 'cat:transport' ? { ...one, spentMinor: 9_000_000 } : one))
    const buckets = starterBuckets(flipped, new Map())
    expect(buckets[0]?.name).toBe('Transport')
    expect(buckets.map((one) => one.share)).toEqual([...buckets.map((one) => one.share)].sort(
      (a, b) => ['NEEDS', 'WANTS', 'SAVING'].indexOf(a) - ['NEEDS', 'WANTS', 'SAVING'].indexOf(b),
    ))
  })
})

describe('the starter shown before it is made (M59 U4, D-580)', () => {
  it('lists every heading with its share, its part and why', () => {
    const proposal = starterProposal(seeded, new Map())
    expect(proposal.lines.map((one) => one.heading.name)).toEqual(seeded.map((one) => one.name))
    expect(proposal.unanswered).toEqual([])
    const byName = new Map(proposal.lines.map((one) => [one.heading.name, one]))
    expect(byName.get('Living')).toMatchObject({ answer: 'NEEDS', placedBy: 'DEFAULT', basisPoints: 3750, sizedBy: 'SPENT' })
    expect(byName.get('Health & Fitness')).toMatchObject({ answer: 'NEEDS', basisPoints: 0, sizedBy: 'NOTHING_OUT' })
    expect(byName.get('Savings')).toMatchObject({ answer: 'SAVING', placedBy: 'DEFAULT', basisPoints: 2000, sizedBy: 'WHOLE' })
    expect(byName.get('Income')).toMatchObject({ answer: 'NONE', placedBy: 'NOT_SPLIT', basisPoints: 0 })
    // The same arithmetic Make plan writes.
    expect(proposal.buckets).toEqual(starterBuckets(seeded, new Map()))

    const living = byName.get('Living')
    const health = byName.get('Health & Fitness')
    if (living === undefined || health === undefined) throw new Error('missing lines')
    expect(starterWhy(living, 3, 'ILS', undefined)).toBe('Needs by default · ₪1,000.00 a month went out')
    expect(starterWhy(health, 3, 'ILS', undefined)).toBe('Needs by default · Nothing went out, so no bucket')
    expect(starterWhy(living, 3, 'ILS', 'Rent and food')).toBe('Needs by default · ₪1,000.00 a month went out · keeps its bucket Rent and food')
  })

  it('moves a heading the starter placed itself when the person says, and says so', () => {
    const moved = starterProposal(seeded, new Map([['cat:transport', 'WANTS']]))
    const transport = moved.lines.find((one) => one.heading.id === 'cat:transport')
    expect(transport).toMatchObject({ answer: 'WANTS', placedBy: 'CHOSEN' })
    if (transport === undefined) throw new Error('missing Transport')
    expect(starterWhy(transport, 3, 'ILS', undefined)).toMatch(/^You chose · /)
    // Living takes the whole half now; Lifestyle and Transport share the 30% by what went out.
    expect(moved.buckets.filter((one) => one.share === 'NEEDS').map((one) => [one.name, one.basisPoints])).toEqual([['Living', 5000]])
    expect(moved.buckets.filter((one) => one.share === 'WANTS').map((one) => [one.name, one.basisPoints])).toEqual([
      ['Transport', 1667],
      ['Lifestyle', 1333],
    ])
    // Income stays out whatever is answered.
    expect(starterProposal(seeded, new Map([['cat:income', 'NEEDS']])).lines.find((one) => one.heading.id === 'cat:income')?.answer).toBe('NONE')
  })

  it('holds a heading of the person’s own until it is answered', () => {
    const mine = [...seeded, heading('cat:mine', 'Hobbies', 20_000)]
    const asked = starterProposal(mine, new Map())
    expect(asked.unanswered.map((one) => one.name)).toEqual(['Hobbies'])
    expect(asked.lines.at(-1)).toMatchObject({ answer: undefined, placedBy: 'ASK', basisPoints: 0 })
  })

  it('names the months once', () => {
    expect(starterWindow([])).toBeUndefined()
    expect(starterWindow([{ year: 2026, month: 10 }])).toBe('October 2026')
    expect(starterWindow([{ year: 2026, month: 8 }, { year: 2026, month: 9 }, { year: 2026, month: 10 }])).toBe('Aug to Oct 2026')
    expect(starterWindow([{ year: 2025, month: 12 }, { year: 2026, month: 1 }])).toBe('Dec 2025 to Jan 2026')
  })
})
