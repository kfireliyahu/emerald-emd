import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { column, moneyColumnNames, storedColumnsOf, tableNameFor } from '@/domain/format/declaration.ts'
import { createDatabase } from '../../db/database.ts'
import { adoptFormat, listFormats } from '../../repositories/formatRepository.ts'
import { aggregatesOf } from '../../repositories/formatJoinRepository.ts'
import { insertRows, listRows } from '../../repositories/formatRowRepository.ts'
import { rulesSetting, withRules } from '../../repositories/formatRuleRepository.ts'
import { listRules } from '../../repositories/categoryRuleRepository.ts'
import { createCategory, listCategories } from '../../repositories/categoryRepository.ts'
import { firstMatch } from '@/domain/categorization.ts'
import { money } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { documentHasLedger, installLedgerPack, ledgerFormats, ledgerViews } from './pack.ts'
import { restoreViewSettings, viewSettings } from '../../repositories/formatViewRepository.ts'
import { startHere } from '../../repositories/formatLinkViewRepository.ts'

const NOW = 1_700_000_000_000

/** A fresh document, which since U8 keeps no old table for the pack to wait on. */
async function convertedDocument(): Promise<Database> {
  return createDatabase()
}

function formats(): readonly FormatDeclaration[] {
  const read = ledgerFormats()
  if (!read.ok) throw new Error(read.error)
  return read.value.map((each) => each.declaration)
}

