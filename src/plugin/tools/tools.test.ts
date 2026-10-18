import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { createCategory, setCategoryManually } from '@/data/repositories/categoryRepository.ts'
import { createDebt } from '@/data/repositories/debtRepository.ts'
import { createFixedExpense } from '@/data/repositories/fixedExpenseRepository.ts'
import {
  addDeposit,
  createGoal,
  createHolding,
  createHoldingPlace,
} from '@/data/repositories/savingsRepository.ts'

import { categoryTreeTool, transactionsTool, uncategorizedMerchantsTool } from './ledger.ts'
import { monthSummaryTool, yearSummaryTool } from './insights.ts'
import { debtsTool, fixedExpensesTool, savingsTool } from './wealth.ts'
import { documentInfoTool } from './documentInfo.ts'
import { noteMerchantSuggestionsTool } from './categorize.ts'
import { skipMerchantsTool } from './rows.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * A document with enough in it that every tool has something to say, built the
 * way the app builds one — repositories only, no SQL. That constraint is not
 * ceremony: it is the same claim the tools themselves make, exercised from the
 * other side.
 *
 * Two merchants and one of them partly categorized, so the backlog has a group
 * that already knows what the user tends to file it under.
 */
async function seededDocument(): Promise<{ path: string; groceries: string }> {
  const db = await createLedgerDatabase()
  const now = 1_700_000_000_000

  const card = createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD', last4: '1234' }, now)
  const groceries = createCategory(db, { name: 'Plugin Groceries', kind: 'EXPENSE' }, now)

  const rows = [
    { id: 'tx-1', merchant: 'שופרסל דיל', major: -120.5, month: 7, provider: 'סופרמרקטים' },
    { id: 'tx-2', merchant: 'שופרסל דיל', major: -80.25, month: 7, provider: 'סופרמרקטים' },
    { id: 'tx-3', merchant: 'שופרסל דיל', major: -60, month: 7, provider: 'סופרמרקטים' },
    // No heading on these: a file without that column is the ordinary case,
    // and the listing has to say the hint is absent rather than invent one.
    { id: 'tx-4', merchant: 'ARomA', major: -18.9, month: 7, provider: undefined },
    { id: 'tx-5', merchant: 'ARomA', major: -999.99, month: 7, provider: undefined },
  ]

  for (const row of rows) {
    insertTransaction(
      db,
      {
        id: row.id,
        accountId: card.id,
        transactionDate: localDate(2026, row.month, 3),
        chargeDate: localDate(2026, row.month, 3),
        billingPeriod: { year: 2026, month: row.month },
        amount: fromMajorUnits(row.major, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: `${row.merchant} 344`,
        merchantNormalized: row.merchant,
        providerCategory: row.provider,
        cardLast4: '1234',
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: row.id,
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      now,
    )
  }

  // One row filed by hand, so `uncategorized_merchants` has a settled hint to
  // report and the ledger has a row whose source is MANUAL.
  setCategoryManually(db, 'tx-1', groceries, now)

  createFixedExpense(
    db,
    {
      name: 'Car insurance',
      matchKind: 'MERCHANT_PATTERN',
      matchRef: 'INSURER',
      expectedAmount: fromMajorUnits(3600, 'ILS'),
      cadence: 'YEARLY',
      categoryId: groceries,
      isDiscretionary: false,
    },
    now,
  )

  createDebt(
    db,
    {
      name: 'Car loan',
      kind: 'BANK_LOAN',
      principalAmount: fromMajorUnits(50000, 'ILS'),
      openedDate: localDate(2025, 1, 1),
      monthlyPaymentAmount: fromMajorUnits(1000, 'ILS'),
    },
    now,
  )

  const place = createHoldingPlace(db, { name: 'Bank savings', kind: 'DEPOSIT' }, now)
  const holding = createHolding(
    db,
    { holdingPlaceId: place.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
    now,
  )
  const goal = createGoal(db, { name: 'Emergency fund', kind: 'EMERGENCY' }, now)
  addDeposit(
    db,
    {
      goalId: goal.id,
      date: localDate(2026, 6, 1),
      amount: fromMajorUnits(12000, 'ILS'),
      holdingId: holding.id,
    },
    now,
  )

  return { path: await save(db, 'seeded.emd'), groceries }
}

async function emptyDocument(): Promise<string> {
  const db = await createLedgerDatabase()
  return save(db, 'empty.emd')
}

async function save(db: Database, name: string): Promise<string> {
  const bytes = exportDatabase(db)
  db.close()
  const dir = await tempDir('emerald-tools-')
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

describe('category_tree', () => {
  it('prints paths and ids, and names the uncategorized bucket', async () => {
    const { path, groceries } = await seededDocument()
    const text = await categoryTreeTool.run({ path }, NO_CLIENT)

    expect(text).toContain('Plugin Groceries')
    expect(text).toContain(groceries)
    expect(text).toContain('cat:uncategorized')
    expect(text).toContain('Archived ones excluded.')
  })
})

describe('document_info', () => {
  it('prints the account ids, because half the surface says they come from here', async () => {
    // Found by driving the built server (D-104): every `account_id` parameter
    // points at this tool, and it printed a count and no ids — so an import
    // into a document the conversation did not create had nowhere to get one.
    const { path } = await seededDocument()
    const text = await documentInfoTool.run({ path }, NO_CLIENT)

    expect(text).toContain('Cal – Visa 1234')
    expect(text).toContain('CREDIT_CARD')
    expect(text).toContain('1234')
  })
})

describe('uncategorized_merchants', () => {
  it('groups by the normalized name and reports what is already filed', async () => {
    const { path } = await seededDocument()
    const text = await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)

    // Three Shufersal rows, one of which is now categorized, so two remain.
    expect(text).toContain('שופרסל דיל')
    expect(text).toContain('ARomA')
    // The settled hint is the user's own past decision, carried through.
    expect(text).toContain('Plugin Groceries (1)')
  })

  it('returns the merchant name exactly as stored, with nothing prettified', async () => {
    // The name here is what a tier 2 write will be asked to match on. A round
    // trip through a cosmetic transform would silently match nothing.
    const { path } = await seededDocument()
    const text = await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)

    expect(text).toContain('| ARomA |')
    expect(text).not.toContain('AROMA')
    expect(text).not.toContain('Aroma')
  })

  it('does not print what each merchant adds up to', async () => {
    // D-120: categorizing sends merchant names, the
    // provider's label and the category list, and not amounts. This read used
    // to print an `Outflow` column of real per-merchant spending, which is
    // D-114's disclosure finding and D-120's answer to it. The ordering the
    // totals give is kept; the figures are not sent.
    const { path } = await seededDocument()
    const text = await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)

    expect(text).not.toContain('Outflow')
    expect(text).not.toMatch(/₪|ILS\s*[\d-]/)
  })

  it('marks a merchant the user skipped and lists it after the ones still waiting', async () => {
    const { path } = await seededDocument()
    expect(await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)).not.toContain('Skipped')

    // Shufersal is the larger backlog, so it leads until it is set aside.
    await skipMerchantsTool.run({ path, merchants: ['שופרסל דיל'], commit: true }, NO_CLIENT)
    const text = await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)

    expect(text).toContain('| Skipped |')
    expect(text).toMatch(/\| שופרסל דיל \|.*\| skipped /)
    expect(text.indexOf('| ARomA |')).toBeLessThan(text.indexOf('| שופרסל דיל |'))
  })

  it('prints them when a conversation asks outright', async () => {
    const { path } = await seededDocument()
    const text = await uncategorizedMerchantsTool.run({ path, include_amounts: true }, NO_CLIENT)

    expect(text).toContain('Outflow')
  })

  it("carries the provider's own heading, which is the hint for a merchant nobody has filed", async () => {
    // Not the user's taxonomy, and never treated as one — but it is what D-080
    // lets a rule match on, and it is all there is for a name never seen before.
    const { path } = await seededDocument()
    const text = await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)

    expect(text).toContain('סופרמרקטים (2)')
  })

  it('shows what a previous conversation already suggested, and says not to ask twice', async () => {
    const { path, groceries } = await seededDocument()
    await noteMerchantSuggestionsTool.run(
      {
        path,
        suggestions: [{ merchant: 'ARomA', category_id: groceries, status: 'DECLINED', note: 'it is work' }],
      },
      NO_CLIENT,
    )

    const text = await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)
    expect(text).toContain('declined Plugin Groceries')
    expect(text).toContain('it is work')
    expect(text).toContain('Do not put the same question a second time')
  })

  it('says nothing about being asked before when nobody has been', async () => {
    const { path } = await seededDocument()
    const text = await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)

    expect(text).not.toContain('Do not put the same question')
  })

  it('says so when there is nothing to do', async () => {
    const path = await emptyDocument()
    expect(await uncategorizedMerchantsTool.run({ path }, NO_CLIENT)).toContain('Nothing is uncategorized')
  })
})

