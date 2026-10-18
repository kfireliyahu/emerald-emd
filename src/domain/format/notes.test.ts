import { describe, expect, it } from 'vitest'

import { column, type FormatDeclaration } from './declaration.ts'
import {
  BODY_LINKS_HEADER,
  FOLDER_HEADER,
  INLINE_TAGS_HEADER,
  NOTE_LIST_SEPARATOR,
  bodyLinks,
  fileLinkCount,
  inlineTags,
  isFileTarget,
  isNoteFileName,
  itemParts,
  itemSections,
  itemsTable,
  linkedNote,
  noteIndex,
  notesDigestText,
  noteItems,
  notesTable,
  parseNote,
  parseYamlSubset,
} from './notes.ts'
import { guessReading, proseLinkNames, readRows, rowLabel } from './reading.ts'

describe('a Markdown note (M34 U7)', () => {
  it('reads its frontmatter, its title and its body', () => {
    const note = parseNote({
      file: 'flour.md',
      text: '---\ntitle: Plain flour\nkcal: 364\ntags: [baking, "a, b"]\n---\nFor bread.\n',
    })
    expect(note.title).toBe('Plain flour')
    expect(note.stem).toBe('flour')
    expect(note.fields.get('kcal')).toBe('364')
    expect(note.fields.get('tags')).toEqual(['baking', 'a, b'])
    expect(note.body).toBe('For bread.')
  })

  it('is called by its frontmatter title, else by its file name — never by a heading, which stays in the body (M38 U1)', () => {
    expect(parseNote({ file: 'b.md', text: '# Butter\n\nUnsalted.' })).toMatchObject({ title: 'b', body: '# Butter\n\nUnsalted.' })
    expect(parseNote({ file: 'Sugar.md', text: 'Just sugar.' })).toMatchObject({ title: 'Sugar', body: 'Just sugar.' })
    // Windows line endings and a byte-order mark are a file's, not its text's.
    expect(parseNote({ file: 'x.md', text: '﻿---\r\nkcal: 1\r\n---\r\n' }).fields.get('kcal')).toBe('1')
  })

  it('reads the part of YAML properties use, and leaves a nested map out', () => {
    const fields = parseYamlSubset([
      'plain: some text  # a comment',
      'quoted: "a # not a comment"',
      "single: 'it''s'",
      'empty:',
      'list:',
      '  - one',
      '  - "[[Two]]"',
      'flat:',
      '- three',
      'block: |',
      '  line one',
      '  line two',
      'folded: >',
      '  one',
      '  two',
      'nested:',
      '  inner: value',
      'link: "[[Flour]]"',
      'bare: [[Flour]]',
      'time: 10:30',
      'nothing: ~',
    ])
    expect(Object.fromEntries(fields)).toEqual({
      plain: 'some text',
      quoted: 'a # not a comment',
      single: "it's",
      empty: '',
      list: ['one', '[[Two]]'],
      flat: ['three'],
      block: 'line one\nline two',
      folded: 'one two',
      link: '[[Flour]]',
      bare: '[[Flour]]',
      time: '10:30',
      nothing: '',
    })
  })
})

describe('a link in a note (M34 U7)', () => {
  it('names a note in either common form, and nothing else', () => {
    expect(linkedNote('[[Flour]]')).toBe('Flour')
    expect(linkedNote('[[Flour|plain flour]]')).toBe('Flour')
    expect(linkedNote('[[pantry/Flour#Uses]]')).toBe('Flour')
    expect(linkedNote('[Plain flour](flour.md)')).toBe('flour')
    expect(linkedNote('[x](../Ingredients/Plain%20flour%201a2b.md#top)')).toBe('Plain flour 1a2b')
    expect(linkedNote('[x](<Plain flour.md>)')).toBe('Plain flour')
    expect(linkedNote('[site](https://example.com/a.md)')).toBeUndefined()
    expect(linkedNote('[photo](flour.jpg)')).toBeUndefined()
    expect(linkedNote('Flour')).toBeUndefined()
    expect(linkedNote('see [[Flour]] first')).toBeUndefined()
  })

  it('resolves to the title of the note it names, by file name or by title', () => {
    const notes = [
      parseNote({ file: 'flour.md', text: '---\ntitle: Plain flour\n---\n' }),
      parseNote({ file: 'Egg.md', text: '' }),
    ]
    const index = noteIndex(notes)
    expect(index.titleOf('flour')).toBe('Plain flour')
    expect(index.titleOf('FLOUR')).toBe('Plain flour')
    expect(index.titleOf('Plain flour')).toBe('Plain flour')
    expect(index.titleOf('Egg')).toBe('Egg')
    expect(index.titleOf('Treacle')).toBeUndefined()
  })
})

