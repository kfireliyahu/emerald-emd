/**
 * **Dashboards** — M53 U7, D-514, D-521.
 *
 * The done-test, the conversation's half: the synthetic task format's
 * dashboard with *Due today*, *Open by project*, a monthly done-count chart and
 * an open count, made by `arrange_views view:dashboard` and drawn by
 * `show_format view:dashboard`; and the document's, with blocks from two
 * formats. The screen's half writes through the same `setDashboardBlocks`,
 * which is held here too: a text document carries every block, a renamed saved
 * view takes its blocks with it, a deleted one or a deleted format takes them
 * away, and a headline total sums money per currency.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { deleteFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { dashboardBlocks, deleteSavedView, renameSavedView, setDashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import { openEncoded } from '@/data/storage/encoding.ts'
import { headline } from '@/ui/formats/dashboard.ts'

import { declareFormatTool, formatsTool, recordFormatRowsTool } from './formats.ts'
import { showFormatTool } from './sheet.ts'
import { storeDocumentAsTool } from './storeAs.ts'
import { NO_CLIENT } from './tool.ts'
import { arrangeViewsTool } from './views.ts'
import { tempDir } from '../../testing/tempDir'

const TASK = {
  format: 'task',
  title: 'Task',
  columns: [
    { name: 'title', type: 'text', required: true },
    { name: 'due', type: 'date' },
    { name: 'state', type: 'enum', values: ['open', 'done'] },
    { name: 'project', type: 'text' },
    { name: 'done_on', type: 'date' },
    { name: 'estimate', type: 'integer', unit: 'h' },
  ],
  rollups: [{ name: 'done_by_month', works_out: 'count by month of done_on' }],
  nothing_must_hold: true,
}

const BOOK = {
  format: 'book',
  title: 'Book',
  columns: [
    { name: 'title', type: 'text', required: true },
    { name: 'state', type: 'enum', values: ['want', 'reading', 'finished'] },
    { name: 'price', type: 'money' },
  ],
  nothing_must_hold: true,
}

const TASKS = [
  { title: 'Call the bank', due: '2026-10-22', state: 'open', project: 'Home', estimate: 1 },
  { title: 'Ship the release', due: '2026-10-23', state: 'open', project: 'Work', estimate: 4 },
  { title: 'Book the dentist', due: '2026-10-20', state: 'done', project: 'Home', done_on: '2026-10-20' },
  { title: 'Write the review', due: '2026-10-22', state: 'open', project: 'Work', estimate: 2 },
  { title: 'File the receipts', state: 'done', project: 'Home', done_on: '2026-09-14' },
]

const BOOKS = [
  { title: 'Nine Small Harbours', state: 'reading', price: 12.5, price_currency: 'ILS' },
  { title: 'Copper and Rain', state: 'finished', price: 30, price_currency: 'ILS' },
  { title: 'Maps of a Lost Week', state: 'finished', price: 9.99, price_currency: 'USD' },
]

function pin(day: string): void {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  vi.setSystemTime(new Date(year, month - 1, date, 9, 30))
}

async function document(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-dashboard-'), 'tasks.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const declared = await declareFormatTool.run({ path, formats: [TASK, BOOK], commit: true }, NO_CLIENT)
  expect(declared).toContain('2 formats declared')
  expect(await recordFormatRowsTool.run({ path, format: 'task', rows: TASKS, commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  expect(await recordFormatRowsTool.run({ path, format: 'book', rows: BOOKS, commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  const saved = await arrangeViewsTool.run(
    {
      path,
      settings: [
        { format: 'task', view: 'saved', name: 'Due today', kind: 'list', match: { due: 'today' } },
        { format: 'task', view: 'saved', name: 'Open by project', kind: 'list', match: { state: { not: 'done' } } },
        { format: 'book', view: 'saved', name: 'Reading now', kind: 'table', match: { state: 'reading' } },
      ],
      commit: true,
    },
    NO_CLIENT,
  )
  expect(saved).not.toContain('Nothing was written')
  return path
}

async function blocksIn(path: string, dashboard: string | undefined) {
  const { db } = await openEncoded(readFileSync(path))
  const blocks = dashboardBlocks(db, dashboard)
  db.close()
  return blocks
}

describe('dashboards (M53 U7)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    pin('2026-10-22')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('makes the task format’s dashboard by a conversation, and draws it', async () => {
    const path = await document()
    const settings = [
      {
        format: 'task',
        view: 'dashboard',
        add: [
          { saved: 'Due today' },
          { saved: 'Open by project' },
          { rollup: 'done_by_month' },
          { total: 'Open', count: true, match: { state: { not: 'done' } } },
        ],
      },
    ]
    const dry = await arrangeViewsTool.run({ path, settings }, NO_CLIENT)
    expect(dry).toContain('added')
    expect(await blocksIn(path, 'task')).toEqual([])
    expect(await arrangeViewsTool.run({ path, settings, commit: true }, NO_CLIENT)).not.toContain('Nothing was written')
    expect((await blocksIn(path, 'task')).map((each) => each.name)).toEqual(['Due today', 'Open by project', 'done_by_month', 'Open'])

    // Ordered, as the mockup's calls do: the open count first.
    await arrangeViewsTool.run(
      { path, settings: [{ format: 'task', view: 'dashboard', order: ['Open', 'Due today'] }], commit: true },
      NO_CLIENT,
    )
    const blocks = await blocksIn(path, 'task')
    expect(blocks.map((each) => each.name)).toEqual(['Open', 'Due today', 'Open by project', 'done_by_month'])
    expect(blocks[0]).toMatchObject({ kind: 'total', address: '?state!=done' })

    const drawn = await showFormatTool.run({ path, format: 'task', view: 'dashboard' }, NO_CLIENT)
    expect(drawn).toContain('**Task’s dashboard** — 4 blocks')
    expect(drawn).toContain('1. **Open** — Count · state is not done: **3** of 5 tasks.')
    expect(drawn).toMatch(/2\. \*\*Due today\*\* — List · due is today: 2 rows — (Call the bank, Write the review|Write the review, Call the bank)\./)
    expect(drawn).toContain('**Open by project** — List · state is not done')
    expect(drawn).toMatch(/done_by_month\*\* — Rollup · .*2026-09 1, 2026-10 1/)
    expect(await formatsTool.run({ path, format: 'task' }, NO_CLIENT)).toContain('**Dashboard**')

    // Taken off again; the saved view itself stays.
    await arrangeViewsTool.run({ path, settings: [{ format: 'task', view: 'dashboard', remove: ['Open by project'] }], commit: true }, NO_CLIENT)
    expect((await blocksIn(path, 'task')).map((each) => each.name)).toEqual(['Open', 'Due today', 'done_by_month'])
  })

  it('makes the document’s, from two formats, and refuses what is not a block', async () => {
    const path = await document()
    const refused = await arrangeViewsTool.run(
      {
        path,
        settings: [
          { view: 'dashboard', add: [{ saved: 'Due today' }] },
          { format: 'task', view: 'dashboard', add: [{ format: 'book', saved: 'Reading now' }] },
          { format: 'task', view: 'dashboard', add: [{ saved: 'Nowhere' }] },
          { format: 'task', view: 'dashboard', add: [{ total: 'Hours', sum: 'title' }] },
          { format: 'task', view: 'dashboard', add: [{ text: 'A note' }] },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(refused).toContain('Nothing was written')
    expect(refused).toContain('names the `format` it reads')
    expect(refused).toContain('holds task’s own views')
    expect(refused).toContain('no saved view called Nowhere')
    expect(refused).toContain('`sum` is a number or money column of task: `estimate`')
    expect(refused).toContain('text is none of them')

    await arrangeViewsTool.run(
      {
        path,
        settings: [
          {
            view: 'dashboard',
            add: [
              { format: 'task', total: 'Open tasks', count: true, match: { state: 'open' } },
              { format: 'book', total: 'Spent on books', sum: 'price' },
              { format: 'task', saved: 'Due today' },
              { format: 'book', saved: 'Reading now' },
            ],
          },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect((await blocksIn(path, undefined)).map((each) => `${each.format}/${each.name}`)).toEqual([
      'task/Open tasks',
      'book/Spent on books',
      'task/Due today',
      'book/Reading now',
    ])
    const drawn = await showFormatTool.run({ path, view: 'dashboard' }, NO_CLIENT)
    expect(drawn).toContain('**The document’s dashboard** — 4 blocks')
    expect(drawn).toContain('**Open tasks** — Task · Count · state = open: **3** of 5 tasks.')
    // Money is summed per currency, never across two.
    expect(drawn).toMatch(/\*\*Spent on books\*\* — Book · Sum of price · every book: \*\*₪42\.50 \+ \$9\.99\*\* of 3 books, over 3 rows\./)
    expect(drawn).toContain('**Reading now** — Book · Table · state = reading: 1 row — Nine Small Harbours.')
    // Nothing on a format's own dashboard yet says how to put something there.
    expect(await showFormatTool.run({ path, format: 'book', view: 'dashboard' }, NO_CLIENT)).toContain('Nothing is on book’s dashboard yet')
  })

  it('travels in a text document, and follows its saved views and formats', async () => {
    const path = await document()
    await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'task', view: 'dashboard', add: [{ total: 'Hours open', sum: 'estimate', match: { state: 'open' } }, { saved: 'Due today' }] },
          { view: 'dashboard', add: [{ format: 'book', saved: 'Reading now' }, { format: 'task', rollup: 'done_by_month' }] },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(await storeDocumentAsTool.run({ path, as: 'text', commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
    const text = readFileSync(path, 'utf8')
    expect(text).toContain('### Document dashboard\nkind: saved\nname: Reading now\nformat: book')
    expect(text).toContain('### task dashboard\nkind: total\nname: Hours open\nsum: estimate\naddress: ?state=open')
    expect((await blocksIn(path, 'task')).map((each) => each.name)).toEqual(['Hours open', 'Due today'])
    expect((await blocksIn(path, undefined)).map((each) => each.name)).toEqual(['Reading now', 'done_by_month'])

    const { db } = await openEncoded(readFileSync(path))
    const declarations = listFormats(db)
    const [hours] = dashboardBlocks(db, 'task')
    expect(hours !== undefined && headline(db, hours, declarations, '2026-10-22')).toMatchObject({ ok: true, value: { figure: '7', unit: 'h', rows: 3 } })
    renameSavedView(db, 'task', 'Due today', 'Today')
    expect(dashboardBlocks(db, 'task').map((each) => each.name)).toEqual(['Hours open', 'Today'])
    deleteSavedView(db, 'task', 'Today')
    expect(dashboardBlocks(db, 'task').map((each) => each.name)).toEqual(['Hours open'])
    // A format's dashboard holds its own views, and nothing else is written.
    expect(() => setDashboardBlocks(db, 'task', [{ dashboard: 'task', format: 'book', kind: 'saved', name: 'Reading now', address: '' }])).toThrow(/own views/)
    deleteFormat(db, 'book')
    expect(dashboardBlocks(db, undefined).map((each) => each.name)).toEqual(['done_by_month'])
    deleteFormat(db, 'task')
    expect(dashboardBlocks(db, undefined)).toEqual([])
    expect(dashboardBlocks(db, 'task')).toEqual([])
    db.close()
  })
})
