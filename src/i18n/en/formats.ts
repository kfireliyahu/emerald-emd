/**
 * **The engine's formats, in English** (M64 U13, D-625): the formats list, a
 * format's table and a row's entry — the words the redesign wrote. The rest of
 * these screens still says its words inline, and is translated by a unit of its
 * own (M64 F9). The source `../he/formats.ts` translates.
 */
export const formats = {
  /** `#/formats`: what kinds of things this document keeps. */
  list: {
    title: 'Formats',
    answer: { one: 'This document keeps one kind of thing.', other: 'This document keeps {count} kinds of things.' },
    nothing: 'This document keeps nothing yet.',
    rows: { one: '{count} row in all', other: '{count} rows in all' },
    holds: 'every claim holds',
    fails: { one: '{count} row fails a claim', other: '{count} rows fail a claim' },
    newFormat: 'New format',
    head: {
      format: 'Format',
      rows: 'Rows',
      columns: 'Columns',
      changed: 'Last changed',
      claims: 'Claims',
    },
    changedHint: 'The day a row was last added, changed or removed, or the format itself was changed',
    readFile: 'Read a file into {title}',
    open: 'Open {title}',
  },
  /** What waits on the person, below the answer. */
  waiting: {
    label: 'Waiting',
    pending: 'A change to {title} waits for your answer',
    pendingWhy: 'Nothing has been written and nothing has been lost.',
    pendingPanel: 'Waiting for an answer',
    pendingSay: 'These are the changes the app will not make on its own. Empty the column first, or take the format away and declare it again.',
    see: 'See it',
    unreadable: '{name} cannot be read by this build',
    unreadablePanel: 'Not readable by this build',
    why: 'Why',
    orphans: {
      one: 'One table has no declaration behind it',
      other: '{count} tables have no declaration behind them',
    },
    orphansWhy: 'Left exactly as they are: the app only touches what it can see a declaration for.',
    orphansPanel: 'Tables with no declaration',
    seeThem: 'See them',
  },
  /** Deleting a format: no undo, so it asks at its button. */
  deleteFormat: {
    label: 'Delete {title}',
    question: 'Delete {title}?',
    cost: {
      one: 'Its one row goes with it. This cannot be undone.',
      other: 'Its {count} rows go with it. This cannot be undone.',
    },
    empty: 'It holds no rows. This cannot be undone.',
    kept: '{title} cannot be deleted while {others} link to it.',
    keptWhy: 'Remove their links first; nothing is removed on your behalf.',
    confirm: 'Delete',
    cancel: 'Cancel',
  },
  /** `#/formats/:name`: what are all my rows, and are they right? */
  table: {
    answer: { one: 'One row.', other: '{count} rows.' },
    answerNone: 'No rows yet.',
    matching: { one: 'One of {total} rows matches.', other: '{count} of {total} rows match.' },
    lookWrong: { one: 'One thing looks wrong.', other: '{count} things look wrong.' },
    holds: 'Every claim holds.',
    noClaims: 'No claim checks them yet.',
    addClaim: 'Add a claim',
    fails: { one: '{count} fails a claim.', other: '{count} fail a claim.' },
    uncheckedSome: { one: 'One is not checked yet.', other: '{count} are not checked yet.' },
    columns: { one: '{count} column', other: '{count} columns' },
    showing: 'showing the first {count}',
    applyRules: 'Apply {name}',
    applyPanel: 'Apply {name}',
    apply: 'Apply',
    cancel: 'Cancel',
    viewPanel: 'A new view',
    chartPanel: 'A new chart',
    shapePanel: 'The shape of {title}',
  },
  /** A row deleted at once, from the table or its entry, with an Undo near it. */
  deleted: {
    said: 'Deleted {name}.',
    more: { one: 'And one before it.', other: 'And {count} before it.' },
    undo: 'Undo',
    undoHint: 'Puts it back (Ctrl+Z)',
    label: 'Delete {name}',
    kept: {
      one: '{name} cannot be deleted while another entry links to it.',
      other: '{name} cannot be deleted while {count} entries link to it.',
    },
    keptWhy: 'Re-link or clear them first; nothing is removed on your behalf.',
    close: 'Close',
  },
} as const
