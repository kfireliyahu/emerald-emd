/**
 * **The dashboards, in English** (M64 F18/F20, D-632): every word of a
 * dashboard — its blocks, what makes one, a rollup — beyond the answer, which
 * stays in `views.dashboard`. The source `../he/dashboards.ts` translates.
 */
export const dashboards = {
  /** The grid's one action, on an empty dashboard and at its end. */
  addBlock: 'Add a block',
  /** A block's own controls and its ⋯ menu. */
  block: {
    open: 'Open {title} in full',
    openInFull: 'Open in full',
    dragMove: 'Drag to move',
    more: 'More',
    moreOf: '{title}: more',
    moveEarlier: 'Move earlier',
    moveLater: 'Move later',
    remove: 'Remove from this dashboard',
    totalGoes: 'A headline total lives only on this dashboard, so it goes with the block.',
    savedStays: 'The saved view itself stays.',
    chartStays: 'The chart itself stays — delete it under {format} in the rail, or on its tab.',
  },
  /** A block's edges: its width in columns, its height in rows. */
  size: {
    width: 'Width. Drag, or press the left and right arrows.',
    height: 'Height. Drag, or press the up and down arrows.',
    both: 'Size. Drag, or press the arrows.',
    resize: 'Drag to resize',
    columns: { one: '{count} column', other: '{count} columns' },
    rows: { one: '{count} row', other: '{count} rows' },
    tall: 'as tall as it holds',
  },
  /** What a block draws, and what it says when it cannot. */
  body: {
    noChart: '{format} has no chart called {name} any more.',
    empty: 'No row falls in it yet.',
    noView: '{format} has no saved view called {name} any more.',
    noColumn: '{format} has no column {name} any more.',
    more: '{count} more',
    nothing: 'Nothing matches: {words}.',
    done: 'Done',
    notDone: 'Not done',
    doneCount: '{count} done',
  },
  /** *Add a block*: what is already there to place, and what can be made. */
  menu: {
    savedViews: 'Saved views',
    rollups: 'Rollups',
    none: 'No saved views or rollups yet.',
    chart: 'chart',
    newInput: 'New input view',
    newInputAside: 'a form that stays open',
    newView: 'New view',
    newViewAside: 'a list, table or board',
    newChart: 'New chart',
    newChartAside: 'a count or a sum by month',
    total: 'Headline total',
    totalAside: 'a count or a sum',
  },
  /** A saved view's kind, in a sentence. */
  kinds: {
    list: 'list',
    table: 'table',
    board: 'board',
    roadmap: 'roadmap',
    page: 'page',
    ready: 'ready',
    start: 'start',
    agenda: 'agenda',
    entry: 'entry',
    input: 'input view',
  },
  /** A view's kind, as its choice in *New view*. */
  madeKinds: { list: 'List', table: 'Table', board: 'Board' },
  /** The forms that make a block: a headline total, a view, a chart, an input view. */
  make: {
    of: 'Of',
    as: 'As',
    figure: 'Figure',
    countRows: 'Count of rows',
    sumOf: 'Sum of {column}',
    where: 'Where',
    name: 'Name',
    totalPlaceholder: 'What the figure is, e.g. Open',
    every: 'every {format}',
    taken: 'A block here is called {name} already.',
    add: 'Add',
    cancel: 'Cancel',
    clear: 'Clear',
    sortedBy: 'sorted by {column} {arrow}',
    noLanes: '{format} has no choice column to make the board’s lanes of.',
    which: 'Which rows, in what order',
    viewPlaceholder: 'What it shows, e.g. Due today',
    preview: '{held} of {all} rows, as a {kind}',
    noColumn: '{format} has no column {name}.',
    byMonth: 'By month of',
    noPeriod: '{format} has no date or month column to chart by.',
    per: 'And per',
    nothingElse: 'Nothing else',
    onlyWhere: 'Only rows where',
    chartPlaceholder: 'What it counts, e.g. Done by month',
    chartName: 'Its name is the rollup’s, declared on the format.',
    /** The new chart's preview: its name and what it counts. */
    chartPreview: '{name}: {sentence}.',
    inputPlaceholder: 'What it adds, e.g. Card charge',
    useForAdd: 'Use for Add',
  },
  /** M64 F36: what `dashboard.ts`'s helpers say — a block's line, a total's *of*, a filter in words. `{format}` is a title as a noun, `{formats}` its plural, `{Format}` as declared. */
  said: {
    of: { one: 'of {count} {format}', other: 'of {count} {formats}' },
    everyRow: 'every row',
    savedView: 'Saved view',
    chart: 'Chart',
    count: 'Count',
    /** A block's line: `List · due = today`, `List · every row, by project`. */
    what: '{kind} · {words}',
    whatBy: '{kind} · {words}, by {group}',
    /** On the document's dashboard, the line opens with the format's title. */
    withFormat: '{format} · {what}',
    notDeclared: '{format} is not declared here any more.',
    notSummed: '{column} is not a number or money, so it is not summed.',
    /** An input view's line: `{article}` is the title with its article (*a card charge*), `{title}` as declared. */
    adds: 'Adds {article}',
    addsAs: 'Adds {article} as {sets}',
  },
  /** A filter in a line (`filterWords`): the columns and values are the document's. */
  filter: {
    equals: '{column} = {values}',
    is: '{column} is {values}',
    isNot: '{column} is not {values}',
    isOneOf: '{column} is one of {values}',
    isNotOneOf: '{column} is not one of {values}',
    empty: 'empty',
    search: 'search “{search}”',
    joiner: ', ',
  },
  /** What a rollup counts, as a sentence (`rollupSentence`): *Count of units by month of landed, per milestone*. */
  rollupSaid: {
    count: 'Count of {formats}',
    of: '{kind} of {column}',
    kinds: { SUM: 'Sum', COUNT: 'Count', AVERAGE: 'Average', MINIMUM: 'Minimum', MAXIMUM: 'Maximum' },
    monthOf: 'month of {column}',
    or: '{column} or {fallback}',
    by: '{what} by {period}',
    per: '{sentence}, per {by}',
    where: '{sentence}, where {where}',
    and: ' and ',
  },
  /** Why a view, a chart or an input view is not made, or a block's row not added. */
  refuse: {
    viewTaken: '{format} has a saved view called {name} already — pick it from the list, or call this one something else.',
    addressLong: 'A saved view keeps at most {count} characters of address.',
    period: 'Say which date the month is of.',
    search: 'A chart’s filter does not search: hold a column to its values instead.',
    range: 'A chart’s filter holds no range, and {column} is held to one.',
    emptyAndValues: 'A chart’s filter holds {column} empty or to its values, not both at once.',
    noSum: '{format} has no number or money column called {column}.',
    noPeriod: '{format} has no date or month column, so a chart of it has no months to be by.',
    inputTaken: '{format} already has a view called {name}.',
    nothingFilled: 'Nothing has been filled in yet.',
    notAdded: 'Not added.',
  },
  /** An input view's block (`InputBlock`): its form's name, and what it says when it asks nothing. */
  input: {
    addRow: 'Add a row',
    addOne: 'Add a {one}',
    asksNothing: 'It asks nothing.',
  },
  /** A rollup on its format's tab: its chart, its table, and deleting it. */
  rollup: {
    asChart: '{name} as a chart',
    drawAs: 'Draw as',
    bars: 'Bars',
    line: 'Line',
    month: 'month',
    rows: 'rows',
    noMonth: 'no month',
    none: 'none',
    unchecked: 'unchecked',
    delete: 'Delete chart',
    deleteOf: 'Delete {name}',
    question: 'Delete {name} and its charts on dashboards?',
    confirm: 'Delete',
    keep: 'Keep',
  },
} as const
