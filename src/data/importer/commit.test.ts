import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { fromMajorUnits, formatMoney } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { DraftTransaction } from '@/domain/model/importing.ts'
import { query } from '../db/database.ts'
import { createAccount, findOrCreateAccount } from '../repositories/accountRepository.ts'
import { createRule, findRule, setRuleEnabled } from '../repositories/categoryRuleRepository.ts'
import { setBuiltInEnabled } from '../repositories/ruleSetRepository.ts'
import { findMappingById, saveMapping } from '../repositories/importMappingRepository.ts'
import { findSession } from '../repositories/importSessionRepository.ts'
import { acceptAllNew, listStagedRows } from '../repositories/stagedRowRepository.ts'
import {
  countTransactions,
  listTransactions,
  monthlyTotals,
} from '../repositories/transactionRepository.ts'
import { applyMapping } from './apply.ts'
import { commitSession } from './commit.ts'
import { guessMapping } from './guess.ts'
import { assignNaturalKeys, hashBytes } from './naturalKey.ts'
import { readWorkbook } from './sheetTable.ts'
import { stageImport } from './stage.ts'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/synthetic/typed-cells.xlsx', import.meta.url))

/**
 * A decision and a category on staged rows, as the declared `staged_row` format holds them.
 * The review screen's per-row setters are gone (M45 U2); the commit still honours both columns.
 */
function setDecision(db: Database, ids: readonly string[], decision: string): void {
  for (const id of ids) db.run('UPDATE fmt_staged_row SET user_decision = ? WHERE id = ?', [decision, id])
}

function setChosenCategory(db: Database, ids: readonly string[], categoryId: string): void {
  for (const id of ids) db.run('UPDATE fmt_staged_row SET chosen_category = ? WHERE id = ?', [categoryId, id])
}

function draft(overrides: Partial<DraftTransaction> = {}): DraftTransaction {
  return {
    transactionDate: localDate(2026, 7, 3),
    amount: fromMajorUnits(-42, 'ILS'),
    direction: 'OUTFLOW',
    merchantRaw: 'קפה גן עד',
    merchantNormalized: 'קפה גן עד',
    sourceRowRef: 'sheet!10',
    ...overrides,
  }
}

describe('natural keys', () => {
  it('gives two genuinely identical same-day purchases different keys', () => {
    // Two identical coffees on one day are two transactions, not a duplicate.
    const keys = assignNaturalKeys([draft(), draft()])
    expect(keys[0]).not.toBe(keys[1])
  })

  it('reproduces the same keys for the same file, so re-import is a no-op', () => {
    const first = assignNaturalKeys([draft(), draft(), draft({ merchantNormalized: 'פז' })])
    const second = assignNaturalKeys([draft(), draft(), draft({ merchantNormalized: 'פז' })])
    expect(second).toEqual(first)
  })

  it('separates rows that differ in any component', () => {
    const keys = assignNaturalKeys([
      draft(),
      draft({ amount: fromMajorUnits(-43, 'ILS') }),
      draft({ transactionDate: localDate(2026, 7, 4) }),
      draft({ merchantNormalized: 'אחר' }),
      draft({ installment: { sequence: 2, total: 3, groupKey: 'group-1' } }),
    ])
    expect(new Set(keys).size).toBe(5)
  })
})

