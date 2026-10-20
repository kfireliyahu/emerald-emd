/**
 * **An agenda** — M49 U3, D-473's done-test: a synthetic planner of three
 * dated formats (assignments, exams, study blocks) and one with no date draws
 * one agenda that agrees with `format_rows`' due-within answers for each, with
 * the clock pinned; its date and what finished is are set from a conversation;
 * and `start_here` asks what is due within 7 days once a date was chosen.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { agendaData } from '@/data/repositories/formatLinkViewRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'

import { declareFormatTool, formatRowsTool, recordFormatRowsTool } from './formats.ts'
import { showFormatTool } from './sheet.ts'
import { startHereTool } from './startHere.ts'
import { NO_CLIENT } from './tool.ts'
import { arrangeViewsTool } from './views.ts'
import { tempDir } from '../../testing/tempDir'

const FORMATS = [
  {
    format: 'assignment',
    title: 'Assignment',
    columns: [
      { name: 'name', type: 'text', required: true },
      { name: 'due', type: 'date' },
      { name: 'state', type: 'enum', values: ['todo', 'doing', 'handed_in'] },
    ],
    nothing_must_hold: true,
  },
  {
    format: 'exam',
    title: 'Exam',
    columns: [
      { name: 'course', type: 'text', required: true },
      { name: 'on', type: 'date' },
    ],
    nothing_must_hold: true,
  },
  {
    format: 'study_block',
    title: 'Study block',
    columns: [
      { name: 'topic', type: 'text', required: true },
      { name: 'planned_on', type: 'date' },
      { name: 'day', type: 'date' },
    ],
    nothing_must_hold: true,
  },
  {
    format: 'course',
    title: 'Course',
    columns: [{ name: 'title', type: 'text', required: true }],
    nothing_must_hold: true,
  },
]

const ROWS: Record<string, readonly Record<string, unknown>[]> = {
  assignment: [
    { name: 'Essay', due: '2026-10-10', state: 'todo' },
    { name: 'Reading notes', due: '2026-10-12', state: 'handed_in' },
    { name: 'Lab report', due: '2026-10-14', state: 'doing' },
    { name: 'Quiz prep', due: '2026-10-20', state: 'todo' },
    { name: 'Project', due: '2026-10-28', state: 'todo' },
    { name: 'Thesis', due: '2026-11-30', state: 'todo' },
  ],
  exam: [
    { course: 'Algebra midterm', on: '2026-10-16' },
    { course: 'Physics final', on: '2026-12-20' },
    { course: 'Old quiz', on: '2026-10-01' },
  ],
  study_block: [
    // Planned a week ago, for tomorrow and the day after: the day is the date that matters.
    { topic: 'Algebra review', planned_on: '2026-10-07', day: '2026-10-15' },
    { topic: 'Lab write-up', planned_on: '2026-10-07', day: '2026-10-21' },
  ],
  course: [{ title: 'Algebra' }],
}

function pin(day: string): void {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  vi.setSystemTime(new Date(year, month - 1, date, 9, 30))
}

async function planner(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-agenda-'), 'planner.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  expect(await declareFormatTool.run({ path, formats: FORMATS, commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  for (const [format, rows] of Object.entries(ROWS)) {
    expect(await recordFormatRowsTool.run({ path, format, rows, commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  }
  return path
}

/** `show_format view:agenda`'s rows of one format, as `- format · name · state` lines name them. */
function onAgenda(text: string, format: string): readonly string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith(`- ${format} · `))
    .map((line) => line.slice(`- ${format} · `.length).split(' · ')[0] ?? '')
}

/** The names a `format_rows` table answer lists, first column. */
function tableNames(text: string): readonly string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Id') && !line.startsWith('| ---'))
    .map((line) => line.split('|')[2]?.trim() ?? '')
}

