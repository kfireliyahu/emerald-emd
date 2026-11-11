import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { heldBackOf } from '@/ui/heldBack.ts'

import { createAccount } from './accountRepository.ts'
import { setCategoryManually } from './categoryRepository.ts'
import { saveFormat } from './formatRepository.ts'
import { holdsPaycheck, ledgerHolds } from './railRepository.ts'

type Db = Awaited<ReturnType<typeof createLedgerDatabase>>

function charge(db: Db, accountId: string, id: string, month: number): void {
  insertTransaction(
    db,
    {
      id,
      accountId,
      transactionDate: localDate(2026, month, 3),
      chargeDate: localDate(2026, month, 3),
      billingPeriod: { year: 2026, month },
      amount: fromMajorUnits(-42.05, 'ILS'),
      direction: 'OUTFLOW',
      merchantRaw: 'Corner shop',
      merchantNormalized: 'CORNER SHOP',
      providerCategory: undefined,
      cardLast4: undefined,
      reference: undefined,
      note: undefined,
      installment: undefined,
      foreign: undefined,
      naturalKey: `key-${id}`,
      importSessionId: undefined,
      sourceRowRef: undefined,
    },
    1,
  )
}

/**
 * **A new ledger document holds back what it has nothing in** — M59 U6 (D-582,
 * the picks D-577 settled), and each place comes back with its first row.
 */
describe('the places a ledger document holds back', () => {
  it('holds back everything but the three workflows’ places in a new document', async () => {
    const db = await createLedgerDatabase()
    expect(ledgerHolds(db)).toEqual({ severalMonths: false, paycheck: false, plan: false, wealth: false, dashboard: false })
    expect(holdsPaycheck(db)).toBe(false)
    expect([...heldBackOf(db)].sort()).toEqual(
      ['/agenda', '/connections', '/dashboard', '/formats', '/paychecks', '/plan', '/wealth', '/year'].sort(),
    )
    db.close()
  })

  it('brings Year back with a second month, and Plan with a month left with nothing uncategorized', async () => {
    const db = await createLedgerDatabase()
    const card = createAccount(db, { name: 'Card', kind: 'CREDIT_CARD' }, 1)
    charge(db, card.id, 'a', 7)
    expect(ledgerHolds(db).severalMonths).toBe(false)
    expect(ledgerHolds(db).plan).toBe(false)
    charge(db, card.id, 'b', 8)
    expect(ledgerHolds(db).severalMonths).toBe(true)
    expect(heldBackOf(db).has('/year')).toBe(false)

    setCategoryManually(db, 'a', 'cat:groceries', 2)
    expect(ledgerHolds(db).plan).toBe(true)
    expect(heldBackOf(db).has('/plan')).toBe(false)
    // A transaction is no wealth: an opening balance is.
    expect(ledgerHolds(db).wealth).toBe(false)
    db.run("UPDATE fmt_account SET opening_balance_minor = 0, opening_balance_currency = 'ILS', opening_date = '2026-07-01'")
    expect(ledgerHolds(db).wealth).toBe(true)
    db.close()
  })

  it('brings Formats, Connections and Agenda back with a format of the person’s own', async () => {
    const db = await createLedgerDatabase()
    const trip = (columns: FormatDeclaration['columns']): FormatDeclaration => ({
      language: 1,
      name: 'trip',
      title: 'Trip',
      notes: '',
      columns,
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    })
    saveFormat(db, trip([column('name', 'text', { required: true })]), 1)
    let held = heldBackOf(db)
    expect(held.has('/formats') || held.has('/connections')).toBe(false)
    expect(held.has('/agenda')).toBe(true)
    saveFormat(db, trip([column('name', 'text', { required: true }), column('day', 'date')]), 2)
    held = heldBackOf(db)
    expect(held.has('/agenda')).toBe(false)
    db.close()
  })
})
