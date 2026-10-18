/**
 * `fixed_expenses`, `debts` and `savings` — the three tools over the standing
 * commitments rather than over the ledger.
 *
 * Each one goes through the single summary call its screen already makes:
 * `debtsSummary` and `savingsSummary` compute every derived figure in one pass
 * precisely so that a total and the rows under it cannot disagree (D-071,
 * D-085). A plugin that added up the rows itself would be a second opinion on
 * arithmetic that already has one.
 */

import type { CurrencyCode } from '@/core/money.ts'
import { yearMonthOf } from '@/core/time.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { debtsSummary } from '@/data/repositories/debtRepository.ts'
import { listFixedExpenses } from '@/data/repositories/fixedExpenseRepository.ts'
import { debtsAfter, debtsPlan } from '@/data/repositories/debtPlanRepository.ts'
import { goalsAfter, goalsPlan, type GoalRow } from '@/data/repositories/goalPlanRepository.ts'
import { goalFeeds, goalHoldingFeeds, goalWorth, holdingPutIn } from '@/data/repositories/goalDepositRepository.ts'
import { holdingWorths, listHoldingReadings, type HoldingReading } from '@/data/repositories/holdingReadingRepository.ts'
import { netWorth } from '@/data/repositories/netWorthRepository.ts'
import { describeGap } from '@/domain/netWorth.ts'
import { checksTable } from './holdingReadings.ts'
import { listAccounts } from '@/data/repositories/accountRepository.ts'
import {
  SPENDING_WINDOW_MONTHS,
  cashHoldingOf,
  findGoal,
  listDeposits,
  documentMoneyMap,
  savingsSummary,
} from '@/data/repositories/savingsRepository.ts'
import type { HoldingPlace } from '@/domain/model/savings.ts'
import type { PlaceBalance, StatementPlace } from '@/domain/savings.ts'
import { originSplit } from '@/domain/goalDeposits.ts'
import { leftAfter } from '@/domain/debtPlan.ts'
import { agreedGrowthAfter, balanceAfter } from '@/domain/goalPlan.ts'
import { MOVED_MONTHS } from '@/domain/goalRhythm.ts'

import { isLedgerMatched, monthlyShare } from '@/domain/fixedExpenses.ts'
import type { PayoffProjection } from '@/domain/debt.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import {
  capNote,
  count,
  date,
  money,
  paragraphs,
  percent,
  period,
  plural,
  section,
  table,
  verb,
} from '../format.ts'
import { today } from '../today.ts'
import { categoryPaths } from './ledger.ts'
import {
  PATH_PROP,
  booleanProp,
  numberProp,
  optionalBoolean,
  optionalNumber,
  requireString,
  type Args,
  type PluginTool,
} from './tool.ts'

const LIST_MAX = 500

// --- fixed_expenses --------------------------------------------------------

/**
 * The standing commitments, with each one's monthly equivalent.
 *
 * `monthlyShare` rather than the stored amount is what makes a yearly premium
 * comparable with a monthly subscription — a yearly figure printed beside
 * eleven monthly ones is a number that invites the wrong sum. Both are shown,
 * because the charge is the fact and the share is the comparison.
 */
function renderFixedExpenses(document: OpenDocument, includeInactive: boolean): string {
  // Paths rather than ids, from the same listing `category_tree` prints, so the
  // two tools name a category identically.
  const paths = categoryPaths(document)
  const all = listFixedExpenses(document.db)
  const expenses = includeInactive ? all : all.filter((expense) => expense.isActive)
  const shown = expenses.slice(0, LIST_MAX)

  if (expenses.length === 0) {
    return includeInactive
      ? 'This document has no bills.'
      : 'No active bills. Pass include_inactive to see ended ones.'
  }

  return paragraphs(
    capNote(shown.length, expenses.length, 'bill', LIST_MAX) +
      (includeInactive ? ' Ended ones included.' : ' Active only.'),
    table(
      ['Name', 'Expected', 'Per month', 'Cadence', 'Amount', 'Category', 'Match', 'Flags', 'Id'],
      shown.map((expense) => [
        expense.name,
        money(expense.expectedAmount),
        money(monthlyShare(expense)),
        expense.cadence,
        expense.amountVariability,
        expense.categoryId === undefined
          ? '—'
          : (paths.get(expense.categoryId) ?? expense.categoryId),
        isLedgerMatched(expense) ? expense.matchKind : `${expense.matchKind} (not ledger-matched)`,
        [
          expense.isDiscretionary ? 'cuttable' : 'necessary',
          expense.isActive ? undefined : `ended ${date(expense.endedAt)}`,
          expense.source,
        ]
          .filter((mark) => mark !== undefined)
          .join(', '),
        expense.id,
      ]),
    ),
    'Expected is the whole charge — a yearly premium holds the year figure — and Per month is ' +
      'that charge amortized, which is the only one of the two it is safe to add across rows. ' +
      'Fixed and cuttable are different axes: rent is neither, a gym membership is both.',
  )
}

