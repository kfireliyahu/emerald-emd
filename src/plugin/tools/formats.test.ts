import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { read } from '@/domain/format/artefact.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import {
  adoptFormat,
  listFormats,
  observe,
  saveFormat,
} from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { chosenWeekStart, listUnits } from '@/data/repositories/unitRepository.ts'
import { identity } from '@/domain/format/identity.ts'

import { documentInfoTool } from './documentInfo.ts'
import {
  connectFormatsTool,
  declareFormatTool,
  deleteFormatTool,
  extendFormatTool,
  deleteFormatRowsTool,
  formatRollupTool,
  formatRowsTool,
  formatsTool,
  recordFormatRowsTool,
  recordUnitsTool,
  updateFormatRowsTool,
} from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { listBackups } from '../backup.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * The tools a declaration generates, driven end to end against a real
 * `.emd` on disk — which is the only place the claim of this unit can be
 * checked. **`Ingredients/Pasta.md` is the specification** (D-210), so the
 * document below declares exactly it and the tools are asked to hold a row of
 * it: name, basis, the macros, a Hebrew brand, and a price that is minor units
 * and a code rather than a float.
 *
 * What is asserted throughout is the *sentence*, not only the outcome. These
 * tools are read by a model that cannot ask a follow-up question, and "refused"
 * with no column in it is the failure this surface exists to avoid.
 */

const PASTA = (() => {
  const result = read(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/synthetic/ingredient.format.md', import.meta.url)),
      'utf8',
    ),
  )
  if (!result.ok) throw new Error(result.error)
  return result.value
})()

const NOW = Date.UTC(2026, 8, 15)

const PASTA_ROW = {
  name: 'Pasta',
  brand: 'אסם ספגטי',
  basis: 'dry',
  per_quantity: 100,
  kcal: 352,
  protein_g: 12,
  carbs_g: 71,
  fat_g: 1.5,
  micros_basis: 'label',
  price: 5.9,
  price_currency: 'ILS',
}

async function save(db: Database, name: string): Promise<string> {
  const bytes = exportDatabase(db)
  db.close()
  const directory = await tempDir('emerald-formats-')
  const path = join(directory, name)
  await writeFile(path, bytes)
  return path
}

/** A document declaring the ingredient format, with its table already made. */
async function withIngredients(...declarations: readonly FormatDeclaration[]): Promise<string> {
  const db = await createDatabase()
  for (const declaration of [PASTA, ...declarations]) {
    expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  }
  return save(db, 'ingredients.emd')
}

async function emptyDocument(): Promise<string> {
  return save(await createDatabase(), 'empty.emd')
}

/** The document as it is on disk now, for checking what a write actually did. */
async function reopen(path: string): Promise<Database> {
  return openDatabase(readFileSync(path))
}

async function record(path: string, rows: readonly unknown[], commit: boolean): Promise<string> {
  return recordFormatRowsTool.run({ path, format: 'ingredient', rows, commit }, NO_CLIENT)
}

describe('formats', () => {
  it('says a document declares none, and where one comes from', async () => {
    const answer = await formatsTool.run({ path: await emptyDocument() }, NO_CLIENT)
    expect(answer).toContain('declares no formats')
    expect(answer).toContain('`declare_format` here')
    expect(answer).not.toContain('declare-a-format')
  })

  it('lists what is declared, with the table and the row count', async () => {
    const answer = await formatsTool.run({ path: await withIngredients() }, NO_CLIENT)
    expect(answer).toContain('Ingredient')
    expect(answer).toContain('fmt_ingredient')
    expect(answer).toContain('31')
  })

  it('names the columns, their types and their units, which belong to the document', async () => {
    const answer = await formatsTool.run(
      { path: await withIngredients(), format: 'ingredient' },
      NO_CLIENT,
    )
    expect(answer).toContain('micros_basis')
    // An enum's members are joined with a pipe, which is what found the escape
    // in `cell` that had never worked. The cell has to survive being a cell.
    expect(answer).toContain('label \\| analogue \\| mixed')
    // A money column is two keys and the listing says so, because the caller
    // has to send both.
    expect(answer).toContain('price + price_currency')
    // The prose the person wrote survives into the answer — the half of the
    // note that is argument rather than columns (D-216), and the half a format
    // that kept only the columns would be a worse artefact for losing.
    expect(answer).toContain('A format that is not money, on purpose')
  })

  it('names the formats that do exist when asked for one that does not', async () => {
    const answer = await formatsTool.run(
      { path: await withIngredients(), format: 'recipe' },
      NO_CLIENT,
    )
    expect(answer).toContain('no format called recipe')
    expect(answer).toContain('ingredient')
  })

  it('is what document_info points at, and only when there is something to point at', async () => {
    expect(await documentInfoTool.run({ path: await withIngredients() }, NO_CLIENT)).toContain(
      'Declared formats: ingredient',
    )
    expect(await documentInfoTool.run({ path: await emptyDocument() }, NO_CLIENT)).not.toContain(
      'Declared formats',
    )
  })
})

describe('record_format_rows', () => {
  it('dry-runs by default, writing nothing', async () => {
    const path = await withIngredients()
    const answer = await record(path, [PASTA_ROW], false)

    expect(answer).toContain('Nothing has been written')
    expect(answer).toContain('Pasta')
    // Every value shown is what will be stored, after the declaration's own
    // types were applied — which is the whole reason for showing it.
    expect(answer).toContain('kcal: 352')
    expect(listRows(await reopen(path), PASTA)).toHaveLength(0)
  })

  it('says where the copies go on the first write to a document, and takes one silently after', async () => {
    const path = await withIngredients()
    const answers = [
      await record(path, [PASTA_ROW], true),
      await record(path, [{ ...PASTA_ROW, name: 'Rice' }], true),
      await record(path, [{ ...PASTA_ROW, name: 'Oats' }], true),
    ]

    expect(answers.map((answer) => answer.includes('The document was copied to'))).toEqual([true, false, false])
    expect(await listBackups(path)).toHaveLength(3)
    // Another document is told once too, whatever this one was.
    expect(await record(await withIngredients(), [PASTA_ROW], true)).toContain('The document was copied to')
  })

  it('writes on commit, returns the ids, and takes a copy first', async () => {
    const path = await withIngredients()
    const answer = await record(path, [PASTA_ROW], true)

    expect(answer).toContain('1 row added')
    expect(answer).toContain('The document was copied to')

    const rows = listRows(await reopen(path), PASTA)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.cells['name']).toBe('Pasta')
    expect(rows[0]?.cells['brand']).toBe('אסם ספגטי')
    expect(rows[0]?.cells['price_minor']).toBe(590)
    expect(rows[0]?.cells['price_currency']).toBe('ILS')
    // The id in the answer is the one the row actually has: it is what the
    // other two writes take, and a printed id that matched nothing would make
    // every correction in this surface impossible.
    expect(answer).toContain(rows[0]?.id ?? 'no id')
  })

  it('refuses the whole batch for one bad key, and writes none of it', async () => {
    // The case that matters most. A conversation sending `protein` to a format
    // declaring `protein_g` believes it stored the figure — so this is refused
    // rather than dropped, and the refusal names the columns that exist.
    const path = await withIngredients()
    const answer = await record(path, [PASTA_ROW, { ...PASTA_ROW, protein: 12 }], true)

    expect(answer).toContain('Nothing was written')
    expect(answer).toContain('has no protein')
    expect(answer).toContain('#2')
    expect(listRows(await reopen(path), PASTA)).toHaveLength(0)
    // And no copy of the document explaining that nothing happened — the same
    // rule the schema gate has always kept, now kept by a refused plan too
    // (D-217).
    expect(answer).not.toContain('copied to')
  })

  it('refuses a value the declaration would not hold, by name', async () => {
    const path = await withIngredients()
    const answer = await record(path, [{ ...PASTA_ROW, micros_basis: 'guessed' }], true)

    expect(answer).toContain('micros_basis must be one of label, analogue, mixed')
    expect(listRows(await reopen(path), PASTA)).toHaveLength(0)
  })

  it('refuses a money column with no currency, naming the key it wants', async () => {
    const path = await withIngredients()
    const { price_currency: _dropped, ...noCurrency } = PASTA_ROW
    const answer = await record(path, [noCurrency], true)
    expect(answer).toContain('price_currency')
  })
})

