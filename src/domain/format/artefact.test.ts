/**
 * **The acceptance test for M19 U1 is in this file**, and it is one line of
 * `engine.md`: *"`Ingredients/Pasta.md` is the specification. If a declaration
 * can hold that note, the engine exists."*
 *
 * `fixtures/synthetic/ingredient.format.md` is that note as a declaration —
 * synthetic, because a real ingredient label is not a real statement and nothing
 * about it is personal, but it is a real note's twenty-five-odd fields rather
 * than an invented shape.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { aggregate } from './aggregate.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from './declaration.ts'
import { identity } from './identity.ts'
import { read, write } from './artefact.ts'

const PASTA = readFileSync(
  fileURLToPath(new URL('../../../fixtures/synthetic/ingredient.format.md', import.meta.url)),
  'utf8',
)

describe('the ingredient format', () => {
  it('is expressible, which is the whole of what U1 claims', () => {
    const result = read(PASTA)
    if (!result.ok) throw new Error(result.error)

    expect(result.value.name).toBe('ingredient')
    expect(result.value.language).toBe(1)
    // Twenty-five typed columns was the figure engine.md named; the note has a
    // few more than that and every one of them lands.
    expect(result.value.columns.length).toBeGreaterThanOrEqual(25)
  })

  it('keeps the third state the vault reinvented on its own', () => {
    const result = read(PASTA)
    if (!result.ok) throw new Error(result.error)

    const basis = result.value.columns.find((each) => each.name === 'micros_basis')
    expect(basis?.type).toBe('enum')
    expect(basis?.values).toEqual(['label', 'analogue', 'mixed'])
  })

  it('keeps the prose, because half the note is the argument', () => {
    const result = read(PASTA)
    if (!result.ok) throw new Error(result.error)

    expect(result.value.notes).toContain('not money, on purpose')
  })

  it('round-trips: what is written reads back identically', () => {
    // The property that makes "a person can read and diff" mean anything. If a
    // read-write cycle moved a single cell, a diff between two versions of a
    // format would show edits nobody made.
    const first = read(PASTA)
    if (!first.ok) throw new Error(first.error)

    const second = read(write(first.value))
    if (!second.ok) throw new Error(second.error)

    expect(second.value).toEqual(first.value)
    expect(write(second.value)).toBe(write(first.value))
  })
})

describe('a moved column (M29 U2, D-332)', () => {
  it('reads back where it was moved to, so the order survives a .format.md', () => {
    const first = read(PASTA)
    if (!first.ok) throw new Error(first.error)
    const moved = { ...first.value, columns: [...first.value.columns].reverse() }

    const back = read(write(moved))
    if (!back.ok) throw new Error(back.error)

    expect(back.value.columns.map((each) => each.name)).toEqual(moved.columns.map((each) => each.name))
    expect(back.value).toEqual(moved)
  })
})

describe('writing', () => {
  const declaration: FormatDeclaration = {
    language: 1,
    name: 'product_trial',
    title: 'Product tried',
    notes: 'The beauty products I try, so the price can link to what paid for it.',
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    columns: [
      column('product', 'text', { required: true, note: 'What it was' }),
      column('rating', 'integer', { minimum: 1, maximum: 5, note: 'Out of five' }),
      column('would_repurchase', 'boolean'),
      column('price', 'money'),
      column('tried_on', 'date'),
    ],
  }

  it('pads nothing, so renaming one column does not re-space every row', () => {
    // The property that keeps a diff honest. Aligned columns would make
    // `fat_g` → `total_fat_g` show twenty-five changed lines for one changed
    // word, and "a person can diff it" is one of the three reasons this
    // artefact is markdown at all.
    const text = write(declaration)
    expect(text).toContain('| rating | integer |  |  |  | no |  | 1 | 5 | Out of five |')

    const renamed = write({
      ...declaration,
      columns: declaration.columns.map((each) =>
        each.name === 'product' ? { ...each, name: 'product_name_at_some_length' } : each,
      ),
    })
    const lines = (text: string) => text.split('\n').filter((line) => !line.includes('product'))
    expect(lines(renamed)).toEqual(lines(text))
  })

  it('round-trips H2’s own settling case', () => {
    // The dataset that picked declare-and-compile over map-only: a product you
    // tried, whose whole value is one link into the ledger. Under map-only
    // there is no table for it to land on and the case is simply impossible.
    const back = read(write(declaration))
    if (!back.ok) throw new Error(back.error)
    expect(back.value).toEqual(declaration)
  })

  it('escapes a pipe in a note rather than refusing the sentence', () => {
    const withPipe = { ...declaration, columns: [column('unit', 'text', { note: 'g | ml' })] }
    const back = read(write(withPipe))
    if (!back.ok) throw new Error(back.error)
    expect(back.value.columns[0]?.note).toBe('g | ml')
  })
})

describe('reading something malformed', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['no frontmatter', 'format: x\n', 'starts with a --- line'],
    ['an unclosed block', '---\nformat: x\n', 'never closed'],
    ['no format name', '---\ntitle: X\nlanguage: 1\n---\n', '`format:`'],
    ['no language', '---\nformat: x\n---\n', '`language:`'],
    ['no table', '---\nformat: x\nlanguage: 1\n---\n\nprose\n', 'No columns table'],
  ]

  for (const [name, text, expected] of cases) {
    it(`says what is wrong with ${name}`, () => {
      const result = read(text)
      expect(result.ok).toBe(false)
      if (result.ok) return
      // One sentence, naming the thing. Read by a person editing a file and by a
      // model being told its last attempt was wrong, and neither can ask a
      // follow-up question.
      expect(result.error).toContain(expected)
    })
  }

  it('names the line of a bad row', () => {
    const text = `---\nformat: x\nlanguage: 1\n---\n\n| column | type | unit | required | values | min | max | note |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| a | flavour |  | no |  |  |  |  |\n`
    const result = read(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Line 8')
    expect(result.error).toContain('flavour')
  })

  it('refuses a reordered header rather than reading it by name', () => {
    // A table whose columns were swapped would parse "correctly" under a
    // by-name reader and mean something else entirely in a diff.
    const text = `---\nformat: x\nlanguage: 1\n---\n\n| type | column | unit | required | values | min | max | note |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| text | a |  | no |  |  |  |  |\n`
    const result = read(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("a declaration's tables are headed")
  })
})

describe('identities in a file', () => {
  it('round-trips the identity the fixture declares', () => {
    const first = read(PASTA)
    if (!first.ok) throw new Error(first.error)
    const atwater = first.value.identities[0]
    expect(atwater?.name).toBe('atwater')
    expect(atwater?.expression).toBe('4*protein_g + 4*(carbs_g - fiber_g) + 9*fat_g + 2*fiber_g = kcal')
    expect(atwater?.tolerance).toEqual({ kind: 'RELATIVE', percent: 2 })

    const second = read(write(first.value))
    if (!second.ok) throw new Error(second.error)
    expect(second.value).toEqual(first.value)
  })

  it('keeps the arithmetic exactly as it was typed', () => {
    // The artefact exists so two versions of a format can be diffed by a person.
    // A normalizer would make every diff a diff of this build's opinions.
    const text = write({
      language: DECLARATION_LANGUAGE,
      name: 'thing',
      title: 'Thing',
      notes: '',
      columns: [column('a', 'real'), column('b', 'real')],
      identities: [identity('spaced', 'a  +  a = b')],
      aggregates: [],
      nothingMustHold: false,
    })
    expect(text).toContain('a  +  a = b')
  })

  it('says `claims: none` when it makes no claim, and reads it back', () => {
    const declared = {
      language: DECLARATION_LANGUAGE,
      name: 'thing',
      title: 'Thing',
      notes: '',
      columns: [column('a', 'real')],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }
    const text = write(declared)
    expect(text).toContain('claims: none')
    const back = read(text)
    if (!back.ok) throw new Error(back.error)
    expect(back.value).toEqual(declared)
    // A file written before M33 U3a said `checks: none`, and still reads.
    const before = read(text.replace('claims: none', 'checks: none'))
    if (!before.ok) throw new Error(before.error)
    expect(before.value).toEqual(declared)
  })

  it('writes its identities as claims, and reads a file that called them identities (M33 U3a)', () => {
    const declared = {
      language: DECLARATION_LANGUAGE,
      name: 'thing',
      title: 'Thing',
      notes: '',
      columns: [column('a', 'real'), column('b', 'real')],
      identities: [identity('a_adds_up', 'a = b', { note: 'why' })],
      aggregates: [],
      nothingMustHold: false,
    }
    const text = write(declared)
    expect(text).toContain('| claim | holds | tolerance | note |')
    expect(text).not.toContain('| identity |')
    const before = read(text.replace('| claim | holds |', '| identity | holds |'))
    if (!before.ok) throw new Error(before.error)
    expect(before.value).toEqual(declared)
  })

  it('refuses a file that answers H3 with a word this build does not know', () => {
    const text = write({
      language: DECLARATION_LANGUAGE,
      name: 'thing',
      title: 'Thing',
      notes: '',
      columns: [column('a', 'real')],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }).replace('claims: none', 'claims: whatever')
    const back = read(text)
    expect(back.ok).toBe(false)
    if (back.ok) return
    expect(back.error).toContain('claims: whatever')
  })

  it('reads a file with no identities and no `checks:` line — the default (M38 U5)', () => {
    // H3 in the third surface: `checks: none` may still be written, and is no
    // longer needed.
    const text = write({
      language: DECLARATION_LANGUAGE,
      name: 'thing',
      title: 'Thing',
      notes: '',
      columns: [column('a', 'real')],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }).replace('claims: none\n', '')
    expect(read(text).ok).toBe(true)
  })

  it('refuses a tolerance cell that is not one of the three shapes', () => {
    const text = write({
      language: DECLARATION_LANGUAGE,
      name: 'thing',
      title: 'Thing',
      notes: '',
      columns: [column('a', 'real'), column('b', 'real')],
      identities: [identity('one', 'a = b')],
      aggregates: [],
      nothingMustHold: false,
    }).replace('| exactly |', '| about right |')
    const back = read(text)
    expect(back.ok).toBe(false)
    if (back.ok) return
    expect(back.error).toContain('about right')
  })
})

/**
 * **A quantity, a ratio, and the two older headers** (U4c, D-225).
 *
 * The language integer's whole purpose is that a file written by an older build
 * reads as what it is. There are two of those now, and the writer emits only
 * the current one — so a file that has been through the app once is current.
 */
