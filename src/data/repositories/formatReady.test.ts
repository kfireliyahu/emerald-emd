import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { readViews } from '@/domain/format/document.ts'
import { selfLinks } from '@/domain/format/row.ts'
import { readReadyState, readStartSetting, readyOf, startOf, startQuestions } from '@/domain/format/view.ts'
import { recordFormatRowsTool, updateFormatRowsTool } from '@/plugin/tools/formats.ts'
import { startHereTool } from '@/plugin/tools/startHere.ts'
import { NO_CLIENT } from '@/plugin/tools/tool.ts'
import { createDatabase, exportDatabase } from '../db/database.ts'
import { stageRows } from './formatBatchRepository.ts'
import { readyData, startCount, startHere } from './formatLinkViewRepository.ts'
import { adoptFormat } from './formatRepository.ts'
import { insertRows, updateRow } from './formatRowRepository.ts'
import { restoreViewSettings, viewSettings } from './formatViewRepository.ts'
import { tempDirSync } from '../../testing/tempDir'

/**
 * What is ready, and where a session starts (M27 U5, D-303): units planned
 * with nothing they wait on still open, and the questions a pack's views say a
 * session asks first, answered in one call.
 */

const NOW = Date.UTC(2026, 9, 1)

function format(name: string, columns: FormatDeclaration['columns']): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name,
    title: name[0]?.toUpperCase() + name.slice(1),
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
}

const STEP = format('step', [
  column('ref', 'text', { required: true, unique: true }),
  column('title', 'text'),
  column('state', 'enum', { values: ['planned', 'in_progress', 'built', 'dropped'], required: true }),
  column('blocks', 'links', { target: 'step' }),
])

const NOTE = format('note', [
  column('ref', 'text', { required: true, unique: true }),
  column('date', 'date', { required: true }),
  column('state', 'enum', { values: ['open', 'closed'], required: true }),
])

const TASK = format('task', [column('name', 'text', { required: true }), column('done', 'boolean')])

const VIEWS = `---
emerald: views
---

### note start
date: latest 2

### step ready
blocks: waits
state: ready planned done built dropped
title: line
`

async function withSteps() {
  const db = await createDatabase()
  for (const each of [STEP, NOTE]) expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  const views = readViews(VIEWS)
  if (!views.ok) throw new Error(views.error)
  restoreViewSettings(db, views.value.views)
  const [built = '', dropped = '', going = '', planned = ''] = insertRows(db, STEP, [
    { ref: 'U1', state: 'built' },
    { ref: 'U2', state: 'dropped' },
    { ref: 'U3', state: 'in_progress' },
    { ref: 'U4', state: 'planned' },
  ])
  insertRows(db, STEP, [
    { ref: 'U10', title: 'After the built one', state: 'planned', blocks: [built] },
    { ref: 'U5', title: 'After the dropped one', state: 'planned', blocks: [dropped] },
    { ref: 'U6', state: 'planned', blocks: [built, going] },
    { ref: 'U7', state: 'planned', blocks: [planned] },
    { ref: 'U8', state: 'built', blocks: [planned] },
  ])
  insertRows(db, NOTE, [
    { ref: 'N1', date: '2026-09-01', state: 'closed' },
    { ref: 'N2', date: '2026-10-01', state: 'open' },
    { ref: 'N3', date: '2026-10-01', state: 'open' },
  ])
  return { db, ids: { built, dropped, going, planned } }
}

