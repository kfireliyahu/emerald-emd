import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { stageRows } from '@/data/repositories/formatBatchRepository.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { applyFoundLink, planFoundLink } from '@/data/repositories/formatRuleRepository.ts'
import { insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'

import {
  applyRulesTool,
  connectFormatsTool,
  extendFormatTool,
  recordFormatRowsTool,
  updateFormatRowsTool,
} from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * **A link found by a date, from a conversation and from a screen** (M29 F8,
 * D-350). A real case, synthetic: days worked, slips by month, and every
 * day linked to the slip of its month — stored, so the slip's total folds them.
 */

const NOW = Date.UTC(2026, 9, 4)

function format(name: string, title: string, columns: FormatDeclaration['columns']): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name,
    title,
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
}

const PAYCHECK = format('paycheck', 'Paycheck', [column('label', 'text', { unique: true }), column('period', 'month')])
const WORK_DAY = format('work_day', 'Work day', [
  column('date', 'date'),
  column('hours', 'real'),
  column('paycheck', 'link', { target: 'paycheck' }),
])

async function document(): Promise<string> {
  const db = await createDatabase()
  for (const each of [PAYCHECK, WORK_DAY]) expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  insertRows(db, PAYCHECK, [
    { label: 'September', period: '2026-09' },
    { label: 'October', period: '2026-10' },
    { label: 'November', period: '2026-11' },
    { label: 'November bonus', period: '2026-11' },
  ])
  const directory = await tempDir('emerald-found-by-')
  const path = join(directory, 'days.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

async function connected(): Promise<string> {
  const path = await document()
  const dry = await connectFormatsTool.run(
    { path, format: 'work_day', target: 'paycheck', column: 'paycheck', found_by: 'date in period' },
    NO_CLIENT,
  )
  expect(dry).toContain('found by date in period')
  await connectFormatsTool.run(
    { path, format: 'work_day', target: 'paycheck', column: 'paycheck', found_by: 'date in period', commit: true },
    NO_CLIENT,
  )
  return path
}

async function slipOf(path: string): Promise<Map<string, string>> {
  const db = await openDatabase(readFileSync(path))
  const formats = listFormats(db)
  const day = formats.find((each) => each.name === 'work_day')
  const slip = formats.find((each) => each.name === 'paycheck')
  if (day === undefined || slip === undefined) throw new Error('formats missing')
  const labels = new Map(listRows(db, slip).map((row) => [row.id, String(row.cells['label'])]))
  const found = new Map(
    listRows(db, day).map((row) => [String(row.cells['date']), labels.get(String(row.cells['paycheck'])) ?? '']),
  )
  db.close()
  return found
}

describe('a link found by a date', () => {
  it('is added to a link already there, and stored with the declaration', async () => {
    const path = await connected()
    const db = await openDatabase(readFileSync(path))
    const day = listFormats(db).find((each) => each.name === 'work_day')
    expect(day?.columns.find((each) => each.name === 'paycheck')?.foundBy).toEqual({
      from: 'date',
      in: 'period',
      grain: 'MONTH',
    })
    expect(day?.language).toBe(DECLARATION_LANGUAGE)
    db.close()
  })

  it('links days in two months to the two slips', async () => {
    const path = await connected()
    const answer = await recordFormatRowsTool.run(
      {
        path,
        format: 'work_day',
        rows: [
          { date: '2026-09-14', hours: 8 },
          { date: '2026-09-30', hours: 6 },
          { date: '2026-10-01', hours: 7 },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).not.toContain('refused')
    const found = await slipOf(path)
    expect(found.get('2026-09-14')).toBe('September')
    expect(found.get('2026-09-30')).toBe('September')
    expect(found.get('2026-10-01')).toBe('October')
  })

  it('refuses a day with no slip and a day with two, by name, and writes neither', async () => {
    const path = await connected()
    const answer = await recordFormatRowsTool.run(
      {
        path,
        format: 'work_day',
        rows: [
          { date: '2026-12-02', hours: 8 },
          { date: '2026-11-03', hours: 8 },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('no Paycheck has period 2026-12')
    expect(answer).toContain('"November", "November bonus"')
    expect((await slipOf(path)).size).toBe(0)
  })

  it('keeps a link a person set, on a write and on an edit', async () => {
    const path = await connected()
    await recordFormatRowsTool.run(
      { path, format: 'work_day', rows: [{ date: '2026-09-14', hours: 8, paycheck: 'October' }], commit: true },
      NO_CLIENT,
    )
    expect((await slipOf(path)).get('2026-09-14')).toBe('October')
    await updateFormatRowsTool.run(
      { path, format: 'work_day', edits: [{ where: { date: '2026-09-14' }, values: { hours: 9 } }], commit: true },
      NO_CLIENT,
    )
    expect((await slipOf(path)).get('2026-09-14')).toBe('October')
  })

  it('fills an empty link when an edit touches the row', async () => {
    const path = await document()
    await recordFormatRowsTool.run(
      { path, format: 'work_day', rows: [{ date: '2026-10-08', hours: 5 }], commit: true },
      NO_CLIENT,
    )
    expect((await slipOf(path)).get('2026-10-08')).toBe('')
    await connectFormatsTool.run(
      { path, format: 'work_day', target: 'paycheck', column: 'paycheck', found_by: 'date in period', commit: true },
      NO_CLIENT,
    )
    await updateFormatRowsTool.run(
      { path, format: 'work_day', edits: [{ where: { date: '2026-10-08' }, values: { hours: 6 } }], commit: true },
      NO_CLIENT,
    )
    expect((await slipOf(path)).get('2026-10-08')).toBe('October')
  })

  it('is declared on a new link column through extend_format, and refused when it does not read', async () => {
    const path = await document()
    const refused = await extendFormatTool.run(
      {
        path,
        format: 'work_day',
        columns: [{ name: 'slip', type: 'link', target: 'paycheck', found_by: 'date at period' }],
      },
      NO_CLIENT,
    )
    expect(refused).toContain('is not how a link is found')
    await extendFormatTool.run(
      {
        path,
        format: 'work_day',
        columns: [{ name: 'slip', type: 'link', target: 'paycheck', found_by: 'date in period' }],
        commit: true,
      },
      NO_CLIENT,
    )
    const db = await openDatabase(readFileSync(path))
    const day = listFormats(db).find((each) => each.name === 'work_day')
    if (day === undefined) throw new Error('work_day missing')
    // The screen's paste and Add go through the same batch.
    const batch = stageRows(db, day, [{ date: '2026-09-02' }])
    expect(batch.refusals).toEqual([])
    const september = listRows(db, PAYCHECK).find((row) => row.cells['label'] === 'September')?.id
    expect(batch.accepted[0]?.cells['slip']).toBe(september)
    db.close()
  })
})

/**
 * **Applied to the rows already there** (M29 F11, D-353). Days entered before
 * the rule was set stay empty until asked: the dry run says who gets a slip and
 * who cannot, and the commit writes only the ones it can place.
 */
describe('a found-by rule applied to the rows already there', () => {
  /** Days entered with no rule — one hand-linked — and then the rule set. */
  async function entered(): Promise<string> {
    const path = await document()
    await recordFormatRowsTool.run(
      {
        path,
        format: 'work_day',
        rows: [
          { date: '2026-09-14', hours: 8 },
          { date: '2026-09-30', hours: 6 },
          { date: '2026-10-01', hours: 7 },
          { date: '2026-12-02', hours: 8 },
          { date: '2026-11-03', hours: 8 },
          { date: '2026-10-20', hours: 4, paycheck: 'September' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    await connectFormatsTool.run(
      { path, format: 'work_day', target: 'paycheck', column: 'paycheck', found_by: 'date in period', commit: true },
      NO_CLIENT,
    )
    return path
  }

  it('dry-runs first and writes nothing', async () => {
    const path = await entered()
    const dry = await applyRulesTool.run({ path, format: 'work_day', link: 'paycheck' }, NO_CLIENT)
    expect(dry).toContain('5 rows have it empty: 3 rows would get a paycheck, and 2 rows cannot be placed')
    expect(dry).toContain('no Paycheck has period in 2026-12')
    expect(dry).toContain('"November", "November bonus"')
    expect(dry).toContain('Nothing has been written')
    const found = await slipOf(path)
    expect(found.get('2026-09-14')).toBe('')
    expect(found.get('2026-10-01')).toBe('')
  })

  it('links days in two months to their two slips, names the two it cannot place, and keeps a hand-set link', async () => {
    const path = await entered()
    const done = await applyRulesTool.run({ path, format: 'work_day', link: 'paycheck', commit: true }, NO_CLIENT)
    expect(done).toContain('3 rows got a paycheck')
    const found = await slipOf(path)
    expect(found.get('2026-09-14')).toBe('September')
    expect(found.get('2026-09-30')).toBe('September')
    expect(found.get('2026-10-01')).toBe('October')
    // No slip for December, two for November: both left empty.
    expect(found.get('2026-12-02')).toBe('')
    expect(found.get('2026-11-03')).toBe('')
    // Set by hand to the wrong month on purpose, and still untouched.
    expect(found.get('2026-10-20')).toBe('September')
    // Asked again, there is nothing left it can place, and it says so without inviting a commit.
    const again = await applyRulesTool.run({ path, format: 'work_day', link: 'paycheck' }, NO_CLIENT)
    expect(again).toContain('Nothing to write')
    expect(again).not.toContain('commit: true')
  })

  it('refuses a link that is not found by a date, and a rule set named beside a link', async () => {
    const path = await document()
    expect(await applyRulesTool.run({ path, format: 'work_day', link: 'paycheck' }, NO_CLIENT)).toContain(
      'is not found by a date',
    )
    expect(await applyRulesTool.run({ path, format: 'work_day', link: 'hours' }, NO_CLIENT)).toContain(
      'is not found by a date',
    )
    expect(
      await applyRulesTool.run({ path, format: 'work_day', link: 'paycheck', rule_set: 'x' }, NO_CLIENT),
    ).toContain('not both')
  })

  it('is the same plan on the screen’s side: what it names, it places, and nothing else', async () => {
    const path = await entered()
    const db = await openDatabase(readFileSync(path))
    const day = listFormats(db).find((each) => each.name === 'work_day')
    if (day === undefined) throw new Error('work_day missing')
    const plan = planFoundLink(db, day, 'paycheck')
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.rows).toBe(6)
    expect(plan.empty).toBe(5)
    expect(plan.placements.map((each) => each.date).sort()).toEqual(['2026-09-14', '2026-09-30', '2026-10-01'])
    expect(plan.unplaced.map((each) => each.kind).sort()).toEqual(['MANY', 'NONE'])
    const many = plan.unplaced.find((each) => each.kind === 'MANY')
    expect(many?.kind === 'MANY' ? many.names : []).toEqual(['November', 'November bonus'])
    // Nothing written by asking.
    expect(listRows(db, day).filter((row) => row.cells['paycheck'] !== null).length).toBe(1)
    applyFoundLink(db, day, 'paycheck')
    expect(listRows(db, day).filter((row) => row.cells['paycheck'] !== null).length).toBe(4)
    db.close()
  })
})