export const fixedExpensesTool: PluginTool = {
  definition: {
    name: 'fixed_expenses',
    title: 'Bills',
    description:
      'The bills the document tracks: what each is expected to cost, its ' +
      'amortized monthly equivalent, its cadence, whether the amount is fixed or variable, what ' +
      'it is matched against in the ledger, and whether the user marked it cuttable. Active ones ' +
      'by default.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        include_inactive: booleanProp('Include ended bills. Default false.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) =>
      renderFixedExpenses(document, optionalBoolean(args, 'include_inactive') === true),
    ),
}

// --- debts -----------------------------------------------------------------

/**
 * A payoff projection as a sentence.
 *
 * Every branch that is not `PROJECTED` says why there is no date, because "we
 * cannot tell yet, and here is what would let us" is a useful answer and a
 * blank cell is not.
 */
function projection(value: PayoffProjection): string {
  switch (value.kind) {
    case 'SETTLED':
      return 'settled'
    case 'UNCHECKED':
      return 'no projection — what is owed is not one figure (a payment in another currency)'
    case 'NO_BASIS':
      return 'no projection — nothing paid yet and no expected payment set'
    case 'NEEDS_TWO_PAYMENTS':
      return 'no projection — one payment so far, and no expected payment to fall back on'
    case 'NOT_REDUCING':
      return 'not reducing — payments are not bringing the principal down'
    case 'BEYOND_HORIZON':
      return `beyond the horizon at ${money(value.monthlyPrincipal)} of principal a month`
    case 'PROJECTED':
      return `${period(value.period)}, in ${count(value.months)} months at ${money(value.monthlyPrincipal)} of principal a month`
  }
}

function renderDebts(document: OpenDocument, args: Args): string {
  const from = yearMonthOf(today())
  const summary = debtsSummary(document.db, from)
  const includeClosed = optionalBoolean(args, 'include_closed') === true
  const rows = summary.rows.filter((row) => includeClosed || !row.debt.isClosed)

  if (summary.rows.length === 0) {
    return 'This document has no debts.'
  }

  return paragraphs(
    `${count(summary.openCount)} open, ${count(summary.closedCount)} closed.`,
    table(
      ['Figure', 'Amount'],
      [
        ['Total principal', money(summary.totalPrincipal)],
        ['Total paid', money(summary.totalPaid)],
        ['Total outstanding', money(summary.totalOutstanding)],
        ['Installment commitment, not yet charged', money(summary.installmentCommitment)],
      ],
    ),
    summary.unconfirmedCount === 0
      ? undefined
      : `${plural(summary.unconfirmedCount, 'discovered payment')} ` +
        `${verb(summary.unconfirmedCount, 'is', 'are')} still unconfirmed. They are ` +
        'counted in the figures above; the app review queue is where they get answered.',
    summary.settledButOpenCount === 0
      ? undefined
      : `${plural(summary.settledButOpenCount, 'debt')} ` +
        `${verb(summary.settledButOpenCount, 'is', 'are')} fully paid but still open.`,
    section(
      'Debts',
      table(
        ['Name', 'Kind', 'Principal', 'Paid', 'Outstanding', 'Progress', 'Payoff', 'Flags'],
        rows.slice(0, LIST_MAX).map((row) => [
          row.debt.name,
          row.debt.kind,
          money(row.balance.principal),
          row.balance.kind === 'KNOWN' ? money(row.balance.totalPaid) : 'unchecked',
          row.balance.kind === 'KNOWN' ? money(row.balance.outstanding) : 'unchecked',
          row.balance.kind === 'KNOWN' ? percent(row.balance.progressBasisPoints) : '—',
          projection(row.projection),
          [
            row.debt.isClosed ? 'closed' : undefined,
            row.balance.unconfirmedCount === 0
              ? undefined
              : `${count(row.balance.unconfirmedCount)} unconfirmed`,
          ]
            .filter((mark) => mark !== undefined)
            .join(', ') || '—',
        ]),
      ),
    ),
    summary.unchecked.length === 0
      ? undefined
      : `${plural(summary.unchecked.length, 'debt')} ${verb(summary.unchecked.length, 'is', 'are')} ` +
        'unchecked and left out of the totals above — a payment in another currency than the debt, ' +
        'so what is owed is not one figure: ' +
        summary.unchecked.map((debt) => debt.name).join(', ') +
        '.',
    summary.otherCurrency.length === 0
      ? undefined
      : `${plural(summary.otherCurrency.length, 'debt')} ` +
        `${verb(summary.otherCurrency.length, 'is', 'are')} in another currency and left out ` +
        'of the totals above: ' +
        summary.otherCurrency.map((debt) => `${debt.name} (${debt.principalAmount.currency})`).join(', ') +
        '. Combining them would need an exchange rate this document does not have.',
    'Paid is what left the account, interest included. Outstanding counts down by principal ' +
      'only, so the two do not sum. The installment commitment is future slices only — the ones ' +
      'already charged are in the spending totals.',
  )
}

