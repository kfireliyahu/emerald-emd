import { describe, expect, it } from 'vitest'

import {
  dayText,
  savedAddress,
  savedNameRefusal,
  blockDropped,
  blockMoved,
  blockNamed,
  blocksInOrder,
  totalNameRefusal,
  type DashboardBlock,
  entryDefaults,
  entryLabel,
  entryLayout,
  entryNeeds,
  entryShown,
  entryWayOf,
  withArticle,
  isShowAs,
  isViewSetting,
  lineShapeOf,
  monthText,
  oneUnitOf,
  printsAsPercent,
  readEntrySetting,
  readsAsMarkdown,
  relativeDay,
  relativeMonth,
  SHOW_AS_LABEL,
  wayOf,
  waysFor,
  workedOutType,
  writeEntrySetting,
  type ShowAs,
} from './view.ts'

/**
 * **Show as, per column type** — M35 U3, D-402. The set each type is offered
 * is the approved mockup's (`docs/mockups/m35/entry.html`, its `WAYS`), the
 * first the default; a word no longer offered draws as the default.
 */
describe('Show as, per column type', () => {
  const labels = (column: { type: string; minimum?: number; maximum?: number }): readonly string[] =>
    waysFor(column).map((way) => SHOW_AS_LABEL[way])

  it('offers each type the mockup’s ways, the default first', () => {
    expect(labels({ type: 'text' })).toEqual(['Line', 'Markdown', 'Mono'])
    for (const type of ['integer', 'real', 'decimal']) {
      expect(labels({ type })).toEqual(['Figure', 'Bar'])
      expect(labels({ type, minimum: 1, maximum: 5 })).toEqual(['Figure', 'Bar', 'Slider'])
    }
    expect(labels({ type: 'percent' })).toEqual(['Figure', 'Bar', 'Ring'])
    expect(labels({ type: 'percent', minimum: 0, maximum: 100 })).toEqual(['Figure', 'Bar', 'Ring', 'Slider'])
    expect(labels({ type: 'money' })).toEqual(['Figure', 'Large figure'])
    expect(labels({ type: 'quantity' })).toEqual(['As written', 'In one unit', 'Bar'])
    expect(labels({ type: 'date' })).toEqual(['Date', 'Relative', 'Both'])
    expect(labels({ type: 'month' })).toEqual(['Month', 'Relative'])
    expect(labels({ type: 'instant' })).toEqual(['Date and time', 'Relative'])
    expect(labels({ type: 'time' })).toEqual(['Clock'])
    expect(labels({ type: 'enum' })).toEqual(['Chip', 'Menu', 'Buttons', 'Steps'])
    expect(labels({ type: 'enums' })).toEqual(['Chips'])
    expect(labels({ type: 'boolean' })).toEqual(['Tick', 'Yes or No', 'Buttons'])
    expect(labels({ type: 'link' })).toEqual(['Name', 'Card'])
    expect(labels({ type: 'links' })).toEqual(['Chips', 'List', 'Cards'])
  })

  it('offers a slider only when both bounds are declared', () => {
    expect(waysFor({ type: 'integer', minimum: 1 })).not.toContain('slider')
    expect(waysFor({ type: 'percent', maximum: 100 })).not.toContain('slider')
  })

  it('draws a word no longer offered as the type’s default', () => {
    expect(wayOf({ type: 'text' }, 'mono')).toBe('mono')
    expect(wayOf({ type: 'integer' }, 'markdown')).toBe('figure')
    // A slider chosen while the bounds were declared, and the bounds gone.
    expect(wayOf({ type: 'integer' }, 'slider')).toBe('figure')
    // M26 U6's menu for a yes-or-no is not one of a boolean's ways now.
    expect(wayOf({ type: 'boolean' }, 'menu')).toBe('tick')
    expect(wayOf({ type: 'enum' }, undefined)).toBe('chip')
    expect(wayOf({ type: 'link' }, 'search')).toBe('name')
    expect(wayOf({ type: 'integer' }, 'field')).toBe('figure')
  })

  it('reads a retired word as no choice, so an arranged document still opens', () => {
    expect(isShowAs('field')).toBe(false)
    expect(isShowAs('search')).toBe(false)
    expect(readEntrySetting('field')).toEqual({ way: undefined, place: undefined, header: undefined })
    expect(readEntrySetting('search #3')).toEqual({ way: undefined, place: 3, header: undefined })
    expect(isViewSetting('entry', 'field')).toBe(true)
    // …and drops it on the next write.
    expect(writeEntrySetting({ way: undefined, place: undefined })).toBeUndefined()
    expect(writeEntrySetting({ way: undefined, place: 3 })).toBe('#3')
    // Two ways, or a retired one beside a way, is not a setting.
    expect(readEntrySetting('field figure')).toBeUndefined()
    expect(readEntrySetting('bar ring')).toBeUndefined()
  })

  it('reads and writes every way as a word of its own', () => {
    for (const way of Object.keys(SHOW_AS_LABEL) as ShowAs[]) {
      expect(readEntrySetting(`${way} #2`)).toEqual({ way, place: 2, header: undefined })
      expect(writeEntrySetting({ way, place: 2 })).toBe(`${way} #2`)
    }
  })

  it('shows a worked-out column by the ways of what it works out to, never a slider', () => {
    expect(waysFor(workedOutType('MONEY', false))).toEqual(['figure', 'large'])
    expect(waysFor(workedOutType('NUMBER', true))).toEqual(['figure', 'bar', 'ring'])
    expect(waysFor(workedOutType('NUMBER', false))).toEqual(['figure', 'bar'])
  })
})