describe('format_rows', () => {
  async function seeded(): Promise<string> {
    const path = await withIngredients()
    await record(
      path,
      [PASTA_ROW, { ...PASTA_ROW, name: 'Red lentils', brand: undefined, protein_g: 24 }],
      true,
    )
    return path
  }

  it('prints each row in full, leaving its empty columns out', async () => {
    const answer = await formatRowsTool.run(
      { path: await seeded(), format: 'ingredient' },
      NO_CLIENT,
    )
    expect(answer).toContain('2 rows of Ingredient')
    expect(answer).toContain('name: Pasta')
    expect(answer).toContain('per_quantity: 100 g')
    // Thirty-one columns of dashes is what makes a conversation expensive for
    // nothing, so an unfilled column is simply absent.
    expect(answer).not.toContain('vit_d_ug')
  })

  it('narrows to a table when the caller says which columns', async () => {
    const answer = await formatRowsTool.run(
      {
        path: await seeded(),
        format: 'ingredient',
        columns: ['name', 'protein_g'],
        order: 'protein_g',
        descending: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('| Id | name | protein_g |')
    expect(answer.indexOf('Red lentils')).toBeLessThan(answer.indexOf('Pasta'))
  })

  it('matches and searches, and says so when the filters are what excluded everything', async () => {
    const path = await seeded()
    expect(
      await formatRowsTool.run(
        { path, format: 'ingredient', match: { name: 'pasta' } },
        NO_CLIENT,
      ),
    ).toContain('1 row of Ingredient')

    expect(
      await formatRowsTool.run({ path, format: 'ingredient', search: 'lentil' }, NO_CLIENT),
    ).toContain('Red lentils')

    const none = await formatRowsTool.run(
      { path, format: 'ingredient', search: 'quinoa' },
      NO_CLIENT,
    )
    expect(none).toContain('the filters are what excluded them')
  })

  it('names the columns that exist when asked for one that does not', async () => {
    await expect(
      formatRowsTool.run(
        { path: await seeded(), format: 'ingredient', columns: ['protein'] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/has no column protein/)
  })

  it('says a format is empty rather than saying a filter found nothing', async () => {
    const answer = await formatRowsTool.run(
      { path: await withIngredients(), format: 'ingredient' },
      NO_CLIENT,
    )
    expect(answer).toContain('no rows at all yet')
    expect(answer).toContain('record_format_rows')
  })
})

describe('update_format_rows', () => {
  async function seededWithId(): Promise<{ path: string; id: string }> {
    const path = await withIngredients()
    await record(path, [PASTA_ROW], true)
    const rows = listRows(await reopen(path), PASTA)
    return { path, id: rows[0]?.id ?? '' }
  }

  it('shows the before and the after, and writes nothing until told', async () => {
    const { path, id } = await seededWithId()
    const answer = await updateFormatRowsTool.run(
      { path, format: 'ingredient', edits: [{ id, values: { protein_g: 13 } }] },
      NO_CLIENT,
    )

    expect(answer).toContain('Nothing has been written')
    expect(answer).toContain('12')
    expect(answer).toContain('13')
    expect(listRows(await reopen(path), PASTA)[0]?.cells['protein_g']).toBe(12)
  })

  it('changes what it named and nothing else', async () => {
    const { path, id } = await seededWithId()
    await updateFormatRowsTool.run(
      {
        path,
        format: 'ingredient',
        edits: [{ id, values: { protein_g: 13, label_source: 'the packet' } }],
        commit: true,
      },
      NO_CLIENT,
    )

    const row = listRows(await reopen(path), PASTA)[0]
    expect(row?.cells['protein_g']).toBe(13)
    expect(row?.cells['label_source']).toBe('the packet')
    expect(row?.cells['kcal']).toBe(352)
    expect(row?.cells['brand']).toBe('אסם ספגטי')
  })

  it('refuses a stale id, and writes none of the batch', async () => {
    const { path, id } = await seededWithId()
    const answer = await updateFormatRowsTool.run(
      {
        path,
        format: 'ingredient',
        edits: [
          { id, values: { protein_g: 13 } },
          { id: 'not-an-id', values: { protein_g: 9 } },
        ],
        commit: true,
      },
      NO_CLIENT,
    )

    expect(answer).toContain('Nothing was written')
    expect(answer).toContain('no row with id not-an-id')
    expect(listRows(await reopen(path), PASTA)[0]?.cells['protein_g']).toBe(12)
  })

  it('will not empty a required column', async () => {
    const { path, id } = await seededWithId()
    const answer = await updateFormatRowsTool.run(
      { path, format: 'ingredient', edits: [{ id, values: { name: '' } }], commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('name is required')
  })
})

describe('delete_format_rows', () => {
  it('prints the row in full before removing it, and removes it only on commit', async () => {
    const path = await withIngredients()
    await record(path, [PASTA_ROW], true)
    const id = listRows(await reopen(path), PASTA)[0]?.id ?? ''

    const preview = await deleteFormatRowsTool.run(
      { path, format: 'ingredient', ids: [id] },
      NO_CLIENT,
    )
    expect(preview).toContain('no undo')
    expect(preview).toContain('name: Pasta')
    expect(listRows(await reopen(path), PASTA)).toHaveLength(1)

    const done = await deleteFormatRowsTool.run(
      { path, format: 'ingredient', ids: [id], commit: true },
      NO_CLIENT,
    )
    expect(done).toContain('1 row removed')
    // The second write to this document in this run: its copy is taken, and
    // the first write already said where they go (M52 F2).
    expect(done).not.toContain('The document was copied to')
    expect(await listBackups(path)).toHaveLength(2)
    expect(listRows(await reopen(path), PASTA)).toHaveLength(0)
  })
})

describe('removing a row something links to (M24 U11, D-263)', () => {
  /** D-1, and D-2 which supersedes it: one row linking to another of its own format. */
  async function chain(): Promise<{ path: string; ids: ReadonlyMap<string, string> }> {
    const path = await emptyDocument()
    await declareFormatTool.run(
      {
        path,
        format: 'decision',
        title: 'Decision',
        columns: [
          { name: 'ref', type: 'text', required: true, unique: true },
          { name: 'supersedes', type: 'link', target: 'decision' },
        ],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-1' }, { ref: 'D-2', supersedes: 'D-1' }], commit: true },
      NO_CLIENT,
    )
    const db = await reopen(path)
    const decision = listFormats(db).find((each) => each.name === 'decision')!
    const ids = new Map(listRows(db, decision).map((row) => [String(row.cells['ref']), row.id]))
    db.close()
    return { path, ids }
  }

  async function remove(path: string, ids: readonly string[], commit: boolean): Promise<string> {
    return deleteFormatRowsTool.run({ path, format: 'decision', ids, commit }, NO_CLIENT)
  }

  async function count(path: string): Promise<number> {
    const db = await reopen(path)
    const decision = listFormats(db).find((each) => each.name === 'decision')!
    const rows = listRows(db, decision).length
    db.close()
    return rows
  }

  it('names what would dangle in the dry run, and refuses the commit', async () => {
    const { path, ids } = await chain()

    const preview = await remove(path, [ids.get('D-1')!], false)
    expect(preview).toContain('Nothing would be removed')
    expect(preview).toContain('1 row of Decision name “D-1” through supersedes.')

    const refused = await remove(path, [ids.get('D-1')!], true)
    expect(refused).toContain('Nothing would be removed')
    expect(refused).not.toContain('The document was copied to')
    expect(await count(path)).toBe(2)
  })

  it('takes a row and the row that links to it away together', async () => {
    const { path, ids } = await chain()
    const done = await remove(path, [ids.get('D-1')!, ids.get('D-2')!], true)
    expect(done).toContain('2 rows removed')
    expect(await count(path)).toBe(0)
  })

  it('removes the row once the link to it is cleared', async () => {
    const { path, ids } = await chain()
    await updateFormatRowsTool.run(
      { path, format: 'decision', edits: [{ id: ids.get('D-2')!, values: { supersedes: null } }], commit: true },
      NO_CLIENT,
    )
    const done = await remove(path, [ids.get('D-1')!], true)
    expect(done).toContain('1 row removed')
    expect(await count(path)).toBe(1)
  })
})

describe('a declaration the table has not caught up with', () => {
  it('is refused by every tool here, and says whose job reconciling is', async () => {
    // `saveFormat` writes the declaration and deliberately does not touch the
    // table — the app reconciles on open and the plugin never does (D-216,
    // D-094). A row written now would be a row missing a column, with nobody
    // told.
    const db = await createDatabase()
    expect(adoptFormat(db, PASTA, NOW).refusals).toEqual([])
    saveFormat(
      db,
      { ...PASTA, columns: [...PASTA.columns, column('iodine_ug', 'real', { unit: 'ug' })] },
      NOW,
    )
    const path = await save(db, 'behind.emd')

    const answer = await record(path, [PASTA_ROW], true)
    expect(answer).toContain('does not match its declaration')
    expect(answer).toContain('Open the document in the Emerald app once')
    expect(listRows(await reopen(path), PASTA)).toHaveLength(0)

    // And the listing says which format it is, rather than leaving the caller
    // to find out by being refused.
    expect(await formatsTool.run({ path }, NO_CLIENT)).toContain('does not match the declaration')
  })
})

describe('declare_format', () => {
  /**
   * A format that is small enough to read in a test and covers the three types
   * with a shape of their own — an enum, a bounded number, and money, which is
   * the one that becomes two columns.
   */
  const BOOK = [
    { name: 'title', type: 'text', required: true, note: 'what it is called' },
    { name: 'pages', type: 'integer', minimum: 1, note: 'how long' },
    { name: 'shelf', type: 'enum', values: ['read', 'reading', 'abandoned'] },
    { name: 'paid', type: 'money', note: 'what it cost' },
  ]

  async function declare(
    path: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    return declareFormatTool.run(
      // A book has nothing that has to add up, and U3 makes a format say so on
      // purpose rather than leave the question unanswered (H3, D-222). The
      // identities of a format that has some are their own tests below.
      { path, format: 'book', title: 'Book', columns: BOOK, nothing_must_hold: true, ...overrides },
      NO_CLIENT,
    )
  }

  it('dry-runs by default, writing nothing and showing every column', async () => {
    const path = await emptyDocument()
    const answer = await declare(path)

    expect(answer).toContain('Nothing has been written')
    expect(answer).toContain('fmt_book')
    expect(answer).toContain('shelf')
    expect(answer).toContain('read \\| reading \\| abandoned')
    // A money column is two keys and the preview says so, because that is the
    // rule a declared table cannot be allowed to break quietly.
    expect(answer).toContain('paid + paid_currency')
    expect(listFormats(await reopen(path))).toEqual([])
  })

  it('asks for the prose when there is none, because that half is not decoration', async () => {
    expect(await declare(await emptyDocument())).toContain('offer to write some')
    const withNotes = await declare(await emptyDocument(), {
      notes: 'Pages are the paperback edition, which is what I actually hold.',
    })
    expect(withNotes).toContain('which is what I actually hold')
    expect(withNotes).not.toContain('offer to write some')
  })

  it('creates the table on commit, and money really is two columns in it', async () => {
    const path = await emptyDocument()
    const answer = await declare(path, { commit: true })

    expect(answer).toContain('**Book** is declared')
    expect(answer).toContain('The document was copied to')

    const db = await reopen(path)
    const [declared] = listFormats(db)
    expect(declared?.name).toBe('book')
    expect(declared?.columns.map((each) => each.name)).toEqual(['title', 'pages', 'shelf', 'paid'])

    // The claim that matters: a real table, with the money rule in the storage
    // rather than in the declaration alone. Read through `observe`, which is
    // what the reconciler itself asks — src/plugin/ writes no SQL, tests
    // included, and that rule has no exemptions (D-095).
    const stored = (declared === undefined ? undefined : observe(db, declared))?.columns.map(
      (each) => each.name,
    )
    expect(stored).toContain('paid_minor')
    expect(stored).toContain('paid_currency')
    expect(stored).not.toContain('paid')
  })

  it('is immediately usable — a row goes in with no screen involved', async () => {
    // The whole point of U2 and U2b together: a format exists and is filled in
    // one conversation, which is how the vault already works (D-210).
    const path = await emptyDocument()
    await declare(path, { commit: true })

    const written = await recordFormatRowsTool.run(
      {
        path,
        format: 'book',
        rows: [{ title: 'Piranesi', pages: 245, shelf: 'read', paid: 58, paid_currency: 'ILS' }],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(written).toContain('1 row added')
  })

  it('creates and never alters: a format that exists is sent to the tools that change it', async () => {
    const answer = await declareFormatTool.run(
      { path: await withIngredients(), format: 'ingredient', title: 'Ingredient', nothing_must_hold: true, columns: BOOK },
      NO_CLIENT,
    )
    expect(answer).toContain('already declares')
    // The two that change a format (M24 U2, U3; M38 U6, D-412).
    expect(answer).toContain('`extend_format` adds, renames, retypes and removes')
    expect(answer).toContain('connect_formats')
  })

  it('reports every problem at once, each naming its column', async () => {
    // A model rewrites the whole call, so telling it one of four mistakes costs
    // four round trips for nothing. This is what `declarationProblems` bought.
    const answer = await declareFormatTool.run(
      {
        path: await emptyDocument(),
        format: 'book',
        title: '', nothing_must_hold: true,
        columns: [
          { name: 'pages', type: 'integer', minimum: 10, maximum: 1 },
          { name: 'shelf', type: 'enum', values: [] },
        ],
      },
      NO_CLIENT,
    )

    expect(answer).toContain('nothing was written')
    expect(answer).toContain('needs a title')
    expect(answer).toContain('`pages`')
    expect(answer).toContain('`shelf`')
    expect(answer).toContain('3 things to fix')
  })

  it('does not invite a commit it is going to refuse', async () => {
    // The dry run's tail says *call this tool again with commit: true if they
    // agree*, and there is nothing to agree to when the plan already says it
    // will write nothing. D-217 stopped taking a backup for a refused batch for
    // the same reason: what this surface says is what is going to happen.
    const refused = await declareFormatTool.run(
      { path: await withIngredients(), format: 'ingredient', title: 'Ingredient', nothing_must_hold: true, columns: BOOK },
      NO_CLIENT,
    )
    expect(refused).toContain('already declares')
    expect(refused).not.toContain('commit: true')

    // And a dry run that would go through still says so.
    expect(await declare(await emptyDocument())).toContain('commit: true')
  })

  it('reports every badly-shaped column at once, not the first one', async () => {
    const answer = await declareFormatTool.run(
      {
        path: await emptyDocument(),
        format: 'book',
        title: 'Book', nothing_must_hold: true,
        columns: [
          { name: 'pages', type: 'number' },
          { name: 'shelf', type: 'enum', enum: ['read'] },
          { name: 'paid', type: 'money', minimum: 'lots' },
        ],
      },
      NO_CLIENT,
    )
    expect(answer).toContain('3 things to fix')
    expect(answer).toContain('pages')
    expect(answer).toContain('was given enum')
    expect(answer).toContain('which is not a number')
  })
  it('refuses a key a column has not got rather than dropping it', async () => {
    // D-217's rule one level up: a caller that sent `enum` believes it declared
    // an enum, and a text column arriving quietly is wrong in every row anybody
    // ever puts in it.
    const answer = await declareFormatTool.run(
      {
        path: await emptyDocument(),
        format: 'book',
        title: 'Book', nothing_must_hold: true,
        columns: [{ name: 'shelf', type: 'enum', enum: ['read'] }],
      },
      NO_CLIENT,
    )
    expect(answer).toContain('was given enum')
    expect(answer).toContain('values')
  })

  it('forgives the two slips that cannot mean anything else', async () => {
    // A number sent as a string and a type in the wrong case — D-217's pair, and
    // the line is still that a coercion may not change which value was meant.
    const path = await emptyDocument()
    await declareFormatTool.run(
      {
        path,
        format: 'book',
        title: 'Book', nothing_must_hold: true,
        columns: [{ name: 'pages', type: 'INTEGER', minimum: '1' }],
        commit: true,
      },
      NO_CLIENT,
    )

    const [declared] = listFormats(await reopen(path))
    expect(declared?.columns[0]?.type).toBe('integer')
    expect(declared?.columns[0]?.minimum).toBe(1)
  })

  it('names every type when given something that is not one of them', async () => {
    const answer = await declareFormatTool.run(
      {
        path: await emptyDocument(),
        format: 'book',
        title: 'Book', nothing_must_hold: true,
        columns: [{ name: 'pages', type: 'number' }],
      },
      NO_CLIENT,
    )
    expect(answer).toContain('"number"')
    expect(answer).toContain('text, integer, real, date, boolean, enum, money, link, quantity')
  })

  it('will not declare over a declaration this build cannot read', async () => {
    // `listFormats` does not return one, so without the check the name would
    // look free and the write would replace something nobody here can read.
    // The app says the same thing about the same document and also leaves it.
    const db = await createDatabase()
    saveFormat(db, { ...PASTA, name: 'book', title: 'Book', language: 99 }, NOW)
    const path = await save(db, 'ahead.emd')

    const answer = await declare(path, { commit: true })
    expect(answer).toContain('already declares')
    expect(answer).toContain('this build cannot read')
    expect(listFormats(await reopen(path))).toEqual([])
  })
})

describe('what the rows prove', () => {
  /** The fixture's own identity, over a row that carries every column it names. */
  const FIBRED = { ...PASTA_ROW, fiber_g: 3, kcal: 340 }

  async function withRow(row: Record<string, unknown>): Promise<string> {
    const path = await withIngredients()
    await recordFormatRowsTool.run(
      { path, format: 'ingredient', rows: [row], commit: true },
      NO_CLIENT,
    )
    return path
  }

  it('says what has to add up when the format is asked about', async () => {
    const answer = await formatsTool.run(
      { path: await withIngredients(), format: 'ingredient' },
      NO_CLIENT,
    )
    expect(answer).toContain('atwater')
    expect(answer).toContain('± 2%')
    expect(answer).toContain('4*protein_g + 4*(carbs_g - fiber_g) + 9*fat_g + 2*fiber_g = kcal')
  })

  it('carries a verdict with every row, because this is where a row is read', async () => {
    const answer = await formatRowsTool.run(
      { path: await withRow(FIBRED), format: 'ingredient' },
      NO_CLIENT,
    )
    expect(answer).toContain('atwater: proved')
    expect(answer).toContain('339.5')
  })

  it('fails a row that does not add up, and keeps it', async () => {
    // **The point of an identity not being a CHECK.** A label that does not add
    // up is a real label, and losing the reading would lose the evidence.
    const path = await withRow({ ...FIBRED, kcal: 500 })
    const answer = await formatRowsTool.run({ path, format: 'ingredient' }, NO_CLIENT)
    expect(answer).toContain('atwater: failed')
    expect(answer).toContain('off by')
    expect(answer).toContain('Pasta')
  })

  it('is unchecked when the row has nothing in a column the identity names', async () => {
    // The common case rather than a broken one: `PASTA_ROW` has no fibre on it,
    // which is what most half-filled rows look like (D-149's third state).
    const answer = await formatRowsTool.run(
      { path: await withRow(PASTA_ROW), format: 'ingredient' },
      NO_CLIENT,
    )
    expect(answer).toContain('atwater: unchecked')
    expect(answer).toContain('fiber_g')
  })
})

describe('declaring what has to add up', () => {
  const COLUMNS = [
    { name: 'units', type: 'integer' },
    { name: 'unit_price', type: 'money' },
    { name: 'total', type: 'money' },
  ]

  async function declareWith(overrides: Record<string, unknown>): Promise<string> {
    return declareFormatTool.run(
      {
        path: await emptyDocument(),
        format: 'line',
        title: 'Order line',
        columns: COLUMNS,
        ...overrides,
      },
      NO_CLIENT,
    )
  }

  it('shows the identities in the dry run, with their tolerance', async () => {
    const answer = await declareWith({
      identities: [
        { name: 'line_total', expression: 'units * unit_price = total', note: 'what was charged' },
      ],
      aggregates: [],
    })
    expect(answer).toContain('line_total')
    expect(answer).toContain('units * unit_price = total')
    expect(answer).toContain('exactly')
    expect(answer).toContain('what was charged')
  })

  it('refuses an identity naming a column the format has not got', async () => {
    const answer = await declareWith({
      identities: [{ name: 'line_total', expression: 'quantity * unit_price = total' }],
      aggregates: [],
    })
    expect(answer).toContain('quantity')
    expect(answer).toContain('no such column')
  })

  it('refuses a key an identity has not got rather than dropping it', async () => {
    // D-217's rule, and D-220's: a caller that sent `tolerence` believes it set
    // one, and an exact comparison arriving quietly fails every row.
    const answer = await declareWith({
      identities: [{ name: 'line_total', expression: 'units = total', tolerence: '2%' }],
      aggregates: [],
    })
    expect(answer).toContain('was given tolerence')
    expect(answer).toContain('tolerance')
  })

  it('refuses a tolerance that is not one of the shapes, and names them', async () => {
    const answer = await declareWith({
      identities: [{ name: 'line_total', expression: 'units = total', tolerance: 'about right' }],
      aggregates: [],
    })
    expect(answer).toContain('about right')
    expect(answer).toContain('2%')
  })

  it('declares a format with no identity and no flag saying so — the default (M38 U5)', async () => {
    const answer = await declareFormatTool.run(
      {
        path: await emptyDocument(),
        format: 'line',
        title: 'Order line',
        columns: COLUMNS,
      },
      NO_CLIENT,
    )
    expect(answer).not.toContain('declares no identity')
    expect(answer).toContain('Nothing has been written')
  })

  it('ignores a stale nothing_must_hold beside an identity', async () => {
    const answer = await declareWith({
      identities: [{ name: 'line_total', expression: 'units = total' }],
      aggregates: [],
      nothing_must_hold: true,
    })
    expect(answer).not.toContain('One or the other')
  })

  it('writes the identity, and the row it then takes is judged by it', async () => {
    const path = await emptyDocument()
    await declareFormatTool.run(
      {
        path,
        format: 'line',
        title: 'Order line',
        columns: COLUMNS,
        identities: [{ name: 'line_total', expression: 'units * unit_price = total' }],
        aggregates: [],
        commit: true,
      },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      {
        path,
        format: 'line',
        rows: [{ units: 3, unit_price: 12.9, unit_price_currency: 'ILS', total: 38.7, total_currency: 'ILS' }],
        commit: true,
      },
      NO_CLIENT,
    )
    const answer = await formatRowsTool.run({ path, format: 'line' }, NO_CLIENT)
    expect(answer).toContain('line_total: proved')
  })
})

/* ------------------------------------------------- units, M19 U4a, D-223 */

async function units(path: string, offered: readonly unknown[], commit: boolean): Promise<string> {
  return recordUnitsTool.run({ path, units: offered, commit }, NO_CLIENT)
}

describe('the units a document knows', () => {
  it('are listed by `formats`, grouped by what they measure', async () => {
    const answer = await formatsTool.run({ path: await withIngredients() }, NO_CLIENT)
    expect(answer).toContain('Units this document knows')
    expect(answer).toContain('`kg`')
    expect(answer).toContain('`tbsp`')
    // The line that is the decision rather than the data.
    expect(answer).toContain('inside a dimension and never across one')
  })

  it('takes one this build never heard of, after showing what it would do', async () => {
    const path = await withIngredients()
    const dry = await units(path, [{ symbol: 'slice', dimension: 'COUNT', per_base: 1 }], false)
    expect(dry).toContain('Nothing has been written')
    expect(dry).toContain('slice')
    expect(listUnits(await reopen(path)).some((each) => each.symbol === 'slice')).toBe(false)

    await units(path, [{ symbol: 'slice', dimension: 'COUNT', per_base: 1 }], true)
    const held = listUnits(await reopen(path)).find((each) => each.symbol === 'slice')
    expect(held?.origin).toBe('USER')
  })

  /** The whole reason the table is in the file rather than in the build. */
  it('corrects a tablespoon that is 20 ml in this kitchen, and says what that re-judges', async () => {
    const path = await withIngredients()
    const dry = await units(path, [{ symbol: 'tbsp', per_base: 20, note: 'the Australian one' }], false)
    expect(dry).toContain('re-judges every claim')
    expect(dry).toContain('15')
    expect(dry).toContain('20')

    await units(path, [{ symbol: 'tbsp', per_base: 20, note: 'the Australian one' }], true)
    expect(listUnits(await reopen(path)).find((each) => each.symbol === 'tbsp')?.perBase).toBe(20)
  })

  it('refuses to change what a unit measures, and says why', async () => {
    const path = await withIngredients()
    const answer = await units(path, [{ symbol: 'tbsp', dimension: 'MASS', per_base: 15 }], false)
    expect(answer).toContain('already measures volume')
    expect(answer).toContain('re-mean every figure')
    // A refused dry run does not invite a commit (D-220).
    expect(answer).not.toContain('commit: true')
  })

  it('asks for a dimension only for a symbol the document has not got', async () => {
    const path = await withIngredients()
    expect(await units(path, [{ symbol: 'slice', per_base: 1 }], false)).toContain('needs a `dimension`')
    expect(await units(path, [{ symbol: 'g', per_base: 1 }], false)).not.toContain('needs a `dimension`')
  })

  it('refuses the whole batch when one entry is wrong, and writes nothing', async () => {
    const path = await withIngredients()
    const answer = await units(
      path,
      [
        { symbol: 'slice', dimension: 'COUNT', per_base: 1 },
        { symbol: 'fl oz', dimension: 'VOLUME', per_base: 29.6 },
      ],
      true,
    )
    expect(answer).toContain('not a usable unit symbol')
    expect(listUnits(await reopen(path)).some((each) => each.symbol === 'slice')).toBe(false)
  })

  /** M53 F6 (D-528): the screen's Settings › Calendar, from a conversation. */
  it('sets the day the weeks start on, beside the currency, and `formats` says it', async () => {
    const path = await withIngredients()
    expect(await formatsTool.run({ path }, NO_CLIENT)).toContain('**Weeks start on** monday, ISO’s, since none is chosen')
    const dry = await recordUnitsTool.run({ path, week_starts_on: 'Sunday' }, NO_CLIENT)
    expect(dry).toContain('weeks start on sunday')
    expect(chosenWeekStart(await reopen(path))).toBeUndefined()

    await recordUnitsTool.run({ path, week_starts_on: 'Sunday', commit: true }, NO_CLIENT)
    expect(chosenWeekStart(await reopen(path))).toBe('sunday')
    expect(await formatsTool.run({ path }, NO_CLIENT)).toContain('**Weeks start on** sunday')
    expect(await recordUnitsTool.run({ path, week_starts_on: 'someday' }, NO_CLIENT)).toContain('not a day of the week')
  })
})

describe('an identity that converts', () => {
  const converting: FormatDeclaration = {
    language: 2,
    name: 'loaf',
    title: 'Loaf',
    notes: '',
    nothingMustHold: false,
    columns: [
      column('pack', 'real', { unit: 'kg' }),
      column('serving', 'real', { unit: 'g' }),
      column('servings', 'integer'),
    ],
    identities: [identity('portions', 'pack in g = serving * servings')],
    aggregates: [],
  }

  it('proves a row whose two figures are in different units', async () => {
    const path = await withIngredients(converting)
    await recordFormatRowsTool.run(
      { path, format: 'loaf', rows: [{ pack: 1.5, serving: 250, servings: 6 }], commit: true },
      NO_CLIENT,
    )
    const answer = await formatRowsTool.run({ path, format: 'loaf' }, NO_CLIENT)
    expect(answer).toContain('portions: proved')
  })

  /**
   * **The engine's half and the pack's half, in one answer.** It converts the
   * kilograms because that is arithmetic, and it says `unchecked` on the
   * millilitres because a density is a fact about bread. H7's line, printed.
   */
  it('is refused at declaration time when it would cross a dimension', async () => {
    const path = await withIngredients()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'dough',
        title: 'Dough',
        columns: [
          { name: 'volume', type: 'real', unit: 'ml' },
          { name: 'weight', type: 'real', unit: 'g' },
        ],
        identities: [{ name: 'weighs', expression: 'volume in g = weight' }],
        aggregates: [],
      },
      NO_CLIENT,
    )
    expect(answer).toContain('density')
    expect(answer).toContain('column of this format')
  })

  it('is refused when it names a unit the document has not got', async () => {
    const path = await withIngredients()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'bread',
        title: 'Bread',
        columns: [
          { name: 'pack', type: 'real', unit: 'kg' },
          { name: 'slices', type: 'integer' },
        ],
        identities: [{ name: 'cut', expression: 'pack in slice = slices' }],
        aggregates: [],
      },
      NO_CLIENT,
    )
    expect(answer).toContain('not a unit this document knows')
  })
})

/* --------------------------------------- links and aggregates, M19 U4b, D-224 */

/**
 * The three formats D-210's case needs, declared through the tool that a
 * conversation would use. `recipe_line` before `recipe`, because an aggregate
 * names a format the document has to already have — which is the ordering a
 * person meets too.
 */
async function withKitchen(): Promise<string> {
  const path = await emptyDocument()

  await declareFormatTool.run(
    {
      path,
      format: 'ingredient',
      title: 'Ingredient',
      columns: [
        { name: 'name', type: 'text', required: true },
        { name: 'kcal', type: 'real', unit: 'kcal', note: 'per 100 g' },
      ],
      nothing_must_hold: true,
      commit: true,
    },
    NO_CLIENT,
  )

  await declareFormatTool.run(
    {
      path,
      format: 'recipe',
      title: 'Recipe',
      columns: [
        { name: 'name', type: 'text', required: true },
        { name: 'servings', type: 'integer' },
      ],
      nothing_must_hold: true,
      commit: true,
    },
    NO_CLIENT,
  )

  await declareFormatTool.run(
    {
      path,
      format: 'recipe_line',
      title: 'Recipe line',
      columns: [
        { name: 'recipe', type: 'link', target: 'recipe', required: true },
        { name: 'ingredient', type: 'link', target: 'ingredient', required: true },
        { name: 'amount_g', type: 'real', unit: 'g' },
      ],
      nothing_must_hold: true,
      commit: true,
    },
    NO_CLIENT,
  )

  return path
}

describe('a link, through the tools', () => {
  /** The generated id of the first row, read back out of a narrowed table. */
  function idFrom(listed: string): string {
    return /\| ([0-9a-f]{8}-[0-9a-f-]{27}) \|/.exec(listed)?.[1] ?? ''
  }

  /**
   * **A link is read back as a name** (M22 U1, D-241).
   *
   * Found against this project's own memory rather than against the kitchen:
   * `supersedes` printed `0c0af4de-6da3-4935-9201-54246964ddca` where a reader
   * expects `D-232`, so following one cost a second call every time. The rule
   * that fixes it — the target's first `text` column — was already written
   * three times in the app and applied in none of the places a link is *read*,
   * only where one is *chosen*.
   */
  it('prints what the row it names is called, not the id of the row it names', async () => {
    const path = await withKitchen()
    await recordFormatRowsTool.run(
      { path, format: 'ingredient', rows: [{ name: 'Pasta', kcal: 350 }], commit: true },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      { path, format: 'recipe', rows: [{ name: 'Carbonara', servings: 2 }], commit: true },
      NO_CLIENT,
    )
    const ingredient = idFrom(
      await formatRowsTool.run({ path, format: 'ingredient', columns: ['name'] }, NO_CLIENT),
    )
    const recipe = idFrom(
      await formatRowsTool.run({ path, format: 'recipe', columns: ['name'] }, NO_CLIENT),
    )
    await recordFormatRowsTool.run(
      { path, format: 'recipe_line', rows: [{ recipe, ingredient, amount_g: 200 }], commit: true },
      NO_CLIENT,
    )

    const answer = await formatRowsTool.run({ path, format: 'recipe_line' }, NO_CLIENT)
    expect(answer).toContain('ingredient: Pasta')
    expect(answer).toContain('recipe: Carbonara')
    // The block prints the *recipe line's* own id, which a write still needs.
    // What must not be there is the id of the row it points at.
    expect(answer).not.toContain(ingredient)
  })

  /**
   * **And the default order is that same column.**
   *
   * An id is generated rather than counted, so ordering by one shuffles: M20's
   * ten units came back U5, T4, U3, U1, U6, T1, U4, U0, U7, U2. The screen has
   * defaulted to the naming column since D-216 and the tool defaulted to the
   * id, which is the plainest kind of parity gap — the same rows, read two
   * ways, in two orders.
   */
  it('orders by the naming column rather than by the generated id', async () => {
    const path = await withKitchen()
    await recordFormatRowsTool.run(
      {
        path,
        format: 'ingredient',
        rows: [{ name: 'Zucchini' }, { name: 'Apple' }, { name: 'Mango' }],
        commit: true,
      },
      NO_CLIENT,
    )

    const answer = await formatRowsTool.run(
      { path, format: 'ingredient', columns: ['name'] },
      NO_CLIENT,
    )
    expect(answer.indexOf('Apple')).toBeLessThan(answer.indexOf('Mango'))
    expect(answer.indexOf('Mango')).toBeLessThan(answer.indexOf('Zucchini'))
  })

  it('is declared with a target and listed with what it points at', async () => {
    const path = await withKitchen()
    const answer = await formatsTool.run({ path, format: 'recipe_line' }, NO_CLIENT)
    expect(answer).toContain('link')
    expect(answer).toContain('ingredient')
  })

  it('refuses a link with no target rather than guessing one', async () => {
    const path = await withKitchen()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'step',
        title: 'Step',
        columns: [{ name: 'recipe', type: 'link' }],
        nothing_must_hold: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('no `target`')
  })

  it('refuses a target this document does not declare', async () => {
    const path = await withKitchen()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'step',
        title: 'Step',
        columns: [{ name: 'pantry', type: 'link', target: 'pantry' }],
        nothing_must_hold: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('pantry')
    expect(answer).toContain('ingredient')
  })

  /**
   * **A dangling link is refused when it is written**, not discovered when it
   * is read. The clause in the table is documentation — this app never sets
   * `PRAGMA foreign_keys = ON` (D-067) — so the refusal that holds is this one,
   * and it names the column and the id.
   */
  it('refuses a row naming an id the other format has not got', async () => {
    const path = await withKitchen()
    const answer = await recordFormatRowsTool.run(
      {
        path,
        format: 'recipe_line',
        rows: [{ recipe: 'no-such-row', ingredient: 'nor-this', amount_g: 100 }],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('no-such-row')
    expect(answer).toContain('recipe')
  })
})

describe('an aggregate, through the tools', () => {
  /**
   * **The ordering a person actually meets, and it does not close.**
   * `recipe_line` links to `recipe`, so `recipe` has to exist first; `recipe`
   * folds `recipe_line`, so *that* has to exist first. `declare_format` creates
   * and never alters (D-220), so a conversation can set up one direction and
   * not the other — the aggregate is added afterwards in the editor.
   *
   * Asserted rather than worked around, because it is a real edge of the
   * surface and the maintainer is the one who decides whether it is acceptable.
   */
  it('cannot be declared before the format it folds exists', async () => {
    const path = await emptyDocument()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'recipe',
        title: 'Recipe',
        columns: [{ name: 'servings', type: 'integer' }],
        aggregates: [
          {
            name: 'total_kcal',
            of: 'sum',
            over_format: 'recipe_line',
            over_column: 'recipe',
            works_out: 'amount_g',
            unit: 'g',
          },
        ],
        nothing_must_hold: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('recipe_line')
    expect(answer).toContain('declares no format called that')
  })

  it('refuses one whose source points somewhere else', async () => {
    const path = await withKitchen()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'menu',
        title: 'Menu',
        columns: [{ name: 'name', type: 'text', required: true }],
        aggregates: [
          {
            name: 'total_kcal',
            of: 'sum',
            over_format: 'recipe_line',
            over_column: 'ingredient',
            works_out: 'amount_g',
            unit: 'g',
          },
        ],
        nothing_must_hold: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('points at ingredient rather than at menu')
    expect(answer).toContain('every row')
  })

  it('refuses a fold it has never heard of, naming the five it has', async () => {
    const path = await withKitchen()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'menu',
        title: 'Menu',
        columns: [{ name: 'name', type: 'text', required: true }],
        aggregates: [
          { name: 'x', of: 'median', over_format: 'recipe_line', over_column: 'recipe' },
        ],
        nothing_must_hold: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('sum, count, average, minimum, maximum')
  })

  it('refuses an unknown key rather than dropping it', async () => {
    const path = await withKitchen()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'menu',
        title: 'Menu',
        columns: [{ name: 'name', type: 'text', required: true }],
        aggregates: [{ name: 'x', sum: 'amount_g', over_format: 'recipe_line' }],
        nothing_must_hold: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('not part of an aggregate')
  })
})

describe('connect_formats (M24 U2)', () => {
  async function connectRun(args: Record<string, unknown>): Promise<string> {
    return connectFormatsTool.run(args, NO_CLIENT)
  }

  /**
   * **The ordering that did not close, closed.** The test above asserts that
   * `recipe` cannot fold `recipe_line` while it is being declared; this is the
   * other half: both exist, and the figure is added afterwards from the
   * conversation rather than the editor.
   */
  it('folds a figure over a link that is already there, after a dry run', async () => {
    const path = await withKitchen()
    const args = {
      path,
      format: 'recipe_line',
      target: 'recipe',
      column: 'recipe',
      aggregate: { name: 'total_g', of: 'sum', works_out: 'amount_g', unit: 'g' },
    }
    const dry = await connectRun(args)
    expect(dry).toContain('already a link to recipe')
    expect(dry).toContain('`recipe.total_g`')
    expect(dry).toContain('Nothing has been written')
    const before = await reopen(path)
    expect(listFormats(before).find((each) => each.name === 'recipe')?.aggregates).toEqual([])
    before.close()

    const done = await connectRun({ ...args, commit: true })
    expect(done).toContain('Connected')
    const after = await reopen(path)
    expect(listFormats(after).find((each) => each.name === 'recipe')?.aggregates).toMatchObject([
      {
        name: 'total_g',
        kind: 'SUM',
        expression: 'amount_g',
        over: { format: 'recipe_line', column: 'recipe' },
      },
    ])
    after.close()
  })

  it('adds a link to a format that already holds rows, and loses none of them', async () => {
    const path = await withKitchen()
    await declareFormatTool.run(
      {
        path,
        format: 'menu',
        title: 'Menu',
        columns: [{ name: 'name', type: 'text', required: true }],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      { path, format: 'recipe', rows: [{ name: 'Carbonara', servings: 2 }], commit: true },
      NO_CLIENT,
    )

    const done = await connectRun({
      path,
      format: 'recipe',
      target: 'menu',
      aggregate: { name: 'recipes', of: 'count' },
      commit: true,
    })
    expect(done).toContain('`recipe.menu`')
    expect(done).toContain('1 row already there start')
    const after = await reopen(path)
    const recipe = listFormats(after).find((each) => each.name === 'recipe')
    expect(recipe?.columns.map((each) => each.name)).toContain('menu')
    expect(listFormats(after).find((each) => each.name === 'menu')?.aggregates[0]?.name).toBe(
      'recipes',
    )
    after.close()
    const rows = await formatRowsTool.run({ path, format: 'recipe' }, NO_CLIENT)
    expect(rows).toContain('Carbonara')
  })

  it('refuses a required link on a format with rows, in the words of the reconciler', async () => {
    const path = await withKitchen()
    await recordFormatRowsTool.run(
      { path, format: 'ingredient', rows: [{ name: 'Pasta', kcal: 350 }], commit: true },
      NO_CLIENT,
    )
    const answer = await connectRun({
      path,
      format: 'ingredient',
      target: 'recipe',
      required: true,
      commit: true,
    })
    expect(answer).toContain('nothing was written')
    expect(answer).toContain('without `required`')
    const after = await reopen(path)
    expect(
      listFormats(after)
        .find((each) => each.name === 'ingredient')
        ?.columns.map((each) => each.name),
    ).not.toContain('recipe')
    after.close()
  })

  it('refuses a figure that says what it folds over, or folds a column that is not there', async () => {
    const path = await withKitchen()
    const over = await connectRun({
      path,
      format: 'recipe_line',
      target: 'recipe',
      column: 'recipe',
      aggregate: { name: 'x', of: 'sum', works_out: 'amount_g', over_format: 'recipe_line' },
    })
    expect(over).toContain('over_format')
    expect(over).toContain('not part of one here')

    const missing = await connectRun({
      path,
      format: 'recipe_line',
      target: 'recipe',
      column: 'recipe',
      aggregate: { name: 'x', of: 'sum', works_out: 'fibre_g' },
    })
    expect(missing).toContain('fibre_g')
    expect(missing).not.toContain('This was a dry run')
  })

  it('refuses a format the document has not got, naming the ones it has', async () => {
    const path = await withKitchen()
    const answer = await connectRun({ path, format: 'recipe_line', target: 'menu' })
    expect(answer).toContain('no format called menu')
    expect(answer).toContain('recipe_line')
  })
})

describe('extend_format (M24 U3)', () => {
  async function extend(args: Record<string, unknown>): Promise<string> {
    return extendFormatTool.run(args, NO_CLIENT)
  }

  it('adds a column to a format with rows, after a dry run, and loses none of them', async () => {
    const path = await withKitchen()
    await recordFormatRowsTool.run(
      { path, format: 'ingredient', rows: [{ name: 'Pasta', kcal: 350 }], commit: true },
      NO_CLIENT,
    )
    const args = {
      path,
      format: 'ingredient',
      columns: [{ name: 'protein_g', type: 'real', unit: 'g', note: 'per 100 g' }],
    }
    const dry = await extend(args)
    expect(dry).toContain('protein_g')
    expect(dry).toContain('1 row start with the new columns empty')
    expect(dry).toContain('Nothing has been written')

    await extend({ ...args, commit: true })
    const after = await reopen(path)
    const ingredient = listFormats(after).find((each) => each.name === 'ingredient')
    expect(ingredient?.columns.map((each) => each.name)).toEqual(['name', 'kcal', 'protein_g'])
    after.close()
    expect(await formatRowsTool.run({ path, format: 'ingredient' }, NO_CLIENT)).toContain('Pasta')
  })

  /**
   * `M23 U2 #1`: a format born saying nothing has to hold can be told something
   * does, and the `nothing_must_hold` it was declared with is withdrawn rather
   * than left standing beside an identity that contradicts it.
   */
  it('adds an identity to a format declared with nothing to hold', async () => {
    const path = await withKitchen()
    await extend({
      path,
      format: 'ingredient',
      columns: [{ name: 'kcal_label', type: 'real', unit: 'kcal' }],
      identities: [{ name: 'label_agrees', expression: 'kcal = kcal_label', tolerance: '2%' }],
      commit: true,
    })
    const after = await reopen(path)
    const ingredient = listFormats(after).find((each) => each.name === 'ingredient')
    expect(ingredient?.identities.map((each) => each.name)).toEqual(['label_agrees'])
    expect(ingredient?.nothingMustHold).toBe(false)
    after.close()
  })

  it('refuses a required column on a format with rows, and a name it already has', async () => {
    const path = await withKitchen()
    await recordFormatRowsTool.run(
      { path, format: 'ingredient', rows: [{ name: 'Pasta', kcal: 350 }], commit: true },
      NO_CLIENT,
    )
    const required = await extend({
      path,
      format: 'ingredient',
      columns: [{ name: 'brand', type: 'text', required: true }],
      commit: true,
    })
    expect(required).toContain('nothing was written')
    expect(required).toContain('without `required`')

    const twice = await extend({
      path,
      format: 'ingredient',
      columns: [{ name: 'kcal', type: 'real' }],
    })
    expect(twice).toContain('kcal')
    expect(twice).not.toContain('This was a dry run')
  })

  /**
   * M29 U2, D-332: the order is the declaration's, so a conversation moves a
   * column with the same tool that adds one — every column named once, and the
   * answer says when the rows are called by a different column afterwards.
   */
  it('moves columns with `order`, adding one where it belongs, and keeps every row', async () => {
    const path = await withKitchen()
    await recordFormatRowsTool.run(
      { path, format: 'ingredient', rows: [{ name: 'Pasta', kcal: 350 }], commit: true },
      NO_CLIENT,
    )
    const args = {
      path,
      format: 'ingredient',
      columns: [{ name: 'brand', type: 'text' }],
      order: ['brand', 'kcal', 'name'],
    }
    const dry = await extend(args)
    expect(dry).toContain('shown in this order')
    expect(dry).toContain('called by their `brand` from now on, not their `name`')
    expect(dry).toContain('Nothing has been written')

    await extend({ ...args, commit: true })
    const after = await reopen(path)
    const ingredient = listFormats(after).find((each) => each.name === 'ingredient')
    expect(ingredient?.columns.map((each) => each.name)).toEqual(['brand', 'kcal', 'name'])
    after.close()
    expect(await formatRowsTool.run({ path, format: 'ingredient' }, NO_CLIENT)).toContain('Pasta')

    const moved = await extend({ path, format: 'ingredient', order: ['name', 'brand', 'kcal'], commit: true })
    expect(moved).toContain('called by their `name` from now on, not their `brand`')
    expect(moved).not.toContain('start with the new columns empty')

    const short = await extend({ path, format: 'ingredient', order: ['name', 'kcal'] })
    expect(short).toContain('brand was left out')
  })
})

/**
 * M38 U6, D-412: what both trials could only do in the app. A conversation
 * renames, retypes and removes through the same `adoptFormat` the sheet saves
 * with — dry-run until `commit`, and refused, naming the rows, when the rows
 * would not fit.
 */
describe('changing a format from a conversation (M38 U6, D-412)', () => {
  async function extend(args: Record<string, unknown>): Promise<string> {
    return extendFormatTool.run(args, NO_CLIENT)
  }
  async function ingredient(path: string): Promise<FormatDeclaration | undefined> {
    const db = await reopen(path)
    const found = listFormats(db).find((each) => each.name === 'ingredient')
    db.close()
    return found
  }
  async function idsOf(path: string): Promise<ReadonlyMap<string, string>> {
    const db = await reopen(path)
    const declaration = listFormats(db).find((each) => each.name === 'ingredient')
    const rows = declaration === undefined ? [] : listRows(db, declaration)
    db.close()
    return new Map(rows.map((row) => [String(row.cells['name']), row.id]))
  }
  async function kitchenWith(rows: readonly Record<string, unknown>[]): Promise<string> {
    const path = await withKitchen()
    await extend({ path, format: 'ingredient', columns: [{ name: 'kind', type: 'text' }], commit: true })
    await recordFormatRowsTool.run({ path, format: 'ingredient', rows, commit: true }, NO_CLIENT)
    return path
  }

  it('renames a column, keeping its values, and what reads it follows', async () => {
    const path = await kitchenWith([{ name: 'Pasta', kcal: 350 }])
    await extend({
      path,
      format: 'ingredient',
      columns: [{ name: 'kcal_label', type: 'real', unit: 'kcal' }],
      identities: [{ name: 'label_agrees', expression: 'kcal = kcal_label', tolerance: '2%' }],
      commit: true,
    })
    const args = { path, format: 'ingredient', rename: { kcal: 'energy' } }
    const dry = await extend(args)
    expect(dry).toContain('`kcal` becomes `energy`; its 1 row keep their values.')
    expect(dry).toContain('Nothing has been written')
    expect((await ingredient(path))?.columns.map((each) => each.name)).toContain('kcal')

    await extend({ ...args, commit: true })
    const after = await ingredient(path)
    expect(after?.columns.map((each) => each.name)).toEqual(['name', 'energy', 'kind', 'kcal_label'])
    expect(after?.identities[0]?.expression).toBe('energy = kcal_label')
    expect(await formatRowsTool.run({ path, format: 'ingredient' }, NO_CLIENT)).toContain('350')
  })

  it('removes an identity, and no row changes', async () => {
    const path = await kitchenWith([{ name: 'Pasta', kcal: 350 }])
    await extend({
      path,
      format: 'ingredient',
      identities: [{ name: 'some_energy', expression: 'kcal = kcal' }],
      commit: true,
    })
    const done = await extend({ path, format: 'ingredient', remove: ['some_energy'], commit: true })
    expect(done).toContain('`some_energy` goes from the declaration.')
    expect((await ingredient(path))?.identities).toEqual([])
    expect(await formatRowsTool.run({ path, format: 'ingredient' }, NO_CLIENT)).toContain('Pasta')

    const missing = await extend({ path, format: 'ingredient', remove: ['some_energy'] })
    expect(missing).toContain('has nothing called some_energy to remove')
  })

  it('makes a text column an enum when every row fits, and names the rows that do not', async () => {
    const path = await kitchenWith([
      { name: 'Pasta', kind: 'dry' },
      { name: 'Rice', kind: 'grain' },
      { name: 'Salt' },
    ])
    const ids = await idsOf(path)
    const refused = await extend({
      path,
      format: 'ingredient',
      change: [{ name: 'kind', type: 'enum', values: ['dry', 'fresh'] }],
      commit: true,
    })
    expect(refused).toContain('nothing was written')
    expect(refused).toContain('hold grain')
    expect(refused).toContain(`The rows: \`${ids.get('Rice') ?? '?'}\`.`)
    expect(refused).not.toContain(ids.get('Pasta') ?? '?')
    expect((await ingredient(path))?.columns.find((each) => each.name === 'kind')?.type).toBe('text')

    const args = { path, format: 'ingredient', change: [{ name: 'kind', type: 'enum', values: ['dry', 'grain', 'fresh'] }] }
    expect(await extend(args)).toContain('`kind` takes its new list; the 3 rows keep their values.')
    await extend({ ...args, commit: true })
    expect((await ingredient(path))?.columns.find((each) => each.name === 'kind')).toMatchObject({
      type: 'enum',
      values: ['dry', 'grain', 'fresh'],
    })
    const rows = await formatRowsTool.run({ path, format: 'ingredient' }, NO_CLIENT)
    expect(rows).toContain('grain')
    const liquid = await recordFormatRowsTool.run({ path, format: 'ingredient', rows: [{ name: 'Oil', kind: 'liquid' }] }, NO_CLIENT)
    expect(liquid).toContain('kind must be one of dry, grain, fresh')
    // Re-listed again, narrower, over rows that still fit: anybody's now, not only a pack's.
    const narrower = await extend({ path, format: 'ingredient', change: [{ name: 'kind', values: ['dry', 'grain'] }] })
    expect(narrower).toContain('`kind` takes its new list')
  })

  it('keeps what a change does not name, and refuses a type change over values with what to do instead', async () => {
    const path = await kitchenWith([{ name: 'Pasta', kcal: 350 }])
    await extend({ path, format: 'ingredient', change: [{ name: 'kcal', required: false, note: 'per 100 g, dry' }], commit: true })
    expect((await ingredient(path))?.columns.find((each) => each.name === 'kcal')).toMatchObject({
      type: 'real',
      unit: 'kcal',
      note: 'per 100 g, dry',
    })

    const retyped = await extend({ path, format: 'ingredient', change: [{ name: 'kcal', type: 'integer' }] })
    expect(retyped).toContain('nothing was written')
    expect(retyped).toContain('add a column in the new shape')
    const empty = await extend({ path, format: 'ingredient', change: [{ name: 'kind', type: 'date' }], commit: true })
    expect(empty).toContain('`kind` is made again in its new shape')
  })

  it('removes an empty column, and refuses one holding values, naming the rows', async () => {
    const path = await kitchenWith([{ name: 'Pasta', kind: 'dry' }, { name: 'Salt' }])
    const ids = await idsOf(path)
    const refused = await extend({ path, format: 'ingredient', remove: ['kind'], commit: true })
    expect(refused).toContain('empty it first')
    expect(refused).toContain(`The rows: \`${ids.get('Pasta') ?? '?'}\`.`)
    expect((await ingredient(path))?.columns.map((each) => each.name)).toContain('kind')

    const gone = await extend({ path, format: 'ingredient', remove: ['kcal'], commit: true })
    expect(gone).toContain('`kcal` goes; it holds nothing, so nothing is lost.')
    expect((await ingredient(path))?.columns.map((each) => each.name)).toEqual(['name', 'kind'])
  })

  it('refuses a rename another format reads, naming it', async () => {
    const path = await kitchenWith([{ name: 'Pasta', kcal: 350 }])
    await extend({
      path,
      format: 'recipe_line',
      columns: [{ name: 'kcal_total', type: 'real', unit: 'kcal' }],
      identities: [{ name: 'kcal_adds', expression: 'kcal_total = ingredient.kcal * amount_g / 100' }],
      commit: true,
    })
    const refused = await extend({ path, format: 'ingredient', rename: { kcal: 'energy' } })
    expect(refused).toContain('Recipe line would break')
  })
})

describe('delete_format (M24 U3)', () => {
  async function remove(args: Record<string, unknown>): Promise<string> {
    return deleteFormatTool.run(args, NO_CLIENT)
  }

  it('says how many rows go, and takes them only on commit', async () => {
    const path = await withKitchen()
    await declareFormatTool.run(
      {
        path,
        format: 'menu',
        title: 'Menu',
        columns: [{ name: 'name', type: 'text', required: true }],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      { path, format: 'menu', rows: [{ name: 'Lunch' }, { name: 'Dinner' }], commit: true },
      NO_CLIENT,
    )
    const dry = await remove({ path, format: 'menu' })
    expect(dry).toContain('2 rows')
    expect(dry).toContain('Nothing has been written')
    const still = await reopen(path)
    expect(listFormats(still).map((each) => each.name)).toContain('menu')
    still.close()

    expect(await remove({ path, format: 'menu', commit: true })).toContain('is gone, with 2 rows')
    const after = await reopen(path)
    expect(listFormats(after).map((each) => each.name)).not.toContain('menu')
    expect(observe(after, { ...PASTA, name: 'menu' })).toBeUndefined()
    after.close()
  })

  it('refuses a format another one links to, naming it', async () => {
    const path = await withKitchen()
    const answer = await remove({ path, format: 'recipe', commit: true })
    expect(answer).toContain('`recipe_line`')
    expect(answer).toContain('Nothing was written')
    const after = await reopen(path)
    expect(listFormats(after).map((each) => each.name)).toContain('recipe')
    after.close()
  })
})

describe('a unique column (M24 U4, D-255)', () => {
  async function withDecisions(): Promise<string> {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'decision',
        title: 'Decision',
        columns: [
          { name: 'ref', type: 'text', required: true, unique: true },
          { name: 'title', type: 'text' },
        ],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).toContain('is declared')
    return path
  }

  function idFrom(listed: string): string {
    return /\| ([0-9a-f]{8}-[0-9a-f-]{27}) \|/.exec(listed)?.[1] ?? ''
  }

  it('is declared, printed, and compiled to an index', async () => {
    const path = await withDecisions()
    expect(await formatsTool.run({ path, format: 'decision' }, NO_CLIENT)).toContain('yes, unique')
    const db = await reopen(path)
    const decision = listFormats(db).find((each) => each.name === 'decision')
    if (decision === undefined) throw new Error('decision was not declared')
    expect(observe(db, decision)?.columns.find((each) => each.name === 'ref')?.unique).toBe(true)
    db.close()
  })

  it('refuses a row that repeats a value, naming the row that holds it', async () => {
    const path = await withDecisions()
    await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-1', title: 'One' }], commit: true },
      NO_CLIENT,
    )
    const held = idFrom(await formatRowsTool.run({ path, format: 'decision', columns: ['ref'] }, NO_CLIENT))
    const again = await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-1', title: 'Again' }], commit: true },
      NO_CLIENT,
    )
    expect(again).toContain('"D-1"')
    expect(again).toContain(held)
    expect(again).toContain('unique')
  })

  it('refuses a batch that repeats a value inside itself', async () => {
    const path = await withDecisions()
    const answer = await recordFormatRowsTool.run(
      {
        path,
        format: 'decision',
        rows: [{ ref: 'D-2' }, { ref: 'D-3' }, { ref: 'D-2' }],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('row 1 of the same batch')
    const db = await reopen(path)
    expect(listRows(db, listFormats(db).find((each) => each.name === 'decision') ?? PASTA)).toEqual([])
    db.close()
  })

  it('lets a row keep its own value, and refuses one taking another’s', async () => {
    const path = await withDecisions()
    await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-1' }, { ref: 'D-2' }], commit: true },
      NO_CLIENT,
    )
    const listed = await formatRowsTool.run({ path, format: 'decision', columns: ['ref'] }, NO_CLIENT)
    const first = /\| ([0-9a-f-]{36}) \| D-1 \|/.exec(listed)?.[1] ?? ''
    const kept = await updateFormatRowsTool.run(
      { path, format: 'decision', edits: [{ id: first, values: { ref: 'D-1', title: 'Kept' } }], commit: true },
      NO_CLIENT,
    )
    expect(kept).toContain('changed')
    const taken = await updateFormatRowsTool.run(
      { path, format: 'decision', edits: [{ id: first, values: { ref: 'D-2' } }] },
      NO_CLIENT,
    )
    expect(taken).toContain('"D-2"')
    expect(taken).toContain('already holds')
  })

  it('refuses an edit to one column of a one row per, judged on the row as it would stand (D-270)', async () => {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'price',
        title: 'Price',
        columns: [
          { name: 'security', type: 'text', required: true },
          { name: 'as_of', type: 'date', required: true },
        ],
        constraints: [{ rule: 'one row per security, as_of' }],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).toContain('is declared')
    const again = await recordFormatRowsTool.run(
      {
        path,
        format: 'price',
        rows: [
          { security: 'A', as_of: '2026-09-01' },
          { security: 'A', as_of: '2026-09-02' },
          { security: 'A', as_of: '2026-09-01' },
        ],
      },
      NO_CLIENT,
    )
    expect(again).toContain('one row per security, as_of')
    await recordFormatRowsTool.run(
      { path, format: 'price', rows: [{ security: 'A', as_of: '2026-09-01' }, { security: 'A', as_of: '2026-09-02' }], commit: true },
      NO_CLIENT,
    )
    const listed = await formatRowsTool.run({ path, format: 'price', columns: ['as_of'], match: { as_of: '2026-09-02' } }, NO_CLIENT)
    const second = idFrom(listed)
    const moved = await updateFormatRowsTool.run(
      { path, format: 'price', edits: [{ id: second, values: { as_of: '2026-09-01' } }] },
      NO_CLIENT,
    )
    expect(moved).toContain('already holds')
    expect(moved).toContain('one row per security, as_of')
  })

  it('is refused on a type that cannot be one', async () => {
    const path = await emptyDocument()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'reading',
        title: 'Reading',
        columns: [{ name: 'kcal', type: 'real', unique: true }],
        nothing_must_hold: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('only text, integer, date, link, decimal, month can be')
  })

  it('is added to a column that has rows, or refused naming the values that repeat', async () => {
    const path = await withKitchen()
    await recordFormatRowsTool.run(
      {
        path,
        format: 'ingredient',
        rows: [{ name: 'Pasta' }, { name: 'Rice' }, { name: 'Pasta' }],
        commit: true,
      },
      NO_CLIENT,
    )
    const refused = await extendFormatTool.run(
      { path, format: 'ingredient', unique: ['name'], commit: true },
      NO_CLIENT,
    )
    expect(refused).toContain('nothing was written')
    expect(refused).toContain('"Pasta" (2 rows)')

    const recipe = await extendFormatTool.run(
      { path, format: 'recipe', unique: ['name'], commit: true },
      NO_CLIENT,
    )
    expect(recipe).toContain('`name` becomes unique')
    const db = await reopen(path)
    const declared = listFormats(db).find((each) => each.name === 'recipe')
    expect(declared?.columns.find((each) => each.name === 'name')?.unique).toBe(true)
    expect(declared?.language).toBeGreaterThanOrEqual(5)
    db.close()
  })
})

describe('a link written by its target’s name (M24 U5, D-256)', () => {
  async function withDecisions(unique = true): Promise<string> {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'decision',
        title: 'Decision',
        columns: [
          { name: 'ref', type: 'text', required: true, unique },
          { name: 'supersedes', type: 'link', target: 'decision' },
        ],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).toContain('is declared')
    return path
  }

  async function stored(path: string): Promise<ReadonlyMap<string, { id: string; supersedes: unknown }>> {
    const db = await reopen(path)
    const decision = listFormats(db).find((each) => each.name === 'decision')
    if (decision === undefined) throw new Error('decision was not declared')
    const rows = listRows(db, decision)
    db.close()
    return new Map(
      rows.map((row) => [String(row.cells['ref']), { id: row.id, supersedes: row.cells['supersedes'] }]),
    )
  }

  it('resolves a name to the id of the row that holds it', async () => {
    const path = await withDecisions()
    await recordFormatRowsTool.run({ path, format: 'decision', rows: [{ ref: 'D-1' }], commit: true }, NO_CLIENT)
    const answer = await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-2', supersedes: 'D-1' }], commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('added')
    const rows = await stored(path)
    expect(rows.get('D-2')?.supersedes).toBe(rows.get('D-1')?.id)
  })

  it('shows the name it was given in the dry run, not the id it resolved to', async () => {
    const path = await withDecisions()
    const dry = await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-2', supersedes: 'D-1' }, { ref: 'D-1' }] },
      NO_CLIENT,
    )
    expect(dry).toContain('- supersedes: D-1')
    expect(dry).not.toMatch(/supersedes: [0-9a-f]{8}-/)
  })

  it('writes rows that name each other in one batch, in either order', async () => {
    const path = await withDecisions()
    const answer = await recordFormatRowsTool.run(
      {
        path,
        format: 'decision',
        rows: [
          { ref: 'D-3', supersedes: 'D-2' },
          { ref: 'D-2', supersedes: 'D-1' },
          { ref: 'D-1' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('3 rows added')
    const rows = await stored(path)
    expect(rows.get('D-3')?.supersedes).toBe(rows.get('D-2')?.id)
    expect(rows.get('D-2')?.supersedes).toBe(rows.get('D-1')?.id)
    // And the listing names them back, which is the round trip D-241 began.
    expect(await formatRowsTool.run({ path, format: 'decision', match: { ref: 'D-3' } }, NO_CLIENT)).toContain('D-2')
  })

  it('matches a link by the name of the row it names, as well as by its id (M27 U2)', async () => {
    const path = await withDecisions()
    await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-1' }, { ref: 'D-2', supersedes: 'D-1' }, { ref: 'D-3' }], commit: true },
      NO_CLIENT,
    )
    const byName = await formatRowsTool.run({ path, format: 'decision', match: { supersedes: 'D-1' } }, NO_CLIENT)
    expect(byName).toContain('D-2')
    expect(byName).not.toContain('D-3')
    const one = (await stored(path)).get('D-1')?.id ?? ''
    expect(await formatRowsTool.run({ path, format: 'decision', match: { supersedes: one } }, NO_CLIENT)).toContain('D-2')
    expect(await formatRowsTool.run({ path, format: 'decision', match: { supersedes: 'D-9' } }, NO_CLIENT)).toContain(
      'No decision rows match',
    )
  })

  it('still takes an id, and an id wins over a name', async () => {
    const path = await withDecisions()
    await recordFormatRowsTool.run({ path, format: 'decision', rows: [{ ref: 'D-1' }], commit: true }, NO_CLIENT)
    const one = (await stored(path)).get('D-1')?.id ?? ''
    await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-2', supersedes: one }], commit: true },
      NO_CLIENT,
    )
    expect((await stored(path)).get('D-2')?.supersedes).toBe(one)
  })

  it('refuses a name that names nothing, saying it looked for one', async () => {
    const path = await withDecisions()
    const answer = await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-2', supersedes: 'D-404' }], commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('Nothing was written')
    expect(answer).toContain('no row with that id or that ref')
    expect(await stored(path)).toEqual(new Map())
  })

  it('reads a name under a column that is not unique only while one row holds it (M38 U5)', async () => {
    const path = await withDecisions(false)
    await recordFormatRowsTool.run({ path, format: 'decision', rows: [{ ref: 'D-1' }], commit: true }, NO_CLIENT)
    const one = await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-2', supersedes: 'D-1' }] },
      NO_CLIENT,
    )
    expect(one).toContain('Nothing has been written')
    await recordFormatRowsTool.run({ path, format: 'decision', rows: [{ ref: 'D-1' }], commit: true }, NO_CLIENT)
    const two = await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-3', supersedes: 'D-1' }], commit: true },
      NO_CLIENT,
    )
    expect(two).toContain('Nothing was written')
    expect(two).toContain('told apart by one more column')
  })

  it('takes a name in an update too', async () => {
    const path = await withDecisions()
    await recordFormatRowsTool.run(
      { path, format: 'decision', rows: [{ ref: 'D-1' }, { ref: 'D-2' }], commit: true },
      NO_CLIENT,
    )
    const before = await stored(path)
    const answer = await updateFormatRowsTool.run(
      {
        path,
        format: 'decision',
        edits: [{ id: before.get('D-2')?.id, values: { supersedes: 'D-1' } }],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('changed')
    expect((await stored(path)).get('D-2')?.supersedes).toBe(before.get('D-1')?.id)
  })
})

describe('a figure to fixed places, a month and a moment (M24 U6, D-257)', () => {
  async function withFees(): Promise<string> {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'fee',
        title: 'Fee',
        columns: [
          { name: 'fund', type: 'text', required: true, unique: true },
          { name: 'rate', type: 'decimal', scale: 4, unit: '%', minimum: 0, maximum: 100 },
          { name: 'fee_bp', type: 'decimal', scale: 2, unit: 'bp' },
          { name: 'period', type: 'month', unique: true },
          { name: 'read_at', type: 'instant' },
        ],
        identities: [{ name: 'same_fee', expression: 'rate in bp = fee_bp', tolerance: '0.01' }],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).not.toContain('cannot be accepted')
    return path
  }

  it('stores the figure as a whole number and reads it back to its places', async () => {
    const path = await withFees()
    const answer = await recordFormatRowsTool.run(
      {
        path,
        format: 'fee',
        rows: [
          {
            fund: 'Index',
            rate: '0.35',
            fee_bp: 35,
            period: '2026-09',
            read_at: '2026-09-23T17:05:00+03:00',
          },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).not.toContain('refused')

    const db = await reopen(path)
    const declaration = listFormats(db).find((each) => each.name === 'fee')
    expect(declaration?.language).toBe(DECLARATION_LANGUAGE)
    expect(declaration?.columns.find((each) => each.name === 'rate')?.scale).toBe(4)
    const [row] = declaration === undefined ? [] : listRows(db, declaration)
    expect(row?.cells['rate']).toBe(3500)
    expect(row?.cells['fee_bp']).toBe(3500)
    expect(row?.cells['read_at']).toBe('2026-09-23T14:05:00.000Z')
    db.close()

    const shown = await formatRowsTool.run({ path, format: 'fee' }, NO_CLIENT)
    expect(shown).toContain('0.3500')
    expect(shown).toContain('2026-09')
    // A ratio converts inside its own dimension: 0.35 % is 35 bp.
    expect(shown).toContain('same_fee: proved')
  })

  it('refuses rather than rounds, and names the column', async () => {
    const path = await withFees()
    const offer = async (row: Record<string, unknown>): Promise<string> =>
      recordFormatRowsTool.run({ path, format: 'fee', rows: [{ fund: 'X', ...row }] }, NO_CLIENT)

    expect(await offer({ rate: '0.12345' })).toContain('refused rather than rounded')
    expect(await offer({ rate: 150 })).toContain('above its maximum')
    expect(await offer({ period: '2026-13' })).toContain('YYYY-MM')
    expect(await offer({ period: '2026-09-01' })).toContain('YYYY-MM')
    expect(await offer({ read_at: '2026-09-23T14:05' })).toContain('with its offset')
    expect(await offer({ read_at: '2026-02-30T10:00:00Z' })).toContain('does not exist')
  })

  it('is refused without its scale, and a scale on anything else', async () => {
    const path = await emptyDocument()
    const declare = async (entry: Record<string, unknown>): Promise<string> =>
      declareFormatTool.run(
        { path, format: 'thing', title: 'Thing', columns: [entry], nothing_must_hold: true },
        NO_CLIENT,
      )
    expect(await declare({ name: 'rate', type: 'decimal' })).toContain('does not say how many places')
    expect(await declare({ name: 'rate', type: 'decimal', scale: 12 })).toContain('from 1 to 9')
    expect(await declare({ name: 'rate', type: 'real', scale: 2 })).toContain('only a decimal')
  })

  it('knows a basis point', async () => {
    const db = await reopen(await emptyDocument())
    const ratio = listUnits(db).filter((unit) => unit.dimension === 'RATIO')
    expect(ratio.map((unit) => unit.symbol).sort()).toEqual(['%', 'bp'])
    db.close()
  })
})

describe('row constraints, through the tools (M24 U7, D-259)', () => {
  async function withDebts(constraints: readonly unknown[] = []): Promise<string> {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'debt',
        title: 'Debt',
        columns: [
          { name: 'name', type: 'text', required: true },
          { name: 'track', type: 'enum', values: ['NONE', 'MANUAL'], required: true },
          { name: 'track_ref', type: 'text' },
          { name: 'goal', type: 'text' },
          { name: 'fund', type: 'text' },
          { name: 'direction', type: 'enum', values: ['OUTFLOW', 'INFLOW'] },
          { name: 'amount', type: 'money' },
        ],
        constraints,
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).toContain('is declared')
    return path
  }

  const ALL = [
    { rule: 'track_ref is required only when track is MANUAL', note: 'a reference nothing reads is a lie' },
    { rule: 'at most one of goal, fund' },
    { rule: 'amount is at most 0 when direction is OUTFLOW' },
  ]

  it('declares the three the ledger says, and prints them back as they were written', async () => {
    const path = await withDebts(ALL)
    const listed = await formatsTool.run({ path, format: 'debt' }, NO_CLIENT)
    expect(listed).toContain('3 row constraints')
    expect(listed).toContain('`track_ref is required only when track is MANUAL` | a reference nothing reads is a lie')
    expect(listed).toContain('`at most one of goal, fund`')
  })

  it('refuses a rule naming a member the enum has not got, before anything is written', async () => {
    const path = await emptyDocument()
    const answer = await declareFormatTool.run(
      {
        path,
        format: 'debt',
        title: 'Debt',
        columns: [
          { name: 'track', type: 'enum', values: ['NONE', 'MANUAL'] },
          { name: 'track_ref', type: 'text' },
        ],
        constraints: [{ rule: 'track_ref is required when track is WEEKLY' }],
        nothing_must_hold: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('nothing was written')
    expect(answer).toContain('WEEKLY')
  })

  it('refuses a row that breaks one, by the rule, and writes the rest of nothing', async () => {
    const path = await withDebts(ALL)
    const answer = await recordFormatRowsTool.run(
      {
        path,
        format: 'debt',
        rows: [
          { name: 'Car', track: 'MANUAL', track_ref: 'card' },
          { name: 'Loan', track: 'NONE', goal: 'house', fund: 'pension' },
          { name: 'Refund', track: 'NONE', direction: 'OUTFLOW', amount: 12, amount_currency: 'ILS' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('at most one of goal, fund')
    expect(answer).toContain('amount is at most 0 when direction is OUTFLOW')
    const db = await reopen(path)
    expect(listRows(db, listFormats(db)[0]!)).toHaveLength(0)
    db.close()
  })

  it('judges an edit on the row as it would stand', async () => {
    const path = await withDebts(ALL)
    await recordFormatRowsTool.run(
      { path, format: 'debt', rows: [{ name: 'Car', track: 'MANUAL', track_ref: 'card' }], commit: true },
      NO_CLIENT,
    )
    const listed = await formatRowsTool.run({ path, format: 'debt', columns: ['name'] }, NO_CLIENT)
    const id = /\| ([0-9a-f]{8}-[0-9a-f-]{27}) \|/.exec(listed)?.[1] ?? ''
    const answer = await updateFormatRowsTool.run(
      { path, format: 'debt', edits: [{ id, values: { track: 'NONE' } }], commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('track_ref is required only when track is MANUAL')
  })

  it('adds one with extend_format, refused while a row breaks it and naming that row', async () => {
    const path = await withDebts()
    await recordFormatRowsTool.run(
      { path, format: 'debt', rows: [{ name: 'Car', track: 'MANUAL' }], commit: true },
      NO_CLIENT,
    )
    const listed = await formatRowsTool.run({ path, format: 'debt', columns: ['name'] }, NO_CLIENT)
    const id = /\| ([0-9a-f]{8}-[0-9a-f-]{27}) \|/.exec(listed)?.[1] ?? ''

    const refused = await extendFormatTool.run(
      { path, format: 'debt', constraints: [ALL[0]], commit: true },
      NO_CLIENT,
    )
    expect(refused).toContain('nothing was written')
    expect(refused).toContain('1 row')
    expect(refused).toContain(id)

    await updateFormatRowsTool.run(
      { path, format: 'debt', edits: [{ id, values: { track_ref: 'card' } }], commit: true },
      NO_CLIENT,
    )
    const added = await extendFormatTool.run(
      { path, format: 'debt', constraints: [ALL[0]], commit: true },
      NO_CLIENT,
    )
    expect(added).toContain('track_ref is required only when track is MANUAL')
    const db = await reopen(path)
    expect(listFormats(db)[0]?.constraints).toHaveLength(1)
    expect(listFormats(db)[0]?.language).toBe(DECLARATION_LANGUAGE)
    db.close()
  })
})

describe('an aggregate over only the rows that match, through the tools (M24 U8, D-260)', () => {
  /** The kitchen, with a boolean on the ingredient and one recipe of two lines. */
  async function veganKitchen(): Promise<string> {
    const path = await withKitchen()
    await extendFormatTool.run(
      {
        path,
        format: 'ingredient',
        columns: [{ name: 'vegan', type: 'boolean' }],
        unique: ['name'],
        commit: true,
      },
      NO_CLIENT,
    )
    // Unique, so a line can name its recipe and ingredient (U5, D-256).
    await extendFormatTool.run({ path, format: 'recipe', unique: ['name'], commit: true }, NO_CLIENT)
    await recordFormatRowsTool.run(
      {
        path,
        format: 'ingredient',
        rows: [
          { name: 'Pasta', kcal: 352, vegan: true },
          { name: 'Parmesan', kcal: 392, vegan: false },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      { path, format: 'recipe', rows: [{ name: 'Cacio e pepe', servings: 2 }], commit: true },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      {
        path,
        format: 'recipe_line',
        rows: [
          { recipe: 'Cacio e pepe', ingredient: 'Pasta', amount_g: 200 },
          { recipe: 'Cacio e pepe', ingredient: 'Parmesan', amount_g: 60 },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    return path
  }

  const VEGAN = {
    name: 'vegan_g',
    of: 'sum',
    works_out: 'amount_g',
    unit: 'g',
    where: 'ingredient.vegan is true',
  }

  it('connects a filtered figure, says so in the dry run, and folds only what matches', async () => {
    const path = await veganKitchen()
    const args = { path, format: 'recipe_line', target: 'recipe', column: 'recipe', aggregate: VEGAN }
    const dry = await connectFormatsTool.run(args, NO_CLIENT)
    expect(dry).toContain('belong to it through recipe and where ingredient.vegan is true')
    expect(dry).toContain('Nothing has been written')

    await connectFormatsTool.run({ ...args, commit: true }, NO_CLIENT)
    const after = await reopen(path)
    const recipe = listFormats(after).find((each) => each.name === 'recipe')
    expect(recipe?.aggregates[0]?.where).toEqual({ column: 'ingredient.vegan', is: 'true' })
    expect(recipe?.language).toBeGreaterThanOrEqual(8)
    after.close()

    const rows = await formatRowsTool.run({ path, format: 'recipe' }, NO_CLIENT)
    expect(rows).toContain(
      'vegan_g: 200 g — the sum over 1 row of recipe_line where ingredient.vegan is true.',
    )
  })

  it('refuses a member the column has not got, and a sentence that is not a filter', async () => {
    const path = await veganKitchen()
    const run = (where: string): Promise<string> =>
      connectFormatsTool.run(
        { path, format: 'recipe_line', target: 'recipe', column: 'recipe', aggregate: { ...VEGAN, where } },
        NO_CLIENT,
      )
    expect(await run('ingredient.vegan is yes')).toContain('ingredient.vegan is a boolean: true or false')
    expect(await run('ingredient.vegan = true')).toContain('is not a filter')
    expect(await run('amount_g is 200')).toContain('amount_g is a real')
  })
})

describe('the latest by an order, through the tools (M25 E3, D-272)', () => {
  /** The kitchen, with the lines of one recipe numbered by step. */
  async function steppedKitchen(): Promise<string> {
    const path = await withKitchen()
    await extendFormatTool.run(
      { path, format: 'ingredient', unique: ['name'], commit: true },
      NO_CLIENT,
    )
    await extendFormatTool.run({ path, format: 'recipe', unique: ['name'], commit: true }, NO_CLIENT)
    await extendFormatTool.run(
      { path, format: 'recipe_line', columns: [{ name: 'step', type: 'integer' }], commit: true },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      {
        path,
        format: 'ingredient',
        rows: [
          { name: 'Pasta', kcal: 352 },
          { name: 'Parmesan', kcal: 392 },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      { path, format: 'recipe', rows: [{ name: 'Cacio e pepe', servings: 2 }], commit: true },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      {
        path,
        format: 'recipe_line',
        rows: [
          { recipe: 'Cacio e pepe', ingredient: 'Pasta', amount_g: 200, step: 9 },
          { recipe: 'Cacio e pepe', ingredient: 'Parmesan', amount_g: 60, step: 10 },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    return path
  }

  const LAST = { name: 'last_g', of: 'latest', works_out: 'amount_g', unit: 'g', by: 'step' }

  it('connects a pick by an order, and reads the row with the greatest', async () => {
    const path = await steppedKitchen()
    const args = { path, format: 'recipe_line', target: 'recipe', column: 'recipe', aggregate: LAST }
    await connectFormatsTool.run({ ...args, commit: true }, NO_CLIENT)
    const after = await reopen(path)
    const recipe = listFormats(after).find((each) => each.name === 'recipe')
    expect(recipe?.aggregates[0]).toMatchObject({ kind: 'LATEST', by: 'step' })
    expect(recipe?.language).toBe(DECLARATION_LANGUAGE)
    after.close()

    // Ten after nine: an integer orders as a number, not as text.
    const rows = await formatRowsTool.run({ path, format: 'recipe' }, NO_CLIENT)
    expect(rows).toContain('last_g: 60 g — the latest of 2 rows of recipe_line by step, from 10.')
  })

  it('refuses an order on a fold, a pick with none, and an order that does not sort', async () => {
    const path = await steppedKitchen()
    const run = (aggregate: Record<string, string>): Promise<string> =>
      connectFormatsTool.run(
        { path, format: 'recipe_line', target: 'recipe', column: 'recipe', aggregate },
        NO_CLIENT,
      )
    expect(await run({ ...LAST, of: 'sum' })).toContain('Only latest and earliest pick by an order')
    const { by: _dropped, ...unordered } = LAST
    expect(await run(unordered)).toContain('says by what')
    expect(await run({ ...LAST, by: 'amount_g' })).toContain('which is a real')
  })
})

describe('a rollup by a month, through the tools (M25 E2, D-271)', () => {
  it('is declared, run per month and link, and added to', async () => {
    const path = await save(await createDatabase(), 'purchases.emd')
    await declareFormatTool.run(
      {
        path,
        format: 'shop',
        title: 'Shop',
        columns: [{ name: 'name', type: 'text', required: true, unique: true }],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    const refused = await declareFormatTool.run(
      {
        path,
        format: 'purchase',
        title: 'Purchase',
        columns: [
          { name: 'label', type: 'text', required: true },
          { name: 'price', type: 'money' },
          { name: 'bought_on', type: 'date', required: true },
          { name: 'shop', type: 'link', target: 'shop' },
        ],
        rollups: [{ name: 'spent', works_out: 'sum of price by bought_on and shop' }],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(refused).toContain('month of bought_on')

    const declared = await declareFormatTool.run(
      {
        path,
        format: 'purchase',
        title: 'Purchase',
        columns: [
          { name: 'label', type: 'text', required: true },
          { name: 'price', type: 'money' },
          { name: 'bought_on', type: 'date', required: true },
          { name: 'shop', type: 'link', target: 'shop' },
        ],
        rollups: [{ name: 'spent', works_out: 'sum of price by month of bought_on and shop', note: 'per shop' }],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).toContain('is declared')

    await recordFormatRowsTool.run(
      { path, format: 'shop', rows: [{ name: 'Grocer' }], commit: true },
      NO_CLIENT,
    )
    await recordFormatRowsTool.run(
      {
        path,
        format: 'purchase',
        rows: [
          { label: 'Bread', price: 12.5, price_currency: 'ILS', bought_on: '2026-03-02', shop: 'Grocer' },
          { label: 'Milk', price: 7, price_currency: 'ILS', bought_on: '2026-03-09', shop: 'Grocer' },
          { label: 'Gift', price: 40, price_currency: 'ILS', bought_on: '2026-04-01' },
          { label: 'Lost receipt', bought_on: '2026-05-01', shop: 'Grocer' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )

    const listed = await formatsTool.run({ path, format: 'purchase' }, NO_CLIENT)
    expect(listed).toContain('format_rollup')
    expect(listed).toContain('sum of price by month of bought_on and shop')

    const run = await formatRollupTool.run({ path, format: 'purchase' }, NO_CLIENT)
    expect(run).toMatch(/\| 2026-03 \| Grocer \| [^|]*19\.50 \| 2 \|/)
    expect(run).toMatch(/\| 2026-04 \| \(none\) \| [^|]*40\.00 \| 1 \|/)
    expect(run).toContain('unchecked')
    expect(run).toContain('only that one')

    const april = await formatRollupTool.run({ path, format: 'purchase', from: '2026-04', to: '2026-04' }, NO_CLIENT)
    expect(april).not.toContain('2026-03')
    await expect(formatRollupTool.run({ path, format: 'purchase', from: 'March' }, NO_CLIENT)).rejects.toThrow('YYYY-MM')

    await extendFormatTool.run(
      { path, format: 'purchase', rollups: [{ name: 'bought', works_out: 'count by month of bought_on' }], commit: true },
      NO_CLIENT,
    )
    await expect(formatRollupTool.run({ path, format: 'purchase' }, NO_CLIENT)).rejects.toThrow('name one')
    const counted = await formatRollupTool.run({ path, format: 'purchase', rollup: 'bought' }, NO_CLIENT)
    expect(counted).toContain('| 2026-03 | 2 | 2 |')
  })
})

describe('a link to several rows, through the tools (M27 U2, D-300)', () => {
  async function withUnits(): Promise<string> {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'unit',
        title: 'Unit',
        columns: [
          { name: 'ref', type: 'text', required: true, unique: true },
          { name: 'blocks', type: 'links', target: 'unit' },
        ],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).toContain('is declared')
    return path
  }

  it('declares, writes by name, matches by a member, and prints the members by name', async () => {
    const path = await withUnits()
    const dry = await recordFormatRowsTool.run(
      { path, format: 'unit', rows: [{ ref: 'U1' }, { ref: 'U2' }, { ref: 'U3', blocks: ['U2', 'U1'] }] },
      NO_CLIENT,
    )
    expect(dry).toContain('blocks: U2, U1')
    await recordFormatRowsTool.run(
      { path, format: 'unit', rows: [{ ref: 'U1' }, { ref: 'U2' }, { ref: 'U3', blocks: ['U2', 'U1'] }], commit: true },
      NO_CLIENT,
    )
    const listed = await formatRowsTool.run({ path, format: 'unit', match: { blocks: 'U1' } }, NO_CLIENT)
    expect(listed).toContain('U3')
    expect(listed).toContain('blocks: U2, U1')
    expect(listed).not.toMatch(/### U1\b/)
  })

  it('replaces a list on update, and refuses to delete a row a list still names', async () => {
    const path = await withUnits()
    await recordFormatRowsTool.run(
      { path, format: 'unit', rows: [{ ref: 'U1' }, { ref: 'U2' }, { ref: 'U3', blocks: ['U1'] }], commit: true },
      NO_CLIENT,
    )
    const db = await reopen(path)
    const unit = listFormats(db).find((each) => each.name === 'unit')
    if (unit === undefined) throw new Error('unit was not declared')
    const ids = new Map(listRows(db, unit).map((row) => [String(row.cells['ref']), row.id]))
    db.close()

    const updated = await updateFormatRowsTool.run(
      { path, format: 'unit', edits: [{ id: ids.get('U3'), values: { blocks: ['U2'] } }], commit: true },
      NO_CLIENT,
    )
    expect(updated).toContain('1 row')
    expect(await formatRowsTool.run({ path, format: 'unit', match: { blocks: 'U2' } }, NO_CLIENT)).toContain('U3')
    expect(await formatRowsTool.run({ path, format: 'unit', match: { blocks: 'U1' } }, NO_CLIENT)).toContain('No unit rows match')

    const refused = await deleteFormatRowsTool.run({ path, format: 'unit', ids: [ids.get('U2')], commit: true }, NO_CLIENT)
    expect(refused).toContain('still link to it')
  })
})

describe('a percent column (M29 U3, D-333)', () => {
  it('is declared, written as the percent, stored exactly and proved against money', async () => {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'item',
        title: 'Item',
        columns: [
          { name: 'name', type: 'text', required: true },
          { name: 'price', type: 'money' },
          { name: 'vat', type: 'percent', minimum: 0, maximum: 100 },
          { name: 'total', type: 'money' },
        ],
        identities: [{ name: 'with_vat', expression: 'price * (1 + vat) = total' }],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).not.toContain('cannot be accepted')

    const recorded = await recordFormatRowsTool.run(
      {
        path,
        format: 'item',
        rows: [
          { name: 'Lamp', price: 19.99, price_currency: 'ILS', vat: '17%', total: 23.39, total_currency: 'ILS' },
          { name: 'Pen', price: 1, price_currency: 'ILS', vat: 15, total: 1.15, total_currency: 'ILS' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(recorded).not.toContain('refused')

    const db = await reopen(path)
    const declaration = listFormats(db).find((each) => each.name === 'item')
    const rows = declaration === undefined ? [] : listRows(db, declaration)
    expect(rows.map((each) => each.cells['vat']).sort()).toEqual([150000, 170000])
    db.close()

    const shown = await formatRowsTool.run({ path, format: 'item' }, NO_CLIENT)
    expect(shown).toContain('17%')
    expect(shown).toContain('15%')
    expect(shown).not.toContain('170000')
    // 19.99 × 1.17 = 23.3883, which rounds to the agora it was invoiced at.
    expect(shown).not.toContain('with_vat: failed')
    expect(shown).toContain('with_vat: proved')

    const refused = await recordFormatRowsTool.run(
      { path, format: 'item', rows: [{ name: 'Odd', vat: '12.34567' }] },
      NO_CLIENT,
    )
    expect(refused).toContain('refused rather than rounded')
  })
})

describe('a derived column (M29 U3b, D-334)', () => {
  it('is declared, extended and returned by format_rows', async () => {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'item',
        title: 'Item',
        columns: [
          { name: 'name', type: 'text', required: true },
          { name: 'price', type: 'money' },
          { name: 'vat', type: 'percent' },
          { name: 'qty', type: 'integer' },
        ],
        derived: [{ name: 'with_vat', works_out: 'price * (1 + vat)', note: 'What it costs.' }],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).not.toContain('cannot be accepted')
    const described = await formatsTool.run({ path, format: 'item' }, NO_CLIENT)
    expect(described).toContain('fmt_item__derived')
    expect(described).toMatch(/with_vat.*price \* \(1 \+ vat\).*money/)

    const wrong = await extendFormatTool.run(
      { path, format: 'item', derived: [{ name: 'odd', works_out: 'price * price' }] },
      NO_CLIENT,
    )
    expect(wrong).toContain('money by money')

    const extended = await extendFormatTool.run(
      { path, format: 'item', derived: [{ name: 'line_total', works_out: 'with_vat * qty' }], commit: true },
      NO_CLIENT,
    )
    expect(extended).toContain('line_total')

    await recordFormatRowsTool.run(
      {
        path,
        format: 'item',
        rows: [
          { name: 'Lamp', price: 19.99, price_currency: 'ILS', vat: '17%', qty: 2 },
          { name: 'Pen', price: 1, price_currency: 'ILS', vat: 15 },
        ],
        commit: true,
      },
      NO_CLIENT,
    )

    const shown = await formatRowsTool.run({ path, format: 'item' }, NO_CLIENT)
    expect(shown).toMatch(/with_vat: .*23\.39.*\(derived\)/)
    expect(shown).toMatch(/line_total: .*46\.78.*\(derived\)/)
    expect(shown).toContain('line_total: empty — qty is empty here.')

    const narrow = await formatRowsTool.run({ path, format: 'item', columns: ['name', 'with_vat'] }, NO_CLIENT)
    expect(narrow).toMatch(/Lamp \| .*23\.39/)
  })
})

describe('several of a list in one column (M34 U5, D-398)', () => {
  it('is declared, written, refused by name off the list, and matched on one member', async () => {
    const path = await emptyDocument()
    const declared = await declareFormatTool.run(
      {
        path,
        format: 'recipe',
        title: 'Recipe',
        columns: [
          { name: 'name', type: 'text', required: true, unique: true },
          { name: 'tags', type: 'enums', values: ['vegan', 'quick', 'one pot'] },
        ],
        nothing_must_hold: true,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).toContain('**Recipe** is declared')

    const refused = await recordFormatRowsTool.run(
      { path, format: 'recipe', rows: [{ name: 'Curry', tags: ['vegan', 'spicy'] }], commit: true },
      NO_CLIENT,
    )
    expect(refused).toContain('"spicy"')

    await recordFormatRowsTool.run(
      {
        path,
        format: 'recipe',
        rows: [
          { name: 'Lentil soup', tags: ['Vegan', 'one pot'] },
          { name: 'Toast', tags: ['quick', 'vegan'] },
          { name: 'Steak', tags: 'quick' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    const vegan = await formatRowsTool.run(
      { path, format: 'recipe', match: { tags: 'vegan' }, columns: ['name', 'tags'] },
      NO_CLIENT,
    )
    expect(vegan).toContain('Lentil soup')
    expect(vegan).toContain('vegan, one pot')
    expect(vegan).toContain('Toast')
    expect(vegan).not.toContain('Steak')

    const db = await reopen(path)
    const recipe = listFormats(db).find((each) => each.name === 'recipe')!
    const soup = listRows(db, recipe).find((row) => row.cells['name'] === 'Lentil soup')
    expect(soup?.cells['tags']).toEqual(['vegan', 'one pot'])
    db.close()
  })
})
