import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { bringUpToDate } from '@/data/packs/packs.ts'
import {
  createAccount,
  deleteAccount,
  ensureOwnCash,
  mergeAccounts,
  resolveAccountForImport,
  setAccountArchived,
  setAccountKind,
} from './accountRepository.ts'
import { cushionReading, setCushionAccounts } from './cushionRepository.ts'
import { createSession, setBalanceCheck, setSessionStatus } from './importSessionRepository.ts'
import { netWorth } from './netWorthRepository.ts'
import { recordHoldingReading } from './holdingReadingRepository.ts'
import { homeSummary } from './homeRepository.ts'
import {
  accountWhereId,
  addDeposit,
  cashHoldingOf,
  createGoal,
  createHolding,
  createHoldingPlace,
  documentMoneyMap,
  findHoldingPlace,
  listHoldingPlaces,
  listHoldings,
  placeAccountProblem,
  savingsSummary,
  setPlaceAccount,
  staleHoldings,
} from './savingsRepository.ts'
import { insertTransactions } from './transactionRepository.ts'

const NOW = 1_755_000_000_000
const AS_OF = localDate(2026, 10, 5)
const ils = (minor: number) => money(minor, 'ILS')

/** The places that name an account, as `[place, kind, account]`, and each account's cash. */
function owned(db: Database) {
  return listHoldingPlaces(db, { includeArchived: true })
    .filter((place) => place.accountId !== undefined)
    .map((place) => [place.name, place.kind, place.accountId, cashHoldingOf(db, place.accountId ?? '')?.name])
}

/**
 * M30 F2, as reported: the Everyday Bank "was generated when i was adding the excels at
 * the start. it doesn't have a cash holding and it doesn't seem like i can add
 * it." An account's cash existed only through a place, and only a broker
 * statement made one.
 */
