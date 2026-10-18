import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, matchPath } from 'react-router-dom'
import type { Database } from 'sql.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { formatViews, readyData } from '@/data/repositories/formatLinkViewRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { countRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { filterQuery } from '@/data/repositories/formatFilterRepository.ts'
import { openEncoded } from '@/data/storage/encoding.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { ReadOnly } from '@/ui/formats/readOnly.ts'
import { Conversation } from '@/ui/formats/conversation.ts'
import { entryPath, formatPath } from '@/ui/nav.ts'

import { FRAME_VIEWS } from './contract.ts'
import { FRAME_ROUTES, FrameRoutes, NOT_IN_FRAME, START_PATH, firstPath } from './routes.tsx'

/**
 * **No control in the frame leads nowhere** (2026-10-08; M41 U2).
 *
 * Two halves. The app's format routes are held to the frame's: a route the app
 * gains is drawn in the frame or named in `NOT_IN_FRAME` with the control that
 * reaches it and why that is hidden, or this fails. And the frame's pages are
 * drawn, read-only, over this project's own memory and a synthetic ledger: every
 * link they render lands on a route the frame draws, and no control that writes
 * — or reaches a page the frame does not draw — is on them.
 */

const APP = fileURLToPath(new URL('../App.tsx', import.meta.url))
const MEMORY = fileURLToPath(new URL('../../docs/memory.emd', import.meta.url))

const drawn = (path: string): boolean => FRAME_ROUTES.some((route) => matchPath(route.path, path) !== null)

describe('the frame draws every format route the app has, or says why not', () => {
  const routes = [...readFileSync(APP, 'utf8').matchAll(/<Route path="(\/formats[^"]*)"/g)].map((match) => match[1] ?? '')

  it('finds the app’s format routes', () => {
    expect(routes).toContain('/formats/:name/roadmap')
  })

  it.each(routes)('%s', (route) => {
    const said = FRAME_ROUTES.some((each) => each.path === route) || NOT_IN_FRAME[route] !== undefined
    expect(said, `${route} is neither drawn in the frame nor in NOT_IN_FRAME with its reason`).toBe(true)
  })

  it('opens every view a tool can ask for on a page it draws', () => {
    for (const view of FRAME_VIEWS) expect(drawn(firstPath(view, 'unit')), view).toBe(true)
  })
})

/** The frame's pages, rendered as the frame renders them: read-only, in its router. */
function page(path: string, conversation: Conversation = {}): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        ReadOnly.Provider,
        { value: 'Read only here.' },
        createElement(Conversation.Provider, { value: conversation }, createElement(FrameRoutes)),
      ),
    ),
  )
}

/** What would be wrong on a read-only page: a way to write, or a way somewhere undrawn. */
function problemsOn(html: string): string[] {
  const found: string[] = []
  for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
    const path = decodeURI(href ?? '')
    if (!drawn(path)) found.push(`a link to ${path}, which the frame does not draw`)
  }
  // Read off the controls themselves, never the page's text: a unit's brief
  // may well say "Add a column".
  for (const [, attributes = '', inner = ''] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = inner.replace(/<[^>]*>/g, '').trim()
    const label = /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? ''
    const writes =
      ['Add', 'Add a claim', 'Change the claims', 'Done arranging'].includes(text) ||
      text.startsWith('Apply ') ||
      ['Read', 'Add a column', 'Delete'].includes(label) ||
      label.startsWith('Edit ') ||
      label.startsWith('Arrange this view')
    if (writes) found.push(`a button that writes on a read-only page: ${label || text}`)
  }
  if (html.includes('draggable="true"')) found.push('something to drag on a read-only page')
  if (html.includes('This view is not drawn in the conversation')) found.push('the page the frame does not draw')
  // A field to type in, other than the sheet's search, would take an edit.
  for (const [input] of html.matchAll(/<(input|textarea)\b[^>]*>/g)) {
    if (!input.includes('type="search"')) found.push(`a field: ${input.slice(0, 120)}`)
  }
  return found
}

let opened: Database[] = []
/**
 * Open a document for the pages. A page rendered to a string reads a store's
 * *server* snapshot, which zustand takes from the state it was created with —
 * so that object is the one given the document, for this file only.
 */
const open = (db: Database): void => {
  opened.push(db)
  Object.assign(useDocumentStore.getInitialState(), { db, revision: opened.length })
}

afterAll(() => {
  Object.assign(useDocumentStore.getInitialState(), { db: undefined, revision: 0 })
  for (const db of opened) db.close()
  opened = []
})

