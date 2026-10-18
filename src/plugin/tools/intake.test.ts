/**
 * **Intake's tool half, driven against real files on disk** — M20 U7,
 * [D-235](../../../docs/09-decision-log.md).
 *
 * Two things are being checked here and they are not the same thing.
 *
 * The first is the tool: the ladder it climbs, the refusals it gives, the dry
 * run that writes nothing, and the supersede that takes back exactly what one
 * file wrote and keeps the mapping.
 *
 * The second is the **engine's reader against an `.xlsx` that was never near
 * it** — which U5 shipped without, and said so in `review.md`: *"no `.xlsx` has
 * been through it at all"*. `typed-cells.xlsx` is the pack's own synthetic card
 * statement, and it is the harder document of the two on purpose: two lines of
 * preamble and a note above a header on line 9, Hebrew headers, SheetJS date
 * cells beside a date written as text, `₪ 1,184.20`, a trailing-minus refund, a
 * boolean column, a blank line, and **a printed-total row under the data that
 * is not a row at all**. What the format says about it is what decides, and the
 * total row failing to type with its line named is the honest outcome rather
 * than a bug.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { countRows, insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { listIntakes } from '@/data/repositories/formatIntakeRepository.ts'
import { rowConstraint } from '@/domain/format/constraint.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { aggregate } from '@/domain/format/aggregate.ts'
import { identity } from '@/domain/format/identity.ts'

import { readersTool, readOntoFormatTool, supersedeReadingTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 8, 19)

const XLSX = fileURLToPath(new URL('../../../fixtures/synthetic/typed-cells.xlsx', import.meta.url))

/** What the pack's statement is, said as a declared format rather than as money code. */
const CHARGE: FormatDeclaration = {
  language: 4,
  name: 'card_charge',
  title: 'Card charge',
  notes: '',
  columns: [
    column('charged_on', 'date', { required: true }),
    column('merchant', 'text', { required: true }),
    column('amount', 'money'),
    column('recognised', 'boolean'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

/** A parent, so a fixed `link` has somewhere real to point. */
const SHOP: FormatDeclaration = {
  language: 4,
  name: 'shop',
  title: 'Shop',
  notes: '',
  columns: [column('name', 'text', { required: true })],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

/** A format that says what has to add up, so the dry run has a verdict to print. */
const PANTRY: FormatDeclaration = {
  language: 4,
  name: 'pantry_line',
  title: 'Pantry line',
  notes: '',
  columns: [
    column('name', 'text', { required: true }),
    column('grams', 'real', { unit: 'g' }),
    column('packs', 'integer'),
    column('total_g', 'real', { unit: 'g' }),
    column('shop', 'link', { target: 'shop' }),
  ],
  identities: [identity('packed', 'total_g = grams * packs')],
  aggregates: [],
  nothingMustHold: false,
}

async function documentWith(...declarations: readonly FormatDeclaration[]): Promise<string> {
  const db = await createDatabase()
  for (const declaration of declarations) {
    expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  }
  const bytes = exportDatabase(db)
  db.close()
  const directory = await tempDir('emerald-intake-')
  const path = join(directory, 'intake.emd')
  await writeFile(path, bytes)
  return path
}

async function reopen(path: string): Promise<Database> {
  return openDatabase(readFileSync(path))
}

/** A CSV written beside the document, because a reading needs a real file. */
async function csv(path: string, name: string, text: string): Promise<string> {
  const file = join(path, '..', name)
  await writeFile(file, text, 'utf8')
  return file
}

/** The mapping the header on line 9 of the card statement wants. */
const CHARGE_ARGS = {
  format: 'card_charge',
  file: XLSX,
  header_row: 8,
  columns: { 0: 'charged_on', 1: 'merchant', 3: 'amount', 6: 'recognised' },
  fixed: { amount_currency: 'ILS' },
}

describe('read_onto_format', () => {
  it('refuses a file it cannot read, and says what it does read', async () => {
    const path = await documentWith(CHARGE)
    await expect(
      readOntoFormatTool.run({ path, format: 'card_charge', file: 'payslip.pdf' }, NO_CLIENT),
    ).rejects.toThrow(/\.xlsx/)
    // And the sentence points at the way a PDF actually gets in, which is the
    // model reading it — not at a feature that does not exist.
    await expect(
      readOntoFormatTool.run({ path, format: 'card_charge', file: 'payslip.pdf' }, NO_CLIENT),
    ).rejects.toThrow(/record_format_rows/)
  })

  it('names the formats the document has when asked for one it has not', async () => {
    const answer = await readOntoFormatTool.run(
      { path: await documentWith(CHARGE), format: 'recipe', file: XLSX },
      NO_CLIENT,
    )
    expect(answer).toContain('no format called recipe')
    expect(answer).toContain('card_charge')
  })

  it('reads an .xlsx: typed cells, a Hebrew header under a preamble, and a total row that is not a row', async () => {
    const path = await documentWith(CHARGE)
    const answer = await readOntoFormatTool.run({ path, ...CHARGE_ARGS }, NO_CLIENT)

    // The file, said back: the sheet, where the header is, and which way round
    // the dates are — the three things a person checks before the mapping.
    expect(answer).toContain('typed-cells.xlsx')
    expect(answer).toContain('עסקאות')
    expect(answer).toContain('header on line 9')

    // The mapping, with the file's own header cell and its first value beside
    // every key. This is the grid said in text, and the sample is the half that
    // makes a moved column visible.
    expect(answer).toContain('תאריך עסקה')
    expect(answer).toContain('charged_on')
    expect(answer).toContain('amount_currency')

    // Six rows type, one blank line is skipped and said to be skipped, and the
    // printed-total row fails with its line named. D-138: the two counts are
    // two, and neither is folded into the other.
    expect(answer).toContain('6 rows')
    expect(answer).toMatch(/Every line of the file: \d+ lines: .*, 1 empty\./)
    expect(answer).toContain('1 row would not be read')
    expect(answer).toContain('| 17 |')

    // A SheetJS date cell, a shekel with a thousands separator, a trailing
    // minus, and a boolean — all of it read by the engine's own code and none
    // of it by the pack's.
    expect(answer).toContain('2026-07-11')
    expect(answer).toContain('₪1,184.20')
    expect(answer).toContain('שופרסל דיל 344')
    expect(answer).toContain('yes')

    // A dry run writes nothing and says so.
    expect(answer).toContain('Nothing has been written')
    const db = await reopen(path)
    expect(countRows(db, CHARGE)).toBe(0)
    db.close()
  })

  it('writes the rows and the record of them on commit, and says which reading wrote them', async () => {
    const path = await documentWith(CHARGE)
    const answer = await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)

    expect(answer).toContain('6 rows written from typed-cells.xlsx')
    expect(answer).toContain('supersede_reading')

    const db = await reopen(path)
    expect(countRows(db, CHARGE)).toBe(6)
    const intakes = listIntakes(db, 'card_charge')
    expect(intakes).toHaveLength(1)
    expect(intakes[0]?.rowCount).toBe(6)
    // The reading is stored with the rows, which is what makes the second read
    // of the same header cost nobody a mapping.
    expect(intakes[0]?.reading.headerRow).toBe(8)
    expect(intakes[0]?.reading.fixed).toEqual([{ key: 'amount_currency', value: 'ILS' }])
    db.close()
  })

  it('offers the reading back for a file with the same header, and names where it came from', async () => {
    const path = await documentWith(CHARGE)
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)

    // No `columns` and no `header_row` this time: the ladder's first rung is
    // the reading the document already has.
    const again = await readOntoFormatTool.run(
      { path, format: 'card_charge', file: XLSX },
      NO_CLIENT,
    )
    expect(again).toContain('already used for **typed-cells.xlsx**')
    expect(again).toContain('header on line 9')
    expect(again).toContain('6 rows')
    // Nothing moved, so it says nothing about order.
    expect(again).not.toContain('different order')
  })

  it('follows a column that moved by its header, and says so (M26 F1)', async () => {
    const path = await documentWith(CHARGE)
    const first = await csv(path, 'jul.csv', 'date,shop,sum\n2026-07-03,Pasta place,12.50\n')
    await readOntoFormatTool.run(
      {
        path,
        format: 'card_charge',
        file: first,
        columns: { 0: 'charged_on', 1: 'merchant', 2: 'amount' },
        fixed: { amount_currency: 'ILS' },
        commit: true,
      },
      NO_CLIENT,
    )
    const moved = await csv(path, 'aug.csv', 'sum,date,shop\n40.00,2026-08-09,Rice shop\n')
    const dry = await readOntoFormatTool.run({ path, format: 'card_charge', file: moved }, NO_CLIENT)
    expect(dry).toContain('different order')
    await readOntoFormatTool.run({ path, format: 'card_charge', file: moved, commit: true }, NO_CLIENT)

    const db = await reopen(path)
    const rows = listRows(db, CHARGE)
    db.close()
    expect(rows.map((row) => row.cells['merchant'])).toContain('Rice shop')
    expect(rows.map((row) => row.cells['charged_on'])).toContain('2026-08-09')
  })

  it('warns that this exact file is already in, and points at the tool that takes it back', async () => {
    const path = await documentWith(CHARGE)
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)

    const again = await readOntoFormatTool.run({ path, ...CHARGE_ARGS }, NO_CLIENT)
    expect(again).toContain('This exact file was read on')
    expect(again).toContain('wrote 6 rows')
    expect(again).toContain('supersede_reading')

    // The warning is a warning and not a gate: reading it again adds, exactly
    // as it says, because *nothing is auto-deleted*.
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)
    const db = await reopen(path)
    expect(countRows(db, CHARGE)).toBe(12)
    db.close()
  })

  it('refuses a column bound to a link whose target has no unique name', async () => {
    const path = await documentWith(SHOP, PANTRY)
    const file = await csv(path, 'pantry.csv', 'name,grams,shop\nPasta,1200,Rami Levy\n')

    const answer = await readOntoFormatTool.run(
      {
        path,
        format: 'pantry_line',
        file,
        columns: { 0: 'name', 1: 'grams', 2: 'shop' },
        commit: true,
      },
      NO_CLIENT,
    )
    // Two shops may share a name, so a cell naming one is a guess: refused out
    // loud, with what would make it a name (M24 U9, D-261).
    expect(answer).toContain('This reading will not run')
    expect(answer).toContain('name — which is not unique')
    expect(answer).toContain('Nothing was read')

    const db = await reopen(path)
    expect(countRows(db, PANTRY)).toBe(0)
    db.close()
  })

  it('refuses a fixed link that points at no row — the check the screen gets from its select', async () => {
    const path = await documentWith(SHOP, PANTRY)
    const file = await csv(path, 'pantry-2.csv', 'name,grams\nPasta,1200\n')

    const answer = await readOntoFormatTool.run(
      { path, format: 'pantry_line', file, fixed: { shop: 'not-a-row' }, commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('A link points at nothing')
    expect(answer).toContain('not-a-row')

    const db = await reopen(path)
    expect(countRows(db, PANTRY)).toBe(0)
    db.close()
  })

  it('holds a link for the whole file when the row is real, and proves the rows against the format', async () => {
    const path = await documentWith(SHOP, PANTRY)
    const db = await reopen(path)
    const [shopId] = insertRows(db, SHOP, [{ name: 'Rami Levy' }])
    await writeFile(path, exportDatabase(db))
    db.close()

    const file = await csv(
      path,
      'pantry-3.csv',
      'name,grams,packs,total_g\nPasta,500,2,1000\nRice,400,3,1100\nSalt,,,\n',
    )
    const answer = await readOntoFormatTool.run(
      { path, format: 'pantry_line', file, fixed: { shop: shopId ?? '' }, commit: true },
      NO_CLIENT,
    )

    expect(answer).toContain('3 rows written')
    // The verdict is the document's, not this tool's: one row adds up, one does
    // not, and one has nothing to check. `unchecked` is the ordinary answer.
    expect(answer).toContain('1 proved')
    expect(answer).toContain('1 failed')
    expect(answer).toContain('1 unchecked')

    const after = await reopen(path)
    const rows = listRows(after, PANTRY, { limit: 10 })
    expect(rows).toHaveLength(3)
    // One link, made once by a person, on every row of the file.
    expect(rows.every((row) => row.cells['shop'] === shopId)).toBe(true)
    after.close()
  })

  it('does not invite a commit when nothing would be written', async () => {
    const path = await documentWith(SHOP, PANTRY)
    const file = await csv(path, 'empty.csv', 'name,grams\n')
    const answer = await readOntoFormatTool.run({ path, format: 'pantry_line', file }, NO_CLIENT)

    expect(answer).toContain('Nothing types')
    expect(answer).not.toContain('commit: true` if they agree')
  })

  it('refuses a key the format has not got, by naming the keys it has', async () => {
    const path = await documentWith(CHARGE)
    await expect(
      readOntoFormatTool.run(
        { path, format: 'card_charge', file: XLSX, columns: { 0: 'paid_on' } },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/charged_on/)
  })
})

describe('a column of the file fills a link (M24 U9, D-261; H10)', () => {
  /** A card, called by its last four digits — unique, so they are a name. */
  const CARD: FormatDeclaration = {
    language: 5,
    name: 'card',
    title: 'Card',
    notes: '',
    columns: [column('last4', 'text', { required: true, unique: true })],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
  /** One statement, several cards: the line says which. */
  const LINE: FormatDeclaration = {
    language: 5,
    name: 'statement_line',
    title: 'Statement line',
    notes: '',
    columns: [
      column('charged_on', 'date', { required: true }),
      column('merchant', 'text', { required: true }),
      column('amount', 'money'),
      column('card', 'link', { target: 'card', required: true }),
    ],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  async function withCards(): Promise<string> {
    const path = await documentWith(CARD, LINE)
    const db = await reopen(path)
    insertRows(db, CARD, [{ last4: '0417' }, { last4: '5521' }])
    await writeFile(path, exportDatabase(db))
    db.close()
    return path
  }

  const STATEMENT =
    'date,merchant,amount,card\n' +
    '18/09/2026,Shufersal,120.50,0417\n' +
    '19/09/2026,Aroma,32,5521\n' +
    '20/09/2026,Paz,200,9999\n' +
    '21/09/2026,Superpharm,45.90,0417\n'

  const ARGS = {
    format: 'statement_line',
    columns: { 0: 'charged_on', 1: 'merchant', 2: 'amount', 3: 'card' },
    fixed: { amount_currency: 'ILS' },
  }

  it('fills each line’s card by its name, and refuses the line that names none, by line', async () => {
    const path = await withCards()
    const file = await csv(path, 'statement.csv', STATEMENT)

    const dry = await readOntoFormatTool.run({ path, file, ...ARGS }, NO_CLIENT)
    // The unknown card is a line that did not type, with the cell it named —
    // never a line written with no card.
    expect(dry).toContain('9999')
    expect(dry).toContain('card has no row with that id or that last4')
    // And the lines it would write show the card the file named, not its id.
    expect(dry).toContain('card: 0417')

    const answer = await readOntoFormatTool.run({ path, file, ...ARGS, commit: true }, NO_CLIENT)
    expect(answer).toContain('3 rows written')

    const db = await reopen(path)
    const cards = new Map(
      listRows(db, CARD, { limit: 10 }).map((row) => [row.cells['last4'], row.id]),
    )
    const lines = listRows(db, LINE, { limit: 10 })
    expect(lines).toHaveLength(3)
    // The id of the card the line named, and the leading zero survived the file.
    const byMerchant = new Map(lines.map((row) => [row.cells['merchant'], row.cells['card']]))
    expect(byMerchant.get('Shufersal')).toBe(cards.get('0417'))
    expect(byMerchant.get('Aroma')).toBe(cards.get('5521'))
    expect(byMerchant.get('Superpharm')).toBe(cards.get('0417'))
    expect(byMerchant.has('Paz')).toBe(false)
    db.close()
  })

  it('remembers the binding, so the next statement is read the same way with nothing asked', async () => {
    const path = await withCards()
    const first = await csv(path, 'september.csv', STATEMENT)
    await readOntoFormatTool.run({ path, file: first, ...ARGS, commit: true }, NO_CLIENT)

    const second = await csv(
      path,
      'october.csv',
      'date,merchant,amount,card\n02/10/2026,Aroma,28,5521\n',
    )
    const answer = await readOntoFormatTool.run(
      { path, file: second, format: 'statement_line', commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('1 row written')

    const db = await reopen(path)
    expect(countRows(db, LINE)).toBe(4)
    db.close()
  })

  it('takes a fixed link by name too, and still refuses one that names nothing', async () => {
    const path = await withCards()
    const file = await csv(path, 'one-card.csv', 'date,merchant,amount\n18/09/2026,Paz,90\n')
    const mapped = {
      format: 'statement_line',
      columns: { 0: 'charged_on', 1: 'merchant', 2: 'amount' },
    }

    const wrong = await readOntoFormatTool.run(
      { path, file, ...mapped, fixed: { amount_currency: 'ILS', card: '1111' }, commit: true },
      NO_CLIENT,
    )
    expect(wrong).toContain('A link points at nothing')

    const right = await readOntoFormatTool.run(
      { path, file, ...mapped, fixed: { amount_currency: 'ILS', card: '5521' }, commit: true },
      NO_CLIENT,
    )
    expect(right).toContain('1 row written')
  })
})

describe('supersede_reading', () => {
  it('lists what a format has read, and writes nothing doing it', async () => {
    const path = await documentWith(CHARGE)
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)

    const answer = await supersedeReadingTool.run(
      { path, format: 'card_charge' },
      NO_CLIENT,
    )
    expect(answer).toContain('typed-cells.xlsx')
    expect(answer).toContain('Call this again with `reading`')
    // A listing is not a write, so it must not end with an invitation to commit
    // one — a caller that followed it would spend a round trip to be told the
    // same sentence again (D-220).
    expect(answer).not.toContain('commit: true` if they agree')
  })

  it('says there is nothing to take back when nothing has been read', async () => {
    const answer = await supersedeReadingTool.run(
      { path: await documentWith(CHARGE), format: 'card_charge' },
      NO_CLIENT,
    )
    expect(answer).toContain('No file has been read onto Card charge')
  })

  it('names the readings it has when given an id it has not', async () => {
    const path = await documentWith(CHARGE)
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)

    const answer = await supersedeReadingTool.run(
      { path, format: 'card_charge', reading: 'nope' },
      NO_CLIENT,
    )
    expect(answer).toContain('no reading `nope`')
    expect(answer).toContain('typed-cells.xlsx')
  })

  it('takes back exactly what one file wrote, and keeps the mapping', async () => {
    const path = await documentWith(CHARGE)
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)

    const before = await reopen(path)
    const id = listIntakes(before, 'card_charge')[0]?.id ?? ''
    before.close()

    const dry = await supersedeReadingTool.run(
      { path, format: 'card_charge', reading: id },
      NO_CLIENT,
    )
    expect(dry).toContain('6 rows would be taken out of Card charge')
    expect(dry).toContain('Nothing has been written')

    const answer = await supersedeReadingTool.run(
      { path, format: 'card_charge', reading: id, commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('6 rows taken out of Card charge')

    const after = await reopen(path)
    expect(countRows(after, CHARGE)).toBe(0)
    // **The reading outlives the rows**, which is what makes supersede → fix
    // the file → read it again one call each rather than a fresh mapping.
    const intakes = listIntakes(after, 'card_charge')
    expect(intakes).toHaveLength(1)
    expect(intakes[0]?.rowCount).toBe(0)
    expect(intakes[0]?.reading.columns).toHaveLength(4)
    after.close()
  })

  it('offers nothing to do twice over the same reading', async () => {
    const path = await documentWith(CHARGE)
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)
    const db = await reopen(path)
    const id = listIntakes(db, 'card_charge')[0]?.id ?? ''
    db.close()

    await supersedeReadingTool.run({ path, format: 'card_charge', reading: id, commit: true }, NO_CLIENT)
    const again = await supersedeReadingTool.run(
      { path, format: 'card_charge', reading: id },
      NO_CLIENT,
    )
    expect(again).toContain('has no rows left')
    expect(again).not.toContain('commit: true` if they agree')
  })

  it('and after superseding, the same file is offered its own reading back', async () => {
    const path = await documentWith(CHARGE)
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)
    const db = await reopen(path)
    const id = listIntakes(db, 'card_charge')[0]?.id ?? ''
    db.close()
    await supersedeReadingTool.run({ path, format: 'card_charge', reading: id, commit: true }, NO_CLIENT)

    // No mapping sent, and no warning about a prior intake either, because
    // `priorIntake` asks about rows that still exist. The mapping comes back;
    // the offer to remove does not.
    const answer = await readOntoFormatTool.run(
      { path, format: 'card_charge', file: XLSX },
      NO_CLIENT,
    )
    expect(answer).toContain('already used for **typed-cells.xlsx**')
    expect(answer).not.toContain('This exact file was read on')
    expect(answer).toContain('6 rows')
  })
})

describe('a unique column, read from a file (M24 U4, D-255)', () => {
  const TAG: FormatDeclaration = {
    language: 5,
    name: 'tag',
    title: 'Tag',
    notes: '',
    columns: [column('name', 'text', { required: true, unique: true })],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  it('refuses a file that repeats a value, naming the lines, and writes nothing', async () => {
    const path = await documentWith(TAG)
    const file = await csv(path, 'tags.csv', 'name\nred\nblue\nred\n')
    const answer = await readOntoFormatTool.run(
      { path, format: 'tag', file, columns: { 0: 'name' }, commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('A unique column would repeat a value')
    expect(answer).toContain('"red"')
    const db = await reopen(path)
    expect(countRows(db, TAG)).toBe(0)
    db.close()
  })

  it('refuses a value the table already holds', async () => {
    const path = await documentWith(TAG)
    const db = await reopen(path)
    db.close()
    await readOntoFormatTool.run(
      { path, format: 'tag', file: await csv(path, 'one.csv', 'name\nred\n'), columns: { 0: 'name' }, commit: true },
      NO_CLIENT,
    )
    const again = await readOntoFormatTool.run(
      { path, format: 'tag', file: await csv(path, 'two.csv', 'name\ngreen\nred\n'), columns: { 0: 'name' }, commit: true },
      NO_CLIENT,
    )
    expect(again).toContain('already holds')
    const after = await reopen(path)
    expect(countRows(after, TAG)).toBe(1)
    after.close()
  })
})

describe('a row constraint, read from a file (M24 U7, D-259)', () => {
  const LINE: FormatDeclaration = {
    language: 7,
    name: 'line',
    title: 'Line',
    notes: '',
    columns: [
      column('direction', 'enum', { values: ['OUTFLOW', 'INFLOW'], required: true }),
      column('amount', 'integer', { required: true }),
    ],
    identities: [],
    aggregates: [],
    constraints: [rowConstraint('SIGN_WHEN', ['amount'], { when: 'direction', is: ['OUTFLOW'], sign: 'AT_MOST_ZERO' })],
    nothingMustHold: true,
  }

  it('refuses a file with a line that breaks it, naming the line, and writes nothing', async () => {
    const path = await documentWith(LINE)
    const file = await csv(path, 'lines.csv', 'direction,amount\nOUTFLOW,-40\nOUTFLOW,40\nINFLOW,40\n')
    const answer = await readOntoFormatTool.run(
      { path, format: 'line', file, columns: { 0: 'direction', 1: 'amount' }, commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('A line breaks a row constraint')
    expect(answer).toContain('amount is at most 0 when direction is OUTFLOW')
    const db = await reopen(path)
    expect(countRows(db, LINE)).toBe(0)
    db.close()
  })
})

describe('a reading writes its own header row (M24 U10, D-262)', () => {
  /** A statement is one printed total and many lines; the check is declared, not coded. */
  const STATEMENT: FormatDeclaration = {
    language: 5,
    name: 'statement',
    title: 'Statement',
    notes: '',
    columns: [column('period', 'text'), column('printed_total', 'money', { required: true })],
    aggregates: [
      aggregate('lines_total', 'SUM', { format: 'charge', column: 'statement' }, { expression: 'amount' }),
    ],
    identities: [identity('adds_up', 'lines_total = printed_total')],
    nothingMustHold: false,
  }
  const LINES: FormatDeclaration = {
    ...CHARGE,
    name: 'charge',
    title: 'Charge',
    columns: [...CHARGE.columns, column('statement', 'link', { target: 'statement', required: true })],
  }
  const HEADER = {
    format: 'statement',
    link: 'statement',
    // The period at the top, and the printed total under the lines — the last
    // row that holds anything, wherever that falls in this month's file.
    cells: { period: [3, 1], printed_total: [-1, 3] },
    fixed: { printed_total_currency: 'ILS' },
  }

  it('reads the printed total under the lines, and says the lines do not reach it', async () => {
    const path = await documentWith(STATEMENT, LINES)
    const answer = await readOntoFormatTool.run(
      { path, ...CHARGE_ARGS, format: 'charge', header: HEADER },
      NO_CLIENT,
    )

    // The position beside what the file shows there, and the line it landed on.
    expect(answer).toContain('The header row, one row of statement')
    expect(answer).toContain('row -1 (line 17), column 3')
    expect(answer).toContain('4210.55')
    // The total row is the header's now, not a line that would not be read.
    expect(answer).not.toContain('would not be read')
    // The synthetic statement's lines come to 849.99 against a printed 4,210.55:
    // the check runs, as the declaration, before anything exists.
    expect(answer).toContain('What Statement claims')
    expect(answer).toContain('adds_up: failed — ₪849.99 against ₪4,210.55')
    expect(answer).toContain('Nothing has been written')
  })

  it('writes one header row, links every line to it, and takes both back', async () => {
    const path = await documentWith(STATEMENT, LINES)
    const file = await csv(
      path,
      'july.csv',
      'Period,2026-07\n' +
        'date,merchant,amount\n' +
        '18/07/2026,Shufersal,120.50\n' +
        '19/07/2026,Aroma,32\n' +
        'Total,,₪152.50\n',
    )
    const args = {
      path,
      format: 'charge',
      file,
      header_row: 1,
      columns: { 0: 'charged_on', 1: 'merchant', 2: 'amount' },
      fixed: { amount_currency: 'ILS' },
      header: { ...HEADER, cells: { period: [0, 1], printed_total: [-1, 2] } },
    }

    const dry = await readOntoFormatTool.run(args, NO_CLIENT)
    expect(dry).toContain('2 rows')
    expect(dry).toContain("(this file's header row)")
    expect(dry).toContain('adds_up: proved — ₪152.50 against ₪152.50.')

    const answer = await readOntoFormatTool.run({ ...args, commit: true }, NO_CLIENT)
    expect(answer).toContain('2 rows written from july.csv')
    expect(answer).toContain('And one row of Statement')

    let db = await reopen(path)
    const [statement] = listRows(db, STATEMENT)
    expect(statement?.cells['printed_total_minor']).toBe(15250)
    expect(new Set(listRows(db, LINES).map((row) => row.cells['statement']))).toEqual(
      new Set([statement?.id]),
    )
    const [intake] = listIntakes(db, 'charge')
    db.close()

    const back = await supersedeReadingTool.run(
      { path, format: 'charge', reading: intake?.id, commit: true },
      NO_CLIENT,
    )
    expect(back).toContain('2 rows taken out')
    expect(back).toContain('The header row it wrote into statement went with them')
    db = await reopen(path)
    expect(countRows(db, LINES)).toBe(0)
    expect(countRows(db, STATEMENT)).toBe(0)
    db.close()
  })

  it('refuses the whole file when the header does not read, and a link the file also fills', async () => {
    const path = await documentWith(STATEMENT, LINES)
    const offFile = await readOntoFormatTool.run(
      {
        path,
        ...CHARGE_ARGS,
        format: 'charge',
        header: { ...HEADER, cells: { printed_total: [15, 3] } },
      },
      NO_CLIENT,
    )
    // Line 16 is the blank one: a required total that reads nothing is no statement.
    expect(offFile).toContain('The header row will not read')
    expect(offFile).toContain('printed_total')

    const twice = await readOntoFormatTool.run(
      {
        path,
        ...CHARGE_ARGS,
        format: 'charge',
        fixed: { ...CHARGE_ARGS.fixed, statement: 'x' },
        header: HEADER,
      },
      NO_CLIENT,
    )
    expect(twice).toContain('This reading will not run')
    expect(twice).toContain('the reading fills it')
  })
})

describe('readers (M26 F1)', () => {
  async function withOneReader(): Promise<string> {
    const path = await documentWith(CHARGE)
    await readOntoFormatTool.run({ path, ...CHARGE_ARGS, commit: true }, NO_CLIENT)
    return path
  }

  function idIn(listing: string): string {
    const id = /\| ([0-9a-f]{8}) \|/.exec(listing)?.[1]
    expect(id).toBeDefined()
    return id ?? ''
  }

  it('lists a format\u2019s readers with an id each, and writes nothing', async () => {
    const path = await withOneReader()
    const listing = await readersTool.run({ path, format: 'card_charge' }, NO_CLIENT)
    expect(listing).toContain('typed-cells.xlsx')
    expect(listing).not.toContain('commit: true')
    idIn(listing)
  })

  it('names a reader, and the name is what it is called after', async () => {
    const path = await withOneReader()
    const id = idIn(await readersTool.run({ path, format: 'card_charge' }, NO_CLIENT))
    const dry = await readersTool.run({ path, format: 'card_charge', rename: [{ reader: id, name: 'The card' }] }, NO_CLIENT)
    expect(dry).toContain('named **The card**')
    await readersTool.run(
      { path, format: 'card_charge', rename: [{ reader: id, name: 'The card' }], commit: true },
      NO_CLIENT,
    )
    const again = await readersTool.run({ path, format: 'card_charge' }, NO_CLIENT)
    expect(again).toContain('The card')
    const read = await readOntoFormatTool.run({ path, format: 'card_charge', file: XLSX }, NO_CLIENT)
    expect(read).toContain('already used for **The card**')
  })

  it('forgets a reader and keeps every row it wrote', async () => {
    const path = await withOneReader()
    const id = idIn(await readersTool.run({ path, format: 'card_charge' }, NO_CLIENT))
    const answer = await readersTool.run({ path, format: 'card_charge', forget: [id], commit: true }, NO_CLIENT)
    expect(answer).toContain('1 reader forgotten')

    const db = await reopen(path)
    expect(countRows(db, CHARGE)).toBe(6)
    db.close()
    expect(await readersTool.run({ path, format: 'card_charge' }, NO_CLIENT)).toContain('no readers yet')
    const read = await readOntoFormatTool.run({ path, format: 'card_charge', file: XLSX }, NO_CLIENT)
    expect(read).toContain('**guess**')
    // And what it wrote can still be taken back.
    const back = await supersedeReadingTool.run({ path, format: 'card_charge' }, NO_CLIENT)
    expect(back).toContain('typed-cells.xlsx')
    expect(back).not.toContain('already superseded')
  })

  it('refuses a reader the format has not got, and lists the ones it has', async () => {
    const path = await withOneReader()
    const answer = await readersTool.run({ path, format: 'card_charge', forget: ['00000000'], commit: true }, NO_CLIENT)
    expect(answer).toContain('has no reader `00000000`')
    const db = await reopen(path)
    expect(listIntakes(db, 'card_charge')[0]?.forgotten).toBe(false)
    db.close()
  })
})

describe('a cell holding several of a list, split by the mapping (M34 U5, D-398)', () => {
  const RECIPE: FormatDeclaration = {
    language: 22,
    name: 'recipe',
    title: 'Recipe',
    notes: '',
    columns: [
      column('name', 'text', { required: true }),
      column('tags', 'enums', { values: ['vegan', 'quick', 'one pot'] }),
    ],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
  const FILE = 'name,tags\nLentil soup,"Vegan, one pot"\nToast,"quick, vegan"\nCurry,"vegan, spicy"\n'

  it('splits by the separator stated, refuses a line naming a member off the list, and counts every line', async () => {
    const path = await documentWith(RECIPE)
    const file = await csv(path, 'recipes.csv', FILE)
    const args = { path, format: 'recipe', file, columns: { 0: 'name', 1: 'tags' }, separators: { tags: ',' } }
    const dry = await readOntoFormatTool.run(args, NO_CLIENT)
    expect(dry).toContain('tags, split by ","')
    expect(dry).toContain('"spicy"')
    expect(dry).toContain('4 lines: 1 heading, 2 read, 1 refused.')

    await readOntoFormatTool.run({ ...args, commit: true }, NO_CLIENT)
    const db = await reopen(path)
    expect(listRows(db, RECIPE, { order: 'name' }).map((row) => row.cells['tags'])).toEqual([
      ['vegan', 'one pot'],
      ['quick', 'vegan'],
    ])
    // The reader keeps the separator, so the next file splits the same way.
    expect(listIntakes(db, 'recipe')[0]?.reading.columns.find((each) => each.key === 'tags')?.separator).toBe(',')
    db.close()
  })

  it('refuses a separator for a key that is not several of a list', async () => {
    const path = await documentWith(RECIPE)
    const file = await csv(path, 'recipes.csv', FILE)
    await expect(
      readOntoFormatTool.run({ path, format: 'recipe', file, columns: { 0: 'name', 1: 'tags' }, separators: { name: ',' } }, NO_CLIENT),
    ).rejects.toThrow(/several of a list/)
  })
})