describe('every bank account and cash has its place and its own cash', () => {
  it('is made with a bank account or cash, and not with a card or an account with holdings', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    const wallet = createAccount(db, { name: 'Wallet', kind: 'CASH' }, NOW)
    createAccount(db, { name: 'Visa', kind: 'CREDIT_CARD', last4: '1234' }, NOW)
    createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)

    expect(owned(db)).toEqual([
      ['Everyday Bank', 'CHECKING', bank.id, 'Cash'],
      ['Wallet', 'CASH', wallet.id, 'Cash'],
    ])
    expect(cashHoldingOf(db, bank.id)).toMatchObject({ kind: 'CASH', isLiquid: true, provenance: 'RECORDED' })
  })

  it('is made when an import makes the account', async () => {
    const db = await createLedgerDatabase()
    const account = resolveAccountForImport(
      db,
      { boundAccountId: undefined, last4: undefined, fallbackName: 'Everyday Bank', kind: 'BANK' },
      NOW,
    )
    expect(owned(db)).toEqual([['Everyday Bank', 'CHECKING', account.id, 'Cash']])
  })

  it('is in no place: the account is its own row, and no place is made for it (M36 U08)', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)

    expect(db.exec('SELECT COUNT(*) FROM fmt_holding_place')[0]?.values).toEqual([[0]])
    expect(cashHoldingOf(db, bank.id)?.holdingPlaceId).toBe(accountWhereId(bank.id))
    expect(findHoldingPlace(db, accountWhereId(bank.id))).toMatchObject({ name: 'Everyday Bank', kind: 'CHECKING', accountId: bank.id })
    // Made once: a second ask writes nothing.
    expect(ensureOwnCash(db, bank.id)).toBe(false)
    expect(listHoldings(db, { includeArchived: true })).toHaveLength(1)
  })

  it('an account with holdings takes a holding by hand before any statement, in a place that is its own (M36 U11)', async () => {
    const db = await createLedgerDatabase()
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    expect(owned(db)).toEqual([])

    createHolding(db, { holdingPlaceId: accountWhereId(broker.id), name: 'Index fund', kind: 'SECURITY', provenance: 'RECORDED', isLiquid: true }, NOW)

    // One place, the account's: its cash is there as a statement would put it, so the account stays one row.
    expect(owned(db)).toEqual([['Broker', 'INVESTMENT', broker.id, 'Cash']])
    const place = listHoldingPlaces(db, { includeArchived: true })
    expect(place).toHaveLength(1)
    expect(listHoldings(db, { placeId: place[0]?.id ?? '' }).map((held) => held.name).sort()).toEqual(['Cash', 'Index fund'])
    expect(documentMoneyMap(db, 'ILS').places.filter((row) => row.place?.accountId === undefined)).toEqual([])
  })

  it('is not given on open: an account an older build wrote without one stays so (D-385)', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    db.run('DELETE FROM fmt_holding')

    expect(bringUpToDate(db, NOW)).toEqual({ ok: true, value: { changed: 0 } })
    expect(cashHoldingOf(db, bank.id)).toBeUndefined()
  })

  it('is made by every path that makes a bank account or cash: the screens, an import, a merge', async () => {
    const db = await createLedgerDatabase()
    // The Accounts screen and Net worth's Add an account both call createAccount.
    const bank = createAccount(db, { name: 'Bank', kind: 'BANK' }, NOW)
    const wallet = createAccount(db, { name: 'Wallet', kind: 'CASH' }, NOW)
    // A statement import, by a bound account, a card number or a name.
    const imported = resolveAccountForImport(
      db,
      { boundAccountId: undefined, last4: '4321', fallbackName: 'Second bank', kind: 'BANK' },
      NOW,
    )
    const again = createAccount(db, { name: 'Second bank, again', kind: 'BANK' }, NOW)
    mergeAccounts(db, again.id, imported.id, NOW)
    for (const account of [bank, wallet, imported]) {
      expect(cashHoldingOf(db, account.id)).toMatchObject({ name: 'Cash', kind: 'CASH' })
    }
    expect(listHoldings(db, { includeArchived: true })).toHaveLength(3)
  })

  it('keeps an older document’s place the account’s, because the account’s cash is in it', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    // What M30 F2 wrote: a place named as the account, with its cash in it.
    const old = createHoldingPlace(db, { name: 'Everyday Bank', kind: 'CHECKING' }, NOW)
    db.run('UPDATE fmt_holding SET holding_place = ? WHERE account = ?', [old.id, bank.id])

    expect(owned(db)).toEqual([['Everyday Bank', 'CHECKING', bank.id, 'Cash']])
    expect(findHoldingPlace(db, old.id)?.accountId).toBe(bank.id)
    expect(cashHoldingOf(db, bank.id)?.holdingPlaceId).toBe(old.id)
  })

  it('is kept while an account is archived, and is made when a card becomes a bank account', async () => {
    const db = await createLedgerDatabase()
    const card = createAccount(db, { name: 'Was a card', kind: 'CREDIT_CARD' }, NOW)
    const bank = createAccount(db, { name: 'Old bank', kind: 'BANK' }, NOW)
    const cash = cashHoldingOf(db, bank.id)?.id
    setAccountArchived(db, bank.id, true, NOW)
    setAccountArchived(db, bank.id, false, NOW)
    expect(cashHoldingOf(db, bank.id)?.id).toBe(cash)
    setAccountKind(db, card.id, 'BANK', NOW)
    expect(cashHoldingOf(db, card.id)).toBeDefined()
  })

  it('moves to a place the person names it from, while its own place holds nothing, and refuses once it does', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    const elsewhere = createHoldingPlace(db, { name: 'Everyday Bank branch', kind: 'CHECKING' }, NOW)

    setPlaceAccount(db, elsewhere.id, bank.id, NOW)
    // The account's own row is gone: its cash is in the place now.
    expect(findHoldingPlace(db, accountWhereId(bank.id))).toBeUndefined()
    expect(cashHoldingOf(db, bank.id)?.holdingPlaceId).toBe(elsewhere.id)

    // Once a goal's money is in it, the account's place is not bare, and naming it elsewhere is refused.
    const goal = createGoal(db, { name: 'Trip', kind: 'EARMARKED' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: cashHoldingOf(db, bank.id)?.id ?? '', date: AS_OF, amount: ils(100_00) }, NOW)
    const third = createHoldingPlace(db, { name: 'Another', kind: 'CHECKING' }, NOW)
    expect(placeAccountProblem(db, third.id, bank.id)).toMatch(/already named by Everyday Bank branch/)
  })

  it('refuses re-pointing a place from one account to another in one step — the broker trap', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const brokerPlace = createHoldingPlace(db, { name: 'Broker', kind: 'INVESTMENT' }, NOW)
    setPlaceAccount(db, brokerPlace.id, broker.id, NOW)

    expect(placeAccountProblem(db, brokerPlace.id, bank.id)).toMatch(
      /^Broker names Broker\. Set it to name no account first, then name Everyday Bank/,
    )
    expect(findHoldingPlace(db, brokerPlace.id)?.accountId).toBe(broker.id)
  })
})