describe('a text that reads as markdown by default', () => {
  it('is long, or broken over lines', () => {
    expect(readsAsMarkdown(['short', 'also short'])).toBe(false)
    expect(readsAsMarkdown(['short', 'two\nlines'])).toBe(true)
    expect(readsAsMarkdown(['x'.repeat(121)])).toBe(true)
  })

  it('carries inline markdown, even short (D-402)', () => {
    expect(readsAsMarkdown(['Keep it under **900 words**.'])).toBe(true)
    expect(readsAsMarkdown(['See [the plan](plan.md)'])).toBe(true)
    expect(readsAsMarkdown(['# A heading'])).toBe(true)
    expect(readsAsMarkdown(['- one item'])).toBe(true)
  })

  it('is not a title that quotes a name, a product or a snake_case word', () => {
    expect(readsAsMarkdown(['A `money` column is two'])).toBe(false)
    expect(readsAsMarkdown(['a link read from `[text](file.md)`'])).toBe(false)
    expect(readsAsMarkdown(['5 * 3 and 4 * 2'])).toBe(false)
    expect(readsAsMarkdown(['format_view_column keeps it'])).toBe(false)
  })

  it('reads as markdown only when nobody chose otherwise', () => {
    const body = { type: 'text' }
    expect(entryWayOf(body, undefined, true)).toBe('markdown')
    expect(entryWayOf(body, 'line', true)).toBe('line')
    expect(entryWayOf(body, 'mono', true)).toBe('mono')
    expect(entryWayOf(body, undefined, false)).toBe('line')
    expect(entryWayOf({ type: 'integer' }, undefined, true)).toBe('figure')
  })
})

describe('the words a way draws with', () => {
  it('says a date and a month as the mockup does', () => {
    expect(dayText('2026-10-09')).toBe('Fri 9 Oct 2026')
    expect(dayText('2024-02-29')).toBe('Thu 29 Feb 2024')
    expect(dayText('not a date')).toBe('not a date')
    expect(monthText('2026-10')).toBe('Oct 2026')
  })

  it('says a date against today', () => {
    const today = '2026-10-06'
    expect(relativeDay('2026-10-06', today)).toBe('today')
    expect(relativeDay('2026-10-07', today)).toBe('tomorrow')
    expect(relativeDay('2026-10-05', today)).toBe('yesterday')
    expect(relativeDay('2026-10-09', today)).toBe('in 3 days')
    expect(relativeDay('2026-09-22', today)).toBe('2 weeks ago')
    expect(relativeDay('2027-02-06', today)).toBe('in 4 months')
    expect(relativeDay('2020-10-06', today)).toBe('6 years ago')
    expect(relativeDay('soon', today)).toBeUndefined()
  })

  it('says a month against this one', () => {
    const today = '2026-10-06'
    expect(relativeMonth('2026-10', today)).toBe('this month')
    expect(relativeMonth('2026-11', today)).toBe('next month')
    expect(relativeMonth('2026-09', today)).toBe('last month')
    expect(relativeMonth('2026-07', today)).toBe('3 months ago')
  })

  it('shows a quantity in the unit declared, or the one most rows are in', () => {
    expect(oneUnitOf('min', ['h', 'h'])).toBe('min')
    expect(oneUnitOf(undefined, ['h', 'min', 'h'])).toBe('h')
    expect(oneUnitOf(undefined, ['g', 'ml'])).toBe('g')
    expect(oneUnitOf(undefined, [])).toBeUndefined()
  })

  it('prints a figure made of percents alone as a percent', () => {
    const columns = [
      { name: 'before', type: 'percent' },
      { name: 'after', type: 'percent' },
      { name: 'price', type: 'money' },
    ]
    expect(printsAsPercent(['before', 'after'], columns)).toBe(true)
    expect(printsAsPercent(['before', 'price'], columns)).toBe(false)
    expect(printsAsPercent(['ingredient.share'], columns)).toBe(false)
    expect(printsAsPercent([], columns)).toBe(false)
  })
})

