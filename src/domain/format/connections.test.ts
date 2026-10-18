import { describe, expect, it } from 'vitest'

import { aggregate } from './aggregate.ts'
import {
  column,
  DECLARATION_LANGUAGE,
  type ColumnDeclaration,
  type FormatDeclaration,
} from './declaration.ts'
import {
  connect,
  edgeHeadline,
  edgesOf,
  edgeWords,
  foldNames,
  foldType,
  foldsOver,
  freeColumnName,
  graphOf,
  headlineOf,
  nounOf,
  pluralOf,
  proposalFor,
  ranksOf,
  samePort,
  suggestedFigureName,
  type Port,
} from './connections.ts'

function format(
  name: string,
  columns: readonly ColumnDeclaration[],
  extra: Partial<Pick<FormatDeclaration, 'title' | 'aggregates' | 'derived'>> = {},
): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name,
    title: extra.title ?? name,
    notes: '',
    columns,
    identities: [],
    aggregates: extra.aggregates ?? [],
    ...(extra.derived === undefined ? {} : { derived: extra.derived }),
    nothingMustHold: true,
  }
}

/**
 * The shape every one of these tests is about: a recipe, its lines, and the
 * ingredients the lines name. It is the vault's own case (D-210) and the one
 * the whole third arrow was built for.
 */
const INGREDIENT = format('ingredient', [column('kcal', 'real', { unit: 'kcal' })], {
  title: 'Ingredient',
})

const RECIPE = format('recipe', [column('servings', 'integer')], { title: 'Recipe' })

const LINE = format(
  'recipe_line',
  [
    column('recipe', 'link', { target: 'recipe' }),
    column('ingredient', 'link', { target: 'ingredient' }),
    column('amount_g', 'real', { unit: 'g' }),
  ],
  { title: 'Recipe line' },
)

const VAULT = [INGREDIENT, RECIPE, LINE]

const row = (format: string): Port => ({ kind: 'ROW', format })
const col = (format: string, column: string): Port => ({ kind: 'COLUMN', format, column })
const newLink = (format: string): Port => ({ kind: 'NEW_LINK', format })
const newFigure = (format: string): Port => ({ kind: 'NEW_FIGURE', format })

describe('a port', () => {
  it('is the same port when its kind, format and name agree', () => {
    expect(samePort(col('recipe_line', 'recipe'), col('recipe_line', 'recipe'))).toBe(true)
    expect(samePort(col('recipe_line', 'recipe'), col('recipe_line', 'ingredient'))).toBe(false)
    expect(samePort(row('recipe'), col('recipe', 'servings'))).toBe(false)
    expect(samePort(newLink('recipe'), newFigure('recipe'))).toBe(false)
  })
})