/** A bank account whose one verified statement ends at `closing`. */
function withStatement(db: Database, accountId: string, closing: number): void {
  const session = `s-${accountId}`
  insertTransactions(
    db,
    [
      {
        id: `t-${accountId}`,
        accountId,
        transactionDate: localDate(2026, 9, 30),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: ils(-100),
        direction: 'OUTFLOW',
        merchantRaw: 'x',
        merchantNormalized: 'x',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: `t-${accountId}`,
        importSessionId: session,
        sourceRowRef: undefined,
      },
    ],
    1,
  )
  createSession(db, { id: session, accountId, mappingId: undefined, fileName: 'everyday.xlsx', fileHash: session, sheetName: undefined }, 1)
  setBalanceCheck(
    db,
    session,
    { kind: 'VERIFIED', order: 'OLDEST_FIRST', openingBalance: ils(closing + 100), closingBalance: ils(closing), rowCount: 1 },
    1,
  )
  setSessionStatus(db, session, 'COMMITTED', 2)
}

/**
 * M30 F1 found it, and F2 makes it common: a goal's money in a bank account's
 * own cash is inside the statement balance, and Overview added it again on top.
 */
describe('money in a bank account’s own cash is counted once', () => {
  it('leaves In the bank and Net worth at the statement balance after a 5,000 deposit there', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    withStatement(db, bank.id, 20_000_00)
    const cash = cashHoldingOf(db, bank.id)
    const goal = createGoal(db, { name: 'Car', kind: 'EARMARKED', defaultHoldingId: cash?.id }, NOW)
    addDeposit(
      db,
      { goalId: goal.id, holdingId: cash?.id ?? '', date: localDate(2026, 9, 1), amount: ils(5_000_00), sourceKind: 'FROM_TRANSACTION' },
      NOW,
    )

    // The one net worth, which Overview draws: In the bank is the statement, once.
    const read = netWorth(db, AS_OF, 'ILS')
    expect(read.inBank.minor).toBe(20_000_00)
    expect(read.worth.minor).toBe(20_000_00)

    // The cushion's split reads the same money as the goal's part of that balance (D-360).
    setCushionAccounts(db, [{ accountId: bank.id, counts: true }], NOW)
    const split = cushionReading(db, AS_OF, 'ILS').split
    expect(split.parts.map((part) => part.amount.minor)).toEqual([5_000_00])
  })

  it('is not taken off twice when it was only set aside', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    withStatement(db, bank.id, 20_000_00)
    const goal = createGoal(db, { name: 'Car', kind: 'EARMARKED' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: cashHoldingOf(db, bank.id)?.id ?? '', date: localDate(2026, 9, 1), amount: ils(3_000_00), sourceKind: 'MANUAL' }, NOW)

    const read = netWorth(db, AS_OF, 'ILS')
    expect([read.inBank, read.held, read.locked]).toEqual([ils(20_000_00), ils(0), ils(0)])
  })

  it('still counts it on top while the account has no statement balance to be inside', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    const goal = createGoal(db, { name: 'Car', kind: 'EARMARKED' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: cashHoldingOf(db, bank.id)?.id ?? '', date: localDate(2026, 9, 1), amount: ils(5_000_00), sourceKind: 'FROM_TRANSACTION' }, NOW)

    expect(netWorth(db, AS_OF, 'ILS').inBank).toEqual(ils(5_000_00))
  })
})

