/**
 * The gate a model's answer about a statement's columns goes through, and what
 * applying it does to a draft.
 *
 * A grammar was sent; a grammar is not a guarantee. Two rules here that a
 * template of line numbers does not need — **no role twice and no column
 * twice** — because a whole map arrives at once and a mapping with two `amount`
 * columns parses the wrong one.
 */

import { describe, expect, it } from 'vitest'

import { COLUMN_ROLES, type DraftMapping } from '@/domain/model/importing.ts'

import { applyColumnProposal, statementContext, toColumnProposal } from './columnProposal.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

const draft: DraftMapping = {
  sheetName: 'Sheet1',
  headerRowIndex: 2,
  dataStartRowIndex: 3,
  columnRoles: new Map([
    [0, 'date'],
    [3, 'amount'],
  ]),
  amountConvention: 'SIGNED_SINGLE',
  dateOrders: new Map(),
  defaultCurrency: 'ILS',
}

/** Cells are typed records in this app, not strings. */
function cells(values: readonly string[]): readonly SheetCell[] {
  return values.map((text) =>
    text === '' ? { kind: 'empty', text } : { kind: 'string', text, value: text },
  )
}

const table: SheetTable = {
  name: 'Sheet1',
  columnCount: 4,
  rows: [
    cells(['פירוט עסקאות']),
    cells([]),
    cells(['תאריך', 'שם בית עסק', 'אסמכתא', 'סכום חיוב']),
    cells(['01/07/2026', 'סופר פארם', '4821', '129.90']),
    cells(['', '', '', '']),
    cells(['02/07/2026', 'רמי לוי', '4822', '412.55']),
  ],
}

/**
 * The document's vocabulary, which for every test but the last is the seed
 * (D-213). `toColumnProposal` checks a model's answer against what the grammar
 * was built from, so the two have to be the same array.
 */
const propose = (value: unknown, roles: readonly string[] = COLUMN_ROLES) =>
  toColumnProposal(value, roles)

describe('toColumnProposal', () => {
  it('takes an answer of indexes and roles', () => {
    const proposal = propose({
      columns: [
        { index: 0, role: 'date' },
        { index: 1, role: 'merchant' },
        { index: 3, role: 'amount' },
      ],
      amountConvention: 'POSITIVE_IS_CHARGE',
    })

    expect(proposal?.amountConvention).toBe('POSITIVE_IS_CHARGE')
    expect(proposal?.columns).toEqual([
      { index: 0, role: 'date' },
      { index: 1, role: 'merchant' },
      { index: 3, role: 'amount' },
    ])
  })

  it('never lets one role land on two columns', () => {
    // The expensive shape: two `amount` columns is a mapping that parses the
    // wrong one, silently, on every row.
    const proposal = propose({
      columns: [
        { index: 2, role: 'amount' },
        { index: 3, role: 'amount' },
      ],
      amountConvention: 'SIGNED_SINGLE',
    })

    expect(proposal?.columns).toEqual([{ index: 3, role: 'amount' }])
  })

  it('never lets one column hold two roles', () => {
    const proposal = propose({
      columns: [
        { index: 1, role: 'merchant' },
        { index: 1, role: 'note' },
      ],
      amountConvention: 'SIGNED_SINGLE',
    })

    expect(proposal?.columns).toEqual([{ index: 1, role: 'note' }])
  })

  it('drops a role the app does not have, rather than inventing one', () => {
    // D-114's finding: unaided, a model asked to use an app's vocabulary invents
    // members of it. The vocabulary is preloaded and this is the second gate.
    const proposal = propose({
      columns: [
        { index: 0, role: 'date' },
        { index: 1, role: 'transactionDate' },
      ],
      amountConvention: 'SIGNED_SINGLE',
    })

    expect(proposal?.columns).toEqual([{ index: 0, role: 'date' }])
  })

  it('is nothing when no column survived, or the convention is not one', () => {
    expect(
      propose({ columns: [{ index: -1, role: 'date' }], amountConvention: 'SIGNED_SINGLE' }),
    ).toBeUndefined()
    expect(
      propose({ columns: [{ index: 0, role: 'date' }], amountConvention: 'GUESS' }),
    ).toBeUndefined()
    expect(propose({ columns: [] })).toBeUndefined()
    expect(propose('date is column 0')).toBeUndefined()
  })

  it('drops a cell value that arrived where an index belongs', () => {
    // Nothing in F17 lets a model produce a value, and this would be one.
    expect(
      propose({
        columns: [{ index: '129.90', role: 'amount' }],
        amountConvention: 'SIGNED_SINGLE',
      }),
    ).toBeUndefined()
  })
})