describe('notes as a table (M34 U7)', () => {
  const INGREDIENTS = [
    parseNote({ file: 'flour.md', text: '---\ntitle: Plain flour\nkcal: 364\ntags: [baking, staple]\n---\nFor bread.' }),
    parseNote({ file: 'Egg.md', text: '---\nkcal: 143\n---\n' }),
  ]
  const RECIPES = [
    parseNote({ file: 'Pancakes.md', text: '---\nmain: "[[flour]]"\nwith: ["[Egg](Egg.md)", "[[Treacle]]"]\n---\nFry.' }),
  ]

  it('is a header row and a row per note, a list joined and marked as a list', () => {
    const table = notesTable(INGREDIENTS)
    expect(table.rows[0]?.map((cell) => cell.text)).toEqual(['title', 'file', 'kcal', 'tags', 'body'])
    expect(table.rows[1]?.map((cell) => cell.text)).toEqual([
      'Plain flour',
      'flour.md',
      '364',
      `baking${NOTE_LIST_SEPARATOR} staple`,
      'For bread.',
    ])
    expect(table.rows[2]?.[3]?.kind).toBe('empty')
    expect(table.separators).toEqual([undefined, undefined, undefined, NOTE_LIST_SEPARATOR, undefined])
    expect(rowLabel(table, 2)).toBe('Egg.md')
    expect(rowLabel({ rows: [], columnCount: 0 }, 2)).toBe('line 3')
  })

  it('writes a link as the title of the note it names, across every note read, and keeps an unknown name', () => {
    const table = notesTable(RECIPES, noteIndex([...INGREDIENTS, ...RECIPES]))
    expect(table.rows[1]?.map((cell) => cell.text)).toEqual([
      'Pancakes',
      'Pancakes.md',
      'Plain flour',
      `Egg${NOTE_LIST_SEPARATOR} Treacle`,
      'Fry.',
    ])
  })

  it('is guessed onto a format like a spreadsheet: the title onto the name, a link by its header, a list split', () => {
    const INGREDIENT: FormatDeclaration = {
      language: 5,
      name: 'ingredient',
      title: 'Ingredient',
      notes: '',
      columns: [
        column('name', 'text', { required: true, unique: true }),
        column('kcal', 'real'),
        column('tags', 'enums', { values: ['baking', 'staple', 'dairy'] }),
      ],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }
    const RECIPE: FormatDeclaration = {
      language: 5,
      name: 'recipe',
      title: 'Recipe',
      notes: '',
      columns: [
        column('name', 'text', { required: true, unique: true }),
        column('main', 'link', { target: 'ingredient' }),
        column('with', 'links', { target: 'ingredient' }),
      ],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }
    const formats = new Map([
      ['ingredient', INGREDIENT],
      ['recipe', RECIPE],
    ])

    const ingredients = notesTable(INGREDIENTS)
    const reading = guessReading(INGREDIENT, ingredients, formats)
    expect(reading.headerRow).toBe(0)
    expect(reading.columns).toEqual([
      { index: 0, key: 'name' },
      { index: 2, key: 'kcal' },
      { index: 3, key: 'tags', separator: NOTE_LIST_SEPARATOR },
    ])
    const read = readRows(INGREDIENT, reading, ingredients)
    expect(read.rows[0]?.cells?.['tags']).toEqual(['baking', 'staple'])

    const recipes = notesTable(RECIPES, noteIndex([...INGREDIENTS, ...RECIPES]))
    expect(guessReading(RECIPE, recipes, formats).columns).toEqual([
      { index: 0, key: 'name' },
      { index: 2, key: 'main' },
      { index: 3, key: 'with', separator: NOTE_LIST_SEPARATOR },
    ])
    // Without the formats, no link can be judged fillable, so none is guessed.
    expect(guessReading(RECIPE, recipes).columns).toEqual([{ index: 0, key: 'name' }])
  })

  it('hashes a folder the same whatever order its notes were listed in', () => {
    const a = { file: 'a.md', text: 'one' }
    const b = { file: 'b.md', text: 'two' }
    expect(notesDigestText([b, a])).toBe(notesDigestText([a, b]))
    expect(notesDigestText([a])).not.toBe(notesDigestText([{ ...a, text: 'One' }]))
  })
})

