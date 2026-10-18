/**
 * **What is wrong, said without being asked** — M34 U3, D-396.
 *
 * The done-test, against `fixtures/synthetic/audit/`: assignments where one
 * names no course while the rest do, one is in twice, and one does not add up
 * — all three said after reading, unasked, and again by `format_problems`; and
 * every line of the file accounted for, the tally summing to its lines.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { identity } from '@/domain/format/identity.ts'

import { formatProblemsTool } from './audit.ts'
import { readOntoFormatTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 6)

const FIXTURE = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/synthetic/audit/${name}`, import.meta.url))

const COURSE: FormatDeclaration = {
  language: 5,
  name: 'course',
  title: 'Course',
  notes: '',
  columns: [column('name', 'text', { required: true, unique: true })],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const ASSIGNMENT: FormatDeclaration = {
  language: 5,
  name: 'assignment',
  title: 'Assignment',
  notes: '',
  columns: [
    column('title', 'text', { required: true }),
    column('course', 'link', { target: 'course' }),
    column('points', 'integer'),
    column('bonus', 'integer'),
    column('total', 'integer'),
  ],
  identities: [identity('adds_up', 'points + bonus = total')],
  aggregates: [],  nothingMustHold: false,
}

const COLUMNS = { 0: 'title', 1: 'course', 2: 'points', 3: 'bonus', 4: 'total' }

const FILES = [
  { file: FIXTURE('assignments.csv'), format: 'assignment', columns: COLUMNS },
  { file: FIXTURE('courses.csv'), format: 'course' },
]

/** The file's lines, to the last one holding anything — what the tally must sum to. */
function linesOf(name: string): number {
  return readFileSync(FIXTURE(name), 'utf8').replace(/\n+$/, '').split('\n').length
}

async function school(): Promise<string> {
  const db = await createDatabase()
  for (const declaration of [COURSE, ASSIGNMENT]) {
    expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  }
  const path = join(await tempDir('emerald-audit-'), 'school.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

function expectAllThree(answer: string): void {
  expect(answer).toContain('What looks wrong in Assignment')
  expect(answer).toContain('`course` is empty on 1 row where 6 name a course: Essay 3.')
  expect(answer).toContain('2 rows the same in every column: Problem set 2, Problem set 2.')
  // Both figures beside the row (M34 U4, D-397): 60 + 10 against 75.
  expect(answer).toContain('`adds_up` fails on 1 row: Quiz 1 (70 against 75).')
}

describe('what is wrong, said without being asked (M34 U3)', () => {
  it('says all three after a read of several files, before anything is written', async () => {
    const path = await school()
    const dry = await readOntoFormatTool.run({ path, files: FILES }, NO_CLIENT)
    expectAllThree(dry)
    expect(dry).toContain('once this is written')
    expect(dry).toContain('Nothing looks wrong in Course')
  })

  it('accounts for every line of the file, the tally summing to its lines', async () => {
    const path = await school()
    const dry = await readOntoFormatTool.run({ path, files: FILES }, NO_CLIENT)
    expect(linesOf('assignments.csv')).toBe(10)
    expect(dry).toContain('10 lines: 1 heading, 7 read, 1 refused, 1 empty.')
    expect(linesOf('courses.csv')).toBe(3)
    expect(dry).toContain('3 lines: 1 heading, 2 read, 0 refused.')
    expect(dry).not.toContain('not accounted for')
  })

  it('says them again on commit, and format_problems says them asked', async () => {
    const path = await school()
    const written = await readOntoFormatTool.run({ path, files: FILES, commit: true }, NO_CLIENT)
    expect(written).toContain('**9 rows written from 2 files**')
    expect(written).toContain('assignments.csv: 10 lines')
    expectAllThree(written)

    const asked = await formatProblemsTool.run({ path }, NO_CLIENT)
    expectAllThree(asked)
    expect(asked).toContain('Nothing looks wrong in Course')
    expect(await formatProblemsTool.run({ path, formats: ['nope'] }, NO_CLIENT)).toContain(
      'No format called `nope`',
    )
  })

  it('says them after a read of one file too', async () => {
    const path = await school()
    await readOntoFormatTool.run(
      { path, format: 'course', file: FIXTURE('courses.csv'), commit: true },
      NO_CLIENT,
    )
    const one = { path, format: 'assignment', file: FIXTURE('assignments.csv'), columns: COLUMNS }
    const dry = await readOntoFormatTool.run(one, NO_CLIENT)
    expectAllThree(dry)
    expect(dry).toContain('Every line of the file: 10 lines: 1 heading, 7 read, 1 refused, 1 empty.')
    const written = await readOntoFormatTool.run({ ...one, commit: true }, NO_CLIENT)
    expectAllThree(written)
  })
})
