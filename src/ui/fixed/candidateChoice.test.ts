import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import {
  confirmCandidate,
  listExpenseObservations,
  listFixedExpenses,
} from '@/data/repositories/fixedExpenseRepository.ts'
import { detectFixedExpenses } from '@/domain/fixedExpenses.ts'
import { readCandidateChoice } from './candidateChoice.ts'

const ILS = 'ILS'

/** Six months of a 5,400 rent: one candidate, whose median is 5,400. */
async function rentCandidate() {
  const db = await createLedgerDatabase()
  const account = createAccount(db, { name: 'Current', kind: 'BANK' }, 1)
  for (const month of [1, 2, 3, 4, 5, 6]) {
    insertTransaction(
      db,
      {
        id: `rent-${month}`,
        accountId: account.id,
        transactionDate: localDate(2026, month, 1),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: money(-540_000, ILS),
        direction: 'OUTFLOW',
        merchantRaw: 'שכר דירה',
        merchantNormalized: 'שכר דירה',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: `rent-${month}`,
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      1,
    )
  }
  const candidate = detectFixedExpenses(
    listExpenseObservations(db, localDate(2026, 1, 1), localDate(2026, 6, 30)),
    { endingAt: { year: 2026, month: 6 }, windowMonths: 6 },
  )[0]
  if (candidate === undefined) throw new Error('the fixture stopped producing a candidate')
  return { db, candidate }
}

describe('tracking a candidate as it was left on its card (M28 F22)', () => {
  it('stores the amount the person typed, not the median it suggested', async () => {
    const { db, candidate } = await rentCandidate()
    expect(candidate.medianAmount).toEqual(money(540_000, ILS))

    // What the card hands the screen after "Change…", "5,600" and "Add it" —
    // and what Plan's onTrack writes. It used to write `undefined` here.
    const choice = readCandidateChoice('5,600', 'MONTHLY', candidate.currency)
    if (choice === undefined) throw new Error('5,600 should read as a charge')
    confirmCandidate(db, candidate, choice, 10)

    const [tracked] = listFixedExpenses(db)
    expect(tracked?.expectedAmount).toEqual(money(560_000, ILS))
    expect(tracked?.cadence).toBe('MONTHLY')
    db.close()
  })

  it('stores the cadence the person chose with it', async () => {
    const { db, candidate } = await rentCandidate()
    const choice = readCandidateChoice('16200', 'QUARTERLY', candidate.currency)
    if (choice === undefined) throw new Error('16200 should read as a charge')
    confirmCandidate(db, candidate, choice, 10)

    expect(listFixedExpenses(db)[0]).toMatchObject({
      expectedAmount: money(1_620_000, ILS),
      cadence: 'QUARTERLY',
    })
    db.close()
  })

  it('has no choice to offer when there is no charge in the text', () => {
    expect(readCandidateChoice('', 'MONTHLY', ILS)).toBeUndefined()
    expect(readCandidateChoice('abc', 'MONTHLY', ILS)).toBeUndefined()
    expect(readCandidateChoice('0', 'MONTHLY', ILS)).toBeUndefined()
    expect(readCandidateChoice('-120', 'MONTHLY', ILS)).toEqual({
      expectedAmount: money(12_000, ILS),
      cadence: 'MONTHLY',
    })
  })
})
