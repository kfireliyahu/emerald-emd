/**
 * **The engine's views, in English** (M64 U14, D-626): the answer each view of a
 * format says first — the board, the list, the roadmap, the ready list — and
 * the agenda's, the dashboards' and the connections'; with what a move or a
 * removal says beside its Undo. The rest of these screens still says its words
 * inline. The source `../he/views.ts` translates.
 */
export const views = {
  /** `{count} {member}`, one part of a sentence that counts by state. */
  part: '{count} {member}',
  /** The last two parts of a counted sentence: `3 planned and 4 built`. */
  and: '{rest} and {last}',
  undo: 'Undo',
  undoHint: 'Put it back (Ctrl+Z)',
  /** `#/formats/:name/board`: where does each thing stand? */
  board: {
    answer: '{parts}.',
    none: 'Nothing here yet.',
    moved: 'Moved {name} to {member}.',
    notMoved: 'Not moved.',
  },
  /** `#/formats/:name/list`: what is on my list, and what is done? */
  list: {
    open: { one: '{count} open', other: '{count} open' },
    done: { one: '{count} done', other: '{count} done' },
    rows: { one: '{count} row.', other: '{count} rows.' },
    none: 'Nothing on this list yet.',
  },
  /** `#/formats/:name/roadmap`: what comes next? */
  roadmap: {
    folded: '{done} of {total} {title} rows done',
    none: 'Nothing on this roadmap yet.',
  },
  /** `#/formats/:name/ready`: what can start now? */
  ready: {
    answer: { one: '{count} ready to start', other: '{count} ready to start' },
    held: { one: '{count} held', other: '{count} held' },
    none: 'Nothing is ready to start.',
  },
  /** `#/agenda`: what is coming up, and what is late? */
  agenda: {
    overdue: { one: '{count} overdue', other: '{count} overdue' },
    ahead: { one: '{count} {ahead}', other: '{count} {ahead}' },
    nothing: 'Nothing {ahead}.',
    noFormat: 'No format here has a date to put it on the agenda.',
  },
  /** `#/dashboard` and a format's dashboard: what do my numbers add up to? */
  dashboard: {
    answer: { one: 'One block, from {formats}.', other: '{count} blocks, from {formats}.' },
    blocks: { one: 'One block on this dashboard.', other: '{count} blocks on this dashboard.' },
    none: 'Nothing on this dashboard yet.',
    removed: 'Removed {name} from this dashboard.',
  },
  /** `#/connections`: how do my kinds of things relate? */
  connections: {
    answer: { one: '{formats}, and one connection between them.', other: '{formats}, and {count} connections between them.' },
    none: '{formats}, and no connection between them yet.',
    formats: { one: 'One format', other: '{count} formats' },
    how: 'Drag one format onto another to connect them.',
    panel: 'Connection',
    panelNew: 'New connection',
  },
} as const
