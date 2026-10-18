import { describe, expect, it } from 'vitest'
import {
  column,
  declarationProblems,
  declarationRejection,
  inOrder,
  moneyColumnNames,
  orderChange,
  quantityColumnNames,
  storedColumnsOf,
  tableNameFor,
  type FormatDeclaration,
} from './declaration.ts'
import { aggregate, parseFilter, type AggregateFilter } from './aggregate.ts'
import { identity } from './identity.ts'

function declaration(overrides: Partial<FormatDeclaration> = {}): FormatDeclaration {
  return {
    language: 1,
    name: 'ingredient',
    title: 'Ingredient',
    notes: '',
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    columns: [column('kcal', 'real', { unit: 'kcal', minimum: 0 })],
    ...overrides,
  }
}

describe('a name', () => {
  it('is snake_case, ASCII, and starts with a letter — the rule D-213 already put on a role', () => {
    // `Cost`, `עלות` and `two words` are refused on purpose: a name goes into a
    // grammar handed to a model, and into SQL.
    for (const name of ['Ingredient', 'עגבניה', 'two words', '1st', '']) {
      expect(declarationRejection(declaration({ name })), name).toBeDefined()
    }
    expect(declarationRejection(declaration({ name: 'product_trial' }))).toBeUndefined()
  })

  it('refuses a column called id, because every declared table already has one', () => {
    const rejection = declarationRejection(declaration({ columns: [column('id', 'text')] }))
    expect(rejection).toContain('id')
  })

  it('refuses a second format of the same name', () => {
    expect(declarationRejection(declaration(), [declaration()])).toContain('already has a format')
    expect(declarationRejection(declaration(), [declaration({ name: 'recipe' })])).toBeUndefined()
  })
})

describe('a column', () => {
  it('must be an enum to name values, and must name some if it is', () => {
    expect(declarationRejection(declaration({ columns: [column('basis', 'enum')] }))).toContain(
      'names no values',
    )
    expect(
      declarationRejection(declaration({ columns: [column('brand', 'text', { values: ['a'] })] })),
    ).toContain('not an enum')
    expect(
      declarationRejection(
        declaration({ columns: [column('basis', 'enum', { values: ['dry', 'dry'] })] }),
      ),
    ).toContain('twice')
  })

  it('can only be bounded if it is a number', () => {
    expect(
      declarationRejection(declaration({ columns: [column('brand', 'text', { minimum: 0 })] })),
    ).toContain('only integer, real, decimal and percent')
    expect(
      declarationRejection(
        declaration({ columns: [column('kcal', 'real', { minimum: 10, maximum: 1 })] }),
      ),
    ).toContain('above its maximum')
  })

  it('refuses a unit on money, because the currency is a stored figure and not a declared one', () => {
    // Two places to write the currency is how the two would eventually
    // disagree. One ingredient bought abroad and one bought here are two rows
    // of one format, not two formats.
    expect(
      declarationRejection(declaration({ columns: [column('price', 'money', { unit: 'ILS' })] })),
    ).toContain('stored per row')
  })
})

describe('money', () => {
  it('occupies two columns, because money is never a number here either', () => {
    // The app's oldest non-negotiable rule has no exception for a table
    // somebody declared. A declared column holding 19.99 as a float would break
    // it by construction, in the one place nobody would look.
    expect(storedColumnsOf(column('price', 'money'))).toEqual(['price_minor', 'price_currency'])
    expect(moneyColumnNames(column('price', 'money'))).toEqual({
      minor: 'price_minor',
      currency: 'price_currency',
    })
  })

  it('collides with a column that would take one of its two names', () => {
    const rejection = declarationRejection(
      declaration({ columns: [column('price', 'money'), column('price_minor', 'integer')] }),
    )
    expect(rejection).toContain('price_minor')
  })
})

describe('the table a format compiles to', () => {
  it('is prefixed, which is what keeps the reconciler away from the app’s own tables', () => {
    expect(tableNameFor({ name: 'ingredient' })).toBe('fmt_ingredient')
  })
})