export const debtsTool: PluginTool = {
  definition: {
    name: 'debts',
    title: 'Debts',
    description:
      'Every debt with its principal, what has been paid, what is outstanding, how far along it ' +
      'is and when it projects to be paid off — plus the totals and what card installments still ' +
      'commit the user to. Open debts by default.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        include_closed: booleanProp('Include closed debts in the table. Default false.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderDebts(document, args)),
}

// --- savings ---------------------------------------------------------------

/**
 * A goal fed by its holding's rows (M30 U4, D-357): what they put in, and that figure against
 * the cost basis a reading printed — proved, failed or unchecked, and never left unsaid.
 */
function holdingFeedText(document: OpenDocument, holdingId: string, name: string, currency: CurrencyCode): string {
  const fed = holdingPutIn(document.db, holdingId, currency)
  const by = fed.reading === undefined ? '' : ` (${money(fed.reading.putIn)} by its reading of ${fed.reading.asOf})`
  const check =
    fed.check.kind === 'PROVED'
      ? 'matches its cost basis'
      : fed.check.kind === 'FAILED'
        ? `cost basis ${money(fed.check.printed)} — off by ${money(fed.check.difference)}`
        : `unchecked: ${fed.check.reason}`
  return `the rows that name ${name}: ${plural(fed.rows, 'row')} put in ${money(fed.putIn)}${by}; ${check}`
}

/**
 * The latest reading of every holding that has one (M30 U5, D-358), with what each
 * proves — and, for a goal fed by its holding, what it is worth now beside what went in.
 */
function readingsSection(document: OpenDocument, currency: CurrencyCode, funds: ReadonlySet<string>): string | undefined {
  const latest = new Map<string, HoldingReading>()
  // A fund's readings are its reports, and `funds` reads them (D-389).
  for (const reading of listHoldingReadings(document.db)) if (!funds.has(reading.holdingId)) latest.set(reading.holdingId, reading)
  if (latest.size === 0) return undefined
  const worth = [...goalHoldingFeeds(document.db).keys()].flatMap((goalId) => {
    const one = goalWorth(document.db, goalId, currency)
    return one === undefined
      ? []
      : [[findGoal(document.db, goalId)?.name ?? goalId, money(one.worth), one.asOf, money(one.putIn)]]
  })
  return section(
    'What the latest readings say',
    paragraphs(
      checksTable(document, [...latest.values()]),
      worth.length === 0 ? undefined : table(['Goal', 'Worth now', 'Latest reading', 'Put in'], worth),
    ),
  )
}

