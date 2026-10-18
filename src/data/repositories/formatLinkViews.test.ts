import { describe, expect, it } from 'vitest'

import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { readViews, writeWidths } from '@/domain/format/document.ts'
import { foldUnder, inRoadmapOrder, roadmapOf } from '@/domain/format/view.ts'
import { createDatabase } from '../db/database.ts'
import { entryLineShape, entryLinks, roadmapData } from './formatLinkViewRepository.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'
import { adoptFormat } from './formatRepository.ts'
import { insertRows, updateRow } from './formatRowRepository.ts'
import { restoreViewSettings, setEntryOrder, viewSettings } from './formatViewRepository.ts'

/**
 * The roadmap and the page (M27 U4, D-302): rows of X in order with the Ys
 * that name each, and one row with its links read one hop each way.
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

const CHOICE = format('choice', [
  column('ref', 'text', { required: true }),
  column('title', 'text'),
  column('replaces', 'link', { target: 'choice' }),
  column('state', 'enum', { values: ['live', 'superseded'], required: true }),
])

const PHASE = format('phase', [
  column('ref', 'text', { required: true }),
  column('title', 'text'),
  column('state', 'enum', { values: ['planned', 'open', 'closed'], required: true }),
  column('position', 'integer', { required: true }),
])

const STEP = format('step', [
  column('ref', 'text', { required: true }),
  column('phase', 'link', { target: 'phase' }),
  column('title', 'text'),
  column('choice', 'link', { target: 'choice' }),
  column('state', 'enum', { values: ['planned', 'built'], required: true }),
  column('waits', 'links', { target: 'step' }),
])

const FORMATS = [CHOICE, PHASE, STEP]
const NONE = (): ReadonlyMap<string, string> => new Map()

async function withPlan() {
  const db = await createDatabase()
  for (const each of FORMATS) expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  const [old = '', mid = '', last = ''] = insertRows(db, CHOICE, [
    { ref: 'C-1', state: 'superseded' },
    { ref: 'C-2', state: 'superseded' },
    { ref: 'C-3', title: 'The third', state: 'live' },
  ])
  updateRow(db, CHOICE, mid, { replaces: old })
  updateRow(db, CHOICE, last, { replaces: mid })
  // Inserted out of order on purpose: the number is the order, not the row.
  const [later = '', first = ''] = insertRows(db, PHASE, [
    { ref: 'P2', title: 'Second', state: 'open', position: 20 },
    { ref: 'P1', title: 'First', state: 'closed', position: 10 },
  ])
  insertRows(db, STEP, [
    { ref: 'P2 U10', phase: later, state: 'planned' },
    { ref: 'P2 U2', phase: later, title: 'Two', choice: mid, state: 'built' },
    { ref: 'P1 U1', phase: first, choice: mid, state: 'built' },
    { ref: 'Stray', state: 'planned' },
  ])
  return { db, choices: { old, mid, last }, phases: { first, later } }
}

describe('a roadmap', () => {
  it('runs by its first number and folds every format naming it, never itself', () => {
    const shape = roadmapOf(PHASE, FORMATS, NONE)
    expect(shape?.order.name).toBe('position')
    expect(shape?.state?.name).toBe('state')
    expect(shape?.folds.map((each) => `${each.format.name}.${each.through.name}`)).toEqual(['step.phase'])
    // Choice has no number to run in; step has none either.
    expect(roadmapOf(CHOICE, FORMATS, NONE)).toBeUndefined()
    // A number and nothing naming it is the sheet, sorted — not a roadmap.
    expect(roadmapOf(PHASE, [PHASE], NONE)).toBeUndefined()
  })

  it('folds only the links that say under, once any does, and shows the columns that say line', () => {
    const settings = (name: string): ReadonlyMap<string, string> =>
      name === 'step'
        ? new Map([['phase', 'under'], ['title', 'line'], ['choice', 'line']])
        : name === 'phase'
          ? new Map([['title', 'line']])
          : new Map()
    const shape = roadmapOf(PHASE, FORMATS, settings)
    expect(shape?.folds.map((each) => each.through.name)).toEqual(['phase'])
    expect(shape?.lines.map((each) => each.name)).toEqual(['title'])
    expect(shape?.folds[0]?.lines.map((each) => each.name)).toEqual(['title', 'choice'])
  })

  it('orders by the number, rows with none last, ties as a person counts', () => {
    const rows = [
      { n: undefined, name: 'z' },
      { n: 2, name: 'U10' },
      { n: 2, name: 'U2' },
      { n: 1, name: 'b' },
    ]
    expect(inRoadmapOrder(rows, (row) => row.n, (row) => row.name).map((row) => row.name)).toEqual([
      'b',
      'U2',
      'U10',
      'z',
    ])
  })

  it('keeps a row naming none of the roadmap apart rather than dropping it', () => {
    const folded = foldUnder(
      new Set(['a']),
      [{ id: ['a'], name: 'x' }, { id: [], name: 'y' }, { id: ['gone'], name: 'w' }],
      (row) => row.id,
      (row) => row.name,
    )
    expect(folded.under.get('a')?.map((row) => row.name)).toEqual(['x'])
    expect(folded.loose.map((row) => row.name)).toEqual(['w', 'y'])
  })

  it('reads the rows from the document in order, each with its folded rows, and re-reads a change', async () => {
    const { db, phases } = await withPlan()
    const read = () => roadmapData(db, PHASE, FORMATS)
    const roadmap = read()
    expect(roadmap?.rows.map((each) => each.line.row.cells['ref'])).toEqual(['P1', 'P2'])
    const second = roadmap?.rows[1]?.folds[0]?.lines.map((each) => each.row.cells['ref'])
    expect(second).toEqual(['P2 U2', 'P2 U10'])
    expect(roadmap?.loose[0]?.lines.map((each) => each.row.cells['ref'])).toEqual(['Stray'])
    expect(roadmap?.labels.get(phases.first)).toBe('P1')

    // Nothing is kept: a write is on the next read (what M27 U6 needs).
    updateRow(db, PHASE, phases.later, { position: 5 })
    expect(read()?.rows.map((each) => each.line.row.cells['ref'])).toEqual(['P2', 'P1'])
    db.close()
  })

  it('holds the rows it folds to a filter of their own, and says how many it held back (M37 U5)', async () => {
    const { db } = await withPlan()
    const planned = roadmapData(db, PHASE, FORMATS, {}, new Map([['step', { match: new Map([['state', 'planned']]) }]]))
    const second = planned?.rows[1]?.folds[0]
    expect(second?.lines.map((each) => each.row.cells['ref'])).toEqual(['P2 U10'])
    expect(second?.total).toBe(2)
    expect(planned?.rows[0]?.folds[0]?.lines).toEqual([])
    expect(planned?.rows[0]?.folds[0]?.total).toBe(1)
    // A loose row the filter holds is still drawn apart; one it holds back is not.
    expect(planned?.loose[0]?.lines.map((each) => each.row.cells['ref'])).toEqual(['Stray'])
    const built = roadmapData(db, PHASE, FORMATS, {}, new Map([['step', { match: new Map([['state', 'built']]) }]]))
    expect(built?.loose).toEqual([])
    db.close()
  })
})

describe('what names a row, on its entry (M35 U2, D-401)', () => {
  it('reads one hop, so a chain shows its next step and not its end', async () => {
    const { db, choices } = await withPlan()
    const links = entryLinks(db, CHOICE, FORMATS, choices.mid)
    if (links === undefined) throw new Error('no entry')
    const by = new Map(links.namedBy.map((each) => [each.column.name, each.lines.map((line) => line.row.cells['ref'])]))
    // C-3 replaced it; C-3's own replacer, if any, would be on C-3's entry.
    expect(by.get('replaces')).toEqual(['C-3'])
    expect(by.get('choice')).toEqual(['P1 U1', 'P2 U2'])
    // What it names is a field of its own, and its name is in the labels.
    expect(links.labels.get(choices.old)).toBe('C-1')
    expect(entryLinks(db, CHOICE, FORMATS, 'no such row')).toBeUndefined()
    db.close()
  })

  it('keeps a group for every link naming the format, empty or not', async () => {
    const { db, choices } = await withPlan()
    const top = entryLinks(db, CHOICE, FORMATS, choices.last)
    expect(top?.namedBy.map((each) => `${each.format.name}.${each.column.name}:${String(each.lines.length)}`)).toEqual([
      'choice.replaces:0',
      'step.choice:0',
    ])
    db.close()
  })

  it('draws a named row by its entry’s title when that is not its name', async () => {
    const { db } = await withPlan()
    // A step is named by its ref and titled by its title once the title comes first.
    expect(entryLineShape(db, STEP).lines.map((each) => each.name)).toEqual([])
    setEntryOrder(db, 'step', ['title', 'ref', 'phase', 'choice', 'state', 'waits'])
    expect(entryLineShape(db, STEP).lines.map((each) => each.name)).toEqual(['title'])
    db.close()
  })

  it('finds a row named through a links column', async () => {
    const { db } = await withPlan()
    const [blocker = '', waiting = ''] = insertRows(db, STEP, [
      { ref: 'A', state: 'planned' },
      { ref: 'B', state: 'planned' },
    ])
    updateRow(db, STEP, waiting, { waits: [blocker] })
    const page = entryLinks(db, STEP, FORMATS, blocker)
    const by = page?.namedBy.find((each) => each.column.name === 'waits')
    expect(by?.lines.map((line) => line.row.cells['ref'])).toEqual(['B'])
    db.close()
  })
})

describe('roadmap and page settings', () => {
  it('round-trip through a text document and keep only their own words', async () => {
    const text = writeWidths([], [
      { format: 'phase', view: 'roadmap', column: 'position', setting: 'order' },
      { format: 'step', view: 'roadmap', column: 'phase', setting: 'under' },
      { format: 'choice', view: 'page', column: 'title', setting: 'body' },
    ])
    const read = readViews(text)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.views).toHaveLength(3)
    const wrong = readViews(text.replace('order', 'lanes'))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error).toContain('order or line or under')

    const db = await createDatabase()
    restoreViewSettings(db, read.value.views)
    expect(viewSettings(db, 'phase', 'roadmap')).toEqual(new Map([['position', 'order']]))
    expect(viewSettings(db, 'choice', 'page')).toEqual(new Map([['title', 'body']]))
    db.close()
  })

  it('survive a text save whole — every word, not only the ones an entry also has', async () => {
    const { db } = await withPlan()
    const settings = [
      { format: 'phase', view: 'roadmap' as const, column: 'position', setting: 'order' },
      { format: 'phase', view: 'roadmap' as const, column: 'title', setting: 'line' },
      { format: 'step', view: 'roadmap' as const, column: 'phase', setting: 'under' },
      { format: 'choice', view: 'page' as const, column: 'title', setting: 'body' },
    ]
    restoreViewSettings(db, settings)
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const again = await createDatabase()
    const applied = applyParts(again, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(viewSettings(again, 'phase', 'roadmap')).toEqual(new Map([['position', 'order'], ['title', 'line']]))
    expect(viewSettings(again, 'step', 'roadmap')).toEqual(new Map([['phase', 'under']]))
    expect(viewSettings(again, 'choice', 'page')).toEqual(new Map([['title', 'body']]))
    db.close()
    again.close()
  })
})