describe('the small faults of a folder of notes (M38 U1)', () => {
  it('takes no hidden file for a note, and still takes a note in a hidden-looking folder', () => {
    expect(isNoteFileName('._Porridge.md')).toBe(false)
    expect(isNoteFileName('.obsidian.md')).toBe(false)
    expect(isNoteFileName('vault/._Porridge.md')).toBe(false)
    expect(isNoteFileName('README')).toBe(false)
    expect(isNoteFileName('Porridge.md')).toBe(true)
    expect(isNoteFileName('.vault/Porridge.md')).toBe(true)
  })

  it('gives two notes headed alike two names', () => {
    const one = parseNote({ file: 'Porridge.md', text: '# For 1 serving\n\nOats, milk.' })
    const two = parseNote({ file: 'Overnight oats.md', text: '# For 1 serving\n\nOats, yoghurt.' })
    expect([one.title, two.title]).toEqual(['Porridge', 'Overnight oats'])
    expect(one.body.startsWith('# For 1 serving')).toBe(true)
  })

  it('reads the #tags a body writes, and not a heading, a number, an address or code', () => {
    expect(
      inlineTags(
        '# Heading\nA #breakfast dish, #quick and (#food/oats).\n#3 of 5, see page#part, `#code` and #quick again.\n```\n#fenced\n```\n#שבת',
      ),
    ).toEqual(['breakfast', 'quick', 'food/oats', 'שבת'])
  })

  it('makes the tags a list column only when a note has one, and the mapping can put them in an enums column', () => {
    const plain = notesTable([parseNote({ file: 'a.md', text: 'No tags.' })])
    expect(plain.rows[0]?.map((cell) => cell.text)).toEqual(['title', 'file', 'body'])

    const notes = [
      parseNote({ file: 'Porridge.md', text: '---\nkcal: 300\n---\nWarm. #breakfast #quick' }),
      parseNote({ file: 'Stew.md', text: '---\nkcal: 500\n---\nSlow.' }),
    ]
    const table = notesTable(notes)
    expect(table.rows[0]?.map((cell) => cell.text)).toEqual(['title', 'file', 'kcal', INLINE_TAGS_HEADER, 'body'])
    expect(table.rows[1]?.[3]?.text).toBe(`breakfast${NOTE_LIST_SEPARATOR} quick`)
    expect(table.rows[2]?.[3]?.kind).toBe('empty')
    expect(table.separators?.[3]).toBe(NOTE_LIST_SEPARATOR)

    const MEAL: FormatDeclaration = {
      language: 5,
      name: 'meal',
      title: 'Meal',
      notes: '',
      columns: [
        column('name', 'text', { required: true, unique: true }),
        column('kcal', 'real'),
        column('tags', 'enums', { values: ['breakfast', 'quick', 'dinner'] }),
      ],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }
    const reading = guessReading(MEAL, table)
    expect(reading.columns).toContainEqual({ index: 3, key: 'tags', separator: NOTE_LIST_SEPARATOR })
    expect(readRows(MEAL, reading, table).rows[0]?.cells?.['tags']).toEqual(['breakfast', 'quick'])
  })
})

