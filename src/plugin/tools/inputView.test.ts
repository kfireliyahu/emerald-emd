/**
 * **Input views** — M55 U2, D-533, D-536.
 *
 * The done-test: on a synthetic card-charge format, a conversation saves
 * *Card charge* asking merchant and amount, with date today and account Visa,
 * marks it the default, and writes two rows with only merchant and amount —
 * both dated today and on Visa. Then each refusal, the default mark one per
 * format, a text document carrying it, and the screen's three ways of starting
 * a new row agreeing with `entryDefaults`.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { defaultInputView, savedViews, saveView } from '@/data/repositories/formatViewRepository.ts'
import { openEncoded } from '@/data/storage/encoding.ts'
import { entryDefaults } from '@/domain/format/view.ts'
import { inputAddress } from '@/ui/formats/addressFilter.ts'
import { listPicture, quickAdd } from '@/ui/formats/listView.ts'
import { inputDefaults, newRowDefaults } from '@/ui/formats/savedView.ts'

import { declareFormatTool, formatRowsTool, formatsTool, recordFormatRowsTool } from './formats.ts'
import { showFormatTool } from './sheet.ts'
import { storeDocumentAsTool } from './storeAs.ts'
import { NO_CLIENT } from './tool.ts'
import { arrangeViewsTool } from './views.ts'
import { tempDir } from '../../testing/tempDir'

const ACCOUNT = {
  format: 'account',
  title: 'Account',
  columns: [{ name: 'name', type: 'text', required: true, unique: true }],
  nothing_must_hold: true,
}

const CHARGE = {
  format: 'charge',
  title: 'Card charge',
  columns: [
    { name: 'merchant', type: 'text', required: true },
    { name: 'amount', type: 'money', required: true },
    { name: 'date', type: 'date', required: true },
    { name: 'account', type: 'link', target: 'account', required: true },
    { name: 'state', type: 'enum', values: ['pending', 'cleared'], required: true },
    { name: 'note', type: 'text' },
  ],
  nothing_must_hold: true,
}

/** The clock, pinned: the calendar day here is `day`. */
function pin(day: string): void {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  vi.setSystemTime(new Date(year, month - 1, date, 9, 30))
}