function renderSavings(document: OpenDocument, args: Args): string {
  const asOf = today()
  const currency = documentCurrency(document.db)
  const includeClosed = optionalBoolean(args, 'include_closed') === true
  const summary = savingsSummary(document.db, asOf, currency, { includeClosed })
  // A holding with a reading is worth it, goal or none (M30 F5): its balance below is that.
  const worths = holdingWorths(document.db, currency)
  const feeds = goalFeeds(document.db)
  // A bank account's own place adds up to its statement (M30 F7): its Cash is what no goal has taken.
  const statementPlaces = documentMoneyMap(document.db, currency).places.filter((row) => row.statement !== undefined)
  const ownCash = new Map(
    statementPlaces.flatMap((row) =>
      row.statement?.cashHoldingId === undefined ? [] : [[row.statement.cashHoldingId, row.statement] as const],
    ),
  )
  const paths = categoryPaths(document)
  const placeNames = new Map(
    summary.places.map((row) => [row.holdingPlaceId, row.place?.name ?? '—']),
  )

  if (summary.goals.length === 0 && summary.holdings.length === 0) {
    return 'This document has no goals or holdings.'
  }
  // **A fund is a holding** (D-389), counted in the figures below once; its rows,
  // its readings and its deposit check are `funds`'s, so the holdings table leaves it out.
  const funds = new Set(summary.holdings.filter((row) => row.holding?.fundType !== undefined).map((row) => row.holdingId))
  const held = summary.holdings.filter((row) => !funds.has(row.holdingId))

  // **The one net worth** (M36 U07): the figure Overview shows, and its parts.
  const worth = netWorth(document.db, asOf, currency)

  return paragraphs(
    table(
      ['Figure', 'Amount'],
      [
        ['Net worth', money(worth.worth)],
        ['In the bank', money(worth.inBank)],
        ['In accounts with holdings', money(worth.held)],
        ['Locked', money(worth.locked)],
        ['In pension and hishtalmut funds', money(worth.funds)],
        ['Owed on debts', money(worth.liabilities)],
        ['Held against goals', money(summary.inGoals)],
      ],
    ),
    'Net worth is the one figure Overview shows: the bank accounts’ last statements and the liquid money ' +
      'outside them (In the bank), what accounts with holdings hold, every locked holding, and the funds, ' +
      'less what is owed — each counted once. Held against goals is part of it, not added to it.' +
      (worth.gaps.length === 0 ? '' : ` Not counted: ${worth.gaps.map(describeGap).join('; ')}.`),
    section(
      'Goals',
      summary.goals.length === 0
        ? 'No goals.'
        : table(
            ['Goal', 'Balance', 'Liquid', 'Opening', 'Contributed', 'Withdrawn', 'Growth', 'Deposits'],
            summary.goals.slice(0, LIST_MAX).map((progress) => [
              progress.goal.name + (progress.goal.isClosed ? ' (closed)' : ''),
              // Deposits in two currencies: no one figure, and said so (M36 U03, D-349).
              progress.unchecked === undefined ? money(progress.balance) : 'unchecked — deposits in two currencies',
              progress.unchecked === undefined ? money(progress.liquid) : '—',
              progress.unchecked === undefined ? money(progress.openingBalance) : '—',
              money(progress.contributed),
              money(progress.withdrawn),
              money(progress.growth),
              count(progress.depositCount),
            ]),
          ),
    ),
    section(
      'Where the money came from',
      summary.goals.length === 0
        ? 'No goals.'
        : table(
            ['Goal', 'Read from the bank', 'Set aside', 'Was already there', 'Growth', 'Bank deposits come from'],
            summary.goals.slice(0, LIST_MAX).map((progress) => {
              const split = originSplit(
                listDeposits(document.db, { goalId: progress.goal.id }),
                currency,
              )
              const feed = feeds.get(progress.goal.id)
              return [
                progress.goal.name + (progress.goal.isClosed ? ' (closed)' : ''),
                money(split.DERIVED),
                money(split.SET_ASIDE),
                money(split.ALREADY_THERE),
                money(split.GROWTH),
                feed === undefined
                  ? '—'
                  : feed.kind === 'CATEGORY'
                    ? (paths.get(feed.id) ?? feed.name)
                    : feed.kind === 'TRANSFERS'
                      ? `the transfers into ${feed.name}`
                      : holdingFeedText(document, feed.id, feed.name, currency),
              ]
            }),
          ),
    ),
    section(
      'Where it is held',
      held.length === 0
        ? funds.size === 0
          ? 'No holdings.'
          : 'No holdings but the funds, which `funds` lists.'
        : table(
            // **A holding, with the place beside it** (D-175). A row per place
            // could only report one liquidity for a bank that holds cash and a
            // locked deposit, and that is the figure the emergency fund turns
            // on. `id` is the column a `record_deposits` call names. A holding
            // with a reading is worth it (M30 F5): `Read` is its day, `Growth`
            // the reading less what its rows put in by then.
            ['Holding', 'Place', 'Balance', 'Read', 'Growth', 'Liquid', 'Known by', 'Last checked', 'Deposits', 'id'],
            held.slice(0, LIST_MAX).map((row) => [
              (row.holding?.name ?? `unknown (${row.holdingId})`) + (ownCash.has(row.holdingId) ? ', not for any goal' : ''),
              placeNames.get(row.holding?.holdingPlaceId ?? '') ?? '—',
              ownCashText(ownCash.get(row.holdingId)) ?? money(row.balance),
              worths.get(row.holdingId)?.asOf ?? '—',
              money(worths.get(row.holdingId)?.growth),
              row.isLiquid ? 'yes' : 'no',
              row.holding?.provenance ?? '—',
              row.holding?.lastConfirmedAt === undefined
                ? 'never'
                : date(row.holding.lastConfirmedAt),
              count(row.depositCount),
              row.holdingId,
            ]),
          ),
    ),
    placeAccountsSection(document, summary.places),
    statementPlacesSection(statementPlaces),
    readingsSection(document, currency, funds),
    `The emergency-fund basis, over the last ${count(SPENDING_WINDOW_MONTHS)} months: total ` +
      `spending ${money(summary.monthly.totalSpending)}, bills only ` +
      `${money(summary.monthly.fixedExpenses)}. Which of the two a goal is measured against is ` +
      'the goal own setting.',
    summary.liquidity.unknownHoldingIds.length === 0
      ? undefined
      : `${plural(summary.liquidity.unknownHoldingIds.length, 'deposit')} ` +
        `${verb(summary.liquidity.unknownHoldingIds.length, 'names', 'name')} a holding this ` +
        'document does not have. They are counted as locked, deliberately: the failure that ' +
        'matters is calling money reachable when it is not.',
    summary.orphaned.length === 0
      ? undefined
      : `${plural(summary.orphaned.length, 'deposit')} ` +
        `${verb(summary.orphaned.length, 'belongs', 'belong')} to a goal that no longer exists and ` +
        'are left out of every figure above.',
    summary.otherCurrency.length === 0
      ? undefined
      : `${plural(summary.otherCurrency.length, 'deposit')} ` +
        `${verb(summary.otherCurrency.length, 'is', 'are')} in another currency and ` +
        'left out of the totals — combining them would need an exchange rate this document ' +
        'does not have.',
    'The four ways money reached a goal — opening, contributed, withdrawn, growth — sum to its ' +
      'balance exactly. Withdrawn is negative, and growth is negative in a bad year.',
  )
}