describe('the declaration language', () => {
  it('refuses a declaration from the future rather than reading it down', () => {
    // The same refusal `SchemaTooNewError` makes about a whole file. What has to
    // be version-compatible is this one integer, not the set of tables (D-214).
    expect(declarationRejection(declaration({ language: 99 }))).toContain('format language 99')
  })
})

describe('an identity', () => {
  const columns = [
    column('kcal', 'real', { unit: 'kcal' }),
    column('protein_g', 'real', { unit: 'g' }),
    column('basis', 'enum', { values: ['dry', 'cooked'] }),
    column('price', 'money'),
  ]

  function withIdentity(each: ReturnType<typeof identity>): FormatDeclaration {
    return declaration({ columns, identities: [each], nothingMustHold: false })
  }

  it('is accepted when it parses and names numbers this format has', () => {
    expect(
      declarationRejection(withIdentity(identity('atwater', '4*protein_g = kcal'))),
    ).toBeUndefined()
    // Money is a number too — it is minor units, and `units * price = value` is
    // the identity the engine's own line names first.
    expect(
      declarationRejection(withIdentity(identity('paid', 'price = 100 * kcal'))),
    ).toBeUndefined()
  })

  it('refuses one that names a column this format has not got', () => {
    const rejection = declarationRejection(withIdentity(identity('atwater', 'fibre_g = kcal')))
    expect(rejection).toContain('fibre_g')
    expect(rejection).toContain('no such column')
  })

  it('refuses arithmetic on something that is not a number', () => {
    // A category error rather than a limitation: there is no sum of an enum.
    const rejection = declarationRejection(withIdentity(identity('odd', 'basis = kcal')))
    expect(rejection).toContain('basis')
    expect(rejection).toContain('enum')
  })

  it('refuses an equation that does not parse, at the moment it is declared', () => {
    // Rather than at the moment somebody relies on it, which is the whole
    // difference between a check and a proof that quietly never ran.
    expect(declarationRejection(withIdentity(identity('bad', '4*protein_g')))).toContain('`=`')
  })

  it('refuses one that names nothing, because it says the same thing about every row', () => {
    expect(declarationRejection(withIdentity(identity('silly', '2 + 2 = 4')))).toContain(
      'names no column',
    )
  })

  it('refuses two identities of one name, and says which', () => {
    const rejection = declarationRejection(
      declaration({
        columns,
        nothingMustHold: false,
        identities: [identity('atwater', 'kcal = kcal'), identity('atwater', 'protein_g = kcal')],
        aggregates: [],
      }),
    )
    expect(rejection).toContain('Two claims are called atwater')
  })

  it('draws its problem on the identity rather than on the format', () => {
    const problems = declarationProblems(
      declaration({
        columns,
        nothingMustHold: false,
        identities: [identity('atwater', '4*protein_g = kcal'), identity('two', 'nope = kcal')],
        aggregates: [],
      }),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.identityIndex).toBe(1)
    expect(problems[0]?.columnIndex).toBeUndefined()
  })
})

describe('H3, answered prompted', () => {
  it('allows a format that declares no identity without saying so — the default (M38 U5)', () => {
    expect(declarationRejection(declaration({ nothingMustHold: false }))).toBeUndefined()
  })

  it('allows one that says so on purpose', () => {
    expect(declarationRejection(declaration({ nothingMustHold: true }))).toBeUndefined()
  })

  it('refuses a format that says both things at once', () => {
    const rejection = declarationRejection(
      declaration({
        columns: [column('kcal', 'real')],
        identities: [identity('atwater', 'kcal = kcal')],
        aggregates: [],
        nothingMustHold: true,
      }),
    )
    expect(rejection).toContain('One or the other')
  })
})

/* ------------------------------------------------- converting, U4a, D-223 */