describe('a file with a quantity and a ratio in it', () => {
  const RECIPE_LINE: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'recipe_line',
    title: 'Recipe line',
    notes: 'A line is 150 g here and 200 ml there, which is why the unit is in the row.',
    columns: [
      // Pointing at itself, which was once the only link this reader would
      // accept and is now merely one that needs no neighbour (U6, D-234).
      column('made_from', 'link', { target: 'recipe_line' }),
      column('amount', 'quantity', { required: true, note: 'What the recipe says.' }),
      column('density', 'real', { unit: 'g', per: 'ml', note: 'What a millilitre of it weighs.' }),
    ],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  it('round-trips both halves of the ratio and the quantity', () => {
    const back = read(write(RECIPE_LINE))
    if (!back.ok) throw new Error(back.error)
    expect(back.value).toEqual(RECIPE_LINE)
  })

  it('writes `per` beside `unit`, because the two are one fact', () => {
    expect(write(RECIPE_LINE)).toContain('| column | type | points at | unit | per |')
    expect(write(RECIPE_LINE)).toContain('| density | real |  | g | ml | no |')
  })

  it('reads a file written before `per` existed, as what it is', () => {
    const before = [
      '---',
      'format: ingredient',
      'title: Ingredient',
      'language: 3',
      'checks: none',
      '---',
      '',
      '| column | type | points at | unit | required | values | min | max | note |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| kcal | real |  | kcal | no |  |  |  | Per 100 g |',
      '',
    ].join('\n')

    const back = read(before)
    if (!back.ok) throw new Error(back.error)
    expect(back.value.columns[0]?.unit).toBe('kcal')
    expect(back.value.columns[0]?.per).toBeUndefined()
  })
})

