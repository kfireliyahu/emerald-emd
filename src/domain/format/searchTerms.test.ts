import { describe, expect, it } from 'vitest'

import { DenylistError, denylistTerms, typedTerms } from './searchTerms.ts'

describe('typed terms (M47 U6)', () => {
  it('trims, folds, and drops the empty and the repeated', () => {
    const terms = typedTerms([' Lane ', 'lane', '', 'שלום'])
    expect(terms.map((term) => term.name)).toEqual(['Lane', 'שלום'])
    expect(terms[0]?.holds('12 EXAMPLE LANE')).toBe(true)
    expect(terms[0]?.count('lane, Lane, LANE')).toBe(3)
    expect(terms[1]?.holds('אמר שלום')).toBe(true)
  })
})

describe('denylist terms, in --replace-text form (M47 U6)', () => {
  it('reads the left side only, keeps case, and names a term by its line', () => {
    const terms = denylistTerms(['# comment', '', 'Secret==>***', 'regex:\\b\\d{4}\\b==>####', 'bare'].join('\r\n'))
    expect(terms.map((term) => term.name)).toEqual(['line 3', 'line 4', 'line 5'])
    expect(terms[0]?.holds('a Secret here')).toBe(true)
    expect(terms[0]?.holds('a secret here')).toBe(false)
    expect(terms[1]?.count('1234 and 5678, not 123')).toBe(2)
    // A regex term answers the same twice running — no state kept between calls.
    expect(terms[1]?.holds('card 1234')).toBe(true)
    expect(terms[1]?.holds('card 1234')).toBe(true)
    expect(terms[2]?.holds('bare')).toBe(true)
  })

  it('refuses a pattern that does not parse, without repeating it', () => {
    expect(() => denylistTerms('ok\nregex:(oops')).toThrow(DenylistError)
    expect(() => denylistTerms('ok\nregex:(oops')).toThrow(/^The denylist's line 2 is not a pattern that parses\.$/)
  })
})