describe("links in a note's body (M38 U2)", () => {
  it('reads every link form a body writes, an embed as its note, and nothing in code or off the vault', () => {
    expect(
      bodyLinks(
        [
          'Rub [[Flour]] into [the butter](../ingredients/Butter.md), then ![[Sugar#Caster]].',
          'Again [[Flour|flour]], and [[Oats#Rolled|rolled oats]] or [Plain%20flour](Plain%20flour.md).',
          'Not [a site](https://example.com/a.md), not ![a picture](pan.png), not `[[Inline code]]`.',
          '```',
          '[[Fenced]]',
          '```',
          '![[Custard]]',
        ].join('\n'),
      ),
    ).toEqual(['Flour', 'Butter', 'Sugar', 'Oats', 'Plain flour', 'Custard'])
  })

  it('is a prose list column of titles, only when a body links, and a note naming itself is no link', () => {
    const notes = [
      parseNote({ file: 'Crumble.md', text: 'Uses [[flour]] and [[Crumble]] and [[Unicorn dust]].' }),
      parseNote({ file: 'flour.md', text: '---\ntitle: Plain flour\n---\nMilled.' }),
    ]
    const table = notesTable(notes)
    expect(table.rows[0]?.map((cell) => cell.text)).toEqual(['title', 'file', BODY_LINKS_HEADER, 'body'])
    expect(table.rows[1]?.[2]?.text).toBe(`Plain flour${NOTE_LIST_SEPARATOR} Unicorn dust`)
    expect(table.rows[2]?.[2]?.kind).toBe('empty')
    expect(table.separators?.[2]).toBe(NOTE_LIST_SEPARATOR)
    expect(table.prose).toEqual([false, false, true, false])
    expect(proseLinkNames(table)).toEqual(['Plain flour', 'Unicorn dust'])

    const plain = notesTable([parseNote({ file: 'a.md', text: 'No links here.' })])
    expect(plain.rows[0]?.map((cell) => cell.text)).toEqual(['title', 'file', 'body'])
    expect(plain.prose?.some(Boolean)).toBe(false)
  })

  const INGREDIENT: FormatDeclaration = {
    language: 5,
    name: 'ingredient',
    title: 'Ingredient',
    notes: '',
    columns: [column('name', 'text', { required: true, unique: true })],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
  const TOOL: FormatDeclaration = { ...INGREDIENT, name: 'tool', title: 'Tool' }
  const dish = (...links: FormatDeclaration['columns']): FormatDeclaration => ({
    ...INGREDIENT,
    name: 'dish',
    title: 'Dish',
    columns: [column('name', 'text', { required: true, unique: true }), column('body', 'text'), ...links],
  })
  const formats = (declaration: FormatDeclaration): ReadonlyMap<string, FormatDeclaration> =>
    new Map([INGREDIENT, TOOL, declaration].map((each) => [each.name, each]))
  const table = notesTable([parseNote({ file: 'Crumble.md', text: 'Uses [[Flour]] and [[Whisk]].' })])

  it('guesses the one links column pointing where the links resolve, and leaves the body column to the body', () => {
    const DISH = dish(column('uses', 'links', { target: 'ingredient' }), column('needs', 'links', { target: 'tool' }))
    const reading = guessReading(DISH, table, formats(DISH), new Set(['ingredient']))
    expect(reading.columns).toEqual([
      { index: 0, key: 'name' },
      { index: 2, key: 'uses', separator: NOTE_LIST_SEPARATOR },
      { index: 3, key: 'body' },
    ])
    // Two columns where the links go is a guess between them: none is made.
    expect(guessReading(DISH, table, formats(DISH), new Set(['ingredient', 'tool'])).columns.map((each) => each.key)).toEqual([
      'name',
      'body',
    ])
    // Nowhere found, nothing guessed; not told, only a format with one fillable links column.
    expect(guessReading(DISH, table, formats(DISH), new Set()).columns.some((each) => each.index === 2)).toBe(false)
    expect(guessReading(DISH, table, formats(DISH)).columns.some((each) => each.index === 2)).toBe(false)
    const ONE = dish(column('uses', 'links', { target: 'ingredient' }))
    expect(guessReading(ONE, table, formats(ONE)).columns).toContainEqual({ index: 2, key: 'uses', separator: NOTE_LIST_SEPARATOR })
  })
})


describe('a note’s items (M38 U4)', () => {
  const UNITS = ['g', 'kg', 'ml', 'tbsp', 'cup']

  it('reads top-level list items under their heading, a checkbox as ticked or not, and nothing in code', () => {
    const body = [
      '## To do',
      '- [ ] Buy flour',
      '- [x] Book the oven',
      '  - a detail, not an item',
      '* * *',
      '```',
      '- not an item',
      '```',
      '## Done',
      '1. Cleaned up',
    ].join('\n')
    const items = noteItems(body, 'list')
    expect(items.map((each) => [each.section, each.text, each.checked])).toEqual([
      ['To do', 'Buy flour', false],
      ['To do', 'Book the oven', true],
      ['Done', 'Cleaned up', undefined],
    ])
    expect(noteItems(body, 'list', 'done').map((each) => each.text)).toEqual(['Cleaned up'])
  })

  it('splits an item into a figure, a unit the document knows, its first link and its words', () => {
    expect(itemParts('200 g [[Flour]], sifted', UNITS)).toEqual({
      figure: { value: 200, written: '200' },
      unit: 'g',
      link: 'Flour',
      text: 'Flour, sifted',
    })
    expect(itemParts('1 1/2 cups [[sugar|caster sugar]]', UNITS)).toMatchObject({
      figure: { value: 1.5 },
      unit: 'cup',
      link: 'sugar',
      text: 'caster sugar',
    })
    expect(itemParts('½ tbsp salt', UNITS)).toMatchObject({ figure: { value: 0.5 }, unit: 'tbsp', text: 'salt' })
    expect(itemParts('200g flour', UNITS)).toMatchObject({ figure: { value: 200 }, unit: 'g', text: 'flour' })
    // A word that is no unit stays a word.
    expect(itemParts('2 eggs', UNITS)).toMatchObject({ figure: { value: 2 }, unit: undefined, text: 'eggs' })
    expect(itemParts('salt to taste', UNITS)).toMatchObject({ figure: undefined, unit: undefined, link: undefined })
    expect(itemParts('see [the dough](Dough.md) and [a site](https://example.com)', UNITS).link).toBe('Dough')
  })

  it('reads a table in the body by its own header, a link as the note it names and [x] as ticked', () => {
    const board = [
      '## Cards',
      '',
      '| Card | Done | Who |',
      '| --- | :-: | --- |',
      '| Paint | [x] | [[Ann]] |',
      '| Sand | [ ] | Bob \\| Cy |',
      '',
      'After the table.',
    ].join('\n')
    const notes = [parseNote({ file: 'Board.md', text: board }), parseNote({ file: 'Ann.md', text: '---\ntitle: Ann Smith\n---\n' })]
    const table = itemsTable(notes, { from: 'table', source: 'boards/', units: UNITS })
    expect(table.rows[0]?.map((cell) => cell.text)).toEqual(['note', 'section', 'position', 'Card', 'Done', 'Who'])
    expect(table.rows[1]?.map((cell) => cell.text)).toEqual(['Board.md', 'Cards', '1', 'Paint', '[x]', 'Ann Smith'])
    expect(table.rows[1]?.[4]).toEqual({ kind: 'boolean', text: '[x]', value: true })
    expect(table.rows[2]?.[5]?.text).toBe('Bob | Cy')
    expect(table.rows).toHaveLength(3)
    expect(table.rowNames).toEqual([undefined, 'Board.md, row 1', 'Board.md, row 2'])
    expect(table.keyedBy?.[0]).toBe('boards/')
  })

  it('makes a list’s items one table, each row named by its note and place, and guesses by what each part is', () => {
    const notes = [parseNote({ file: 'Soup.md', text: '## Ingredients\n- 1 kg [[Leek]]\n- 2 cups water\n## Method\n1. Boil.\n' })]
    expect(itemSections(notes, 'list')).toEqual(['Ingredients', 'Method'])
    const table = itemsTable(notes, { from: 'list', under: 'Ingredients', source: 'soups/', units: UNITS })
    expect(table.rowNames).toEqual([undefined, 'Soup.md, item 1', 'Soup.md, item 2'])
    expect(table.rows[1]?.[5]).toEqual({ kind: 'number', text: '1', value: 1 })

    const line: FormatDeclaration = {
      language: 5,
      name: 'soup_line',
      title: 'Soup line',
      notes: '',
      columns: [
        column('what', 'text'),
        column('soup', 'link', { target: 'soup' }),
        column('leek', 'link', { target: 'vegetable' }),
        column('amount', 'quantity'),
        column('bought', 'boolean'),
      ],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }
    const named = (name: string): FormatDeclaration => ({
      ...line,
      name,
      columns: [column('name', 'text', { required: true, unique: true })],
    })
    const all = new Map([
      ['soup_line', line],
      ['soup', named('soup')],
      ['vegetable', named('vegetable')],
    ])
    expect(guessReading(line, table, all, undefined, 'soup').columns).toEqual([
      { index: 0, key: 'soup' },
      { index: 4, key: 'bought' },
      { index: 5, key: 'amount' },
      { index: 6, key: 'amount_unit' },
      { index: 7, key: 'leek' },
      { index: 8, key: 'what' },
    ])
    // No parent named: the way back is the person's to map.
    expect(guessReading(line, table, all).columns.some((each) => each.index === 0)).toBe(false)
  })
})

describe('nested folders and embedded files (M48 U2)', () => {
  it('tells a file that is not a note from a note by its extension', () => {
    expect(['Pasted image 20261002.png', 'syllabus.pdf', 'board.JPG', 'clip.mp4'].map(isFileTarget)).toEqual([true, true, true, true])
    expect(['Calculus', 'notes.md', 'v1.2', 'Mr. Smith', 'Part 2.1'].map(isFileTarget)).toEqual([false, false, false, false, false])
  })

  it('leaves an embedded file out of the body links and counts it, unless a note is called that', () => {
    const notes = [
      parseNote({ file: 'Year 1/Algebra.md', text: 'See [[Node.js]] and [[Calculus]].\n\n![[Pasted image.png]]\n![[Pasted image.png]]\n![[notes.pdf|200]]' }),
      parseNote({ file: 'Node.js.md', text: 'A runtime.' }),
    ]
    expect(notes[0]?.folder).toBe('Year 1')
    expect(notes[1]?.folder).toBe('')
    const table = notesTable(notes)
    const header = table.rows[0]?.map((cell) => cell.text) ?? []
    expect(header.slice(0, 3)).toEqual(['title', 'file', FOLDER_HEADER])
    const row = table.rows[1]?.map((cell) => cell.text) ?? []
    expect(row[2]).toBe('Year 1')
    expect(row[header.indexOf(BODY_LINKS_HEADER)]).toBe(`Node.js${NOTE_LIST_SEPARATOR} Calculus`)
    // The image once, however often it is embedded, and the PDF: two.
    expect(fileLinkCount(notes)).toBe(2)
  })

  it('makes no folder column, and no body links column, when nothing calls for one', () => {
    const table = notesTable([parseNote({ file: 'Flat.md', text: 'Only ![[photo.png]] here.' })])
    expect(table.rows[0]?.map((cell) => cell.text)).toEqual(['title', 'file', 'body'])
  })
})