describe('applying one', () => {
  it('replaces the roles and the convention, and touches nothing else', () => {
    const applied = applyColumnProposal(draft, {
      columns: [
        { index: 0, role: 'date' },
        { index: 1, role: 'merchant' },
        { index: 3, role: 'amount' },
      ],
      amountConvention: 'POSITIVE_IS_CHARGE',
    })

    expect([...applied.columnRoles]).toEqual([
      [0, 'date'],
      [1, 'merchant'],
      [3, 'amount'],
    ])
    expect(applied.amountConvention).toBe('POSITIVE_IS_CHARGE')
    // Not what was asked about.
    expect(applied.headerRowIndex).toBe(2)
    expect(applied.dataStartRowIndex).toBe(3)
    expect(applied.defaultCurrency).toBe('ILS')
  })

  it('unassigns a column the proposal left out', () => {
    const applied = applyColumnProposal(draft, {
      columns: [{ index: 1, role: 'merchant' }],
      amountConvention: 'SIGNED_SINGLE',
    })

    // The old guess had `date` on column 0. Keeping it would mix two answers
    // into one map nobody gave.
    expect(applied.columnRoles.has(0)).toBe(false)
  })
})

describe('a role the document declared and this build has not', () => {
  it('is accepted, because it is in the list the model was given', () => {
    // The whole of U1b on this path (D-213). A model asked with a vocabulary
    // that includes `settlementDate` may answer with it, and refusing that here
    // would silently drop the one column the person added the role for (D-208).
    const proposal = propose(
      {
        columns: [
          { index: 0, role: 'date' },
          { index: 1, role: 'settlementDate' },
        ],
        amountConvention: 'SIGNED_SINGLE',
      },
      [...COLUMN_ROLES, 'settlementDate'],
    )

    expect(proposal?.columns).toContainEqual({ index: 1, role: 'settlementDate' })
  })

  it('is refused when nothing declared it, which is D-114 unchanged', () => {
    const proposal = propose({
      columns: [
        { index: 0, role: 'date' },
        { index: 1, role: 'vendorTaxId' },
      ],
      amountConvention: 'SIGNED_SINGLE',
    })

    expect(proposal?.columns).toEqual([{ index: 0, role: 'date' }])
  })
})

describe('what the model is shown', () => {
  it('is the header row and a few real rows, blanks skipped', () => {
    const context = statementContext(table, draft, COLUMN_ROLES)

    expect(context.headers).toEqual(['תאריך', 'שם בית עסק', 'אסמכתא', 'סכום חיוב'])
    // Four of them at most, and the blank row between them is not one.
    expect(context.sampleRows).toHaveLength(2)
    expect(context.sampleRows[1]).toEqual(['02/07/2026', 'רמי לוי', '4822', '412.55'])
  })

  it('shows rows rather than describing them, which is the whole advantage', () => {
    // `4821` under `אסמכתא` looks like an amount to a string matcher. It does
    // not to anything that can read four of them in a row — D-114 measured
    // exactly that mistake in `headerAliases.ts`.
    const context = statementContext(table, draft, COLUMN_ROLES)
    expect(context.sampleRows[0]?.[2]).toBe('4821')
  })
})