describe('the graph', () => {
  it('gives every format a bubble with its columns as endpoints', () => {
    const nodes = graphOf(VAULT)
    const line = nodes.find((each) => each.name === 'recipe_line')
    expect(line?.title).toBe('Recipe line')
    expect(line?.ports.map((each) => each.label)).toEqual([
      'recipe',
      'ingredient',
      'amount_g',
      'belongs to one…',
      'has many…',
    ])
  })

  /**
   * **The ports say the relationship, not the storage** (M29 F10, wording A):
   * a link reads *one Recipe* and says, on hover, which end is the many.
   */
  it('says a link and a total in plain words, with no code', () => {
    const line = graphOf(VAULT).find((each) => each.name === 'recipe_line')
    const link = line?.ports.find((each) => each.label === 'recipe')
    expect(link?.detail).toBe('one Recipe')
    expect(link?.says).toBe('Each recipe line belongs to one recipe.')
    const plain = line?.ports.find((each) => each.label === 'amount_g')
    expect(plain?.says).toBe('amount_g — a number, in g. Drag onto a format to make it a connection.')
    const recipe = format('recipe', [], {
      title: 'Recipe',
      aggregates: [aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'recipe' })],
    })
    const total = graphOf([recipe, LINE])
      .find((each) => each.name === 'recipe')
      ?.ports.find((each) => each.label === 'lines')
    expect(total?.detail).toBe('from recipe lines')
    expect(total?.says).toBe('lines adds up its recipe lines.')
  })

  it('lowers a title for a sentence, and makes it many, in English only', () => {
    expect(nounOf('Work day')).toBe('work day')
    expect(nounOf('DTI rate')).toBe('DTI rate')
    expect(pluralOf('Work day')).toBe('work days')
    expect(pluralOf('Category')).toBe('categories')
    expect(pluralOf('Tax')).toBe('taxes')
    expect(pluralOf('תלוש')).toBe('תלוש')
  })

  it('marks which endpoints have a connection running through them', () => {
    const nodes = graphOf(VAULT)
    const line = nodes.find((each) => each.name === 'recipe_line')
    const quiet = line?.ports.find((each) => each.label === 'amount_g')
    const live = line?.ports.find((each) => each.label === 'recipe')
    expect(quiet?.edges).toBe(0)
    expect(live?.edges).toBe(1)
    // A row port counts the links aimed at it, which is what makes a bubble
    // nothing points at visibly a leaf.
    expect(nodes.find((each) => each.name === 'recipe')?.row.edges).toBe(1)
    expect(nodes.find((each) => each.name === 'ingredient')?.row.edges).toBe(1)
  })

  it('carries a link target only when the document declares it', () => {
    const [node] = graphOf([format('order_line', [column('order', 'link', { target: 'order' })])])
    expect(node?.ports[0]?.target).toBeUndefined()
    const both = graphOf([format('order', []), format('order_line', [column('order', 'link', { target: 'order' })])])
    expect(both[1]?.ports[0]?.target).toBe('order')
  })

  it('draws a figure as an endpoint of its own', () => {
    const recipe = format('recipe', [column('servings', 'integer')], {
      aggregates: [
        aggregate('total_kcal', 'SUM', { format: 'recipe_line', column: 'recipe' }, {
          expression: 'amount_g / 100 * ingredient.kcal',
        }),
      ],
    })
    const nodes = graphOf([INGREDIENT, recipe, LINE])
    const figure = nodes
      .find((each) => each.name === 'recipe')
      ?.ports.find((each) => each.port.kind === 'FIGURE')
    expect(figure?.label).toBe('total_kcal')
    expect(figure?.edges).toBe(1)
  })
})

describe('the edges', () => {
  it('reads a link out of a link column', () => {
    const links = edgesOf(VAULT).filter((each) => each.kind === 'LINK')
    expect(links.map((each) => (each.kind === 'LINK' ? `${each.format}.${each.column}→${each.target}` : ''))).toEqual([
      'recipe_line.recipe→recipe',
      'recipe_line.ingredient→ingredient',
    ])
    expect(links.every((each) => !each.dangling)).toBe(true)
  })

  it('draws a link at a format that is gone, and marks it', () => {
    const [edge] = edgesOf([format('recipe_line', [column('recipe', 'link', { target: 'recipe' })])])
    expect(edge?.dangling).toBe(true)
  })

  it('runs a figure back along the link that gathers it', () => {
    const recipe = format('recipe', [], {
      aggregates: [aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'recipe' })],
    })
    const [edge] = edgesOf([recipe, LINE]).filter((each) => each.kind === 'FIGURE')
    expect(edge?.from).toEqual({ kind: 'FIGURE', format: 'recipe', figure: 'lines' })
    expect(edge?.to).toEqual({ kind: 'COLUMN', format: 'recipe_line', column: 'recipe' })
    expect(edge?.dangling).toBe(false)
  })

  it('marks a figure whose link points somewhere else', () => {
    // The failure D-224 named: a fold over a column that does not point back
    // here would put every row of the source into every row of this format.
    const recipe = format('recipe', [], {
      aggregates: [aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'ingredient' })],
    })
    const [edge] = edgesOf([INGREDIENT, recipe, LINE]).filter((each) => each.kind === 'FIGURE')
    expect(edge?.dangling).toBe(true)
  })
})

describe('the ranks', () => {
  it('counts how far a format is from one that names nobody', () => {
    const ranks = ranksOf(VAULT)
    expect(ranks.get('ingredient')).toBe(0)
    expect(ranks.get('recipe')).toBe(0)
    expect(ranks.get('recipe_line')).toBe(1)
  })

  it('terminates on a format that names itself', () => {
    const ranks = ranksOf([format('recipe', [column('parent', 'link', { target: 'recipe' })])])
    expect(ranks.get('recipe')).toBe(0)
  })

  it('terminates on two formats that name each other', () => {
    const ranks = ranksOf([
      format('a', [column('b', 'link', { target: 'b' })]),
      format('b', [column('a', 'link', { target: 'a' })]),
    ])
    expect(ranks.get('a')).toBeGreaterThanOrEqual(0)
    expect(ranks.get('b')).toBeGreaterThanOrEqual(0)
  })
})

