import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listCategories, setCategoryArchived } from '@/data/repositories/categoryRepository.ts'

import { createDocumentTool } from './setup.ts'
import { editCategoriesTool } from './categoryEdits.ts'
import { createCategoryTool } from './taxonomy.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

async function newDocument(): Promise<string> {
  const path = join(await tempDir('emerald-taxonomy-'), 'doc.emd')
  await createDocumentTool.run({ path }, NO_CLIENT)
  return path
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}

async function categories(path: string) {
  const db = await reopen(path)
  const all = listCategories(db, { includeArchived: true })
  db.close()
  return all
}

describe('create_category', () => {
  it('creates a top-level category and reports its id', async () => {
    const path = await newDocument()
    const text = await createCategoryTool.run({ path, categories: [{ name: 'Dog' }] }, NO_CLIENT)

    expect(text).toContain('created')
    const made = (await categories(path)).find((one) => one.name === 'Dog')
    expect(made).toBeDefined()
    expect(made?.kind).toBe('EXPENSE')
    expect(made?.parentId).toBeUndefined()
    expect(text).toContain(made?.id ?? 'no id')
  })

  it('takes the kind it is given', async () => {
    const path = await newDocument()
    await createCategoryTool.run(
      { path, categories: [{ name: 'Freelance', kind: 'INCOME' }] },
      NO_CLIENT,
    )

    expect((await categories(path)).find((one) => one.name === 'Freelance')?.kind).toBe('INCOME')
  })

  it('inherits the parent’s kind rather than the one it was handed', async () => {
    // The rule that used to live in the app's form. "Food → Salary" must not be
    // expressible, whichever front end is asking.
    const path = await newDocument()
    const parent = (await categories(path)).find((one) => !one.isSystem && one.kind === 'EXPENSE')
    expect(parent).toBeDefined()
    if (parent === undefined) return

    await createCategoryTool.run(
      { path, categories: [{ name: 'Dog food', kind: 'INCOME', parent_id: parent.id }] },
      NO_CLIENT,
    )

    const made = (await categories(path)).find((one) => one.name === 'Dog food')
    expect(made?.kind).toBe('EXPENSE')
    expect(made?.parentId).toBe(parent.id)
  })

  it('creates nothing when a live category of that name is already there', async () => {
    const path = await newDocument()
    const existing = (await categories(path)).find((one) => !one.isSystem && !one.isArchived)
    expect(existing).toBeDefined()
    if (existing === undefined) return

    const before = (await categories(path)).length
    const text = await createCategoryTool.run(
      { path, categories: [{ name: existing.name }] },
      NO_CLIENT,
    )

    expect(text).toContain('already existed')
    expect(text).toContain(existing.id)
    expect((await categories(path)).length).toBe(before)
  })

  it('brings an archived one back rather than making a twin', async () => {
    // The case that matters: onboarding archives most of the shipped list, so
    // the name a conversation cannot find usually still exists, with whatever
    // is already filed under it.
    const path = await newDocument()
    const db = await openDatabase(await readFile(path))
    const target = listCategories(db, { includeArchived: true }).find((one) => !one.isSystem)
    db.close()
    expect(target).toBeDefined()
    if (target === undefined) return

    const writable = await openDatabase(await readFile(path))
    setCategoryArchived(writable, target.id, true, Date.now())
    await writeFile(path, exportDatabase(writable))
    writable.close()

    const before = (await categories(path)).length
    const text = await createCategoryTool.run(
      { path, categories: [{ name: target.name }] },
      NO_CLIENT,
    )

    expect(text).toContain('brought back')
    expect((await categories(path)).length).toBe(before)
    expect((await categories(path)).find((one) => one.id === target.id)?.isArchived).toBe(false)
  })

  it('refuses a malformed entry outright, and applies nothing', async () => {
    const path = await newDocument()
    const before = (await categories(path)).length

    // A caller mistake. The corrected batch is one turn away, and half of it
    // already applied would have to be reconciled first.
    await expect(
      createCategoryTool.run({ path, categories: [{ name: 'Fine' }, { name: '  ' }] }, NO_CLIENT),
    ).rejects.toThrow('non-empty string')
    await expect(
      createCategoryTool.run({ path, categories: [{ name: 'Fine', kind: 'SPENDING' }] }, NO_CLIENT),
    ).rejects.toThrow('must be one of')

    expect((await categories(path)).length).toBe(before)
  })

  it('teaches the list shape to a caller that sent the old single form', async () => {
    const path = await newDocument()
    await expect(createCategoryTool.run({ path, name: 'Dog' }, NO_CLIENT)).rejects.toThrow(
      'takes a list',
    )
  })
})

