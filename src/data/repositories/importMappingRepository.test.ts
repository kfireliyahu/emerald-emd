import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import type { DraftMapping } from '@/domain/model/importing.ts'
import { query } from '../db/database.ts'
import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import {
  deleteMapping,
  duplicateMapping,
  findMappingById,
  findMappingBySignature,
  listMappings,
  recordMappingUse,
  renameMapping,
  saveMapping,
  setMappingAccount,
} from './importMappingRepository.ts'

function draftMapping(overrides: Partial<DraftMapping> = {}): DraftMapping {
  return {
    sheetName: 'עסקאות',
    headerRowIndex: 3,
    dataStartRowIndex: 4,
    columnRoles: new Map([
      [0, 'date'],
      [1, 'merchant'],
      [5, 'amount'],
      [9, 'chargeDate'],
    ]),
    amountConvention: 'POSITIVE_IS_CHARGE',
    dateOrders: new Map([
      ['date', 'DMY'],
      ['chargeDate', 'DMY'],
    ]),
    defaultCurrency: 'ILS',
    ...overrides,
  }
}

describe('importMappingRepository', () => {
  let db: Database

  beforeEach(async () => {
    db = await createLedgerDatabase()
  })

  function account(id: string): void {
    db.run("INSERT INTO fmt_account (id, name, kind, is_archived) VALUES (?, ?, 'CREDIT_CARD', 0)", [
      id,
      `Card ${id}`,
    ])
  }

  it('brings a mapping back exactly as it went in, both maps included', () => {
    const mapping = draftMapping()
    const saved = saveMapping(db, { name: 'Cal – Visa 1234', headerSignature: 'sig-a', mapping }, 1000)

    const loaded = findMappingById(db, saved.id)
    expect(loaded?.name).toBe('Cal – Visa 1234')
    expect(loaded?.mapping).toEqual(mapping)
  })

  it('finds a mapping by the signature of the file that produced it', () => {
    saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
    expect(findMappingBySignature(db, 'sig-a')?.name).toBe('Cal')
    expect(findMappingBySignature(db, 'sig-b')).toBeUndefined()
  })

  it('starts a new mapping unused, so it does not outrank one that has been used', () => {
    const saved = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
    expect(saved.useCount).toBe(0)
    expect(saved.lastUsedAt).toBeUndefined()
  })

  it('updates the mapping for a format instead of piling up a second row for it', () => {
    // Matching resolves a file to one mapping. A second row for the same
    // signature would turn that answer into a tiebreak, so the mapper's save
    // lands in the row that already describes this format.
    const first = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
    const again = saveMapping(
      db,
      {
        name: 'Cal – Visa 1234',
        headerSignature: 'sig-a',
        mapping: draftMapping({ amountConvention: 'SIGNED_SINGLE', defaultCurrency: 'USD' }),
      },
      2000,
    )

    expect(again.id).toBe(first.id)
    expect(listMappings(db)).toHaveLength(1)
    expect(findMappingById(db, first.id)?.name).toBe('Cal – Visa 1234')
    expect(findMappingById(db, first.id)?.mapping.amountConvention).toBe('SIGNED_SINGLE')
    // How the mapper's currency select survives the file it was set on: the
    // draft is saved whole, so a corrected currency comes back with the columns.
    expect(findMappingById(db, first.id)?.mapping.defaultCurrency).toBe('USD')
  })

  it('repairs a mapping in place when its format changed, signature and all', () => {
    const first = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
    saveMapping(
      db,
      { id: first.id, name: 'Cal', headerSignature: 'sig-b', mapping: draftMapping() },
      2000,
    )

    expect(listMappings(db)).toHaveLength(1)
    expect(findMappingBySignature(db, 'sig-b')?.id).toBe(first.id)
    expect(findMappingBySignature(db, 'sig-a')).toBeUndefined()
  })

  it('counts uses and remembers the last one', () => {
    const saved = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)

    recordMappingUse(db, saved.id, 2000)
    recordMappingUse(db, saved.id, 3000)

    const loaded = findMappingById(db, saved.id)
    expect(loaded?.useCount).toBe(2)
    expect(loaded?.lastUsedAt).toBe(3000)
  })

  it('lists the most recently used first', () => {
    const a = saveMapping(db, { name: 'A', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
    const b = saveMapping(db, { name: 'B', headerSignature: 'sig-b', mapping: draftMapping() }, 1000)

    recordMappingUse(db, a.id, 2000)
    recordMappingUse(db, b.id, 3000)

    expect(listMappings(db).map((mapping) => mapping.name)).toEqual(['B', 'A'])
  })

  it('binds a mapping to an account when the user has one', () => {
    account('acc-1')
    const saved = saveMapping(
      db,
      { name: 'Cal', accountId: 'acc-1', headerSignature: 'sig-a', mapping: draftMapping() },
      1000,
    )
    expect(findMappingById(db, saved.id)?.accountId).toBe('acc-1')
  })

  /**
   * The binding is what stops the mappings screen saying "ask each time", and
   * the mapper only knows an account when the file resolved to one. A save that
   * says nothing about the account must therefore not be read as "no account".
   */
  it('keeps the binding when a later save says nothing about the account', () => {
    account('acc-1')
    const saved = saveMapping(
      db,
      { name: 'Cal', accountId: 'acc-1', headerSignature: 'sig-a', mapping: draftMapping() },
      1000,
    )

    saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 2000)

    expect(findMappingById(db, saved.id)?.accountId).toBe('acc-1')
  })

  it('rebinds when a save names a different account', () => {
    account('acc-1')
    account('acc-2')
    const saved = saveMapping(
      db,
      { name: 'Cal', accountId: 'acc-1', headerSignature: 'sig-a', mapping: draftMapping() },
      1000,
    )

    saveMapping(
      db,
      { name: 'Cal', accountId: 'acc-2', headerSignature: 'sig-a', mapping: draftMapping() },
      2000,
    )

    expect(findMappingById(db, saved.id)?.accountId).toBe('acc-2')
  })

  it('binds and unbinds from the mappings screen', () => {
    account('acc-1')
    const saved = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)

    setMappingAccount(db, saved.id, 'acc-1', 2000)
    expect(findMappingById(db, saved.id)?.accountId).toBe('acc-1')

    // "Ask each time" again — the one way a binding is deliberately cleared.
    setMappingAccount(db, saved.id, undefined, 3000)
    expect(findMappingById(db, saved.id)?.accountId).toBeUndefined()
  })

  it('carries the binding onto a duplicate, since a copy reads the same files', () => {
    account('acc-1')
    const source = saveMapping(
      db,
      { name: 'Cal', accountId: 'acc-1', headerSignature: 'sig-a', mapping: draftMapping() },
      1000,
    )

    expect(duplicateMapping(db, source.id, 2000)?.accountId).toBe('acc-1')
  })

  describe('the mappings screen', () => {
    it('renames a mapping without touching what it reads', () => {
      const saved = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)

      renameMapping(db, saved.id, 'כאל ויזה 4321', 2000)

      const loaded = findMappingById(db, saved.id)
      expect(loaded?.name).toBe('כאל ויזה 4321')
      expect(loaded?.mapping).toEqual(draftMapping())
      expect(loaded?.headerSignature).toBe('sig-a')
    })

    it('duplicates a mapping under a fresh name, format and all', () => {
      const source = saveMapping(
        db,
        { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() },
        1000,
      )

      const copy = duplicateMapping(db, source.id, 2000)

      expect(copy?.id).not.toBe(source.id)
      expect(copy?.name).toBe('Cal (copy)')
      // The same format, deliberately: a copy that matched nothing would be
      // unreachable, since a mapping cannot be picked by hand.
      expect(copy?.headerSignature).toBe('sig-a')
      expect(findMappingById(db, copy?.id ?? '')?.mapping).toEqual(draftMapping())
      expect(listMappings(db)).toHaveLength(2)
    })

    it('gives the copy no usage of its own', () => {
      const source = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
      recordMappingUse(db, source.id, 2000)

      const copy = duplicateMapping(db, source.id, 3000)

      // Or the copy would outrank the mapping that did the importing, and win
      // the tiebreak between two rows claiming one format.
      expect(copy?.useCount).toBe(0)
      expect(copy?.lastUsedAt).toBeUndefined()
      expect(listMappings(db).map((mapping) => mapping.name)).toEqual(['Cal', 'Cal (copy)'])
    })

    it('numbers a copy of a copy rather than stacking suffixes', () => {
      const source = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
      const first = duplicateMapping(db, source.id, 2000)

      expect(duplicateMapping(db, first?.id ?? '', 3000)?.name).toBe('Cal (copy 2)')
      expect(duplicateMapping(db, source.id, 4000)?.name).toBe('Cal (copy 3)')
    })

    it('does nothing when asked to duplicate a mapping that is not there', () => {
      expect(duplicateMapping(db, 'no-such-id', 1000)).toBeUndefined()
      expect(listMappings(db)).toHaveLength(0)
    })

    it('deletes one mapping and leaves the rest alone', () => {
      const doomed = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
      saveMapping(db, { name: 'Max', headerSignature: 'sig-b', mapping: draftMapping() }, 1000)

      deleteMapping(db, doomed.id, 2000)

      expect(listMappings(db).map((mapping) => mapping.name)).toEqual(['Max'])
      expect(findMappingById(db, doomed.id)).toBeUndefined()
    })

    it('leaves a deleted format to be guessed at, exactly as an unmapped one is', () => {
      // f01, "Mapping deleted while files still use it": the next import falls
      // back to guessing. That is what makes delete safe enough to need no guard.
      const saved = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)

      deleteMapping(db, saved.id, 2000)

      expect(findMappingBySignature(db, 'sig-a')).toBeUndefined()
    })

    it('removes it, and a statement it read names no mapping rather than one that is gone (D-277)', () => {
      const saved = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
      account('acc-1')
      db.run(
        `INSERT INTO fmt_statement
           (id, account, mapping, file_name, file_hash, status, started, rows_total, rows_new,
            rows_duplicate, rows_failed)
         VALUES ('ses-1', 'acc-1', ?, 'cal.xlsx', 'hash', 'COMMITTED', '1970-01-01T00:00:01.000Z', 0, 0, 0, 0)`,
        [saved.id],
      )

      deleteMapping(db, saved.id, 2000)

      expect(query(db, 'SELECT id FROM fmt_import_mapping')).toEqual([])
      expect(query(db, "SELECT mapping, file_name FROM fmt_statement WHERE id = 'ses-1'")[0]).toEqual({
        mapping: null,
        file_name: 'cal.xlsx',
      })
    })

    it('frees the signature, so re-mapping the format makes a new mapping', () => {
      const saved = saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
      deleteMapping(db, saved.id, 2000)

      const remade = saveMapping(db, { name: 'Cal again', headerSignature: 'sig-a', mapping: draftMapping() }, 3000)

      expect(remade.id).not.toBe(saved.id)
      expect(listMappings(db).map((mapping) => mapping.name)).toEqual(['Cal again'])
    })
  })

  describe('a row that no longer decodes', () => {
    // The document is a real SQLite file the user owns and can open in any
    // tool. A mapping that has been mangled must not take the import down with
    // it — f01 is explicit that a missing mapping falls back to guessing.

    beforeEach(() => {
      saveMapping(db, { name: 'Good', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
      saveMapping(db, { name: 'Bad', headerSignature: 'sig-b', mapping: draftMapping() }, 1000)
    })

    it('is skipped when its column roles are not JSON', () => {
      db.run("UPDATE fmt_import_mapping SET column_roles = 'not json' WHERE name = 'Bad'")
      expect(listMappings(db).map((mapping) => mapping.name)).toEqual(['Good'])
    })

    it('cannot hold an amount convention this build does not know', () => {
      // The guard was the decoder's while the column carried no CHECK (001).
      // A declared enum is checked by the table itself since M25 U3b.
      expect(() =>
        db.run("UPDATE fmt_import_mapping SET amount_convention = 'NET_OF_VAT' WHERE name = 'Bad'"),
      ).toThrow()
      expect(listMappings(db).map((mapping) => mapping.name).sort()).toEqual(['Bad', 'Good'])
    })

    it('keeps a mapping that reads a bank statement, now that the column is one of three', () => {
      db.run("UPDATE fmt_import_mapping SET amount_convention = 'SEPARATE_DEBIT_CREDIT' WHERE name = 'Bad'")
      expect(findMappingBySignature(db, 'sig-b')?.mapping.amountConvention).toBe(
        'SEPARATE_DEBIT_CREDIT',
      )
    })

    it('keeps the roles it understands and drops only the ones it does not', () => {
      // A newer build may have written a role this one has not heard of. The
      // rest of the mapping is still worth having.
      db.run(`UPDATE fmt_import_mapping SET column_roles = '{"0":"date","1":"merchant","2":"vatRate","5":"amount"}' WHERE name = 'Bad'`)
      const loaded = findMappingBySignature(db, 'sig-b')
      expect([...(loaded?.mapping.columnRoles.entries() ?? [])]).toEqual([
        [0, 'date'],
        [1, 'merchant'],
        [5, 'amount'],
      ])
    })
  })

  it('writes the roles as a readable map, since the file is the user\'s to open', () => {
    saveMapping(db, { name: 'Cal', headerSignature: 'sig-a', mapping: draftMapping() }, 1000)
    const stored = query(db, 'SELECT column_roles FROM fmt_import_mapping')[0]?.['column_roles']
    expect(stored).toBe('{"0":"date","1":"merchant","5":"amount","9":"chargeDate"}')
  })
})
