import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createAccount } from '../repositories/accountRepository.ts'
import {
  countTransactions,
  listTransactions,
} from '../repositories/transactionRepository.ts'
import {
  createDatabase,
  exportDatabase,
  inTransaction,
  migrate,
  openDatabase,
  openDatabaseWithoutMigrating,
  query,
  readSchemaVersion,
  SCHEMA_VERSION,
  SchemaTooNewError,
} from './database.ts'

async function seeded() {
  const db = await createLedgerDatabase()
  const account = createAccount(db, { name: 'Card 1234', kind: 'CREDIT_CARD', last4: '1234' }, 1)

  insertTransaction(
    db,
    {
      id: 'tx-1',
      accountId: account.id,
      transactionDate: localDate(2026, 7, 3),
      chargeDate: localDate(2026, 8, 2),
      billingPeriod: { year: 2026, month: 8 },
      amount: fromMajorUnits(-421.05, 'ILS'),
      direction: 'OUTFLOW',
      merchantRaw: 'שופרסל דיל 344',
      merchantNormalized: 'שופרסל דיל',
      providerCategory: 'מזון וצריכה',
      cardLast4: '1234',
      reference: undefined,
      note: undefined,
      installment: {
        sequence: 1,
        total: 3,
        groupKey: 'group-1',
        originalTotal: fromMajorUnits(1263.15, 'ILS'),
      },
      foreign: undefined,
      naturalKey: 'key-1',
      importSessionId: undefined,
      sourceRowRef: 'עסקאות!10',
    },
    1,
  )

  return { db, account }
}

