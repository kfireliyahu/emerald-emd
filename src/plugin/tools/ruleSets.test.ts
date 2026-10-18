/**
 * A rule set, end to end through the tools (M25 E4, D-273): declared by
 * `declare_format`, applied by `record_format_rows` and `update_format_rows` as
 * they write, run over what is already there by `apply_rules` — and never over
 * a value a person set.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'

import {
  applyRulesTool,
  declareFormatTool,
  extendFormatTool,
  recordFormatRowsTool,
  updateFormatRowsTool,
} from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const SETS =
  'product.shelf from shelf when label matches pattern by kind (WHOLE equals, PART contains, RE regex) ' +
  'first by priority where enabled is true, recorded in shelf_source as RULE, never over PERSON, noting rule'

async function pantry(): Promise<string> {
  const db = await createDatabase()
  const directory = await tempDir('emerald-rulesets-')
  const path = join(directory, 'pantry.emd')
  await writeFile(path, exportDatabase(db))
  db.close()

  const declare = async (args: Record<string, unknown>): Promise<string> =>
    declareFormatTool.run({ path, nothing_must_hold: true, commit: true, ...args }, NO_CLIENT)
  await declare({
    format: 'shelf',
    title: 'Shelf',
    columns: [{ name: 'name', type: 'text', required: true, unique: true }],
  })
  await declare({
    format: 'shelf_rule',
    title: 'Shelf rule',
    columns: [
      { name: 'pattern', type: 'text', required: true },
      { name: 'kind', type: 'enum', required: true, values: ['WHOLE', 'PART', 'RE'] },
      { name: 'shelf', type: 'link', target: 'shelf', required: true },
      { name: 'priority', type: 'integer', required: true },
      { name: 'enabled', type: 'boolean', required: true },
    ],
  })
  await declare({
    format: 'product',
    title: 'Product',
    columns: [
      { name: 'label', type: 'text', required: true },
      { name: 'shelf', type: 'link', target: 'shelf' },
      { name: 'shelf_source', type: 'enum', values: ['RULE', 'PERSON'] },
      { name: 'rule', type: 'link', target: 'shelf_rule' },
    ],
  })
  await recordFormatRowsTool.run(
    { path, format: 'shelf', rows: [{ name: 'dairy' }, { name: 'bakery' }], commit: true },
    NO_CLIENT,
  )
  return path
}

function reopen(path: string) {
  return openDatabase(readFileSync(path))
}

async function products(path: string): Promise<Record<string, Record<string, unknown>>> {
  const db = await reopen(path)
  const formats = listFormats(db)
  const shelves = new Map(
    listRows(db, formats.find((each) => each.name === 'shelf')!).map((row) => [row.id, row.cells['name']]),
  )
  const rows = listRows(db, formats.find((each) => each.name === 'product')!)
  db.close()
  return Object.fromEntries(
    rows.map((row) => [
      String(row.cells['label']),
      { ...row.cells, id: row.id, shelf: shelves.get(String(row.cells['shelf'])) ?? null },
    ]),
  )
}

describe('a rule set through the tools', () => {
  it('is declared on the rule format, and shown on the dry run', async () => {
    const path = await pantry()
    const dry = await extendFormatTool.run(
      { path, format: 'shelf_rule', rule_sets: [{ name: 'shelves', sets: SETS }] },
      NO_CLIENT,
    )
    expect(dry).toContain('1 rule set')
    expect(dry).toContain('never over PERSON')

    const refused = await extendFormatTool.run(
      { path, format: 'shelf_rule', rule_sets: [{ name: 'shelves', sets: SETS.replace('PERSON', 'NOBODY') }] },
      NO_CLIENT,
    )
    expect(refused).toContain('one of RULE, PERSON')
  })

  it('sets a row as it is written, and never over a person', async () => {
    const path = await pantry()
    await extendFormatTool.run(
      { path, format: 'shelf_rule', rule_sets: [{ name: 'shelves', sets: SETS }], commit: true },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      {
        path,
        format: 'shelf_rule',
        rows: [{ pattern: 'milk', kind: 'PART', shelf: 'dairy', priority: 1, enabled: true }],
        commit: true,
      },
      NO_CLIENT,
    )

    const dry = await recordFormatRowsTool.run(
      { path, format: 'product', rows: [{ label: 'Oat milk' }, { label: 'Soy milk', shelf: 'bakery' }] },
      NO_CLIENT,
    )
    expect(dry).toContain('shelf_source: RULE')
    await recordFormatRowsTool.run(
      { path, format: 'product', rows: [{ label: 'Oat milk' }, { label: 'Soy milk', shelf: 'bakery' }], commit: true },
      NO_CLIENT,
    )
    const written = await products(path)
    expect(written['Oat milk']).toMatchObject({ shelf: 'dairy', shelf_source: 'RULE' })
    expect(written['Oat milk']?.['rule']).toEqual(expect.any(String))
    // Soy milk says milk too — and a person put it on the bakery shelf.
    expect(written['Soy milk']).toMatchObject({ shelf: 'bakery', shelf_source: 'PERSON' })

    // An edit to the text the rules read, on the person's row, leaves it theirs.
    await updateFormatRowsTool.run(
      {
        path,
        format: 'product',
        edits: [{ id: written['Soy milk']?.['id'], values: { label: 'Soy milk 1L' } }],
        commit: true,
      },
      NO_CLIENT,
    )
    expect((await products(path))['Soy milk 1L']).toMatchObject({ shelf: 'bakery', shelf_source: 'PERSON' })
  })

  it('runs over what is there on demand, and says a tie rather than picking', async () => {
    const path = await pantry()
    await extendFormatTool.run(
      { path, format: 'shelf_rule', rule_sets: [{ name: 'shelves', sets: SETS }], commit: true },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      {
        path,
        format: 'product',
        rows: [{ label: 'Rye bread' }, { label: 'Butter bread' }, { label: 'Cream', shelf: 'dairy' }],
        commit: true,
      },
      NO_CLIENT,
    )
    // Rules written after the rows change nothing until asked.
    await recordFormatRowsTool.run(
      {
        path,
        format: 'shelf_rule',
        rows: [
          { pattern: '^.*bread$', kind: 'RE', shelf: 'bakery', priority: 1, enabled: true },
          { pattern: 'butter', kind: 'PART', shelf: 'dairy', priority: 1, enabled: true },
          { pattern: 'cream', kind: 'WHOLE', shelf: 'bakery', priority: 0, enabled: true },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect((await products(path))['Rye bread']?.['shelf']).toBeNull()

    const dry = await applyRulesTool.run({ path, format: 'shelf_rule' }, NO_CLIENT)
    expect(dry).toContain('1 row would be set')
    expect(dry).toContain('1 row a person')
    expect(dry).toContain('rules tied at the top')

    await applyRulesTool.run({ path, format: 'shelf_rule', commit: true }, NO_CLIENT)
    const after = await products(path)
    expect(after['Rye bread']).toMatchObject({ shelf: 'bakery', shelf_source: 'RULE' })
    // bread and butter tie at priority 1 and name different shelves.
    expect(after['Butter bread']?.['shelf']).toBeNull()
    // Cream matches a better rule, and a person shelved it.
    expect(after['Cream']).toMatchObject({ shelf: 'dairy', shelf_source: 'PERSON' })
  })

  it('refuses a rule whose pattern would never match', async () => {
    const path = await pantry()
    await extendFormatTool.run(
      { path, format: 'shelf_rule', rule_sets: [{ name: 'shelves', sets: SETS }], commit: true },
      NO_CLIENT,
    )
    const refused = await recordFormatRowsTool.run(
      {
        path,
        format: 'shelf_rule',
        rows: [{ pattern: '(', kind: 'RE', shelf: 'dairy', priority: 1, enabled: true }],
      },
      NO_CLIENT,
    )
    expect(refused).toContain('regular expression')
  })
})