/**
 * **A row is called by its first text column, or else its first date or month**
 * (M33 F7): a timesheet's day has no text, and was named by its id in the
 * paycheck's *Links here*.
 */
describe('the column a row is called by', () => {
  const column = (name: string, type: string) => ({ name, type })

  it('is the first text column', () => {
    expect(lineShapeOf([column('date', 'date'), column('title', 'text')], new Map()).name?.name).toBe('title')
  })

  it('is the first date or month of a format with no text', () => {
    const day = [column('start', 'time'), column('rate', 'money'), column('date', 'date'), column('paycheck', 'link')]
    expect(lineShapeOf(day, new Map()).name?.name).toBe('date')
    expect(lineShapeOf([column('period', 'month')], new Map()).name?.name).toBe('period')
  })

  it('is nothing when there is neither', () => {
    expect(lineShapeOf([column('amount', 'money'), column('kind', 'enum')], new Map()).name).toBeUndefined()
  })
})

describe('what an entry draws, and its Empty line (M53 U3, D-518)', () => {
  const columns = [
    { name: 'title', type: 'text', required: true, unit: undefined, values: [] },
    { name: 'state', type: 'enum', required: true, unit: undefined, values: ['inbox', 'done'] },
    { name: 'due', type: 'date', required: false, unit: undefined, values: [] },
    { name: 'estimate_h', type: 'real', required: false, unit: 'h', values: [] },
    { name: 'cost', type: 'decimal', required: false, unit: undefined, values: [] },
    { name: 'notes', type: 'text', required: false, unit: undefined, values: [] },
  ] as const
  const layout = entryLayout(columns, (column) => (column.type === 'text' ? 'line' : 'figure'), new Set())
  const filled = (names: readonly string[]) => (column: { readonly name: string }) => names.includes(column.name)
  const ask = {
    hidden: () => false,
    opened: new Set<string>(),
    asked: undefined,
    revealed: false,
    grid: () => false,
  }

  it('reads a label as words, dropping a suffix that names the column’s unit', () => {
    expect(entryLabel({ name: 'done_on' })).toBe('done on')
    expect(entryLabel({ name: 'estimate_h', unit: 'h' })).toBe('estimate')
    expect(entryLabel({ name: 'estimate_h' })).toBe('estimate h')
    expect(entryLabel({ name: 'h', unit: 'h' })).toBe('h')
  })

  it('says what a new entry needs in one line, with the right article', () => {
    expect(entryNeeds('Task', columns, (name) => name === 'state')).toBe('A task needs a title.')
    expect(entryNeeds('Ingredient', columns, (name) => name === 'title')).toBe('An ingredient needs a state.')
    expect(entryNeeds('Task', columns, () => true)).toBeUndefined()
    expect(withArticle('estimate')).toBe('an estimate')
  })

  it('starts only a required enum at its first member, and never one something implies', () => {
    expect(entryDefaults(columns)).toEqual({ state: 'inbox' })
    expect(entryDefaults(columns, new Set(['state']))).toEqual({})
  })

  it('draws what holds a value and what is required; the rest are the Empty line, in the view’s order', () => {
    const shown = entryShown(columns, layout, { ...ask, holds: filled(['title', 'due']) })
    expect(shown.header.map((each) => each.name)).toEqual(['state', 'due'])
    expect(shown.empty.map((each) => each.name)).toEqual(['estimate_h', 'cost', 'notes'])
  })

  it('sits two figures or fewer in the line under the title, unless something claims them as a grid', () => {
    const holds = filled(['title', 'estimate_h', 'cost'])
    const inLine = entryShown(columns, layout, { ...ask, holds })
    expect(inLine.header.map((each) => each.name)).toEqual(['state', 'estimate_h', 'cost'])
    expect(inLine.figures).toEqual([])
    const grid = entryShown(columns, layout, { ...ask, holds, grid: () => true })
    expect(grid.figures.map((each) => each.name)).toEqual(['estimate_h', 'cost'])
  })

  it('keeps a hidden column off the page and the Empty line until revealed, and counts it', () => {
    const hidden = (column: { readonly name: string }) => column.name === 'due'
    const kept = entryShown(columns, layout, { ...ask, hidden, holds: filled(['title', 'due']) })
    expect(kept.header.map((each) => each.name)).toEqual(['state'])
    expect(kept.empty.map((each) => each.name)).not.toContain('due')
    expect(kept.hidden).toBe(1)
    const revealed = entryShown(columns, layout, { ...ask, hidden, revealed: true, holds: filled(['title']) })
    expect(revealed.header.map((each) => each.name)).toEqual(['state', 'due'])
  })

  it('draws a field opened from the Empty line, and on a new entry the ones asked for', () => {
    const opened = entryShown(columns, layout, { ...ask, opened: new Set(['notes']), holds: filled([]) })
    expect(opened.texts.map((each) => each.name)).toEqual(['notes'])
    const fresh = entryShown(columns, layout, { ...ask, asked: new Set(['due']), holds: filled([]) })
    expect(fresh.header.map((each) => each.name)).toEqual(['state', 'due'])
  })
})

