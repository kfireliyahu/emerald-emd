/**
 * **A conversation sets every view a screen can** — M48 U3.
 *
 * The done-test: from a conversation alone — `declare_format`,
 * `record_format_rows`, `arrange_views` — a synthetic planner document gets a
 * start-here question that `start_here` then answers, a ready list, and a
 * roadmap `show_format` draws. Until this unit only a pack's `views.md` could
 * set them, so a document made in a conversation could not be given one.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { viewSettings } from '@/data/repositories/formatViewRepository.ts'

import { declareFormatTool, formatsTool, recordFormatRowsTool } from './formats.ts'
import { showFormatTool } from './sheet.ts'
import { startHereTool } from './startHere.ts'
import { NO_CLIENT } from './tool.ts'
import { arrangeViewsTool } from './views.ts'
import { tempDir } from '../../testing/tempDir'

async function commit(tool: typeof declareFormatTool, args: Record<string, unknown>): Promise<string> {
  return tool.run({ ...args, commit: true }, NO_CLIENT)
}

/** A term's courses and their assignments, each of which may wait on another — made by tool calls only. */
async function planner(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-planner-'), 'term.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  await commit(declareFormatTool, {
    path,
    format: 'course',
    title: 'Course',
    columns: [
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'week', type: 'integer' },
      { name: 'credits', type: 'integer' },
    ],
  })
  await commit(declareFormatTool, {
    path,
    format: 'assignment',
    title: 'Assignment',
    columns: [
      { name: 'title', type: 'text', required: true, unique: true },
      { name: 'due', type: 'date' },
      { name: 'state', type: 'enum', values: ['todo', 'doing', 'handed', 'dropped'] },
      { name: 'course', type: 'link', target: 'course' },
      { name: 'after', type: 'links', target: 'assignment' },
    ],
  })
  await commit(recordFormatRowsTool, {
    path,
    format: 'course',
    rows: [
      { name: 'Algebra', week: 2, credits: 5 },
      { name: 'Botany', week: 1, credits: 3 },
    ],
  })
  await commit(recordFormatRowsTool, {
    path,
    format: 'assignment',
    rows: [
      { title: 'Problem set 1', due: '2026-10-16', state: 'handed', course: 'Algebra' },
      { title: 'Problem set 2', due: '2026-10-23', state: 'todo', course: 'Algebra' },
      { title: 'Leaf survey', due: '2026-10-20', state: 'doing', course: 'Botany' },
    ],
  })
  await commit(recordFormatRowsTool, {
    path,
    format: 'assignment',
    rows: [
      { title: 'Problem set 3', due: '2026-10-30', state: 'todo', course: 'Algebra', after: ['Problem set 2'] },
      { title: 'Lab report', due: '2026-10-27', state: 'todo', course: 'Botany', after: ['Leaf survey', 'Problem set 1'] },
    ],
  })
  return path
}

