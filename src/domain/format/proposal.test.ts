import { describe, expect, it } from 'vitest'

import { COLUMN_TYPES, declarationProblems } from './declaration.ts'
import { declarationOf } from './draft.ts'
import {
  exampleExcerpt,
  EXAMPLE_MAX_LINES,
  formatFromExample,
  toProposedDraft,
} from './proposal.ts'

const LABEL = [
  'Tahini, whole sesame',
  'Nutrition per 100 g',
  'Energy 595 kcal',
  'Protein 17 g',
  'Fat 53.4 g',
  'of which saturates 7.6 g',
  'Sodium 0.02 g',
  'Best before: 2027-03-01',
].join('\n')

/** A well-formed answer, as a runtime that honoured the grammar would send it. */
const ANSWER = {
  name: 'ingredient',
  title: 'Ingredient',
  columns: [
    { name: 'brand', type: 'text', required: true, note: 'who made it' },
    { name: 'energy_kcal', type: 'integer', unit: 'kcal' },
    { name: 'protein_g', type: 'real', unit: 'g' },
    { name: 'best_before', type: 'date' },
    { name: 'organic', type: 'boolean' },
    { name: 'micros_basis', type: 'enum', values: ['analogue', 'mixed', 'label'] },
    { name: 'price', type: 'money' },
  ],
}

describe('the task', () => {
  it('has no numeric leaf anywhere, so no figure off the example can enter the answer', () => {
    // The U2c form of D-132, and the reason `minimum` and `maximum` are not
    // asked for: a bound is the one field where a number read off the paper
    // would become a `CHECK` on every row typed afterwards. The pack's four
    // tasks keep the same rule the other way round — every leaf an integer, a
    // boolean or a member of a fixed list — because their answers are read as
    // *positions* rather than as words.
    for (const leaf of leaves(formatFromExample.schema({ text: '' }))) {
      if (leaf.type === 'string') continue
      expect(['boolean'], `a ${String(leaf.type)} leaf is somewhere a figure can hide`).toContain(
        leaf.type,
      )
    }
    const schema = JSON.stringify(formatFromExample.schema({ text: '' }))
    expect(schema).not.toContain('minimum')
    expect(schema).not.toContain('maximum')
  })

  it('hands over the type vocabulary rather than leaving it to be discovered', () => {
    // D-114: unaided, a model asked to use an app's vocabulary invents members
    // of it. Both halves are built from one list, so they cannot drift.
    const schema = JSON.stringify(formatFromExample.schema({ text: '' }))
    for (const type of COLUMN_TYPES) {
      if (type === 'link' || type === 'links' || type === 'quantity' || type === 'decimal' || type === 'elsewhere' || type === 'file') continue
      expect(schema).toContain(`"${type}"`)
      expect(formatFromExample.system({ text: '' })).toContain(type)
    }
  })

  /**
   * **A model is not offered `link`** (U4b, D-224), and it is the same rule as
   * the missing bound one line up: what goes out is a label, a receipt or a
   * spreadsheet, so the document's other formats are not in front of it, and a
   * target it named could only have been invented. The editor is where a link
   * is added, with the other formats on the screen beside the choice.
   */
  it('does not offer a link, because the example carries no document', () => {
    const schema = JSON.stringify(formatFromExample.schema({ text: '' }))
    expect(schema).not.toContain('"link"')
  })

  it('sends the example and says it is describing the kind rather than the thing', () => {
    const prompt = formatFromExample.prompt({ text: LABEL })
    expect(prompt).toContain('Energy 595 kcal')
    expect(prompt).toContain('Do not report anything the example says.')
  })

  it('has a budget it cannot sensibly overrun', () => {
    expect(formatFromExample.limits.maxTokens).toBeLessThanOrEqual(2000)
    expect(formatFromExample.limits.contextTokens).toBeGreaterThanOrEqual(8192)
    expect(formatFromExample.limits.deadlineMs).toBeGreaterThan(0)
  })
})

describe('exampleExcerpt', () => {
  it('leaves a label alone', () => {
    const excerpt = exampleExcerpt(LABEL)
    expect(excerpt.text).toBe(LABEL)
    expect(excerpt.truncated).toBe(false)
    expect(excerpt.lines).toBe(8)
  })

  it('keeps the first lines of a spreadsheet and says how many there were', () => {
    const rows = Array.from({ length: 900 }, (_, index) => `row ${String(index)}`).join('\n')
    const excerpt = exampleExcerpt(rows)
    expect(excerpt.text.split('\n')).toHaveLength(EXAMPLE_MAX_LINES)
    expect(excerpt.text.startsWith('row 0')).toBe(true)
    expect(excerpt.lines).toBe(900)
    expect(excerpt.truncated).toBe(true)
  })

  it('caps the characters too, because one line can be a whole file', () => {
    const excerpt = exampleExcerpt('x'.repeat(20_000))
    expect(excerpt.text.length).toBeLessThanOrEqual(6000)
    expect(excerpt.truncated).toBe(true)
  })

  it('is what the prompt actually sends', () => {
    const rows = Array.from({ length: 900 }, (_, index) => `row ${String(index)}`).join('\n')
    expect(formatFromExample.prompt({ text: rows })).not.toContain('row 899')
  })
})

