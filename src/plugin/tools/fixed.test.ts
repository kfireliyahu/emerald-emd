import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import {
  dismissedMerchants,
  listFixedExpenses,
} from '@/data/repositories/fixedExpenseRepository.ts'

import {
  dismissFixedExpenseCandidatesTool,
  fixedExpenseCandidatesTool,
  trackFixedExpensesTool,
} from './fixed.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { listBackups } from '../backup.ts'

/**
 * Six months of a document that has bills in it: rent to the agora every month,
 * a subscription on the same day for the same money, one lone supermarket
 * charge that is nobody's commitment, and a yearly premium only a twelve-month
 * window can see.
 *
 * The window is the point of the fixture. A detector that cannot see a cadence
 * longer than its own lookback is the one thing about this feature a
 * conversation will get wrong, so the test data makes it visible.
 */
async function fixture(): Promise<string> {
  const db = await createLedgerDatabase()
  const now = 1_700_000_000_000
  const account = createAccount(db, { name: 'Leumi current', kind: 'BANK' }, now)

  let id = 0
  const charge = (year: number, month: number, day: number, major: number, merchant: string) => {
    id += 1
    insertTransaction(
      db,
      {
        id: `tx-${String(id)}`,
        accountId: account.id,
        transactionDate: localDate(year, month, day),
        chargeDate: localDate(year, month, day),
        billingPeriod: { year, month },
        amount: fromMajorUnits(-major, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: `${merchant} bv`,
        merchantNormalized: merchant,
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: `key-${String(id)}`,
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      now,
    )
  }

  for (const month of [1, 2, 3, 4, 5, 6]) charge(2026, month, 3, 5400, 'שכר דירה')
  // A netflix-shaped subscription: same day, same money, every month.
  for (const month of [1, 2, 3, 4, 5, 6]) charge(2026, month, 17, 54.9, 'מנוי סטרימינג')
  // Once a year, in January. Invisible to a six-month window by construction.
  charge(2025, 7, 20, 4200, 'ביטוח רכב')
  charge(2026, 7, 20, 4200, 'ביטוח רכב')
  // Noise, and a deliberate discovery: two supermarket charges three months
  // apart read as a *quarterly* candidate, which is the detector working as
  // specified rather than a false positive to design around. One charge is the
  // unambiguous non-candidate — one month is a purchase, not a pattern — so
  // that is what this is, and it doubles as the merchant `track_fixed_expenses`
  // is asked to track on the user's own figures.
  charge(2026, 2, 11, 210.4, 'סופרמרקט')

  const path = join(await tempDir('emerald-fixed-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}

async function expensesIn(path: string) {
  const db = await reopen(path)
  const all = listFixedExpenses(db)
  db.close()
  return all
}


const JUNE = { ending_at: '2026-06', window_months: 6 }

describe('fixed_expense_candidates', () => {
  it('finds what repeats, with the charge and its monthly share', async () => {
    const path = await fixture()
    const text = await fixedExpenseCandidatesTool.run({ path, ...JUNE }, NO_CLIENT)

    expect(text).toContain('שכר דירה')
    expect(text).toContain('₪5,400.00')
    expect(text).toContain('MONTHLY')
    expect(text).toContain('HIGH')
    // Not a schedule and not the same money twice.
    expect(text).not.toContain('סופרמרקט')
  })

  it('cannot see a cadence longer than its window, and says so', async () => {
    // The one thing a conversation will otherwise get wrong: concluding there
    // is nothing annual after looking at three months.
    const path = await fixture()

    const short = await fixedExpenseCandidatesTool.run({ path, ...JUNE }, NO_CLIENT)
    expect(short).not.toContain('ביטוח רכב')
    expect(short).toContain('cannot see a cadence longer than itself')

    const long = await fixedExpenseCandidatesTool.run(
      { path, ending_at: '2026-07', window_months: 13 },
      NO_CLIENT,
    )
    expect(long).toContain('ביטוח רכב')
    expect(long).toContain('YEARLY')
    // The whole charge and the twelfth of it, both, because only one of them is
    // safe to add across rows.
    expect(long).toContain('₪4,200.00')
    expect(long).toContain('₪350.00')
  })

  it('refuses a window it cannot work with, by name', async () => {
    const path = await fixture()
    await expect(
      fixedExpenseCandidatesTool.run({ path, window_months: 1 }, NO_CLIENT),
    ).rejects.toThrow(/`window_months` must be between/)
  })

  it('says something useful when there is nothing to suggest', async () => {
    const path = await fixture()
    const text = await fixedExpenseCandidatesTool.run(
      { path, ending_at: '2024-06', window_months: 3 },
      NO_CLIENT,
    )
    expect(text).toContain('No candidates')
  })
})

describe('track_fixed_expenses', () => {
  it('dry-runs by default, writing nothing', async () => {
    const path = await fixture()
    const before = await readFile(path)

    const text = await trackFixedExpensesTool.run(
      { path, ...JUNE, expenses: [{ merchant: 'שכר דירה' }] },
      NO_CLIENT,
    )

    expect(text).toContain('₪5,400.00')
    expect(text).toContain('Nothing has been written')
    expect(await readFile(path)).toEqual(before)
    expect(await listBackups(path)).toEqual([])
    expect(await expensesIn(path)).toHaveLength(0)
  })

  it('tracks several in one call, taking the detector’s figures', async () => {
    const path = await fixture()
    const text = await trackFixedExpensesTool.run(
      {
        path,
        ...JUNE,
        expenses: [{ merchant: 'שכר דירה' }, { merchant: 'מנוי סטרימינג', is_discretionary: true }],
        commit: true,
      },
      NO_CLIENT,
    )

    expect(text).toContain('2 bills')
    // One copy for the batch, not one per expense.
    expect(await listBackups(path)).toHaveLength(1)

    const tracked = await expensesIn(path)
    expect(tracked).toHaveLength(2)
    const rent = tracked.find((one) => one.matchRef === 'שכר דירה')
    expect(rent?.expectedAmount).toEqual(fromMajorUnits(5400, 'ILS'))
    expect(rent?.cadence).toBe('MONTHLY')
    expect(rent?.matchKind).toBe('MERCHANT_PATTERN')
    expect(rent?.source).toBe('DETECTED_CONFIRMED')
    expect(rent?.isDiscretionary).toBe(false)
    expect(tracked.find((one) => one.matchRef === 'מנוי סטרימינג')?.isDiscretionary).toBe(true)
  })

  it('takes overrides, and keeps the amount as the whole charge', async () => {
    const path = await fixture()
    await trackFixedExpensesTool.run(
      {
        path,
        ...JUNE,
        expenses: [{ merchant: 'שכר דירה', name: 'Flat on Herzl', expected_amount: 5600 }],
        commit: true,
      },
      NO_CLIENT,
    )

    const rent = (await expensesIn(path)).find((one) => one.matchRef === 'שכר דירה')
    expect(rent?.name).toBe('Flat on Herzl')
    expect(rent?.expectedAmount).toEqual(fromMajorUnits(5600, 'ILS'))
  })

  it('confirming the same merchant twice updates rather than twins it', async () => {
    // One of F09's acceptance criteria, and the retry an LLM caller will
    // eventually make.
    const path = await fixture()
    const once = { path, ...JUNE, expenses: [{ merchant: 'שכר דירה' }], commit: true }

    await trackFixedExpensesTool.run(once, NO_CLIENT)
    expect(await expensesIn(path)).toHaveLength(1)

    // The second call cannot find it as a *candidate* any more — it is tracked
    // now, so the detector excludes it — which is the case that has to say
    // something the user can act on.
    const again = await trackFixedExpensesTool.run(once, NO_CLIENT)
    expect(again).toContain('already tracked')
    expect(await expensesIn(path)).toHaveLength(1)
  })

  it('tracks a commitment the ledger has never seen, matched by nothing', async () => {
    // `MANUAL_ONLY` is a real answer rather than a fallback: an annual premium
    // paid by standing order elsewhere is still a number the user plans against.
    const path = await fixture()
    await trackFixedExpensesTool.run(
      {
        path,
        expenses: [{ name: 'Car insurance', expected_amount: 4200, cadence: 'YEARLY' }],
        commit: true,
      },
      NO_CLIENT,
    )

    const made = (await expensesIn(path)).find((one) => one.name === 'Car insurance')
    expect(made?.matchKind).toBe('MANUAL_ONLY')
    expect(made?.matchRef).toBeUndefined()
    expect(made?.cadence).toBe('YEARLY')
    expect(made?.expectedAmount).toEqual(fromMajorUnits(4200, 'ILS'))
  })

  it('refuses one entry without losing the rest of the batch', async () => {
    const path = await fixture()
    const text = await trackFixedExpensesTool.run(
      {
        path,
        ...JUNE,
        expenses: [
          { merchant: 'שכר דירה' },
          { merchant: 'סופרמרקט' },
          { merchant: 'לא קיים', category_id: 'nope' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )

    expect(text).toContain('Refused')
    expect(text).toContain('not a candidate in this window')
    expect(text).toContain('no category with id nope')
    expect(await expensesIn(path)).toHaveLength(1)
  })

  it('tracks a merchant the detector missed when given an amount', async () => {
    const path = await fixture()
    await trackFixedExpensesTool.run(
      {
        path,
        ...JUNE,
        expenses: [{ merchant: 'סופרמרקט', expected_amount: 150, name: 'Weekly shop' }],
        commit: true,
      },
      NO_CLIENT,
    )

    const made = (await expensesIn(path)).find((one) => one.name === 'Weekly shop')
    expect(made?.matchKind).toBe('MERCHANT_PATTERN')
    expect(made?.matchRef).toBe('סופרמרקט')
    // Not the detector's word, so not labelled as the detector's.
    expect(made?.source).toBe('USER_DEFINED')
  })

  it('names a bad argument rather than half-applying the batch', async () => {
    const path = await fixture()
    await expect(
      trackFixedExpensesTool.run(
        { path, expenses: [{ name: 'No amount' }], commit: true },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/no `expected_amount`/)
    await expect(
      trackFixedExpensesTool.run(
        { path, expenses: [{ merchant: 'x', cadence: 'WEEKLY' }], commit: true },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/must be one of/)
    await expect(
      trackFixedExpensesTool.run(
        { path, expenses: [{ name: 'Rebate', expected_amount: -20 }], commit: true },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/must be positive/)

    expect(await expensesIn(path)).toHaveLength(0)
  })
})

describe('dismiss_fixed_expense_candidates', () => {
  it('stops a merchant being suggested again, and takes it back', async () => {
    const path = await fixture()

    const said = await dismissFixedExpenseCandidatesTool.run(
      { path, merchants: ['מנוי סטרימינג'] },
      NO_CLIENT,
    )
    expect(said).toContain('Dismissed 1 merchant')
    // No dry run and no copy: it touches one setting and no row.
    expect(await listBackups(path)).toEqual([])

    const db = await reopen(path)
    expect(dismissedMerchants(db)).toEqual(['מנוי סטרימינג'])
    db.close()

    const after = await fixedExpenseCandidatesTool.run({ path, ...JUNE }, NO_CLIENT)
    expect(after).not.toContain('מנוי סטרימינג')
    expect(after).toContain('were dismissed')

    const listed = await fixedExpenseCandidatesTool.run(
      { path, ...JUNE, include_dismissed: true },
      NO_CLIENT,
    )
    expect(listed).toContain('מנוי סטרימינג')

    const restored = await dismissFixedExpenseCandidatesTool.run(
      { path, merchants: ['מנוי סטרימינג'], restore: true },
      NO_CLIENT,
    )
    expect(restored).toContain('Cleared 1 dismissal')

    const back = await fixedExpenseCandidatesTool.run({ path, ...JUNE }, NO_CLIENT)
    expect(back).toContain('מנוי סטרימינג')
  })

  it('says so rather than pretending, when there was nothing to change', async () => {
    const path = await fixture()
    const text = await dismissFixedExpenseCandidatesTool.run(
      { path, merchants: ['never dismissed'], restore: true },
      NO_CLIENT,
    )
    expect(text).toContain('nothing to clear')
  })
})
