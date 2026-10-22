/**
 * **The list** — M53 U4, D-519: its settings, its groups, its tick and quick
 * add, on the synthetic task format of U1's mockup — and the same list set by
 * `arrange_views`, drawn by `show_format view:list`, and added to as
 * `record_format_rows` adds (parity, D-227).
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { setListSetting, viewSettings } from '@/data/repositories/formatViewRepository.ts'
import {
  dueBucket,
  dueText,
  inDueOrder,
  listGroups,
  listOf,
  readListSetting,
  tickValue,
  tickWords,
  writeListSetting,
} from '@/domain/format/view.ts'
import { declareFormatTool, formatsTool, recordFormatRowsTool } from '@/plugin/tools/formats.ts'
import { showFormatTool } from '@/plugin/tools/sheet.ts'
import { storeDocumentAsTool } from '@/plugin/tools/storeAs.ts'
import { NO_CLIENT } from '@/plugin/tools/tool.ts'
import { arrangeViewsTool } from '@/plugin/tools/views.ts'
import { tempDir } from '@/testing/tempDir'

import { filterImplies, groupKeyOf, listOrder, listPicture, quickAdd } from './listView.ts'

const TODAY = '2026-10-22'
const STATES = ['inbox', 'next', 'doing', 'waiting', 'done']
const TASK = [
  { name: 'title', type: 'text', required: true },
  { name: 'state', type: 'enum', values: STATES, required: true },
  { name: 'due', type: 'date' },
  { name: 'priority', type: 'enum', values: ['low', 'normal', 'high', 'urgent'] },
  { name: 'project', type: 'link', target: 'project' },
  { name: 'notes', type: 'text' },
  { name: 'tags', type: 'enums', values: ['call', 'email', 'errand', 'deep_work', 'review'] },
  { name: 'estimate_h', type: 'real' },
  { name: 'started', type: 'date' },
]

describe('a list’s words (M53 U4)', () => {
  it('reads a column’s words together, done last, and writes them back the same', () => {
    expect(readListSetting('group line')).toEqual({ group: true, line: true })
    expect(readListSetting('line done done dropped')).toEqual({ group: false, line: true, done: ['done', 'dropped'] })
    expect(readListSetting('done')).toBeUndefined()
    expect(readListSetting('lanes')).toBeUndefined()
    expect(writeListSetting({ group: true, line: false, done: ['done'] })).toBe('group done done')
    expect(writeListSetting({ group: false, line: false })).toBeUndefined()
  })

  it('draws no tick where nobody said what done is — enums or not (M53 F1, D-524) — and tags, project, due as the line', () => {
    const shape = listOf(TASK, new Map())
    expect(shape.name?.name).toBe('title')
    expect(shape.group).toBeUndefined()
    expect(shape.done).toBeUndefined()
    expect(shape.lines.map((each) => each.name)).toEqual(['tags', 'project', 'due'])
    expect(shape.due?.name).toBe('due')
    expect(listOf([{ name: 'title', type: 'text' }, { name: 'flag', type: 'boolean' }], new Map()).done).toBeUndefined()
    // Said, it ticks that column — and the line leaves it off.
    const said = listOf(TASK, new Map([['state', 'done done']]))
    expect(said.done).toMatchObject({ members: ['done'] })
    expect(said.done?.column.name).toBe('state')
  })

  it('ticks a finding’s state to done, never its kind, and the undo puts back the state it held', () => {
    const finding = [
      { name: 'title', type: 'text' },
      { name: 'kind', type: 'enum', values: ['dead', 'duplicated', 'retired', 'bad'] },
      { name: 'state', type: 'enum', values: ['open', 'done', 'kept'] },
    ] as const
    expect(listOf(finding, new Map()).done).toBeUndefined()
    const done = listOf(finding, new Map([['state', 'done done']])).done
    if (done === undefined) throw new Error('no tick')
    expect(done.column.name).toBe('state')
    expect(tickValue(done, true)).toBe('done')
    expect(tickValue(done, false, 'kept')).toBe('kept')
    expect(tickWords(done, 'kept')).toEqual({ header: 'Ticking marks state done', mark: 'Mark done', undo: 'Undo: back to kept' })
  })

  it('says what a tick sets, on the header and the circle, and what an untick puts back', () => {
    const done = listOf(TASK, new Map([['state', 'done done']])).done
    if (done === undefined) throw new Error('no tick')
    expect(tickWords(done)).toEqual({ header: 'Ticking marks state done', mark: 'Mark done', undo: 'Undo: back to inbox' })
    expect(tickWords(done, 'waiting').undo).toBe('Undo: back to waiting')
    expect(tickWords({ column: { name: 'is_paid', type: 'boolean' }, members: ['true'] })).toEqual({
      header: 'Ticking marks is paid yes',
      mark: 'Mark is paid yes',
      undo: 'Undo: back to is paid no',
    })
  })

  it('leaves the column it is grouped by off the line, and a word its column cannot hold out', () => {
    const shape = listOf(TASK, new Map([['project', 'group line'], ['notes', 'group'], ['priority', 'done urgent nope']]))
    expect(shape.group?.name).toBe('project')
    expect(shape.lines.map((each) => each.name)).toEqual(['project'])
    expect(shape.shown).toEqual([])
    expect(shape.done?.column.name).toBe('priority')
    expect(shape.done?.members).toEqual(['urgent'])
  })
})

describe('a list’s groups and dues (M53 U4)', () => {
  const rows = [
    { title: 'a', state: 'next', due: '2026-10-20' },
    { title: 'b', state: 'done', due: '2026-10-22' },
    { title: 'c', state: 'inbox', due: '2026-10-23' },
    { title: 'd', state: 'waiting', due: '2026-10-25' },
    { title: 'e', state: 'next', due: '2026-11-05' },
    { title: 'f', state: 'next' },
  ]
  const valueOf = (row: (typeof rows)[number], column: { name: string }): string | undefined =>
    (row as Record<string, string | undefined>)[column.name]

  it('groups by the state with done last, and by a date in buckets', () => {
    const byState = listGroups(listOf(TASK, new Map([['state', 'group done done']])), rows, valueOf, TODAY)
    expect(byState.map((each) => each.name)).toEqual(['inbox', 'next', 'doing', 'waiting', 'done'])
    expect(byState.at(-1)).toMatchObject({ ticked: true, implies: { state: 'done' } })
    const byDue = listGroups(listOf(TASK, new Map([['due', 'group']])), rows, valueOf, TODAY)
    expect(byDue.map((each) => [each.name, each.rows.map((row) => row.title).join('')])).toEqual([
      ['Late', 'a'],
      ['Today', 'b'],
      ['Tomorrow', 'c'],
      ['In the next 7 days', 'd'],
      ['Later', 'e'],
      ['No due date', 'f'],
    ])
    expect(byDue.map((each) => each.implies)).toEqual([undefined, { due: TODAY }, { due: '2026-10-23' }, undefined, undefined, {}])
  })

  it('groups by a link in its rows’ order, then No …', () => {
    const groups = listGroups(
      listOf(TASK, new Map([['project', 'group']])),
      [{ title: 'x', project: 'p2' }, { title: 'y' }],
      (row, column) => (row as Record<string, string | undefined>)[column.name],
      TODAY,
      [
        { id: 'p1', name: 'Garden shed' },
        { id: 'p2', name: 'Move flat' },
      ],
    )
    expect(groups.map((each) => [each.name, each.rows.length])).toEqual([
      ['Garden shed', 0],
      ['Move flat', 1],
      ['No project', 1],
    ])
  })

  it('says a due as the mockup does', () => {
    expect(dueText('2026-10-22', TODAY, false)).toEqual({ text: 'today', late: false })
    expect(dueText('2026-10-23', TODAY, false)?.text).toBe('tomorrow')
    expect(dueText('2026-10-24', TODAY, false)?.text).toBe('Sat, in 2 days')
    expect(dueText('2026-11-05', TODAY, false)?.text).toBe('5 Nov')
    expect(dueText('2026-10-21', TODAY, false)).toEqual({ text: 'yesterday', late: true })
    expect(dueText('2026-10-19', TODAY, false)).toEqual({ text: '3 days late', late: true })
    expect(dueText('2026-10-19', TODAY, true)).toEqual({ text: '19 Oct', late: false })
    expect(dueText('2027-01-05', TODAY, false)?.text).toBe('5 Jan 2027')
    expect(dueBucket(undefined, TODAY)).toBe('none')
    expect(inDueOrder(rows, (row) => row.due).map((row) => row.title).join('')).toBe('abcdef')
  })

  it('ticks to the first done member, and an untick goes back to what it held', () => {
    const done = listOf(TASK, new Map([['state', 'done done']])).done
    if (done === undefined) throw new Error('no tick')
    expect(tickValue(done, true)).toBe('done')
    expect(tickValue(done, false, 'waiting')).toBe('waiting')
    expect(tickValue(done, false)).toBe('inbox')
    expect(tickValue({ column: { name: 'flag', type: 'boolean' }, members: ['true'] }, false)).toBe('false')
  })
})

/** A document with three projects and the mockup's tasks, today being 2026-10-22. */
async function tasks(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-list-'), 'tasks.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const project = { format: 'project', title: 'Project', columns: [{ name: 'name', type: 'text', required: true }], nothing_must_hold: true }
  const task = { format: 'task', title: 'Task', columns: TASK, nothing_must_hold: true }
  expect(await declareFormatTool.run({ path, formats: [project, task], commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  const projects = ['Garden shed', 'Quarterly report', 'Move flat'].map((name) => ({ name }))
  await recordFormatRowsTool.run({ path, format: 'project', rows: projects, commit: true }, NO_CLIENT)
  const rows = [
    { title: 'Order timber for the shed floor', state: 'next', due: '2026-10-22', project: 'Garden shed', tags: ['errand'] },
    { title: 'Call the council about the permit', state: 'waiting', due: '2026-10-21', project: 'Garden shed', tags: ['call'] },
    { title: 'Clear the corner for the base', state: 'done', project: 'Garden shed' },
    { title: 'Draft section 2 of the report', state: 'doing', due: '2026-10-24', project: 'Quarterly report' },
    { title: 'Book the van', state: 'done', project: 'Move flat' },
    { title: 'Pick paint colour', state: 'inbox' },
  ]
  expect(await recordFormatRowsTool.run({ path, format: 'task', rows, commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  return path
}

async function read(path: string) {
  return openDatabase(new Uint8Array(await readFile(path)))
}

describe('the task list, in the app and in a conversation (M53 U4, D-519)', () => {
  it('is grouped by project in the projects’ order, each group’s ticked rows at its foot', async () => {
    const path = await tasks()
    const set = await arrangeViewsTool.run(
      { path, settings: [{ format: 'task', view: 'list', column: 'project', setting: 'group' }], commit: true },
      NO_CLIENT,
    )
    // Nobody said what done is yet: no tick, here or in the conversation (D-524).
    expect(set).toContain('task’s list is grouped by `project`, with no tick')
    const plain = await read(path)
    const untouched = listFormats(plain).find((each) => each.name === 'task')
    if (untouched === undefined) throw new Error('no task')
    const lines = listPicture(plain, untouched, listFormats(plain), {}, viewSettings(plain, 'task', 'list'), TODAY)
    expect(lines.shape.done).toBeUndefined()
    expect(lines.groups.flatMap((each) => each.rows).some((line) => line.ticked)).toBe(false)
    plain.close()
    const ticks = await arrangeViewsTool.run(
      { path, settings: [{ format: 'task', view: 'list', column: 'state', setting: 'done done' }], commit: true },
      NO_CLIENT,
    )
    expect(ticks).toContain('task’s list is grouped by `project`, ticked when `state` is done')
    const db = await read(path)
    const declarations = listFormats(db)
    const task = declarations.find((each) => each.name === 'task')
    if (task === undefined) throw new Error('no task')
    const picture = listPicture(db, task, declarations, {}, viewSettings(db, 'task', 'list'), TODAY)
    expect(picture.groups.map((each) => [each.name, each.rows.length])).toEqual([
      ['Garden shed', 3],
      ['Move flat', 1],
      ['Quarterly report', 1],
      ['No project', 1],
    ])
    const shed = picture.groups[0]
    expect(shed?.rows.map((line) => [line.title, line.ticked])).toEqual([
      ['Call the council about the permit', false],
      ['Order timber for the shed floor', false],
      ['Clear the corner for the base', true],
    ])
    // Late reads late, in the one colour on the line; the project is left off it.
    expect(shed?.rows[0]?.cells).toEqual([
      { kind: 'chips', column: 'tags', members: ['call'] },
      { kind: 'date', column: 'due', text: 'yesterday', late: true, long: 'Wed 21 Oct 2026' },
    ])
    expect(listOrder(picture).at(-1)?.title).toBe('Pick paint colour')

    // Drawn by show_format, the same groups.
    const shown = await showFormatTool.run({ path, format: 'task', view: 'list' }, NO_CLIENT)
    expect(shown).toContain('task as its list — 6 rows, grouped by project.')
    expect(shown).toContain('- Garden shed (3): Call the council about the permit, Order timber for the shed floor, Clear the corner for the base (done)')
    db.close()
  })

  it('adds a row in place with the group’s value and a required enum’s first member — record_format_rows’ batch', async () => {
    const path = await tasks()
    await arrangeViewsTool.run(
      { path, settings: [{ format: 'task', view: 'list', column: 'project', setting: 'group' }], commit: true },
      NO_CLIENT,
    )
    const db = await read(path)
    const declarations = listFormats(db)
    const task = declarations.find((each) => each.name === 'task')
    if (task === undefined) throw new Error('no task')
    const picture = listPicture(db, task, declarations, {}, viewSettings(db, 'task', 'list'), TODAY)
    const shed = picture.groups.find((each) => each.name === 'Garden shed')
    const asked = quickAdd(task, picture.shape, shed?.implies ?? {}, {}, TODAY, picture.names)
    expect(asked.placeholder).toBe('Add a task · inbox, Garden shed')
    expect(asked.missing).toEqual([])
    // Under a 'due today' filter, the day too.
    const today = quickAdd(task, picture.shape, shed?.implies ?? {}, { match: { due: 'today' } }, TODAY, picture.names)
    expect(today.placeholder).toBe('Add a task · inbox, due today, Garden shed')
    expect(filterImplies(task, { match: { state: 'NEXT', priority: ['high', 'low'] } }, TODAY)).toEqual({ state: 'next' })
    db.close()

    const written = await recordFormatRowsTool.run(
      { path, format: 'task', rows: [{ ...withoutEmpty(today.draft), title: 'Measure the doorway' }], commit: true },
      NO_CLIENT,
    )
    expect(written).not.toMatch(/refus/i)
    const after = await read(path)
    const stored = listRows(after, task, { search: 'Measure the doorway' })
    expect(stored).toHaveLength(1)
    expect(stored[0]?.cells['state']).toBe('inbox')
    expect(stored[0]?.cells['due']).toBe(TODAY)
    const again = listPicture(after, task, listFormats(after), {}, viewSettings(after, 'task', 'list'), TODAY)
    expect(again.groups.find((each) => each.name === 'Garden shed')?.rows.map((line) => line.title)).toContain('Measure the doorway')
    // A new entry's draft is drawn in the group it will land in.
    expect(groupKeyOf(again.shape, shed?.implies?.['project'], TODAY)).toBe(shed?.key)
    after.close()
  })

  it('takes group and done off the column that held them, keeping its line, on screen and in a call', async () => {
    const path = await tasks()
    await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'task', view: 'list', column: 'project', setting: 'group line' },
          { format: 'task', view: 'list', column: 'due', setting: 'line' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    const moved = await arrangeViewsTool.run(
      { path, settings: [{ format: 'task', view: 'list', column: 'state', setting: 'group done done' }], commit: true },
      NO_CLIENT,
    )
    expect(moved).toContain('| task | list | project | setting | group line | line |')
    const db = await read(path)
    expect([...viewSettings(db, 'task', 'list')]).toEqual([
      ['due', 'line'],
      ['project', 'line'],
      ['state', 'group done done'],
    ])
    setListSetting(db, 'task', 'due', 'group line')
    expect(viewSettings(db, 'task', 'list').get('state')).toBe('done done')
    db.close()

    const refused = await arrangeViewsTool.run(
      { path, settings: [{ format: 'task', view: 'list', column: 'notes', setting: 'group' }] },
      NO_CLIENT,
    )
    expect(refused).toContain('A list groups by an enum, one link or a date; `notes` is text.')
    const strange = await arrangeViewsTool.run(
      { path, settings: [{ format: 'task', view: 'list', column: 'state', setting: 'done finished' }] },
      NO_CLIENT,
    )
    expect(strange).toContain('`state` has no finished')
  })

  it('keeps its settings in a text document', async () => {
    const path = await tasks()
    await arrangeViewsTool.run(
      { path, settings: [{ format: 'task', view: 'list', column: 'project', setting: 'group line' }], commit: true },
      NO_CLIENT,
    )
    await storeDocumentAsTool.run({ path, as: 'text', commit: true }, NO_CLIENT)
    expect(await readFile(path, 'utf8')).toContain('group line')
    const shown = await formatsTool.run({ path, format: 'task' }, NO_CLIENT)
    expect(shown).toContain('**List:** task’s list is grouped by `project`')
  })
})

/** A draft's non-empty values, as a call would send them. */
function withoutEmpty(draft: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== ''))
}