describe('what a drag means', () => {
  it('makes a new link from the new-link endpoint to a bubble', () => {
    expect(proposalFor(newLink('recipe_line'), row('ingredient'), VAULT)).toEqual({
      kind: 'LINK',
      from: 'recipe_line',
      to: 'ingredient',
      column: undefined,
      retyping: false,
    })
  })

  it('reads the pair the same way round either way it was dragged', () => {
    const forwards = proposalFor(newLink('recipe_line'), row('ingredient'), VAULT)
    const backwards = proposalFor(row('ingredient'), newLink('recipe_line'), VAULT)
    expect(backwards).toEqual(forwards)
  })

  it('retypes an existing column that is dropped on a bubble, and says so', () => {
    const proposal = proposalFor(col('recipe_line', 'amount_g'), row('ingredient'), VAULT)
    expect(proposal).toEqual({
      kind: 'LINK',
      from: 'recipe_line',
      to: 'ingredient',
      column: 'amount_g',
      retyping: true,
    })
    expect(headlineOf(proposal, VAULT)).toBe(
      'Each recipe line belongs to one ingredient, through amount_g. What amount_g holds now is replaced.',
    )
  })

  it('re-points a link that is dropped on a different bubble', () => {
    const proposal = proposalFor(col('recipe_line', 'recipe'), row('ingredient'), VAULT)
    expect(proposal).toEqual({
      kind: 'LINK',
      from: 'recipe_line',
      to: 'ingredient',
      column: 'recipe',
      retyping: false,
    })
    expect(headlineOf(proposal, VAULT)).toBe('Each recipe line will belong to one ingredient instead of one recipe.')
  })

  it('refuses a link that already exists, naming it', () => {
    const proposal = proposalFor(col('recipe_line', 'recipe'), row('recipe'), VAULT)
    expect(proposal.kind).toBe('NOTHING')
    expect(headlineOf(proposal, VAULT)).toBe('recipe already connects each recipe line to a recipe.')
  })

  it('makes a figure from the new-figure endpoint onto the link that gathers it', () => {
    expect(proposalFor(newFigure('recipe'), col('recipe_line', 'recipe'), VAULT)).toEqual({
      kind: 'FIGURE',
      format: 'recipe',
      over: { format: 'recipe_line', column: 'recipe' },
    })
  })

  it('refuses a figure over a link aimed at something else', () => {
    const proposal = proposalFor(newFigure('recipe'), col('recipe_line', 'ingredient'), VAULT)
    expect(proposal.kind).toBe('NOTHING')
    expect(headlineOf(proposal, VAULT)).toBe('ingredient connects recipe lines to Ingredient, not to Recipe.')
  })

  it('refuses a figure over a column that is not a link', () => {
    const proposal = proposalFor(newFigure('recipe'), col('recipe_line', 'amount_g'), VAULT)
    expect(proposal.kind).toBe('NOTHING')
    expect(headlineOf(proposal, VAULT)).toBe(
      'amount_g isn’t a connection. Drop it on the whole format, or on a column that is.',
    )
  })

  it('takes the only link aimed here when a figure is dropped on the whole bubble', () => {
    expect(proposalFor(newFigure('recipe'), row('recipe_line'), VAULT)).toEqual({
      kind: 'FIGURE',
      format: 'recipe',
      over: { format: 'recipe_line', column: 'recipe' },
    })
  })

  it('asks which column when a format names this one twice', () => {
    const twice = format('recipe_line', [
      column('recipe', 'link', { target: 'recipe' }),
      column('instead_of', 'link', { target: 'recipe' }),
    ])
    const proposal = proposalFor(newFigure('recipe'), row('recipe_line'), [RECIPE, twice])
    expect(proposal.kind).toBe('NOTHING')
    expect(headlineOf(proposal, [RECIPE, twice])).toBe(
      'Recipe_lines belong to a recipe in two ways. Drop it on the one to add up.',
    )
  })

  /**
   * **The ordering problem, answered from the other side.** The editor's
   * aggregate section sent a person away to declare the pointing format first;
   * on a graph both bubbles are already there, so the gesture writes both.
   */
  it('offers the link and the figure together when nothing points here yet', () => {
    expect(proposalFor(newFigure('recipe'), row('ingredient'), [INGREDIENT, RECIPE])).toEqual({
      kind: 'LINK_AND_FIGURE',
      format: 'recipe',
      from: 'ingredient',
    })
    expect(
      headlineOf(proposalFor(newFigure('recipe'), row('ingredient'), [INGREDIENT, RECIPE]), VAULT, {
        total: { kind: 'COUNT', name: 'ingredient_count' },
      }),
    ).toBe('Each ingredient belongs to one recipe, and each recipe counts its ingredients.')
  })

  /**
   * **Either end starts it** (M29 F9). Walking a paycheck: *which
   * way do I drag?* — so *names a row of…* on the many side dropped on *a total
   * of…* on the one side is the same gesture as the other way round.
   */
  it('offers the link and the total together from the many side as well', () => {
    const want = { kind: 'LINK_AND_FIGURE', format: 'recipe', from: 'ingredient' }
    expect(proposalFor(newLink('ingredient'), newFigure('recipe'), [INGREDIENT, RECIPE])).toEqual(want)
    expect(proposalFor(newFigure('recipe'), newLink('ingredient'), [INGREDIENT, RECIPE])).toEqual(want)
  })

  /**
   * **The headline is built from the answers** (M29 F10): it follows the
   * found-by choice and the kind of total, so it always says what will be true.
   */
  it('says what a total along a link will do, from its answers', () => {
    const proposal = proposalFor(newFigure('recipe'), col('recipe_line', 'recipe'), VAULT)
    expect(headlineOf(proposal, VAULT)).toBe('Each recipe adds up its recipe lines.')
    expect(headlineOf(proposal, VAULT, { total: { kind: 'SUM', name: 'kcal' } })).toBe(
      'Each recipe adds up the kcal of its recipe lines.',
    )
    expect(headlineOf(proposal, VAULT, { total: { kind: 'MAXIMUM', name: 'heaviest' } })).toBe(
      'Each recipe shows the largest heaviest of its recipe lines.',
    )
  })

  it('says how a link is found by a date', () => {
    const proposal = proposalFor(newLink('recipe_line'), row('recipe'), VAULT)
    expect(headlineOf(proposal, VAULT)).toBe('Each recipe line belongs to one recipe.')
    expect(headlineOf(proposal, VAULT, { found: 'MONTH' })).toBe('Each recipe line belongs to the recipe of its month.')
    expect(headlineOf(proposal, VAULT, { found: 'DAY' })).toBe('Each recipe line belongs to the recipe of the same day.')
  })

  it('refuses a bubble on a bubble and names what to drag instead', () => {
    const proposal = proposalFor(row('recipe'), row('recipe_line'), VAULT)
    expect(proposal.kind).toBe('NOTHING')
    expect(proposal).toEqual({
      kind: 'NOTHING',
      reason: 'Drag belongs to one… from the format there are many of.',
      detail: 'Two whole formats don’t say which one has many of the other.',
    })
  })

  it('refuses the same endpoint twice', () => {
    expect(proposalFor(row('recipe'), row('recipe'), VAULT)).toEqual({
      kind: 'NOTHING',
      reason: 'Those two are the same. Drag belongs to one… onto another format.',
    })
  })

  it('refuses a column on a column', () => {
    const proposal = proposalFor(col('recipe_line', 'recipe'), col('recipe_line', 'amount_g'), VAULT)
    expect(proposal.kind).toBe('NOTHING')
  })

  it('leaves an existing figure to be opened rather than dragged', () => {
    const proposal = proposalFor(
      { kind: 'FIGURE', format: 'recipe', figure: 'total_kcal' },
      row('recipe_line'),
      VAULT,
    )
    expect(proposal.kind).toBe('NOTHING')
    expect(headlineOf(proposal, VAULT)).toBe('Press total_kcal to change it.')
  })

  it('allows a format to name itself, because one hop is not a traversal', () => {
    expect(proposalFor(newLink('recipe'), row('recipe'), VAULT)).toEqual({
      kind: 'LINK',
      from: 'recipe',
      to: 'recipe',
      column: undefined,
      retyping: false,
    })
  })
})