describe('arrange_views sets roadmaps, ready lists and start-here questions (M48 U3)', () => {
  it('gives a planner made in a conversation a start-here question, a ready list and a roadmap', async () => {
    const path = await planner()
    const before = await startHereTool.run({ path }, NO_CLIENT)
    expect(before).toContain('This document declares no start-here questions.')

    const settings = [
      { format: 'assignment', view: 'start', column: 'state', setting: 'is todo' },
      { format: 'assignment', view: 'start', column: 'due', setting: 'line' },
      { format: 'assignment', view: 'ready', column: 'state', setting: 'ready todo done handed dropped' },
      { format: 'assignment', view: 'ready', column: 'after', setting: 'waits' },
      { format: 'course', view: 'roadmap', column: 'week', setting: 'order' },
      { format: 'assignment', view: 'roadmap', column: 'course', setting: 'under' },
    ]
    const dry = await arrangeViewsTool.run({ path, settings }, NO_CLIENT)
    expect(dry).toContain('**Nothing has been written.**')
    expect(dry).toContain('| assignment | start | state | setting | - | is todo |')
    // The dry run says what the views will answer once written.
    expect(dry).toContain('`start_here` asks of assignment: state is todo.')
    expect(dry).toContain('`start_here` asks of assignment: state is todo, and nothing in after is still open')
    expect(dry).toContain('course’s roadmap runs in `week`, folding assignment by `course`.')

    expect(await arrangeViewsTool.run({ path, settings, commit: true }, NO_CLIENT)).not.toContain('refused')

    const answer = await startHereTool.run({ path }, NO_CLIENT)
    expect(answer).toContain('### Ready to start — assignment')
    expect(answer).toContain('Problem set 2')
    expect(answer).toContain('Lab report — waits on Leaf survey · doing')
    expect(answer).toContain('### assignment — state is todo')
    expect(answer).toContain('Problem set 3')

    const roadmap = await showFormatTool.run({ path, format: 'course', view: 'roadmap' }, NO_CLIENT)
    // Botany's week 1 comes before Algebra's week 2, each with its assignments.
    expect(roadmap.indexOf('Botany')).toBeGreaterThan(-1)
    expect(roadmap.indexOf('Botany')).toBeLessThan(roadmap.indexOf('Algebra'))
    expect(roadmap).toContain('- Botany · assignment: 1 todo, 1 doing')

    // And `formats` reads them back beside the entry's.
    const read = await formatsTool.run({ path, format: 'assignment' }, NO_CLIENT)
    expect(read).toContain('**Ready:** `after: waits`, `state: ready todo done handed dropped`.')
    expect(read).toContain('**Start:** `due: line`, `state: is todo`.')
  })

  it('moves a word only one column may hold, and clears one with null', async () => {
    const path = await planner()
    await arrangeViewsTool.run(
      { path, settings: [{ format: 'course', view: 'roadmap', column: 'week', setting: 'order' }], commit: true },
      NO_CLIENT,
    )
    const moved = await arrangeViewsTool.run(
      { path, settings: [{ format: 'course', view: 'roadmap', column: 'credits', setting: 'order' }], commit: true },
      NO_CLIENT,
    )
    expect(moved).toContain('| course | roadmap | week | setting | order | - |')
    let db = await openDatabase(readFileSync(path))
    expect([...viewSettings(db, 'course', 'roadmap')]).toEqual([['credits', 'order']])
    db.close()

    await arrangeViewsTool.run(
      { path, settings: [{ format: 'course', view: 'roadmap', column: 'credits', setting: null }], commit: true },
      NO_CLIENT,
    )
    db = await openDatabase(readFileSync(path))
    expect(viewSettings(db, 'course', 'roadmap').size).toBe(0)
    db.close()
  })

  it('refuses a word the view would skip, naming what fits', async () => {
    const path = await planner()
    const answer = await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'course', view: 'roadmap', column: 'name', setting: 'order' },
          { format: 'assignment', view: 'ready', column: 'course', setting: 'waits' },
          { format: 'assignment', view: 'ready', column: 'state', setting: 'ready todo done finished' },
          { format: 'assignment', view: 'start', column: 'state', setting: 'is late' },
          { format: 'assignment', view: 'start', column: 'title', setting: 'latest 5' },
          { format: 'assignment', view: 'start', column: 'due', setting: 'soonest 5' },
          { format: 'assignment', view: 'start', column: 'due' },
          { format: 'assignment', view: 'ready', column: 'state', setting: 'ready todo doing done handed dropped' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('**Nothing was written.** 8 settings were refused')
    expect(answer).toContain('A roadmap runs in a number column; course has `week`, `credits`.')
    expect(answer).toContain('`waits` goes on a link into assignment’s own rows')
    expect(answer).toContain('`state` has no finished; its members are todo, doing, handed, dropped.')
    expect(answer).toContain('`is` names a member of an enum (todo, doing, handed, dropped)')
    expect(answer).toContain('`latest` counts by a date, a month, a time or a number')
    expect(answer).toContain('`soonest 5` is not a start setting; a start keeps is <member>, latest <count>, line.')
    expect(answer).toContain('A start setting takes `setting`')
    expect(answer).toContain('is longer than the 32 characters a view keeps for a column')
    const db = await openDatabase(readFileSync(path))
    expect(viewSettings(db, 'assignment', 'start').size).toBe(0)
    db.close()
  })
})
