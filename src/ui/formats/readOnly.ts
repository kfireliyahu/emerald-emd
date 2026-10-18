import { createContext } from 'react'

/**
 * **The format pages, drawn where nothing can be written** (M41 U2): the MCP
 * App's frame shows a copy of a document, and a copy that took an edit would
 * be a promise nobody keeps — it is never saved.
 *
 * Present, it is the sentence the entry's bar says instead of a pack's, and
 * every format page reads it as it reads a pack's lock (D-269): no add, no
 * edit, no remove, no change to the format's shape. What a person may still
 * do is look — switch views, search, sort, open a row, follow a link — and
 * arrange the copy's view (a board's lanes, a column's width), which changes
 * only what this frame shows.
 *
 * Absent, everywhere in the app, nothing changes.
 */
export const ReadOnly = createContext<string | undefined>(undefined)