describe('transactions', () => {
  it('totals every matching row, not just the page it shows', async () => {
    // The whole reason `listTransactions` and `summarizeTransactions` are two
    // functions. A page of two whose total was ₪199.15 rather than ₪1,279.64
    // would be quietly, plausibly wrong.
    const { path } = await seededDocument()
    const text = await transactionsTool.run({ path, limit: 2 }, NO_CLIENT)

    expect(text).toContain('Showing 2 of 5 matching transactions')
    expect(text).toContain('₪1,279.64')
  })

  it('sorts over the whole filter rather than over the page', async () => {
    const { path } = await seededDocument()
    const text = await transactionsTool.run({ path, limit: 1, sort: 'AMOUNT', direction: 'ASC' }, NO_CLIENT)

    // The largest charge is the most negative amount, and it must appear even
    // though it is not among the most recent rows.
    expect(text).toContain('₪999.99')
  })

  it('restates the scope it was given', async () => {
    const { path } = await seededDocument()
    const text = await transactionsTool.run({ path, search: 'ARomA' }, NO_CLIENT)

    expect(text).toContain('Scope: search "ARomA"')
    expect(text).toContain('2 matching transactions')
  })

  it('filters by amount, by magnitude, in major units', async () => {
    const { path } = await seededDocument()
    const text = await transactionsTool.run({ path, min: 500 }, NO_CLIENT)

    // **Singular, because there is one** (M22 U1). This line asserted
    // "1 matching transactions" for as long as `capNote` interpolated its noun
    // as given — a test pinning the carelessness `plural` was written to stop
    // one layer down, which is how it survived being read.
    expect(text).toContain('1 matching transaction.')
    expect(text).toContain('₪999.99')
  })

  it('rejects a sort column it does not have, by name', async () => {
    const { path } = await seededDocument()
    await expect(transactionsTool.run({ path, sort: 'MERCHANT_NAME' }, NO_CLIENT)).rejects.toThrow(
      /`sort` must be one of/,
    )
  })

  it('says no rows match rather than printing an empty table', async () => {
    const { path } = await seededDocument()
    expect(await transactionsTool.run({ path, search: 'nothing here' }, NO_CLIENT)).toContain('No rows match.')
  })
})

