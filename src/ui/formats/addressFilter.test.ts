import { describe, expect, it } from 'vitest'

import { addressFilter, addressView, filterAddress, foldFilter, withFold } from './addressFilter.ts'

describe('a format’s filter in its address (M44 U6)', () => {
  it('spells every column held and the search, and reads them back', () => {
    const filter = { match: { action: 'author', state: 'open' }, search: 'a b' }
    const said = filterAddress(filter)
    expect(said).toBe('?action=author&state=open&search=a+b')
    expect(addressFilter(said)).toEqual(filter)
  })

  it('is empty when it asks for nothing, and an empty search is no search', () => {
    expect(filterAddress({})).toBe('')
    expect(filterAddress({ search: '' })).toBe('')
    expect(addressFilter('')).toEqual({})
    expect(addressFilter('?search=')).toEqual({})
  })

  it('holds a column to several values as a comma list, and a repeated key adds to it (M37 U3)', () => {
    expect(addressFilter('?state=planned,in_progress')).toEqual({ match: { state: ['planned', 'in_progress'] } })
    expect(addressFilter('?state=planned&state=in_progress')).toEqual({ match: { state: ['planned', 'in_progress'] } })
    expect(filterAddress({ match: { state: ['planned', 'in_progress'] } })).toBe('?state=planned,in_progress')
  })

  it('turns a column round with !, and an empty value is the empty cell (M37 U3)', () => {
    const filter = { match: { state: { not: ['built', 'dropped'] }, owner: { not: '' }, course: ['dessert', ''] } }
    const said = filterAddress(filter)
    expect(said).toBe('?state!=built,dropped&owner!=&course=dessert,')
    expect(addressFilter(said)).toEqual(filter)
    expect(addressFilter('?state!=built')).toEqual({ match: { state: { not: 'built' } } })
  })

  it('quotes a value holding a comma or a quote, and reads it back whole', () => {
    const filter = { match: { author: ['Smith, Ann', 'say "hi"', 'Bo'] } }
    expect(addressFilter(filterAddress(filter))).toEqual(filter)
    expect(addressFilter(filterAddress({ match: { author: 'Smith, Ann' } }))).toEqual({ match: { author: 'Smith, Ann' } })
  })

  it('holds a column to empty, and Hebrew as typed', () => {
    expect(addressFilter(filterAddress({ match: { owner: null } }))).toEqual({ match: { owner: '' } })
    expect(addressFilter(filterAddress({ match: { שם: 'ירוק' } }))).toEqual({ match: { שם: 'ירוק' } })
  })

  it('holds a roadmap’s folded rows by format and column, and keeps a format’s chosen columns apart (M37 U5)', () => {
    const said = filterAddress(
      { match: { state: 'open' } },
      { folds: { 'unit.state': ['planned', 'in_progress'] }, columns: { unit: ['title', 'state'], decision: [] } },
    )
    expect(said).toBe('?state=open&unit.state=planned,in_progress&columns:unit=title,state&columns:decision=')
    const read = addressView(said)
    expect(read.filter).toEqual({ match: { state: 'open' } })
    expect(read.folds).toEqual({ 'unit.state': ['planned', 'in_progress'] })
    expect(read.columns).toEqual({ unit: ['title', 'state'], decision: [] })
    // The format's own filter never reads either as a column held.
    expect(addressFilter(said)).toEqual({ match: { state: 'open' } })
    // `show_format`'s match carries a fold's key as the address does.
    expect(addressView(filterAddress({ match: { 'unit.state': { not: 'built' } } })).folds).toEqual({ 'unit.state': { not: 'built' } })
  })

  it('carries the table’s sort beside the filter, and never reads it as a column held (M42 F14)', () => {
    const said = filterAddress({ match: { state: 'open' }, search: 'bidi' }, { order: { column: 'date', descending: true } })
    expect(said).toBe('?state=open&search=bidi&order:date=descending')
    const read = addressView(said)
    expect(read.filter).toEqual({ match: { state: 'open' }, search: 'bidi' })
    expect(read.order).toEqual({ column: 'date', descending: true })
    expect(addressView(filterAddress({}, { order: { column: 'title', descending: false } })).order).toEqual({
      column: 'title',
      descending: false,
    })
    // Anything but `descending` is the column's own way up; no column is no sort.
    expect(addressView('?order:title').order).toEqual({ column: 'title', descending: false })
    expect(addressView('?order:=descending').order).toBeUndefined()
    expect(addressView('?state=open').order).toBeUndefined()
    // A Hebrew column's name goes there and back as typed.
    expect(addressView(filterAddress({}, { order: { column: 'תאריך', descending: true } })).order?.column).toBe('תאריך')
  })

  it('reads one folded format’s filter, and writes it back among the others (M37 U5)', () => {
    const folds = { 'unit.state': 'planned', 'unit.scope': 'engine', 'decision.state': 'live' }
    expect(foldFilter(folds, 'unit')).toEqual({ match: { state: 'planned', scope: 'engine' } })
    expect(foldFilter(folds, 'review_entry')).toEqual({})
    expect(withFold(folds, 'unit', { match: { state: 'built' } })).toEqual({ 'decision.state': 'live', 'unit.state': 'built' })
    expect(withFold(folds, 'unit', {})).toEqual({ 'decision.state': 'live' })
  })
})
