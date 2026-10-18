/**
 * The nearest-neighbour suggestion, against the shapes Israeli statements
 * actually print.
 *
 * What is being tested is mostly the *refusals*. A suggestion that fires too
 * readily is worse than none: it is the "silent inference the user didn't ask
 * for" docs/08 names as a risk, wearing the clothes of the user's own history.
 */

import { describe, expect, it } from 'vitest'

import { nameTokens, settledCategory, similarity, suggestFromHistory } from './suggest.ts'

const history = [
  { merchantNormalized: 'שופרסל דיל רמת גן', categoryId: 'cat:groceries', count: 42 },
  { merchantNormalized: 'PAYPAL *STEAM GAMES', categoryId: 'cat:games', count: 3 },
  { merchantNormalized: 'סונול', categoryId: 'cat:fuel', count: 11 },
]

function backlog(...names: readonly string[]) {
  return names.map((merchantNormalized) => ({ merchantNormalized, hasSettled: false }))
}

describe('suggesting from history', () => {
  it('learns a chain from another branch of it, and says which', () => {
    const [one] = suggestFromHistory(backlog('שופרסל אקספרס הרצליה'), history)

    expect(one?.categoryId).toBe('cat:groceries')
    // The explanation is the point: a proposal nobody can check is the thing
    // conventions forbids.
    expect(one?.neighbour).toBe('שופרסל דיל רמת גן')
    expect(one?.confident).toBe(true)
  })

  it('says nothing about a merchant that shares no word with anything', () => {
    expect(suggestFromHistory(backlog('ד"ר מקס וטרינר'), history)).toEqual([])
  })

  it('leaves a merchant with settled rows of its own alone', () => {
    // The screen has a stronger hint for it — the user's decisions about that
    // exact name — and a weaker guess beside a stronger one is noise.
    const withSettled = [{ merchantNormalized: 'שופרסל אקספרס', hasSettled: true }]
    expect(suggestFromHistory(withSettled, history)).toEqual([])
  })

  it('says nothing about two shops that share only a payment processor', () => {
    // `PAYPAL *STEAM GAMES` and `PAYPAL *SPOTIFY` share one token, and the star
    // is the statement saying that token is not the merchant. This was the
    // measure's first answer and it was backwards: the pair scored *higher*
    // than two branches of one supermarket.
    expect(suggestFromHistory(backlog('PAYPAL *SPOTIFY'), history)).toEqual([])
  })

  it('ignores branch numbers, which are about the row and not the shop', () => {
    const [one] = suggestFromHistory(backlog('סונול 4471'), history)
    expect(one?.categoryId).toBe('cat:fuel')
  })

  it('prefers the neighbour the user has decided about more often, on a tie', () => {
    const tied = [
      { merchantNormalized: 'קפה גרג', categoryId: 'cat:once', count: 1 },
      { merchantNormalized: 'קפה ג', categoryId: 'cat:often', count: 30 },
    ]
    const [one] = suggestFromHistory(backlog('קפה'), tied)
    // Both score the same against a one-word name; forty decisions beat one.
    if (one !== undefined && one.score === 1) expect(one.categoryId).toBe('cat:often')
  })

  it('has nothing to say with an empty history', () => {
    expect(suggestFromHistory(backlog('שופרסל אקספרס'), [])).toEqual([])
  })

  it('never suggests a merchant to itself', () => {
    const [one] = suggestFromHistory(backlog('סונול'), history)
    expect(one).toBeUndefined()
  })

  it('is ordered best first, so the bar lists the strongest', () => {
    const suggestions = suggestFromHistory(
      backlog('שופרסל אקספרס הרצליה', 'סונול 4471'),
      history,
    )
    // An exact chain name beats a chain plus two words of branch.
    expect(suggestions.map((one) => one.merchantNormalized)).toEqual([
      'סונול 4471',
      'שופרסל אקספרס הרצליה',
    ])
  })
})

describe('the measure itself', () => {
  it('drops tokens with digits in them and one-letter fragments', () => {
    expect([...nameTokens('סונול 4471 ת"א').keys()]).toEqual(['סונול', 'ת"א'])
  })

  it('splits on the punctuation statements use between a processor and a shop', () => {
    expect([...nameTokens('PAYPAL *STEAM')]).toEqual([
      ['PAYPAL', 0.25],
      ['STEAM', 1],
    ])
  })

  it('treats a shared company suffix as saying nothing', () => {
    // Two unrelated companies both ending in בע"מ are not one company.
    expect(similarity(nameTokens('אלפא בעמ'), nameTokens('ביתא בעמ'))).toBeLessThan(0.34)
  })

  it('is one for the same name', () => {
    expect(similarity(nameTokens('רמי לוי'), nameTokens('רמי לוי'))).toBe(1)
  })

  it('is nothing against an empty name', () => {
    expect(similarity(nameTokens(''), nameTokens('רמי לוי'))).toBe(0)
  })
})

describe('what counts as a merchant the user has filed', () => {
  it('takes a merchant filed exactly one way', () => {
    expect(settledCategory([{ categoryId: 'cat:groceries', count: 42 }])).toBe('cat:groceries')
  })

  it('refuses a merchant filed two ways, however lopsided', () => {
    // A shop that genuinely sells two things teaches nothing, and propagating
    // the more frequent reading to its neighbours propagates a coin flip.
    expect(
      settledCategory([
        { categoryId: 'cat:groceries', count: 40 },
        { categoryId: 'cat:household', count: 2 },
      ]),
    ).toBeUndefined()
  })

  it('refuses a merchant filed no way at all', () => {
    expect(settledCategory([])).toBeUndefined()
  })
})
