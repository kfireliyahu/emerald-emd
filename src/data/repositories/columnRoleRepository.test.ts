import { describe, expect, it } from 'vitest'

import {
  isDepositRole,
  isStatementRole,
  ROLE_VOCABULARIES,
  SEEDED_ROLES,
  roleRejection,
  type RoleVocabulary,
} from '@/domain/model/columnRoles.ts'
import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import { listMappings, saveMapping } from './importMappingRepository.ts'
import { addColumnRole, columnRoleIds, listColumnRoles } from './columnRoleRepository.ts'

describe('the seeded vocabularies', () => {
  it('are in the document, and are exactly what the build shipped', async () => {
    // **The assertion U1 exists to make true.** Migration 031 moved four `const`
    // arrays into the document; if the rows and the arrays ever disagree, a
    // model is being asked with a list nothing in the code understands. Same
    // members, same order, every reading.
    const db = await createLedgerDatabase()

    for (const vocabulary of ROLE_VOCABULARIES) {
      expect(columnRoleIds(db, vocabulary), vocabulary).toEqual([...SEEDED_ROLES[vocabulary]])
    }
  })

  it('are all SEEDED, because seeded means a reader narrows on it', async () => {
    const db = await createLedgerDatabase()

    for (const row of listColumnRoles(db, 'DEPOSIT')) {
      expect(row.origin).toBe('SEEDED')
    }
  })

  it('keeps ignore in every reading, because a role is positional', async () => {
    const db = await createLedgerDatabase()
    for (const vocabulary of ['DEPOSIT'] satisfies RoleVocabulary[]) {
      expect(listColumnRoles(db, vocabulary).map((row) => row.role), vocabulary).toContain('ignore')
    }
  })
})

describe('adding a role', () => {
  it('is what fixes the class of bug D-208 reported', async () => {
    // The whole unit in one test: a real statement printed עלות הרכישה, the
    // vocabulary had no name for it, and a model put it in `value` — reading a
    // portfolio ₪3,639.15 light. Now the name can exist without a new binary.
    const db = await createLedgerDatabase()

    const added = addColumnRole(db, 'DEPOSIT', 'cost', 100)

    expect(added.kind).toBe('added')
    expect(columnRoleIds(db, 'DEPOSIT')).toContain('cost')
  })

  it('sorts after the seeded ones, so a model sees the shipped order first', async () => {
    const db = await createLedgerDatabase()
    const before = columnRoleIds(db, 'DEPOSIT')

    addColumnRole(db, 'DEPOSIT', 'cost', 100)

    expect(columnRoleIds(db, 'DEPOSIT')).toEqual([...before, 'cost'])
  })

  it('is always USER, because no row can make a reader narrow on it', async () => {
    const db = await createLedgerDatabase()

    const added = addColumnRole(db, 'DEPOSIT', 'cost', 100)

    expect(added.kind === 'added' && added.row.origin).toBe('USER')
  })

  it('does not reach the code, which is what named-not-stored means', async () => {
    // D-211. `isDepositRole` is the guard every reader asks before touching a
    // cell, so an added role cannot reach a `switch` — in the type system as
    // well as in prose.
    const db = await createLedgerDatabase()
    addColumnRole(db, 'DEPOSIT', 'cost', 100)

    expect(isDepositRole('cost')).toBe(false)
    expect(isDepositRole('salary')).toBe(true)
  })

  it('refuses a duplicate, in either origin', async () => {
    const db = await createLedgerDatabase()

    expect(addColumnRole(db, 'DEPOSIT', 'salary', 100).kind).toBe('rejected')

    addColumnRole(db, 'DEPOSIT', 'cost', 100)
    const twice = addColumnRole(db, 'DEPOSIT', 'cost', 200)
    expect(twice.kind === 'rejected' && twice.reason).toContain('cost')
  })

  it('is per reading, so the same word can mean two things', async () => {
    // A role is unique within its vocabulary and says nothing about the others.
    const db = await createLedgerDatabase()

    expect(addColumnRole(db, 'STATEMENT', 'cost', 100).kind).toBe('added')
    expect(addColumnRole(db, 'DEPOSIT', 'cost', 100).kind).toBe('added')
  })

  it('refuses anything a grammar would have to escape', async () => {
    // A role goes into a JSON Schema `enum` and comes back out of a constrained
    // decoder. A quote or a space is the shape that truncated `סה"כ ברוטו` at
    // its gershayim (D-137), so it is refused at the form rather than debugged
    // six months later.
    const db = await createLedgerDatabase()

    for (const bad of ['עלות', 'purchase cost', 'Cost', 'sah"kol', '', '  ', 'x'.repeat(40)]) {
      expect(addColumnRole(db, 'DEPOSIT', bad, 100).kind, bad).toBe('rejected')
    }
  })

  it('trims, so a stray space is not a different role', async () => {
    const db = await createLedgerDatabase()

    const added = addColumnRole(db, 'DEPOSIT', '  cost  ', 100)

    expect(added.kind === 'added' && added.row.role).toBe('cost')
  })
})