/** A bank account's own Cash as the tool lists it: what no goal has taken, or the check that failed. */
function ownCashText(statement: StatementPlace | undefined): string | undefined {
  if (statement === undefined) return undefined
  return statement.short === undefined
    ? money(statement.cash)
    : `none — failed: the goals here hold ${money(statement.short)} more than the statement's ${money(statement.balance)}`
}

/**
 * A bank or cash account's own place, row by row (M30 F7, D-376): its statement,
 * each goal's part, and the Cash no goal has taken — which add up to the
 * statement. Said only when such a place exists.
 */
function statementPlacesSection(rows: readonly PlaceBalance[]): string | undefined {
  const lines = rows.flatMap((row) => {
    const statement = row.statement
    if (statement === undefined) return []
    const name = row.place?.name ?? '—'
    return [
      [name, 'The statement', money(statement.balance)],
      ...statement.parts.map((part) => [name, part.goalName, money(part.amount)]),
      [name, 'Cash, not for any goal', ownCashText(statement) ?? '—'],
    ]
  })
  if (lines.length === 0) return undefined
  return section(
    "What a bank account's statement holds",
    paragraphs(
      table(['Place', 'Row', 'Amount'], lines),
      'Each goal saved in the account is a part of its statement, and its Cash is the rest. ' +
        'The totals above count goal money and never a statement, so they do not include the rest.',
    ),
  )
}

/**
 * Which account each place names, and which holding is that account's cash
 * (M30 U1, D-354). Said only when a place names one, so a document that links
 * nothing reads exactly as it did.
 */