describe('migrations', () => {
  it('brings a new database to the current schema', async () => {
    const db = await createDatabase()
    const rows = query(db, 'SELECT MAX(version) AS v FROM schema_version')
    expect(rows[0]?.['v']).toBe(SCHEMA_VERSION)
  })

  it('is a no-op when run again', async () => {
    const db = await createDatabase()
    migrate(db)
    migrate(db)
    const rows = query(db, 'SELECT COUNT(*) AS n FROM schema_version')
    expect(rows[0]?.['n']).toBe(SCHEMA_VERSION)
  })

  it('019 rebuilds saving_deposit without losing a row, and then accepts the new kinds', async () => {
    // The only kind of migration test that proves anything (docs/06.5): build a
    // file at the old schema, put a real row in it, and open it with the new
    // build. 019 is a table rebuild, which is the one shape that can silently
    // drop data — and the CHECK it exists to widen is what would have refused
    // the row it now has to accept.
    const db = await createDatabase(18)

    db.run(
      `INSERT INTO holding_place (id, name, kind, is_liquid) VALUES ('place-1', 'Bank', 'CHECKING', 1)`,
    )
    db.run(`INSERT INTO saving_goal (id, name, kind, priority) VALUES ('goal-1', 'House', 'LONG_TERM', 10)`)
    db.run(
      `INSERT INTO saving_deposit (id, goal_id, date, currency, amount_minor, holding_place_id,
                                   source_kind, source_ref_id, note, created_at, updated_at)
       VALUES ('dep-1', 'goal-1', '2026-06-01', 'ILS', 250000, 'place-1',
               'FROM_PAYCHECK_DEDUCTION', 'pay-1:goal-1', 'From the 2026-06 payslip', 7, 7)`,
    )

    expect(() =>
      db.run(
        `INSERT INTO saving_deposit (id, goal_id, date, currency, amount_minor, holding_place_id, source_kind)
         VALUES ('dep-x', 'goal-1', '2026-01-01', 'ILS', 100, 'place-1', 'GROWTH')`,
      ),
    ).toThrow()

    // **To 19 and no further.** This test is about one migration, and the
    // columns it names are the ones 019 left behind; 024 renames one of them,
    // and is proved by the test below on its own terms.
    migrate(db, 19)

    const [row] = query(db, 'SELECT * FROM saving_deposit WHERE id = ?', ['dep-1'])
    expect(row?.['amount_minor']).toBe(250000)
    expect(row?.['source_kind']).toBe('FROM_PAYCHECK_DEDUCTION')
    expect(row?.['source_ref_id']).toBe('pay-1:goal-1')
    expect(row?.['note']).toBe('From the 2026-06 payslip')
    expect(row?.['created_at']).toBe(7)

    db.run(
      `INSERT INTO saving_deposit (id, goal_id, date, currency, amount_minor, holding_place_id, source_kind)
       VALUES ('dep-2', 'goal-1', '2026-01-01', 'ILS', 2000000, 'place-1', 'OPENING_BALANCE')`,
    )
    db.run(
      `INSERT INTO saving_deposit (id, goal_id, date, currency, amount_minor, holding_place_id, source_kind)
       VALUES ('dep-3', 'goal-1', '2026-07-31', 'ILS', -31000, 'place-1', 'GROWTH')`,
    )
    expect(query(db, 'SELECT COUNT(*) AS n FROM saving_deposit')[0]?.['n']).toBe(3)

    // And the indexes came back with it — a rebuild that forgot one would leave
    // the idempotency invariant unenforced and nothing would say so.
    expect(
      () =>
        db.run(
          `INSERT INTO saving_deposit (id, goal_id, date, currency, amount_minor, holding_place_id, source_kind, source_ref_id)
           VALUES ('dep-4', 'goal-1', '2026-06-01', 'ILS', 250000, 'place-1', 'FROM_PAYCHECK_DEDUCTION', 'pay-1:goal-1')`,
        ),
    ).toThrow()
  })

  it('024 moves the rate and the liquidity onto a holding without moving a figure', async () => {
    // **The acceptance test for migration 024, and the only one it has** (D-175):
    // every per-place total, both liquidity subtotals and every goal balance
    // read the same after it as before. A migration that improves a savings
    // number is a bug however defensible the new number is.
    const db = await createDatabase(23)

    db.run(
      `INSERT INTO holding_place (id, name, kind, is_liquid, expected_return_bp,
                                   expected_return_basis)
       VALUES ('place-bank', 'Hapoalim', 'CHECKING', 1, NULL, NULL),
              ('place-pakam', 'פק"מ', 'DEPOSIT', 0, 410, 'CONTRACTUAL')`,
    )
    db.run(
      `INSERT INTO saving_goal (id, name, kind, priority, default_holding_place_id)
       VALUES ('goal-house', 'House', 'LONG_TERM', 10, 'place-pakam'),
              ('goal-rain', 'Rainy day', 'EMERGENCY', 20, NULL)`,
    )
    db.run(
      `INSERT INTO saving_deposit (id, goal_id, date, currency, amount_minor, holding_place_id,
                                   source_kind)
       VALUES ('d1', 'goal-house', '2026-01-01', 'ILS', 400000, 'place-bank', 'MANUAL'),
              ('d2', 'goal-house', '2026-02-01', 'ILS', 1000000, 'place-pakam', 'MANUAL'),
              ('d3', 'goal-rain', '2026-03-01', 'ILS', 250000, 'place-bank', 'MANUAL'),
              ('d4', 'goal-rain', '2026-04-01', 'ILS', -50000, 'place-bank', 'MANUAL'),
              ('d5', 'goal-house', '2026-05-01', 'ILS', 90000, 'place-gone', 'MANUAL')`,
    )

    const before = query(
      db,
      `SELECT goal_id, SUM(amount_minor) AS minor FROM saving_deposit
        GROUP BY goal_id ORDER BY goal_id`,
    )
    const liquidBefore = query(
      db,
      `SELECT SUM(d.amount_minor) AS minor FROM saving_deposit d
         JOIN holding_place p ON p.id = d.holding_place_id
        WHERE p.is_liquid = 1`,
    )[0]?.['minor']

    // To the last schema that kept these tables: 048 drops them (M25 U8).
    migrate(db, 47)

    // Every goal balance, unchanged — including the one with a deposit sitting
    // in a place the document never had, which 024 keeps pointing at nothing
    // rather than dropping. A join here would have lost ₪900 quietly.
    expect(
      query(
        db,
        `SELECT goal_id, SUM(amount_minor) AS minor FROM saving_deposit
          GROUP BY goal_id ORDER BY goal_id`,
      ),
    ).toEqual(before)
    expect(query(db, 'SELECT COUNT(*) AS n FROM saving_deposit')[0]?.['n']).toBe(5)

    // The liquid subtotal, unchanged — now read through the holding.
    expect(
      query(
        db,
        `SELECT SUM(d.amount_minor) AS minor FROM saving_deposit d
           JOIN holding h ON h.id = d.holding_id
          WHERE h.is_liquid = 1`,
      )[0]?.['minor'],
    ).toBe(liquidBefore)

    // One holding per place, carrying exactly what the place carried.
    expect(query(db, 'SELECT COUNT(*) AS n FROM holding')[0]?.['n']).toBe(2)
    const pakam = query(db, `SELECT * FROM holding WHERE holding_place_id = 'place-pakam'`)[0]
    expect(pakam?.['id']).toBe('h-place-pakam')
    expect(pakam?.['is_liquid']).toBe(0)
    expect(pakam?.['expected_return_bp']).toBe(410)
    expect(pakam?.['expected_return_basis']).toBe('CONTRACTUAL')
    expect(pakam?.['kind']).toBe('DEPOSIT')

    // The place kept its identity and lost only what was never about it.
    const place = query(db, `SELECT * FROM holding_place WHERE id = 'place-pakam'`)[0]
    expect(place?.['name']).toBe('פק"מ')
    expect(place?.['is_liquid']).toBeUndefined()

    // A goal default follows its place's holding; a goal that had none still has none.
    expect(
      query(db, `SELECT default_holding_id FROM saving_goal WHERE id = 'goal-house'`)[0]?.[
        'default_holding_id'
      ],
    ).toBe('h-place-pakam')
    expect(
      query(db, `SELECT default_holding_id FROM saving_goal WHERE id = 'goal-rain'`)[0]?.[
        'default_holding_id'
      ],
    ).toBeNull()

    // And the indexes came back with the rebuild.
    expect(() =>
      db.run(
        `INSERT INTO saving_deposit (id, goal_id, date, currency, amount_minor, holding_id,
                                     source_kind, source_ref_id)
         VALUES ('dup-1', 'goal-house', '2026-06-01', 'ILS', 1, 'h-place-bank',
                 'FROM_PAYCHECK_DEDUCTION', 'pay-1:goal-house'),
                ('dup-2', 'goal-house', '2026-06-01', 'ILS', 1, 'h-place-bank',
                 'FROM_PAYCHECK_DEDUCTION', 'pay-1:goal-house')`,
      ),
    ).toThrow()
  })

  it('refuses a file written by a newer build rather than corrupting it', async () => {
    const db = await createDatabase()
    db.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION + 5])
    const bytes = exportDatabase(db)

    await expect(openDatabase(bytes)).rejects.toThrow(SchemaTooNewError)
    await expect(openDatabase(bytes)).rejects.toThrow(/newer version/)
  })
})