async function charges(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-input-'), 'charges.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const declared = await declareFormatTool.run({ path, formats: [ACCOUNT, CHARGE], commit: true }, NO_CLIENT)
  expect(declared).not.toMatch(/refus/i)
  const accounts = [{ name: 'Visa' }, { name: 'Mastercard' }]
  expect(await recordFormatRowsTool.run({ path, format: 'account', rows: accounts, commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  return path
}

async function arrange(path: string, setting: Record<string, unknown>, commit = true): Promise<string> {
  return arrangeViewsTool.run({ path, settings: [{ format: 'charge', view: 'saved', ...setting }], commit }, NO_CLIENT)
}

const CARD_CHARGE = {
  name: 'Card charge',
  kind: 'input',
  fields: ['merchant', 'amount'],
  defaults: { date: 'today', account: 'Visa', state: 'pending' },
  default: true,
}

describe('input views (M55 U2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    pin('2026-11-03')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is saved from a conversation, marked the default, and writes rows from what they leave out', async () => {
    const path = await charges()
    expect(await arrange(path, CARD_CHARGE)).not.toMatch(/refus|cannot|needs/i)

    const rows = [
      { merchant: 'Corner cafe', amount: 4.5, amount_currency: 'ILS' },
      { merchant: 'Bookshop', amount: 62, amount_currency: 'ILS' },
    ]
    const dry = await recordFormatRowsTool.run({ path, format: 'charge', rows, view: 'Card charge' }, NO_CLIENT)
    expect(dry).toContain('**Row 1** — date, account and state from Card charge')
    expect(dry).toContain('- date: 2026-11-03')
    expect(await recordFormatRowsTool.run({ path, format: 'charge', rows, view: 'Card charge', commit: true }, NO_CLIENT)).toMatch(/2 rows added/)

    const table = await formatRowsTool.run({ path, format: 'charge', columns: ['merchant', 'date', 'account'] }, NO_CLIENT)
    expect(table).toContain('| Corner cafe | 2026-11-03 | Visa |')
    expect(table).toContain('| Bookshop | 2026-11-03 | Visa |')

    // A day later, the word is worked out again: today is the 4th.
    pin('2026-11-04')
    const next = await recordFormatRowsTool.run({ path, format: 'charge', rows: [{ merchant: 'Bakery', amount: 9, amount_currency: 'ILS', account: 'Mastercard' }], view: 'Card charge' }, NO_CLIENT)
    expect(next).toContain('- date: 2026-11-04')
    expect(next).toContain('**Row 1** — date and state from Card charge')

    const { db } = await openEncoded(readFileSync(path))
    expect(defaultInputView(db, 'charge')?.name).toBe('Card charge')
    db.close()
  })

  it('is named among the format’s views and drawn as a read-only form', async () => {
    const path = await charges()
    await arrange(path, CARD_CHARGE)
    const listed = await formatsTool.run({ path, format: 'charge' }, NO_CLIENT)
    expect(listed).toContain('**Input views**')
    expect(listed).toContain('`Card charge` (input, asks merchant, amount; defaults account Visa, date today, state pending; the format’s default)')
    const shown = await showFormatTool.run({ path, format: 'charge', view: 'Card charge' }, NO_CLIENT)
    const text = String(shown)
    expect(text).toContain('The input view Card charge of Card charge, the format’s default')
    expect(text).toContain('- merchant (required): text')
    expect(text).toContain('Adds as account Visa, date today, state pending.')
    // `format_rows` shows rows, and an input view shows none.
    await expect(formatRowsTool.run({ path, format: 'charge', view: 'Card charge' }, NO_CLIENT)).rejects.toThrow(/asks for rows/)
  })

  it('refuses a required column neither asked nor defaulted, a default its column refuses, and a computed column asked', async () => {
    const path = await charges()
    const missing = await arrange(path, { name: 'Bare', kind: 'input', fields: ['merchant'], defaults: { state: 'pending' } })
    expect(missing).toContain('Card charge needs amount, and this view neither asks it nor gives it a default.')
    expect(missing).toContain('Card charge needs date')
    expect(missing).toContain('Card charge needs account')

    const wrong = await arrange(path, { name: 'Wrong', kind: 'input', fields: ['merchant', 'amount', 'account'], defaults: { date: 'this week', state: 'settled' } })
    expect(wrong).toContain('date’s default names more than one day (this week)')
    expect(wrong).toMatch(/state’s default: .*settled/)

    const money = await arrange(path, { name: 'Money', kind: 'input', fields: ['merchant', 'date', 'account', 'state'], defaults: { amount: '12' } })
    expect(money).toContain('amount’s default is a figure and its currency')

    const shown = await arrange(path, { name: 'Shown', kind: 'input', fields: ['merchant'], match: { state: 'pending' } })
    expect(shown).toContain('An input view asks for rows rather than showing them')
    const table = await arrange(path, { name: 'Shown table', kind: 'table', fields: ['merchant'] })
    expect(table).toContain('`fields` goes with an input view')

    const { db } = await openEncoded(readFileSync(path))
    expect(savedViews(db, 'charge')).toEqual([])
    db.close()
  })

  it('refuses a computed column asked', async () => {
    const db = await createDatabase()
    const path = join(await tempDir('emerald-input-'), 'computed.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    const declared = await declareFormatTool.run(
      {
        path,
        formats: [
          {
            format: 'trip',
            title: 'Trip',
            columns: [
              { name: 'start', type: 'date', required: true },
              { name: 'end', type: 'date', required: true },
            ],
            computed: [{ name: 'days', works_out: 'end - start' }],
            nothing_must_hold: true,
          },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).not.toMatch(/refus/i)
    const refused = await arrangeViewsTool.run(
      { path, settings: [{ format: 'trip', view: 'saved', name: 'Trip', kind: 'input', fields: ['start', 'end', 'days'] }] },
      NO_CLIENT,
    )
    expect(refused).toContain('days is worked out, so an input view cannot ask it.')
  })

  it('refuses record_format_rows through a view of another kind', async () => {
    const path = await charges()
    await arrange(path, { name: 'Pending', kind: 'table', match: { state: 'pending' } })
    const refused = await recordFormatRowsTool.run({ path, format: 'charge', rows: [{ merchant: 'X' }], view: 'Pending' }, NO_CLIENT)
    expect(refused).toContain('Pending is a table view of charge; `view` here takes an input view')
    const none = await recordFormatRowsTool.run({ path, format: 'charge', rows: [{ merchant: 'X' }], view: 'Nope' }, NO_CLIENT)
    expect(none).toContain('no saved view called Nope')
  })

  it('keeps one default per format: marking another takes the mark', async () => {
    const path = await charges()
    await arrange(path, CARD_CHARGE)
    const dry = await arrange(path, { ...CARD_CHARGE, name: 'Cash', defaults: { date: 'today', account: 'Mastercard', state: 'cleared' } }, false)
    expect(dry).toContain('(the default)')
    await arrange(path, { ...CARD_CHARGE, name: 'Cash', defaults: { date: 'today', account: 'Mastercard', state: 'cleared' } })
    const { db } = await openEncoded(readFileSync(path))
    expect(savedViews(db, 'charge').map((each) => [each.name, each.isDefault === true])).toEqual([
      ['Card charge', false],
      ['Cash', true],
    ])
    // And only an input view takes it.
    expect(() => saveView(db, { format: 'charge', name: 'Pending', kind: 'table', address: '', isDefault: true })).toThrow(/Only an input view/)
    db.close()
    // `default: false` lets it go; a rename keeps it.
    await arrange(path, { name: 'Cash', rename: 'Cash spend' })
    let again = await openEncoded(readFileSync(path))
    expect(defaultInputView(again.db, 'charge')?.name).toBe('Cash spend')
    again.db.close()
    await arrange(path, { name: 'Cash spend', default: false })
    again = await openEncoded(readFileSync(path))
    expect(defaultInputView(again.db, 'charge')).toBeUndefined()
    again.db.close()
  })

  it('travels in a text document’s views part, the default mark with it', async () => {
    const path = await charges()
    await arrange(path, CARD_CHARGE)
    expect(await storeDocumentAsTool.run({ path, as: 'text', commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
    const text = readFileSync(path, 'utf8')
    expect(text).toMatch(/### charge saved\nname: Card charge\nkind: input\naddress: .*\ndefault: true/)
    const { db } = await openEncoded(readFileSync(path))
    const [view] = savedViews(db, 'charge')
    expect(view).toEqual({
      format: 'charge',
      name: 'Card charge',
      kind: 'input',
      address: inputAddress('charge', { fields: ['merchant', 'amount'], defaults: { account: 'Visa', date: 'today', state: 'pending' } }),
      isDefault: true,
    })
    db.close()
  })

  it('starts a new row on screen where entryDefaults says: the blank row, entry/new and quick add agree', async () => {
    const path = await charges()
    await arrange(path, { ...CARD_CHARGE, defaults: { date: 'yesterday', account: 'Visa' }, fields: ['merchant', 'amount', 'state'] })
    const { db } = await openEncoded(readFileSync(path))
    const declaration = listFormats(db).find((each) => each.name === 'charge')
    if (declaration === undefined) throw new Error('no charge')
    const day = '2026-11-03'
    const filter = { match: { state: 'cleared' } }
    // The rule itself: the input view's defaults, then the address's exact values, then a first member.
    const rule = entryDefaults(declaration.columns, new Set(), {
      input: inputDefaults(db, declaration, day),
      address: { state: 'cleared' },
    })
    expect(rule).toEqual({ date: '2026-11-02', account: 'Visa', state: 'cleared' })
    // The blank row and entry/new both start from `newRowDefaults`.
    expect(newRowDefaults(db, declaration, filter, day)).toEqual(rule)
    // Quick add's draft carries the same values.
    const picture = listPicture(db, declaration, listFormats(db), {}, new Map(), day)
    const asked = quickAdd(declaration, picture.shape, {}, filter, day, picture.names, undefined, undefined, inputDefaults(db, declaration, day))
    for (const [column, value] of Object.entries(rule)) expect(asked.draft[column]).toBe(value)
    // Off the filter, a required enum the view leaves to be asked starts at its first member.
    expect(newRowDefaults(db, declaration, {}, day)).toEqual({ date: '2026-11-02', account: 'Visa', state: 'pending' })
    db.close()
  })
})