describe('the names it suggests', () => {
  it('names a new link after the format it points at', () => {
    expect(freeColumnName(LINE, 'ingredient')).toBe('ingredient_2')
    expect(freeColumnName(LINE, 'brand')).toBe('brand')
    expect(freeColumnName(undefined, 'ingredient')).toBe('ingredient')
  })

  /** Never an empty name and a red refusal of it before anything is typed (M29 F10). */
  it('suggests a name for every total, from what it adds up', () => {
    expect(suggestedFigureName('COUNT', 'recipe_line', RECIPE)).toBe('recipe_line_count')
    expect(suggestedFigureName('SUM', 'recipe_line', RECIPE)).toBe('recipe_line_total')
    expect(suggestedFigureName('SUM', 'recipe_line', RECIPE, 'amount_g * ingredient.kcal / 100')).toBe('total_kcal')
    expect(suggestedFigureName('LATEST', 'recipe_line', RECIPE, 'amount_g')).toBe('latest_amount_g')
    expect(suggestedFigureName('MINIMUM', 'recipe_line', RECIPE)).toBe('recipe_line_smallest')
    const taken = format('recipe', [], {
      aggregates: [aggregate('recipe_line_count', 'COUNT', { format: 'recipe_line', column: 'recipe' })],
    })
    expect(suggestedFigureName('COUNT', 'recipe_line', taken)).toBe('recipe_line_count_2')
  })
})