describe('a column called `in` or `via`', () => {
  it('is refused, because both are words an identity converts with', () => {
    // Two reserved words are what the whole conversion syntax costs. The
    // alternative is `serving_weight in g` meaning two things, and `via
    // density` meaning two more.
    expect(declarationRejection(declaration({ columns: [column('in', 'real')] }))).toContain(
      'convert',
    )
    expect(declarationRejection(declaration({ columns: [column('via', 'real')] }))).toContain(
      'convert',
    )
    expect(declarationRejection(declaration({ columns: [column('inches', 'real')] }))).toBeUndefined()
    expect(declarationRejection(declaration({ columns: [column('viable', 'real')] }))).toBeUndefined()
  })
})

/** **A quantity and a ratio** (U4c, D-225). */
describe('a quantity', () => {
  it('occupies two columns, the figure keeping the declared name', () => {
    // The opposite arrangement to money, which renames its figure because
    // minor units are not what the declaration asked for. A quantity's amount
    // is the amount.
    expect(storedColumnsOf(column('amount', 'quantity'))).toEqual(['amount', 'amount_unit'])
    expect(quantityColumnNames(column('amount', 'quantity'))).toEqual({
      amount: 'amount',
      unit: 'amount_unit',
    })
  })

  it('takes no unit of its own, because that is the difference between it and a real', () => {
    const rejection = declarationRejection(
      declaration({ columns: [column('amount', 'quantity', { unit: 'g' })] }),
    )
    expect(rejection).toContain('per row')
  })

  it('takes no bound, because a maximum of 500 means nothing across two units', () => {
    expect(
      declarationRejection(declaration({ columns: [column('amount', 'quantity', { maximum: 500 })] })),
    ).toContain('bound')
  })
})

describe('a ratio column', () => {
  it('is a number with both halves of the fact on it', () => {
    expect(
      declarationRejection(
        declaration({ columns: [column('density', 'real', { unit: 'g', per: 'ml' })] }),
      ),
    ).toBeUndefined()
  })

  it('is refused with only the half that says what it is per', () => {
    expect(
      declarationRejection(declaration({ columns: [column('density', 'real', { per: 'ml' })] })),
    ).toContain('half a fact')
  })

  it('is refused on a type that cannot hold a ratio', () => {
    expect(
      declarationRejection(
        declaration({ columns: [column('density', 'text', { unit: 'g', per: 'ml' })] }),
      ),
    ).toContain('is a number')
  })

  it('is refused when both halves are the same unit, which is the number one', () => {
    expect(
      declarationRejection(
        declaration({ columns: [column('density', 'real', { unit: 'g', per: 'g' })] }),
      ),
    ).toContain('the number one')
  })
})

describe('an identity that converts', () => {
  const columns = [
    column('pack', 'real', { unit: 'kg' }),
    column('serving', 'real', { unit: 'g' }),
    column('volume', 'real', { unit: 'ml' }),
    column('servings', 'integer'),
  ]

  function withIdentity(each: ReturnType<typeof identity>): FormatDeclaration {
    return declaration({ columns, identities: [each], nothingMustHold: false })
  }

  it('is accepted inside a dimension', () => {
    expect(
      declarationRejection(withIdentity(identity('portions', 'pack in g = serving * servings'))),
    ).toBeUndefined()
  })

  /**
   * **The refusal that keeps a conversion from becoming a silent `unchecked`.**
   * An identity is judged later, somewhere else, against rows nobody is looking
   * at, so the only useful moment to say that `volume in g` can never work is
   * the moment somebody writes it.
   */
  it('is refused across a dimension, beside the identity that asked for it', () => {
    const problems = declarationProblems(
      withIdentity(identity('weighs', 'volume in g = serving')),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.identityIndex).toBe(0)
    expect(problems[0]?.message).toContain('density')
  })

  it('is refused when the unit is one this document has never heard of', () => {
    expect(
      declarationRejection(withIdentity(identity('portions', 'pack in slice = servings'))),
    ).toContain('not a unit this document knows')
  })

  it('is judged against the units it is handed, not the ones this build ships', () => {
    const kitchen = [
      { symbol: 'slice', dimension: 'COUNT' as const, perBase: 1, origin: 'USER' as const, note: '' },
      { symbol: 'kg', dimension: 'MASS' as const, perBase: 1000, origin: 'SEEDED' as const, note: '' },
    ]
    expect(
      declarationRejection(
        withIdentity(identity('portions', 'servings in slice = servings')),
        [],
        kitchen,
      ),
    ).toContain('nothing to convert')
  })
})

