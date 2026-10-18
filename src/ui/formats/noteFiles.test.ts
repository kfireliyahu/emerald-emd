import { describe, expect, it } from 'vitest'

import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { parseNote } from '@/domain/format/notes.ts'

import { formatNamedBy, sortPicked, tablesAcross } from './noteFiles.ts'

const picked = (path: string, text = ''): { file: File; path: string } => ({
  file: new File([text], path.split('/').pop() ?? path),
  path,
})

describe('files picked or dropped, as folders of notes (M34 U7)', () => {
  it('groups notes by the folder each sits in, and names what is not a note there as skipped', async () => {
    const { folders, others } = await sortPicked([
      picked('vault/ingredients/Flour.md', '---\nkcal: 364\n---\n'),
      picked('vault/ingredients/shopping.txt'),
      picked('vault/recipes/Pancakes.md', '---\nmain: "[[Flour]]"\n---\n'),
      picked('vault/photo.jpg'),
      { file: new File(['a,b'], 'loose.csv'), path: '' },
      { file: new File(['# Loose'], 'Loose.md'), path: '' },
    ])
    expect(folders.map((each) => [each.name, each.notes.map((note) => note.file), each.skipped])).toEqual([
      ['ingredients/', ['Flour.md'], ['shopping.txt']],
      ['recipes/', ['Pancakes.md'], []],
      ['notes', ['Loose.md'], []],
    ])
    // A file in a folder with no notes, or picked loose, is the screen's to read or refuse.
    expect(others.map((each) => each.name)).toEqual(['photo.jpg', 'loose.csv'])
  })

  it('reads no hidden file: skipped in a folder of notes, else named as hidden (M38 U1)', async () => {
    const { folders, others, hidden } = await sortPicked([
      picked('vault/meals/Porridge.md', '# For 1 serving'),
      picked('vault/meals/._Porridge.md', '\u0000\u0005\u0016\u0007'),
      picked('vault/meals/README', 'About.'),
      picked('vault/sheets/._prices.xlsx', '\u0000'),
      picked('vault/sheets/prices.xlsx'),
    ])
    expect(folders.map((each) => [each.name, each.notes.map((note) => note.file), each.skipped])).toEqual([
      ['meals/', ['Porridge.md'], ['._Porridge.md', 'README']],
    ])
    expect(others.map((each) => each.name)).toEqual(['prices.xlsx'])
    expect(hidden).toEqual(['._prices.xlsx'])

    // Dropped loose beside loose notes, it is theirs to name as skipped.
    const loose = await sortPicked([
      { file: new File(['Oats.'], 'Porridge.md'), path: '' },
      { file: new File(['\u0000'], '._Porridge.md'), path: '' },
    ])
    expect(loose.folders.map((each) => [each.name, each.skipped])).toEqual([['notes', ['._Porridge.md']]])
    expect([loose.others, loose.hidden]).toEqual([[], []])
  })

  it('resolves a link across every folder on the screen', () => {
    const [, recipes] = tablesAcross([
      [parseNote({ file: 'flour.md', text: '---\ntitle: Plain flour\n---\n' })],
      [parseNote({ file: 'Pancakes.md', text: '---\nmain: "[[flour]]"\n---\n' })],
    ])
    expect(recipes?.rows[1]?.[2]?.text).toBe('Plain flour')
  })
})

describe('the format a file names (M34 U7)', () => {
  const format = (name: string, title: string): FormatDeclaration => ({
    language: 5,
    name,
    title,
    notes: '',
    columns: [column('name', 'text')],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  })
  const WRITABLE = [format('ingredient', 'Ingredient'), format('recipe_line', 'Recipe line'), format('dish', 'Recipes')]

  it('is found by its name or title, one plural either way, and nothing looser', () => {
    expect(formatNamedBy('ingredients/', WRITABLE)?.name).toBe('ingredient')
    expect(formatNamedBy('recipe-lines.csv', WRITABLE)?.name).toBe('recipe_line')
    expect(formatNamedBy('Recipes', WRITABLE)?.name).toBe('dish')
    expect(formatNamedBy('ingredient-notes/', WRITABLE)).toBeUndefined()
    expect(formatNamedBy('notes', WRITABLE)).toBeUndefined()
  })
})