describe('the ready view’s words', () => {
  it('reads ready and done members, and refuses what is not one', () => {
    expect(readReadyState('ready planned done built dropped')).toEqual({
      ready: ['planned'],
      done: ['built', 'dropped'],
    })
    expect(readReadyState('ready planned, open done built')).toEqual({ ready: ['planned', 'open'], done: ['built'] })
    for (const not of ['ready planned', 'done built', 'ready done built', 'ready planned done', 'ready a done a']) {
      expect(readReadyState(not), not).toBeUndefined()
    }
  })

  it('reads is and latest, and caps latest', () => {
    expect(readStartSetting('is open')).toEqual({ kind: 'is', member: 'open' })
    expect(readStartSetting('latest 5')).toEqual({ kind: 'latest', count: 5 })
    for (const not of ['latest 0', 'latest 51', 'latest five', 'is', 'is open now', 'line']) {
      expect(readStartSetting(not), not).toBeUndefined()
    }
  })

  it('has no ready view without a link into its own rows, or with members the enum has not got', () => {
    const settings = new Map([['state', 'ready planned done built dropped']])
    expect(readyOf(STEP, settings)?.waits.name).toBe('blocks')
    expect(readyOf(NOTE, new Map([['state', 'ready open done closed']]))).toBeUndefined()
    expect(readyOf(STEP, new Map([['state', 'ready waiting done finished']]))).toBeUndefined()
    expect(readyOf(STEP, new Map())).toBeUndefined()
  })

  it('leaves out a start setting about a member its enum has not got', () => {
    expect(startOf(NOTE.columns, new Map([['state', 'is pending']]))).toBeUndefined()
    expect(startOf(NOTE.columns, new Map([['state', 'is open']]))?.is.map((each) => each.member)).toEqual(['open'])
    expect(startOf(NOTE.columns, new Map([['ref', 'latest 3']]))).toBeUndefined()
  })

  it('asks a boolean is true or is false, and nothing else of it (M36 U06)', () => {
    const settings = (word: string) => new Map([['done', `is ${word}`]])
    expect(startOf(TASK.columns, settings('false'))?.is.map((each) => [each.column.name, each.member])).toEqual([
      ['done', 'false'],
    ])
    expect(startOf(TASK.columns, settings('true'))?.is.map((each) => each.member)).toEqual(['true'])
    expect(startOf(TASK.columns, settings('yes'))).toBeUndefined()
    const [question] = startQuestions([TASK], () => new Map(), () => settings('false'))
    expect(question?.call).toBe('format_rows task match:{done:false}')
  })

  it('asks ready first, then each start view, and names the call that lists it whole', () => {
    const questions = startQuestions(
      [STEP, NOTE],
      (name) => (name === 'step' ? new Map([['state', 'ready planned done built dropped']]) : new Map()),
      (name) => (name === 'note' ? new Map([['state', 'is open'], ['date', 'latest 2']]) : new Map()),
    )
    expect(questions.map((each) => [each.format, each.kind, each.call])).toEqual([
      ['step', 'ready', undefined],
      ['note', 'start', 'format_rows note match:{state:open} order:date descending:true limit:2'],
    ])
    expect(questions[1]?.what).toBe('the 2 latest by date, state is open')
  })
})

describe('what is ready (M27 U5)', () => {
  it('is planned with nothing it waits on still open — a dropped blocker counts as done', async () => {
    const { db } = await withSteps()
    const ready = readyData(db, STEP, [STEP, NOTE])
    if (ready === undefined) throw new Error('no ready view')
    const ref = (line: { row: { cells: Readonly<Record<string, unknown>> } }) => line.row.cells['ref']
    // Name order the way a person counts: U4 before U10.
    expect(ready.ready.map(ref)).toEqual(['U4', 'U5', 'U10'])
    expect(ready.held.map((each) => [ref(each.line), each.by.map(ref)])).toEqual([
      // In progress holds a row up: only what the view says is done is done.
      ['U6', ['U3']],
      ['U7', ['U4']],
    ])
    db.close()
  })

  it('lets the held rows through on the next read once their blocker lands', async () => {
    const { db, ids } = await withSteps()
    updateRow(db, STEP, ids.planned, { state: 'built' })
    updateRow(db, STEP, ids.going, { state: 'dropped' })
    const ref = (line: { row: { cells: Readonly<Record<string, unknown>> } }) => line.row.cells['ref']
    expect(readyData(db, STEP, [STEP, NOTE])?.ready.map(ref)).toEqual(['U5', 'U6', 'U7', 'U10'])
    db.close()
  })

  it('shows a row a hand edit left naming itself as held by itself, never ready', async () => {
    const { db, ids } = await withSteps()
    updateRow(db, STEP, ids.planned, { blocks: [ids.planned] })
    const ready = readyData(db, STEP, [STEP, NOTE])
    expect(ready?.held.some((each) => each.line.row.id === ids.planned && each.by[0]?.row.id === ids.planned)).toBe(true)
    db.close()
  })

  it('answers start_here from the views, ready first, the latest by date with ties by name', async () => {
    const { db } = await withSteps()
    const answers = startHere(db, [STEP, NOTE])
    expect(answers.map((each) => [each.question.format, each.question.kind])).toEqual([
      ['step', 'ready'],
      ['note', 'start'],
    ])
    expect(answers[1]?.lines.map((each) => each.row.cells['ref'])).toEqual(['N3', 'N2'])
    expect(answers[1]?.total).toBe(3)
    expect(viewSettings(db, 'note', 'start')).toEqual(new Map([['date', 'latest 2']]))
    db.close()
  })
})

