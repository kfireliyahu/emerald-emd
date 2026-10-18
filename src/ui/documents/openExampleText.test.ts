import { describe, expect, it } from 'vitest'

import { readWorkbook } from '@/data/importer/sheetTable.ts'
import { EXAMPLE_SHEET_ROWS, sheetExcerpt } from '@/ui/documents/openExampleText.ts'

function workbook(csv: string) {
  return readWorkbook('example.csv', new TextEncoder().encode(csv))
}

function sheetOf(csv: string) {
  const sheet = workbook(csv).sheets[0]
  if (sheet === undefined) throw new Error('no sheet')
  return sheet
}

describe('sheetExcerpt', () => {
  it('shows the heading and a few rows, which is what says what the columns are', () => {
    const excerpt = sheetExcerpt(
      sheetOf('Book,Author,Finished\nDune,Herbert,2026-01-04\nSolaris,Lem,2026-02-11\n'),
    )
    expect(excerpt.split('\n')).toEqual([
      'Book | Author | Finished',
      'Dune | Herbert | 2026-01-04',
      'Solaris | Lem | 2026-02-11',
    ])
  })

  it('stops well short of a real file, because rows say nothing new about columns', () => {
    const rows = Array.from({ length: 400 }, (_, index) => `Book ${String(index)},Author,2026-01-04`)
    const excerpt = sheetExcerpt(sheetOf(['Book,Author,Finished', ...rows].join('\n')))
    expect(excerpt.split('\n')).toHaveLength(EXAMPLE_SHEET_ROWS)
  })

  it('drops the blank rows a spreadsheet leaves between its sections', () => {
    const excerpt = sheetExcerpt(sheetOf('Book,Author\n,\nDune,Herbert\n'))
    expect(excerpt.split('\n')).toEqual(['Book | Author', 'Dune | Herbert'])
  })
})
