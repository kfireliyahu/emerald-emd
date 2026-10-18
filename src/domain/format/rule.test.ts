/**
 * A matching rule (M25 E4, D-273): the sentence, the predicate, the order a
 * rule wins by, and the one law — a rule never overwrites a person's value.
 */

import { describe, expect, it } from 'vitest'

import { read, write } from './artefact.ts'
import { column, DECLARATION_LANGUAGE, declarationProblems, type FormatDeclaration } from './declaration.ts'
import {
  applyOnWrite,
  decide,
  parseRuleSet,
  patternMatches,
  prepareRules,
  rulePatternProblems,
  ruleSetText,
  type RuleRow,
  type RuleSetDeclaration,
} from './rule.ts'

const SENTENCE =
  'product.shelf from shelf when label or brand matches pattern by kind (WHOLE equals, PART contains, ' +
  'START starts with, RE regex) first by tier then priority where enabled is true and only_brand is empty, ' +
  'recorded in shelf_source as RULE, never over PERSON, noting rule'

function ruleSet(text = SENTENCE): RuleSetDeclaration {
  const parsed = parseRuleSet('shelves', text, 'where a product goes')
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

const SHELF: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'shelf',
  title: 'Shelf',
  notes: '',
  columns: [column('name', 'text', { required: true, unique: true })],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const PRODUCT: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'product',
  title: 'Product',
  notes: '',
  columns: [
    column('label', 'text', { required: true }),
    column('brand', 'text'),
    column('shelf', 'link', { target: 'shelf' }),
    column('shelf_source', 'enum', { values: ['RULE', 'PERSON', 'IMPORT'] }),
    column('rule', 'link', { target: 'shelf_rule' }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const RULES: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'shelf_rule',
  title: 'Shelf rule',
  notes: '',
  columns: [
    column('pattern', 'text', { required: true }),
    column('kind', 'enum', { required: true, values: ['WHOLE', 'PART', 'START', 'RE', 'BY_PRICE'] }),
    column('shelf', 'link', { target: 'shelf', required: true }),
    column('tier', 'enum', { required: true, values: ['MINE', 'SHIPPED'] }),
    column('priority', 'integer', { required: true }),
    column('enabled', 'boolean', { required: true }),
    column('only_brand', 'text'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
  ruleSets: [ruleSet()],
}

function rule(id: string, cells: Partial<Record<string, string | number | null>>): RuleRow {
  return {
    id,
    cells: { kind: 'PART', shelf: 'dairy', tier: 'MINE', priority: 0, enabled: 1, only_brand: null, ...cells },
  }
}

describe('the sentence', () => {
  it('reads back exactly what it wrote', () => {
    const set = ruleSet()
    expect(set).toMatchObject({
      target: 'product',
      sets: 'shelf',
      from: 'shelf',
      reads: ['label', 'brand'],
      pattern: 'pattern',
      order: ['tier', 'priority'],
      source: 'shelf_source',
      ruleMember: 'RULE',
      personMember: 'PERSON',
      noting: 'rule',
    })
    expect(ruleSetText(set)).toBe(SENTENCE)
    expect(ruleSetText(ruleSet(ruleSetText(set)))).toBe(SENTENCE)
  })

  it('keeps a `one of` list and a quoted member in its filter (M48 U1)', () => {
    const text = SENTENCE.replace('where enabled is true', 'where state is one of On, Half on and tier is "Top shelf"')
    const set = ruleSet(text)
    expect(set.where).toEqual([
      { column: 'state', is: 'On', oneOf: ['On', 'Half on'] },
      { column: 'tier', is: 'Top shelf' },
      { column: 'only_brand', is: 'empty' },
    ])
    expect(ruleSetText(set)).toBe(text)
  })

  it('takes one kind for every rule, and needs no noting', () => {
    const set = ruleSet(
      'product.shelf from shelf when label matches pattern as starts with first by priority, recorded in shelf_source as RULE, never over PERSON',
    )
    expect(set.kind).toEqual({ fixed: 'STARTS_WITH' })
    expect(set.noting).toBeUndefined()
  })

  it('refuses a rule set that does not say where its value came from', () => {
    const parsed = parseRuleSet('shelves', 'product.shelf from shelf when label matches pattern as contains first by priority')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('never over')
  })

  it('refuses a kind off the list', () => {
    const parsed = parseRuleSet(
      'shelves',
      'product.shelf from shelf when label matches pattern by kind (WHOLE sounds like) first by priority, recorded in shelf_source as RULE, never over PERSON',
    )
    expect(parsed.ok).toBe(false)
  })

  it('travels through a .format.md as a sixth table', () => {
    const text = write(RULES)
    expect(text).toContain('| rule set | sets | note |')
    const back = read(text, undefined, [SHELF, PRODUCT])
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value.ruleSets?.[0]).toEqual(ruleSet())
  })
})

describe('what a declaration may say', () => {
  const problems = (set: RuleSetDeclaration): string[] =>
    declarationProblems({ ...RULES, ruleSets: [set] }, [SHELF, PRODUCT]).map((each) => each.message)

  it('takes the one above', () => {
    expect(problems(ruleSet())).toEqual([])
  })

  it('refuses a set link and a rule link that name different formats', () => {
    expect(problems({ ...ruleSet(), from: 'kind' }).join(' ')).toContain('Both have to name rows of one format')
  })

  it('refuses an order a rule may leave empty', () => {
    expect(problems({ ...ruleSet(), order: ['only_brand'] }).join(' ')).toContain('which is a text')
    const optional = { ...RULES, columns: RULES.columns.map((each) => (each.name === 'priority' ? { ...each, required: false } : each)) }
    const said = declarationProblems({ ...optional, ruleSets: [ruleSet()] }, [SHELF, PRODUCT]).map((each) => each.message)
    expect(said.join(' ')).toContain('Make priority required')
  })

  it('refuses a source whose members are not the enum’s, or are one', () => {
    expect(problems({ ...ruleSet(), personMember: 'SOMEBODY' }).join(' ')).toContain('one of RULE, PERSON, IMPORT')
    expect(problems({ ...ruleSet(), personMember: 'RULE' }).join(' ')).toContain('nothing could tell them apart')
  })

  it('refuses a target the document does not declare, and its own rows', () => {
    expect(problems({ ...ruleSet(), target: 'basket' }).join(' ')).toContain('declares no such format')
    expect(problems({ ...ruleSet(), target: 'shelf_rule' }).join(' ')).toContain('own rows')
  })

  it('refuses a rule set on a language that cannot say one', () => {
    const said = declarationProblems({ ...RULES, language: 11 }, [SHELF, PRODUCT]).map((each) => each.message)
    expect(said.join(' ')).toContain('format language 12')
  })
})

describe('matching', () => {
  it('folds case and spaces, and an empty pattern matches nothing', () => {
    expect(patternMatches('EQUALS', 'oat  milk', 'OAT MILK')).toBe(true)
    expect(patternMatches('CONTAINS', 'milk', 'Oat Milk 1L')).toBe(true)
    expect(patternMatches('STARTS_WITH', 'oat', 'Oat Milk')).toBe(true)
    expect(patternMatches('STARTS_WITH', 'milk', 'Oat Milk')).toBe(false)
    expect(patternMatches('CONTAINS', '  ', 'anything')).toBe(false)
    expect(patternMatches('REGEX', '^oat\\b', 'OAT MILK')).toBe(true)
    expect(patternMatches('REGEX', '(', 'OAT MILK')).toBe(false)
  })

  it('refuses a rule whose pattern would never match, at its write', () => {
    expect(rulePatternProblems([ruleSet()], { kind: 'RE', pattern: '(' }).join(' ')).toContain('compiles')
    expect(rulePatternProblems([ruleSet()], { kind: 'PART', pattern: ' ' }).join(' ')).toContain('matches nothing')
    // A kind this rule set does not read is not its to judge.
    expect(rulePatternProblems([ruleSet()], { kind: 'BY_PRICE', pattern: '' })).toEqual([])
  })
})

describe('which rule wins', () => {
  const decideWith = (rows: RuleRow[], cells: Record<string, string | null>) =>
    decide(prepareRules(ruleSet(), RULES.columns, rows), cells)

  it('the first by the declared order — an enum by its members, then a number', () => {
    const rows = [
      rule('late', { pattern: 'milk', shelf: 'drinks', tier: 'SHIPPED', priority: -5 }),
      rule('early', { pattern: 'milk', shelf: 'dairy', tier: 'MINE', priority: 9 }),
    ]
    expect(decideWith(rows, { label: 'Oat milk' })).toEqual({ kind: 'SET', value: 'dairy', rule: 'early' })
  })

  it('a tie naming different rows is left alone and said', () => {
    const rows = [
      rule('a', { pattern: 'milk', shelf: 'dairy' }),
      rule('b', { pattern: 'oat', shelf: 'cereal' }),
    ]
    expect(decideWith(rows, { label: 'Oat milk' })).toEqual({ kind: 'TIE', rules: ['a', 'b'] })
  })

  it('a tie naming one row agrees, and notes the first by id', () => {
    const rows = [rule('b', { pattern: 'oat' }), rule('a', { pattern: 'milk' })]
    expect(decideWith(rows, { label: 'Oat milk' })).toEqual({ kind: 'SET', value: 'dairy', rule: 'a' })
  })

  it('reads any of the columns, skips a disabled rule, a kind it does not read and a rule with a condition it cannot say', () => {
    const rows = [
      rule('off', { pattern: 'acme', enabled: 0, shelf: 'x' }),
      rule('price', { pattern: 'acme', kind: 'BY_PRICE', shelf: 'y' }),
      rule('scoped', { pattern: 'acme', only_brand: 'ACME', shelf: 'z' }),
      rule('on', { pattern: 'acme', shelf: 'pantry', priority: 5 }),
    ]
    expect(decideWith(rows, { label: 'Beans', brand: 'Acme' })).toEqual({ kind: 'SET', value: 'pantry', rule: 'on' })
  })
})

describe('a rule never overwrites a person', () => {
  const prepared = [prepareRules(ruleSet(), RULES.columns, [rule('r', { pattern: 'milk' })])]

  it('sets a new row, recording that a rule did and which', () => {
    const { cells } = applyOnWrite(prepared, { label: 'Milk', shelf: null, shelf_source: null, rule: null })
    expect(cells).toMatchObject({ shelf: 'dairy', shelf_source: 'RULE', rule: 'r' })
  })

  it('a link the writer set is a person’s', () => {
    const { cells } = applyOnWrite(prepared, { label: 'Milk', shelf: 'fridge', shelf_source: null })
    expect(cells).toMatchObject({ shelf: 'fridge', shelf_source: 'PERSON' })
  })

  it('an edit to the text re-sorts a row that is the rules’, and not one that is a person’s', () => {
    const before = { label: 'Bread', shelf: 'bakery', shelf_source: 'RULE', rule: 'old' }
    expect(applyOnWrite(prepared, { label: 'Milk' }, before).cells).toMatchObject({ shelf: 'dairy', rule: 'r' })
    const mine = { label: 'Bread', shelf: 'bakery', shelf_source: 'PERSON' }
    expect(applyOnWrite(prepared, { label: 'Milk' }, mine).cells).toEqual({ label: 'Milk' })
  })

  it('a person who emptied it is taken at their word; another writer’s empty is the rules’', () => {
    expect(applyOnWrite(prepared, { label: 'Milk', shelf: null, shelf_source: 'PERSON' }).cells.shelf).toBeNull()
    expect(applyOnWrite(prepared, { label: 'Milk', shelf: null, shelf_source: 'IMPORT' }).cells.shelf).toBe('dairy')
  })

  it('an edit that leaves the link as it was is not a person setting it', () => {
    const before = { label: 'Milk', shelf: 'dairy', shelf_source: 'RULE', rule: 'r' }
    const { cells } = applyOnWrite(prepared, { label: 'Milk', shelf: 'dairy', shelf_source: 'RULE' }, before)
    expect(cells.shelf_source).toBe('RULE')
  })
})
