/**
 * **Nested note folders, embeds left out, and rows from a .json file** — M48 U2.
 *
 * The done-test, against synthetic material written here: a folder of course
 * notes two levels deep, with a hidden settings folder, an attachments folder
 * and pasted-image embeds, read in one call with `recursive: true` — every note
 * a row, its folder a column the mapping sends somewhere, and no embed named as
 * a link that names no row; and a `rows.json` of 300 rows landing in one dry run
 * and one commit, as a `.csv` of them would.
 */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { countRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { readOntoFormatTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 14)

const COURSE: FormatDeclaration = {
  language: 5,
  name: 'course',
  title: 'Course',
  notes: '',
  columns: [
    column('name', 'text', { required: true, unique: true }),
    column('folder', 'text'),
    column('credits', 'integer'),
    column('related', 'links', { target: 'course' }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function documentWith(declaration: FormatDeclaration, prefix: string): Promise<{ dir: string; path: string }> {
  const db = await createDatabase()
  expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  const dir = await tempDir(prefix)
  const path = join(dir, 'study.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { dir, path }
}

const note = (credits: number, body: string): string => `---\ncredits: ${String(credits)}\n---\n\n${body}\n`

async function courses(dir: string): Promise<string> {
  const root = join(dir, 'Courses')
  await mkdir(join(root, 'Year 1', 'Semester A'), { recursive: true })
  await mkdir(join(root, 'Year 2', 'Semester B'), { recursive: true })
  await mkdir(join(root, '.settings'), { recursive: true })
  await mkdir(join(root, 'attachments'), { recursive: true })
  await writeFile(join(root, 'Orientation.md'), note(0, 'Where everything is.'), 'utf8')
  await writeFile(join(root, 'Year 1', 'Calculus.md'), note(6, 'Limits first.\n\n![[Pasted image 20261001.png]]'), 'utf8')
  await writeFile(
    join(root, 'Year 1', 'Semester A', 'Algebra.md'),
    note(5, 'Needs [[Calculus]].\n\n![[Pasted image 20261002.png]]\n![[Pasted image 20261003.png]]\n![[syllabus.pdf]]'),
    'utf8',
  )
  await writeFile(join(root, 'Year 1', 'Semester A', 'Physics.md'), note(4, 'Uses [[Algebra]] and [[Calculus]].'), 'utf8')
  await writeFile(join(root, 'Year 2', 'Semester B', 'Topology.md'), note(6, 'After [[Algebra]].\n\n![[board.jpg|300]]'), 'utf8')
  await writeFile(join(root, '.settings', 'Hidden.md'), note(1, 'Not a course.'), 'utf8')
  await writeFile(join(root, 'attachments', 'Pasted image 20261001.png'), 'not really a picture', 'utf8')
  return root
}

describe('read_onto_format over nested note folders (M48 U2)', () => {
  it('reads every note under the folder in one call, with its folder as a column and no embed noise', async () => {
    const { dir, path } = await documentWith(COURSE, 'emerald-courses-')
    const root = await courses(dir)

    const dry = await readOntoFormatTool.run({ path, format: 'course', file: root, recursive: true }, NO_CLIENT)
    expect(dry).toContain('**Courses/** — 5 notes, one row each')
    // The attachments folder's picture is a file not read; the hidden folder is not entered, and named.
    expect(dry).toContain('2 other files not read (.settings/, attachments/Pasted image 20261001.png)')
    // Five embeds of files that are not notes: counted once, never listed.
    expect(dry).toContain('5 body links to a file that is not a note (an image, a PDF) left out')
    expect(dry).not.toContain('Pasted image 20261002')
    expect(dry).not.toContain('syllabus.pdf')
    expect(dry).not.toMatch(/no row, and (is|are) left out/)
    expect(dry).toContain('`folder` (its path under the one read)')

    const answer = await readOntoFormatTool.run({ path, format: 'course', file: root, recursive: true, commit: true }, NO_CLIENT)
    expect(answer).toContain('5 rows written')

    const db = await openDatabase(readFileSync(path))
    const rows = listRows(db, COURSE, { limit: 10 })
    const byName = new Map(rows.map((row) => [row.cells['name'], row.cells]))
    const named = new Map(rows.map((row) => [row.id, row.cells['name']]))
    expect(byName.get('Orientation')?.['folder']).toBeNull()
    expect(byName.get('Calculus')?.['folder']).toBe('Year 1')
    expect(byName.get('Algebra')?.['folder']).toBe('Year 1/Semester A')
    expect(byName.get('Topology')?.['folder']).toBe('Year 2/Semester B')
    expect(byName.get('Algebra')?.['credits']).toBe(5)
    const related = (name: string): readonly unknown[] =>
      ((byName.get(name)?.['related'] as readonly string[] | null) ?? []).map((id) => named.get(id))
    expect(related('Algebra')).toEqual(['Calculus'])
    expect(related('Physics')).toEqual(['Algebra', 'Calculus'])
    expect(related('Topology')).toEqual(['Algebra'])
    db.close()
  })

  it('reads only the folder itself without `recursive`, and says how to read the rest', async () => {
    const { dir, path } = await documentWith(COURSE, 'emerald-courses-flat-')
    const root = await courses(dir)
    const dry = await readOntoFormatTool.run({ path, format: 'course', file: root }, NO_CLIENT)
    expect(dry).toContain('**Courses/** — 1 note, one row each; 4 other files not read (.settings/, Year 1/, Year 2/, attachments/)')
    expect(dry).not.toContain('`folder`')

    await expect(
      readOntoFormatTool.run({ path, format: 'course', file: join(root, 'Year 2') }, NO_CLIENT),
    ).rejects.toThrow(/or with `recursive: true`/)
  })
})

const ENROLMENT: FormatDeclaration = {
  language: 5,
  name: 'enrolment',
  title: 'Enrolment',
  notes: '',
  columns: [
    column('ref', 'text', { required: true, unique: true }),
    column('student', 'text', { required: true }),
    column('grade', 'integer'),
    column('passed', 'boolean'),
    column('enrolled_on', 'date'),
    column('tags', 'enums', { values: ['online', 'evening', 'lab'] }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const TAGS = [['online'], ['evening', 'lab'], [], ['lab']]

function enrolments(count: number): readonly Record<string, unknown>[] {
  return Array.from({ length: count }, (_, at) => ({
    ref: `E-${String(at + 1).padStart(4, '0')}`,
    student: `Student ${String(at + 1)}`,
    grade: 50 + (at % 50),
    passed: at % 7 !== 0,
    enrolled_on: `2026-${String((at % 12) + 1).padStart(2, '0')}-${String((at % 28) + 1).padStart(2, '0')}`,
    tags: TAGS[at % TAGS.length],
  }))
}

describe('read_onto_format with a .json file of rows (M48 U2)', () => {
  it('lands 300 rows from one array of objects in one dry run and one commit', async () => {
    const { dir, path } = await documentWith(ENROLMENT, 'emerald-json-')
    const file = join(dir, 'rows.json')
    await writeFile(file, JSON.stringify(enrolments(300), null, 2), 'utf8')

    const dry = await readOntoFormatTool.run({ path, format: 'enrolment', file }, NO_CLIENT)
    expect(dry).toContain('**rows.json** — its rows, 301 lines, header on line 1')
    expect(dry).not.toMatch(/would not be read/)
    expect(dry).toContain('**Nothing has been written.**')

    const answer = await readOntoFormatTool.run({ path, format: 'enrolment', file, commit: true }, NO_CLIENT)
    expect(answer).toContain('300 rows written')

    const db = await openDatabase(readFileSync(path))
    expect(countRows(db, ENROLMENT)).toBe(300)
    const first = listRows(db, ENROLMENT, { limit: 400 }).find((row) => row.cells['ref'] === 'E-0002')
    expect(first?.cells).toMatchObject({ student: 'Student 2', grade: 51, passed: 1, enrolled_on: '2026-02-02', tags: ['evening', 'lab'] })
    db.close()
  })

  it('reads an object holding arrays by `sheet`, and refuses a file that holds no rows', async () => {
    const { dir, path } = await documentWith(ENROLMENT, 'emerald-json-keys-')
    const file = join(dir, 'export.json')
    await writeFile(file, JSON.stringify({ exported: '2026-10-14', terms: [{ name: 'Autumn' }], enrolments: enrolments(3) }), 'utf8')

    const dry = await readOntoFormatTool.run({ path, format: 'enrolment', file, sheet: 'enrolments' }, NO_CLIENT)
    expect(dry).toContain('**export.json** — sheet `enrolments` of 2 (terms, enrolments)')
    await expect(readOntoFormatTool.run({ path, format: 'enrolment', file, sheet: 'courses' }, NO_CLIENT)).rejects.toThrow(
      /No array of rows under "courses" in export\.json\. It has: terms, enrolments\./,
    )

    const single = join(dir, 'single.json')
    await writeFile(single, '{"count": 3}', 'utf8')
    await expect(readOntoFormatTool.run({ path, format: 'enrolment', file: single }, NO_CLIENT)).rejects.toThrow(
      /single\.json is not a file of rows: no key of its object holds an array of objects/,
    )
  })
})
