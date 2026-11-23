import { copyFile, readFile, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { exportEncoded } from '@/data/storage/encoding.ts'

import { parseExportArgs, runExport } from './exportCommand.ts'
import { exportFormatRowsTool } from './tools/exportRows.ts'
import { declareFormatTool, recordFormatRowsTool, updateFormatRowsTool } from './tools/formats.ts'
import { storeDocumentAsTool } from './tools/storeAs.ts'
import { NO_CLIENT } from './tools/tool.ts'
import { tempDir } from '../testing/tempDir'

/**
 * **A format's rows to a JSON file** (M63 U1, D-601) — every type's value, the
 * same bytes from a document stored as text and as SQLite, twice; `--check`'s
 * three answers; and the tool kept inside the document's folder. The document
 * is made here, never a real one (D-390). And a child format folded into each
 * row (M63 U2).
 */

async function emptyDocument(path: string): Promise<void> {
  const db = await createDatabase()
  const bytes = await exportEncoded(db, 'sqlite')
  db.close()
  if (!bytes.ok) throw new Error(bytes.error)
  await writeFile(path, bytes.value)
}

async function call(tool: typeof declareFormatTool, args: Record<string, unknown>): Promise<string> {
  return tool.run({ ...args, commit: true }, NO_CLIENT)
}

/** A made-up shop: a supplier format, and an item linking to it with one column of every kind. */
async function shop(root: string): Promise<string> {
  const path = `${root}/shop.emd`
  await emptyDocument(path)
  expect(
    await call(declareFormatTool, {
      path,
      format: 'supplier',
      title: 'Supplier',
      columns: [
        { name: 'name', type: 'text', required: true },
        { name: 'code', type: 'text' },
      ],
    }),
  ).toContain('is declared')
  expect(
    await call(declareFormatTool, {
      path,
      format: 'item',
      title: 'Item',
      columns: [
        { name: 'name', type: 'text', required: true },
        { name: 'count', type: 'integer' },
        { name: 'ratio', type: 'real' },
        { name: 'bought', type: 'date' },
        { name: 'in_stock', type: 'boolean' },
        { name: 'state', type: 'enum', values: ['planned', 'kept', 'dropped'] },
        { name: 'price', type: 'money' },
        { name: 'supplier', type: 'link', target: 'supplier' },
        { name: 'weight', type: 'quantity' },
        { name: 'rate', type: 'decimal', scale: 4 },
        { name: 'month', type: 'month' },
        { name: 'alternates', type: 'links', target: 'supplier' },
        { name: 'fee', type: 'percent' },
        { name: 'tags', type: 'enums', values: ['quick', 'cheap', 'local'] },
        { name: 'note', type: 'text' },
      ],
      derived: [{ name: 'follow_up', works_out: 'bought + 7 days' }],
    }),
  ).toContain('is declared')
  expect(
    await call(recordFormatRowsTool, {
      path,
      format: 'supplier',
      rows: [
        { name: 'North mill', code: 'NM' },
        { name: 'South farm', code: 'SF' },
      ],
    }),
  ).toContain('2 rows added')
  expect(
    await call(recordFormatRowsTool, {
      path,
      format: 'item',
      rows: [
        {
          name: 'Flour',
          count: 3,
          ratio: 0.5,
          bought: '2026-01-05',
          in_stock: true,
          state: 'kept',
          price: '12.90',
          price_currency: 'ILS',
          supplier: 'North mill',
          weight: 1.5,
          weight_unit: 'kg',
          rate: '3.1250',
          month: '2026-01',
          alternates: ['South farm', 'North mill'],
          fee: '0.0045%',
          tags: ['local', 'quick'],
        },
        { name: 'Bread', state: 'planned', in_stock: false, price: '-4.00', price_currency: 'USD', fee: '17%' },
        { name: 'Apples', state: 'dropped' },
      ],
    }),
  ).toContain('3 rows added')
  return path
}

const FLOUR = `  {
    "name": "Flour",
    "count": 3,
    "ratio": 0.5,
    "bought": "2026-01-05",
    "in_stock": true,
    "state": "kept",
    "price": "12.90",
    "price_currency": "ILS",
    "supplier": "North mill",
    "weight": "1.5",
    "weight_unit": "kg",
    "rate": 3.125,
    "month": "2026-01",
    "alternates": [
      "South farm",
      "North mill"
    ],
    "fee": 0.000045,
    "tags": [
      "local",
      "quick"
    ]
  }`

const BREAD = `  {
    "name": "Bread",
    "in_stock": false,
    "state": "planned",
    "price": "-4.00",
    "price_currency": "USD",
    "fee": 0.17
  }`

describe('export (M63 U1, D-601)', () => {
  it('writes every type plainly, the same bytes from text and from SQLite, and the same bytes twice', async () => {
    const root = (await tempDir('emerald-export-')).replace(/\\/g, '/')
    const sqlite = await shop(root)
    const text = `${root}/shop-text.emd`
    await copyFile(sqlite, text)
    expect(await storeDocumentAsTool.run({ path: text, as: 'text', commit: true }, NO_CLIENT)).not.toContain('REFUSED')
    expect((await readFile(text, 'utf8')).startsWith('SQLite format')).toBe(false)

    const lines: string[] = []
    const output = { line: (line: string) => lines.push(line), complain: (line: string) => lines.push(`! ${line}`) }
    const run = async (argv: readonly string[]): Promise<number> => {
      const args = parseExportArgs(argv, root)
      if (!args.ok) throw new Error(args.error)
      return runExport(args.value, output)
    }

    // Ordered by the label column, as `format_rows` is: Apples, Bread, Flour.
    expect(await run([sqlite, '--format', 'item', '--to', 'a.json'])).toBe(0)
    const written = await readFile(`${root}/a.json`, 'utf8')
    expect(written).toBe(`[\n  {\n    "name": "Apples",\n    "state": "dropped"\n  },\n${BREAD},\n${FLOUR}\n]\n`)
    expect(lines.at(-1)).toBe(`Wrote 3 rows of item to ${root}/a.json.`)

    expect(await run([text, '--format', 'item', '--to', 'b.json'])).toBe(0)
    expect(await readFile(`${root}/b.json`, 'utf8')).toBe(written)

    expect(await run([sqlite, '--format', 'item', '--to', 'a.json'])).toBe(0)
    expect(await readFile(`${root}/a.json`, 'utf8')).toBe(written)
    expect(lines.at(-1)).toContain('already holds 3 rows of item')
  })

  it('filters as format_rows does, names a link by the column asked, and writes ids and a computed column only when asked', async () => {
    const root = (await tempDir('emerald-export-')).replace(/\\/g, '/')
    const path = await shop(root)
    const output = { line: () => undefined, complain: (line: string) => { throw new Error(line) } }
    const args = parseExportArgs(
      [path, '--format', 'item', '--to', 'kept.json', '--match', 'state=kept', '--match', 'state=planned', '--order', 'name', '--descending',
        '--columns', 'name,supplier,alternates,follow_up', '--link', 'supplier=code', '--link', 'alternates=code'],
      root,
    )
    if (!args.ok) throw new Error(args.error)
    expect(await runExport(args.value, output)).toBe(0)
    expect(await readFile(`${root}/kept.json`, 'utf8')).toBe(
      '[\n  {\n    "name": "Flour",\n    "supplier": "NM",\n    "alternates": [\n      "SF",\n      "NM"\n    ],\n    "follow_up": "2026-01-12"\n  },\n' +
        '  {\n    "name": "Bread"\n  }\n]\n',
    )

    const ids = parseExportArgs([path, '--format', 'supplier', '--to', 'ids.json', '--ids', '--match', 'code=NM'], root)
    if (!ids.ok) throw new Error(ids.error)
    expect(await runExport(ids.value, output)).toBe(0)
    expect(await readFile(`${root}/ids.json`, 'utf8')).toMatch(/^\[\n {2}\{\n {4}"id": "[0-9a-f-]{36}",\n {4}"name": "North mill",\n {4}"code": "NM"\n {2}\}\n\]\n$/)
  })

  it('checks without writing: 0 when current, 1 when changed or missing, 2 for bad arguments', async () => {
    const root = (await tempDir('emerald-export-')).replace(/\\/g, '/')
    const path = await shop(root)
    const lines: string[] = []
    const output = { line: (line: string) => lines.push(line), complain: (line: string) => lines.push(`! ${line}`) }
    const check = async (argv: readonly string[]): Promise<number> => {
      const args = parseExportArgs(argv, root)
      return args.ok ? runExport(args.value, output) : 2
    }

    expect(await check([path, '--format', 'supplier', '--to', 's.json', '--check'])).toBe(1)
    expect(lines.at(-1)).toBe(`${root}/s.json is missing; the export would write 2 rows of supplier.`)
    expect(await check([path, '--format', 'supplier', '--to', 's.json'])).toBe(0)
    expect(await check([path, '--format', 'supplier', '--to', 's.json', '--check'])).toBe(0)
    expect(lines.at(-1)).toBe(`${root}/s.json is current: 2 rows of supplier.`)

    expect(await call(recordFormatRowsTool, { path, format: 'supplier', rows: [{ name: 'East dairy' }] })).toContain('1 row added')
    const before = await readFile(`${root}/s.json`, 'utf8')
    expect(await check([path, '--format', 'supplier', '--to', 's.json', '--check'])).toBe(1)
    expect(lines.at(-1)).toContain('s.json differs from 3 rows of supplier')
    expect(await readFile(`${root}/s.json`, 'utf8')).toBe(before)

    expect(await check([path, '--format', 'nothing', '--to', 's.json', '--check'])).toBe(2)
    expect(lines.at(-1)).toContain('has no format called nothing')
    expect(await check([path, '--format', 'supplier', '--to', 's.json', '--columns', 'colour'])).toBe(2)
    expect(lines.at(-1)).toContain('supplier has no column colour')
    expect(await check([path, '--format', 'supplier', '--to', 's.json', '--link', 'name=code'])).toBe(2)
    expect(parseExportArgs([path, '--to', 's.json'], root).ok).toBe(false)
    expect(parseExportArgs([path, '--format', 'supplier', '--to', 's.json', '--colour'], root).ok).toBe(false)
  })

  it('leaves out a column emptied by an edit, as a row that never had it', async () => {
    const root = (await tempDir('emerald-export-')).replace(/\\/g, '/')
    const path = await shop(root)
    const tool = (args: Record<string, unknown>): Promise<string> => exportFormatRowsTool.run({ path, format: 'supplier', ...args }, NO_CLIENT)
    expect(await tool({ to: 'out/s.json', columns: ['name', 'code'] })).toBe(`Wrote 2 rows of supplier to ${root}/out/s.json.`)
    const north = (await readFile(`${root}/out/s.json`, 'utf8')).includes('"code": "NM"')
    expect(north).toBe(true)
    const rows = await exportFormatRowsTool.run({ path, format: 'supplier', to: 'id.json', ids: true }, NO_CLIENT)
    expect(rows).toContain('Wrote 2 rows')
    const id = /"id": "([^"]+)",\n {4}"name": "North mill"/.exec(await readFile(`${root}/id.json`, 'utf8'))?.[1]
    expect(await call(updateFormatRowsTool, { path, format: 'supplier', edits: [{ id, values: { code: null } }] })).toContain('1 row')
    expect(await tool({ to: 'out/s.json', check: true })).toContain('differs from 2 rows of supplier')
    expect(await tool({ to: 'out/s.json' })).toContain('Wrote 2 rows')
    expect(await readFile(`${root}/out/s.json`, 'utf8')).toBe('[\n  {\n    "name": "North mill"\n  },\n  {\n    "name": "South farm",\n    "code": "SF"\n  }\n]\n')
  })

  it('the tool writes only inside the document’s folder', async () => {
    const root = (await tempDir('emerald-export-')).replace(/\\/g, '/')
    const path = await shop(root)
    await expect(exportFormatRowsTool.run({ path, format: 'supplier', to: '../x.json' }, NO_CLIENT)).rejects.toThrow(
      /outside .* This tool writes only inside the document's folder/,
    )
    const other = (await tempDir('emerald-export-other-')).replace(/\\/g, '/')
    await expect(exportFormatRowsTool.run({ path, format: 'supplier', to: `${other}/x.json` }, NO_CLIENT)).rejects.toThrow(/outside/)
    expect(await exportFormatRowsTool.run({ path, format: 'supplier', to: 'x.json', check: true }, NO_CLIENT)).toContain('is missing')
  })
})

