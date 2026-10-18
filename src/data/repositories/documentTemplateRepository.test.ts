/**
 * The template store: what survives a re-derivation, what a person has to agree
 * to before anything reads a document with it, and what a mangled row does.
 */

import { describe, expect, it } from 'vitest'

import { computeLabelSignature } from '../importer/labelTemplate.ts'
import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import {
  deductionsOf,
  type FundReportTemplate,
  type PayslipTemplate,
} from '@/domain/model/templates.ts'
import {
  correctTemplateField,
  deleteTemplate,
  findTemplateById,
  findTemplateBySignature,
  listTemplates,
  nameDeductionRows,
  readableTemplates,
  recordTemplateUse,
  renameTemplate,
  saveTemplate,
} from './documentTemplateRepository.ts'

const NOW = 1_755_000_000_000
const SIGNATURE = computeLabelSignature(
  // Built rather than typed: a signature joins on U+001F, and a control
  // character pasted into a source file is one nobody reviewing it can see.
  ['סה"כ ברוטו 24,500.00', 'נטו לתשלום 17,987.50', 'פנסיה 24,500.00 1,470.00'].join('\n'),
)

function template(overrides: Partial<PayslipTemplate> = {}): PayslipTemplate {
  return {
    shape: 'payslip',
    fields: [
      { field: 'grossLine', label: 'סה"כ ברוטו', occurrence: 0, derivedLine: 15 },
      { field: 'netLine', label: 'נטו לתשלום', occurrence: 0, derivedLine: 33 },
    ],
    deductions: [
      {
        field: 'deduction[0]',
        label: 'פנסיה',
        occurrence: 0,
        derivedLine: 24,
        hasEmployerColumn: true,
        hasBasisColumn: true,
      },
    ],
    ...overrides,
  }
}

async function documentWithTemplate(confirmed = false) {
  const db = await createLedgerDatabase()
  const saved = saveTemplate(
    db,
    {
      kind: 'PAYSLIP',
      name: 'Software Labs',
      labelSignature: SIGNATURE,
      anchors: template(),
      derivedBy: 'LOCAL_MODEL',
      confirmed,
    },
    NOW,
  )
  return { db, saved }
}

describe('saving and reading back', () => {
  it('round-trips a template with its anchors and its Hebrew intact', async () => {
    const { db, saved } = await documentWithTemplate()

    const found = findTemplateBySignature(db, 'PAYSLIP', SIGNATURE)
    expect(found?.id).toBe(saved.id)
    expect(found?.name).toBe('Software Labs')
    expect(found?.version).toBe(1)
    expect(found?.derivedBy).toBe('LOCAL_MODEL')
    expect(found?.anchors.fields[0]?.label).toBe('סה"כ ברוטו')
    expect(deductionsOf(found!.anchors)[0]).toMatchObject({
      label: 'פנסיה',
      hasEmployerColumn: true,
      hasBasisColumn: true,
    })
  })

  it('arrives unconfirmed, and is not readable until someone says so', async () => {
    const { db, saved } = await documentWithTemplate()

    expect(saved.confirmedAt).toBeUndefined()
    expect(readableTemplates(db, 'PAYSLIP')).toEqual([])
    // Listed, though: an unconfirmed template is a proposal, not a secret.
    expect(listTemplates(db, 'PAYSLIP')).toHaveLength(1)

    const agreed = await documentWithTemplate(true)
    expect(readableTemplates(agreed.db, 'PAYSLIP').map((entry) => entry.id)).toEqual([agreed.saved.id])
  })

  it('counts a use when a document was actually read', async () => {
    const { db, saved } = await documentWithTemplate()

    recordTemplateUse(db, saved.id, NOW + 5)
    const found = findTemplateById(db, saved.id)
    expect(found?.useCount).toBe(1)
    expect(found?.lastUsedAt).toBe(NOW + 5)
  })

  it('keeps a deleted template out of every list', async () => {
    const { db, saved } = await documentWithTemplate()

    deleteTemplate(db, saved.id, NOW + 5)
    expect(listTemplates(db)).toEqual([])
    expect(findTemplateBySignature(db, 'PAYSLIP', SIGNATURE)).toBeUndefined()
  })
})