describe('the ledger pack', () => {
  it('parses every format, each after the formats it links to', () => {
    const names = formats().map((each) => each.name)
    expect(names).toHaveLength(34)
    for (const [at, declaration] of formats().entries()) {
      for (const column of declaration.columns) {
        if (column.type !== 'link' || column.target === declaration.name) continue
        expect(names.indexOf(column.target ?? ''), `${declaration.name}.${column.name}`).toBeLessThan(at)
      }
    }
  })

  it('keeps its settings, templates and added roles in formats of its own (U8)', () => {
    const names = new Set(formats().map((each) => each.name))
    for (const format of ['setting', 'document_template', 'column_role']) {
      expect(names.has(format), format).toBe(true)
    }
    // The shipped roles are the code's: only a person's addition is a row.
    expect(formats().find((each) => each.name === 'column_role')?.columns.map((each) => each.name)).toEqual([
      'role',
      'vocabulary',
      'position',
    ])
  })

  it('is the finish line: a document holds no table that is neither fmt_ nor the engine’s (U8)', async () => {
    const ENGINE = new Set([
      'format',
      'format_aggregate',
      'format_column',
      'format_column_value',
      'format_column_view',
      'format_graph_place',
      'format_view_column',
      'format_constraint',
      'format_identity',
      'format_intake',
      'format_intake_column',
      'format_intake_header_cell',
      'format_intake_row',
      'format_reader',
      'format_rollup',
      'format_rule_set',
      'format_derived',
      'format_seed',
      'measurement_unit',
      // The document's own settings — its currency (M29 F3, D-344).
      'document_setting',
      'schema_version',
    ])
    const db = await createDatabase()
    const bare = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    const before = (bare[0]?.values ?? []).map(([name]) => String(name))
    expect(before.filter((name) => !ENGINE.has(name))).toEqual([])

    const installed = installLedgerPack(db, NOW)
    if (!installed.ok) throw new Error(installed.error)
    const kept = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    const after = (kept[0]?.values ?? []).map(([name]) => String(name))
    expect(after.filter((name) => !ENGINE.has(name) && !name.startsWith('fmt_'))).toEqual([])
  })

  it('gives a converted document every table and every seed', async () => {
    const db = await convertedDocument()
    const installed = installLedgerPack(db, NOW)
    if (!installed.ok) throw new Error(installed.error)

    expect(installed.value.declared).toHaveLength(34)
        for (const declaration of formats()) {
      const table = tableNameFor(declaration)
      expect(db.exec(`SELECT 1 FROM sqlite_master WHERE name = '${table}'`)).toHaveLength(1)
    }

    const index = new Map(listFormats(db).map((each) => [each.name, each]))
    const count = (name: string): number => listRows(db, index.get(name) as FormatDeclaration).length
    expect(index.has('category_group')).toBe(false)
    expect(count('category')).toBe(54)
    expect(count('institution')).toBe(28)
    expect(count('institution_alias')).toBe(88)
    expect(count('deduction_type')).toBe(10)
    expect(count('category_rule')).toBeGreaterThan(100)

    // The tree is linked by name, so a subcategory lands under its parent.
    const categories = listRows(db, index.get('category') as FormatDeclaration)
    const utilities = categories.find((row) => row.cells['name'] === 'Utilities')
    const water = categories.find((row) => row.cells['name'] === 'Water')
    expect(water?.cells['parent']).toBe(utilities?.id)
    // And the groups are the top of it (M28 F29): Utilities is under Living.
    const living = categories.find((row) => row.cells['name'] === 'Living')
    expect(utilities?.cells['parent']).toBe(living?.id)
    expect(living?.id).toBe('cat:living')
  })

  it('is idempotent: a second install declares nothing and changes nothing', async () => {
    const db = await convertedDocument()
    installLedgerPack(db, NOW)
    const again = installLedgerPack(db, NOW + 1)
    if (!again.ok) throw new Error(again.error)
    expect(again.value.declared).toEqual([])
    for (const seeding of again.value.seeded.values()) {
      expect(seeding.added).toEqual([])
      expect(seeding.corrected).toEqual([])
    }
  })

  it('gives a format declared before the pack grew a constraint that constraint, and nothing else', async () => {
    const db = await convertedDocument()
    installLedgerPack(db, NOW)
    const held = listFormats(db).find((each) => each.name === 'allocation')
    if (held === undefined) throw new Error('no allocation')
    const { owner: _unlocked, ...unowned } = held
    const older = {
      ...unowned,
      language: 8,
      columns: [...held.columns, column('mine', 'text')],
      constraints: (held.constraints ?? []).filter((each) => each.kind !== 'ONE_PER'),
    }
    expect(adoptFormat(db, older, NOW).refusals).toEqual([])

    const again = installLedgerPack(db, NOW + 1)
    if (!again.ok) throw new Error(again.error)
    const grown = listFormats(db).find((each) => each.name === 'allocation')
    // 13 and not 9: the lock came with it (M25 E5, D-269), and says the
    // column somebody added is theirs rather than the pack's.
    expect(grown?.language).toBe(13)
    expect(grown?.constraints?.filter((each) => each.kind === 'ONE_PER')).toHaveLength(2)
    expect(grown?.columns.some((each) => each.name === 'mine')).toBe(true)
    expect(grown?.owner?.pack).toBe('ledger')
    expect(grown?.owner?.columns).not.toContain('mine')
  })

  it('opens a document from before a bank account’s cash was in no place (M36 U08)', async () => {
    const db = await convertedDocument()
    installLedgerPack(db, NOW)
    const held = (name: string) => {
      const found = listFormats(db).find((each) => each.name === name)
      if (found === undefined) throw new Error(`no ${name}`)
      return found
    }
    // M30's shape: a place names its account, and a holding is always in a place.
    const place = held('holding_place')
    expect(
      adoptFormat(db, { ...place, columns: [...place.columns, column('account', 'link', { target: 'account', unique: true })] }, NOW).refusals,
    ).toEqual([])
    const holding = held('holding')
    expect(
      adoptFormat(
        db,
        { ...holding, columns: holding.columns.map((each) => (each.name === 'holding_place' ? { ...each, required: true } : each)) },
        NOW,
      ).refusals,
    ).toEqual([])
    const [accountId = ''] = insertRows(db, held('account'), [{ name: 'Everyday Bank', kind: 'BANK', is_archived: 0 }])
    const [placeId = ''] = insertRows(db, held('holding_place'), [
      { name: 'Everyday Bank', kind: 'CHECKING', is_archived: 0, account: accountId },
    ])
    insertRows(db, held('holding'), [
      { name: 'Cash', kind: 'CASH', provenance: 'RECORDED', is_liquid: 1, is_archived: 0, holding_place: placeId, account: accountId },
    ])

    const again = installLedgerPack(db, NOW + 1)
    if (!again.ok) throw new Error(again.error)

    // The link is gone, and nothing it said is: the place's cash still names the account.
    expect(held('holding_place').columns.some((each) => each.name === 'account')).toBe(false)
    expect(listRows(db, held('holding')).map((row) => [row.cells['holding_place'], row.cells['account']])).toEqual([
      [placeId, accountId],
    ])
    // And a holding may be in no place now, with every one that was kept.
    expect(held('holding').columns.find((each) => each.name === 'holding_place')?.required).toBe(false)
    expect(() =>
      insertRows(db, held('holding'), [{ name: 'Loose', kind: 'CASH', provenance: 'RECORDED', is_liquid: 1, is_archived: 0 }]),
    ).not.toThrow()
    expect(installLedgerPack(db, NOW + 2).ok).toBe(true)
  })

  it('rebuilds what the pack vouches for in a document declared before: a kind re-listed, columns retired (M36 U09)', async () => {
    const db = await convertedDocument()
    installLedgerPack(db, NOW)
    const held = (name: string) => {
      const found = listFormats(db).find((each) => each.name === name)
      if (found === undefined) throw new Error(`no ${name}`)
      return found
    }
    // M30's shape: an account with holdings is CASH beside a flag, and a plan keeps a required setting.
    const account = held('account')
    expect(
      adoptFormat(
        db,
        {
          ...account,
          columns: [
            ...account.columns.map((each) => (each.name === 'kind' ? { ...each, values: ['CREDIT_CARD', 'BANK', 'CASH'] } : each)),
            column('holds_things', 'boolean'),
          ],
        },
        NOW,
      ).refusals,
    ).toEqual([])
    const plan = held('split_plan')
    expect(adoptFormat(db, { ...plan, columns: [...plan.columns, column('fixed_in_split', 'boolean', { required: true })] }, NOW).refusals).toEqual([])
    db.run(`INSERT INTO fmt_account (id, name, kind, is_archived, holds_things) VALUES ('a1', 'Broker', 'CASH', 0, 1), ('a2', 'Bank', 'BANK', 0, NULL)`)
    db.run(`INSERT INTO fmt_split_plan (id, name, basis_kind, currency, is_default, fixed_in_split) VALUES ('p1', 'Everyday', 'LAST_PAYCHECK', 'ILS', 1, 0)`)

    const again = installLedgerPack(db, NOW + 1)
    if (!again.ok) throw new Error(again.error)

    expect(held('account').columns.find((each) => each.name === 'kind')?.values).toContain('HOLDINGS')
    expect(held('account').columns.some((each) => each.name === 'holds_things')).toBe(false)
    expect(held('split_plan').columns.some((each) => each.name === 'fixed_in_split')).toBe(false)
    // Every row kept, and nothing converted: the flag goes with what it said.
    expect(db.exec('SELECT id, kind FROM fmt_account ORDER BY id')[0]?.values).toEqual([
      ['a1', 'CASH'],
      ['a2', 'BANK'],
    ])
    expect(db.exec('SELECT id FROM fmt_split_plan')[0]?.values).toEqual([['p1']])
    db.run(`INSERT INTO fmt_account (id, name, kind, is_archived) VALUES ('a3', 'Savings', 'HOLDINGS', 0)`)
    expect(installLedgerPack(db, NOW + 2).ok).toBe(true)
  })

  /**
   * **The ledger's declared picks** (M25 E3, D-272): a holding's `reading` folds
   * its readings, which link the holding — a circle the link order cannot break,
   * so the install declares every format and then the figures. **A fund is a
   * holding** (M36 U12, D-389), so a pension's balance is the same pick.
   */
  it('declares a holding’s reading, and a fund reads its latest report', async () => {
    const db = await convertedDocument()
    const installed = installLedgerPack(db, NOW)
    if (!installed.ok) throw new Error(installed.error)
    const index = new Map(listFormats(db).map((each) => [each.name, each]))
    expect(index.has('fund_account')).toBe(false)
    const holding = index.get('holding') as FormatDeclaration
    expect(holding.aggregates.find((each) => each.name === 'reading')).toMatchObject({ kind: 'LATEST', by: 'as_of' })

    const readings = index.get('holding_reading') as FormatDeclaration
    const [pension] = insertRows(db, holding, [
      { name: 'Pension', kind: 'FUND', provenance: 'TRANSCRIBED', is_liquid: 0, fund_type: 'PENSION', is_archived: 0 },
    ])
    const reading = (asOf: string, minor: number): Record<string, string | number> => ({
      holding: pension ?? '',
      as_of: asOf,
      value_minor: minor,
      value_currency: 'ILS',
    })
    insertRows(db, readings, [reading('2026-06-30', 11_000_000), reading('2026-09-30', 12_500_000)])
    const row = listRows(db, holding)[0]
    if (row === undefined) throw new Error('no fund')
    expect(aggregatesOf(db, holding, row, index).find((each) => each.aggregate.name === 'reading')?.value).toMatchObject({
      kind: 'VALUE',
      value: 12_500_000,
      at: '2026-09-30',
    })
  })

  /**
   * **The ledger's first rule set** (M25 E4, D-273). `categories` sets a
   * transaction's category from the rule its merchant matches — and wherever it
   * says anything, it says what the ledger's own `firstMatch` says. Where they
   * part is a tie the ledger breaks by the kind's specificity and the engine
   * refuses to break (U3 decides which is the answer).
   */
  it('declares categories, and where it sets a category it is the one the ledger picks', async () => {
    const db = await convertedDocument()
    const installed = installLedgerPack(db, NOW)
    if (!installed.ok) throw new Error(installed.error)
    const index = new Map(listFormats(db).map((each) => [each.name, each]))
    const rules = index.get('category_rule') as FormatDeclaration
    const transaction = index.get('transaction') as FormatDeclaration
    expect(rules.ruleSets?.map((each) => each.name)).toEqual(['categories'])

    const ledger = listRules(db).filter((rule) => ['EXACT_MERCHANT', 'CONTAINS', 'REGEX'].includes(rule.kind))
    const prepared = rulesSetting(db, transaction)
    let agreed = 0
    let tied = 0
    for (const rule of ledger.filter((each) => each.kind !== 'REGEX')) {
      const merchant = normalizeMerchant(rule.pattern)
      const said = withRules(
        db,
        transaction,
        { merchant_normalized: merchant, category: null, category_source: 'NONE', matched_rule: null },
        {},
        prepared,
      )
      const decision = said.decisions[0]?.decision
      const winner = firstMatch(ledger, {
        merchantNormalized: merchant,
        providerCategory: undefined,
        amount: money(-1000, 'ILS'),
        accountId: 'acc:none',
      })
      if (decision !== undefined && decision !== 'PERSON' && decision.kind === 'TIE') {
        tied += 1
        continue
      }
      expect(said.cells['category'], merchant).toBe(winner?.targetCategoryId)
      expect(said.cells['category_source']).toBe('RULE')
      agreed += 1
    }
    expect(agreed).toBeGreaterThan(ledger.length / 2)
    expect(tied).toBeLessThan(agreed)

    // A person's category is never the rules'.
    const mine = withRules(
      db,
      transaction,
      { merchant_normalized: normalizeMerchant(ledger[0]?.pattern ?? ''), category: 'cat:uncategorized' },
      {},
      prepared,
    )
    expect(mine.cells).toMatchObject({ category: 'cat:uncategorized', category_source: 'MANUAL' })
  })

  it('gives a format declared before the pack grew an aggregate that aggregate', async () => {
    const db = await convertedDocument()
    installLedgerPack(db, NOW)
    const held = listFormats(db).find((each) => each.name === 'debt')
    if (held === undefined) throw new Error('no debt')
    expect(
      adoptFormat(db, { ...held, language: 8, aggregates: [], identities: [], derived: [], nothingMustHold: true }, NOW).refusals,
    ).toEqual([])

    const again = installLedgerPack(db, NOW + 1)
    if (!again.ok) throw new Error(again.error)
    const grown = listFormats(db).find((each) => each.name === 'debt')
    expect(grown?.language).toBe(held.language)
    expect(grown?.aggregates.map((each) => each.name)).toEqual(held.aggregates.map((each) => each.name))
  })

  /**
   * **What the pack no longer declares, it takes away or hands over** (M28 U1,
   * D-308). Investments left the ledger whole (D-283), and a document that got
   * them before is locked out of tables nothing writes any more unless the pack
   * says what becomes of them: an empty one goes, one holding rows becomes the
   * person's own, and a format of the same name somebody declared is left alone.
   */
  it('opens a document from before the groups became the top of the tree (M28 F29)', async () => {
    // What such a document holds: the pack's category_group, rows in it, and a
    // `group` column on its categories naming them.
    const db = await convertedDocument()
    installLedgerPack(db, NOW)
    const setting = formats().find((each) => each.name === 'setting') as FormatDeclaration
    const groups: FormatDeclaration = {
      ...setting,
      name: 'category_group',
      title: 'Category group',
      columns: [column('name', 'text', { required: true, unique: true }), column('sort_order', 'integer', { required: true })],
      owner: { pack: 'ledger', written: 'on the Categories screen', columns: ['name', 'sort_order'] },
    }
    expect(adoptFormat(db, groups, NOW).refusals).toEqual([])
    const held = new Map(listFormats(db).map((each) => [each.name, each]))
    insertRows(db, held.get('category_group') as FormatDeclaration, [{ name: 'Living', sort_order: 10 }], ['grp:living'])
    const category = held.get('category') as FormatDeclaration
    expect(
      adoptFormat(db, { ...category, columns: [...category.columns, column('group', 'link', { target: 'category_group' })] }, NOW)
        .refusals,
    ).toEqual([])
    db.run("UPDATE fmt_category SET \"group\" = 'grp:living' WHERE id = 'cat:groceries'")

    const again = installLedgerPack(db, NOW + 1)
    if (!again.ok) throw new Error(again.error)
    // Holding rows, it is handed to the document rather than taken away.
    expect(again.value.released).toEqual(['category_group'])
    const index = new Map(listFormats(db).map((each) => [each.name, each]))
    expect(index.get('category_group')?.owner).toBeUndefined()
    // The categories still read and still take a new one; nothing reads the column.
    expect(listRows(db, index.get('category') as FormatDeclaration).length).toBe(54)
    createCategory(db, { name: 'Pottery', kind: 'EXPENSE', parentId: 'cat:living' }, NOW + 2)
    expect(listCategories(db).find((one) => one.name === 'Pottery')?.path).toBe('Living → Pottery')
  })

  describe('retiring the formats investments took with them', () => {
    const packOwned = (name: string, title: string): FormatDeclaration => ({
      ...setting(),
      name,
      title,
      owner: { pack: 'ledger', written: 'on the Investments screen', columns: ['key', 'value'] },
    })
    const setting = (): FormatDeclaration => {
      const found = formats().find((each) => each.name === 'setting')
      if (found === undefined) throw new Error('no setting')
      return found
    }

    it('takes away an empty one, and hands one holding rows over to the document', async () => {
      const db = await convertedDocument()
      installLedgerPack(db, NOW)
      for (const [name, title] of [['fx_rate', 'Exchange rate'], ['security', 'Security']] as const) {
        expect(adoptFormat(db, packOwned(name, title), NOW).refusals).toEqual([])
      }
      const security = listFormats(db).find((each) => each.name === 'security') as FormatDeclaration
      insertRows(db, security, [{ key: 'TEVA', value: '{}' }])

      const again = installLedgerPack(db, NOW + 1)
      if (!again.ok) throw new Error(again.error)
      expect(again.value.retired).toEqual(['fx_rate'])
      expect(again.value.released).toEqual(['security'])

      const index = new Map(listFormats(db).map((each) => [each.name, each]))
      expect(index.has('fx_rate')).toBe(false)
      expect(db.exec("SELECT 1 FROM sqlite_master WHERE name = 'fmt_fx_rate'")).toHaveLength(0)
      const released = index.get('security') as FormatDeclaration
      expect(released.owner).toBeUndefined()
      expect(listRows(db, released).map((row) => row.cells['key'])).toEqual(['TEVA'])

      const third = installLedgerPack(db, NOW + 2)
      if (!third.ok) throw new Error(third.error)
      expect(third.value.retired).toBeUndefined()
      expect(third.value.released).toBeUndefined()
    })

    /**
     * **A fund is a holding** (M36 U12, D-389): a document that kept funds the
     * old way opens — a deduction type's and a bucket's links to a fund go with
     * what they held, nothing is converted, an empty fund format is taken away
     * even though a deduction type pointed at it, and one holding rows is the
     * person's own.
     */
    it('opens a document that kept its funds the old way (M36 U12)', async () => {
      for (const kept of [false, true]) {
        const db = await convertedDocument()
        installLedgerPack(db, NOW)
        expect(adoptFormat(db, packOwned('fund_account', 'Fund'), NOW).refusals).toEqual([])
        if (kept) insertRows(db, listFormats(db).find((each) => each.name === 'fund_account') as FormatDeclaration, [{ key: 'Pension', value: '{}' }])
        const held = (name: string): FormatDeclaration => listFormats(db).find((each) => each.name === name) as FormatDeclaration
        const withOld = (name: string, old: string): FormatDeclaration => ({
          ...held(name),
          columns: [...held(name).columns, column(old, 'link', { target: 'fund_account' })],
        })
        expect(adoptFormat(db, withOld('deduction_type', 'linked_fund_account'), NOW).refusals).toEqual([])
        expect(adoptFormat(db, withOld('split_bucket', 'target_fund'), NOW).refusals).toEqual([])
        const fund = String(db.exec('SELECT id FROM fmt_fund_account')[0]?.values[0]?.[0] ?? '')
        if (kept) db.run(`UPDATE fmt_deduction_type SET linked_fund_account = ? WHERE kind = 'PENSION'`, [fund])

        const again = installLedgerPack(db, NOW + 1)
        if (!again.ok) throw new Error(again.error)
        expect(again.value.retired ?? []).toEqual(kept ? [] : ['fund_account'])
        expect(again.value.released ?? []).toEqual(kept ? ['fund_account'] : [])
        expect(held('deduction_type').columns.some((each) => each.name === 'linked_fund_account')).toBe(false)
        expect(held('deduction_type').columns.some((each) => each.name === 'linked_holding')).toBe(true)
        expect(held('split_bucket').columns.some((each) => each.name === 'target_fund')).toBe(false)
        expect(held('holding_place').columns.find((each) => each.name === 'kind')?.values).not.toContain('PROVIDENT')
        expect(installLedgerPack(db, NOW + 2).ok).toBe(true)
      }
    })

    it('leaves a format of the same name that a person declared', async () => {
      const db = await convertedDocument()
      installLedgerPack(db, NOW)
      const { owner: _none, ...mine } = packOwned('fx_rate', 'My rates')
      expect(adoptFormat(db, mine, NOW).refusals).toEqual([])

      const again = installLedgerPack(db, NOW + 1)
      if (!again.ok) throw new Error(again.error)
      expect(again.value.retired).toBeUndefined()
      expect(listFormats(db).find((each) => each.name === 'fx_rate')?.title).toBe('My rates')
    })
  })

  it('is on per document: never for one that has not been a ledger', async () => {
    const db = await createDatabase()
    expect(documentHasLedger(db)).toBe(false)

    const other = await convertedDocument()
    installLedgerPack(other, NOW)
    expect(documentHasLedger(other)).toBe(true)
  })

  it('refuses, in the database, each constraint a declaration carries', async () => {
    const db = await convertedDocument()
    installLedgerPack(db, NOW)
    let checked = 0

    for (const declaration of formats()) {
      const base = validRow(declaration)
      const table = tableNameFor(declaration)
      const insert = (row: Record<string, unknown>): void => {
        const names = Object.keys(row)
        db.run(
          `INSERT INTO "${table}" (id, ${names.map((n) => `"${n}"`).join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`,
          [`r${checked}-${Math.random()}`, ...(Object.values(row) as (string | number | null)[])],
        )
      }
      // The baseline is a row the table accepts, or every refusal below proves nothing.
      expect(() => insert(base), `${declaration.name} baseline`).not.toThrow()

      for (const column of declaration.columns) {
        const stored = storedColumnsOf(column)[0] ?? column.name
        if (column.required) {
          expect(() => insert({ ...base, [stored]: null }), `${declaration.name}.${column.name} required`).toThrow()
          checked += 1
        }
        if (column.type === 'enum') {
          expect(() => insert({ ...base, [stored]: 'NOT_A_MEMBER' }), `${declaration.name}.${column.name} enum`).toThrow()
          checked += 1
        }
        if (column.unique) {
          db.run(`DELETE FROM "${table}"`)
          const once = { ...validRow(declaration), [stored]: uniqueValue(column.type) }
          insert(once)
          expect(() => insert(once), `${declaration.name}.${column.name} unique`).toThrow()
          db.run(`DELETE FROM "${table}"`)
          checked += 1
        }
        const maximum = column.maximum
        if (maximum !== undefined && column.type === 'integer') {
          expect(() => insert({ ...base, [stored]: maximum + 1 })).toThrow()
          checked += 1
        }
      }

      for (const constraint of declaration.constraints ?? []) {
        if (constraint.kind === 'ONE_PER') {
          // A fact about the table (D-270): the same row twice, under its `when`.
          db.run(`DELETE FROM "${table}"`)
          const once = validRow(declaration)
          if (constraint.when !== undefined) once[constraint.when] = constraint.is[0]
          for (const name of constraint.columns) {
            const column = declaration.columns.find((each) => each.name === name)
            if (once[name] === undefined) once[name] = uniqueValue(column?.type ?? 'text')
          }
          insert(once)
          expect(() => insert(once), `${declaration.name}: ${constraint.kind}`).toThrow('UNIQUE')
          db.run(`DELETE FROM "${table}"`)
          checked += 1
          continue
        }
        const broken: Record<string, unknown> = { ...base }
        if (constraint.kind === 'AT_MOST_ONE') {
          for (const name of constraint.columns) broken[name] = 'some-row'
        } else if (constraint.kind === 'REQUIRED_WHEN') {
          broken[constraint.when ?? ''] = constraint.is[0]
          for (const name of storedColumnNames(declaration, constraint.columns[0] ?? '')) broken[name] = null
        } else {
          const money = moneyColumnNames({ name: constraint.columns[0] ?? '' })
          broken[constraint.when ?? ''] = constraint.is[0]
          broken[money.minor] = constraint.sign === 'AT_MOST_ZERO' ? 100 : -100
        }
        expect(() => insert(broken), `${declaration.name}: ${constraint.kind}`).toThrow()
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(150)
  })
})

function storedColumnNames(declaration: FormatDeclaration, name: string): readonly string[] {
  const column = declaration.columns.find((each) => each.name === name)
  return column === undefined ? [name] : storedColumnsOf(column)
}

function uniqueValue(type: string): string | number {
  return type === 'integer' ? 7 : type === 'month' ? '2026-01' : type === 'date' ? '2026-01-01' : 'same'
}

/**
 * A row every constraint accepts: each required column filled, and each enum
 * set to a member no constraint's `when` names, so nothing becomes required.
 */
function validRow(declaration: FormatDeclaration): Record<string, unknown> {
  const deciding = new Map<string, Set<string>>()
  for (const constraint of declaration.constraints ?? []) {
    // `one row per` makes nothing required, whatever its `when` (D-270).
    if (constraint.when === undefined || constraint.kind === 'ONE_PER') continue
    const members = deciding.get(constraint.when) ?? new Set<string>()
    for (const member of constraint.is) members.add(member)
    deciding.set(constraint.when, members)
  }

  const row: Record<string, unknown> = {}
  for (const column of declaration.columns) {
    if (column.type === 'enum') {
      const avoid = deciding.get(column.name) ?? new Set<string>()
      row[column.name] = column.values.find((each) => !avoid.has(each)) ?? column.values[0]
      continue
    }
    if (!column.required) continue
    switch (column.type) {
      case 'money': {
        const names = moneyColumnNames(column)
        row[names.minor] = 0
        row[names.currency] = 'ILS'
        break
      }
      case 'integer':
      case 'boolean':
      case 'decimal':
        row[column.name] = column.minimum ?? 0
        break
      case 'date':
        row[column.name] = '2026-01-01'
        break
      case 'month':
        row[column.name] = '2026-01'
        break
      case 'instant':
        row[column.name] = '2026-01-01T00:00:00.000Z'
        break
      default:
        row[column.name] = `${column.name}-${Math.random()}`
    }
  }
  return row
}

describe('the ledger’s start views (M36 U06)', () => {
  it('declares a question on columns its formats have', () => {
    const views = ledgerViews()
    if (!views.ok) throw new Error(views.error)
    expect(views.value.filter((each) => each.view === 'start' && each.setting.startsWith('is ')).map((each) => [each.format, each.setting])).toEqual([
      ['card_settlement_link', 'is PENDING'],
      ['debt_payment', 'is false'],
      ['transfer_pair', 'is PENDING'],
    ])
  })

  it('gives a document its start views, so start_here answers a ledger the way it answers memory.emd', async () => {
    const db = await convertedDocument()
    expect(installLedgerPack(db, NOW).ok).toBe(true)
    expect(viewSettings(db, 'transfer_pair', 'start').get('user_decision')).toBe('is PENDING')
    expect(startHere(db, listFormats(db)).map((each) => [each.question.format, each.question.what])).toEqual([
      ['card_settlement_link', 'user_decision is PENDING'],
      ['debt_payment', 'is_confirmed is false'],
      ['transfer_pair', 'user_decision is PENDING'],
    ])
    db.close()
  })

  it('leaves a start view the document already has as its own', async () => {
    const db = await convertedDocument()
    expect(installLedgerPack(db, NOW).ok).toBe(true)
    db.run(`DELETE FROM format_view_column WHERE format_name = 'transfer_pair' AND view = 'start'`)
    restoreViewSettings(db, [{ format: 'transfer_pair', view: 'start', column: 'user_decision', setting: 'is NOT_PAIRED' }])
    expect(installLedgerPack(db, NOW).ok).toBe(true)
    expect(viewSettings(db, 'transfer_pair', 'start')).toEqual(new Map([['user_decision', 'is NOT_PAIRED']]))
    db.close()
  })
})
