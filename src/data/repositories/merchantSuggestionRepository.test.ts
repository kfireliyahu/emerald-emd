import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  SUGGESTIONS_KEPT,
  clearMerchantSuggestions,
  merchantSuggestionMap,
  noteMerchantSuggestions,
} from './merchantSuggestionRepository.ts'

/** Every note, newest first, through the reader the listings use. */
const listMerchantSuggestions = (db: Database) =>
  [...merchantSuggestionMap(db).values()].sort((a, b) => b.at - a.at)
import { writeSetting } from './settingsRepository.ts'

let db: Database

beforeEach(async () => {
  db = await createLedgerDatabase()
})

describe('noting what was suggested', () => {
  it('is empty in a document nobody has been asked about', () => {
    expect(listMerchantSuggestions(db)).toEqual([])
  })

  it('remembers the category, the status, the note and when', () => {
    noteMerchantSuggestions(
      db,
      [{ merchantNormalized: 'רמי לוי', categoryId: 'cat-groceries', status: 'DECLINED', note: 'they said it is work expenses' }],
      1_700_000_000_000,
    )

    expect(listMerchantSuggestions(db)).toEqual([
      {
        merchantNormalized: 'רמי לוי',
        categoryId: 'cat-groceries',
        status: 'DECLINED',
        note: 'they said it is work expenses',
        at: 1_700_000_000_000,
      },
    ])
  })

  it('replaces the note about a merchant rather than keeping two', () => {
    // Two answers about one merchant would be a coin toss at read time (D-069).
    noteMerchantSuggestions(db, [{ merchantNormalized: 'X', categoryId: 'a', status: 'SUGGESTED' }], 1)
    noteMerchantSuggestions(db, [{ merchantNormalized: 'X', categoryId: 'b', status: 'DECLINED' }], 2)

    const all = listMerchantSuggestions(db)
    expect(all).toHaveLength(1)
    expect(all[0]?.categoryId).toBe('b')
    expect(all[0]?.status).toBe('DECLINED')
  })

  it('drops the category when nobody could suggest one', () => {
    // "No suggestion" is a valid answer (F11), and it is not "suggested nothing
    // in particular" — a category tagging along would read as one next time.
    noteMerchantSuggestions(
      db,
      [{ merchantNormalized: 'X', categoryId: 'a', status: 'NO_SUGGESTION' }],
      1,
    )

    expect(listMerchantSuggestions(db)[0]?.categoryId).toBeUndefined()
  })

  it('keeps only the newest notes once the memo is full', () => {
    const many = Array.from({ length: SUGGESTIONS_KEPT + 10 }, (_, index) => ({
      merchantNormalized: `merchant-${index}`,
      status: 'NO_SUGGESTION' as const,
    }))
    noteMerchantSuggestions(db, [{ merchantNormalized: 'ancient', status: 'NO_SUGGESTION' }], 1)
    noteMerchantSuggestions(db, many, 2)

    const all = listMerchantSuggestions(db)
    expect(all).toHaveLength(SUGGESTIONS_KEPT)
    expect(all.some((note) => note.merchantNormalized === 'ancient')).toBe(false)
  })

  it('is keyed on the merchant, which is how a listing joins to it', () => {
    noteMerchantSuggestions(db, [{ merchantNormalized: 'שופרסל', status: 'NO_SUGGESTION' }], 1)

    expect(merchantSuggestionMap(db).get('שופרסל')?.status).toBe('NO_SUGGESTION')
    expect(merchantSuggestionMap(db).get('somebody else')).toBeUndefined()
  })
})

describe('forgetting', () => {
  it('clears the merchants that were categorized, and leaves the rest', () => {
    noteMerchantSuggestions(
      db,
      [
        { merchantNormalized: 'A', categoryId: 'x', status: 'SUGGESTED' },
        { merchantNormalized: 'B', status: 'NO_SUGGESTION' },
      ],
      1,
    )

    expect(clearMerchantSuggestions(db, ['A', 'never noted'], 2)).toBe(1)
    expect(listMerchantSuggestions(db).map((note) => note.merchantNormalized)).toEqual(['B'])
  })

  it('does not write when there is nothing to clear', () => {
    expect(clearMerchantSuggestions(db, [], 2)).toBe(0)
    expect(clearMerchantSuggestions(db, ['nobody'], 2)).toBe(0)
  })
})

describe('a document somebody edited by hand', () => {
  it('reads a mangled memo as no notes rather than throwing', () => {
    writeSetting(db, 'assistant.merchantSuggestions', 'not json at all', 1)
    expect(listMerchantSuggestions(db)).toEqual([])
  })

  it('skips the entries it cannot make sense of and keeps the ones it can', () => {
    writeSetting(
      db,
      'assistant.merchantSuggestions',
      JSON.stringify({
        merchants: {
          good: { c: 'cat-1', s: 'SUGGESTED', at: 5 },
          'bad status': { c: 'cat-1', s: 'MAYBE', at: 5 },
          'suggested nothing': { s: 'SUGGESTED', at: 5 },
          'not an object': 7,
        },
      }),
      1,
    )

    expect(listMerchantSuggestions(db).map((note) => note.merchantNormalized)).toEqual(['good'])
  })
})