describe('what a fold can name', () => {
  it('lists the source’s own numbers and one hop through its links', () => {
    // Both of the line's links are one hop, so both targets' numbers are here.
    expect(foldNames(LINE, VAULT).map((each) => each.name)).toEqual(['amount_g', 'recipe.servings', 'ingredient.kcal'])
  })

  it('offers the source’s worked-out columns and its times, each saying what it is', () => {
    const day = format(
      'work_day',
      [
        column('start', 'time'),
        column('end', 'time'),
        column('rate', 'money'),
        column('paycheck', 'link', { target: 'paycheck' }),
      ],
      { derived: [{ name: 'earned', expression: '(end - start) * rate', note: '' }] },
    )
    const paycheck = format('paycheck', [column('gross', 'money')])
    expect(foldNames(day, [day, paycheck])).toEqual([
      { name: 'start', says: 'time' },
      { name: 'end', says: 'time' },
      { name: 'rate', says: 'money' },
      { name: 'earned', says: 'computed' },
      { name: 'paycheck.gross', says: 'money of paycheck' },
    ])
  })

  /** A total of money is in its rows' currency, so the panel asks for no unit. */
  it('knows a total of money from a total of a figure in a unit', () => {
    const day = format(
      'work_day',
      [column('start', 'time'), column('end', 'time'), column('rate', 'money'), column('km', 'real', { unit: 'km' })],
      { derived: [{ name: 'earned', expression: '(end - start) * rate', note: '' }] },
    )
    expect(foldType('earned', day, [day])).toEqual({ kind: 'MONEY' })
    expect(foldType('rate * 2', day, [day])).toEqual({ kind: 'MONEY' })
    expect(foldType('km', day, [day])).toEqual({ kind: 'NUMBER', unit: 'km' })
    expect(foldType('', day, [day])).toBeUndefined()
    expect(foldType('nothing_here', day, [day])).toBeUndefined()
  })

  it('does not reach a second hop, because there is no syntax for one', () => {
    // `recipe_line.ingredient.kcal` read from `recipe` would be two hops, and
    // D-224 made that a parse error rather than a rule.
    expect(foldNames(RECIPE, VAULT).map((each) => each.name)).toEqual(['servings'])
  })

  it('names the figures that would be orphaned by taking a link away', () => {
    const recipe = format('recipe', [], {
      aggregates: [
        aggregate('total_kcal', 'SUM', { format: 'recipe_line', column: 'recipe' }, {
          expression: 'amount_g / 100 * ingredient.kcal',
        }),
      ],
    })
    const orphaned = foldsOver([INGREDIENT, recipe, LINE], 'recipe_line', 'recipe')
    expect(orphaned.map((each) => `${each.format}.${each.aggregate.name}`)).toEqual([
      'recipe.total_kcal',
    ])
    expect(foldsOver([INGREDIENT, recipe, LINE], 'recipe_line', 'ingredient')).toEqual([])
  })
})

