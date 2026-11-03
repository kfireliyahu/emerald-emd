/**
 * **An input view as a dashboard block, and quick add with its fields** —
 * M55 U4, D-533, D-535.
 *
 * The done-test on a synthetic card-charge format: *Card charge* asks
 * merchant and amount and sets date today and account Visa; its block adds
 * three charges, removing the block leaves the view, and quick add with the
 * view's fields writes *Lunch spot* and 35 each into its column, dated today.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Database } from 'sql.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { deleteRows, insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { dashboardBlocks, savedView, setDashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import { setDocumentCurrency } from '@/data/repositories/unitRepository.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { InputShape } from '@/domain/format/inputView.ts'
import { sameBlock } from '@/domain/format/view.ts'

import { inputShapeOf } from './addressFilter.ts'
import { InputBlock } from './InputBlock.tsx'
import {
  blockSentence,
  inputBlock,
  inputMadeRefusal,
  inputStart,
  makeInputView,
  stageInput,
  undoRefusal,
  writeInput,
  type InputMade,
} from './inputBlock.ts'
import { listPicture, quickAdd, quickFieldsOf } from './listView.ts'

const NOW = Date.UTC(2026, 10, 3)
const DAY = '2026-11-03'

const ACCOUNT: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'account',
  title: 'Account',
  notes: '',
  columns: [column('name', 'text', { required: true, unique: true })],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const CHARGE: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'card_charge',
  title: 'Card charge',
  notes: '',
  columns: [
    column('merchant', 'text', { required: true }),
    column('amount', 'money', { required: true }),
    column('date', 'date', { required: true }),
    column('account', 'link', { target: 'account', required: true }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const SHAPE: InputShape = { fields: ['merchant', 'amount'], defaults: { date: 'today', account: 'Visa' } }

const MADE: InputMade = { dashboard: undefined, format: 'card_charge', name: 'Card charge', shape: SHAPE, isDefault: true }

async function charges(): Promise<Database> {
  const db = await createDatabase()
  expect(adoptFormat(db, ACCOUNT, NOW).refusals).toEqual([])
  expect(adoptFormat(db, CHARGE, NOW).refusals).toEqual([])
  setDocumentCurrency(db, 'ILS')
  insertRows(db, ACCOUNT, [{ name: 'Visa' }, { name: 'Mastercard' }])
  return db
}

/** Every charge, as text a test can read: `Lunch spot · 35 ILS · 2026-11-03 · Visa`. */
function written(db: Database): readonly string[] {
  const accounts = new Map(listRows(db, ACCOUNT).map((row) => [row.id, String(row.cells['name'])]))
  return listRows(db, CHARGE, { order: 'merchant' }).map((row) =>
    [row.cells['merchant'], `${String(Number(row.cells['amount_minor']) / 100)} ${String(row.cells['amount_currency'])}`, row.cells['date'], accounts.get(String(row.cells['account']))].join(' · '),
  )
}

