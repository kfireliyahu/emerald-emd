/**
 * **Today in questions, never in claims** — M49 U2, D-472's done-test, against
 * a synthetic assignments list with the clock pinned: *due within 14 days* is
 * the same rows from `format_rows`, from `show_format` and through the
 * screen's own reading; `days_left = due - today` is shown and sorted by; and
 * a claim that names today is refused saying why.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { filteredQuery } from '@/ui/formats/FilterBand.tsx'

import { declareFormatTool, formatRowsTool, recordFormatRowsTool } from './formats.ts'
import { showFormatTool } from './sheet.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const ASSIGNMENT = {
  format: 'assignment',
  title: 'Assignment',
  columns: [
    { name: 'name', type: 'text', required: true },
    { name: 'due', type: 'date' },
    { name: 'hours', type: 'integer' },
  ],
  derived: [{ name: 'days_left', works_out: 'due - today' }],
  nothing_must_hold: true,
}

const ROWS = [
  { name: 'Essay', due: '2026-10-10', hours: 6 },
  { name: 'Lab report', due: '2026-10-14', hours: 3 },
  { name: 'Quiz', due: '2026-10-20', hours: 1 },
  { name: 'Project', due: '2026-10-28', hours: 20 },
  { name: 'Thesis', due: '2026-11-30', hours: 90 },
  { name: 'Reading', due: null, hours: 2 },
]

/** The clock, pinned: the calendar day here is `day`, whichever runtime asks. */
function pin(day: string): void {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  vi.setSystemTime(new Date(year, month - 1, date, 9, 30))
}

async function assignments(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-today-'), 'assignments.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const declared = await declareFormatTool.run({ path, formats: [ASSIGNMENT], commit: true }, NO_CLIENT)
  expect(declared).not.toMatch(/refus/i)
  const written = await recordFormatRowsTool.run({ path, format: 'assignment', rows: ROWS, commit: true }, NO_CLIENT)
  expect(written).not.toMatch(/refus/i)
  return path
}

/** The rows a text answer names, in the order it names them. */
function named(text: string): readonly string[] {
  return ROWS.map((row) => row.name)
    .filter((name) => text.includes(`| ${name} |`))
    .sort((a, b) => text.indexOf(`| ${a} |`) - text.indexOf(`| ${b} |`))
}

/** The rows `show_format`'s text answer lists, one `- name` a line, as it lists them. */
function listed(text: string): readonly string[] {
  return text.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2))
}

/** The rows the app's format screen shows for a filter — `filteredQuery`, the reading its address goes through. */
async function onScreen(path: string, match: Record<string, unknown>): Promise<readonly string[]> {
  const db = await openDatabase(readFileSync(path))
  const declarations = listFormats(db)
  const assignment = declarations.find((each) => each.name === 'assignment')
  if (assignment === undefined) throw new Error('no assignment')
  const { query, refusal } = filteredQuery(db, assignment, { match }, declarations)
  expect(refusal).toBeUndefined()
  const names = listRows(db, assignment, { ...query, order: 'due' }).map((row) => String(row.cells['name']))
  db.close()
  return names
}

describe('today in questions (M49 U2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    pin('2026-10-14')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers “due within 14 days” identically in format_rows, show_format and on the screen', async () => {
    const path = await assignments()
    const match = { due: 'within 14 days' }
    const rows = await formatRowsTool.run({ path, format: 'assignment', match, order: 'due', columns: ['name', 'due'] }, NO_CLIENT)
    const sheet = await showFormatTool.run({ path, format: 'assignment', match }, NO_CLIENT)
    const expected = ['Lab report', 'Quiz', 'Project']
    expect(named(rows)).toEqual(expected)
    expect(listed(sheet)).toEqual([...expected].sort())
    expect(sheet).toContain('Filtered by due is within 14 days: 3 of 6 rows.')
    expect(await onScreen(path, match)).toEqual(expected)
    expect(rows).toContain('3 rows of Assignment')
  })

  it('says overdue and later in the same words, and moves with the clock', async () => {
    const path = await assignments()
    expect(await onScreen(path, { due: 'before today' })).toEqual(['Essay'])
    expect(await onScreen(path, { due: 'after today' })).toEqual(['Quiz', 'Project', 'Thesis'])
    expect(await onScreen(path, { due: 'today' })).toEqual(['Lab report'])
    pin('2026-10-21')
    expect(await onScreen(path, { due: 'within 2 weeks' })).toEqual(['Project'])
    const overdue = await formatRowsTool.run({ path, format: 'assignment', match: { due: 'before today' }, columns: ['name'] }, NO_CLIENT)
    expect(named(overdue)).toEqual(['Essay', 'Lab report', 'Quiz'])
  })

  it('shows days left and sorts by it, worked out against the day asked', async () => {
    const path = await assignments()
    const rows = await formatRowsTool.run(
      { path, format: 'assignment', order: 'days_left', columns: ['name', 'days_left'] },
      NO_CLIENT,
    )
    expect(named(rows)).toEqual(['Reading', 'Essay', 'Lab report', 'Quiz', 'Project', 'Thesis'])
    expect(rows).toMatch(/\| Essay \| -4 day/)
    expect(rows).toMatch(/\| Quiz \| 6 day/)
    expect(rows).toMatch(/\| Reading \| - \|/)
  })

  it('holds only a date to a window, saying why', async () => {
    const path = await assignments()
    await expect(
      formatRowsTool.run({ path, format: 'assignment', match: { hours: 'within 14 days' } }, NO_CLIENT),
    ).rejects.toThrow(/hours is an integer, and a window of days is a date's/)
  })

  it('refuses a claim that names today, with the reason', async () => {
    const path = await assignments()
    const refused = await declareFormatTool
      .run(
        {
          path,
          formats: [{ ...ASSIGNMENT, format: 'deadline', title: 'Deadline', nothing_must_hold: false, identities: [{ name: 'on_time', expression: 'due - today = 0' }] }],
          commit: false,
        },
        NO_CLIENT,
      )
      .catch((error: unknown) => String(error))
    expect(refused).toMatch(/names today, and a claim may not read the clock: a proof that held yesterday must not fail tomorrow with nothing changed/)
  })
})
