import { describe, expect, it } from 'vitest'

import { coerceValue } from './row.ts'
import { column, declarationRejection, type ColumnDeclaration, type FormatDeclaration } from './declaration.ts'
import { elsewhereText, parseElsewhere, pathFrom, readingOf, readingText } from './elsewhere.ts'

/** A row in another document — M47 U4, D-461. */

const ABOUT: ColumnDeclaration = column('about', 'elsewhere')

describe('a row in another document (M47 U4, D-461)', () => {
  it('is a path ending in .emd and the name of a row, in one spelling', () => {
    expect(parseElsewhere('F:/projects/site/site.emd S1 U5')).toEqual({
      ok: true,
      value: { path: 'F:/projects/site/site.emd', name: 'S1 U5' },
    })
    // A folder with a space, a Windows path, a `#`, and spaces to spare.
    const windows = parseElsewhere('  F:\\My Projects\\site.EMD#S1   U5 ')
    expect(windows).toEqual({ ok: true, value: { path: 'F:/My Projects/site.EMD', name: 'S1 U5' } })
    if (windows.ok) expect(elsewhereText(windows.value)).toBe('F:/My Projects/site.EMD S1 U5')
    expect(parseElsewhere('../site/site.emd D-27')).toEqual({ ok: true, value: { path: '../site/site.emd', name: 'D-27' } })
  })

  it('refuses a value with no document or no row, and says how to write one', () => {
    const noRow = parseElsewhere('F:/projects/site/site.emd')
    expect(noRow.ok).toBe(false)
    if (!noRow.ok) expect(noRow.error).toContain('no row in it')
    const prose = parseElsewhere('site S1 U5')
    expect(prose.ok).toBe(false)
    if (!prose.ok) expect(prose.error).toContain('F:/projects/site/site.emd S1 U5')
  })

  it('is written in its one spelling, and refused by its column when it is not one', () => {
    expect(coerceValue(ABOUT, 'F:\\projects\\site\\site.emd  S1 U5', undefined)).toEqual({
      ok: true,
      value: { about: 'F:/projects/site/site.emd S1 U5' },
    })
    const refused = coerceValue(ABOUT, 'S1 U5', undefined)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toMatch(/^about: /)
  })

  it('finds a relative path beside the holding document', () => {
    expect(pathFrom('../site/site.emd', 'F:/projects/planner/planner.emd')).toBe('F:/projects/site/site.emd')
    expect(pathFrom('site.emd', 'F:\\projects\\planner\\planner.emd')).toBe('F:/projects/planner/site.emd')
    expect(pathFrom('F:/elsewhere/x.emd', 'F:/projects/planner/planner.emd')).toBe('F:/elsewhere/x.emd')
    expect(pathFrom('site.emd', undefined)).toBeUndefined()
  })

  it('reads as the one row called that, and unresolved — never failed — otherwise', () => {
    const value = { path: 'F:/projects/site/site.emd', name: 'S1 U5' }
    expect(readingText(readingOf(value, [{ format: 'unit', name: 'S1 U5', state: 'built' }]))).toBe('unit S1 U5 · built')
    expect(readingText(readingOf(value, []))).toBe('unresolved — site.emd has no row called S1 U5')
    expect(
      readingText(
        readingOf(value, [
          { format: 'unit', name: 'S1 U5', state: 'built' },
          { format: 'decision', name: 'S1 U5', state: 'live' },
        ]),
      ),
    ).toBe('unresolved — site.emd has 2 rows called S1 U5, in unit, decision')
  })

  it('takes language 23, and no unit or target', () => {
    const problems = (language: number, about: ColumnDeclaration): string =>
      declarationRejection({
        language,
        name: 'inbox',
        title: 'Inbox',
        notes: '',
        identities: [],
        aggregates: [],
        nothingMustHold: true,
        columns: [column('subject', 'text'), about],
      } satisfies FormatDeclaration) ?? ''
    expect(problems(23, ABOUT)).toBe('')
    expect(problems(22, ABOUT)).toContain('format language 23')
    expect(problems(23, { ...ABOUT, target: 'unit' })).toContain('Leave out what it points at')
    expect(problems(23, { ...ABOUT, unit: 'g' })).toContain('Leave the unit out')
  })
})
