import { describe, expect, it } from 'vitest'

import { agendaDays, agendaOf, isViewSetting, meetWindows, readAgendaDone, soleWordOf } from './view.ts'

const COLUMNS = [
  { name: 'name', type: 'text' },
  { name: 'assigned', type: 'date' },
  { name: 'due', type: 'date' },
  { name: 'state', type: 'enum', values: ['todo', 'doing', 'handed_in', 'dropped'] },
  { name: 'submitted', type: 'boolean' },
  { name: 'hours', type: 'integer' },
] as const

describe('the agenda’s shape (M49 U3, D-473)', () => {
  it('is on by its first date until a date is chosen, and not at all without one', () => {
    expect(agendaOf(COLUMNS, new Map())?.date.name).toBe('assigned')
    expect(agendaOf(COLUMNS, new Map())?.chosen).toBe(false)
    const chosen = agendaOf(COLUMNS, new Map([['due', 'date']]))
    expect(chosen?.date.name).toBe('due')
    expect(chosen?.chosen).toBe(true)
    // A `date` on a column that is not one is skipped, not trusted.
    expect(agendaOf(COLUMNS, new Map([['hours', 'date']]))?.date.name).toBe('assigned')
    expect(agendaOf([{ name: 'title', type: 'text' }], new Map())).toBeUndefined()
  })

  it('reads what finished is from an enum or a boolean, keeping only members it has', () => {
    expect(agendaOf(COLUMNS, new Map([['state', 'done handed_in dropped']]))?.done?.members).toEqual(['handed_in', 'dropped'])
    expect(agendaOf(COLUMNS, new Map([['state', 'done handed_in gone']]))?.done?.members).toEqual(['handed_in'])
    expect(agendaOf(COLUMNS, new Map([['state', 'done gone']]))?.done).toBeUndefined()
    expect(agendaOf(COLUMNS, new Map([['submitted', 'done true']]))?.done?.column.name).toBe('submitted')
    expect(agendaOf(COLUMNS, new Map())?.done).toBeUndefined()
  })

  it('keeps three words, two of them one column’s at a time', () => {
    expect(isViewSetting('agenda', 'date')).toBe(true)
    expect(isViewSetting('agenda', 'line')).toBe(true)
    expect(isViewSetting('agenda', 'done handed_in')).toBe(true)
    expect(isViewSetting('agenda', 'done')).toBe(false)
    expect(isViewSetting('agenda', 'order')).toBe(false)
    // Only the first word is the keyword: a member may be called done, date or line (M42 F11).
    expect(readAgendaDone('done done dropped')).toEqual(['done', 'dropped'])
    expect(readAgendaDone('done done, dropped')).toEqual(['done', 'dropped'])
    expect(readAgendaDone('done line')).toEqual(['line'])
    expect(readAgendaDone('done ,')).toBeUndefined()
    expect(isViewSetting('agenda', 'done done')).toBe(true)
    expect(soleWordOf('agenda', 'date')).toBe('date')
    expect(soleWordOf('agenda', 'done a b')).toBe('done')
    expect(soleWordOf('agenda', 'line')).toBeUndefined()
  })

  it('groups rows into days, earliest first, leaving out a row on no day', () => {
    const rows = [
      { name: 'b', date: '2026-10-15' },
      { name: 'a', date: '2026-10-14' },
      { name: 'c', date: '2026-10-15' },
      { name: 'x', date: '' },
      { name: 'y', date: 'soon' },
    ]
    const days = agendaDays(rows, (row) => row.date || undefined, (a, b) => a.name.localeCompare(b.name))
    expect(days.map((day) => [day.date, day.rows.map((row) => row.name)])).toEqual([
      ['2026-10-14', ['a']],
      ['2026-10-15', ['b', 'c']],
    ])
  })

  it('meets two windows, or says they do not meet', () => {
    expect(meetWindows({ from: '2026-10-14' }, { from: '2026-10-14', through: '2026-10-28' })).toEqual({ from: '2026-10-14', through: '2026-10-28' })
    expect(meetWindows({ through: '2026-10-13' }, { from: '2026-10-14', through: '2026-10-28' })).toBeUndefined()
    expect(meetWindows({ through: '2026-10-13' }, {})).toEqual({ from: undefined, through: '2026-10-13' })
  })
})
