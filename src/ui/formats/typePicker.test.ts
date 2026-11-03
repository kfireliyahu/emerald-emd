import { describe, expect, it } from 'vitest'

import { COLUMN_TYPES } from '@/domain/format/declaration.ts'
import { declarationOf, newColumn, newDraft } from '@/domain/format/draft.ts'
import { TYPE_WORDS } from '@/domain/format/vocabulary.ts'
import { chooseType } from '@/ui/formats/shape.ts'
import { COMMON_TYPES, isCommonType, MORE_TYPES } from '@/ui/formats/typePicker.ts'

describe('the type picker (M55 U8, D-539)', () => {
  it('offers the common types first, in a person’s words', () => {
    expect(COMMON_TYPES.map((each) => TYPE_WORDS[each].shown)).toEqual([
      'Text',
      'Number',
      'Money',
      'Date',
      'Yes or no',
      'Choice',
      'Link',
    ])
  })

  it('puts the rest one step away, under the four headings drafted', () => {
    expect(MORE_TYPES.map((group) => [group.heading, group.types.map((each) => TYPE_WORDS[each].shown)])).toEqual([
      ['Numbers', ['Whole number', 'Exact decimal', 'Percentage', 'Quantity']],
      ['Dates and times', ['Month', 'Time of day', 'Date and time']],
      ['Several', ['Several choices', 'Several links']],
      ['Outside this document', ['File', 'Row in another document']],
    ])
  })

  it('still reaches every type, each exactly once, and never all of them in one step', () => {
    const offered = [...COMMON_TYPES, ...MORE_TYPES.flatMap((group) => group.types)]
    expect([...offered].sort()).toEqual([...COLUMN_TYPES].sort())
    expect(COMMON_TYPES.length).toBeLessThan(COLUMN_TYPES.length / 2)
    for (const type of COLUMN_TYPES) expect(isCommonType(type)).toBe(COMMON_TYPES.includes(type))
  })

  it('gives each type a name of its own, never the stored word', () => {
    const names = COLUMN_TYPES.map((each) => TYPE_WORDS[each].shown)
    expect(new Set(names).size).toBe(names.length)
    for (const type of COLUMN_TYPES) expect(TYPE_WORDS[type].shown).not.toBe(type)
  })

  it('stores the declaration’s word, whichever name was picked', () => {
    for (const type of ['real', 'integer', 'enum', 'instant', 'elsewhere'] as const) {
      const column = { ...newColumn(), name: 'amount' }
      const draft = { ...newDraft(), title: 'Thing', name: 'thing', columns: [column] }
      const shape = chooseType({ draft, focus: { kind: 'COLUMN', key: column.key, chosen: false } }, type)
      expect(declarationOf(shape.draft).columns.find((each) => each.name === 'amount')?.type).toBe(type)
    }
  })
})
