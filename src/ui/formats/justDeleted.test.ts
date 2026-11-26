import { readFileSync } from 'node:fs'
import type { Database } from 'sql.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UNDO_FOR_MS, useJustDeleted, type JustDeleted } from './justDeleted.ts'

/**
 * **A delete deletes, with an Undo** (M64 U13, D-625, after D-617): the rows
 * just deleted are a stack, so a second delete never makes the first one
 * permanent, and the engine's screens never ask at the foot of the screen.
 */
const db = {} as Database
const row = (id: string, name: string): JustDeleted => ({ db, format: 'card_charge', name, row: { id, cells: { merchant: name } } })

describe('the rows just deleted', () => {
  afterEach(() => {
    vi.useRealTimers()
    useJustDeleted.setState({ deleted: [] })
  })

  it('keeps every delete, newest last, and takes back one at a time', () => {
    const first = row('a', 'Book Nook')
    const second = row('b', 'Town Bakery')
    useJustDeleted.getState().keep(first)
    useJustDeleted.getState().keep(second)
    expect(useJustDeleted.getState().deleted).toEqual([first, second])
    useJustDeleted.getState().take(second)
    expect(useJustDeleted.getState().deleted).toEqual([first])
  })

  it('lets them go a while after the last delete, not after the first', () => {
    vi.useFakeTimers()
    useJustDeleted.getState().keep(row('a', 'Book Nook'))
    vi.advanceTimersByTime(UNDO_FOR_MS - 1000)
    useJustDeleted.getState().keep(row('b', 'Town Bakery'))
    vi.advanceTimersByTime(1500)
    expect(useJustDeleted.getState().deleted).toHaveLength(2)
    vi.advanceTimersByTime(UNDO_FOR_MS)
    expect(useJustDeleted.getState().deleted).toEqual([])
  })
})

describe('the engine’s screens ask nothing at the foot of the screen', () => {
  it('deletes a row at once and a format at its button, with no panel under the page', () => {
    const rows = readFileSync('src/ui/screens/FormatRows.tsx', 'utf8')
    const formats = readFileSync('src/ui/screens/DeclaredFormats.tsx', 'utf8')
    for (const source of [rows, formats]) {
      expect(source).not.toMatch(/function Delete(Row)?Panel/)
      expect(source).not.toContain('shrink-0 border-t border-hairline bg-elevated')
    }
    expect(rows).toContain('<DeletedNote')
    expect(rows).toContain('<SidePanel')
    expect(formats).toContain('<ConfirmAtButton')
  })
})