/* ------------------------------------------- links and aggregates, U4b, D-224 */

describe('a link', () => {
  const recipe = declaration({ name: 'recipe', columns: [column('servings', 'integer')] })

  function withLink(target: string): FormatDeclaration {
    return declaration({
      name: 'recipe_line',
      columns: [column('recipe', 'link', { target }), column('amount_g', 'real', { unit: 'g' })],
    })
  }

  it('is accepted when it points at a format this document declares', () => {
    expect(declarationRejection(withLink('recipe'), [recipe])).toBeUndefined()
  })

  it('may point at the format it is on, which is the cooked-against-dry case', () => {
    const cooked = declaration({
      columns: [column('analogue', 'link', { target: 'ingredient' }), column('kcal', 'real')],
    })
    expect(declarationRejection(cooked)).toBeUndefined()
  })

  it('is refused when it points at nothing this document has', () => {
    const rejection = declarationRejection(withLink('pantry'), [recipe])
    expect(rejection).toContain('pantry')
    expect(rejection).toContain('recipe')
  })

  it('needs a target at all', () => {
    expect(declarationRejection(withLink(''))).toContain('declares no format called that')
  })

  it('takes no unit, because an id is not in anything', () => {
    const wrong = declaration({
      columns: [column('recipe', 'link', { target: 'ingredient', unit: 'g' })],
    })
    expect(declarationRejection(wrong)).toBeDefined()
  })
})

describe('one hop in an expression', () => {
  const ingredient = declaration({
    columns: [column('kcal', 'real', { unit: 'kcal' }), column('name', 'text')],
  })

  function withHop(expression: string): FormatDeclaration {
    return declaration({
      name: 'recipe_line',
      nothingMustHold: false,
      columns: [
        column('ingredient', 'link', { target: 'ingredient' }),
        column('amount_g', 'real', { unit: 'g' }),
      ],
      identities: [identity('scaled', expression)],
    })
  }

  it('reaches a numeric column of the row a link names', () => {
    expect(
      declarationRejection(withHop('amount_g / 100 * ingredient.kcal = 10'), [ingredient]),
    ).toBeUndefined()
  })

  it('refuses a hop through a column that is not a link', () => {
    expect(declarationRejection(withHop('amount_g.kcal = 10'), [ingredient])).toContain(
      'rather than a link',
    )
  })

  it('refuses a hop that reaches a column the other format has not got', () => {
    const rejection = declarationRejection(withHop('ingredient.protein_g = 10'), [ingredient])
    expect(rejection).toContain('ingredient')
    expect(rejection).toContain('protein_g')
  })

  it('refuses arithmetic on a hop that lands on text', () => {
    expect(declarationRejection(withHop('ingredient.name = 10'), [ingredient])).toContain(
      'which is a text',
    )
  })

  /** One hop and no more: the syntax has no way to write a traversal. */
  it('refuses a second hop', () => {
    expect(declarationRejection(withHop('ingredient.supplier.kcal = 10'), [ingredient])).toContain(
      'two links',
    )
  })

  it('carries the reached column’s unit, so a conversion is judged', () => {
    const converting = declaration({
      name: 'recipe_line',
      nothingMustHold: false,
      columns: [column('ingredient', 'link', { target: 'ingredient' }), column('x', 'real')],
      identities: [identity('odd', 'ingredient.kcal in g = x')],
    })
    expect(declarationRejection(converting, [ingredient])).toContain('energy')
  })
})

