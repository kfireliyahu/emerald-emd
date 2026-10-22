/**
 * **A dashboard makes the view or chart it needs in place** — M53 F2, D-525.
 *
 * The done-test on the synthetic task format: *Due today* and *Done by month*
 * made from the dashboard's *Add a block*, each in one step — a saved view and
 * its block, a rollup declared on the format and its chart's block — and the
 * view then in the rail like any other (the rail lists `savedViews`).
 */

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { runRollup } from '@/data/repositories/formatRollupRepository.ts'
import { insertRows } from '@/data/repositories/formatRowRepository.ts'
import { dashboardBlocks, savedViews } from '@/data/repositories/formatViewRepository.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { rollupText } from '@/domain/format/rollup.ts'

import { canonicalAddress, filterAddress } from './addressFilter.ts'
import { blockGone } from './dashboard.ts'
import { chartPlan, chartWhere, makeChart, makeView, rollupName, viewRefusal, type ViewMade } from './madeInPlace.ts'

const NOW = Date.UTC(2026, 9, 22)

const TASK: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [
    column('title', 'text', { required: true }),
    column('due', 'date'),
    column('state', 'enum', { values: ['open', 'done'] }),
    column('done_on', 'date'),
    column('estimate', 'integer', { unit: 'h' }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function withTasks() {
  const db = await createDatabase()
  expect(adoptFormat(db, TASK, NOW).refusals).toEqual([])
  insertRows(db, TASK, [
    { title: 'Call the bank', due: '2026-10-22', state: 'open', estimate: 1 },
    { title: 'File the receipts', due: '2026-10-30', state: 'open', estimate: 2 },
    { title: 'Renew the lease', due: '2026-09-01', state: 'done', done_on: '2026-09-03', estimate: 3 },
    { title: 'Book the dentist', due: '2026-10-01', state: 'done', done_on: '2026-10-02', estimate: 1 },
  ])
  return db
}

const DUE_TODAY: ViewMade = {
  dashboard: 'task',
  format: 'task',
  kind: 'list',
  name: 'Due today',
  address: canonicalAddress(filterAddress({ match: { due: 'today' } }, { order: { column: 'due', descending: false } })),
}

describe('New view, in Add a block (M53 F2)', () => {
  it('saves the view and places its block in one step, and the rail lists it', async () => {
    const db = await withTasks()
    expect(viewRefusal(db, TASK, [], DUE_TODAY)).toBeUndefined()
    makeView(db, [], DUE_TODAY)

    // The rail lists a format's saved views — this one among them.
    expect(savedViews(db, 'task')).toEqual([{ format: 'task', name: 'Due today', kind: 'list', address: DUE_TODAY.address }])
    const blocks = dashboardBlocks(db, 'task')
    expect(blocks).toEqual([{ dashboard: 'task', format: 'task', kind: 'saved', name: 'Due today', address: '' }])
    expect(blockGone(db, blocks[0]!, listFormats(db))).toBeUndefined()
  })

  it('places it after the blocks already there, on the document’s dashboard too', async () => {
    const db = await withTasks()
    makeView(db, [], { ...DUE_TODAY, dashboard: undefined, kind: 'table', name: 'Open', address: '?state=open' })
    makeView(db, dashboardBlocks(db, undefined), { ...DUE_TODAY, dashboard: undefined })
    expect(dashboardBlocks(db, undefined).map((each) => each.name)).toEqual(['Open', 'Due today'])
  })

  it('refuses a name already taken, and writes nothing', async () => {
    const db = await withTasks()
    makeView(db, [], DUE_TODAY)
    const blocks = dashboardBlocks(db, 'task')
    expect(viewRefusal(db, TASK, blocks, { ...DUE_TODAY, kind: 'table' })).toMatch(/saved view called Due today already/)
    expect(viewRefusal(db, TASK, blocks, { ...DUE_TODAY, name: 'Table' })).toMatch(/view’s own name/)
    expect(savedViews(db, 'task')).toHaveLength(1)
  })
})

describe('New chart, in Add a block (M53 F2)', () => {
  const DONE_BY_MONTH = {
    dashboard: 'task',
    format: 'task',
    sum: undefined,
    period: 'done_on',
    by: undefined,
    filter: { match: { state: 'done' } },
    name: 'Done by month',
  }

  it('declares the rollup on its format and places its chart in one step', async () => {
    const db = await withTasks()
    const plan = chartPlan(db, listFormats(db), [], DONE_BY_MONTH)
    if (!plan.ok) throw new Error(plan.error)
    makeChart(db, [], plan.value)

    const task = listFormats(db).find((each) => each.name === 'task')!
    const rollup = (task.rollups ?? []).find((each) => each.name === 'done_by_month')!
    expect(rollupText(rollup)).toBe('count by month of done_on where state is done')
    expect(dashboardBlocks(db, 'task')).toEqual([{ dashboard: 'task', format: 'task', kind: 'rollup', name: 'done_by_month', address: '' }])
    const result = runRollup(db, task, 'done_by_month', listFormats(db), { today: '2026-10-22' })
    expect(result?.groups.map((each) => [each.period, each.rows])).toEqual([
      ['2026-09', 1],
      ['2026-10', 1],
    ])
  })

  it('sums a number column, and refuses what a rollup would refuse, writing nothing', async () => {
    const db = await withTasks()
    const summed = chartPlan(db, listFormats(db), [], { ...DONE_BY_MONTH, sum: 'estimate', period: 'due', filter: {}, name: 'Hours by month' })
    expect(summed.ok && rollupText(summed.value.rollup)).toBe('sum of estimate by month of due')

    const searched = chartPlan(db, listFormats(db), [], { ...DONE_BY_MONTH, filter: { search: 'bank' } })
    expect(searched.ok ? '' : searched.error).toMatch(/does not search/)
    const dated = chartPlan(db, listFormats(db), [], { ...DONE_BY_MONTH, filter: { match: { title: 'Call the bank' } } })
    expect(dated.ok ? '' : dated.error).toMatch(/title is a text/)
    const unnamed = chartPlan(db, listFormats(db), [], { ...DONE_BY_MONTH, name: '' })
    expect(unnamed.ok).toBe(false)
    expect(listFormats(db).find((each) => each.name === 'task')?.rollups ?? []).toEqual([])
    expect(dashboardBlocks(db, 'task')).toEqual([])
  })

  it('says a filter in a rollup’s words, and names it as a rollup is named', () => {
    expect(chartWhere({ match: { state: { not: ['open', 'done'] }, due: 'within 14 days' } })).toEqual({
      ok: true,
      value: 'state is not one of open, done and due is within 14 days',
    })
    expect(chartWhere({ match: { state: null } })).toEqual({ ok: true, value: 'state is empty' })
    expect(chartWhere({ match: { state: [null, 'open'] } }).ok).toBe(false)
    expect(rollupName('Done by month')).toBe('done_by_month')
    expect(rollupName('  Hours (est.) ')).toBe('hours_est')
  })
})
