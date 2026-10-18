/**
 * **Four engine faults a study planner found** — M48 U1. A session moved a
 * semester's worth of rows into a document of its own and hit each of these;
 * the rows here are synthetic and only the shapes are its.
 *
 * - a batch is judged by where it ends, so moving `Current` from one semester
 *   to the next is one call, not two;
 * - an enum's new list keeps the constraints that read it, and the answer says
 *   so rather than *No longer held to*;
 * - a note's body link names a concept within the course the read is fixed to,
 *   when the concept is one row per course and name.
 */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { parseConstraint } from '@/domain/format/constraint.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { extendFormatTool, recordFormatRowsTool, updateFormatRowsTool } from './formats.ts'
import { readOntoFormatTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 14)

function constraint(rule: string): NonNullable<FormatDeclaration['constraints']>[number] {
  const parsed = parseConstraint(rule)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

function format(
  name: string,
  columns: FormatDeclaration['columns'],
  constraints: readonly string[] = [],
): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name,
    title: name[0]?.toUpperCase() + name.slice(1),
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    constraints: constraints.map(constraint),
    nothingMustHold: true,
  }
}

async function saved(
  declarations: readonly FormatDeclaration[],
  rows: readonly [FormatDeclaration, readonly Record<string, unknown>[]][],
): Promise<{ path: string; dir: string }> {
  const db = await createDatabase()
  for (const each of declarations) expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  for (const [declaration, cells] of rows) {
    const known = listFormats(db).find((each) => each.name === declaration.name) ?? declaration
    insertRows(db, known, cells as never)
  }
  const dir = await tempDir('emerald-planner-')
  const path = join(dir, 'uni.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, dir }
}

async function rowsOf(path: string, name: string): Promise<readonly { id: string; cells: Record<string, unknown> }[]> {
  const db = await openDatabase(readFileSync(path))
  const declaration = listFormats(db).find((each) => each.name === name)
  const rows = declaration === undefined ? [] : listRows(db, declaration, { limit: 50 })
  db.close()
  return rows as never
}

describe('a batch judged by where it ends (M48 U1, fault 2)', () => {
  const SEMESTER = format(
    'semester',
    [column('name', 'text', { required: true, unique: true }), column('status', 'enum', { values: ['Past', 'Current', 'Next'] })],
    ['one row per status when status is Current'],
  )

  async function semesters(): Promise<string> {
    return (
      await saved(
        [SEMESTER],
        [
          [
            SEMESTER,
            [
              { name: 'Spring', status: 'Current' },
              { name: 'Autumn', status: 'Next' },
            ],
          ],
        ],
      )
    ).path
  }

  const statuses = async (path: string): Promise<Record<string, unknown>> =>
    Object.fromEntries((await rowsOf(path, 'semester')).map((row) => [row.cells['name'], row.cells['status']]))

  it('moves Current from one semester to the next in one call, the set written before the clear', async () => {
    const path = await semesters()
    const answer = await updateFormatRowsTool.run(
      {
        path,
        format: 'semester',
        edits: [
          { where: { name: 'Autumn' }, values: { status: 'Current' } },
          { where: { name: 'Spring' }, values: { status: 'Past' } },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('2 rows of Semester changed')
    expect(await statuses(path)).toEqual({ Spring: 'Past', Autumn: 'Current' })
  })

  it('still refuses a batch that ends with two, and writes none of it', async () => {
    const path = await semesters()
    const answer = await updateFormatRowsTool.run(
      {
        path,
        format: 'semester',
        edits: [
          { where: { name: 'Autumn' }, values: { status: 'Current' } },
          { where: { name: 'Spring' }, values: { name: 'Spring term' } },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('one row per status when status is Current')
    expect(await statuses(path)).toEqual({ Spring: 'Current', Autumn: 'Next' })
  })
})

describe('an enum given a new list keeps its constraints, and says so (M48 U1, fault 3)', () => {
  const ASSIGNMENT = format(
    'assignment',
    [
      column('name', 'text', { required: true, unique: true }),
      column('status', 'enum', { values: ['Todo', 'Submitted', 'Graded'] }),
      column('grade', 'integer'),
    ],
    ['grade is required when status is Graded'],
  )

  it('does not say a constraint it keeps is no longer held, and still holds it', async () => {
    const { path } = await saved(
      [ASSIGNMENT],
      [[ASSIGNMENT, [{ name: 'Essay', status: 'Graded', grade: 88 }, { name: 'Quiz', status: 'Todo' }]]],
    )
    const change = [{ name: 'status', type: 'enum', values: ['Todo', 'Doing', 'Submitted', 'Graded'] }]
    const dry = await extendFormatTool.run({ path, format: 'assignment', change }, NO_CLIENT)
    expect(dry).not.toContain('No longer held to')
    const answer = await extendFormatTool.run({ path, format: 'assignment', change, commit: true }, NO_CLIENT)
    expect(answer).not.toContain('No longer held to')

    const refused = await recordFormatRowsTool.run(
      { path, format: 'assignment', rows: [{ name: 'Lab', status: 'Graded' }], commit: true },
      NO_CLIENT,
    )
    expect(refused).toContain('grade is required when status is Graded')

    // Adding it again is refused as what it is: a constraint the format already has.
    const again = await extendFormatTool.run(
      { path, format: 'assignment', constraints: [{ rule: 'grade is required when status is Graded' }] },
      NO_CLIENT,
    )
    expect(again).toContain('already')
  })
})

describe('a body link named within the course the read is fixed to (M48 U1, fault 4)', () => {
  const COURSE = format('course', [column('name', 'text', { required: true, unique: true })])
  const CONCEPT = format(
    'concept',
    [column('name', 'text', { required: true }), column('course', 'link', { target: 'course', required: true })],
    ['one row per course, name'],
  )
  const UNIT = format('unit', [
    column('name', 'text', { required: true, unique: true }),
    column('course', 'link', { target: 'course' }),
    column('concepts', 'links', { target: 'concept' }),
    column('body', 'text'),
  ])

  async function course(): Promise<{ path: string; folder: string; ids: Map<string, string> }> {
    const db = await createDatabase()
    for (const each of [COURSE, CONCEPT, UNIT]) expect(adoptFormat(db, each, NOW).refusals).toEqual([])
    const [algorithms, calculus] = insertRows(db, COURSE, [{ name: "Algorithms" }, { name: "Calculus" }])
    insertRows(db, CONCEPT, [
      { name: 'Recursion', course: algorithms ?? '' },
      { name: 'Graphs', course: algorithms ?? '' },
      { name: 'Recursion', course: calculus ?? '' },
      { name: 'Limits', course: calculus ?? '' },
    ])
    const ids = new Map(
      listRows(db, CONCEPT, { limit: 10 }).map((row) => [
        `${String(row.cells['course'] === algorithms ? 'Algorithms' : 'Calculus')}/${String(row.cells['name'])}`,
        row.id,
      ]),
    )
    const dir = await tempDir('emerald-planner-notes-')
    const path = join(dir, 'uni.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    const folder = join(dir, 'units')
    await mkdir(folder)
    await writeFile(join(folder, 'Unit 1.md'), 'Starts with [[Recursion]], then [[Graphs]].\n', 'utf8')
    await writeFile(join(folder, 'Unit 2.md'), 'Not this course: [[Limits]].\n', 'utf8')
    return { path, folder, ids }
  }

  it('fills the link from the concept of that course, though the name repeats across courses', async () => {
    const { path, folder, ids } = await course()
    const dry = await readOntoFormatTool.run(
      { path, format: 'unit', file: folder, fixed: { course: 'Algorithms' } },
      NO_CLIENT,
    )
    expect(dry).not.toContain('Declare name unique')
    expect(dry).toMatch(/\| body links \| concepts, split by ";" \|/)

    await readOntoFormatTool.run(
      { path, format: 'unit', file: folder, fixed: { course: 'Algorithms' }, commit: true },
      NO_CLIENT,
    )
    const units = new Map((await rowsOf(path, 'unit')).map((row) => [row.cells['name'], row.cells]))
    expect(units.get('Unit 1')?.['concepts']).toEqual([ids.get('Algorithms/Recursion'), ids.get('Algorithms/Graphs')])
    // Limits is a concept of another course only: Unit 2 is still read, and the link left out.
    expect(units.get('Unit 2')?.['concepts']).toEqual([])
    expect(dry).toMatch(/\| Unit 2\.md \| Limits \| No concept of Algorithms is called Limits/)
  })

  it('names a row by its course in a conversation too, and names the rows a name could still be', async () => {
    const { path, ids } = await course()
    const refused = await recordFormatRowsTool.run(
      { path, format: 'unit', rows: [{ name: 'Unit 3', concepts: ['Recursion'] }] },
      NO_CLIENT,
    )
    expect(refused).toContain(ids.get('Algorithms/Recursion'))
    expect(refused).toContain(ids.get('Calculus/Recursion'))

    await recordFormatRowsTool.run(
      { path, format: 'unit', rows: [{ name: 'Unit 3', course: 'Calculus', concepts: ['Recursion', 'Limits'] }], commit: true },
      NO_CLIENT,
    )
    const unit = (await rowsOf(path, 'unit')).find((row) => row.cells['name'] === 'Unit 3')
    expect(unit?.cells['concepts']).toEqual([ids.get('Calculus/Recursion'), ids.get('Calculus/Limits')])
  })
})