/** A made-up deck: cards, their keywords by position, and a pair format linking to card twice. */
async function deck(root: string): Promise<string> {
  const path = `${root}/deck.emd`
  await emptyDocument(path)
  expect(
    await call(declareFormatTool, {
      path,
      format: 'card',
      title: 'Card',
      columns: [
        { name: 'name', type: 'text', required: true },
        { name: 'price', type: 'money' },
      ],
    }),
  ).toContain('is declared')
  expect(
    await call(declareFormatTool, {
      path,
      format: 'keyword',
      title: 'Keyword',
      columns: [
        { name: 'word', type: 'text', required: true },
        { name: 'position', type: 'integer' },
        { name: 'card', type: 'link', target: 'card' },
        { name: 'cost', type: 'money' },
      ],
    }),
  ).toContain('is declared')
  expect(
    await call(declareFormatTool, {
      path,
      format: 'pair',
      title: 'Pair',
      columns: [
        { name: 'name', type: 'text', required: true },
        { name: 'left', type: 'link', target: 'card' },
        { name: 'right', type: 'link', target: 'card' },
      ],
    }),
  ).toContain('is declared')
  expect(
    await call(recordFormatRowsTool, {
      path,
      format: 'card',
      rows: [{ name: 'Ember', price: '2.50', price_currency: 'ILS' }, { name: 'Frost' }],
    }),
  ).toContain('2 rows added')
  expect(
    await call(recordFormatRowsTool, {
      path,
      format: 'keyword',
      rows: [
        { word: 'burn', position: 2, card: 'Ember', cost: '1.00', cost_currency: 'ILS' },
        { word: 'haste', position: 1, card: 'Ember' },
        { word: 'ash', position: 3, card: 'Ember' },
      ],
    }),
  ).toContain('3 rows added')
  expect(await call(recordFormatRowsTool, { path, format: 'pair', rows: [{ name: 'Clash', left: 'Ember', right: 'Frost' }] })).toContain('1 row added')
  return path
}