describe('re-deriving a format that changed', () => {
  it('supersedes rather than overwrites, so last year’s slip keeps its map', async () => {
    const { db, saved } = await documentWithTemplate(true)

    const moved = template({
      fields: [
        { field: 'grossLine', label: 'ברוטו לתשלום', occurrence: 0, derivedLine: 18 },
        { field: 'netLine', label: 'נטו לתשלום', occurrence: 0, derivedLine: 40 },
      ],
    })
    const second = saveTemplate(
      db,
      {
        kind: 'PAYSLIP',
        name: 'ignored',
        labelSignature: SIGNATURE,
        anchors: moved,
        derivedBy: 'LOCAL_MODEL',
      },
      NOW + 100,
    )

    expect(second.version).toBe(2)
    // The name the user gave the format is not a casualty of the format moving.
    expect(second.name).toBe('Software Labs')
    // And it is a proposal again: what was agreed to was the old anchors.
    expect(second.confirmedAt).toBeUndefined()

    expect(findTemplateBySignature(db, 'PAYSLIP', SIGNATURE)?.id).toBe(second.id)
    expect(listTemplates(db, 'PAYSLIP')).toHaveLength(1)

    const first = findTemplateById(db, saved.id)
    expect(first?.version).toBe(1)
    expect(first?.supersededAt).toBe(NOW + 100)
    expect(first?.anchors.fields[0]?.label).toBe('סה"כ ברוטו')
  })

  it('carries a corrected field over instead of proposing the mistake again', async () => {
    const { db, saved } = await documentWithTemplate()

    // The user moves net to where it actually is, which pins it.
    const corrected = correctTemplateField(
      db,
      saved.id,
      { field: 'netLine', label: 'שולם בפועל', occurrence: 0, derivedLine: 34 },
      NOW + 10,
    )
    expect(corrected?.pinnedFields).toEqual(['netLine'])
    expect(corrected?.anchors.fields[1]?.label).toBe('שולם בפועל')

    // A fresh derivation proposes the old, wrong label again.
    const second = saveTemplate(
      db,
      {
        kind: 'PAYSLIP',
        name: 'Software Labs',
        labelSignature: SIGNATURE,
        anchors: template(),
        derivedBy: 'LOCAL_MODEL',
      },
      NOW + 20,
    )

    const net = second.anchors.fields.find((field) => field.field === 'netLine')
    expect(net?.label).toBe('שולם בפועל')
    expect(second.pinnedFields).toEqual(['netLine'])
    // What was not corrected re-derives freely.
    expect(second.anchors.fields.find((field) => field.field === 'grossLine')?.label).toBe(
      'סה"כ ברוטו',
    )
  })

  it('keeps a pinned field the fresh derivation lost', async () => {
    const { db, saved } = await documentWithTemplate()
    correctTemplateField(
      db,
      saved.id,
      { field: 'employeeDeductionsTotalLine', label: 'סה"כ ניכויים', occurrence: 0, derivedLine: 30 },
      NOW + 10,
    )

    const second = saveTemplate(
      db,
      {
        kind: 'PAYSLIP',
        name: 'Software Labs',
        labelSignature: SIGNATURE,
        anchors: template(),
        derivedBy: 'PLUGIN',
      },
      NOW + 20,
    )

    expect(
      second.anchors.fields.find((field) => field.field === 'employeeDeductionsTotalLine')?.label,
    ).toBe('סה"כ ניכויים')
  })

  it('renames without touching anything else', async () => {
    const { db, saved } = await documentWithTemplate()
    renameTemplate(db, saved.id, 'מעבדות תוכנה', NOW + 1)
    expect(findTemplateById(db, saved.id)?.name).toBe('מעבדות תוכנה')
  })
})