describe('a saved view’s name (M53 U5)', () => {
  it('is words on one line, never an address or a view’s own word', () => {
    expect(savedNameRefusal('Due today')).toBeUndefined()
    expect(savedNameRefusal('')).toMatch(/needs a name/)
    expect(savedNameRefusal(' Due')).toMatch(/space/)
    expect(savedNameRefusal('?state=open')).toMatch(/not an address/)
    expect(savedNameRefusal('List')).toMatch(/view’s own name/)
    expect(savedNameRefusal('x'.repeat(61))).toMatch(/at most 60/)
  })

  it('keeps an address with its question mark, or empty', () => {
    expect(savedAddress('state=open')).toBe('?state=open')
    expect(savedAddress('?')).toBe('')
  })
})

describe('a dashboard’s blocks (M53 U7)', () => {
  const block = (format: string, name: string): DashboardBlock => ({ dashboard: undefined, format, kind: 'saved', name, address: '' })
  const blocks = [block('task', 'Open'), block('task', 'Due today'), block('book', 'Due today'), block('task', 'Done by month')]
  const names = (each: readonly DashboardBlock[]): readonly string[] => each.map((one) => `${one.format}/${one.name}`)

  it('finds one by its name, or by its format’s when two formats share it', () => {
    expect(blockNamed(blocks, 'Open')).toEqual({ block: blocks[0] })
    expect(blockNamed(blocks, 'Due today')).toMatchObject({ reason: expect.stringMatching(/2 blocks are called Due today; say which: task\/Due today, book\/Due today/) })
    expect(blockNamed(blocks, 'book/Due today')).toEqual({ block: blocks[2] })
    expect(blockNamed(blocks, 'Late')).toMatchObject({ reason: expect.stringMatching(/No block here is called Late/) })
  })

  it('moves one, drops one before another, and orders by the names given first', () => {
    expect(names(blockMoved(blocks, 0, 2))).toEqual(['task/Due today', 'book/Due today', 'task/Open', 'task/Done by month'])
    expect(blockMoved(blocks, 0, -1)).toBe(blocks)
    expect(names(blockDropped(blocks, block('task', 'Done by month'), block('task', 'Open')))).toEqual([
      'task/Done by month',
      'task/Open',
      'task/Due today',
      'book/Due today',
    ])
    expect(names(blockDropped(blocks, block('task', 'Open'), undefined))).toEqual(['task/Due today', 'book/Due today', 'task/Done by month', 'task/Open'])
    expect(names(blocksInOrder(blocks, [block('task', 'Done by month')]))).toEqual(['task/Done by month', 'task/Open', 'task/Due today', 'book/Due today'])
  })

  it('names a headline total in one line, and keeps the word dashboard for the view', () => {
    expect(totalNameRefusal('Open')).toBeUndefined()
    expect(totalNameRefusal('')).toMatch(/needs a name/)
    expect(totalNameRefusal('Two\nlines')).toMatch(/one line/)
    expect(savedNameRefusal('Dashboard')).toMatch(/view’s own name/)
  })
})