/**
 * The two functions that exist so that something which is not the app can look
 * at a document without changing it. Both are load-bearing for the Claude
 * plugin's schema gate (docs/f14 trap 1), and both fail silently if they are
 * wrong: the damage is a file the user's own app can no longer open, discovered
 * long after the read that caused it.
 */
describe('reading a document without touching it', () => {
  it('reports the version, and creates nothing when there is no schema_version table', async () => {
    const db = await createDatabase()
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)

    db.run('DROP TABLE schema_version')
    expect(readSchemaVersion(db)).toBe(0)

    // The point of the previous line: asking must not answer itself into
    // existence. `migrate` creates the table because it is about to write to
    // it; a reader that did the same would leave a footprint in every document
    // it merely glanced at.
    const tables = query(db, "SELECT name FROM sqlite_master WHERE name = 'schema_version'")
    expect(tables).toEqual([])
  })

  it('opens an older document without migrating it, byte for byte', async () => {
    const old = await createDatabase(SCHEMA_VERSION - 1)
    const before = exportDatabase(old)
    old.close()

    const reopened = await openDatabaseWithoutMigrating(before)
    expect(readSchemaVersion(reopened)).toBe(SCHEMA_VERSION - 1)
    expect(exportDatabase(reopened)).toEqual(before)

    // And the contrast, which is the whole reason the two functions are
    // separate: `openDatabase` is the app's door and it does migrate.
    expect(readSchemaVersion(await openDatabase(before))).toBe(SCHEMA_VERSION)
  })
})

