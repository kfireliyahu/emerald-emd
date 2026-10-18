import { describe, expect, it } from 'vitest'

import { createTableSql } from './ddl.ts'
import { column, declarationRejection, type ColumnDeclaration, type FormatDeclaration } from './declaration.ts'
import { fileNameOf, fileValueFor, fileWhere, parseFile, withFilesPlaced } from './file.ts'
import { coerceValue } from './row.ts'

/** A file on this computer, in a cell — M37 U6. Every path here is made up. */

const SCAN: ColumnDeclaration = column('scan', 'file')

function format(language: number, scan: ColumnDeclaration = SCAN): FormatDeclaration {
  return {
    language,
    name: 'receipt',
    title: 'Receipt',
    notes: '',
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    columns: [column('shop', 'text'), scan],
  }
}

describe('a file on this computer (M37 U6)', () => {
  it('is a path in one spelling, however it arrived', () => {
    expect(parseFile('C:\\work\\plans\\a.pdf')).toEqual({ ok: true, value: 'C:/work/plans/a.pdf' })
    // A file manager's copy-as-path wraps it in quotes.
    expect(parseFile('  "C:\\work\\plan b.pdf" ')).toEqual({ ok: true, value: 'C:/work/plan b.pdf' })
    expect(parseFile('file:///C:/work/plan%20b.pdf')).toEqual({ ok: true, value: 'C:/work/plan b.pdf' })
    expect(parseFile('file:///home/someone/a.pdf')).toEqual({ ok: true, value: '/home/someone/a.pdf' })
    expect(parseFile('scans/a.pdf')).toEqual({ ok: true, value: 'scans/a.pdf' })
    expect(parseFile('../shared/a.pdf')).toEqual({ ok: true, value: '../shared/a.pdf' })
  })

  it('takes a local app’s own address, and refuses a web address with the reason', () => {
    expect(parseFile('obsidian://open?vault=Notes&file=plan')).toEqual({ ok: true, value: 'obsidian://open?vault=Notes&file=plan' })
    for (const address of ['https://example.com/a.pdf', 'http://example.com']) {
      const refused = parseFile(address)
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.error).toContain('opening one is a request — Emerald makes none')
    }
    // An allowlist: a scheme nobody looked at is refused, not let through.
    for (const address of ['ftp://example.com/a', 'smb://host/a', 'mailto:someone@example.com', 'javascript:alert(1)']) {
      expect(parseFile(address).ok, address).toBe(false)
    }
  })

  it('refuses a file on another machine, and an empty one', () => {
    expect(parseFile('\\\\host\\share\\a.pdf').ok).toBe(false)
    expect(parseFile('//host/share/a.pdf').ok).toBe(false)
    expect(parseFile('file://host/share/a.pdf').ok).toBe(false)
    expect(parseFile('   ').ok).toBe(false)
    expect(parseFile('""').ok).toBe(false)
  })

  it('is kept beside the document when it is under its folder, and absolute otherwise', () => {
    const holder = 'C:/work/plans/plans.emd'
    expect(fileValueFor('C:\\work\\plans\\scans\\a.pdf', holder)).toBe('scans/a.pdf')
    // Windows's folders are one folder whatever their case.
    expect(fileValueFor('c:/Work/Plans/a.pdf', holder)).toBe('a.pdf')
    expect(fileValueFor('C:/work/other/a.pdf', holder)).toBe('C:/work/other/a.pdf')
    expect(fileValueFor('C:/work/plansb/a.pdf', holder)).toBe('C:/work/plansb/a.pdf')
    expect(fileValueFor('/home/someone/docs/a.pdf', '/home/someone/docs/d.emd')).toBe('a.pdf')
    expect(fileValueFor('/home/someone/Docs/a.pdf', '/home/someone/docs/d.emd')).toBe('/home/someone/Docs/a.pdf')
    // No holder (a page in a browser), an address, a relative path: as written.
    expect(fileValueFor('C:/work/plans/a.pdf', undefined)).toBe('C:/work/plans/a.pdf')
    expect(fileValueFor('obsidian://open?vault=Notes', holder)).toBe('obsidian://open?vault=Notes')
    expect(fileValueFor('https://example.com', holder)).toBe('https://example.com')
  })

  it('survives its folder being moved: a relative value is found beside wherever the document is now', () => {
    expect(fileWhere('scans/a.pdf', 'C:/work/plans/plans.emd')).toEqual({ kind: 'path', path: 'C:/work/plans/scans/a.pdf' })
    expect(fileWhere('scans/a.pdf', 'D:/moved/plans/plans.emd')).toEqual({ kind: 'path', path: 'D:/moved/plans/scans/a.pdf' })
    expect(fileWhere('scans/a.pdf', undefined)).toEqual({ kind: 'path', path: undefined })
    expect(fileWhere('C:/elsewhere/a.pdf', 'D:/moved/plans/plans.emd')).toEqual({ kind: 'path', path: 'C:/elsewhere/a.pdf' })
    expect(fileWhere('obsidian://open?vault=Notes', undefined)).toEqual({ kind: 'address', address: 'obsidian://open?vault=Notes' })
  })

  it('shows a path’s file name, and the note an address opens', () => {
    expect(fileNameOf('scans/a.pdf')).toBe('a.pdf')
    expect(fileNameOf('C:/work/plans/')).toBe('plans')
    expect(fileNameOf('obsidian://open?vault=Notes&file=Courses%2FWeek%201')).toBe('Week 1')
    expect(fileNameOf('obsidian://open?vault=Notes')).toBe('open?vault=Notes')
  })

  it('is written in its one spelling, refused by its column when it is not one — and a missing file is still written', () => {
    expect(coerceValue(SCAN, 'C:\\work\\nowhere\\gone.pdf', undefined)).toEqual({ ok: true, value: { scan: 'C:/work/nowhere/gone.pdf' } })
    const web = coerceValue(SCAN, 'https://example.com/a.pdf', undefined)
    expect(web.ok).toBe(false)
    if (!web.ok) expect(web.error).toMatch(/^scan: .*request/)
    expect(coerceValue(SCAN, 3, undefined).ok).toBe(false)
  })

  it('places every file cell of a batch, and touches nothing else', () => {
    const placed = withFilesPlaced(format(24), [{ shop: 'C:/work/plans/x', scan: 'C:/work/plans/a.pdf' }, { shop: 'b' }], 'C:/work/plans/plans.emd')
    expect(placed).toEqual([{ shop: 'C:/work/plans/x', scan: 'a.pdf' }, { shop: 'b' }])
  })

  it('compiles to text that may not be empty', () => {
    expect(createTableSql(format(24))).toContain(`length(trim("scan")) > 0`)
  })

  it('takes language 24, and no unit or target', () => {
    const problems = (language: number, scan: ColumnDeclaration = SCAN): string =>
      declarationRejection(format(language, scan)) ?? ''
    expect(problems(24)).toBe('')
    expect(problems(23)).toContain('format language 24')
    expect(problems(24, { ...SCAN, target: 'receipt' })).toContain('Leave out what it points at')
    expect(problems(24, { ...SCAN, unit: 'g' })).toContain('Leave the unit out')
  })
})
