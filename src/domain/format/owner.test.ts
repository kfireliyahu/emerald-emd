import { describe, expect, it } from 'vitest'

import { read, write } from './artefact.ts'
import { declarationOf, draftOf, draftProblems } from './draft.ts'
import { parseConstraint, type RowConstraint } from './constraint.ts'
import { column, declarationRejection, type FormatDeclaration } from './declaration.ts'
import { declarationChangeRefusal, deleteFormatRefusal, rowWriteRefusal } from './owner.ts'

/**
 * **A pack's format: read anywhere, written only through the pack** — M25 E5,
 * D-269.
 */

function one(sentence: string): RowConstraint {
  const parsed = parseConstraint(sentence)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

const CATEGORY: FormatDeclaration = {
  language: 13,
  name: 'category',
  title: 'Category',
  notes: '',
  columns: [
    column('name', 'text', { required: true, unique: true }),
    column('parent', 'link', { target: 'category' }),
    column('mine', 'text'),
  ],
  identities: [],
  aggregates: [],
  constraints: [one('one row per name, parent')],
  nothingMustHold: true,
  owner: {
    pack: 'ledger',
    written: 'on the Categories screen, or with `create_category`',
    columns: ['name', 'parent'],
  },
}

const { owner: _lock, ...PERSONS } = CATEGORY

describe('a format a pack owns (M25 E5, D-269)', () => {
  it('refuses a generic row write in one sentence naming where to go instead', () => {
    expect(rowWriteRefusal(CATEGORY)).toBe(
      'Category belongs to the ledger pack, so its rows are written only through it — ' +
        'on the Categories screen, or with `create_category`. Reading them here is fine.',
    )
    expect(rowWriteRefusal(PERSONS)).toBeUndefined()
  })

  it('refuses deleting the format, and lets a person delete their own', () => {
    expect(deleteFormatRefusal(CATEGORY)).toMatch(/only the pack can take it away/)
    expect(deleteFormatRefusal(PERSONS)).toBeUndefined()
  })

  it('takes a column of a person’s own, and changes or drops one', () => {
    const added = { ...CATEGORY, columns: [...CATEGORY.columns, column('colour', 'text')] }
    expect(declarationChangeRefusal(CATEGORY, added)).toBeUndefined()
    const dropped = { ...CATEGORY, columns: CATEGORY.columns.filter((each) => each.name !== 'mine') }
    expect(declarationChangeRefusal(CATEGORY, dropped)).toBeUndefined()
  })

  it('refuses changing or dropping one of the pack’s columns', () => {
    const changed = {
      ...CATEGORY,
      columns: CATEGORY.columns.map((each) => (each.name === 'parent' ? { ...each, unique: true } : each)),
    }
    expect(declarationChangeRefusal(CATEGORY, changed)).toMatch(/parent is one of its columns, so it stays as the pack declared it/)
    const dropped = { ...CATEGORY, columns: CATEGORY.columns.filter((each) => each.name !== 'parent') }
    expect(declarationChangeRefusal(CATEGORY, dropped)).toMatch(/parent is one of its columns, so it stays\./)
  })

  it('refuses taking the lock off, or away anything else the format held', () => {
    expect(declarationChangeRefusal(CATEGORY, PERSONS)).toMatch(/the pack's to say/)
    expect(declarationChangeRefusal(CATEGORY, { ...CATEGORY, constraints: [] })).toMatch(/the constraint/)
  })

  it('writes the lock into the text and reads it back, a person’s column still theirs', () => {
    const text = write(CATEGORY)
    expect(text).toContain('pack: ledger')
    expect(text).toContain('written: on the Categories screen, or with `create_category`')
    expect(text).toContain('pack columns: name, parent')
    const back = read(text)
    if (!back.ok) throw new Error(back.error)
    expect(back.value.owner).toEqual(CATEGORY.owner)
  })

  it('reads a pack’s own file, which lists no columns, as every column the pack’s', () => {
    const text = write(CATEGORY).replace('pack columns: name, parent\n', '')
    const back = read(text)
    if (!back.ok) throw new Error(back.error)
    expect(back.value.owner?.columns).toEqual(['name', 'parent', 'mine'])
  })

  it('refuses a lock without a pack, or a pack without where its rows go', () => {
    const noPack = write(CATEGORY).replace('pack: ledger\n', '')
    expect(read(noPack).ok).toBe(false)
    const noWhere = write(CATEGORY).replace(/written: .*\n/, '')
    const refused = read(noWhere)
    expect(refused.ok ? '' : refused.error).toMatch(/needs a `written:`/)
  })

  it('is language 13, so a build that could not read the lock refuses the format', () => {
    expect(declarationRejection({ ...CATEGORY, language: 12 })).toMatch(/format language 13 says/)
    expect(declarationRejection({ ...CATEGORY, owner: { ...CATEGORY.owner!, columns: ['nope'] } })).toMatch(
      /nope is its pack's column, and has no column by that name/,
    )
  })

  it('keeps the lock through the editor, and draws a changed pack column as a problem', () => {
    const draft = draftOf(CATEGORY)
    expect(declarationOf(draft).owner).toEqual(CATEGORY.owner)
    expect(draftProblems(draft, [CATEGORY])).toEqual([])
    const unique = {
      ...draft,
      columns: draft.columns.map((each) => (each.name === 'parent' ? { ...each, unique: true } : each)),
    }
    expect(draftProblems(unique, [CATEGORY]).map((each) => each.message).join(' ')).toMatch(
      /parent is one of its columns/,
    )
  })
})

describe('a pack format’s columns moved (M29 U2, D-332)', () => {
  const at = (...names: string[]): FormatDeclaration => ({
    ...CATEGORY,
    columns: names.flatMap((name) => CATEGORY.columns.filter((each) => each.name === name)),
  })

  it('moves freely while the pack’s entries keep the name they are called by', () => {
    expect(declarationChangeRefusal(CATEGORY, at('parent', 'name', 'mine'))).toBeUndefined()
  })

  it('refuses a text column of a person’s own moved ahead of the one naming the pack’s entries', () => {
    expect(declarationChangeRefusal(CATEGORY, at('mine', 'name', 'parent'))).toContain(
      'its entries are called by their name, so name stays its first text column',
    )
  })
})