describe('save and reopen', () => {
  it('everything is still there, and still correct', async () => {
    // The done-when of step 3 in docs/13: close the browser, reopen the file,
    // and it is all there.
    const { db } = await seeded()
    const saved = exportDatabase(db)
    db.close()

    const reopened = await openDatabase(saved)
    expect(countTransactions(reopened)).toBe(1)

    const [row] = listTransactions(reopened)
    expect(row).toBeDefined()
    if (row === undefined) return

    expect(row.merchantRaw).toBe('שופרסל דיל 344')
    expect(row.amount).toEqual({ minor: -42105, currency: 'ILS' })
    expect(row.transactionDate).toEqual({ year: 2026, month: 7, day: 3 })
    expect(row.chargeDate).toEqual({ year: 2026, month: 8, day: 2 })
    // The group key and the purchase total survive the round trip too: they are
    // the whole point of storing them, and a save that dropped them would be
    // indistinguishable from never having read them (007).
    expect(row.installment).toEqual({
      sequence: 1,
      total: 3,
      groupKey: 'group-1',
      originalTotal: { minor: 126315, currency: 'ILS' },
    })
    expect(row.providerCategory).toBe('מזון וצריכה')
  })

  it('produces a real SQLite file, openable by anything that reads SQLite', async () => {
    const { db } = await seeded()
    const bytes = exportDatabase(db)
    // The format's magic string. D-020's promise is that the saved document is
    // a genuine SQLite database, not an app-specific container.
    expect(new TextDecoder().decode(bytes.subarray(0, 15))).toBe('SQLite format 3')
  })
})

describe('inTransaction', () => {
  it('nests, and an inner failure does not take the outer one down', async () => {
    // SQLite refuses BEGIN inside a transaction, so composing two operations
    // that each use this used to be impossible. The plugin's `create_rule`
    // writes a rule and then runs the app's own re-apply, and wants the pair to
    // be atomic (D-099).
    const { db, account } = await seeded()

    const kept = inTransaction(db, () => {
      db.run('UPDATE fmt_account SET name = ? WHERE id = ?', ['outer', account.id])

      expect(() =>
        inTransaction(db, () => {
          db.run('DELETE FROM fmt_transaction')
          throw new Error('the inner block failed')
        }),
      ).toThrow('the inner block failed')

      // The inner block rolled back on its own; the outer one is still running
      // and still holds what it did.
      expect(countTransactions(db)).toBe(1)
      return 'committed'
    })

    expect(kept).toBe('committed')
    expect(query(db, 'SELECT name FROM fmt_account')[0]?.['name']).toBe('outer')
  })

  it('rolls the whole nest back when the outer block fails', async () => {
    const { db, account } = await seeded()

    expect(() =>
      inTransaction(db, () => {
        inTransaction(db, () => {
          db.run('UPDATE fmt_account SET name = ? WHERE id = ?', ['inner', account.id])
        })
        throw new Error('the outer block failed')
      }),
    ).toThrow('the outer block failed')

    // The inner block succeeded on its own terms and is still undone, because
    // it was part of a unit that did not.
    expect(query(db, 'SELECT name FROM fmt_account')[0]?.['name']).toBe('Card 1234')
  })

  it('can be used again after a nested failure, rather than leaving the stack wedged', async () => {
    // `ROLLBACK TO` keeps the savepoint, so a name that was never released would
    // accumulate and the next call would collide with it.
    const { db, account } = await seeded()

    for (let i = 0; i < 3; i++) {
      inTransaction(db, () => {
        expect(() =>
          inTransaction(db, () => {
            throw new Error('nope')
          }),
        ).toThrow('nope')
      })
    }

    inTransaction(db, () => {
      db.run('UPDATE fmt_account SET name = ? WHERE id = ?', ['still works', account.id])
    })
    expect(query(db, 'SELECT name FROM fmt_account')[0]?.['name']).toBe('still works')
  })

  it('rolls back everything when the work throws', async () => {
    const { db, account } = await seeded()

    expect(() =>
      inTransaction(db, () => {
        db.run('DELETE FROM fmt_transaction')
        db.run('UPDATE fmt_account SET name = ? WHERE id = ?', ['changed', account.id])
        throw new Error('something went wrong half-way')
      }),
    ).toThrow('something went wrong half-way')

    expect(countTransactions(db)).toBe(1)
    expect(query(db, 'SELECT name FROM fmt_account')[0]?.['name']).toBe('Card 1234')
  })
})
