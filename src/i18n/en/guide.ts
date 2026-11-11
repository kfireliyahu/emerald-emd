/**
 * **The guide's words, in English** (M60 U5, D-590).
 *
 * `steps` is the ledger's guide (`src/data/packs/ledger/guide.ts`) by step id:
 * that file stays English, since the plugin reads it too, and the screen asks
 * here instead. `src/ui/guide/words.test.ts` holds each English word to the
 * step's own, so the two cannot drift. A step's `done` is `{says}` in English —
 * the document's own sentence about it, figures and all — and a fixed sentence
 * in a language whose words those are not.
 */
export const guide = {
  line: {
    dismiss: 'Dismiss',
    allDone: 'Getting started: all {count} places done.',
    walkAgain: 'Walk it again',
    progress: 'Getting started, {done} of {count} done.',
    next: 'Next: {step}.',
    continue: 'Continue the guide',
    guideMe: 'Guide me',
  },
  toast: {
    allDone: 'All {count} places done.',
    doneAway: 'The guide is done. What you skipped stays under {where}.',
    done: 'The guide is done. What you skipped stays on Home’s Getting started line.',
    putAwayAway: 'Put away. Continue from {where}.',
    putAway: 'Put away. Continue from the compass at the foot of the sidebar, or Home’s Getting started line.',
  },
  reopened: {
    shell: 'Help › Guide me',
    page: 'Ctrl+K › Guide me',
  },
  dialog: {
    label: 'Guide, step {n} of {count}',
    position: '{where} · {n} of {count}',
    putAway: 'Put the guide away',
    putAwayTitle: 'Put the guide away (Esc)',
    back: 'Back',
    keys: '{left} {right} move · {esc} put away',
    steps: 'Steps',
    dotTitle: '{n}. {title}',
    dotTitleDone: '{n}. {title} (done)',
    dotLabel: 'Step {n}: {title}',
  },
  state: {
    done: 'Done',
    later: 'Later',
    waiting: 'Waiting',
    laterText: 'This fills once {until}. Skip it for now and it stays on the list.',
    waitingText: 'Do it on the screen; this step ticks itself when {test}.',
  },
  forward: {
    finish: 'Finish',
    next: 'Next',
    nextTo: 'Next: {screen}',
    skip: 'Skip for now',
    skipTo: 'Skip, go to {screen}',
  },
  steps: {
    read: {
      where: 'Home › Month',
      title: 'Drop statements, paychecks and fund reports here',
      asNext: 'drop statements, paychecks and fund reports here',
      body: 'Card and bank exports, paycheck and fund report PDFs, any number at once. Each goes to the reader that knows it, and nothing is written until you press Write.',
      test: 'a transaction or a paycheck exists',
      done: '{says}',
    },
    merchant: {
      where: 'Transactions › By merchant',
      title: 'Give each shop a category, once',
      asNext: 'give each shop a category, once',
      body: 'By merchant lists the names nothing has categorized yet, most charges first. One decision categorizes every charge from that shop, and can become a rule so next month’s are categorized on import.',
      test: 'By merchant has nothing left to categorize, a skipped shop counting as decided',
      until: 'a statement is read',
      done: '{says}',
    },
    categories: {
      where: 'Categories',
      title: 'Make the list of categories yours',
      asNext: 'make the list of categories yours',
      body: 'Emerald starts you with a list. Add the ones you think in, and rename, recolour or archive the rest: New category is at the top, and right-click a category for everything else.',
      test: 'a category is one you made or changed',
      done: '{says}',
    },
    fixed: {
      where: 'Plan › Bills',
      title: 'Say what leaves every month',
      asNext: 'say what leaves every month',
      body: 'Rent, the phone, insurance. Emerald lists charges that look like bills; for each one you track, pick what it does to the plan.',
      test: 'a bill is tracked',
      until: 'a statement is read',
      done: '{says}',
    },
    split: {
      where: 'Plan › The split',
      title: 'Give the rest a job',
      asNext: 'give the rest a job',
      body: 'What net pay leaves after the bills is split into buckets. A bucket is for a category, a goal, a debt or an account. Drag a divider to resize.',
      test: 'a plan exists',
      done: '{says}',
    },
    opening: {
      where: 'Wealth › Net worth › a bank account, opened',
      title: 'What was in the bank before the statements',
      asNext: 'what was in the bank before the statements',
      body: 'Statements start somewhere. The opening balance stands for everything before that date, and the last statement checks it: opening plus what moved has to equal the balance.',
      test: 'every account has an opening balance',
      until: 'a statement is read',
      done: '{says}',
    },
    cushion: {
      where: 'Plan › The cushion',
      title: 'How much should always stay in the bank',
      asNext: 'how much should always stay in the bank',
      body: 'The cushion is what is left in the bank once the goals saved there take their parts, against a number of months of bills. Every bank account counts until you untick it; you pick the months, and Emerald does the multiplication.',
      test: 'the cushion has its months',
      done: '{says}',
    },
  },
} as const
