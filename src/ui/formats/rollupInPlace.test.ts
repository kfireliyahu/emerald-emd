/**
 * **A chart is renamed and deleted where it is listed** — M53 F3.
 *
 * The done-test on the synthetic task format: a chart made from the
 * dashboard's *New chart* (F2) is a rollup the rail lists under its format
 * (the rail lists the declaration's rollups); deleting it there — or on its
 * tab, which writes the same — takes it and its blocks away, and renaming it
 * takes its blocks along. A block's *Remove* leaves it.
 */

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { runRollup } from '@/data/repositories/formatRollupRepository.ts'
import { insertRows } from '@/data/repositories/formatRowRepository.ts'
import { dashboardBlocks, setDashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { blockGone } from './dashboard.ts'
import { chartPlan, makeChart, makeView, type ChartMade } from './madeInPlace.ts'
import { changeRollup, rollupDeleted, rollupRenamed } from './rollupInPlace.ts'

const NOW = Date.UTC(2026, 9, 22)

const TASK: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [
    column('title', 'text', { required: true }),
    column('state', 'enum', { values: ['open', 'done'] }),
    column('done_on', 'date'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const DONE: ChartMade = {
  dashboard: undefined,
  format: 'task',
  sum: undefined,
  period: 'done_on',
  by: undefined,
  filter: { match: { state: 'done' } },
  name: 'x',
}

/** The task format with chart `x` made from the document's dashboard, and on the format's own too. */
async function withChart() {
  const db = await createDatabase()
  expect(adoptFormat(db, TASK, NOW).refusals).toEqual([])
  insertRows(db, TASK, [
    { title: 'Renew the lease', state: 'done', done_on: '2026-09-03' },
    { title: 'Book the dentist', state: 'done', done_on: '2026-10-02' },
    { title: 'Call the bank', state: 'open' },
  ])
  const plan = chartPlan(db, listFormats(db), [], DONE)
  if (!plan.ok) throw new Error(plan.error)
  makeChart(db, [], plan.value)
  setDashboardBlocks(db, 'task', [{ dashboard: 'task', format: 'task', kind: 'rollup', name: 'x', address: '' }])
  makeView(db, dashboardBlocks(db, 'task'), { dashboard: 'task', format: 'task', kind: 'list', name: 'Open', address: '?state=open' })
  return db
}

const rollupsOf = (db: Parameters<typeof listFormats>[0]): readonly string[] =>
  (listFormats(db).find((each) => each.name === 'task')?.rollups ?? []).map((each) => each.name)

describe('a chart in the rail (M53 F3)', () => {
  it('is listed under its format, and a block’s Remove leaves it there', async () => {
    const db = await withChart()
    expect(rollupsOf(db)).toEqual(['x'])
    setDashboardBlocks(db, undefined, [])
    expect(rollupsOf(db)).toEqual(['x'])
    expect(dashboardBlocks(db, 'task').map((each) => each.name)).toEqual(['x', 'Open'])
  })

  it('is deleted there, and takes its blocks on every dashboard with it', async () => {
    const db = await withChart()
    const change = rollupDeleted(db, listFormats(db), 'task', 'x')
    if (!change.ok) throw new Error(change.error)
    changeRollup(db, change.value)
    expect(rollupsOf(db)).toEqual([])
    expect(dashboardBlocks(db, undefined)).toEqual([])
    // The saved view's block beside it stays.
    expect(dashboardBlocks(db, 'task').map((each) => each.name)).toEqual(['Open'])
    expect(rollupDeleted(db, listFormats(db), 'task', 'x')).toEqual({ ok: false, error: 'Task has no rollup called x any more.' })
  })

  it('is renamed there, folded as New chart folds it, and its blocks follow', async () => {
    const db = await withChart()
    const change = rollupRenamed(db, listFormats(db), 'task', 'x', 'Done by month')
    if (!change.ok || change.value === undefined) throw new Error('not renamed')
    changeRollup(db, change.value)
    expect(rollupsOf(db)).toEqual(['done_by_month'])
    const declarations = listFormats(db)
    const blocks = [...dashboardBlocks(db, undefined), ...dashboardBlocks(db, 'task')]
    expect(blocks.map((each) => each.name)).toEqual(['done_by_month', 'done_by_month', 'Open'])
    expect(blocks.map((each) => blockGone(db, each, declarations))).toEqual([undefined, undefined, undefined])
    expect(runRollup(db, declarations.find((each) => each.name === 'task')!, 'done_by_month', declarations, { today: '2026-10-22' })?.groups.length).toBe(2)
  })

  it('refuses a name that is no change, a bad one, or one a dashboard holding it already uses', async () => {
    const db = await withChart()
    expect(rollupRenamed(db, listFormats(db), 'task', 'x', ' x ')).toEqual({ ok: true, value: undefined })
    expect(rollupRenamed(db, listFormats(db), 'task', 'x', '   ')).toEqual({ ok: false, error: 'Give it a name.' })
    // A column's name is taken.
    expect(rollupRenamed(db, listFormats(db), 'task', 'x', 'state').ok).toBe(false)
    // The format's dashboard holds both the chart and a view called `late`.
    makeView(db, dashboardBlocks(db, 'task'), { dashboard: 'task', format: 'task', kind: 'list', name: 'late', address: '?state=open' })
    expect(rollupRenamed(db, listFormats(db), 'task', 'x', 'late')).toEqual({
      ok: false,
      error: 'A dashboard holding this chart has a block called late already.',
    })
    expect(rollupsOf(db)).toEqual(['x'])
  })
})
