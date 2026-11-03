/**
 * **A column's width is one width for the format, dragged wherever its
 * columns are drawn** — M55 F1, D-558.
 *
 * The format's table, its saved table tab and a saved table placed on a
 * dashboard draw the same stored width (`format_column_view`, D-289) and wear
 * the same handle, which writes it back there; a reset clears it everywhere;
 * read-only draws the widths with no handle. The dashboard is rendered as
 * markup and read; the table's and the tab's half is the screen's own source,
 * which reads and writes the same store.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'

import { createDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { insertRows } from '@/data/repositories/formatRowRepository.ts'
import { columnWidths, saveView, setColumnWidth, setDashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { DashboardView } from './Dashboard.tsx'
import { ReadOnly } from './readOnly.ts'
import { defaultWidth } from './ResizeHandle.tsx'

// Markup reads a store's first state, so the dashboard reads this one instead.
const store = vi.hoisted(() => ({ state: { db: undefined as unknown, revision: 1, mutate: () => undefined } }))
vi.mock('@/state/documentStore.ts', () => ({
  useDocumentStore: (select: (state: typeof store.state) => unknown) => select(store.state),
}))

const NOW = Date.UTC(2026, 10, 3)

const CHARGE: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'charge',
  title: 'Charge',
  notes: '',
  columns: [column('merchant', 'text', { required: true }), column('day', 'date'), column('note', 'text')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function document(): Promise<Database> {
  const db = await createDatabase()
  expect(adoptFormat(db, CHARGE, NOW).refusals).toEqual([])
  insertRows(db, CHARGE, [{ merchant: 'Corner shop', day: '2026-10-25', note: 'milk' }])
  saveView(db, { format: 'charge', name: 'All', kind: 'table', address: '' })
  // Three columns wide, so the block shows every column of the view.
  setDashboardBlocks(db, 'charge', [{ dashboard: 'charge', format: 'charge', kind: 'saved', name: 'All', address: '', width: 3 }])
  return db
}

function dashboard(db: Database, readOnly?: string): string {
  store.state.db = db
  const view = createElement(DashboardView, { dashboard: 'charge' })
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/formats/charge/dashboard'] },
      readOnly === undefined ? view : createElement(ReadOnly.Provider, { value: readOnly }, view),
    ),
  )
}

/** The table block's columns' widths, in order. */
function cols(markup: string): readonly number[] {
  const group = /<colgroup>([\s\S]*?)<\/colgroup>/.exec(markup)?.[1] ?? ''
  return [...group.matchAll(/width:(\d+)px/g)].map((match) => Number(match[1]))
}

const merchant = CHARGE.columns[0]!
const day = CHARGE.columns[1]!
const note = CHARGE.columns[2]!

afterEach(() => {
  store.state.db = undefined
})

describe('one width per column, in every table of the format (M55 F1)', () => {
  it('a width set for the format is the dashboard block’s, and the block’s handle says it', async () => {
    const db = await document()
    // The write every handle makes — the table's, the tab's, the block's.
    setColumnWidth(db, 'charge', 'merchant', 320)
    const markup = dashboard(db)
    expect(cols(markup)).toEqual([320, defaultWidth(day), defaultWidth(note)])
    expect(markup).toContain(`style="width:${String(320 + defaultWidth(day) + defaultWidth(note))}px"`)
    expect(markup).toMatch(/aria-label="Width of merchant" aria-valuenow="320"/)
    // And the format's table reads the same store.
    expect(columnWidths(db, 'charge').get('merchant')).toBe(320)
  })

  it('a reset clears it everywhere: the block falls back to the type’s width', async () => {
    const db = await document()
    setColumnWidth(db, 'charge', 'merchant', 320)
    setColumnWidth(db, 'charge', 'merchant', undefined)
    expect(cols(dashboard(db))).toEqual([defaultWidth(merchant), defaultWidth(day), defaultWidth(note)])
    expect(columnWidths(db, 'charge').has('merchant')).toBe(false)
  })

  it('a block narrower than its columns scrolls inside itself', async () => {
    const db = await document()
    const markup = dashboard(db)
    expect(markup).toMatch(/<div class="overflow-x-auto"><table class="table-fixed/)
  })

  it('read-only draws the widths with no handle', async () => {
    const db = await document()
    setColumnWidth(db, 'charge', 'merchant', 320)
    const markup = dashboard(db, 'A copy of the document.')
    expect(cols(markup)).toEqual([320, defaultWidth(day), defaultWidth(note)])
    expect(markup).not.toContain('aria-label="Width of')
    expect(dashboard(db)).toContain('aria-label="Width of')
  })

  it('every table writes the one width through the format’s store, with one handle', () => {
    const source = (path: string): string => readFileSync(join(import.meta.dirname, path), 'utf8')
    const block = source('Dashboard.tsx')
    const table = source('../screens/FormatRows.tsx')
    // The block and the format's table (its saved table tab too: the same sheet) write the same row.
    expect(block).toContain('setColumnWidth(database, declaration.name, column.name, width)')
    expect(table).toContain('setColumnWidth(database, declaration.name, column, width)')
    // The frame's copy is not where a width is set.
    expect(table).toMatch(/onWidth=\{readOnly !== undefined \? undefined :/)
    // One handle: the sheet's own is gone.
    for (const each of [block, source('RowSheet.tsx')]) {
      expect(each).toContain("ResizeHandle } from '")
      expect(each).not.toContain('function ResizeHandle')
    }
  })
})
