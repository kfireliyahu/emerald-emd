import type { Database } from 'sql.js'
import { create } from 'zustand'

import type { StoredRow } from '@/domain/format/row.ts'

/** A row just deleted from a screen, kept for its Undo: the row whole, as it was read before it went. */
export interface JustDeleted {
  /** The document it went from: an Undo never writes into another one. */
  readonly db: Database
  readonly format: string
  /** What it is called, as the note names it. */
  readonly name: string
  readonly row: StoredRow
}

/** How long *Deleted · Undo* stays after the last delete, as a desktop app's note does. */
export const UNDO_FOR_MS = 10_000

/**
 * **The rows a screen just deleted, newest last** (M64 U13, D-625, after D-617):
 * kept outside any one route, because deleting the last entry a filter holds
 * goes back to the table — another route, a component drawn afresh — and its
 * Undo must still be there. A stack, so a second delete never makes the first
 * one permanent behind the person's back: Undo and Ctrl+Z put them back newest
 * first. It empties `UNDO_FOR_MS` after the last delete.
 */
export const useJustDeleted = create<{
  readonly deleted: readonly JustDeleted[]
  readonly keep: (deleted: JustDeleted) => void
  /** The newest, taken off the stack for its Undo. */
  readonly take: (deleted: JustDeleted) => void
}>((set, get) => ({
  deleted: [],
  keep: (deleted) => {
    set({ deleted: [...get().deleted, deleted] })
    setTimeout(() => {
      const now = get().deleted
      if (now[now.length - 1] === deleted) set({ deleted: [] })
    }, UNDO_FOR_MS)
  },
  take: (deleted) => set({ deleted: get().deleted.filter((each) => each !== deleted) }),
}))
