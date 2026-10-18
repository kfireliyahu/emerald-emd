import { describe, expect, it } from 'vitest'

import { COLUMN_TYPES } from './declaration.ts'
import { TYPE_WORDS, typeBriefing, wordsForTypes } from './vocabulary.ts'

/**
 * **A tenth type has to arrive with its words** — M20 U3.
 *
 * The hand-written enumeration this replaced named seven of the nine types and
 * had never heard of `link`, which is the whole failure mode: a vocabulary kept
 * in prose goes stale silently, and a tool description is the only documentation
 * a model gets. `Record<ColumnType, …>` makes the compiler catch a missing row;
 * these catch an empty one.
 */
describe('the words for a type', () => {
  it('has a row for every type and no row for anything else', () => {
    expect(Object.keys(TYPE_WORDS).sort()).toEqual([...COLUMN_TYPES].sort())
  })

  it('says something about each of them, and names a column you could declare', () => {
    for (const type of COLUMN_TYPES) {
      const words = TYPE_WORDS[type]
      expect(words.gloss.trim(), type).not.toBe('')
      // A sentence, because it is read beside eight others and a fragment reads
      // as a label rather than as an explanation.
      expect(words.gloss.trim().endsWith('.'), `${type}: ${words.gloss}`).toBe(true)
      expect(words.like, type).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('names the three that surprise somebody who picked them', () => {
    // Two compile to two columns and one is a relation rather than a value.
    // Those are the three a person otherwise finds out about afterwards.
    const surprising = COLUMN_TYPES.filter((type) => TYPE_WORDS[type].catch !== undefined)
    expect([...surprising].sort()).toEqual([
      'decimal',
      'elsewhere',
      'enum',
      'enums',
      'file',
      'instant',
      'link',
      'links',
      'money',
      'percent',
      'quantity',
      'time',
    ])
  })

  it('enumerates every type for a sentence that has to name them all', () => {
    const listed = wordsForTypes()
    for (const type of COLUMN_TYPES) expect(listed).toContain(`\`${type}\``)
  })

  it('briefs a model on every type, catches included', () => {
    const briefing = typeBriefing()
    for (const type of COLUMN_TYPES) {
      expect(briefing, type).toContain(TYPE_WORDS[type].gloss)
      const surprise = TYPE_WORDS[type].catch
      if (surprise !== undefined) expect(briefing, type).toContain(surprise)
    }
  })
})