/**
 * The parity break U5 found and U6 fixed (D-234).
 *
 * A conversation writes a declaration carrying a `link` with `declare_format`,
 * which judges it against the formats the document has. This reader judged every
 * declaration against **none**, so the same file coming back through *From a
 * declaration* at `#/formats` was refused for naming a format that plainly
 * existed. The two halves disagreed about what a declaration is, which is
 * exactly what `src/parity.test.ts` was opened to stop.
 */
describe('a declaration read beside the ones the document already has', () => {
  const INGREDIENT: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'ingredient',
    title: 'Ingredient',
    notes: '',
    columns: [column('kcal', 'real', { unit: 'kcal' })],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  const LINE = [
    '---',
    'format: recipe_line',
    'title: Recipe line',
    `language: ${String(DECLARATION_LANGUAGE)}`,
    'checks: none',
    '---',
    '',
    '| column | type | points at | unit | per | required | values | min | max | note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| ingredient | link | ingredient |  |  | yes |  |  |  | What this line is of. |',
    '',
  ].join('\n')

  it('reads a link once the format it points at is in front of it', () => {
    const back = read(LINE, undefined, [INGREDIENT])
    if (!back.ok) throw new Error(back.error)
    expect(back.value.columns[0]?.target).toBe('ingredient')
  })

  it('still refuses one that points at a format the document has not got', () => {
    const back = read(LINE, undefined, [])
    expect(back.ok).toBe(false)
    if (back.ok) return
    expect(back.error).toContain('ingredient')
  })

  it('treats a file of the same name as a revision rather than a duplicate', () => {
    // What the editor's `draftProblems` does with `revising`, done here from the
    // name in the frontmatter: a `.format.md` of `ingredient` pasted into a
    // document that already declares `ingredient` is that format being changed.
    const again = read(write(INGREDIENT), undefined, [INGREDIENT])
    if (!again.ok) throw new Error(again.error)
    expect(again.value.name).toBe('ingredient')
  })
})