describe('month_summary', () => {
  it('adds up a month and says which months exist', async () => {
    const { path } = await seededDocument()
    const text = await monthSummaryTool.run({ path, month: '2026-07' }, NO_CLIENT)

    expect(text).toContain('# 2026-07')
    expect(text).toContain('₪1,279.64')
    // Went out is shown as its two parts (D-322), and they are the same rule as Home's.
    expect(text).toContain('of which bills')
    expect(text).toContain('of which everything else')
    // Which months are listed depends on the clock — `monthlySummaries` runs to
    // today — so the assertion is that the month with the rows in it is there,
    // not that it is alone.
    expect(text).toMatch(/Months with data:.*2026-07/)
  })

  it('names an empty month as empty and points at the ones that are not', async () => {
    const { path } = await seededDocument()
    const text = await monthSummaryTool.run({ path, month: '2020-01' }, NO_CLIENT)

    expect(text).toContain('No data for 2020-01')
    expect(text).toContain('2026-07')
  })

  it('rejects a month it cannot parse, showing the shape it wants', async () => {
    const { path } = await seededDocument()
    await expect(monthSummaryTool.run({ path, month: 'August' }, NO_CLIENT)).rejects.toThrow(/YYYY-MM/)
  })
})

describe('year_summary', () => {
  it('reports a year, and reports missing payslips as an absence rather than a zero', async () => {
    const { path } = await seededDocument()
    const text = await yearSummaryTool.run({ path, year: 2026 }, NO_CLIENT)

    expect(text).toContain('# 2026')
    expect(text).toContain('₪1,279.64')
    expect(text).toContain('No paychecks were entered for 2026')
    expect(text).toContain('That is an absence, not a zero')
  })

  it('draws a month with no data as nothing, never as a zero', async () => {
    const { path } = await seededDocument()
    const text = await yearSummaryTool.run({ path, year: 2026 }, NO_CLIENT)

    expect(text).toContain('| 2026-01 | — | — | — | — | — |')
  })
})