describe('a connection that already exists', () => {
  it('states the link as a fact rather than as a change', () => {
    const [link] = edgesOf(VAULT)
    expect(link).toBeDefined()
    if (link === undefined) return
    expect(edgeHeadline(link, VAULT)).toBe('Each recipe line belongs to one recipe.')
    expect(edgeWords(link, VAULT)).toEqual({
      says: 'Each recipe line belongs to one recipe',
      under: 'recipe line’s recipe column',
    })
  })

  it('says what a dangling link costs', () => {
    const [link] = edgesOf([format('recipe_line', [column('recipe', 'link', { target: 'recipe' })])])
    expect(link).toBeDefined()
    if (link === undefined) return
    expect(edgeHeadline(link, [])).toBe(
      'Each recipe line belonged to one recipe, but there is no Recipe format now.',
    )
  })

  it('states a figure, and why a dangling one cannot be gathered', () => {
    const recipe = format('recipe', [], {
      aggregates: [aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'recipe' })],
    })
    const good = edgesOf([recipe, LINE]).filter((each) => each.kind === 'FIGURE')[0]
    expect(good).toBeDefined()
    if (good === undefined) return
    expect(edgeHeadline(good, [recipe, LINE])).toBe('Each recipe counts its recipe lines.')
    expect(edgeWords(good, [recipe, LINE])).toEqual({
      says: 'recipe adds up lines from its recipe lines',
      under: 'computed each time, not stored',
    })

    const wrong = format('recipe', [], {
      aggregates: [aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'ingredient' })],
    })
    const bad = edgesOf([INGREDIENT, wrong, LINE]).filter((each) => each.kind === 'FIGURE')[0]
    expect(bad).toBeDefined()
    if (bad === undefined) return
    expect(edgeHeadline(bad, [INGREDIENT, wrong, LINE])).toBe(
      'recipe’s lines adds up recipe lines, but recipe lines no longer belong to recipes.',
    )
  })
})

describe('a connection asked for in words (M24 U2)', () => {
  const fold = { name: 'total_g', kind: 'SUM' as const, expression: 'amount_g', unit: 'g', note: '' }
  const bare = format('recipe_line', [column('amount_g', 'real', { unit: 'g' })])

  it('adds the link, then the figure, in the order they have to be adopted', () => {
    const made = connect([RECIPE, bare], {
      from: 'recipe_line',
      column: 'recipe',
      target: 'recipe',
      required: false,
      note: '',
      figure: fold,
    })
    expect(made.ok).toBe(true)
    if (!made.ok) return
    expect(made.value.map((each) => each.name)).toEqual(['recipe_line', 'recipe'])
    expect(made.value[0]?.columns.at(-1)).toMatchObject({
      name: 'recipe',
      type: 'link',
      target: 'recipe',
    })
    expect(made.value[1]?.aggregates).toEqual([
      { ...fold, over: { format: 'recipe_line', column: 'recipe' } },
    ])
  })

  it('folds over a link that is already there without touching it', () => {
    const made = connect(VAULT, {
      from: 'recipe_line',
      column: 'recipe',
      target: 'recipe',
      required: true,
      note: 'ignored',
      figure: fold,
    })
    expect(made.ok).toBe(true)
    if (!made.ok) return
    expect(made.value.map((each) => each.name)).toEqual(['recipe'])
  })

  it('puts a self-link and its figure on one declaration', () => {
    const task = format('task', [column('name', 'text')])
    const made = connect([task], {
      from: 'task',
      column: 'parent',
      target: 'task',
      required: false,
      note: '',
      figure: { name: 'children', kind: 'COUNT', expression: '', unit: undefined, note: '' },
    })
    expect(made.ok).toBe(true)
    if (!made.ok) return
    expect(made.value).toHaveLength(1)
    expect(made.value[0]?.columns.map((each) => each.name)).toEqual(['name', 'parent'])
    expect(made.value[0]?.aggregates.map((each) => each.name)).toEqual(['children'])
  })

  it('refuses to retype, re-point, or make a link that is already made', () => {
    const base = { from: 'recipe_line', target: 'recipe', required: false, note: '' }
    const retype = connect(VAULT, { ...base, column: 'amount_g', figure: undefined })
    expect(retype.ok ? '' : retype.error).toContain('rather than a link')

    const repoint = connect(VAULT, { ...base, column: 'ingredient', figure: undefined })
    expect(repoint.ok ? '' : repoint.error).toContain('#/connections')

    const again = connect(VAULT, { ...base, column: 'recipe', figure: undefined })
    expect(again.ok ? '' : again.error).toContain('nothing to make')
  })
})