describe('a unique column in a file (M24 U4, D-255)', () => {
  const base: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'decision',
    title: 'Decision',
    notes: '',
    columns: [column('ref', 'text', { required: true, unique: true }), column('title', 'text')],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  it('is written in a column of its own, and read back', () => {
    const text = write(base)
    expect(text).toContain('| column | type | points at | unit | per | required | unique |')
    const back = read(text)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value.columns.map((each) => each.unique)).toEqual([true, false])
  })

  it('leaves a file with no unique column exactly as it was written before', () => {
    const text = write({ ...base, columns: [column('ref', 'text'), column('title', 'text')] })
    expect(text).not.toContain('| unique |')
    expect(text).toContain('| column | type | points at | unit | per | required | values |')
  })
})

describe('an aggregate that says where (M24 U8, D-260)', () => {
  const paycheck: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'paycheck',
    title: 'Paycheck',
    notes: '',
    nothingMustHold: true,
    identities: [],
    columns: [column('gross', 'money')],
    aggregates: [
      aggregate(
        'deducted',
        'SUM',
        { format: 'paycheck_line', column: 'paycheck' },
        { expression: 'amount', where: { column: 'deduction_type.reduces_net', is: 'true' } },
      ),
    ],
  }

  // The source and the format one hop out, so the reader can judge the filter.
  const NEIGHBOURS: readonly FormatDeclaration[] = [
    {
      ...paycheck,
      name: 'paycheck_line',
      title: 'Paycheck line',
      aggregates: [],
      columns: [
        column('paycheck', 'link', { target: 'paycheck' }),
        column('deduction_type', 'link', { target: 'deduction_type' }),
        column('amount', 'money'),
      ],
    },
    {
      ...paycheck,
      name: 'deduction_type',
      title: 'Deduction type',
      aggregates: [],
      columns: [column('reduces_net', 'boolean')],
    },
  ]

  it('writes the filter into the over cell, and reads it back', () => {
    const text = write(paycheck)
    expect(text).toContain('| paycheck_line.paycheck where deduction_type.reduces_net is true |')
    const back = read(text, undefined, NEIGHBOURS)
    expect(back.ok ? back.value.aggregates : back.error).toEqual(paycheck.aggregates)
  })

  it('refuses a filter it cannot read, by line', () => {
    const text = write(paycheck).replace('reduces_net is true', 'reduces_net = true')
    const back = read(text)
    expect(back.ok).toBe(false)
    expect(!back.ok && back.error).toMatch(/^Line \d+: .* is not a filter/)
  })
})

describe('an aggregate that picks the latest (M25 E3, D-272)', () => {
  const security: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'security',
    title: 'Security',
    notes: '',
    nothingMustHold: true,
    identities: [],
    columns: [column('name', 'text')],
    aggregates: [
      aggregate(
        'price',
        'LATEST',
        { format: 'security_price', column: 'security' },
        { expression: 'price', by: 'as_of', where: { column: 'source', is: 'TYPED' } },
      ),
    ],
  }
  const NEIGHBOURS: readonly FormatDeclaration[] = [
    {
      ...security,
      name: 'security_price',
      title: 'Security price',
      aggregates: [],
      columns: [
        column('security', 'link', { target: 'security' }),
        column('as_of', 'date'),
        column('price', 'real'),
        column('source', 'enum', { values: ['TYPED', 'FETCHED'] }),
      ],
    },
  ]

  it('writes the order into the over cell before the filter, and reads it back', () => {
    const text = write(security)
    expect(text).toContain('| price | latest | security_price.security by as_of where source is TYPED | price |')
    const back = read(text, undefined, NEIGHBOURS)
    expect(back.ok ? back.value.aggregates : back.error).toEqual(security.aggregates)
  })
})