describe('an input view as a dashboard block (M55 U4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 3, 9, 30))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says what it sets under its title, and nothing more when it sets nothing', () => {
    expect(blockSentence(CHARGE, SHAPE)).toBe('Adds a card charge as date today · account Visa')
    expect(blockSentence(CHARGE, { fields: ['merchant', 'amount', 'date', 'account'], defaults: {} })).toBe('Adds a card charge')
  })

  it('is made and placed in one step, and removing the block leaves the view', async () => {
    const db = await charges()
    expect(inputMadeRefusal(db, CHARGE, MADE)).toBeUndefined()
    makeInputView(db, [], MADE)
    const blocks = dashboardBlocks(db, undefined)
    expect(blocks).toEqual([inputBlock(MADE)])
    expect(savedView(db, 'card_charge', 'Card charge')?.kind).toBe('input')
    expect(inputShapeOf(savedView(db, 'card_charge', 'Card charge')?.address ?? '', 'card_charge')).toEqual(SHAPE)

    // A name taken, and a view that leaves a required column neither asked nor set, are refused.
    expect(inputMadeRefusal(db, CHARGE, MADE)).toBe('Card charge already has a view called Card charge.')
    expect(inputMadeRefusal(db, CHARGE, { ...MADE, name: 'Cash', shape: { fields: ['merchant'], defaults: {} } })).toMatch(/amount/)

    setDashboardBlocks(db, undefined, blocks.filter((each) => !sameBlock(each, inputBlock(MADE))))
    expect(dashboardBlocks(db, undefined)).toEqual([])
    expect(savedView(db, 'card_charge', 'Card charge')?.kind).toBe('input')
  })

  it('adds three charges, each dated today and on Visa, and takes one back', async () => {
    const db = await charges()
    const startsAt = inputStart(CHARGE, SHAPE, DAY, undefined, 'ILS')
    const ids: string[] = []
    for (const [merchant, amount] of [['Corner cafe', '4.5'], ['Bookshop', '62'], ['Bakery', '9']] as const) {
      const staged = stageInput(db, CHARGE, { ...startsAt, merchant, amount }, startsAt, DAY, [ACCOUNT, CHARGE])
      if (!('row' in staged)) throw new Error(staged.problems.map((each) => each.reason).join(' '))
      writeInput(db, CHARGE, staged.row)
      ids.push(staged.row.id)
    }
    expect(written(db)).toEqual(['Bakery · 9 ILS · 2026-11-03 · Visa', 'Bookshop · 62 ILS · 2026-11-03 · Visa', 'Corner cafe · 4.5 ILS · 2026-11-03 · Visa'])

    expect(undoRefusal(db, CHARGE, ids[2] ?? '', [ACCOUNT, CHARGE])).toBeUndefined()
    deleteRows(db, CHARGE, [ids[2] ?? ''], [ACCOUNT, CHARGE])
    expect(written(db)).toHaveLength(2)
    // A row another names is kept, and says why.
    const visa = listRows(db, ACCOUNT).find((row) => row.cells['name'] === 'Visa')?.id ?? ''
    expect(undoRefusal(db, ACCOUNT, visa, [ACCOUNT, CHARGE])).toBe('Kept: 2 rows link to it.')
  })

  it('is drawn read-only — its fields, and no Add — where nothing is written, as show_format draws it', async () => {
    const db = await charges()
    makeInputView(db, [], MADE)
    const view = savedView(db, 'card_charge', 'Card charge')
    if (view === undefined) throw new Error('not saved')
    const draw = (locked: boolean): string =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(InputBlock, { db, declaration: CHARGE, declarations: [ACCOUNT, CHARGE], view, dashboard: undefined, day: DAY, locked, fill: false, width: 2 }),
        ),
      )
    expect(draw(false)).toMatch(/>Add</)
    const frame = draw(true)
    expect(frame).toContain('data-field="merchant"')
    expect(frame).toContain('data-field="amount"')
    expect(frame).not.toMatch(/>Add</)
  })

  it('refuses every problem at once, each at its field, and a row nobody typed into', async () => {
    const db = await charges()
    const startsAt = inputStart(CHARGE, SHAPE, DAY, undefined, 'ILS')
    expect(stageInput(db, CHARGE, startsAt, startsAt, DAY, [ACCOUNT, CHARGE])).toEqual({
      problems: [{ column: undefined, reason: 'Nothing has been filled in yet.' }],
    })
    const staged = stageInput(db, CHARGE, { ...startsAt, amount: 'abc' }, startsAt, DAY, [ACCOUNT, CHARGE])
    expect('problems' in staged ? staged.problems.map((each) => each.column) : []).toEqual(['merchant', 'amount'])
    expect(written(db)).toEqual([])
  })
})

describe('quick add with the view’s fields (M55 U4)', () => {
  it('asks the view’s fields in its order, names what it sets, and writes each into its column', async () => {
    const db = await charges()
    const picture = listPicture(db, CHARGE, [ACCOUNT, CHARGE], {}, new Map(), DAY)
    const input = { date: DAY, account: 'Visa' }
    const asked = quickAdd(CHARGE, picture.shape, {}, {}, DAY, picture.names, undefined, 'ILS', input, SHAPE.fields)
    expect(asked.placeholder).toBe('Add a card charge · date today, Visa')
    const fields = quickFieldsOf(CHARGE, SHAPE.fields, asked.draft, picture.names)
    expect(fields.map((each) => [each.column.name, each.label, each.start])).toEqual([
      ['merchant', 'merchant', ''],
      ['amount', 'amount', ''],
    ])

    // 'Lunch spot', Tab, 35, Enter: nothing parsed from the text.
    const draft = { ...asked.draft, merchant: 'Lunch spot', amount: '35' }
    const staged = stageInput(db, CHARGE, draft, asked.draft, DAY, [ACCOUNT, CHARGE])
    if (!('row' in staged)) throw new Error(staged.problems.map((each) => each.reason).join(' '))
    writeInput(db, CHARGE, staged.row)
    expect(written(db)).toEqual(['Lunch spot · 35 ILS · 2026-11-03 · Visa'])
  })

  it('takes a group’s value over the view’s default, and a field asking the grouped column starts holding it', async () => {
    const db = await charges()
    const mastercard = listRows(db, ACCOUNT).find((row) => row.cells['name'] === 'Mastercard')?.id ?? ''
    const picture = listPicture(db, CHARGE, [ACCOUNT, CHARGE], {}, new Map(), DAY)
    const names = new Map([[mastercard, 'Mastercard']])
    const shape = { fields: ['merchant', 'account'], defaults: { date: 'today', account: 'Visa' } }
    const asked = quickAdd(CHARGE, picture.shape, { account: mastercard }, {}, DAY, names, undefined, 'ILS', { date: DAY, account: 'Visa' }, shape.fields)
    expect(asked.placeholder).toBe('Add a card charge · date today')
    const fields = quickFieldsOf(CHARGE, shape.fields, asked.draft, names)
    expect(fields.find((each) => each.column.name === 'account')?.start).toBe('Mastercard')
  })
})