describe('an aggregate', () => {
  const line = declaration({
    name: 'recipe_line',
    columns: [
      column('recipe', 'link', { target: 'recipe' }),
      column('ingredient', 'link', { target: 'ingredient' }),
      column('amount_g', 'real', { unit: 'g' }),
      column('note', 'text'),
    ],
  })
  const ingredient = declaration({ columns: [column('kcal', 'real', { unit: 'kcal' })] })

  function withAggregate(each: ReturnType<typeof aggregate>): FormatDeclaration {
    return declaration({
      name: 'recipe',
      columns: [column('servings', 'integer')],
      aggregates: [each],
    })
  }

  const total = aggregate(
    'total_kcal',
    'SUM',
    { format: 'recipe_line', column: 'recipe' },
    { expression: 'amount_g / 100 * ingredient.kcal', unit: 'kcal' },
  )

  it('is accepted when the source points back at this format', () => {
    expect(declarationRejection(withAggregate(total), [line, ingredient])).toBeUndefined()
  })

  /**
   * **The refusal worth having.** An aggregate gathering by a column that points
   * somewhere else would fold every row of the source into every row of this
   * format, silently, and the figure would look entirely plausible.
   */
  it('is refused when the column it gathers by points somewhere else', () => {
    const wrong = { ...total, over: { format: 'recipe_line', column: 'ingredient' } }
    const rejection = declarationRejection(withAggregate(wrong), [line, ingredient])
    expect(rejection).toContain('points at ingredient rather than at recipe')
    expect(rejection).toContain('every row')
  })

  it('is refused when it gathers by something that is not a link', () => {
    const wrong = { ...total, over: { format: 'recipe_line', column: 'amount_g' } }
    expect(declarationRejection(withAggregate(wrong), [line, ingredient])).toContain(
      'rather than a link',
    )
  })

  it('is refused when the format it runs over is not declared', () => {
    const wrong = { ...total, over: { format: 'pantry_line', column: 'recipe' } }
    expect(declarationRejection(withAggregate(wrong), [line, ingredient])).toContain('pantry_line')
  })

  /** The expression is in the *source's* vocabulary, not this format's. */
  it('is refused when its expression names a column of the wrong format', () => {
    const wrong = { ...total, expression: 'servings * 2' }
    expect(declarationRejection(withAggregate(wrong), [line, ingredient])).toContain('servings')
  })

  it('counts with no expression, and refuses one that has both', () => {
    const counting = aggregate('lines', 'COUNT', { format: 'recipe_line', column: 'recipe' })
    expect(declarationRejection(withAggregate(counting), [line, ingredient])).toBeUndefined()
    expect(
      declarationRejection(withAggregate({ ...counting, expression: 'amount_g' }), [
        line,
        ingredient,
      ]),
    ).toContain('nothing to work out')
  })

  it('is refused when its unit is one this document does not know', () => {
    expect(
      declarationRejection(withAggregate({ ...total, unit: 'slice' }), [line, ingredient]),
    ).toContain('not a unit this document knows')
  })

  it('may not be called the same thing as a column', () => {
    const clashing = { ...total, name: 'servings' }
    expect(declarationRejection(withAggregate(clashing), [line, ingredient])).toContain(
      'same thing as a column',
    )
  })

  it('is drawn beside the aggregate that caused it', () => {
    const wrong = { ...total, over: { format: 'pantry_line', column: 'recipe' } }
    const problems = declarationProblems(withAggregate(wrong), [line, ingredient])
    expect(problems).toHaveLength(1)
    expect(problems[0]?.aggregateIndex).toBe(0)
  })

  /**
   * **The sentence the whole unit exists for**, checked at declaration time: a
   * figure worked out across a link is a figure an identity may be written
   * about.
   */
  it('is a name an identity of this format may use', () => {
    const proving = declaration({
      name: 'recipe',
      nothingMustHold: false,
      columns: [column('servings', 'integer'), column('printed', 'real', { unit: 'kcal' })],
      aggregates: [total],
      identities: [identity('per_serving', 'total_kcal / servings = printed')],
    })
    expect(declarationRejection(proving, [line, ingredient])).toBeUndefined()
  })

  it('stands without an identity, since nothing adding up is the default (M38 U5)', () => {
    const silent = declaration({
      name: 'recipe',
      columns: [column('servings', 'integer')],
      aggregates: [total],
      nothingMustHold: false,
    })
    expect(declarationRejection(silent, [line, ingredient])).toBeUndefined()
  })
})