describe('fixed_expenses', () => {
  it('shows the whole charge and the monthly share beside it', async () => {
    const { path } = await seededDocument()
    const text = await fixedExpensesTool.run({ path }, NO_CLIENT)

    expect(text).toContain('Car insurance')
    // ₪3,600 a year is ₪300 a month, and only the second is safe to add up.
    expect(text).toContain('₪3,600.00')
    expect(text).toContain('₪300.00')
    expect(text).toContain('Plugin Groceries')
  })

  it('says so when there are none', async () => {
    const path = await emptyDocument()
    expect(await fixedExpensesTool.run({ path }, NO_CLIENT)).toContain('No active bills')
  })
})

describe('debts', () => {
  it('reports the balance and why there is no payoff date yet', async () => {
    const { path } = await seededDocument()
    const text = await debtsTool.run({ path }, NO_CLIENT)

    expect(text).toContain('Car loan')
    expect(text).toContain('₪50,000.00')
    // No payments at all, so the projection has to explain itself.
    expect(text).toMatch(/no projection|beyond the horizon|2\d{3}-\d{2}/)
  })

  it('says so when there are none', async () => {
    const path = await emptyDocument()
    expect(await debtsTool.run({ path }, NO_CLIENT)).toBe('This document has no debts.')
  })
})

describe('savings', () => {
  it('splits a goal balance into the four ways money got there', async () => {
    const { path } = await seededDocument()
    const text = await savingsTool.run({ path }, NO_CLIENT)

    expect(text).toContain('Emergency fund')
    expect(text).toContain('₪12,000.00')
    expect(text).toContain('Bank savings')
    expect(text).toContain('Liquid')
  })

  it('says so when there is nothing saved', async () => {
    const path = await emptyDocument()
    expect(await savingsTool.run({ path }, NO_CLIENT)).toContain('no goals or holdings')
  })
})

describe('the gate guards every tool, not just the first one', () => {
  it('refuses an older document from any of them', async () => {
    // The point of routing every tool through `readDocument`: tier 1 could not
    // have added eight ways to skip the schema check even carelessly.
    const db = await createDatabase(19)
    const path = await save(db, 'old.emd')

    for (const tool of [
      documentInfoTool,
      categoryTreeTool,
      uncategorizedMerchantsTool,
      transactionsTool,
      monthSummaryTool,
      yearSummaryTool,
      fixedExpensesTool,
      debtsTool,
      savingsTool,
    ]) {
      const text = await tool.run({ path }, NO_CLIENT)
      expect(text, tool.definition.name).toContain('REFUSED')
      expect(text, tool.definition.name).toContain('SCHEMA_BEHIND')
    }
  })
})

describe('every tool opens the document read-only', () => {
  it('refuses a write through a repository function', async () => {
    // `PRAGMA query_only` is enforced by SQLite, so this fails in the engine
    // rather than in a check somebody could forget to write. Proven through a
    // repository call, which is the only way a tool could ever write by
    // accident — and, conveniently, needs no SQL to demonstrate.
    const { openDocument } = await import('../document.ts')
    const { path } = await seededDocument()
    const opened = await openDocument(path)

    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    expect(() =>
      createAccount(opened.value.db, { name: 'Should not exist', kind: 'BANK' }, 1),
    ).toThrow(/readonly/)

    opened.value.db.close()
  })
})