describe('the frame’s pages over the development pack: docs/memory.emd', () => {
  let db: Database
  beforeAll(async () => {
    db = (await openEncoded(readFileSync(MEMORY))).db
  })

  it('draws start_here’s picture: the milestone roadmap and what is ready', () => {
    open(db)
    const html = page(START_PATH)
    expect(html).toContain('aria-label="Roadmap of Milestone"')
    expect(html).toContain('aria-label="Ready to start in Unit"')
    expect(problemsOn(html)).toEqual([])
  })

  it('opens on only the rows a tool asked for, says so, and counts them as format_rows does (M44 U6)', () => {
    open(db)
    const declarations = listFormats(db)
    const unit = declarations.find((each) => each.name === 'unit')
    if (unit === undefined) throw new Error('docs/memory.emd declares unit')
    const filter = { match: { milestone: 'M44', state: 'built' } }
    const query = filterQuery(db, unit, filter, declarations)
    if (!query.ok) throw new Error('the filter reads')
    const kept = countRows(db, unit, query.value)
    expect(kept).toBeGreaterThan(0)
    for (const view of ['sheet', 'board', 'ready'] as const) {
      const html = page(firstPath(view, 'unit', filter))
      expect(html, view).toContain('Filtered by')
      expect(problemsOn(html), view).toEqual([])
    }
    const sheet = page(firstPath('sheet', 'unit', filter))
    expect(sheet).toContain(`${String(kept)} of ${String(countRows(db, unit))} entries`)
    expect(sheet).toContain('M44 U1')
    expect(sheet).not.toContain('M43 U1<')

    const roadmap = page(firstPath('roadmap', 'milestone', { match: { ref: 'M44' } }))
    expect(roadmap).toContain('Filtered by')
    expect(roadmap).toContain('M44')
    expect(roadmap).not.toContain('>M43<')
  })

  it('draws a roadmap’s units with the columns chosen, and only the units held (M37 U5)', () => {
    open(db)
    const whole = page(firstPath('roadmap', 'milestone', { match: { ref: 'M44' } }))
    expect(whole).toContain('taken by')
    const chosen = page(firstPath('roadmap', 'milestone', { match: { ref: 'M44' } }, { unit: ['title', 'state'] }))
    expect(chosen).toContain('M44 U1')
    expect(chosen).not.toContain('taken by')
    expect(chosen).not.toContain('started')
    expect(problemsOn(chosen)).toEqual([])
    // Held to units not built, a finished milestone has none to show, and says so.
    const held = page(firstPath('roadmap', 'milestone', { match: { ref: 'M44', 'unit.state': { not: 'built' } } }))
    expect(held).toContain('unit.state')
    expect(held).not.toContain('M44 U1<')
    expect(held).toMatch(/0 of \d+ shown|Nothing under it matches the filter/)
  })

  it('offers Start this unit on each ready row, and selection, only where the host takes them (M51 U7)', () => {
    open(db)
    const declarations = listFormats(db)
    const unit = declarations.find((each) => each.name === 'unit')
    const ready = unit === undefined ? undefined : readyData(db, unit, declarations)
    if (unit === undefined || ready === undefined) throw new Error('docs/memory.emd declares unit with a ready view')
    const starts = (html: string): number => html.split('Start this unit').length - 1

    // A host that takes neither: the frame as it was.
    expect(starts(page(firstPath('ready', 'unit')))).toBe(0)
    expect(page(firstPath('sheet', 'unit'))).not.toContain('aria-selected')

    const picked = ready.ready[0]?.row.id ?? ''
    const offered: Conversation = { start: () => undefined, selection: { has: (id) => id === picked, toggle: () => undefined } }
    const readyPage = page(firstPath('ready', 'unit'), offered)
    expect(starts(readyPage)).toBe(ready.ready.length)
    expect(problemsOn(readyPage)).toEqual([])
    // start_here's picture is the same list.
    expect(starts(page(START_PATH, offered))).toBe(ready.ready.length)
    for (const view of ['sheet', 'board', 'ready'] as const) {
      const html = page(firstPath(view, 'unit'), offered)
      expect(html.split('aria-selected="true"').length - 1, view).toBe(1)
      expect(problemsOn(html), view).toEqual([])
    }
  })

  it('draws every view of every format, and an entry of each, with no way to write and none to nowhere', () => {
    const declarations = listFormats(db)
    expect(declarations.length).toBeGreaterThan(0)
    open(db)
    for (const declaration of declarations) {
      const paths = formatViews(db, declaration, declarations).map((view) => firstPath(view, declaration.name))
      const row = listRows(db, declaration, { limit: 1 })[0]
      if (row !== undefined) paths.push(entryPath(declaration.name, row.id))
      for (const path of paths) {
        const html = page(path)
        expect(html.length, path).toBeGreaterThan(200)
        expect(problemsOn(html), path).toEqual([])
      }
    }
  })
})

describe('the frame’s pages over a ledger', () => {
  it('draws a ledger format’s sheet and entry read-only', async () => {
    const db = await createLedgerDatabase()
    open(db)
    const declarations = listFormats(db)
    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      expect(problemsOn(page(formatPath(declaration.name))), declaration.name).toEqual([])
    }
  })
})
