/**
 * **The ledger's guide** — the steps it declares, as a list (M28 U9, S2, D-330).
 *
 * The guide is engine code that reads a list (`domain/guide.ts`); the ledger is
 * the first pack to hand it one. Each row names a route, a place on it, what to
 * say and a test the document answers — the tests are `guideRepository.ts`'s,
 * because they read the document. The words are the approved mockup's
 * (`docs/mockups/m28-u9/guide.html`), verbatim.
 *
 * **The six replace onboarding's seven screens** (choice a, B): reading a
 * statement already makes its account (D-313), so the institution and detail
 * screens had nothing left to do, and the checklist's questions became these
 * steps' tests.
 *
 * **By merchant comes before Categories** (M59 U6, D-582, reversing M28 F13):
 * the workflows first — read, then give each shop a category, then make the
 * list yours. M28 F13 put the list first so a shop was not filed into a list
 * nobody had looked at; it asked a new person to edit forty-two names before
 * they had seen one charge of their own. The Categories step's words are not
 * the mockup's — they came after, from a run of U9.
 */

import type { GuideStep } from '@/domain/guide.ts'

const AFTER_A_STATEMENT = { step: 'read', until: 'a statement is read' } as const

export const LEDGER_GUIDE: readonly GuideStep[] = [
  {
    id: 'read',
    route: '/',
    where: 'Home › Month',
    place: 'home.read',
    title: 'Drop statements, paychecks and fund reports here',
    body:
      'Card and bank exports, paycheck and fund report PDFs, any number at once. Each goes to the reader ' +
      'that knows it, and nothing is written until you press Write.',
    test: 'a transaction or a paycheck exists',
  },
  {
    id: 'merchant',
    route: '/transactions/merchants',
    where: 'Transactions › By merchant',
    place: 'tx.merchant',
    title: 'Give each shop a category, once',
    body:
      'By merchant lists the names nothing has categorized yet, most charges first. One decision categorizes every ' +
      'charge from that shop, and can become a rule so next month’s are categorized on import.',
    test: 'By merchant has nothing left to categorize, a skipped shop counting as decided',
    needs: AFTER_A_STATEMENT,
  },
  {
    id: 'categories',
    route: '/categories',
    where: 'Categories',
    place: 'categories.new',
    title: 'Make the list of categories yours',
    body:
      'Emerald starts you with a list. Add the ones you think in, and rename, recolour or archive the ' +
      'rest: New category is at the top, and right-click a category for everything else.',
    test: 'a category is one you made or changed',
  },
  {
    id: 'fixed',
    route: '/plan',
    where: 'Plan › Bills',
    place: 'plan.fixed',
    title: 'Say what leaves every month',
    body:
      'Rent, the phone, insurance. Emerald lists charges that look like bills; for each one you track, ' +
      'pick what it does to the plan.',
    test: 'a bill is tracked',
    needs: AFTER_A_STATEMENT,
  },
  {
    id: 'split',
    route: '/plan',
    where: 'Plan › The split',
    place: 'plan.split',
    title: 'Give the rest a job',
    body:
      'What net pay leaves after the bills is split into buckets. A bucket is for a category, a goal, ' +
      'a debt or an account. Drag a divider to resize.',
    test: 'a plan exists',
  },
  {
    id: 'opening',
    route: '/wealth',
    where: 'Wealth › Net worth › a bank account, opened',
    place: 'wealth.opening',
    title: 'What was in the bank before the statements',
    body:
      'Statements start somewhere. The opening balance stands for everything before that date, and the ' +
      'last statement checks it: opening plus what moved has to equal the balance.',
    test: 'every account has an opening balance',
    needs: AFTER_A_STATEMENT,
  },
  {
    id: 'cushion',
    route: '/plan',
    where: 'Plan › The cushion',
    place: 'plan.cushion',
    title: 'How much should always stay in the bank',
    body:
      'The cushion is what is left in the bank once the goals saved there take their parts, against ' +
      'a number of months of bills. Every bank account counts until you untick it; you pick the months, and Emerald does the multiplication.',
    test: 'the cushion has its months',
  },
]
