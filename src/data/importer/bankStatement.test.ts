/**
 * A bank statement, end to end: the two-column amount convention, the value
 * date, the running balance, and the card settlement sitting in the middle of
 * it. docs/f06-bank-statement-import.md.
 *
 * The fixture is synthetic and will stay that way until a real Israeli bank
 * export exists to check it against — the same distinction M1 drew about an
 * installment row and M3 about a payslip. What it is built to is the column
 * layout docs/f06 names, and the arithmetic in it is real: the running balance
 * chains from ₪10,000 to ₪12,017.55 and the check has to agree.
 */

import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { Database } from 'sql.js'

import { formatMoney, money } from '@/core/money.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { findSession } from '@/data/repositories/importSessionRepository.ts'
import { acceptAllNew } from '@/data/repositories/stagedRowRepository.ts'
import { countTransactions } from '@/data/repositories/transactionRepository.ts'
import { planBankImport, verifyRunningBalance } from '@/domain/bankImport.ts'
import { allParsed, applyMapping, bankRowsOf, type ParsedRow } from './apply.ts'
import { BalanceCheckFailedError, commitSession } from './commit.ts'
import { stageImport } from './stage.ts'
import { guessMapping, missingRequiredRoles } from './guess.ts'
import { readWorkbook, type SheetTable } from './sheetTable.ts'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/synthetic/bank-statement.csv', import.meta.url),
)

function sheet(): SheetTable {
  const found = readWorkbook(
    'bank-statement.csv',
    new Uint8Array(readFileSync(FIXTURE)),
  ).sheets[0]
  if (found === undefined) throw new Error('fixture has no sheet')
  return found
}

const table = sheet()
const mapping = guessMapping(table)
if (mapping === undefined) throw new Error('no mapping')

const parsed = applyMapping(table, mapping)
const rows = allParsed(parsed)
const bankRows = bankRowsOf(parsed)

describe('mapping a bank export', () => {
  const roleOf = (column: number): ColumnRoleId | undefined => mapping.columnRoles.get(column)

  it('reads חובה and זכות as the pair rather than as one amount', () => {
    // Both sat under the `amount` role until F06. A bank file pre-filled that
    // way reads every charge and drops every deposit.
    expect(roleOf(4)).toBe('debit')
    expect(roleOf(5)).toBe('credit')
    expect(roleOf(0)).toBe('date')
    expect(roleOf(2)).toBe('merchant')
    expect(roleOf(3)).toBe('reference')
    expect(roleOf(6)).toBe('balance')
  })

  it('reads תאריך ערך as the charge date, not as a second transaction date', () => {
    expect(roleOf(1)).toBe('chargeDate')
  })

  it('picks the split convention from the columns, not from the signs', () => {
    expect(mapping.amountConvention).toBe('SEPARATE_DEBIT_CREDIT')
  })

  it('asks for the two columns it needs rather than for an amount it will never have', () => {
    expect(missingRequiredRoles(mapping)).toEqual([])
    expect(missingRequiredRoles({ ...mapping, amountConvention: 'SIGNED_SINGLE' })).toEqual([
      'amount',
    ])
  })

  it('skips the preamble and the opening-balance line', () => {
    expect(rows).toHaveLength(5)
  })
})

describe('the amounts', () => {
  it('signs each row from the column it came out of', () => {
    expect(rows.map((row) => formatMoney(row.amount))).toEqual([
      '₪12,000.00',
      '-₪5,000.00',
      '-₪4,210.55',
      '-₪750.00',
      '-₪21.90',
    ])
  })

  it('sets the direction from the sign, so a deposit is an inflow', () => {
    expect(rows.map((row) => row.direction)).toEqual([
      'INFLOW',
      'OUTFLOW',
      'OUTFLOW',
      'OUTFLOW',
      'OUTFLOW',
    ])
  })

  it('keeps the asmachta, which is what makes a repeated bank row distinguishable', () => {
    expect(rows.map((row) => row.reference)).toEqual([
      '0000112233',
      '0000112234',
      '0000112235',
      '0000112236',
      '0000112237',
    ])
  })
})

describe('the running balance', () => {
  it('verifies against the balance the file states on every row', () => {
    expect(verifyRunningBalance(bankRows)).toEqual({
      kind: 'VERIFIED',
      order: 'OLDEST_FIRST',
      openingBalance: money(1_000_000, 'ILS'),
      closingBalance: money(1_201_755, 'ILS'),
      rowCount: 5,
    })
  })

  it('catches a single row parsed wrong, and names it', () => {
    const broken = bankRows.map((row, index) =>
      index === 2 ? { ...row, amount: money(-421_05, 'ILS') } : row,
    )
    const check = verifyRunningBalance(broken)

    expect(check.kind).toBe('DIVERGED')
    if (check.kind !== 'DIVERGED') return
    expect(check.at.ref).toBe(bankRows[2]?.ref)
    expect(check.at.verifiedBefore).toBe(1)
  })

  it('does not put the balance on the transaction', () => {
    // docs/f06: imported for verification, not stored per transaction. It lives
    // beside the draft and stops there.
    expect(Object.keys(rows[0] ?? {})).not.toContain('balance')
  })
})