describe('naming a deduction row against the format', () => {
  it('stores what the user said the row is, and pins it', async () => {
    const { db, saved } = await documentWithTemplate()

    const named = nameDeductionRows(db, saved.id, new Map([['deduction[0]', 'ded:pension']]), NOW)

    expect(deductionsOf(named!.anchors)[0]?.deductionTypeId).toBe('ded:pension')
    expect(named?.pinnedFields).toContain('deduction[0]')
    // And it survives the round trip through the JSON column, which is the
    // half that would silently drop it.
    expect(deductionsOf(findTemplateById(db, saved.id)!.anchors)[0]?.deductionTypeId).toBe(
      'ded:pension',
    )
  })

  it('carries the naming across a re-derivation rather than losing it', async () => {
    const { db, saved } = await documentWithTemplate()
    nameDeductionRows(db, saved.id, new Map([['deduction[0]', 'ded:pension']]), NOW)

    // The format changed elsewhere, so it re-derives whole — and a deriver
    // never names a row (D-132), so the fresh anchors have none.
    const second = saveTemplate(
      db,
      {
        kind: 'PAYSLIP',
        name: 'Software Labs',
        labelSignature: SIGNATURE,
        anchors: template(),
        derivedBy: 'LOCAL_MODEL',
      },
      NOW + 1,
    )

    expect(deductionsOf(second.anchors)[0]?.deductionTypeId).toBe('ded:pension')
  })

  it('ignores a naming for a row the template does not have', async () => {
    const { db, saved } = await documentWithTemplate()

    const named = nameDeductionRows(db, saved.id, new Map([['deduction[7]', 'ded:pension']]), NOW)

    expect(deductionsOf(named!.anchors)).toHaveLength(1)
    expect(named?.pinnedFields).not.toContain('deduction[7]')
  })
})

describe('a row this build cannot read', () => {
  it('skips a template whose anchors are not JSON, rather than throwing', async () => {
    const { db, saved } = await documentWithTemplate()
    db.run('UPDATE fmt_document_template SET anchors = ? WHERE id = ?', ['{not json', saved.id])

    expect(listTemplates(db)).toEqual([])
  })

  it('skips a kind it has no shape for', async () => {
    const { db, saved } = await documentWithTemplate()
    db.run('UPDATE fmt_document_template SET kind = ? WHERE id = ?', ['FUND_REPORT', saved.id])

    expect(listTemplates(db)).toEqual([])
  })

  it('drops an anchor with no label and keeps the rest of the template', async () => {
    const { db, saved } = await documentWithTemplate()
    db.run('UPDATE fmt_document_template SET anchors = ? WHERE id = ?', [
      JSON.stringify({
        shape: 'payslip',
        fields: [
          { field: 'grossLine', label: 'סה"כ ברוטו', occurrence: 0, derivedLine: 15 },
          { field: 'netLine', occurrence: 0, derivedLine: 33 },
        ],
        deductions: [],
      }),
      saved.id,
    ])

    const found = findTemplateById(db, saved.id)
    expect(found?.anchors.fields.map((field) => field.field)).toEqual(['grossLine'])
  })

  it('skips a template that has no anchors left at all', async () => {
    const { db, saved } = await documentWithTemplate()
    db.run('UPDATE fmt_document_template SET anchors = ? WHERE id = ?', [
      JSON.stringify({ shape: 'payslip', fields: [], deductions: [] }),
      saved.id,
    ])

    expect(listTemplates(db)).toEqual([])
  })

  it('reads a pinned list that is not a list as no pins', async () => {
    const { db, saved } = await documentWithTemplate()
    db.run('UPDATE fmt_document_template SET pinned_fields = ? WHERE id = ?', ['nonsense', saved.id])

    expect(findTemplateById(db, saved.id)?.pinnedFields).toEqual([])
  })
})

