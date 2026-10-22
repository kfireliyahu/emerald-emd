import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { SEEDED_UNITS } from '@/domain/format/unit.ts'
import { entryDefaults } from '@/domain/format/view.ts'
import { EntryView } from './EntryView.tsx'

/**
 * **A filled entry shows what it holds, and a new one asks for what is
 * needed** — M53 U3, D-518, U1's approved mockup (`docs/mockups/m53-u1/tasks.html`,
 * choice 1 as A). The page is rendered as markup and read for what it draws: the
 * fields (`data-field`), the Empty line's names, and the words around them.
 */

const STATES = ['inbox', 'next', 'doing', 'waiting', 'done']

/** The mockup's task: twelve columns, made up. */
const TASK: FormatDeclaration = {
  language: 14,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [
    column('title', 'text', { required: true }),
    column('state', 'enum', { required: true, values: STATES }),
    column('due', 'date'),
    column('priority', 'enum', { values: ['low', 'normal', 'high', 'urgent'] }),
    column('project', 'text'),
    column('notes', 'text'),
    column('tags', 'enums', { values: ['call', 'email', 'errand'] }),
    column('estimate_h', 'real', { unit: 'h' }),
    column('assignee', 'text'),
    column('started', 'date'),
    column('done_on', 'date'),
    column('blocked_by', 'text'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: false,
}

/** Every column, empty: the draft a page holds before anything is typed. */
const BLANK = Object.fromEntries(TASK.columns.map((each) => [each.name, '']))

function page(
  draft: Readonly<Record<string, string>>,
  options: { existing?: string; hidden?: readonly string[]; asked?: readonly string[]; locked?: string } = {},
): string {
  return renderToStaticMarkup(
    createElement(EntryView, {
      declaration: TASK,
      draft: { ...BLANK, ...draft },
      units: SEEDED_UNITS,
      links: new Map(),
      labels: new Map(),
      chosen: new Map(),
      places: new Map(),
      headers: new Set<string>(),
      hidden: new Set(options.hidden ?? []),
      asked: new Set(options.asked ?? []),
      long: new Set<string>(),
      largest: new Map(),
      oneUnit: new Map(),
      linked: new Map(),
      today: '2026-10-22',
      problem: options.existing === undefined ? 'A task needs a title.' : undefined,
      refused: undefined,
      inputs: undefined,
      verdicts: [],
      aggregates: [],
      derived: [],
      named: undefined,
      findings: [],
      existing: options.existing,
      locked: options.locked,
      pager: undefined,
      written: undefined,
      onChange: () => undefined,
      onCommit: () => undefined,
      onRevert: () => undefined,
      onChoose: () => undefined,
      onOrder: () => undefined,
      onHide: () => undefined,
      onAsk: () => undefined,
      onBack: () => undefined,
      onAdd: () => undefined,
      onDelete: undefined,
      onOpen: () => undefined,
    }),
  )
}

/** The columns drawn as fields, in the page's order. */
function fields(markup: string): readonly string[] {
  return [...markup.matchAll(/data-field="([^"]+)"/g)].map((match) => match[1] ?? '')
}

/** The Empty line's names, as a person reads them. */
function empties(markup: string): readonly string[] {
  return [...markup.matchAll(/aria-label="Fill ([^"]+)"/g)].map((match) => match[1] ?? '')
}

const FILLED = { title: 'Draft section 2 of the report', state: 'doing', due: '2026-10-24', estimate_h: '3' }

describe('an entry that exists draws what it holds (M53 U3)', () => {
  it('draws the 4 of 12 columns that hold a value, and names the other 8 on the Empty line', () => {
    const markup = page(FILLED, { existing: 'r1' })
    expect(fields(markup)).toEqual(['title', 'state', 'due', 'estimate_h'])
    expect(empties(markup)).toEqual(['priority', 'project', 'notes', 'tags', 'assignee', 'started', 'done on', 'blocked by'])
    expect(markup).toContain('>Empty<')
  })

  it('reads labels as words: underscores become spaces, and a suffix naming the unit goes', () => {
    const markup = page(FILLED, { existing: 'r1' })
    expect(markup).toContain('>estimate<')
    expect(markup).not.toContain('>estimate_h<')
    // The h is on the value, not the label.
    expect(markup).toMatch(/>h<\/span>/)
  })

  it('puts a lone figure in the line under the title, not a figures part of its own', () => {
    const markup = page(FILLED, { existing: 'r1' })
    expect(markup).not.toContain('aria-label="Figures"')
  })

  it('always draws a required column, and says it is needed while it holds nothing', () => {
    const markup = page({ title: 'No state yet', due: '2026-10-24' }, { existing: 'r1' })
    expect(fields(markup)).toEqual(['title', 'state', 'due'])
    expect(markup).toMatch(/state<\/bdi><span[^>]*>needed<\/span>|>state<[\s\S]{0,200}needed/)
  })

  it('leaves a hidden column off the Empty line, and counts it at the end as "N hidden"', () => {
    const markup = page({ ...FILLED, started: '2026-10-20' }, { existing: 'r1', hidden: ['started', 'assignee'] })
    expect(fields(markup)).not.toContain('started')
    expect(empties(markup)).not.toContain('assignee')
    expect(markup).toContain('>2 hidden<')
  })

  it('offers nothing to fill on an entry that cannot be written here — a pack’s', () => {
    const markup = page(FILLED, { existing: 'r1', locked: 'Written by the ledger.' })
    expect(fields(markup)).toEqual(['title', 'state', 'due', 'estimate_h'])
    expect(empties(markup)).toEqual([])
  })

  it('keeps "Links here" beside an entry that exists', () => {
    expect(page(FILLED, { existing: 'r1' })).toContain('Links here')
  })
})

describe('a new entry asks for what is needed (M53 U3)', () => {
  const fresh = { ...entryDefaults(TASK.columns) }

  it('starts a required enum nothing implies at its first member: a new task is inbox', () => {
    expect(fresh).toEqual({ state: 'inbox' })
  })

  it('asks for the title, every required column and the ones ticked New entry — the rest are on the Empty line', () => {
    const markup = page(fresh, { asked: ['due', 'project'] })
    expect(fields(markup)).toEqual(['title', 'state', 'due', 'project'])
    expect(empties(markup)).toEqual(['priority', 'notes', 'tags', 'estimate', 'assignee', 'started', 'done on', 'blocked by'])
    expect(markup).toContain('A new <span dir="auto" class="bidi">task</span>')
  })

  it('has no "Links here", and says nothing about what is missing until Add is pressed', () => {
    const markup = page(fresh, { asked: ['due', 'project'] })
    expect(markup).not.toContain('Links here')
    expect(markup).not.toContain('A task needs a title.')
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>[\s\S]{0,400}Add/)
  })

  it('keeps a hidden column off a new entry even when it is ticked New entry', () => {
    const markup = page(fresh, { asked: ['due'], hidden: ['due'] })
    expect(fields(markup)).toEqual(['title', 'state'])
    expect(markup).toContain('>1 hidden<')
  })
})
