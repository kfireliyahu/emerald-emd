import { describe, expect, it } from 'vitest'

import type { ExportFileState } from '../../../electron/bridge.ts'
import { createDatabase } from '@/data/db/database.ts'
import { savedExportTexts } from '@/data/export/formatExport.ts'
import { keepPack, PACKS } from '@/data/packs/packs.ts'
import { adoptFormat, readFormat } from '@/data/repositories/formatRepository.ts'
import { insertRows } from '@/data/repositories/formatRowRepository.ts'
import { shellExports } from '@/data/storage/desktop.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { exportFiles, owedFiles, savedLines } from './savedLines.ts'

/**
 * **Settings › Export's saved exports** (M63 U4, D-605), on a made-up document:
 * a format of books, and the exports pack's rows naming three files — one the
 * shell finds current, one stale, one missing — and a fourth naming a format
 * the document has not got.
 */
const NOW = Date.UTC(2026, 10, 23)

const BOOK: FormatDeclaration = {
  language: 1,
  name: 'book',
  title: 'Book',
  notes: '',
  columns: [column('title', 'text', { required: true }), column('pages', 'integer')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function fixture() {
  const db = await createDatabase()
  const exports = PACKS.find((each) => each.id === 'exports')
  if (exports === undefined) throw new Error('no exports pack')
  expect(keepPack(db, exports, NOW).ok).toBe(true)
  expect(adoptFormat(db, BOOK, NOW).refusals).toEqual([])
  insertRows(db, BOOK, [
    { title: 'Dune', pages: 412 },
    { title: 'Emma', pages: 474 },
  ])
  const declaration = readFormat(db, 'export')
  if (declaration === undefined) throw new Error('export is not declared')
  insertRows(db, declaration, [
    { file: 'books.json', format: 'book' },
    { file: 'titles.json', format: 'book', columns: 'title' },
    { file: 'out/pages.json', format: 'book', columns: 'pages', order: 'pages', descending: 1 },
    { file: 'films.json', format: 'film' },
  ])
  return db
}

describe('saved exports on Settings › Export (M63 U4)', () => {
  it('shows current, stale and missing as the shell answers, and writes only the stale and the missing', async () => {
    const db = await fixture()
    const worked = savedExportTexts(db, { on: '2026-11-23' })
    if (!worked.ok) throw new Error(worked.error)
    const files = exportFiles(worked.value)
    expect(files.map((each) => each.file)).toEqual(['books.json', 'out/pages.json', 'titles.json'])
    expect(files.find((each) => each.file === 'titles.json')?.text).toBe(
      '[\n  {\n    "title": "Dune"\n  },\n  {\n    "title": "Emma"\n  }\n]\n',
    )

    const states = new Map<string, ExportFileState>([
      ['books.json', 'current'],
      ['out/pages.json', 'differs'],
      ['titles.json', 'missing'],
    ])
    const lines = savedLines(worked.value, states)
    expect(lines.map((line) => [line.file, line.word, line.tone])).toEqual([
      ['books.json', 'settings.export.saved.current', 'done'],
      ['films.json', 'settings.export.saved.refused', undefined],
      ['out/pages.json', 'settings.export.saved.differs', 'waiting'],
      ['titles.json', 'settings.export.saved.missing', 'waiting'],
    ])
    expect(lines[0]?.holds).toEqual({ rows: 2, format: 'book' })
    const film = lines[1]?.refusal
    expect(typeof film === 'object' ? film.said : film).toContain('no format called film')
    expect(owedFiles(files, states).map((each) => each.file)).toEqual(['out/pages.json', 'titles.json'])
  })

  it('says nothing of a file before the shell answers, and marks one it refused as outside the folder', async () => {
    const db = await fixture()
    const worked = savedExportTexts(db, { on: '2026-11-23' })
    if (!worked.ok) throw new Error(worked.error)
    const waiting = savedLines(worked.value, new Map())
    expect(waiting.filter((line) => line.holds !== undefined).every((line) => line.word === undefined)).toBe(true)
    expect(owedFiles(exportFiles(worked.value), new Map())).toEqual([])

    const refused = savedLines(worked.value, new Map([['books.json', 'refused' as const]]))
    expect(refused[0]).toMatchObject({ word: 'settings.export.saved.refused', refusal: 'outside' })
    expect(savedLines(worked.value, new Map([['books.json', 'written' as const]]))[0]?.word).toBe('settings.export.saved.current')
  })

  it('has no saved exports to write outside the desktop shell, so the browser build shows no section', () => {
    // `Export.tsx` draws the section only when the shell's bridge has `exports`.
    expect(shellExports()).toBeUndefined()
  })
})
