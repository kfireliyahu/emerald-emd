/**
 * **A total over every row of a format** — M34 U4, D-397.
 *
 * The done-test, against `fixtures/synthetic/degree/`: a degree states an
 * average of 85 by hand while its courses give 84.52. The degree folds every
 * course — no course names a degree — and an identity proves the stated figure
 * against the data: the sum of grade times points over the sum of points. It
 * fails naming both figures, unasked after a read and asked by
 * `format_problems`; changing one grade moves the verdict.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'

import { formatProblemsTool } from './audit.ts'
import { declareFormatTool, extendFormatTool, formatRowsTool, updateFormatRowsTool } from './formats.ts'
import { readOntoFormatTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const FIXTURE = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/synthetic/degree/${name}`, import.meta.url))

const COURSE = {
  format: 'course',
  title: 'Course',
  columns: [
    { name: 'name', type: 'text', required: true, unique: true },
    { name: 'grade', type: 'real' },
    { name: 'points', type: 'real' },
  ],
  nothing_must_hold: true,
}

const TOTALS = [
  { name: 'weighted', of: 'sum', over_format: 'course', every: true, works_out: 'grade * points' },
  { name: 'credit', of: 'sum', over_format: 'course', every: true, works_out: 'points' },
]

const HOLDS = [
  {
    name: 'average_holds',
    expression: 'stated_average = weighted / credit',
    note: 'The average on the transcript is the courses, weighted by points.',
  },
]

const DEGREE_COLUMNS = [
  { name: 'name', type: 'text', required: true },
  { name: 'stated_average', type: 'real' },
]

async function emptyDocument(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-every-'), 'degree.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

const FILES = [
  { file: FIXTURE('courses.csv'), format: 'course' },
  { file: FIXTURE('degree.csv'), format: 'degree' },
]

/** Declared in one call, read in another — the conversation's way in. */
async function degree(): Promise<string> {
  const path = await emptyDocument()
  const declared = await declareFormatTool.run(
    {
      path,
      formats: [
        COURSE,
        {
          format: 'degree',
          title: 'Degree',
          columns: DEGREE_COLUMNS,
          aggregates: TOTALS,
          identities: HOLDS,
          // The same totals compiled to the view's SQL, so the sheet shows it.
          derived: [{ name: 'worked_average', works_out: 'weighted / credit' }],
        },
      ],
      commit: true,
    },
    NO_CLIENT,
  )
  expect(declared).not.toContain('refused')
  return path
}

describe('a total over every row of a format (M34 U4)', () => {
  it('fails the stated 85 against the 84.52 the courses give, naming both, unasked and asked', async () => {
    const path = await degree()
    const written = await readOntoFormatTool.run({ path, files: FILES, commit: true }, NO_CLIENT)
    expect(written).toContain('`average_holds` fails on 1 row: Bachelor of Science (85 against 84.52).')

    const asked = await formatProblemsTool.run({ path, formats: ['degree'] }, NO_CLIENT)
    expect(asked).toContain('`average_holds` fails on 1 row: Bachelor of Science (85 against 84.52).')

    const rows = await formatRowsTool.run({ path, format: 'degree' }, NO_CLIENT)
    expect(rows).toContain('average_holds: failed — 85 against 84.52')
    expect(rows).toContain('weighted: 4226 — the sum over every row of course, 6 rows.')
    expect(rows).toContain('credit: 50 — the sum over every row of course, 6 rows.')
    expect(rows).toMatch(/worked_average[^\n]*84\.52/)
  })

  it('moves the verdict when one grade changes', async () => {
    const path = await degree()
    await readOntoFormatTool.run({ path, files: FILES, commit: true }, NO_CLIENT)
    const db = await openDatabase(readFileSync(path))
    const course = listFormats(db).find((each) => each.name === 'course')
    const writing = course === undefined ? undefined : listRows(db, course).find((row) => row.cells['name'] === 'Writing')
    db.close()
    expect(writing).toBeDefined()

    // 85 → 91 on 4 points is 24 more over 50: the average becomes 85 exactly.
    await updateFormatRowsTool.run(
      { path, format: 'course', edits: [{ id: writing?.id, values: { grade: 91 } }], commit: true },
      NO_CLIENT,
    )
    const rows = await formatRowsTool.run({ path, format: 'degree' }, NO_CLIENT)
    expect(rows).toContain('average_holds: proved — 85 against 85')
    expect(await formatProblemsTool.run({ path, formats: ['degree'] }, NO_CLIENT)).toContain(
      'Nothing looks wrong in Degree',
    )
  })

  it('is added to a format that exists by extend_format, and a forgotten column is still refused', async () => {
    const path = await emptyDocument()
    await declareFormatTool.run(
      {
        path,
        formats: [COURSE, { format: 'degree', title: 'Degree', columns: DEGREE_COLUMNS, nothing_must_hold: true }],
        commit: true,
      },
      NO_CLIENT,
    )
    const forgot = await extendFormatTool.run(
      { path, format: 'degree', aggregates: [{ name: 'credit', of: 'sum', over_format: 'course', works_out: 'points' }] },
      NO_CLIENT,
    )
    expect(forgot).toContain('`every: true` for every row of it')

    const dry = await extendFormatTool.run({ path, format: 'degree', aggregates: TOTALS, identities: HOLDS }, NO_CLIENT)
    expect(dry).toContain('Total `weighted`: the sum of `grade * points` over `every course`')
    await extendFormatTool.run(
      { path, format: 'degree', aggregates: TOTALS, identities: HOLDS, commit: true },
      NO_CLIENT,
    )
    const written = await readOntoFormatTool.run({ path, files: FILES, commit: true }, NO_CLIENT)
    expect(written).toContain('Bachelor of Science (85 against 84.52)')
  })
})