describe('a table of rows with no labels survives being written and read back', () => {
  /**
   * **The half that used to be dropped.** The write side has always stored
   * `anchors` whole with `JSON.stringify`; the read side decoded only `fields`,
   * so a deposit table survived being written and did not survive being read.
   * Nothing failed visibly — rung 1 executed a template that had forgotten where
   * its table was, and came back with no deposit rows, which is also what a
   * report with no deposit table looks like. Found by adding a second shape that
   * needed the same code (D-188).
   */
  it('keeps a fund report’s deposit table, heading and column order both', async () => {
    const db = await createLedgerDatabase()
    const anchors: FundReportTemplate = {
      shape: 'fundReport',
      fields: [
        { field: 'closingBalanceLine', label: 'יתרת סגירה', occurrence: 0, derivedLine: 17 },
      ],
      depositTable: {
        header: { field: 'depositTable', label: 'פירוט ההפקדות', occurrence: 0, derivedLine: 31 },
        columns: [
          { index: 0, role: 'employerName' },
          { index: 1, role: 'salaryMonth' },
          { index: 2, role: 'employee' },
        ],
      },
    }

    saveTemplate(
      db,
      {
        kind: 'FUND_REPORT',
        name: 'Menora quarterly',
        labelSignature: 'lv12ab',
        anchors,
        derivedBy: 'LOCAL_MODEL',
        confirmed: true,
      },
      1000,
    )

    expect(readableTemplates(db, 'FUND_REPORT')[0]?.anchors).toEqual(anchors)
  })

})

describe('a fund report is the same store, one shape shorter', () => {
  it('round-trips a fund-report template and keeps it apart from the payslips', async () => {
    const db = await createLedgerDatabase()
    const anchors: FundReportTemplate = {
      shape: 'fundReport',
      fields: [
        { field: 'closingBalanceLine', label: 'יתרת סגירה', occurrence: 0, derivedLine: 17 },
        { field: 'feesLine', label: 'דמי ניהול מהצבירה', occurrence: 0, derivedLine: 15 },
      ],
    }

    saveTemplate(
      db,
      {
        kind: 'FUND_REPORT',
        name: 'Menora quarterly',
        labelSignature: 'lv12ab',
        anchors,
        derivedBy: 'LOCAL_MODEL',
        confirmed: true,
      },
      1000,
    )

    const reports = readableTemplates(db, 'FUND_REPORT')
    expect(reports).toHaveLength(1)
    expect(reports[0]?.anchors).toEqual(anchors)
    // A payslip surface asking for its own kind never sees it.
    expect(readableTemplates(db, 'PAYSLIP')).toEqual([])
    // And the one list that shows everything does.
    expect(listTemplates(db)).toHaveLength(1)
  })

  it('does not decode a row whose kind and shape disagree', async () => {
    const db = await createLedgerDatabase()
    saveTemplate(
      db,
      {
        kind: 'FUND_REPORT',
        name: 'Mislabelled',
        labelSignature: 'lv12ab',
        // A payslip's anchors stored under a report's kind: nothing can execute
        // this safely, so it is skipped and the ladder falls to the next rung.
        anchors: template(),
        derivedBy: 'LOCAL_MODEL',
        confirmed: true,
      },
      1000,
    )

    expect(listTemplates(db)).toEqual([])
    expect(readableTemplates(db, 'FUND_REPORT')).toEqual([])
  })

  it('has no rows to name, so naming one changes nothing', async () => {
    const db = await createLedgerDatabase()
    const saved = saveTemplate(
      db,
      {
        kind: 'FUND_REPORT',
        name: 'Menora quarterly',
        labelSignature: 'lv12ab',
        anchors: {
          shape: 'fundReport',
          fields: [
            { field: 'closingBalanceLine', label: 'יתרת סגירה', occurrence: 0, derivedLine: 17 },
          ],
        },
        derivedBy: 'LOCAL_MODEL',
        confirmed: true,
      },
      1000,
    )

    const after = nameDeductionRows(db, saved.id, new Map([['closingBalanceLine', 'ded:x']]), 2000)
    expect(after?.pinnedFields).toEqual([])
    expect(findTemplateById(db, saved.id)?.anchors).toEqual(saved.anchors)
  })
})