describe('an aggregate that says where (M24 U8, D-260)', () => {
  const category: FormatDeclaration = {
    language: 8,
    name: 'category',
    title: 'Category',
    notes: '',
    nothingMustHold: true,
    identities: [],
    aggregates: [],
    columns: [column('name', 'text'), column('group', 'enum', { values: ['NEED', 'WANT'] })],
  }
  const transaction: FormatDeclaration = {
    language: 8,
    name: 'transaction',
    title: 'Transaction',
    notes: '',
    nothingMustHold: true,
    identities: [],
    aggregates: [],
    columns: [
      column('account', 'link', { target: 'account', required: true }),
      column('category', 'link', { target: 'category' }),
      column('direction', 'enum', { values: ['OUTFLOW', 'INFLOW'] }),
      column('is_transfer', 'boolean'),
      column('memo', 'text'),
      column('amount', 'money'),
    ],
  }
  const account = (where: AggregateFilter, language = 8): FormatDeclaration => ({
    language,
    name: 'account',
    title: 'Account',
    notes: '',
    nothingMustHold: true,
    identities: [],
    columns: [column('name', 'text')],
    aggregates: [
      aggregate('spent', 'SUM', { format: 'transaction', column: 'account' }, {
        expression: 'amount',
        where,
      }),
    ],
  })
  const problem = (where: AggregateFilter, language = 8): string | undefined =>
    declarationProblems(account(where, language), [transaction, category])[0]?.message

  it('takes an enum member or a boolean of the source row', () => {
    expect(problem({ column: 'direction', is: 'OUTFLOW' })).toBeUndefined()
    expect(problem({ column: 'is_transfer', is: 'false' })).toBeUndefined()
  })

  it('refuses a member the enum has not got, which would match nothing and sum to zero', () => {
    expect(problem({ column: 'direction', is: 'OUTFLOWS' })).toContain(
      'direction is one of OUTFLOW, INFLOW',
    )
    expect(problem({ column: 'is_transfer', is: 'yes' })).toContain('true or false')
  })

  it('refuses a column that is not an enum or a boolean, or not there', () => {
    expect(problem({ column: 'memo', is: 'rent' })).toContain('memo is a text')
    expect(problem({ column: 'payee', is: 'FOOD' })).toContain('transaction has no such column')
  })

  it('reads one hop through the source’s link and no further', () => {
    expect(problem({ column: 'category.group', is: 'NEED' })).toBeUndefined()
    expect(problem({ column: 'category.group', is: 'LUXURY' })).toContain('one of NEED, WANT')
    expect(problem({ column: 'category.parent.group', is: 'NEED' })).toContain('two hops')
  })

  it('needs language 8, because a build before it would fold every row', () => {
    expect(problem({ column: 'direction', is: 'OUTFLOW' }, 7)).toContain('format language 8')
  })

  it('says not, one of and empty from language 19, each member checked (M36 U04)', () => {
    const said = (text: string, language = 19): string | undefined => {
      const parsed = parseFilter(text)
      if ('problem' in parsed) return parsed.problem
      return problem(parsed, language)
    }
    expect(said('category.group is not WANT')).toBeUndefined()
    expect(said('direction is one of OUTFLOW, INFLOW')).toBeUndefined()
    expect(said('amount is not empty')).toBeUndefined()
    expect(said('memo is empty')).toBeUndefined()
    expect(said('direction is not one of OUTFLOW, SIDEWAYS')).toContain('direction is one of OUTFLOW, INFLOW')
    expect(said('memo is not rent')).toContain('memo is a text')
    expect(said('category.group is not WANT', 18)).toContain('format language 19')
    expect(said('memo is empty', 18)).toContain('format language 19')
  })
})

