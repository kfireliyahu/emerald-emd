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
 * arrange the copy's board lanes, which changes only what this frame shows.
 * A column's width is drawn but has no handle here (M55 F1, D-558): it is the
 * format's one width, and the copy is not where it is set.
 *
 * Absent, everywhere in the app, nothing changes.
 */
export const ReadOnly = createContext<string | undefined>(undefined)