describe('staging and committing a real parse', () => {
  let db: Database
  let rows: ReturnType<typeof applyMapping>
  let parsedCount: number

  beforeEach(async () => {
    db = await createLedgerDatabase()

    const sheet = readWorkbook('typed-cells.xlsx', new Uint8Array(readFileSync(FIXTURE))).sheets[0]
    if (sheet === undefined) throw new Error('fixture has no sheets')
    const mapping = guessMapping(sheet)
    if (mapping === undefined) throw new Error('no mapping')

    rows = applyMapping(sheet, mapping)
    parsedCount = rows.filter((row) => row.outcome.kind === 'parsed').length
  })

  function stage(fileHash = 'hash-1', mappingId?: string): ReturnType<typeof stageImport> {
    // Found rather than created, so staging the same file twice stages it into
    // the same account — which is the only way the duplicate tests below mean
    // anything, since natural keys are scoped per account.
    const account = findOrCreateAccount(
      db,
      { name: 'Card 1234', kind: 'CREDIT_CARD', last4: '1234' },
      1,
    )
    return stageImport(
      db,
      {
        accountId: account.id,
        fileName: 'typed-cells.xlsx',
        fileHash,
        sheetName: 'עסקאות',
        mappingId,
        rows,
      },
      Date.now(),
    )
  }

  /** Stage, accept everything new, commit — the ordinary path through the review screen. */
  function stageAndCommit(fileHash = 'hash-1', mappingId?: string): ReturnType<typeof commitSession> {
    const staged = stage(fileHash, mappingId)
    acceptAllNew(db, staged.sessionId, Date.now())
    return commitSession(db, staged.sessionId, Date.now())
  }

  describe('staging', () => {
    it('stages every row of the file, not only the ones that parsed', () => {
      // The review screen has to be able to show a failure and a skipped row.
      // A staging area that held only the successes would make the rows most
      // worth looking at the ones that vanished.
      const staged = stage()
      expect(listStagedRows(db, staged.sessionId)).toHaveLength(rows.length)
      expect(staged.newRows + staged.failed + staged.skipped + staged.duplicates).toBe(rows.length)
    })

    it('leaves the session waiting for review, with nothing in the ledger', () => {
      const staged = stage()
      expect(findSession(db, staged.sessionId)?.status).toBe('AWAITING_REVIEW')
      expect(countTransactions(db)).toBe(0)
    })

    it('leaves every row pending, because nothing here is auto-accepted', () => {
      const staged = stage()
      const pending = listStagedRows(db, staged.sessionId)
      expect(pending.filter((row) => row.decision === 'PENDING')).toHaveLength(rows.length)
    })

    it('keeps the raw cells and the row number a message would quote', () => {
      const staged = stage()
      const first = listStagedRows(db, staged.sessionId)[0]
      expect(first?.rawCells.length).toBeGreaterThan(0)
      expect(first?.rowIndex).toBe(9)
    })

    it('explains a skipped row rather than dropping it silently', () => {
      const staged = stage()
      const skipped = listStagedRows(db, staged.sessionId, { status: 'SKIPPED' })
      expect(skipped.length).toBeGreaterThan(0)
      expect(skipped[0]?.errorMessage).toBeTruthy()
      expect(skipped[0]?.transaction).toBeUndefined()
    })
  })

  describe('committing', () => {
    it('writes every accepted row', () => {
      const result = stageAndCommit()
      expect(result.imported).toBe(parsedCount)
      expect(countTransactions(db)).toBe(parsedCount)
    })

    it('writes nothing while every row is still pending', () => {
      // The whole point of the review step: the user decides, not the app.
      const staged = stage()
      const result = commitSession(db, staged.sessionId, Date.now())
      expect(result.imported).toBe(0)
      expect(countTransactions(db)).toBe(0)
    })

    it('leaves a row the user skipped out of the ledger', () => {
      const staged = stage()
      acceptAllNew(db, staged.sessionId, Date.now())

      const first = listStagedRows(db, staged.sessionId, { status: 'NEW' })[0]
      setDecision(db, [first?.id ?? ''], 'SKIP')

      expect(commitSession(db, staged.sessionId, Date.now()).imported).toBe(parsedCount - 1)
    })

    it('records a category picked in the review as a manual assignment', () => {
      // D-009: manual wins forever, so it must not land as anything else.
      const staged = stage()
      acceptAllNew(db, staged.sessionId, Date.now())

      const first = listStagedRows(db, staged.sessionId, { status: 'NEW' })[0]
      setChosenCategory(db, [first?.id ?? ''], 'cat:groceries')
      commitSession(db, staged.sessionId, Date.now())

      const stored = listTransactions(db).find((row) => row.categoryId === 'cat:groceries')
      expect(stored).toBeDefined()
      expect(stored?.categorySource).toBe('MANUAL')
    })

    it('marks the session committed, so it stops being resumable', () => {
      const result = stageAndCommit()
      expect(findSession(db, result.sessionId)?.status).toBe('COMMITTED')
    })

    it('importing the same file twice produces the same ledger as importing it once', () => {
      // The invariant docs/05 singles out as unskippable.
      const first = stageAndCommit('hash-1')
      const before = listTransactions(db)

      const second = stageAndCommit('hash-2')

      expect(second.imported).toBe(0)
      expect(countTransactions(db)).toBe(first.imported)
      expect(listTransactions(db).map((row) => row.naturalKey)).toEqual(
        before.map((row) => row.naturalKey),
      )
    })

    it('classifies the second staging of the same file as duplicates', () => {
      stageAndCommit('hash-1')
      const staged = stage('hash-2')

      expect(staged.newRows).toBe(0)
      expect(staged.duplicates).toBe(parsedCount)
    })

    it('refuses to commit a duplicate the user accepted anyway, and says so', () => {
      // Accepting a duplicate cannot produce a transaction — the unique index
      // refuses it — so it is counted and skipped rather than taking the whole
      // commit down over a row the user could not have known about.
      stageAndCommit('hash-1')
      const staged = stage('hash-2')

      const duplicates = listStagedRows(db, staged.sessionId, { status: 'DUPLICATE_EXACT' })
      setDecision(db, duplicates.map((row) => row.id), 'ACCEPT')

      const result = commitSession(db, staged.sessionId, Date.now())
      expect(result.imported).toBe(0)
      expect(result.rejected).toBe(duplicates.length)
      expect(countTransactions(db)).toBe(parsedCount)
    })

    it('records which saved mapping parsed the file, and counts the use', () => {
      const mapping = saveMapping(
        db,
        {
          name: 'Synthetic – Visa 1234',
          headerSignature: 'sig-a',
          mapping: {
            sheetName: 'עסקאות',
            headerRowIndex: 8,
            dataStartRowIndex: 9,
            columnRoles: new Map([[0, 'date']]),
            amountConvention: 'POSITIVE_IS_CHARGE',
            dateOrders: new Map(),
            defaultCurrency: 'ILS',
          },
        },
        1,
      )

      const result = stageAndCommit('hash-1', mapping.id)

      const session = query(db, 'SELECT mapping AS mapping_id FROM fmt_statement WHERE id = ?', [
        result.sessionId,
      ])[0]
      expect(session?.['mapping_id']).toBe(mapping.id)
      expect(findMappingById(db, mapping.id)?.useCount).toBe(1)
    })

    it('leaves the mapping unnamed when the import used a one-off mapping', () => {
      const result = stageAndCommit()
      const session = query(db, 'SELECT mapping AS mapping_id FROM fmt_statement WHERE id = ?', [
        result.sessionId,
      ])[0]
      expect(session?.['mapping_id']).toBeNull()
    })

    it('round-trips money and dates through staging and SQLite without drift', () => {
      // Two hops now rather than one — the draft goes through staged_row before
      // it reaches "transaction", and each hop is a chance to lose a minor unit
      // or shift a day.
      stageAndCommit()
      const shufersal = listTransactions(db).find((row) => row.merchantRaw === 'שופרסל דיל 344')

      expect(shufersal).toBeDefined()
      expect(formatMoney(shufersal!.amount)).toBe('-₪421.05')
      expect(shufersal!.transactionDate).toEqual({ year: 2026, month: 7, day: 3 })
      expect(shufersal!.chargeDate).toEqual({ year: 2026, month: 8, day: 2 })
    })

    it('keeps the installment counter and the provider category', () => {
      stageAndCommit()
      const row = listTransactions(db).find((candidate) => candidate.installment !== undefined)
      expect(row?.installment?.sequence).toBe(1)
      expect(row?.installment?.total).toBe(3)
      // The group key is derived at parse time and has to survive staging and
      // the commit, or the slices of a purchase reach the ledger unlinked.
      expect(row?.installment?.groupKey).toBeTruthy()
    })

    it('totals the month on the charge date', () => {
      stageAndCommit()
      const months = monthlyTotals(db)
      // Every charge date in the fixture is 2026-08-02, so one bucket.
      expect(months).toHaveLength(1)
      expect(months[0]?.period).toBe('2026-08')
      // Outflows only; the refund lands in inflow. Note AMAZON's charge is the
      // 158.30 in `סכום חיוב`, not the 42.99 in `סכום עסקה` — mapping `amount` to
      // the charge column rather than the transaction column is exactly what that
      // distinction is for.
      expect(months[0]?.outflowMinor).toBe(421_05 + 289_00 + 1184_20 + 158_30 + 32_00)
      expect(months[0]?.inflowMinor).toBe(1234_56)
    })

    it('refuses a second row with the same natural key at the database level', () => {
      stageAndCommit()
      const row = listTransactions(db)[0]
      expect(row).toBeDefined()
      // Belt and braces: even if classification were bypassed, the unique index
      // is what actually guarantees the ledger cannot double.
      expect(() =>
        db.run(
          `INSERT INTO fmt_transaction
             (id, account, transaction_date, amount_minor, amount_currency, direction, merchant_raw,
              merchant_normalized, natural_key, is_excluded_from_stats, category_source)
           VALUES ('dup', ?, '2026-07-03', -1, 'ILS', 'OUTFLOW', 'x', 'x', ?, 0, 'NONE')`,
          [row!.accountId, row!.naturalKey],
        ),
      ).toThrow(/UNIQUE/i)
    })

    it('refuses a row whose sign disagrees with its direction', () => {
      // D-004: the redundant direction column exists to catch sign bugs as
      // constraint violations rather than as wrong totals.
      const account = createAccount(db, { name: 'X', kind: 'CASH' }, 1)
      expect(() =>
        db.run(
          `INSERT INTO fmt_transaction
             (id, account, transaction_date, amount_minor, amount_currency, direction, merchant_raw,
              merchant_normalized, natural_key, is_excluded_from_stats, category_source)
           VALUES ('bad', ?, '2026-07-03', 500, 'ILS', 'OUTFLOW', 'x', 'x', 'k', 0, 'NONE')`,
          [account.id],
        ),
        // The declared sign rule (D-259), which is the old CHECK's sentence.
      ).toThrow(/amount is at most 0 when direction is OUTFLOW/)
    })

    it('refuses a staged row whose sign disagrees with its direction, too', () => {
      // The same guard one hop earlier, so a sign bug is caught in staging
      // rather than at the copy into the ledger.
      const staged = stage()
      expect(() =>
        db.run(
          `INSERT INTO fmt_staged_row
             (id, statement, row_index, raw_cells, status, user_decision,
              amount_minor, amount_currency, direction)
           VALUES ('bad', ?, 999, '[]', 'NEW', 'PENDING', 500, 'ILS', 'OUTFLOW')`,
          [staged.sessionId],
        ),
      ).toThrow(/amount is at most 0 when direction is OUTFLOW/)
    })
  })
})

