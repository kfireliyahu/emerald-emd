/**
 * **A date moved by whole days** — M49 U1, D-471, against a synthetic review
 * list. `next_review = last_reviewed + 7 days` is shown, sorted and filtered
 * by the computed date, from a conversation and in the view's SQL alike; a
 * claim moving a date is proved, failed and unchecked; an empty date leaves
 * the computed one empty, never a date in 1970.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { derivedOf } from '@/data/repositories/formatDerivedRepository.ts'
import { filterQuery } from '@/data/repositories/formatFilterRepository.ts'
import { indexOf } from '@/data/repositories/formatJoinRepository.ts'
import type { DerivedValue } from '@/domain/format/derived.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'

import { declareFormatTool, extendFormatTool, formatRowsTool, recordFormatRowsTool } from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const REVIEW = {
  format: 'review',
  title: 'Review',
  columns: [
    { name: 'name', type: 'text', required: true },
    { name: 'last_reviewed', type: 'date' },
    { name: 'follow_up', type: 'date' },
  ],
  derived: [
    { name: 'next_review', works_out: 'last_reviewed + 7 days' },
    { name: 'reminder', works_out: 'next_review - 1 day' },
    { name: 'waited', works_out: 'follow_up - last_reviewed' },
  ],
  identities: [{ name: 'follow_up_in_a_week', expression: 'follow_up = last_reviewed + 1 week' }],
  nothing_must_hold: true,
}

const ROWS = [
  // Across a month's end, and proved.
  { name: 'Alpha', last_reviewed: '2026-01-28', follow_up: '2026-02-04' },
  // Across a leap day, and failed by a day.
  { name: 'Bravo', last_reviewed: '2024-02-25', follow_up: '2024-03-04' },
  // Nothing reviewed yet: every computed date empty, the claim unchecked.
  { name: 'Charlie', last_reviewed: null, follow_up: '2026-03-01' },
  // Across a year's end.
  { name: 'Delta', last_reviewed: '2026-12-29', follow_up: '2027-01-05' },
]

async function reviews(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-dates-'), 'reviews.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const declared = await declareFormatTool.run({ path, formats: [REVIEW], commit: true }, NO_CLIENT)
  expect(declared).not.toMatch(/refus/i)
  const written = await recordFormatRowsTool.run({ path, format: 'review', rows: ROWS, commit: true }, NO_CLIENT)
  expect(written).not.toMatch(/refus/i)
  return path
}

describe('a date moved by whole days (M49 U1)', () => {
  it('is a computed date, empty where the date it moves is', async () => {
    const path = await reviews()
    const db = await openDatabase(readFileSync(path))
    // The figures out of the SELECT the view is made of (D-334).
    const declarations = listFormats(db)
    const review = declarations.find((each) => each.name === 'review')
    if (review === undefined) throw new Error('no review')
    const rows = listRows(db, review, { order: 'name' })
    const worked = derivedOf(db, review, rows, indexOf(declarations))
    const cell = (value: DerivedValue | undefined): unknown =>
      value === undefined || value.kind === 'EMPTY' ? null : value.kind === 'DATE' ? value.date : value.kind === 'NUMBER' ? value.value : value.minor
    const found = rows.map((row) => [row.cells['name'], ...(worked.get(row.id) ?? []).map((each) => cell(each.value))])
    expect(found).toEqual([
      ['Alpha', '2026-02-04', '2026-02-03', 7],
      ['Bravo', '2024-03-03', '2024-03-02', 8],
      ['Charlie', null, null, null],
      ['Delta', '2027-01-05', '2027-01-04', 7],
    ])
    db.close()
  })

  it('is shown, sorted and filtered by the computed date from a conversation', async () => {
    const path = await reviews()
    const sorted = await formatRowsTool.run(
      { path, format: 'review', order: 'next_review', descending: true, columns: ['name', 'next_review', 'waited'] },
      NO_CLIENT,
    )
    const order = ['Delta', 'Alpha', 'Bravo', 'Charlie'].map((name) => sorted.indexOf(`| ${name} |`))
    expect(order.every((at, index) => at > 0 && (index === 0 || at > (order[index - 1] ?? 0)))).toBe(true)
    expect(sorted).toContain('| Delta | 2027-01-05 | 7 day |')
    expect(sorted).toMatch(/\| Charlie \| - \|/)

    const matched = await formatRowsTool.run(
      { path, format: 'review', match: { next_review: '2026-02-04' }, columns: ['name', 'next_review'] },
      NO_CLIENT,
    )
    expect(matched).toContain('1 row of Review')
    expect(matched).toContain('| Alpha | 2026-02-04 |')

    // A computed figure is not held to a value; a computed date is.
    await expect(
      formatRowsTool.run({ path, format: 'review', match: { waited: 7 } }, NO_CLIENT),
    ).rejects.toThrow(/only a computed date is held to a value/)
  })

  it('filters and sorts through the one reading the screen uses too', async () => {
    const path = await reviews()
    const db = await openDatabase(readFileSync(path))
    const declarations = listFormats(db)
    const review = declarations.find((each) => each.name === 'review')
    if (review === undefined) throw new Error('no review')
    const empty = filterQuery(db, review, { match: { next_review: null } }, declarations)
    if (!empty.ok) throw new Error('refused')
    expect(listRows(db, review, empty.value).map((row) => row.cells['name'])).toEqual(['Charlie'])
    const all = filterQuery(db, review, {}, declarations)
    if (!all.ok) throw new Error('refused')
    expect(listRows(db, review, { ...all.value, order: 'reminder' }).map((row) => row.cells['name'])).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
      'Delta',
    ])
    db.close()
  })

  it('proves a claim that moves a date, fails it by the days it is off, and leaves an empty one unchecked', async () => {
    const path = await reviews()
    const rows = await formatRowsTool.run({ path, format: 'review' }, NO_CLIENT)
    expect(rows).toContain('follow_up_in_a_week: proved — 2026-02-04 against 2026-02-04.')
    expect(rows).toContain('follow_up_in_a_week: failed — 2024-03-04 against 2024-03-03, off by 1 day where 0 days are allowed.')
    expect(rows).toContain('follow_up_in_a_week: unchecked — This row has nothing in last_reviewed')
  })

  it('refuses a month, a part of a day, a moved time and a date used as a figure, in words', async () => {
    const path = await reviews()
    const extend = (derived: Record<string, unknown>): Promise<string> =>
      extendFormatTool.run({ path, format: 'review', derived: [derived], commit: false }, NO_CLIENT).catch((error: unknown) => String(error))
    expect(await extend({ name: 'later', works_out: 'last_reviewed + 1 month' })).toMatch(/a month is not always as long/)
    expect(await extend({ name: 'later', works_out: 'last_reviewed + 1.5 days' })).toMatch(/whole days and weeks/)
    expect(await extend({ name: 'later', works_out: '(last_reviewed + 7 days) * 2' })).toMatch(/moving by whole days/)
  })
})
