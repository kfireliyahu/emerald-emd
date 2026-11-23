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
 * is made here, never a real one (D-390).
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