describe('what the rows turn out to be', () => {
  const plan = planBankImport({
    rows: bankRows,
    cards: [{ id: 'cal', name: 'Cal – Visa 1234', last4: '1234' }],
    cardPeriodTotals: [
      { accountId: 'cal', period: { year: 2026, month: 7 }, total: money(-421_055, 'ILS') },
    ],
  })

  it('classifies every row', () => {
    expect(plan.rows.map((entry) => entry.rowClass)).toEqual([
      'SALARY',
      'DIRECT_DEBIT',
      'CARD_SETTLEMENT',
      'CHEQUE',
      'FEE',
    ])
  })

  it('matches the card charge to the statement already in the ledger', () => {
    expect(plan.settlements).toHaveLength(1)
    expect(plan.settlements[0]).toMatchObject({
      cardAccountId: 'cal',
      last4: '1234',
      confidence: 'HIGH',
      billingPeriod: { year: 2026, month: 7 },
      decision: 'PENDING',
    })
  })

  it('finds the four digits even though the merchant name no longer has them', () => {
    expect(plan.rows[2]?.row.descriptionNormalized).toBe('כרטיס אשראי')
    expect(plan.rows[2]?.row.descriptionRaw).toContain('1234')
  })
})

describe('staging and committing a bank statement', () => {
  async function staged(rows: readonly ParsedRow[]): Promise<{
    readonly db: Database
    readonly sessionId: string
  }> {
    const db = await createLedgerDatabase()
    const account = createAccount(db, { name: 'Bank', kind: 'BANK' }, 1)
    const result = stageImport(
      db,
      {
        accountId: account.id,
        fileName: 'bank-statement.csv',
        fileHash: 'hash-1',
        sheetName: 'Sheet1',
        rows,
      },
      1,
    )
    return { db, sessionId: result.sessionId }
  }

  it('records the check on the session, because by review time the sheet is gone', async () => {
    const { db, sessionId } = await staged(parsed)

    expect(findSession(db, sessionId)?.balanceCheck).toEqual({
      kind: 'VERIFIED',
      order: 'OLDEST_FIRST',
      openingBalance: money(1_000_000, 'ILS'),
      closingBalance: money(1_201_755, 'ILS'),
      rowCount: 5,
    })
  })

  it('survives the JSON round trip through the document', async () => {
    const { db, sessionId } = await staged(parsed)
    const reopened = await openDatabase(exportDatabase(db))

    expect(findSession(reopened, sessionId)?.balanceCheck).toEqual(
      findSession(db, sessionId)?.balanceCheck,
    )
  })

  it('reads a value this build cannot understand as no check at all', async () => {
    // The document is a real SQLite file the user can edit by hand. Failing open
    // is right here: it is the same state every card import already has.
    const { db, sessionId } = await staged(parsed)
    db.run("UPDATE fmt_statement SET balance_check = '{{ not json' WHERE id = ?", [sessionId])

    expect(findSession(db, sessionId)?.balanceCheck).toBeUndefined()
  })

  it('blocks the commit when the balance does not add up, naming the row', async () => {
    // One row's amount mangled, as a wrongly mapped column would do.
    const broken = parsed.map((row, index) =>
      index !== 3 || row.outcome.kind !== 'parsed'
        ? row
        : {
            ...row,
            outcome: {
              ...row.outcome,
              transaction: { ...row.outcome.transaction, amount: money(-75, 'ILS') },
            },
          },
    )
    const { db, sessionId } = await staged(broken)

    acceptAllNew(db, sessionId, 2)
    expect(() => commitSession(db, sessionId, 3)).toThrow(BalanceCheckFailedError)
    expect(countTransactions(db)).toBe(0)
  })

  it('imports anyway when the user says so, which is a second deliberate act', async () => {
    const broken = parsed.map((row, index) =>
      index !== 3 || row.outcome.kind !== 'parsed'
        ? row
        : {
            ...row,
            outcome: {
              ...row.outcome,
              transaction: { ...row.outcome.transaction, amount: money(-75, 'ILS') },
            },
          },
    )
    const { db, sessionId } = await staged(broken)

    acceptAllNew(db, sessionId, 2)
    expect(commitSession(db, sessionId, 3, { ignoreBalanceCheck: true }).imported).toBe(5)
  })

  it('lets a verified statement through', async () => {
    const { db, sessionId } = await staged(parsed)
    acceptAllNew(db, sessionId, 2)

    expect(commitSession(db, sessionId, 3).imported).toBe(5)
  })
})