describe('an account’s own place goes with it (M30 F5)', () => {
  it('is removed when the account is deleted, while it holds nothing', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Spare', kind: 'BANK' }, NOW)
    expect(owned(db)).toHaveLength(1)
    deleteAccount(db, bank.id, NOW)
    expect(listHoldingPlaces(db, { includeArchived: true })).toHaveLength(0)
    expect(listHoldings(db, { includeArchived: true })).toHaveLength(0)
  })

  it('stays, naming nothing, when money went into it', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Spare', kind: 'BANK' }, NOW)
    const goal = createGoal(db, { name: 'Trip', kind: 'EARMARKED' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: cashHoldingOf(db, bank.id)?.id ?? '', date: AS_OF, amount: ils(100_00) }, NOW)
    deleteAccount(db, bank.id, NOW)
    expect(listHoldingPlaces(db, { includeArchived: true }).map((place) => [place.name, place.accountId])).toEqual([['Spare', undefined]])
  })

  it('is removed on a merge, and the survivor keeps its own', async () => {
    const db = await createLedgerDatabase()
    const one = createAccount(db, { name: 'Old bank', kind: 'BANK' }, NOW)
    const two = createAccount(db, { name: 'New bank', kind: 'BANK' }, NOW)
    mergeAccounts(db, one.id, two.id, NOW)
    expect(owned(db)).toEqual([['New bank', 'CHECKING', two.id, 'Cash']])
  })

  it('carries its money to the survivor when the survivor had no cash of its own', async () => {
    const db = await createLedgerDatabase()
    const one = createAccount(db, { name: 'Old bank', kind: 'BANK' }, NOW)
    const two = createAccount(db, { name: 'New bank', kind: 'BANK' }, NOW)
    // The survivor's own cash is gone (removed by hand), the source's holds a goal's money.
    db.run('DELETE FROM fmt_holding WHERE account = ?', [two.id])
    const goal = createGoal(db, { name: 'Trip', kind: 'EARMARKED' }, NOW)
    const held = cashHoldingOf(db, one.id)?.id ?? ''
    addDeposit(db, { goalId: goal.id, holdingId: held, date: AS_OF, amount: ils(100_00) }, NOW)
    mergeAccounts(db, one.id, two.id, NOW)
    expect(owned(db)).toEqual([['New bank', 'CHECKING', two.id, 'Cash']])
    expect(cashHoldingOf(db, two.id)?.id).toBe(held)
  })

  it('keeps an older document’s place with money in it when the survivor has cash of its own', async () => {
    const db = await createLedgerDatabase()
    const one = createAccount(db, { name: 'Old bank', kind: 'BANK' }, NOW)
    const two = createAccount(db, { name: 'New bank', kind: 'BANK' }, NOW)
    const goal = createGoal(db, { name: 'Trip', kind: 'EARMARKED' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: cashHoldingOf(db, one.id)?.id ?? '', date: AS_OF, amount: ils(100_00) }, NOW)
    mergeAccounts(db, one.id, two.id, NOW)
    // The source's cash had money: it stays, in a place named as the source, naming nobody.
    expect(listHoldingPlaces(db, { includeArchived: true }).map((place) => [place.name, place.accountId])).toEqual([
      ['New bank', two.id],
      ['Old bank', undefined],
    ])
  })
})

/**
 * M30 F6: Overview's net worth left out a locked holding that is not a fund — a
 * fixed deposit — while Home's net worth and the savings tool counted it.
 */
describe('net worth counts a locked holding that is not a fund', () => {
  /** Overview's figures, Home's net worth and the savings tool's locked line, on one day. */
  function figures(db: Database) {
    const overview = netWorth(db, AS_OF, 'ILS')
    return {
      inBank: overview.inBank.minor,
      overview: overview.worth.minor,
      home: homeSummary(db, AS_OF, 'ILS').netWorth.worth.minor,
      locked: savingsSummary(db, AS_OF, 'ILS').liquidity.locked.minor,
    }
  }

  it('adds a 10,000 fixed deposit once, on Overview, Home and in the savings tool, and its reading once it has one', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    withStatement(db, bank.id, 20_000_00)
    const before = figures(db)
    expect(before.overview).toBe(20_000_00)

    const placeId = cashHoldingOf(db, bank.id)?.holdingPlaceId ?? ''
    const fixed = createHolding(db, { holdingPlaceId: placeId, name: 'Fixed deposit', kind: 'DEPOSIT', provenance: 'TRANSCRIBED', isLiquid: false }, NOW)
    const goal = createGoal(db, { name: 'Later', kind: 'LONG_TERM', defaultHoldingId: fixed.id }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: fixed.id, date: localDate(2026, 9, 1), amount: ils(10_000_00), sourceKind: 'FROM_TRANSACTION' }, NOW)

    const after = figures(db)
    expect(after.overview - before.overview).toBe(10_000_00)
    expect(after.home - before.home).toBe(10_000_00)
    expect(after.locked - before.locked).toBe(10_000_00)
    // Locked is not in the bank: the statement is all of that.
    expect(after.inBank).toBe(20_000_00)
    expect(netWorth(db, AS_OF, 'ILS').locked).toEqual(ils(10_000_00))

    // A reading replaces the deposits, and is still counted once (D-365).
    recordHoldingReading(db, { holdingId: fixed.id, asOf: localDate(2026, 9, 30), value: ils(10_300_00) }, {}, NOW)
    const read = figures(db)
    expect(read.overview).toBe(30_300_00)
    expect(read.home - before.home).toBe(10_300_00)
    expect(read.locked - before.locked).toBe(10_300_00)
  })
})

