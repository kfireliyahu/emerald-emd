import { describe, expect, it } from 'vitest'

import {
  capitalize,
  cleanText,
  containsHebrew,
  containsLetter,
  firstGrapheme,
  foldText,
  groupThousands,
  listed,
  normalizeHeader,
  normalizeMerchant,
  parseFigureText,
  plural,
} from './text.ts'

describe('cleanText', () => {
  it('strips the invisible marks Israeli exports are full of', () => {
    // RLM around a name, and an NBSP inside it.
    expect(cleanText('‏שופרסל דיל‏')).toBe('שופרסל דיל')
    expect(cleanText('‫פז ילו‬')).toBe('פז ילו')
    expect(cleanText('﻿Date')).toBe('Date')
  })

  it('collapses whitespace and trims', () => {
    expect(cleanText('  קפה   נמרוד  ')).toBe('קפה נמרוד')
    expect(cleanText('GOOGLE*CLOUD 54L3X3    CC GOOGLE.COM IE')).toBe(
      'GOOGLE*CLOUD 54L3X3 CC GOOGLE.COM IE',
    )
  })

  it('leaves an ordinary string alone', () => {
    expect(cleanText('AMAZON.COM')).toBe('AMAZON.COM')
  })
})

describe('normalizeHeader', () => {
  it('flattens the embedded newlines Cal writes into its header cells', () => {
    // Cal's header is `תאריך\r\nעסקה`. Without this, every alias lookup misses.
    expect(normalizeHeader('תאריך\r\nעסקה')).toBe('תאריך עסקה')
    expect(normalizeHeader('סכום\nחיוב')).toBe('סכום חיוב')
  })

  it('lowercases so English aliases match whatever case the file used', () => {
    expect(normalizeHeader('  Transaction   Date ')).toBe('transaction date')
  })
})

describe('normalizeMerchant', () => {
  it('uppercases Latin and leaves Hebrew alone', () => {
    expect(normalizeMerchant('Paypal *Steam Games')).toBe('PAYPAL *STEAM GAMES')
    expect(normalizeMerchant('שופרסל')).toBe('שופרסל')
  })

  it('strips trailing branch numbers so two branches of one shop group together', () => {
    expect(normalizeMerchant('שופרסל דיל 344')).toBe('שופרסל דיל')
    expect(normalizeMerchant('ראמי לוי 12')).toBe('ראמי לוי')
    expect(normalizeMerchant('מ. יוחננוף ובניו סניף 7')).toBe('מ. יוחננוף ובניו')
  })

  it('does not strip digits that are part of the name', () => {
    expect(normalizeMerchant('GOOGLE*CLOUD 54L3X3 CC GOOGLE.COM IE')).toBe(
      'GOOGLE*CLOUD 54L3X3 CC GOOGLE.COM IE',
    )
  })

  it('produces the same key from two differently-marked copies of one name', () => {
    expect(normalizeMerchant('‏קפה  גן עד‏')).toBe(normalizeMerchant('קפה גן עד'))
  })
})

describe('script detection', () => {
  it('recognises Hebrew', () => {
    expect(containsHebrew('שופרסל')).toBe(true)
    expect(containsHebrew('AMAZON.COM')).toBe(false)
    expect(containsHebrew('9876')).toBe(false)
  })

  it('recognises letters in any script', () => {
    expect(containsLetter('רגילה')).toBe(true)
    expect(containsLetter('Amount')).toBe(true)
    expect(containsLetter('02-07-2026')).toBe(false)
    expect(containsLetter('₪')).toBe(false)
    expect(containsLetter('9876')).toBe(false)
  })
})

describe('firstGrapheme', () => {
  it('takes one emoji, not one code unit', () => {
    expect(firstGrapheme('🏠')).toBe('🏠')
    expect(firstGrapheme('🏠🛒')).toBe('🏠')
  })

  it('keeps a multi-code-point emoji whole', () => {
    // A flag is two regional indicators, and a ZWJ sequence is five code
    // points; cutting either in half renders as a box rather than as less.
    expect(firstGrapheme('🇮🇱')).toBe('🇮🇱')
    expect(firstGrapheme('👩‍👩‍👧')).toBe('👩‍👩‍👧')
    expect(firstGrapheme('🇮🇱🏠')).toBe('🇮🇱')
  })

  it('handles the ordinary cases', () => {
    expect(firstGrapheme('')).toBe('')
    expect(firstGrapheme('abc')).toBe('a')
    expect(firstGrapheme('שלום')).toBe('ש')
  })
})

describe('the words a sentence is made of (M45 U3)', () => {
  it('folds case and spacing but keeps trailing digits', () => {
    expect(foldText('  Paypal   Store 344 ')).toBe('PAYPAL STORE 344')
  })

  it('capitalizes the first letter only', () => {
    expect(capitalize('rows of a format')).toBe('Rows of a format')
    expect(capitalize('')).toBe('')
  })

  it('lists words with commas and a last "and"', () => {
    expect(listed([])).toBe('')
    expect(listed([], 'nothing')).toBe('nothing')
    expect(listed(['cash'])).toBe('cash')
    expect(listed(['a goal', 'cash'])).toBe('a goal and cash')
    expect(listed(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('groups thousands', () => {
    expect(groupThousands('999')).toBe('999')
    expect(groupThousands('1234567')).toBe('1,234,567')
  })

  it('agrees a noun with its count', () => {
    expect(plural(1, 'row')).toBe('1 row')
    expect(plural(3, 'row')).toBe('3 rows')
    expect(plural(2, 'category', 'categories')).toBe('2 categories')
    expect(plural(1200, 'row')).toBe('1200 rows')
    expect(plural(1200, 'row', undefined, (n) => groupThousands(String(n)))).toBe('1,200 rows')
  })
})

describe('parseFigureText — the amount reader the importer and the engine share (M45 F1)', () => {
  const symbols = /[₪$%]/g
  it('reads separators, parentheses and either minus, after stripping what it is told', () => {
    expect(parseFigureText('₪1,234.56', symbols)).toBe(1234.56)
    expect(parseFigureText('(1,234.56)', symbols)).toBe(-1234.56)
    expect(parseFigureText('1,234.56-', symbols)).toBe(-1234.56)
    expect(parseFigureText('-12 %', symbols)).toBe(-12)
    expect(parseFigureText('1 234', symbols)).toBe(1234)
  })

  it('refuses what is not a figure, and what it was not told to strip', () => {
    expect(parseFigureText('', symbols)).toBeUndefined()
    expect(parseFigureText('12a', symbols)).toBeUndefined()
    expect(parseFigureText('€12', symbols)).toBeUndefined()
  })
})