describe('roleRejection', () => {
  it('says why, because the caller prints it rather than re-words it', () => {
    expect(roleRejection('', [])).toBe('A role needs a name.')
    expect(roleRejection('has space', [])).toContain('letters and digits')
    expect(roleRejection('cost', [])).toBeUndefined()
  })
})

describe('the statement vocabulary', () => {
  it('still carries the three the importer requires', async () => {
    // Requiredness is a property of the reading rather than of the vocabulary,
    // so `REQUIRED_ROLES` stayed in code — but the names it points at now live
    // in the document, and a seed that dropped one would break every import.
    const db = await createLedgerDatabase()
    const roles = columnRoleIds(db, 'STATEMENT')

    for (const required of ['date', 'amount', 'merchant']) {
      expect(roles, required).toContain(required)
      expect(isStatementRole(required)).toBe(true)
    }
  })
})

describe('a mapping that names an added role', () => {
  /** The smallest thing `saveMapping` will take, with one added role on it. */
  const draft = (role: string) => ({
    sheetName: 'Sheet1',
    headerRowIndex: 0,
    dataStartRowIndex: 1,
    columnRoles: new Map([
      [0, 'date'],
      [1, 'merchant'],
      [2, 'amount'],
      [3, role],
    ]),
    amountConvention: 'SIGNED_SINGLE' as const,
    dateOrders: new Map(),
    defaultCurrency: 'ILS' as const,
  })

  it('survives being written and read back', async () => {
    // **The failure U1b exists to prevent, and it would have been silent.**
    // Before this, `decode` filtered against the `const`: the column would map,
    // the mapping would save, and reopening the document would quietly drop it
    // — a role that reverts to unassigned every time the file is opened.
    const db = await createLedgerDatabase()
    addColumnRole(db, 'STATEMENT', 'settlementDate', 100)

    saveMapping(
      db,
      { name: 'Cal xlsx', headerSignature: 'a|b|c|d', mapping: draft('settlementDate') },
      100,
    )

    const read = listMappings(db)[0]
    expect(read?.mapping.columnRoles.get(3)).toBe('settlementDate')
  })

  it('still drops a role nothing declared, which is the check doing its job', async () => {
    // The filter did not go away; it changed what it filters against. A role no
    // document ever declared is still a role this build refuses to believe in.
    const db = await createLedgerDatabase()

    saveMapping(
      db,
      { name: 'Cal xlsx', headerSignature: 'a|b|c|d', mapping: draft('vendorTaxId') },
      100,
    )

    const read = listMappings(db)[0]
    expect(read?.mapping.columnRoles.has(3)).toBe(false)
    // The rest of the mapping is still worth having, which is why it is dropped
    // per column rather than failing the whole row.
    expect(read?.mapping.columnRoles.get(0)).toBe('date')
  })
})