describe('the agenda (M49 U3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    pin('2026-10-14')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('agrees with format_rows’ due-within answer for each dated format', async () => {
    const path = await planner()
    // The study block is on the agenda by its day, not by when it was planned.
    expect(
      await arrangeViewsTool.run({ path, settings: [{ format: 'study_block', view: 'agenda', column: 'day', setting: 'date' }], commit: true }, NO_CLIENT),
    ).not.toContain('refused')
    const agenda = await showFormatTool.run({ path, view: 'agenda', match: { date: 'within 14 days' } }, NO_CLIENT)
    for (const [format, date, name] of [
      ['assignment', 'due', 'name'],
      ['exam', 'on', 'course'],
      ['study_block', 'day', 'topic'],
    ] as const) {
      const rows = await formatRowsTool.run({ path, format, match: { [date]: 'within 14 days' }, order: date, columns: [name] }, NO_CLIENT)
      expect(onAgenda(agenda, format), format).toEqual(tableNames(rows))
      expect(onAgenda(agenda, format).length, format).toBeGreaterThan(0)
    }
    expect(onAgenda(agenda, 'course')).toEqual([])
    expect(agenda).toContain('assignment by due, exam by on, study_block by day')
    // Days in order, today marked.
    expect(agenda.indexOf('Wed 14 Oct 2026 — today')).toBeGreaterThan(-1)
    expect(agenda.indexOf('Wed 14 Oct 2026 — today')).toBeLessThan(agenda.indexOf('Thu 15 Oct 2026'))
    expect(agenda).toContain('`format_rows study_block match:{day:within 14 days} order:day`')

    // The screen's reading is the same function, on the app's day.
    const db = await openDatabase(readFileSync(path))
    const data = agendaData(db, listFormats(db), '2026-10-14', { match: { date: 'within 14 days' } })
    expect(data.days.flatMap((day) => day.rows.map((line) => String(line.row.cells['name'] ?? line.row.cells['course'] ?? line.row.cells['topic'])))).toEqual([
      'Lab report',
      'Algebra review',
      'Algebra midterm',
      'Quiz prep',
      'Lab write-up',
      'Project',
    ])
    db.close()
  })

  it('draws nothing before today until a format says what finished is, then what is still owed', async () => {
    const path = await planner()
    const before = await showFormatTool.run({ path, view: 'agenda' }, NO_CLIENT)
    expect(before).not.toContain('Overdue')
    expect(onAgenda(before, 'exam')).toEqual(['Algebra midterm', 'Physics final'])
    // By its first date until told otherwise: planned a week ago, so nothing ahead.
    expect(onAgenda(before, 'study_block')).toEqual([])

    const dry = await arrangeViewsTool.run(
      { path, settings: [{ format: 'assignment', view: 'agenda', column: 'state', setting: 'done handed_in' }] },
      NO_CLIENT,
    )
    expect(dry).toContain('assignment is on the agenda by `due`; overdue is before today with `state` not handed_in.')
    await arrangeViewsTool.run(
      { path, settings: [{ format: 'assignment', view: 'agenda', column: 'state', setting: 'done handed_in' }], commit: true },
      NO_CLIENT,
    )
    const after = await showFormatTool.run({ path, view: 'agenda' }, NO_CLIENT)
    expect(after).toContain('Overdue (1):\n- Sat 10 Oct 2026 · assignment · Essay · todo')
    expect(after).not.toContain('Reading notes')
    // A window from today on has no overdue in it.
    expect(await showFormatTool.run({ path, view: 'agenda', match: { date: 'within 7 days' } }, NO_CLIENT)).not.toContain('Overdue')
    // The overdue window alone.
    const late = await showFormatTool.run({ path, view: 'agenda', match: { date: 'before today' } }, NO_CLIENT)
    expect(late).toContain('Essay')
    expect(late).not.toContain('Lab report')
  })

  it('leaves off a format a filter cannot hold, and says so', async () => {
    const path = await planner()
    const held = await showFormatTool.run({ path, view: 'agenda', match: { state: 'todo' } }, NO_CLIENT)
    expect(onAgenda(held, 'assignment')).toEqual(['Quiz prep', 'Project', 'Thesis'])
    expect(onAgenda(held, 'exam')).toEqual([])
    expect(held).toContain('Left off: exam has no column state.')
  })

  it('refuses a word the agenda would skip', async () => {
    const path = await planner()
    const refused = await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'exam', view: 'agenda', column: 'course', setting: 'date' },
          { format: 'assignment', view: 'agenda', column: 'state', setting: 'done finished' },
        ],
      },
      NO_CLIENT,
    )
    expect(refused).toContain('`date` goes on a date column; `course` is text.')
    expect(refused).toContain('`state` has no finished; its members are todo, doing, handed_in.')
  })

  it('reads a done that names a member called done, spaced or with commas (M42 F11)', async () => {
    const db = await createDatabase()
    const path = join(await tempDir('emerald-agenda-'), 'chores.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    const chore = {
      format: 'chore',
      title: 'Chore',
      columns: [
        { name: 'name', type: 'text', required: true },
        { name: 'due', type: 'date' },
        { name: 'state', type: 'enum', values: ['open', 'in_progress', 'done', 'dropped'] },
      ],
      nothing_must_hold: true,
    }
    await declareFormatTool.run({ path, formats: [chore], commit: true }, NO_CLIENT)
    await recordFormatRowsTool.run(
      {
        path,
        format: 'chore',
        rows: [
          { name: 'Sweep', due: '2026-10-10', state: 'done' },
          { name: 'Mop', due: '2026-10-11', state: 'dropped' },
          { name: 'Dust', due: '2026-10-12', state: 'open' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    const done = (setting: string) =>
      arrangeViewsTool.run({ path, settings: [{ format: 'chore', view: 'agenda', column: 'state', setting }] }, NO_CLIENT)
    for (const setting of ['done done', 'done done dropped', 'done dropped done', 'done done, dropped', 'done dropped, done']) {
      const dry = await done(setting)
      expect(dry, setting).not.toContain('refused')
      expect(dry, setting).not.toContain('a agenda')
    }
    // Kept the way it reads back, commas or not.
    expect(await done('done done, dropped')).toContain('| chore | agenda | state | setting | - | done done dropped |')
    expect(await done('done done dropped')).toContain('overdue is before today with `state` not done or dropped.')

    // A member the column has not got says which, not what the setting is.
    const wrong = await done('done DONE, DROPPED')
    expect(wrong).toContain('`state` has no DONE, DROPPED; its members are open, in_progress, done, dropped.')
    expect(await done('finished')).toContain('is not an agenda setting; an agenda keeps date, done <members>, line.')

    await arrangeViewsTool.run(
      { path, settings: [{ format: 'chore', view: 'agenda', column: 'state', setting: 'done done, dropped' }], commit: true },
      NO_CLIENT,
    )
    const after = await showFormatTool.run({ path, view: 'agenda' }, NO_CLIENT)
    expect(after).toContain('Overdue (1):\n- Mon 12 Oct 2026 · chore · Dust · open')
    expect(after).not.toContain('Sweep')
    expect(after).not.toContain('Mop')
  })

  it('has start_here ask what is due within 7 days once a format chose its date', async () => {
    const path = await planner()
    expect(await startHereTool.run({ path }, NO_CLIENT)).not.toContain('Due within 7 days')
    await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'assignment', view: 'agenda', column: 'due', setting: 'date' },
          { format: 'assignment', view: 'agenda', column: 'state', setting: 'done handed_in' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    const start = await startHereTool.run({ path }, NO_CLIENT)
    expect(start).toContain('### Due within 7 days — assignment by due')
    expect(start).toContain('- overdue Sat 10 Oct 2026 · assignment · Essay · todo')
    expect(start).toContain('- Wed 14 Oct 2026 (today) · assignment · Lab report · doing')
    expect(start).toContain('- Tue 20 Oct 2026 · assignment · Quiz prep · todo')
    expect(start).not.toContain('Project')
    expect(start).not.toContain('Algebra midterm')
    expect(start).toContain('Whole agenda: `show_format view:agenda`.')
  })

  it('says so when nothing has a date', async () => {
    const db = await createDatabase()
    const path = join(await tempDir('emerald-agenda-'), 'undated.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    await declareFormatTool.run({ path, formats: [FORMATS[3]], commit: true }, NO_CLIENT)
    expect(await showFormatTool.run({ path, view: 'agenda' }, NO_CLIENT)).toContain('The agenda is empty: no format here has a date column.')
    await expect(showFormatTool.run({ path, view: 'table' }, NO_CLIENT)).rejects.toThrow(/format/)
  })
})