const NESTED =
  '[\n' +
  '  {\n    "name": "Ember",\n    "price": "2.50",\n    "price_currency": "ILS",\n    "keywords": [\n' +
  '      {\n        "word": "haste",\n        "position": 1\n      },\n' +
  '      {\n        "word": "burn",\n        "position": 2,\n        "cost": "1.00",\n        "cost_currency": "ILS"\n      },\n' +
  '      {\n        "word": "ash",\n        "position": 3\n      }\n' +
  '    ]\n  },\n' +
  '  {\n    "name": "Frost",\n    "keywords": []\n  }\n' +
  ']\n'

describe('export --nest (M63 U2)', () => {
  it('folds a child format in by position, its link back left out and [] for a row with none, the same bytes from text and SQLite', async () => {
    const root = (await tempDir('emerald-export-nest-')).replace(/\\/g, '/')
    const sqlite = await deck(root)
    const text = `${root}/deck-text.emd`
    await copyFile(sqlite, text)
    expect(await storeDocumentAsTool.run({ path: text, as: 'text', commit: true }, NO_CLIENT)).not.toContain('REFUSED')

    const lines: string[] = []
    const output = { line: (line: string) => lines.push(line), complain: (line: string) => lines.push(`! ${line}`) }
    const run = async (argv: readonly string[]): Promise<number> => {
      const args = parseExportArgs(argv, root)
      if (!args.ok) throw new Error(args.error)
      return runExport(args.value, output)
    }

    expect(await run([sqlite, '--format', 'card', '--to', 'cards.json', '--nest', 'keyword as=keywords order=position'])).toBe(0)
    expect(await readFile(`${root}/cards.json`, 'utf8')).toBe(NESTED)
    expect(lines.at(-1)).toBe(`Wrote 2 rows of card, with 3 rows of keyword folded in, to ${root}/cards.json.`)
    expect(await run([text, '--format', 'card', '--to', 'cards-text.json', '--nest', 'keyword.card as=keywords order=position'])).toBe(0)
    expect(await readFile(`${root}/cards-text.json`, 'utf8')).toBe(NESTED)

    // The tool takes the same nest as an object, and as the command line's string.
    const tool = (nest: unknown): Promise<string> => exportFormatRowsTool.run({ path: sqlite, format: 'card', to: 'tool.json', nest: [nest] }, NO_CLIENT)
    expect(await tool({ format: 'keyword', as: 'keywords', order: 'position' })).toContain('Wrote 2 rows of card, with 3 rows of keyword folded in')
    expect(await readFile(`${root}/tool.json`, 'utf8')).toBe(NESTED)
    expect(await tool('keyword as=keywords order=position')).toContain('already holds')

    // By default under the child's name, in its label column's order; --check covers the nest.
    expect(await run([sqlite, '--format', 'card', '--to', 'plain.json', '--nest', 'keyword descending columns=word', '--check'])).toBe(1)
    expect(await run([sqlite, '--format', 'card', '--to', 'plain.json', '--nest', 'keyword descending columns=word'])).toBe(0)
    expect(await readFile(`${root}/plain.json`, 'utf8')).toContain(
      '"keyword": [\n      {\n        "word": "haste"\n      },\n      {\n        "word": "burn"\n      },\n      {\n        "word": "ash"\n      }\n    ]',
    )
    expect(await run([sqlite, '--format', 'card', '--to', 'cards.json', '--nest', 'keyword as=keywords order=position', '--check'])).toBe(0)
    expect(await exportFormatRowsTool.run({ path: sqlite, format: 'keyword', to: 'k.json', ids: true }, NO_CLIENT)).toContain('Wrote 3 rows')
    const id = /"id": "([^"]+)",\n {4}"word": "ash"/.exec(await readFile(`${root}/k.json`, 'utf8'))?.[1]
    expect(await call(updateFormatRowsTool, { path: sqlite, format: 'keyword', edits: [{ id, values: { position: 0 } }] })).toContain('1 row')
    expect(await run([sqlite, '--format', 'card', '--to', 'cards.json', '--nest', 'keyword as=keywords order=position', '--check'])).toBe(1)
    expect(lines.at(-1)).toContain('cards.json differs from 2 rows of card, with 3 rows of keyword folded in')
  })

  it('refuses a child that links twice without its column, a nest inside a nest, and a key the row already has', async () => {
    const root = (await tempDir('emerald-export-nest-')).replace(/\\/g, '/')
    const path = await deck(root)
    const lines: string[] = []
    const output = { line: (line: string) => lines.push(line), complain: (line: string) => lines.push(`! ${line}`) }
    const run = async (argv: readonly string[]): Promise<number> => {
      const args = parseExportArgs(argv, root)
      if (!args.ok) {
        lines.push(`! ${args.error}`)
        return 2
      }
      return runExport(args.value, output)
    }

    expect(await run([path, '--format', 'card', '--to', 'p.json', '--nest', 'pair'])).toBe(2)
    expect(lines.at(-1)).toContain('pair links to card through two columns, left and right; say which its rows are folded in by: pair.left or pair.right.')
    expect(await run([path, '--format', 'card', '--to', 'p.json', '--nest', 'pair.right as=right_of'])).toBe(0)
    expect(await readFile(`${root}/p.json`, 'utf8')).toContain(
      '"name": "Ember",\n    "price": "2.50",\n    "price_currency": "ILS",\n    "right_of": []\n  },\n  {\n    "name": "Frost",\n    "right_of": [\n      {\n        "name": "Clash",\n        "left": "Ember"\n      }\n    ]',
    )
    expect(await run([path, '--format', 'card', '--to', 'p.json', '--nest', 'pair.name'])).toBe(2)
    expect(lines.at(-1)).toContain('which is not a link to card')
    expect(await run([path, '--format', 'card', '--to', 'p.json', '--nest', 'keyword columns=word,card'])).toBe(2)
    expect(lines.at(-1)).toContain('its link back to card')
    expect(await run([path, '--format', 'keyword', '--to', 'p.json', '--nest', 'pair'])).toBe(2)
    expect(lines.at(-1)).toContain('pair, which has no link to keyword')

    expect(await run([path, '--format', 'card', '--to', 'p.json', '--nest', 'keyword nest=pair'])).toBe(2)
    expect(lines.at(-1)).toContain('A nest folds one level only')
    expect(await run([path, '--format', 'card', '--to', 'p.json', '--nest', 'keyword.card.pair'])).toBe(2)
    expect(lines.at(-1)).toContain('A nest folds one level only')
    await expect(
      exportFormatRowsTool.run({ path, format: 'card', to: 'p.json', nest: [{ format: 'keyword', nest: [{ format: 'pair' }] }] }, NO_CLIENT),
    ).rejects.toThrow(/one level only/)

    expect(await run([path, '--format', 'card', '--to', 'p.json', '--nest', 'keyword as=price_currency'])).toBe(2)
    expect(lines.at(-1)).toContain('a key each card already has')
  })
})
