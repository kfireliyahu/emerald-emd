/**
 * **A date's filter menu offers words around today** — M53 F6, D-528. The
 * menu lists `today`, `this week`, `before today`… above a date's ticks, each
 * with the rows it names now; choosing one writes the words, so a view saved
 * from it is the same words tomorrow and names tomorrow's rows. And the week
 * those words count is the document's: Monday until it says Sunday.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { columnValues } from '@/data/repositories/formatValuesRepository.ts'
import { saveView, savedView } from '@/data/repositories/formatViewRepository.ts'
import { setDocumentWeekStart } from '@/data/repositories/unitRepository.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { coerceRow } from '@/domain/format/row.ts'

import { addressFilter, filterAddress } from './addressFilter.ts'
import { ColumnMenu, filteredQuery } from './FilterBand.tsx'

const TASK: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [column('name', 'text', { required: true }), column('due', 'date')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

/** Thursday 2026-10-22; its Monday week is 19–25 October, its Sunday week 18–24. */
const THURSDAY = new Date(2026, 9, 22, 12)

async function tasks() {
  const db = await createDatabase()
  expect(adoptFormat(db, TASK, 100).refusals).toEqual([])
  const offered = [
    { name: 'last sunday', due: '2026-10-18' },
    { name: 'monday', due: '2026-10-19' },
    { name: 'thursday', due: '2026-10-22' },
    { name: 'sunday', due: '2026-10-25' },
    { name: 'next tuesday', due: '2026-10-27' },
    { name: 'next friday', due: '2026-10-30' },
    { name: 'undated' },
  ]
  insertRows(
    db,
    TASK,
    offered.map((each) => {
      const coerced = coerceRow(TASK, each)
      if (!coerced.ok) throw new Error(coerced.error)
      return coerced.value
    }),
  )
  return db
}

function shown(db: Awaited<ReturnType<typeof tasks>>, address: string): readonly string[] {
  const read = filteredQuery(db, TASK, addressFilter(address), [TASK])
  expect(read.refusal).toBeUndefined()
  return listRows(db, TASK, { ...read.query, order: 'due' }).map((row) => String(row.cells['name']))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('a date’s filter menu offers words around today (M53 F6, D-528)', () => {
  it('lists the words, as a conversation types them, each with the rows it names on the day asked', async () => {
    const db = await tasks()
    const read = columnValues(db, TASK, 'due', {}, [TASK], '2026-10-22')
    if (!read.ok || read.value.kind !== 'VALUES') throw new Error('due is listed')
    const words = new Map((read.value.words ?? []).map((each) => [each.value, each.count]))
    expect([...words.keys()]).toContain('before today')
    expect(words.get('today')).toBe(1)
    expect(words.get('this week')).toBe(3)
    expect(words.get('next week')).toBe(2)
    expect(words.get('before today')).toBe(2)
    expect(words.get('last 7 days')).toBe(3)
    // A text column has none; nor does a date asked with no day.
    const name = columnValues(db, TASK, 'name', {}, [TASK], '2026-10-22')
    expect(name.ok && name.value.kind === 'VALUES' ? name.value.words : 'unread').toBeUndefined()
    const dayless = columnValues(db, TASK, 'due', {}, [TASK])
    expect(dayless.ok && dayless.value.kind === 'VALUES' ? dayless.value.words : 'unread').toBeUndefined()
  })

  it('draws the words above the dates in the menu', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(THURSDAY)
    const db = await tasks()
    const markup = renderToStaticMarkup(
      createElement(ColumnMenu, {
        db,
        declaration: TASK,
        declarations: [TASK],
        column: TASK.columns[1]!,
        filter: { match: { due: 'this week' } },
        onChange: () => undefined,
        onClose: () => undefined,
      }),
    )
    expect(markup).toContain('Around today, for due')
    expect(markup.indexOf('this week')).toBeLessThan(markup.indexOf('2026-10-18'))
    // What the band holds is the chosen word.
    expect(markup).toMatch(/type="radio"[^>]*checked=""[^>]*\/><span[^>]*>this week</)
  })

  it('saves a view of the words, which holds the new week once the day moves on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(THURSDAY)
    const db = await tasks()
    // The menu writes the words into the filter, and Save view keeps the address.
    saveView(db, { format: 'task', name: 'This week', kind: 'list', address: filterAddress({ match: { due: 'this week' } }) })
    const kept = savedView(db, 'task', 'This week')?.address ?? ''
    expect(addressFilter(kept)).toEqual({ match: { due: 'this week' } })
    expect(shown(db, kept)).toEqual(['monday', 'thursday', 'sunday'])

    vi.setSystemTime(new Date(2026, 9, 29, 12))
    expect(shown(db, kept)).toEqual(['next tuesday', 'next friday'])
  })

  it('counts a week from the document’s first day: Sunday once it says so', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(THURSDAY)
    const db = await tasks()
    const address = filterAddress({ match: { due: 'this week' } })
    expect(shown(db, address)).toEqual(['monday', 'thursday', 'sunday'])
    expect(setDocumentWeekStart(db, 'Sunday')).toEqual({ weekStart: 'sunday' })
    expect(shown(db, address)).toEqual(['last sunday', 'monday', 'thursday'])
    const read = columnValues(db, TASK, 'due', {}, [TASK], '2026-10-22')
    const words = read.ok && read.value.kind === 'VALUES' ? new Map((read.value.words ?? []).map((each) => [each.value, each.count])) : undefined
    expect(words?.get('this week')).toBe(3)
    expect(words?.get('next week')).toBe(3)
  })
})