describe('the batch', () => {
  it('creates a parent and its children in one call, in order', async () => {
    // The case a list makes expressible at all: the child names a parent that
    // did not exist when the call was made.
    const path = await newDocument()
    const text = await createCategoryTool.run(
      {
        path,
        categories: [
          { name: 'Falconry' },
          { name: 'Perch', parent_name: 'Falconry' },
          { name: 'Jesses', parent_name: 'Falconry' },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('3 created of 3')
    const all = await categories(path)
    const parent = all.find((one) => one.name === 'Falconry')
    expect(parent).toBeDefined()
    expect(all.filter((one) => one.parentId === parent?.id)).toHaveLength(2)
    expect(all.find((one) => one.name === 'Perch')?.path).toBe('Falconry → Perch')
  })

  it('reports a bad parent per entry and still lands the rest', async () => {
    // A data condition, not a caller mistake: the write is additive and every
    // outcome is named, so losing nineteen good entries to one typo would cost
    // more than it protects.
    const path = await newDocument()
    const text = await createCategoryTool.run(
      {
        path,
        categories: [
          { name: 'Kept' },
          { name: 'Orphan', parent_id: 'nope' },
          { name: 'Also kept' },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('2 created of 3')
    expect(text).toContain('no category with id nope')
    const all = await categories(path)
    expect(all.some((one) => one.name === 'Kept')).toBe(true)
    expect(all.some((one) => one.name === 'Also kept')).toBe(true)
    expect(all.some((one) => one.name === 'Orphan')).toBe(false)
  })

  it('refuses a fourth level (M28 F29), naming the parent instead of letting the repository throw', async () => {
    const path = await newDocument()
    const text = await createCategoryTool.run(
      { path, categories: [{ name: 'Middle', parent_name: 'Falconry' }] },
      NO_CLIENT,
    )
    expect(text).toContain('no category named')

    await createCategoryTool.run(
      { path, categories: [{ name: 'Falconry' }, { name: 'Upper', parent_name: 'Falconry' }, { name: 'Middle', parent_name: 'Upper' }] },
      NO_CLIENT,
    )
    const middle = (await categories(path)).find((one) => one.name === 'Middle')
    expect(middle).toBeDefined()
    if (middle === undefined) return

    const deep = await createCategoryTool.run(
      { path, categories: [{ name: 'Too deep', parent_id: middle.id }] },
      NO_CLIENT,
    )

    expect(deep).toContain('3 levels at most')
    expect((await categories(path)).some((one) => one.name === 'Too deep')).toBe(false)
  })

  it('has a ceiling, and says what it is', async () => {
    const path = await newDocument()
    const many = Array.from({ length: 101 }, (_, at) => ({ name: `Category ${String(at)}` }))

    await expect(createCategoryTool.run({ path, categories: many }, NO_CLIENT)).rejects.toThrow(
      'the ceiling is 100',
    )
  })
})

describe('the category tree in a conversation (M28 F29)', () => {
  it('create_category puts a heading at the top and two levels under it, and refuses a fourth', async () => {
    const path = await newDocument()
    const text = await createCategoryTool.run(
      {
        path,
        categories: [
          { name: 'Hobbies' },
          { name: 'Pottery', parent_name: 'hobbies' },
          { name: 'Glaze', parent_name: 'Pottery' },
          { name: 'Too deep', parent_name: 'Glaze' },
        ],
      },
      NO_CLIENT,
    )
    expect(text).toContain('under Hobbies → Pottery')
    expect(text).toContain('categories nest 3 levels at most')
    const all = await categories(path)
    expect(all.find((one) => one.name === 'Glaze')?.path).toBe('Hobbies → Pottery → Glaze')
    expect(all.some((one) => one.name === 'Too deep')).toBe(false)
  })

  it('refuses the groups it used to take, saying what to do instead', async () => {
    const path = await newDocument()
    await expect(createCategoryTool.run({ path, groups: [{ name: 'Hobbies' }] }, NO_CLIENT)).rejects.toThrow('no groups any more')
    await expect(
      editCategoriesTool.run({ path, edits: [{ category_id: 'x', group: 'Living' }] }, NO_CLIENT),
    ).rejects.toThrow('no groups any more')
  })

  it('edit_categories moves a category and what it carries under another, within three levels and its kind', async () => {
    const path = await newDocument()
    const all = await categories(path)
    const find = (name: string) => {
      const found = all.find((one) => one.name === name)
      if (found === undefined) throw new Error(`seed changed: ${name}`)
      return found
    }
    const edits = [
      // Utilities carries Electricity, Water and Gas: under Lifestyle they are three deep.
      { category_id: find('Utilities').id, parent_id: find('Lifestyle').id },
      // Living carries two levels, so it fits under nothing.
      { category_id: find('Living').id, parent_id: find('Transport').id },
      // Salary is income, and Groceries is spending.
      { category_id: find('Salary').id, parent_id: find('Groceries').id },
    ]
    const dry = await editCategoriesTool.run({ path, edits }, NO_CLIENT)
    expect(dry).toContain('move under Lifestyle')
    expect(dry).toContain('its subcategories would go past that')
    expect(dry).toContain('a category goes under one of its own kind')

    await editCategoriesTool.run({ path, edits, commit: true }, NO_CLIENT)
    const after = await categories(path)
    expect(after.find((one) => one.name === 'Water')?.path).toBe('Lifestyle → Utilities → Water')
  })
})
