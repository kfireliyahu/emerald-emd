import { describe, expect, it } from 'vitest'

import { localDate } from '@/core/time.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { accountBalances } from './accountBalanceRepository.ts'
import {
  createAccount,
  deleteAccount,
  findAccountById,
  listAccounts,
  mergeAccounts,
  setAccountKind,
} from './accountRepository.ts'
import {
  addDeposit,
  cashHoldingOf,
  createGoal,
  createHolding,
  createHoldingPlace,
  documentMoneyMap,
  findHoldingPlace,
  listHoldings,
  PlaceAccountError,
  savingsSummary,
  setPlaceAccount,
} from './savingsRepository.ts'

const NOW = 1_755_000_000_000

/**
 * M30 U1 (D-354): a place names an account, the account has its own cash
 * holding, and an account can be one that holds things.
 */
describe('a place names an account', () => {
  async function setUp() {
    const db = await createLedgerDatabase()
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, NOW)
    const card = createAccount(db, { name: 'Visa', kind: 'CREDIT_CARD', last4: '1234' }, NOW)
    const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, NOW)
    const deposit = createHoldingPlace(db, { name: 'A deposit', kind: 'DEPOSIT' }, NOW)
    return { db, broker, bank, card, place, deposit }
  }

  it('stores an account with holdings as a kind of its own, HOLDINGS (M36 U09)', async () => {
    const { db, broker, bank } = await setUp()
    expect(findAccountById(db, broker.id)?.kind).toBe('HOLDINGS')
    const stored = db.exec(`SELECT kind FROM fmt_account WHERE id = '${broker.id}'`)[0]?.values[0]
    expect(stored).toEqual(['HOLDINGS'])

    setAccountKind(db, bank.id, 'HOLDINGS', NOW)
    expect(findAccountById(db, bank.id)?.kind).toBe('HOLDINGS')
    setAccountKind(db, bank.id, 'BANK', NOW)
    expect(findAccountById(db, bank.id)?.kind).toBe('BANK')
  })

  it('is not money in the bank', async () => {
    const { db, broker } = await setUp()
    const shown = accountBalances(db, 'ILS').map((row) => row.accountId)
    expect(shown).not.toContain(broker.id)
  })

  it('makes the account its own cash holding with the link', async () => {
    const { db, broker, place } = await setUp()
    const link = setPlaceAccount(db, place.id, broker.id, NOW)

    expect(findHoldingPlace(db, place.id)?.accountId).toBe(broker.id)
    expect(link.createdCash).toBe(true)
    expect(link.cashHolding).toMatchObject({ name: 'Cash', kind: 'CASH', isLiquid: true, accountId: broker.id })
    expect(cashHoldingOf(db, broker.id)?.id).toBe(link.cashHolding?.id)

    // Again, the same account: nothing new.
    const again = setPlaceAccount(db, place.id, broker.id, NOW)
    expect(again.createdCash).toBe(false)
    expect(listHoldings(db, { placeId: place.id })).toHaveLength(1)
  })

  it('can take a holding already there as the cash, rather than a second one', async () => {
    const { db, bank, place } = await setUp()
    const current = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Current account', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const link = setPlaceAccount(db, place.id, bank.id, NOW, { cashHoldingId: current.id })
    expect(link.createdCash).toBe(false)
    expect(cashHoldingOf(db, bank.id)?.id).toBe(current.id)
    expect(listHoldings(db, { placeId: place.id })).toHaveLength(1)
  })

  it('moves to another account only by naming none first, and may then take over the cash the first one had', async () => {
    const { db, broker, bank, place } = await setUp()
    const cash = setPlaceAccount(db, place.id, broker.id, NOW).cashHolding
    // M30 F2: re-pointing in one step would take the place and its cash from the broker without a word.
    expect(() => setPlaceAccount(db, place.id, bank.id, NOW, { cashHoldingId: cash?.id })).toThrow(
      /Broker place names Broker\. Set it to name no account first/,
    )
    setPlaceAccount(db, place.id, undefined, NOW)
    const moved = setPlaceAccount(db, place.id, bank.id, NOW, { cashHoldingId: cash?.id })
    expect(moved.createdCash).toBe(false)
    expect(cashHoldingOf(db, bank.id)?.id).toBe(cash?.id)
    expect(cashHoldingOf(db, broker.id)).toBeUndefined()
  })

  it('refuses a card, an account another place names, and a holding from elsewhere', async () => {
    const { db, card, broker, place, deposit } = await setUp()
    expect(() => setPlaceAccount(db, place.id, card.id, NOW)).toThrow(PlaceAccountError)

    setPlaceAccount(db, place.id, broker.id, NOW)
    expect(() => setPlaceAccount(db, deposit.id, broker.id, NOW)).toThrow(/already named by Broker place/)

    const elsewhere = createHolding(
      db,
      { holdingPlaceId: deposit.id, name: 'Term', kind: 'DEPOSIT', provenance: 'TRANSCRIBED', isLiquid: false },
      NOW,
    )
    expect(() =>
      setPlaceAccount(db, place.id, broker.id, NOW, { cashHoldingId: elsewhere.id }),
    ).toThrow(/not in Broker place/)
  })

  it('unlinks, keeping the place and the holding with what is in it', async () => {
    const { db, broker, place } = await setUp()
    const cash = setPlaceAccount(db, place.id, broker.id, NOW).cashHolding
    const goal = createGoal(db, { name: 'House', kind: 'EARMARKED', defaultHoldingId: cash?.id }, NOW)
    addDeposit(
      db,
      { goalId: goal.id, holdingId: cash?.id ?? '', date: localDate(2026, 9, 1), amount: { minor: 5000, currency: 'ILS' } },
      NOW,
    )

    setPlaceAccount(db, place.id, undefined, NOW)
    expect(findHoldingPlace(db, place.id)?.accountId).toBeUndefined()
    expect(cashHoldingOf(db, broker.id)).toBeUndefined()
    expect(listHoldings(db, { placeId: place.id }).map((held) => held.name)).toEqual(['Cash'])
  })

  it('follows the account through a merge and lets go of it on a delete', async () => {
    const { db, place, deposit } = await setUp()
    const one = createAccount(db, { name: 'Savings A', kind: 'HOLDINGS' }, NOW)
    const two = createAccount(db, { name: 'Savings B', kind: 'HOLDINGS' }, NOW)
    setPlaceAccount(db, place.id, one.id, NOW)
    mergeAccounts(db, one.id, two.id, NOW)
    expect(findHoldingPlace(db, place.id)?.accountId).toBe(two.id)
    expect(cashHoldingOf(db, two.id)).toBeDefined()

    const three = createAccount(db, { name: 'Savings C', kind: 'HOLDINGS' }, NOW)
    setPlaceAccount(db, deposit.id, three.id, NOW)
    deleteAccount(db, three.id, NOW)
    expect(findHoldingPlace(db, deposit.id)?.accountId).toBeUndefined()
    expect(listHoldings(db, { placeId: deposit.id })).toHaveLength(1)
    expect(listAccounts(db).some((account) => account.id === three.id)).toBe(false)
  })

  it('moves no figure: a link and its empty cash holding change no total', async () => {
    const { db, broker, place } = await setUp()
    const before = savingsSummary(db, localDate(2026, 10, 4), 'ILS')
    const mapBefore = documentMoneyMap(db, 'ILS')
    setPlaceAccount(db, place.id, broker.id, NOW)
    const after = savingsSummary(db, localDate(2026, 10, 4), 'ILS')
    expect(after.liquidity).toEqual(before.liquidity)
    expect(after.inGoals).toEqual(before.inGoals)
    expect(documentMoneyMap(db, 'ILS').liquidity).toEqual(mapBefore.liquidity)
  })
})
