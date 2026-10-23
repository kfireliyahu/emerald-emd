/**
 * **A row or a board card in a dashboard block opens its entry** — M53 F5.
 *
 * The dashboard is rendered as markup on a synthetic task format and read for
 * its links: a list's line, a table's row and a board's card each link to the
 * row's entry with the block's saved view's address — the rows the list beside
 * the entry holds — while a list's tick stays outside its link, and a headline
 * total and the block's title open no entry. The state the link carries, and
 * the entry's way back, are `nav.test.ts`'s.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { saveView, setDashboardBlocks, setListSetting } from '@/data/repositories/formatViewRepository.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { DashboardView } from './Dashboard.tsx'

// Markup reads a store's first state, so the dashboard reads this one instead.
const store = vi.hoisted(() => ({ state: { db: undefined as unknown, revision: 1, mutate: () => undefined } }))
vi.mock('@/state/documentStore.ts', () => ({
  useDocumentStore: (select: (state: typeof store.state) => unknown) => select(store.state),
}))

const NOW = Date.UTC(2026, 9, 23)

const TASK: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [
    column('title', 'text', { required: true }),
    column('state', 'enum', { values: ['open', 'doing', 'done'] }),
    column('due', 'date'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

/** The task format's dashboard: a list, a table and a board of its saved views, and a headline total. */
async function dashboard(): Promise<{ markup: string; ids: ReadonlyMap<string, string> }> {
  const db = await createDatabase()
  expect(adoptFormat(db, TASK, NOW).refusals).toEqual([])
  insertRows(db, TASK, [
    { title: 'Call the bank', state: 'open', due: '2026-10-25' },
    { title: 'Book the dentist', state: 'doing' },
    { title: 'Renew the lease', state: 'done' },
  ])
  setListSetting(db, 'task', 'state', 'done done')
  saveView(db, { format: 'task', name: 'Open', kind: 'list', address: '?state=open' })
  saveView(db, { format: 'task', name: 'All', kind: 'table', address: '?order:title=descending' })
  saveView(db, { format: 'task', name: 'Lanes', kind: 'board', address: '' })
  setDashboardBlocks(db, 'task', [
    { dashboard: 'task', format: 'task', kind: 'saved', name: 'Open', address: '' },
    { dashboard: 'task', format: 'task', kind: 'saved', name: 'All', address: '' },
    { dashboard: 'task', format: 'task', kind: 'saved', name: 'Lanes', address: '' },
    { dashboard: 'task', format: 'task', kind: 'total', name: 'How many', address: '' },
  ])
  const ids = new Map(listRows(db, TASK, {}).map((row) => [String(row.cells['title']), row.id]))
  store.state.db = db
  const markup = renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/formats/task/dashboard'] }, createElement(DashboardView, { dashboard: 'task' })),
  )
  return { markup, ids }
}

/** Each block's markup, by its name. */
function blocks(markup: string): ReadonlyMap<string, string> {
  const parts = markup.split(/(?=<div[^>]*data-block=")/).slice(1)
  return new Map(parts.map((part) => [/data-block="([^"]*)"/.exec(part)?.[1] ?? '', part]))
}

/** Every link's address and markup. */
function links(markup: string): readonly { readonly href: string; readonly inner: string; readonly tag: string }[] {
  return [...markup.matchAll(/(<a [^>]*>)([\s\S]*?)<\/a>/g)].map((match) => ({
    tag: match[1] ?? '',
    href: (/href="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? '').replace(/&amp;/g, '&'),
    inner: match[2] ?? '',
  }))
}

afterEach(() => {
  store.state.db = undefined
})

describe('a dashboard block’s rows (M53 F5)', () => {
  it('a list’s line links to its entry with the block’s address, and its tick stays outside the link', async () => {
    const { markup, ids } = await dashboard()
    const list = blocks(markup).get('Open') ?? ''
    const found = links(list)
    expect(found.map((each) => each.href)).toEqual([`/formats/task/entry/${ids.get('Call the bank') ?? ''}?state=open`])
    expect(found[0]?.inner).toContain('Call the bank')
    // The tick is a button of its own, beside the link and never inside it: ticking opens nothing.
    expect(list).toContain('role="checkbox"')
    expect(found.some((each) => each.inner.includes('role="checkbox"'))).toBe(false)
    // A link, so Tab reaches it and Enter opens it; never dragged itself.
    expect(found[0]?.tag).toContain('draggable="false"')
    expect(found[0]?.tag).not.toContain('tabindex')
  })

  it('a table’s row links every cell to its entry, and only the first is a stop for Tab', async () => {
    const { markup, ids } = await dashboard()
    const found = links(blocks(markup).get('All') ?? '')
    const lease = `/formats/task/entry/${ids.get('Renew the lease') ?? ''}?order:title=descending`
    const held = found.filter((each) => each.href === lease)
    expect(held.length).toBe(TASK.columns.length)
    expect(held.filter((each) => !each.tag.includes('tabindex="-1"')).length).toBe(1)
    expect(new Set(found.map((each) => each.href)).size).toBe(3)
  })

  it('a board’s card links to its entry', async () => {
    const { markup, ids } = await dashboard()
    const found = links(blocks(markup).get('Lanes') ?? '')
    expect(found.map((each) => each.href).sort()).toEqual(
      ['Call the bank', 'Book the dentist', 'Renew the lease'].map((title) => `/formats/task/entry/${ids.get(title) ?? ''}`).sort(),
    )
  })

  it('a headline total, and every block’s title, open no entry', async () => {
    const { markup } = await dashboard()
    expect(links(blocks(markup).get('How many') ?? '')).toEqual([])
    for (const each of blocks(markup).values()) {
      const head = each.slice(0, each.indexOf('</button>'))
      expect(head).not.toContain('<a ')
    }
  })
})