describe('a start view on a boolean (M36 U06)', () => {
  it('finds the rows at false, not the empty ones, and counts what start_here lists', async () => {
    const db = await createDatabase()
    expect(adoptFormat(db, TASK, NOW).refusals).toEqual([])
    restoreViewSettings(db, [{ format: 'task', view: 'start', column: 'done', setting: 'is false' }])
    insertRows(db, TASK, [
      { name: 'Open one', done: 0 },
      { name: 'Open two', done: 0 },
      { name: 'Finished', done: 1 },
      { name: 'Never answered' },
    ])
    const [answer] = startHere(db, [TASK])
    expect(answer?.lines.map((each) => each.row.cells['name'])).toEqual(['Open one', 'Open two'])
    expect(startCount(db, TASK)).toBe(2)
    expect(startCount(db, NOTE)).toBeUndefined()
    db.close()
  })
})

describe('a row may not name itself (M27 U5)', () => {
  it('is refused in a batch that names a row of itself by its own name', async () => {
    const { db } = await withSteps()
    const batch = stageRows(db, STEP, [{ ref: 'U9', state: 'planned', blocks: ['U9'] }])
    expect(batch.accepted).toEqual([])
    expect(batch.refusals[0]?.column).toBe('blocks')
    expect(batch.refusals[0]?.reason).toContain('names this row itself')
    db.close()
  })

  it('is the same sentence for any link into its own format, and none for another row', () => {
    expect(selfLinks(STEP, 'a', { blocks: ['b', 'a'] })).toHaveLength(1)
    expect(selfLinks(STEP, 'a', { blocks: ['b'] })).toEqual([])
    expect(selfLinks(NOTE, 'a', { ref: 'a' })).toEqual([])
  })

  it('is refused by both tools, and start_here answers in one call', async () => {
    const { db, ids } = await withSteps()
    const path = join(tempDirSync('emerald-ready-'), 'steps.emd')
    writeFileSync(path, exportDatabase(db))
    db.close()

    const edit = await updateFormatRowsTool.run(
      { path, format: 'step', edits: [{ id: ids.planned, values: { blocks: ['U4'] } }] },
      NO_CLIENT,
    )
    expect(edit).toContain('names this row itself')
    const record = await recordFormatRowsTool.run(
      { path, format: 'step', rows: [{ ref: 'U11', state: 'planned', blocks: ['U11'] }] },
      NO_CLIENT,
    )
    expect(record).toContain('names this row itself')

    const answer = await startHereTool.run({ path }, NO_CLIENT)
    expect(answer).toContain('### Ready to start — step')
    expect(answer).toContain('- U4\n- U5 · After the dropped one\n- U10 · After the built one')
    expect(answer).toContain('- U6 — waits on U3 · in_progress')
    expect(answer).toContain('### note — the 2 latest by date')
    expect(answer).toContain('Whole list: `format_rows note order:date descending:true limit:2`.')
  })
})
