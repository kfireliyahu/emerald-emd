/**
 * **The status line, where the hooks module runs** (M56 U2): the same line the
 * status-line command prints (M51 U6) — `inbox 1 new · in progress: M56 U2` —
 * set with `$.ui.status`, so a person who has the plugin needs no command in
 * their settings for it. `inbox.ts` reads the document and calls `showStatus`;
 * nothing here reads anything.
 *
 * `statusText` is `hooks/statusCache.ts`'s, copied because the module has no
 * Node to import that file with; `hosts/claude/inbox.test.ts` holds the two to
 * the same line.
 */
/** The one call of `$.ui` the line needs, so this file imports nothing (`hosts/claude/inbox.test.ts` reads it). */
interface StatusLine {
  readonly ui: { status(text: string | undefined): void }
}

/** What the status line says — each part left out when the document has not got the format. */
export interface StatusParts {
  /** Inbox rows in state `new`. */
  readonly inbox?: number
  /** The units in state `in_progress`, by `ref`, the latest started first. */
  readonly units?: readonly string[]
}

/** How many unit refs are named before the rest are counted. */
const UNITS_NAMED = 2

/** The line itself: `inbox 1 new · in progress: M51 U6, M33 U4 +1`, or '' when the document has neither format. */
export function statusText(parts: StatusParts): string {
  const said: string[] = []
  if (parts.inbox !== undefined) said.push(`inbox ${String(parts.inbox)} new`)
  if (parts.units !== undefined && parts.units.length > 0) {
    const named = parts.units.slice(0, UNITS_NAMED).join(', ')
    const more = parts.units.length - UNITS_NAMED
    said.push(`in progress: ${named}${more > 0 ? ` +${String(more)}` : ''}`)
  }
  return said.join(' · ')
}

/**
 * The units in progress from `format_rows unit match:{state:in_progress}
 * columns:[ref, started]`, which answers a table: each `ref`, the latest
 * started first, as the status-line command sorts them.
 */
export function unitsFromTable(text: string): string[] {
  const lines = text.split('\n').filter((line) => line.startsWith('|'))
  const cells = (line: string) => line.split('|').slice(1, -1).map((cell) => cell.trim())
  const head = cells(lines[0] ?? '')
  const ref = head.indexOf('ref')
  const started = head.indexOf('started')
  if (ref < 0) return []
  return lines
    .slice(2)
    .map(cells)
    .map((row) => ({ ref: row[ref] ?? '', started: started < 0 ? '' : (row[started] ?? '') }))
    .filter((row) => row.ref !== '')
    .sort((a, b) => b.started.localeCompare(a.started))
    .map((row) => row.ref)
}

/** Puts the line under the prompt, or clears it when there is nothing to say. */
export function showStatus($: StatusLine, parts: StatusParts): void {
  const text = statusText(parts)
  $.ui.status(text === '' ? undefined : text)
}