function placeAccountsSection(
  document: OpenDocument,
  places: readonly { readonly place?: HoldingPlace | undefined; readonly holdingPlaceId: string }[],
): string | undefined {
  const linked = places.flatMap((row) =>
    row.place?.accountId === undefined ? [] : [{ place: row.place, accountId: row.place.accountId }],
  )
  if (linked.length === 0) return undefined
  const accounts = new Map(listAccounts(document.db, { includeArchived: true }).map((one) => [one.id, one]))
  return section(
    'Places and their accounts',
    table(
      ['Place', 'Account', 'Kind', 'Its cash', 'Place id'],
      linked.map(({ place, accountId }) => {
        const account = accounts.get(accountId)
        return [
          place.name,
          account?.name ?? accountId,
          account?.kind ?? '—',
          cashHoldingOf(document.db, accountId)?.name ?? '—',
          place.id,
        ]
      }),
    ),
  )
}

export const savingsTool: PluginTool = {
  definition: {
    name: 'savings',
    title: 'Savings',
    description:
      'Goals and where the money is: net worth — the one figure Overview shows, with its ' +
      'parts (in the bank, in accounts with holdings, locked, pension and hishtalmut funds, owed) — ' +
      'each goal balance broken into the four ways money got there, and the monthly expense figure ' +
      'the emergency-fund target is measured against. Open goals by default.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        include_closed: booleanProp('Include closed goals. Default false.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderSavings(document, args)),
}

// --- goal_projection --------------------------------------------------------

/** What moved, against Plan only over the months the goal was taking money (U9; the screen's rule). */
function movedAgainstPlan(row: GoalRow): string {
  const versus = row.versusPlan
  if (versus.kind === 'PAUSED') return `${money(row.moved)} (paused, not compared)`
  if (versus.kind === 'NOTHING_YET') return `${money(row.moved)} (nothing to compare yet)`
  const over = versus.months === MOVED_MONTHS ? '' : ` over ${plural(versus.months, 'month')}`
  return `${money(row.moved)} (plan: ${money(versus.planned)}${over})`
}

/** The set-aside amounts nobody has confirmed for 90 days, as the question to ask (S5). */
function staleLines(rows: readonly GoalRow[]): string | undefined {
  const asking = rows.filter((row) => row.stale.length > 0)
  if (asking.length === 0) return undefined
  return (
    'Still set aside? These amounts were promised to a goal more than 90 days ago and nobody has ' +
    'said they are still in the balance: ' +
    asking
      .map((row) => `${row.line.name} ${money({ ...row.line.balance, minor: row.stale.reduce((sum, one) => sum + one.amount.minor, 0) })}`)
      .join('; ') +
    '. Ask, then `settle_set_aside`.'
  )
}

/**
 * What each goal will hold in N months — the Goals screen's deciding view.
 *
 * The same read the screen makes (`goalsPlan`): a goal's monthly amount is the
 * Plan bucket that points at it, and the projection is plain addition that stops
 * at the target, with no interest counted. To change an amount, `set_plan`.
 */
function renderGoalProjection(document: OpenDocument, args: Args): string {
  const asOf = today()
  const currency = documentCurrency(document.db)
  const months = Math.min(600, Math.max(1, Math.round(optionalNumber(args, 'months') ?? 12)))
  const read = goalsPlan(document.db, asOf, currency)
  if (read.rows.length === 0) return 'This document has no open goals.'

  const words = (row: (typeof read.rows)[number]): string => {
    switch (row.status.kind) {
      case 'REACHED':
        return 'already there'
      case 'ON_TIME':
        return `on time, reached ${period(row.status.at)}`
      case 'LATE':
        return `late, reached ${period(row.status.at)} (${plural(row.status.monthsLate, 'month')} after the date)`
      case 'NO_DATE':
        return `no date, reached ${period(row.status.at)}`
      case 'NO_MONEY':
        return 'nothing is going toward it'
      case 'NO_TARGET':
        return 'no target, a running total'
    }
  }

  return paragraphs(
    table(
      [
        'Goal',
        'Now',
        'Target',
        'Date',
        'Each month',
        'Moved, last 3 months',
        `In ${String(months)}`,
        'Bank-agreed rate would add',
        'Needs for the date',
        'At this rate',
      ],
      read.rows.map((row) => [
        row.line.name,
        money(row.line.balance),
        row.line.target === undefined ? '—' : money(row.line.target),
        row.line.due === undefined ? '—' : period(row.line.due),
        row.pausedUntil === undefined ? money(row.line.monthly) : `paused until ${period(row.pausedUntil)}`,
        movedAgainstPlan(row),
        money(balanceAfter(row.line, months)),
        row.line.agreedRateBasisPoints === undefined
          ? '—'
          : `${money(agreedGrowthAfter(row.line, months))} at ${percent(row.line.agreedRateBasisPoints)}`,
        row.needed === undefined ? '—' : money(row.needed),
        words(row),
      ]),
    ),
    staleLines(read.rows),
    `Together: ${money(read.inGoals)} now, ${money(read.monthly)} a month, ${money(goalsAfter(read.rows, months, currency))} in ${plural(months, 'month')}.` +
      (read.left === undefined
        ? ' The document has no plan, so no monthly amount is going toward any goal.'
        : ` Plan has ${money(read.left)} left after every bucket.`),
    'Plain addition: the monthly amount is the goal’s Plan bucket, each goal stops at its target, ' +
      'and no interest is counted (a rate the bank agreed to is shown apart, never inside the figure). To change an ' +
      'amount, edit the bucket with `set_plan`, or `suggest_goal_amounts`; `pause_goals` skips a month.',
  )
}