describe('toProposedDraft', () => {
  it('reads a well-formed answer as a draft with no identity, which the editor creates as it is', () => {
    const draft = toProposedDraft(ANSWER)
    expect(draft?.name).toBe('ingredient')
    expect(draft?.columns).toHaveLength(7)

    // **Every column is accepted, and no identity proposed** (D-222): a model is
    // never asked what has to add up. Since M29 F4 (D-345) the editor no longer
    // waits for somebody to say *nothing does* — a draft with none says it — so
    // the person who owns the data adds one or simply creates the format.
    expect(draft?.identities).toEqual([])
    expect(declarationProblems(declarationOf(draft ?? never()), [])).toEqual([])
  })

  it('never arrives as a revision of a format that already exists', () => {
    // D-220's *creates and never alters*, one level down: an example is not
    // evidence about the rows a table already holds, so a name that collides is
    // an ordinary duplicate-name problem in the editor rather than an edit
    // nobody asked for.
    expect(toProposedDraft(ANSWER)?.revising).toBeUndefined()
  })

  it('leaves the notes empty, because the argument is the person’s', () => {
    expect(toProposedDraft(ANSWER)?.notes).toBe('')
  })

  it('keeps a name that breaks the rules, so the editor can say so beside it', () => {
    // The opposite of `toPayslipLines`, and deliberate: a bad line number points
    // somewhere and has to be dropped; a bad name is a red line under a field.
    const draft = toProposedDraft({
      ...ANSWER,
      columns: [{ name: 'Sat Fat (g)', type: 'real', unit: 'g' }],
    })
    expect(draft?.columns[0]?.name).toBe('Sat Fat (g)')
    expect(declarationProblems(declarationOf(draft ?? never()), [])[0]?.message).toContain(
      'not a usable column name',
    )
  })

  it('drops a column whose type is not one of the seven', () => {
    // A select cannot offer a type that does not exist, and a column silently
    // re-typed to `text` would be the invisible failure.
    const draft = toProposedDraft({
      ...ANSWER,
      columns: [{ name: 'weight', type: 'decimal' }, { name: 'brand', type: 'text' }],
    })
    expect(draft?.columns.map((each) => each.name)).toEqual(['brand'])
  })

  it('clears what a type cannot carry, rather than trusting what arrived', () => {
    const draft = toProposedDraft({
      ...ANSWER,
      columns: [
        { name: 'price', type: 'money', unit: 'ILS' },
        { name: 'brand', type: 'text', values: ['one', 'two'] },
        { name: 'basis', type: 'enum', values: ['label', '', 'analogue', 7] },
      ],
    })
    // A currency lives in the row, so a money column has no unit at all.
    expect(draft?.columns[0]?.unit).toBe('')
    expect(draft?.columns[1]?.values).toBe('')
    expect(draft?.columns[2]?.values).toBe('label, analogue')
  })

  it('cannot carry a bound even when one is sent, which is the grammar’s promise kept twice', () => {
    const draft = toProposedDraft({
      ...ANSWER,
      columns: [{ name: 'energy_kcal', type: 'integer', minimum: 0, maximum: 595 }],
    })
    expect(draft?.columns[0]?.minimum).toBe('')
    expect(draft?.columns[0]?.maximum).toBe('')
  })

  it('requires a column only when the answer says so in a boolean', () => {
    const draft = toProposedDraft({
      ...ANSWER,
      columns: [
        { name: 'brand', type: 'text', required: true },
        { name: 'source', type: 'text', required: 'yes' },
        { name: 'note', type: 'text' },
      ],
    })
    expect(draft?.columns.map((each) => each.required)).toEqual([true, false, false])
  })

  it('falls back to the title’s slug when the answer names nothing', () => {
    expect(toProposedDraft({ ...ANSWER, name: '' })?.name).toBe('ingredient')
    expect(toProposedDraft({ ...ANSWER, name: 7, title: 'Skin cream' })?.name).toBe('skin_cream')
  })

  it('refuses what is not a proposal at all', () => {
    expect(toProposedDraft('ingredient')).toBeUndefined()
    expect(toProposedDraft([{ name: 'brand', type: 'text' }])).toBeUndefined()
    expect(toProposedDraft({ ...ANSWER, columns: 'brand, price' })).toBeUndefined()
    expect(toProposedDraft({ ...ANSWER, columns: [] })).toBeUndefined()
    expect(toProposedDraft({ ...ANSWER, columns: ['brand'] })).toBeUndefined()
  })
})

function never(): never {
  throw new Error('the draft was not read')
}

/** Every leaf of a JSON Schema, the same walk `modelTasks.test.ts` makes. */
function leaves(schema: unknown): readonly { type?: unknown }[] {
  if (typeof schema !== 'object' || schema === null) return []
  const node = schema as Record<string, unknown>
  if (node['properties'] !== undefined) {
    return Object.values(node['properties'] as Record<string, unknown>).flatMap(leaves)
  }
  if (node['items'] !== undefined) return leaves(node['items'])
  return [node]
}
