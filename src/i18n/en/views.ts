/**
 * **The engine's views, in English** (M64 U14, D-626): the answer each view of a
 * format says first — the board, the list, the roadmap, the ready list — and
 * the agenda's, the dashboards' and the connections'; with what a move or a
 * removal says beside its Undo; and since M64 F18 (D-632) every other word
 * those views draw — their controls, their days and dues, *Links here*. The
 * source `../he/views.ts` translates.
 */
export const views = {
  /** `{count} {member}`, one part of a sentence that counts by state. */
  part: '{count} {member}',
  /** The last two parts of a counted sentence: `3 planned and 4 built`. */
  and: '{rest} and {last}',
  undo: 'Undo',
  undoHint: 'Put it back (Ctrl+Z)',
  /** A day as the views read it: `Fri 9 Oct 2026` — the weekday is `settings.calendar.short`'s, the date `dates.dayMonth`. */
  day: '{weekday} {date} {year}',
  /** A date against today (`relativeDaySaid`): `today`, `in 3 days`, `2 weeks ago`. */
  when: {
    today: 'today',
    tomorrow: 'tomorrow',
    yesterday: 'yesterday',
    inDays: 'in {count} days',
    daysAgo: '{count} days ago',
    inWeeks: 'in {count} weeks',
    weeksAgo: '{count} weeks ago',
    inMonths: 'in {count} months',
    monthsAgo: '{count} months ago',
    inYears: 'in {count} years',
    yearsAgo: '{count} years ago',
  },
  /** A due as the list reads it (`dueSaid`): `today`, `Sat, in 2 days`, `3 days late`, `5 Nov`. */
  due: {
    today: 'today',
    tomorrow: 'tomorrow',
    yesterday: 'yesterday',
    late: '{count} days late',
    soon: '{weekday}, in {count} days',
    date: '{date}',
    dateYear: '{date} {year}',
  },
  /** `#/formats/:name/board`: where does each thing stand? */
  /** *Columns*: which columns a view's lines or cards draw (M37 U5), in the views' strip. */
  columns: {
    label: 'Columns',
    changed: 'Columns ·',
    hint: 'Which columns each line draws',
    of: '{title}, its columns',
    asDeclared: 'As declared',
  },
  board: {
    answer: '{parts}.',
    none: 'Nothing here yet.',
    moved: 'Moved {name} to {member}.',
    notMoved: 'Not moved.',
    lanesBy: 'Lanes by',
    lanesByColumn: 'Lanes by {column}',
    showing: 'Showing {shown} of {total}; search narrows it.',
    lanes: 'Lanes',
    noValue: 'No value',
    /** An empty lane: `Nothing planned`. */
    emptyLane: 'Nothing {member}',
    emptyNone: 'Nothing',
    moveLeft: 'Move {name} left',
    moveRight: 'Move {name} right',
    moveTo: 'Move {name} to {member}',
  },
  /** `#/formats/:name/list`: what is on my list, and what is done? */
  list: {
    open: { one: '{count} open', other: '{count} open' },
    done: { one: '{count} done', other: '{count} done' },
    rows: { one: '{count} row.', other: '{count} rows.' },
    none: 'Nothing on this list yet.',
    /** The line a new entry will be, before it has a title. */
    draft: 'A new {one}',
    label: 'Rows',
    hideDone: { one: 'Hide {count} done', other: 'Hide {count} done' },
    ticked: 'Done',
    unticked: 'Not done',
    keys: 'Enter adds · Esc clears',
    groupBy: 'Group by',
    /** What a setting says when it is set to nothing. */
    nothing: 'nothing',
    nothingItem: 'Nothing',
    hintDue: 'late, today, tomorrow…',
    hintDate: 'before today, today…',
    hintLink: 'a link',
    hintEnum: 'an enum',
    tickTo: 'Tick to mark…',
    noTicks: 'No ticks',
    /** A choice under *Tick to mark…*: a column and its member, or a yes-or-no column's yes. */
    doneText: '{column} {member}',
    doneYes: '{column} yes',
    dueBy: 'Due by',
    line: 'Line',
    lineMenu: 'Line: after the title',
    /** The groups a date makes, and the group of rows with nothing in the column. */
    groups: {
      late: 'Late',
      beforeToday: 'Before today',
      today: 'Today',
      tomorrow: 'Tomorrow',
      week: 'In the next 7 days',
      later: 'Later',
      none: 'No {column}',
      noDate: 'No {column} date',
    },
  },
  /** `#/formats/:name/roadmap`: what comes next? */
  roadmap: {
    folded: '{done} of {total} {title} rows done',
    /** The caption under the answer: which number the roadmap runs in. */
    order: 'In the order of {column}',
    none: 'Nothing on this roadmap yet.',
    orderBy: 'In the order of',
    /** The caption over a titled roadmap: `Milestone · in the order of position`. */
    caption: '{title} · in the order of {column}',
    foldAll: 'Fold all',
    unfoldAll: 'Unfold all',
    fold: 'Fold {name}',
    unfold: 'Unfold {name}',
    empty: 'Nothing here yet.',
    underNone: 'Under none',
    underNoneOf: 'Under none of these',
    shown: '{shown} of {total} shown',
    noneMatch: 'Nothing under it matches the filter.',
    noneNames: 'Nothing names it yet.',
    /** Rows under a row with nothing in its state: `2 with no state`. */
    withNo: '{count} with no {column}',
    state: 'state',
    beneath: 'nothing beneath',
  },
  /** `#/formats/:name/ready`: what can start now? */
  ready: {
    answer: { one: '{count} ready to start', other: '{count} ready to start' },
    held: { one: '{count} held', other: '{count} held' },
    none: 'Nothing is ready to start.',
    /** What *ready* means, the words that name the rule. */
    rule: '{state} is {ready}, and nothing in {waits} is still open — open being anything but {done}.',
    /** Two members either of which will do: `planned or next`. */
    or: '{a} or {b}',
    section: 'Ready to start · {count}',
    heldLabel: 'Held',
    heldSection: 'Held · {count}',
    nothing: 'Nothing',
    start: 'Start this {format}',
    waitsOn: 'waits on',
  },
  /** `#/agenda`: what is coming up, and what is late? */
  agenda: {
    overdue: { one: '{count} overdue', other: '{count} overdue' },
    ahead: { one: '{count} {ahead}', other: '{count} {ahead}' },
    nothing: 'Nothing {ahead}.',
    noFormat: 'No format here has a date to put it on the agenda.',
    /** How far ahead it is held, inside a sentence. */
    fromToday: 'from today on',
    within: { one: 'in the next {count} day', other: 'in the next {count} days' },
    /** The same, first in the caption. */
    fromTodayFirst: 'From today on',
    withinFirst: { one: 'In the next {count} day', other: 'In the next {count} days' },
    /** The caption under the answer: the day, how far ahead, and which date puts each format here. */
    caption: '{day} · {ahead} — {formats}{overdue}.',
    many: '{count} formats, each by a date of its own',
    by: '{format} by {column}',
    byWord: 'by',
    overdueToo: ', and what is overdue above it',
    which: 'Which date puts each format here',
    onBy: '{format} is on the agenda by',
    left: 'Left off: {reasons}',
    showAll: 'Show all ahead',
    openFormats: 'Open formats',
    overdueLabel: 'Overdue',
    overdueHead: 'Overdue · {count}',
    today: 'Today · {day}',
    tomorrow: 'Tomorrow · {day}',
    dayWhen: '{day} · {when}',
    more: { one: '{format} has {count} more after these.', other: '{format} has {count} more after these.' },
    howFar: 'How far ahead',
    allAhead: 'All ahead',
    days: { one: '{count} day', other: '{count} days' },
    searchHint: 'Every column, as it is shown',
  },
  /** An entry's *Links here*: every link that names this row. */
  links: {
    here: 'Links here',
    fresh: 'Nothing yet. A row has to be added before anything can name it.',
    noFormat: 'No format links to {title}.',
    nothingFrom: 'Nothing yet from',
    nothingFromList: 'Nothing yet from {formats}.',
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
