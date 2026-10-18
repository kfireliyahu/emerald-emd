/**
 * A formula while it is being typed (M29 F5, D-346): where its names are, what
 * the word under the cursor could become, and which names a draft offers.
 */

import { describe, expect, it } from 'vitest'

import { newColumn, type FormatDraft } from './draft.ts'
import { column } from './declaration.ts'
import { completed, completionAt, formulaNames, formulaPieces, type FormulaName } from './formula.ts'

const names = (pieces: ReturnType<typeof formulaPieces>, kind: string): string[] =>
  pieces.filter((each) => each.kind === kind).map((each) => each.text)

describe('the pieces of a formula', () => {
  it('finds the names, the words and the unit, and covers every character once', () => {
    const text = 'hours = (end - start) in min + 2x * ingredient.kcal via ingredient.density'
    const pieces = formulaPieces(text)
    expect(names(pieces, 'NAME')).toEqual(['hours', 'end', 'start', 'x', 'ingredient.kcal', 'ingredient.density'])
    expect(names(pieces, 'WORD')).toEqual(['in', 'via'])
    expect(names(pieces, 'UNIT')).toEqual(['min'])
    expect(pieces.map((each) => each.text).join('')).toBe(text)
    for (const [at, each] of pieces.entries()) {
      expect(text.slice(each.start, each.end)).toBe(each.text)
      if (at > 0) expect(each.start).toBe(pieces[at - 1]?.end)
    }
  })

  it('never fails on a line the grammar would refuse', () => {
    expect(names(formulaPieces('end - st'), 'NAME')).toEqual(['end', 'st'])
    expect(names(formulaPieces('a.b.c = 1 =='), 'NAME')).toEqual(['a.b', 'c'])
    expect(names(formulaPieces('Hours ='), 'NAME')).toEqual(['ours'])
    expect(formulaPieces('')).toEqual([])
  })

  it('reads a unit after in, even one no name could be', () => {
    expect(names(formulaPieces('weight in µg'), 'UNIT')).toEqual(['µg'])
    expect(names(formulaPieces('weight in  °c'), 'UNIT')).toEqual(['°c'])
  })
})

describe('what the word under the cursor could become', () => {
  const offered: FormulaName[] = [
    { name: 'start', says: 'time' },
    { name: 'end', says: 'time' },
    { name: 'shift_end', says: 'time' },
    { name: 'hours', says: 'real' },
  ]

  it('offers the names a word begins, then the ones it is a later part of', () => {
    const at = completionAt('hours = en', 10, offered)
    expect(at?.options.map((each) => each.name)).toEqual(['end', 'shift_end'])
    expect(at).toMatchObject({ from: 8, to: 10 })
  })

  it('offers nothing for an empty word, a whole name, or a unit', () => {
    expect(completionAt('hours = ', 8, offered)).toBeUndefined()
    expect(completionAt('hours = start', 13, offered)).toBeUndefined()
    expect(completionAt('(end - start) in h', 18, offered)).toBeUndefined()
    expect(completionAt('hours = zz', 10, offered)).toBeUndefined()
  })

  it('replaces the whole word the cursor is in, and puts the cursor after it', () => {
    const at = completionAt('end - st + 1', 7, offered)
    expect(at).toMatchObject({ from: 6, to: 8 })
    expect(completed('end - st + 1', at!, 'start')).toEqual({ text: 'end - start + 1', caret: 11 })
  })
})

describe('the names a draft offers', () => {
  const draft = (columns: FormatDraft['columns']): Pick<FormatDraft, 'name' | 'columns' | 'aggregates'> => ({
    name: 'shift',
    columns,
    aggregates: [],
  })
  const col = (name: string, type: FormatDraft['columns'][number]['type'], target = ''): FormatDraft['columns'][number] => ({
    ...newColumn(),
    name,
    type,
    target,
  })

  it('is its figures and its times, one hop out, and not its text', () => {
    const offered = formulaNames(
      draft([col('note', 'text'), col('start', 'time'), col('end', 'time'), col('hours', 'real'), col('site', 'link', 'site')]),
      [{ name: 'site', columns: [column('label', 'text'), column('rate', 'money')] }],
    )
    expect(offered).toEqual([
      { name: 'start', says: 'time' },
      { name: 'end', says: 'time' },
      { name: 'hours', says: 'real' },
      { name: 'site.rate', says: 'money of site' },
    ])
  })
})
