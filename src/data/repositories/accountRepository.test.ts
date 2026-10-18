import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { localDate } from '@/core/time.ts'
import { query } from '../db/database.ts'
import {
  AccountInUseError,
  AccountMergeError,
  accountUsage,
  createAccount,
  deleteAccount,
  findAccountByLast4,
  findAccountById,
  findOrCreateAccount,
  listAccounts,
  mergeAccounts,
  mergePreview,
  renameAccount,
  resolveAccountForImport,
  setAccountArchived,
  setAccountInstitution,
  setAccountLast4,
} from './accountRepository.ts'
import { correctCategory } from './categoryOverrideRepository.ts'
import { listMappings, saveMapping } from './importMappingRepository.ts'
import { listTransactions } from './transactionRepository.ts'

/**
 * The account operations onboarding needs (docs/f12) and the merge that repairs
 * what D-033 left behind: a document written before it holds one card as two
 * accounts, with overlapping months in both.
 */
describe('accounts', () => {
  let db: Database

  beforeEach(async () => {
    db = await createLedgerDatabase()
  })

  it('creates a card with its institution and last 4', () => {
    const account = createAccount(
      db,
      { name: 'Cal · Visa 4321', kind: 'CREDIT_CARD', last4: '4321', institutionId: 'inst:cal' },
      1,
    )

    expect(findAccountById(db, account.id)).toEqual({
      id: account.id,
      name: 'Cal · Visa 4321',
      kind: 'CREDIT_CARD',
      last4: '4321',
      institutionId: 'inst:cal',
      isArchived: false,
    })
  })

  it('sorts cards before banks, and each by name', () => {
    createAccount(db, { name: 'Leumi checking', kind: 'BANK' }, 1)
    createAccount(db, { name: 'Max 4521', kind: 'CREDIT_CARD' }, 1)
    createAccount(db, { name: 'Cal 4321', kind: 'CREDIT_CARD' }, 1)
    createAccount(db, { name: 'Cash', kind: 'CASH' }, 1)

    expect(listAccounts(db).map((account) => account.name)).toEqual([
      'Cal 4321',
      'Max 4521',
      'Leumi checking',
      'Cash',
    ])
  })

  it('renames, re-institutions and corrects a last 4', () => {
    const account = createAccount(db, { name: 'Card 4321', kind: 'CREDIT_CARD', last4: '8817' }, 1)

    renameAccount(db, account.id, 'כאל · ויזה', 2)
    setAccountLast4(db, account.id, '4321', 2)
    setAccountInstitution(db, account.id, 'inst:cal', 2)

    expect(findAccountById(db, account.id)).toMatchObject({
      name: 'כאל · ויזה',
      last4: '4321',
      institutionId: 'inst:cal',
    })
  })

  /** A cleared last-4 must not be a value `findAccountByLast4` can match. */
  it('clears a last 4 to null rather than to an empty string', () => {
    const account = createAccount(db, { name: 'Card', kind: 'CREDIT_CARD', last4: '4321' }, 1)
    setAccountLast4(db, account.id, undefined, 2)

    expect(findAccountById(db, account.id)?.last4).toBeUndefined()
    expect(query(db, 'SELECT last4 FROM fmt_account WHERE id = ?', [account.id])[0]?.['last4']).toBeNull()
  })

  it('archives out of the pickers and back again', () => {
    const account = createAccount(db, { name: 'Old card', kind: 'CREDIT_CARD' }, 1)

    setAccountArchived(db, account.id, true, 2)
    expect(listAccounts(db)).toHaveLength(0)
    expect(listAccounts(db, { includeArchived: true })).toHaveLength(1)
    expect(listAccounts(db, { includeArchived: true })[0]?.isArchived).toBe(true)

    setAccountArchived(db, account.id, false, 3)
    expect(listAccounts(db)).toHaveLength(1)
  })

  describe('resolving the account a file belongs to', () => {
    it('matches on the last 4 rather than on the name', () => {
      const existing = createAccount(
        db,
        { name: 'Cal · Visa 4321', kind: 'CREDIT_CARD', last4: '4321' },
        1,
      )

      const resolved = findOrCreateAccount(
        db,
        { name: 'Card 4321', kind: 'CREDIT_CARD', last4: '4321' },
        2,
      )

      expect(resolved.id).toBe(existing.id)
      // The name the user gave it stands; a file does not get to rename a card.
      expect(resolved.name).toBe('Cal · Visa 4321')
      expect(listAccounts(db)).toHaveLength(1)
    })

    it('falls back to the name when no card number is known', () => {
      const existing = createAccount(db, { name: 'Cal statement', kind: 'CREDIT_CARD' }, 1)

      expect(findOrCreateAccount(db, { name: 'Cal statement', kind: 'CREDIT_CARD' }, 2).id).toBe(
        existing.id,
      )
      expect(findOrCreateAccount(db, { name: 'Max statement', kind: 'CREDIT_CARD' }, 2).id).not.toBe(
        existing.id,
      )
    })

    /**
     * The hole the archive button would otherwise open: a second account for one
     * card is exactly the split D-033 fixed, and it breaks idempotence because
     * the unique index is `(account_id, natural_key)`.
     */
    it('brings an archived card back rather than creating a second one', () => {
      const existing = createAccount(db, { name: 'Cal 4321', kind: 'CREDIT_CARD', last4: '4321' }, 1)
      setAccountArchived(db, existing.id, true, 2)

      const resolved = findOrCreateAccount(
        db,
        { name: 'Card 4321', kind: 'CREDIT_CARD', last4: '4321' },
        3,
      )

      expect(resolved.id).toBe(existing.id)
      expect(resolved.isArchived).toBe(false)
      expect(findAccountById(db, existing.id)?.isArchived).toBe(false)
      expect(listAccounts(db)).toHaveLength(1)
    })

    it('prefers a live account to an archived one carrying the same number', () => {
      const archived = createAccount(db, { name: 'Old', kind: 'CREDIT_CARD', last4: '4321' }, 1)
      setAccountArchived(db, archived.id, true, 2)
      const live = createAccount(db, { name: 'New', kind: 'CREDIT_CARD', last4: '4321' }, 3)

      expect(findAccountByLast4(db, '4321')?.id).toBe(live.id)
    })
  })

  describe('resolving the account for an incoming file', () => {
    const request = {
      boundAccountId: undefined,
      last4: undefined,
      fallbackName: 'Visa 4321',
      kind: 'CREDIT_CARD' as const,
    }

    it('uses the bound account when the file names no card', () => {
      const bound = createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD' }, 1)

      const resolved = resolveAccountForImport(db, { ...request, boundAccountId: bound.id }, 2)

      expect(resolved.id).toBe(bound.id)
      expect(listAccounts(db)).toHaveLength(1)
    })

    /**
     * The binding says which account; the file says the number that account was
     * missing. Creating a second one for a card the user has already named would
     * be the split D-033 fixed, arriving by another door.
     */
    it('gives the bound account the number the file states, when it had none', () => {
      const bound = createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD' }, 1)

      const resolved = resolveAccountForImport(
        db,
        { ...request, boundAccountId: bound.id, last4: '4321' },
        2,
      )

      expect(resolved.id).toBe(bound.id)
      expect(resolved.last4).toBe('4321')
      expect(findAccountById(db, bound.id)?.last4).toBe('4321')
      expect(listAccounts(db)).toHaveLength(1)
    })

    it('keeps using the bound account when the numbers agree', () => {
      const bound = createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD', last4: '4321' }, 1)

      expect(
        resolveAccountForImport(db, { ...request, boundAccountId: bound.id, last4: '4321' }, 2).id,
      ).toBe(bound.id)
    })

    /** A fact about the file beats a fact about the format. */
    it('lets the stated number win over a binding that disagrees', () => {
      const bound = createAccount(db, { name: 'Cal 4321', kind: 'CREDIT_CARD', last4: '4321' }, 1)
      const other = createAccount(db, { name: 'Cal 4521', kind: 'CREDIT_CARD', last4: '4521' }, 1)

      const resolved = resolveAccountForImport(
        db,
        { ...request, boundAccountId: bound.id, last4: '4521' },
        2,
      )

      expect(resolved.id).toBe(other.id)
    })

    it('creates the account when nothing is bound and nothing matches', () => {
      const resolved = resolveAccountForImport(db, { ...request, last4: '4321' }, 2)

      expect(resolved.name).toBe('Visa 4321')
      expect(resolved.last4).toBe('4321')
    })

    it('brings back a bound account that was archived', () => {
      const bound = createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD' }, 1)
      setAccountArchived(db, bound.id, true, 2)

      const resolved = resolveAccountForImport(db, { ...request, boundAccountId: bound.id }, 3)

      expect(resolved).toMatchObject({ id: bound.id, isArchived: false })
    })

    it('ignores a binding to an account that has since gone', () => {
      const resolved = resolveAccountForImport(db, { ...request, boundAccountId: 'gone' }, 2)

      expect(resolved.name).toBe('Visa 4321')
    })
  })

  describe('merging two accounts', () => {
    /** One card, split in two by the file-name identity D-033 replaced. */
    function splitCard(): { readonly first: string; readonly second: string } {
      const first = createAccount(db, { name: 'ויזה 4321', kind: 'CREDIT_CARD' }, 1).id
      const second = createAccount(db, { name: 'ויזה 4321 (1)', kind: 'CREDIT_CARD', last4: '4321' }, 1).id

      // July, in the first account only.
      transaction(first, 'tx-1', 'key-july', -42105)
      // August, in both — the overlapping month that makes this a merge and not
      // a repoint.
      transaction(first, 'tx-2', 'key-august', -19900)
      transaction(second, 'tx-3', 'key-august', -19900)
      // September, in the second only.
      transaction(second, 'tx-4', 'key-september', -8000)

      return { first, second }
    }

    function transaction(accountId: string, id: string, naturalKey: string, minor: number): void {
      insertTransaction(
        db,
        {
          id,
          accountId,
          transactionDate: localDate(2026, 8, 3),
          chargeDate: undefined,
          billingPeriod: undefined,
          amount: { minor, currency: 'ILS' },
          direction: 'OUTFLOW',
          merchantRaw: 'שופרסל דיל 344',
          merchantNormalized: 'שופרסל דיל',
          providerCategory: undefined,
          cardLast4: undefined,
          reference: undefined,
          note: undefined,
          installment: undefined,
          foreign: undefined,
          naturalKey,
          importSessionId: undefined,
          sourceRowRef: undefined,
        },
        1,
      )
    }

    it('says what it will do before it does it', () => {
      const { first, second } = splitCard()

      expect(mergePreview(db, first, second)).toEqual({ moved: 1, duplicates: 1 })
      expect(mergePreview(db, second, first)).toEqual({ moved: 1, duplicates: 1 })
    })

    it('moves the transactions and drops the ones the target already has', () => {
      const { first, second } = splitCard()

      mergeAccounts(db, first, second, 5)

      const survivors = listTransactions(db, {}).filter(
        (transaction) => transaction.accountId === second,
      )
      expect(survivors.map((transaction) => transaction.naturalKey).sort()).toEqual([
        'key-august',
        'key-july',
        'key-september',
      ])
      // The August row that moved is the target's own, not the source's.
      expect(survivors.find((row) => row.naturalKey === 'key-august')?.id).toBe('tx-3')
      expect(listAccounts(db).map((account) => account.id)).toEqual([second])
    })

    /**
     * Removed, not soft-deleted, since M25 U3 — and what named the removed row
     * names its twin, so nothing is left pointing at a row that is gone.
     */
    it('removes the duplicates, and what named one names its twin', () => {
      const { first, second } = splitCard()
      correctCategory(db, 'tx-2', 'cat:groceries', 4)
      mergeAccounts(db, first, second, 5)

      expect(query(db, 'SELECT id FROM fmt_transaction WHERE id = ?', ['tx-2'])).toEqual([])
      expect(query(db, 'SELECT "transaction" AS row FROM fmt_category_override')).toEqual([{ row: 'tx-3' }])
    })

    it('does not leave the merged-away account behind', () => {
      const { first, second } = splitCard()
      mergeAccounts(db, first, second, 5)

      expect(findAccountById(db, first)).toBeUndefined()
      expect(listAccounts(db, { includeArchived: true })).toHaveLength(1)
    })

    it('moves provenance and mapping bindings across', () => {
      const { first, second } = splitCard()
      db.run(
        `INSERT INTO fmt_statement
           (id, account, file_name, file_hash, status, started, rows_total, rows_new, rows_duplicate, rows_failed)
         VALUES ('ses-1', ?, 'visa 4321.xlsx', 'hash', 'COMMITTED', '1970-01-01T00:00:00.001Z', 0, 0, 0, 0)`,
        [first],
      )
      const mapping = saveMapping(
        db,
        {
          name: 'Visa 4321',
          accountId: first,
          headerSignature: 'sig',
          mapping: {
            sheetName: 'עסקאות',
            headerRowIndex: 3,
            dataStartRowIndex: 4,
            columnRoles: new Map(),
            amountConvention: 'SIGNED_SINGLE',
            dateOrders: new Map(),
            defaultCurrency: 'ILS',
          },
        },
        1,
      )

      mergeAccounts(db, first, second, 5)

      expect(query(db, 'SELECT account FROM fmt_statement WHERE id = ?', ['ses-1'])[0]?.['account']).toBe(second)
      expect(listMappings(db).find((row) => row.id === mapping.id)?.accountId).toBe(second)
      expect(accountUsage(db, second)).toEqual({
        transactions: 3,
        importSessions: 1,
        mappings: 1,
      })
    })

    /** The one thing a merge can only improve: an identity the survivor lacked. */
    it('the survivor adopts a last 4 and an institution it did not have', () => {
      const withIdentity = createAccount(
        db,
        { name: 'Cal 4321', kind: 'CREDIT_CARD', last4: '4321', institutionId: 'inst:cal' },
        1,
      ).id
      const without = createAccount(db, { name: 'ויזה 4321', kind: 'CREDIT_CARD' }, 1).id

      mergeAccounts(db, withIdentity, without, 5)

      expect(findAccountById(db, without)).toMatchObject({
        // The survivor's own name stands — the user chose which one survives.
        name: 'ויזה 4321',
        last4: '4321',
        institutionId: 'inst:cal',
      })
    })

    it('leaves the survivor a last 4 it already had', () => {
      const source = createAccount(db, { name: 'A', kind: 'CREDIT_CARD', last4: '1111' }, 1).id
      const target = createAccount(db, { name: 'B', kind: 'CREDIT_CARD', last4: '2222' }, 1).id

      mergeAccounts(db, source, target, 5)

      expect(findAccountById(db, target)?.last4).toBe('2222')
    })

    it('refuses a card into a bank account, and an account into itself', () => {
      const card = createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD' }, 1).id
      const bank = createAccount(db, { name: 'Leumi', kind: 'BANK' }, 1).id

      expect(() => mergeAccounts(db, card, bank, 5)).toThrow(AccountMergeError)
      expect(() => mergeAccounts(db, card, card, 5)).toThrow(AccountMergeError)
      expect(listAccounts(db)).toHaveLength(2)
    })

    it('refuses an account that is no longer there', () => {
      const card = createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD' }, 1).id

      expect(() => mergeAccounts(db, card, 'gone', 5)).toThrow(AccountMergeError)
    })

    /**
     * The whole point of the operation: after the merge, re-importing the month
     * that was in both accounts is caught as duplicate rather than doubled.
     */
    it('restores idempotence for the month that was in both', () => {
      const { first, second } = splitCard()
      mergeAccounts(db, first, second, 5)

      expect(() => transaction(second, 'tx-again', 'key-august', -19900)).toThrow()
    })
  })

  describe('removing an account', () => {
    it('removes one that never held anything', () => {
      const account = createAccount(db, { name: 'Added by mistake', kind: 'CREDIT_CARD' }, 1)

      deleteAccount(db, account.id, 2)

      expect(listAccounts(db, { includeArchived: true })).toHaveLength(0)
      expect(findAccountById(db, account.id)).toBeUndefined()
    })

    it('refuses one that holds transactions, and says what to do instead', () => {
      const account = createAccount(db, { name: 'Cal 4321', kind: 'CREDIT_CARD' }, 1)
      insertTransaction(
        db,
        {
          id: 'tx-1',
          accountId: account.id,
          transactionDate: localDate(2026, 8, 3),
          chargeDate: undefined,
          billingPeriod: undefined,
          amount: { minor: -1000, currency: 'ILS' },
          direction: 'OUTFLOW',
          merchantRaw: 'רמי לוי',
          merchantNormalized: 'רמי לוי',
          providerCategory: undefined,
          cardLast4: undefined,
          reference: undefined,
          note: undefined,
          installment: undefined,
          foreign: undefined,
          naturalKey: 'key-1',
          importSessionId: undefined,
          sourceRowRef: undefined,
        },
        1,
      )

      expect(() => deleteAccount(db, account.id, 2)).toThrow(AccountInUseError)
      expect(() => deleteAccount(db, account.id, 2)).toThrow(/Archive it instead, or merge it/)
      expect(listAccounts(db)).toHaveLength(1)
    })

    it('is a no-op on an account that is already gone', () => {
      expect(() => deleteAccount(db, 'never-existed', 2)).not.toThrow()
    })
  })

  it('counts what an account holds', () => {
    const account = createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD' }, 1)

    expect(accountUsage(db, account.id)).toEqual({
      transactions: 0,
      importSessions: 0,
      mappings: 0,
    })
  })
})