/**
 * M30 F7, as reported: "everyday says reachable x and the cash in everyday is 0.
 * aren't they supposed to be the same?" A bank account's own place adds up to
 * its statement: each goal's part, and the Cash is what no goal has taken.
 */
describe('an account’s own Cash is what no goal has taken', () => {
  async function everyday(statement: number) {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    withStatement(db, bank.id, statement)
    const cash = cashHoldingOf(db, bank.id)
    const place = () => documentMoneyMap(db, 'ILS').places.find((row) => row.place?.accountId === bank.id)
    const cashRow = () => place()?.holdings.find((row) => row.holdingId === cash?.id)
    const deposit = (name: string, minor: number) => {
      const goal = createGoal(db, { name, kind: 'EARMARKED', defaultHoldingId: cash?.id }, NOW)
      addDeposit(db, { goalId: goal.id, holdingId: cash?.id ?? '', date: localDate(2026, 9, 1), amount: ils(minor), sourceKind: 'FROM_TRANSACTION' }, NOW)
    }
    const figures = () => {
      const read = netWorth(db, AS_OF, 'ILS')
      return { inBank: read.inBank, worth: read.worth }
    }
    return { db, bank, place, cashRow, deposit, figures }
  }

  it('is the statement while no goal is saved there', async () => {
    const { place, cashRow } = await everyday(20_900_00)
    expect(place()?.balance).toEqual(ils(20_900_00))
    expect(cashRow()?.balance).toEqual(ils(20_900_00))
    expect(place()?.statement).toMatchObject({ balance: ils(20_900_00), parts: [], cash: ils(20_900_00), short: undefined })
  })

  it('is the statement less a 5,000 goal part, and In the bank, Net worth and the cushion do not move', async () => {
    const { db, place, cashRow, deposit, figures } = await everyday(20_900_00)
    const before = figures()
    deposit('Car', 5_000_00)

    expect(place()?.balance).toEqual(ils(20_900_00))
    expect(cashRow()?.balance).toEqual(ils(15_900_00))
    expect(place()?.statement?.parts.map((part) => [part.goalName, part.amount.minor])).toEqual([['Car', 5_000_00]])
    expect(figures()).toEqual(before)
    expect(figures().inBank).toEqual(ils(20_900_00))
    // The cushion is the same rest, read by the same split (D-360).
    expect(cushionReading(db, AS_OF, 'ILS').split.left).toEqual(ils(15_900_00))
  })

  it('shows parts beyond the statement as a failed check, never a negative or a clamp', async () => {
    const { place, cashRow, deposit } = await everyday(4_000_00)
    deposit('Car', 5_000_00)
    expect(place()?.statement).toMatchObject({ cash: undefined, short: ils(1_000_00) })
    expect(cashRow()?.balance.minor).toBeGreaterThanOrEqual(0)
  })

  it('adds another holding there to the place, and is not asked about on Home', async () => {
    const { db, place, cashRow, deposit } = await everyday(20_900_00)
    deposit('Car', 5_000_00)
    const fixed = createHolding(db, { holdingPlaceId: place()?.holdingPlaceId ?? '', name: 'Fixed deposit', kind: 'DEPOSIT', provenance: 'TRANSCRIBED', isLiquid: false }, NOW)
    recordHoldingReading(db, { holdingId: fixed.id, asOf: localDate(2026, 9, 30), value: ils(10_000_00) }, {}, NOW)

    expect(place()).toMatchObject({ balance: ils(30_900_00), liquid: ils(20_900_00), locked: ils(10_000_00) })
    expect(cashRow()?.balance).toEqual(ils(15_900_00))
    expect(staleHoldings(db, AS_OF, 'ILS').map((one) => one.holding.name)).toEqual([])
  })
})