describe('an aggregate that picks the latest by an order (M25 E3, D-272)', () => {
  const security_price: FormatDeclaration = {
    language: 11,
    name: 'security_price',
    title: 'Security price',
    notes: '',
    nothingMustHold: true,
    identities: [],
    aggregates: [],
    columns: [
      column('security', 'link', { target: 'security', required: true }),
      column('as_of', 'date'),
      column('taken_at', 'instant'),
      column('sequence', 'integer'),
      column('weight', 'real'),
      column('price', 'decimal', { scale: 6 }),
      column('source', 'enum', { values: ['TYPED', 'FETCHED'] }),
    ],
  }
  const security = (
    kind: 'LATEST' | 'EARLIEST' | 'SUM',
    by: string | undefined,
    language = 11,
  ): FormatDeclaration => ({
    language,
    name: 'security',
    title: 'Security',
    notes: '',
    nothingMustHold: true,
    identities: [],
    columns: [column('name', 'text')],
    aggregates: [
      aggregate('price', kind, { format: 'security_price', column: 'security' }, {
        expression: 'price',
        by,
      }),
    ],
  })
  const problem = (
    kind: 'LATEST' | 'EARLIEST' | 'SUM',
    by: string | undefined,
    language = 11,
  ): string | undefined =>
    declarationProblems(security(kind, by, language), [security_price])[0]?.message

  it('picks by a date, a month, an instant or an integer of the source row', () => {
    expect(problem('LATEST', 'as_of')).toBeUndefined()
    expect(problem('EARLIEST', 'taken_at')).toBeUndefined()
    expect(problem('LATEST', 'sequence')).toBeUndefined()
  })

  it('refuses a pick with no order, or by a column that does not sort the way it means', () => {
    expect(problem('LATEST', undefined)).toContain('says by what')
    expect(problem('LATEST', 'weight')).toContain('which is a real')
    expect(problem('LATEST', 'source')).toContain('which is a enum')
    expect(problem('LATEST', 'day')).toContain('security_price has no such column')
  })

  it('refuses an order through a link — a second table is not what it picks by', () => {
    expect(problem('LATEST', 'security.name')).toContain('reaches through a link')
  })

  it('refuses an order on a fold, which folds every row whatever it says', () => {
    expect(problem('SUM', 'as_of')).toContain('Only latest and earliest pick by an order')
  })

  it('needs language 11', () => {
    expect(problem('LATEST', 'as_of', 10)).toContain('format language 11')
  })
})

describe('a column moved (M29 U2, D-332)', () => {
  const book = {
    name: 'book',
    columns: [column('title', 'text'), column('pages', 'integer'), column('author', 'text')],
  }
  const names = (each: { columns: readonly { name: string }[] }): string[] =>
    each.columns.map((one) => one.name)

  it('says a move, and says nothing when only a number moved past the naming column', () => {
    const pagesFirst = { columns: [book.columns[1], book.columns[0], book.columns[2]].flatMap((each) => (each === undefined ? [] : [each])) }
    expect(orderChange(book, pagesFirst)).toEqual({ moved: true, naming: undefined })
    expect(orderChange(book, book)).toEqual({ moved: false, naming: undefined })
  })

  it('says when the entries are called by another column, because the first text column moved', () => {
    const authorFirst = inOrder(book, ['author', 'title', 'pages'])
    if (!authorFirst.ok) throw new Error(authorFirst.error)
    expect(orderChange(book, authorFirst.value)).toEqual({
      moved: true,
      naming: { was: 'title', now: 'author' },
    })
  })

  it('reads a renamed column as the same column, not as a new name for the entries', () => {
    const renamed = { columns: [column('name', 'text'), ...book.columns.slice(1)] }
    expect(orderChange(book, renamed, new Map([['name', 'title']]))).toEqual({
      moved: false,
      naming: undefined,
    })
  })

  it('takes an order naming every column once, and refuses one that does not', () => {
    const ordered = inOrder(book, ['pages', 'author', 'title'])
    expect(ordered.ok && names(ordered.value)).toEqual(['pages', 'author', 'title'])

    const short = inOrder(book, ['pages', 'title'])
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.error).toContain('author was left out')

    const wrong = inOrder(book, ['pages', 'pages', 'title', 'isbn'])
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) {
      expect(wrong.error).toContain('It has no isbn')
      expect(wrong.error).toContain('pages came more than once')
    }
  })
})