export const goalProjectionTool: PluginTool = {
  definition: {
    name: 'goal_projection',
    title: 'Goal projection',
    description:
      'What each open goal will hold in N months, by plain addition of the amount Plan puts ' +
      'toward it each month (no interest counted), and what a month would have to be to reach it ' +
      'on its date. The same view as the Goals screen.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        months: numberProp('How many months ahead. Default 12.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderGoalProjection(document, args)),
}

// --- debt_projection --------------------------------------------------------

/**
 * What each open debt will have left in N months — the Debts screen's deciding
 * view (M28 U8, D-325): the debt's own monthly payment plus the Plan bucket that
 * points at it, by plain addition and with no interest counted, because a debt
 * here carries no rate. To change the extra, `set_plan`.
 */
function renderDebtProjection(document: OpenDocument, args: Args): string {
  const asOf = today()
  const currency = documentCurrency(document.db)
  const months = Math.min(600, Math.max(1, Math.round(optionalNumber(args, 'months') ?? 12)))
  const read = debtsPlan(document.db, asOf, currency)
  if (read.rows.length === 0) return 'This document has no open debts.'

  const words = (row: (typeof read.rows)[number]): string => {
    switch (row.status.kind) {
      case 'PAID':
        return 'paid off'
      case 'PAID_OFF':
        return (
          `paid off ${period(row.status.at)}` +
          (row.status.sooner === undefined ? '' : `, ${plural(row.status.sooner, 'month')} sooner with the extra`)
        )
      case 'NO_PAYMENT':
        return 'nothing is going toward it each month'
    }
  }

  return paragraphs(
    table(
      ['Debt', 'Left', 'Paid each month', 'Extra (Plan)', `In ${String(months)}`, 'At this rate'],
      read.rows.map((row) => [
        row.line.name,
        money(row.line.left),
        row.line.payment.minor === 0 ? '—' : money(row.line.payment),
        money(row.line.extra),
        money(leftAfter(row.line, months)),
        words(row),
      ]),
    ),
    `Together: ${money(read.left)} left, ${money(read.payment)} a month usual and ${money(read.extra)} extra, ` +
      `${money(debtsAfter(read.rows, months, currency))} left in ${plural(months, 'month')}.` +
      (read.otherCurrency > 0 ? ` ${plural(read.otherCurrency, 'debt')} in another currency left out.` : ''),
    'Plain addition: the payment is the debt\u2019s standing order (or what it has been coming down by), the extra is ' +
      'the debt’s Plan bucket, and no interest is counted. To change the extra, edit the bucket with `set_plan`.',
  )
}

export const debtProjectionTool: PluginTool = {
  definition: {
    name: 'debt_projection',
    title: 'Debt projection',
    description:
      'What each open debt will have left in N months, by plain addition of its monthly payment and ' +
      'the extra Plan puts toward it (no interest counted), and when it is paid off with and without ' +
      'the extra. The same view as the Debts screen.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        months: numberProp('How many months ahead. Default 12.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderDebtProjection(document, args)),
}