describe('rules on the import path', () => {
  let db: Database
  let rows: ReturnType<typeof applyMapping>

  beforeEach(async () => {
    db = await createLedgerDatabase()

    // Every built-in switched off, because each test below is a statement about
    // one rule the test wrote. The rule set is never empty in a real document
    // (D-046) and the describe underneath this one is about exactly that; here
    // it would only be noise in the counts.
    db.run('UPDATE fmt_category_rule SET is_enabled = 0')

    const sheet = readWorkbook('typed-cells.xlsx', new Uint8Array(readFileSync(FIXTURE))).sheets[0]
    if (sheet === undefined) throw new Error('fixture has no sheets')
    const mapping = guessMapping(sheet)
    if (mapping === undefined) throw new Error('no mapping')
    rows = applyMapping(sheet, mapping)
  })

  function account(): string {
    return findOrCreateAccount(db, { name: 'Card 1234', kind: 'CREDIT_CARD', last4: '1234' }, 1).id
  }

  function stage(accountId: string): ReturnType<typeof stageImport> {
    return stageImport(
      db,
      { accountId, fileName: 'typed-cells.xlsx', fileHash: 'hash-1', sheetName: 'עסקאות', rows },
      1000,
    )
  }

  function groceriesRule(overrides: Partial<Parameters<typeof createRule>[1]> = {}) {
    return createRule(
      db,
      {
        name: 'Shufersal',
        kind: 'CONTAINS',
        pattern: 'שופרסל',
        targetCategoryId: 'cat:groceries',
        ...overrides,
      },
      500,
    )
  }

  it('suggests a category at staging, and says which rule suggested it', () => {
    const rule = groceriesRule()
    const staged = stage(account())

    const suggested = listStagedRows(db, staged.sessionId).filter(
      (row) => row.suggestedCategoryId !== undefined,
    )

    expect(suggested).toHaveLength(1)
    expect(suggested[0]?.transaction?.merchantRaw).toBe('שופרסל דיל 344')
    expect(suggested[0]?.suggestedCategoryId).toBe('cat:groceries')
    expect(suggested[0]?.suggestedRuleId).toBe(rule.id)
    // Nothing is chosen. A suggestion is not a decision (docs/conventions.md).
    expect(suggested[0]?.chosenCategoryId).toBeUndefined()
  })

  it('does not count a hit until the row is actually committed', () => {
    const rule = groceriesRule()
    stage(account())
    expect(findRule(db, rule.id)?.hitCount).toBe(0)
  })

  it('turns an accepted suggestion into a RULE assignment naming the rule', () => {
    const rule = groceriesRule()
    const staged = stage(account())
    acceptAllNew(db, staged.sessionId, 2000)

    const result = commitSession(db, staged.sessionId, 3000)
    expect(result.categorizedByRule).toBe(1)

    const shufersal = listTransactions(db).find((row) => row.merchantRaw === 'שופרסל דיל 344')
    expect(shufersal?.categoryId).toBe('cat:groceries')
    expect(shufersal?.categorySource).toBe('RULE')

    const stored = query(db, 'SELECT matched_rule AS matched_rule_id FROM fmt_transaction WHERE id = ?', [
      shufersal?.id ?? '',
    ])[0]
    expect(stored?.['matched_rule_id']).toBe(rule.id)

    const after = findRule(db, rule.id)
    expect(after?.hitCount).toBe(1)
    expect(after?.lastMatchedAt).toBe(3000)
  })

  it('lets a category picked in the review beat the suggestion, as MANUAL', () => {
    const rule = groceriesRule()
    const staged = stage(account())

    const target = listStagedRows(db, staged.sessionId).find(
      (row) => row.suggestedRuleId !== undefined,
    )
    setChosenCategory(db, [target?.id ?? ''], 'cat:restaurants')
    acceptAllNew(db, staged.sessionId, 2000)

    const result = commitSession(db, staged.sessionId, 3000)
    expect(result.categorizedByRule).toBe(0)

    const shufersal = listTransactions(db).find((row) => row.merchantRaw === 'שופרסל דיל 344')
    expect(shufersal?.categoryId).toBe('cat:restaurants')
    expect(shufersal?.categorySource).toBe('MANUAL')

    const stored = query(db, 'SELECT matched_rule AS matched_rule_id FROM fmt_transaction WHERE id = ?', [
      shufersal?.id ?? '',
    ])[0]
    expect(stored?.['matched_rule_id']).toBeNull()
    // The rule did not categorize anything, and must not claim it did.
    expect(findRule(db, rule.id)?.hitCount).toBe(0)
  })

  it('suggests nothing from a disabled rule', () => {
    const rule = groceriesRule()
    setRuleEnabled(db, rule.id, false, 600)

    const staged = stage(account())
    expect(listStagedRows(db, staged.sessionId).every((row) => row.suggestedCategoryId === undefined)).toBe(
      true,
    )
  })

  it('leaves every row uncategorized when there are no rules at all', () => {
    const staged = stage(account())
    acceptAllNew(db, staged.sessionId, 2000)

    const result = commitSession(db, staged.sessionId, 3000)
    expect(result.categorizedByRule).toBe(0)
    expect(listTransactions(db).every((row) => row.categorySource === 'NONE')).toBe(true)
  })

  it('honours a rule scoped to another account by not suggesting', () => {
    groceriesRule({ conditions: { scopeAccountId: 'acc-somewhere-else' } })
    const staged = stage(account())
    expect(
      listStagedRows(db, staged.sessionId).every((row) => row.suggestedCategoryId === undefined),
    ).toBe(true)
  })

  it('applies the resolution order the engine defines, not the order rules were made', () => {
    // The broad rule is created first and would win on age alone; the exact one
    // is more specific and wins on specificity, at equal priority.
    createRule(
      db,
      { name: 'Broad', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:shopping', priority: 10 },
      400,
    )
    const exact = createRule(
      db,
      {
        name: 'Exact',
        kind: 'EXACT_MERCHANT',
        pattern: 'שופרסל דיל',
        targetCategoryId: 'cat:groceries',
        priority: 10,
      },
      500,
    )

    const staged = stage(account())
    const row = listStagedRows(db, staged.sessionId).find((found) => found.suggestedRuleId !== undefined)

    expect(row?.suggestedRuleId).toBe(exact.id)
    expect(row?.suggestedCategoryId).toBe('cat:groceries')
  })
})

/**
 * The built-in set, on the path it exists for.
 *
 * This is F03's acceptance criterion in miniature: a document with no rules in
 * it at all, a statement file, and rows that arrive categorized without anyone
 * having written anything. The fixture carries `שופרסל דיל 344` and `פז ילו`,
 * which is a supermarket and a fuel station in the two forms an Israeli
 * statement writes them — one with a branch number that normalization has to
 * strip before the pattern can reach it.
 */
describe('built-in rules on the import path', () => {
  let db: Database
  let rows: ReturnType<typeof applyMapping>

  beforeEach(async () => {
    db = await createLedgerDatabase()

    const sheet = readWorkbook('typed-cells.xlsx', new Uint8Array(readFileSync(FIXTURE))).sheets[0]
    if (sheet === undefined) throw new Error('fixture has no sheets')
    const mapping = guessMapping(sheet)
    if (mapping === undefined) throw new Error('no mapping')
    rows = applyMapping(sheet, mapping)
  })

  function staged(): ReturnType<typeof stageImport> {
    const accountId = findOrCreateAccount(
      db,
      { name: 'Card 1234', kind: 'CREDIT_CARD', last4: '1234' },
      1,
    ).id
    return stageImport(
      db,
      { accountId, fileName: 'typed-cells.xlsx', fileHash: 'hash-1', sheetName: 'עסקאות', rows },
      1000,
    )
  }

  it('categorizes what it knows in a document with no rules of its own', () => {
    const session = staged()
    acceptAllNew(db, session.sessionId, 2000)
    commitSession(db, session.sessionId, 3000)

    const byMerchant = new Map(listTransactions(db).map((row) => [row.merchantRaw, row]))
    expect(byMerchant.get('שופרסל דיל 344')?.categoryId).toBe('cat:groceries')
    expect(byMerchant.get('שופרסל דיל 344')?.categorySource).toBe('RULE')
    expect(byMerchant.get('פז ילו')?.categoryId).toBe('cat:fuel')
  })

  it('records which built-in did it, by an id that survives the app not having a row for it', () => {
    const session = staged()
    acceptAllNew(db, session.sessionId, 2000)
    commitSession(db, session.sessionId, 3000)

    const shufersal = listTransactions(db).find((row) => row.merchantRaw === 'שופרסל דיל 344')
    const stored = query(db, 'SELECT matched_rule AS matched_rule_id FROM fmt_transaction WHERE id = ?', [
      shufersal?.id ?? '',
    ])[0]
    expect(stored?.['matched_rule_id']).toBe('builtin:il.grocery.shufersal')
  })

  it('stops suggesting once the user switches the built-in off', () => {
    setBuiltInEnabled(db, 'builtin:il.grocery.shufersal', false, 500)

    const session = staged()
    const row = listStagedRows(db, session.sessionId).find(
      (found) => found.transaction?.merchantRaw === 'שופרסל דיל 344',
    )
    expect(row?.suggestedCategoryId).toBeUndefined()
  })
})

describe('hashBytes', () => {
  it('is stable and content-addressed', async () => {
    const a = await hashBytes(new Uint8Array([1, 2, 3]))
    const b = await hashBytes(new Uint8Array([1, 2, 3]))
    const c = await hashBytes(new Uint8Array([1, 2, 4]))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toHaveLength(64)
  })
})
