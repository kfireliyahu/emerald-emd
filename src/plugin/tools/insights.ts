/**
 * `month_summary` and `year_summary` — the two tools that hand back a period
 * already added up.
 *
 * Both go through `monthlyReport` / `yearlyReport`, which are the same single
 * calls the Insights screens make, and for the same stated reason (D-071,
 * D-085, D-088): the headline, the chips, the breakdown and the split are all
 * views of one period, and anything that assembled them from separate reads is
 * something whose figures can disagree with each other. A plugin computing its
 * own totals would be a third place the definition of "an expense" lives, which
 * docs/f10 warns about by name.
 *
 * The cumulative curve is deliberately not rendered. It is a shape, it is forty
 * numbers, and a conversation gets nothing from it that the totals and the
 * comparisons do not already say.
 */

import { documentCurrency, monthlyReport, payrollYear, yearlyReport, type MonthlyReport } from '@/data/repositories/statisticsRepository.ts'
import type { CategoryLine, Comparison, IncomeLine, MonthSummary } from '@/domain/model/statistics.ts'
import { salaryBankWords } from '@/domain/salaryBank.ts'
import { salaryProblem } from '@/domain/statistics.ts'
import type { CurrencyCode } from '@/core/money.ts'
import { yearMonthOf, type YearMonth } from '@/core/time.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { count, date, money, paragraphs, percent, period, section, table } from '../format.ts'
import { today } from '../today.ts'
import {
  PATH_PROP,
  ToolInputError,
  numberProp,
  optionalNumber,
  optionalPeriod,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

/**
 * One comparison chip, including the case where there is not one.
 *
 * `NO_BASIS` is rendered as its reason rather than as a dash, because "there is
 * no month to compare against" and "it did not change" are different answers
 * and printing 0% for the first is a claim about a month nobody imported.
 */
function comparison(label: string, value: Comparison): string {
  if (value.kind === 'NO_BASIS') return `${label}: no comparison (${value.reason}).`
  const change =
    value.basisPoints === undefined
      ? `${money(value.basis)} → ${money(value.current)}`
      : `${value.basisPoints >= 0 ? '+' : ''}${percent(value.basisPoints)} (${money(value.basis)} → ${money(value.current)})`
  return `${label}: ${change}, a difference of ${money(value.difference)}.`
}

function categoryRows(lines: readonly CategoryLine[]): readonly (readonly string[])[] {
  const rows: string[][] = []
  for (const line of lines) {
    rows.push([line.name, money(line.outflow), percent(line.shareBasisPoints), count(line.transactionCount)])
    for (const child of line.children) {
      rows.push([`— ${child.name}`, money(child.outflow), percent(child.shareBasisPoints), count(child.transactionCount)])
    }
  }
  return rows
}

// --- month_summary ---------------------------------------------------------

/**
 * A salary against the bank, one line each (D-317): the slip is the figure and
 * the deposit proves it, so what is said is whether it did. Nothing at all when
 * the month has no salary.
 */
function salaryLines(lines: readonly IncomeLine[]): string | undefined {
  const salaries = lines.filter((line) => line.salary !== undefined)
  if (salaries.length === 0) return undefined
  const words = { money, date }
  const said = salaries.map(
    (line) => `- ${line.name}${line.kind === 'PAYSLIP' ? ' (paycheck)' : ''}: ${line.salary === undefined ? '' : salaryBankWords(line.salary, words)}${line.salary !== undefined && salaryProblem(line.salary) ? ' **— look at this**' : ''}`,
  )
  return [
    '**Salary against the bank.** The paycheck is the figure, and the deposit that paid it is not ' +
      'counted again, whichever month it landed in.',
    ...said,
  ].join('\n')
}

const times = (n: number, noun: string): string => `${count(n)} ${n === 1 ? noun : `${noun}s`}`

/** What the month's saved is made of (M30 F1): what moved, the slips' saving lines and the goal deposits. */
function savedSection(report: MonthlyReport, currency: CurrencyCode): string | undefined {
  const rows: string[][] = [
    ...report.moved.map((line) => [line.name, `moved, ${times(line.transactionCount, 'row')}`, money({ minor: line.netMinor, currency })]),
    ...report.savedFrom.slips.map((line) => [line.name, 'off the paycheck, the employee part', money(line.amount)]),
    ...report.savedFrom.goals.map((line) => [line.name, `into the goal, ${times(line.count, 'deposit')}`, money(line.amount)]),
  ]
  if (rows.length === 0) return undefined
  return section('What saved is made of', table(['Part', 'From', 'Amount'], rows))
}

function renderMonth(document: OpenDocument, requested: YearMonth | undefined): string {
  const asOf = today()
  const report = monthlyReport(document.db, requested ?? yearMonthOf(asOf), asOf)
  const known = report.months.map((one) => period(one.period))

  if (report.summary === undefined) {
    return paragraphs(
      `No data for ${period(report.period)}.`,
      known.length === 0
        ? 'This document has no transactions at all.'
        : `Months with data: ${known.join(', ')}.`,
    )
  }

  const summary: MonthSummary = report.summary

  return paragraphs(
    `# ${period(report.period)}` + (summary.isComplete ? '' : ' (still running — figures are partial)'),
    table(
      ['Figure', 'Amount'],
      [
        ['Income', money(summary.income)],
        ['Expenses', money(summary.expenses)],
        ['  of which bills', money(report.split.fixed)],
        ['  of which everything else', money(report.split.variable)],
        ['Balance', money(summary.balance)],
        ['Saved', money(summary.saved)],
        ['Savings rate', percent(summary.savingsRateBasisPoints)],
        ['Transactions', count(summary.transactionCount)],
      ],
    ),
    savedSection(report, documentCurrency(document.db)),
    section(
      'Spending, compared',
      [
        comparison('Last month', report.spending.previousMonth),
        comparison('Three-month average', report.spending.recentAverage),
        comparison('Same month last year', report.spending.yearAgo),
      ].join('\n'),
    ),
    section(
      'Income, compared',
      [
        comparison('Last month', report.income.previousMonth),
        comparison('Three-month average', report.income.recentAverage),
        comparison('Same month last year', report.income.yearAgo),
      ].join('\n'),
    ),
    section(
      'Where it went',
      report.categories.length === 0
        ? 'Nothing was spent this month.'
        : table(['Category', 'Outflow', 'Share', 'Rows'], categoryRows(report.categories)),
    ),
    section(
      'Fixed versus variable',
      [
        `Fixed ${money(report.split.fixed)} (${percent(report.split.fixedShareBasisPoints)} of spending, ` +
          `${percent(report.split.fixedShareOfIncomeBasisPoints)} of income).`,
        `Variable ${money(report.split.variable)} (${percent(report.split.variableShareBasisPoints)}).`,
        `Of the fixed part, ${money(report.split.discretionary)} is marked cuttable.`,
        'The split is of what was actually charged, not of what was declared.',
      ].join('\n'),
    ),
    section(
      'Where it came from',
      paragraphs(
        `Payroll ${money(report.detail.payroll)} (${percent(report.detail.payrollShareBasisPoints)}), ` +
          `other inflow ${money(report.detail.other)}, total ${money(report.detail.total)}.`,
        report.detail.lines.length === 0
          ? undefined
          : table(
              ['Source', 'Kind', 'Amount', 'Share', 'Latest'],
              report.detail.lines.map((line) => [
                line.name,
                line.kind,
                money(line.amount),
                percent(line.shareBasisPoints),
                date(line.date),
              ]),
            ),
        salaryLines(report.detail.lines),
      ),
    ),
    `Months with data: ${known.join(', ')}.`,
  )
}

export const monthSummaryTool: PluginTool = {
  definition: {
    name: 'month_summary',
    title: 'Month summary',
    description:
      'One month already added up: income, expenses, balance, savings rate; how each compares ' +
      'with last month, the three-month average and the same month last year; the category ' +
      'breakdown rolled up to parents; the fixed-versus-variable split; and where the income ' +
      'came from. Defaults to the current month. Every figure comes from the same call the app ' +
      'own Insights screen makes, so they cannot disagree.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        month: stringProp('The month as YYYY-MM. Defaults to the current month.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) =>
      renderMonth(document, optionalPeriod(args, 'month')),
    ),
}

// --- year_summary ----------------------------------------------------------

function yearArg(args: Args, fallback: number): number {
  const value = optionalNumber(args, 'year')
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1900 || value > 3000) {
    throw new ToolInputError(`\`year\` must be a four-digit year; got ${value}.`)
  }
  return value
}

function renderYear(document: OpenDocument, args: Args): string {
  const asOf = today()
  const year = yearArg(args, asOf.year)
  const overview = yearlyReport(document.db, year, asOf)
  const payroll = payrollYear(document.db, year)

  if (overview.monthsWithData === 0) {
    return `No data for ${year}. Reporting currency is ${documentCurrency(document.db)}.`
  }

  return paragraphs(
    `# ${year}`,
    table(
      ['Figure', 'Amount'],
      [
        ['Income', money(overview.income)],
        ['Expenses', money(overview.expenses)],
        ['Balance', money(overview.balance)],
        ['Saved', money(overview.saved)],
        ['Savings rate', percent(overview.savingsRateBasisPoints)],
        ['Months with data', count(overview.monthsWithData)],
        ['Complete months', count(overview.completeMonths)],
        ['Average income, complete months', money(overview.averageIncome)],
        ['Average expenses, complete months', money(overview.averageExpenses)],
      ],
    ),
    overview.bestMonth === undefined && overview.worstMonth === undefined
      ? 'No month is complete yet, so there is no best or worst.'
      : `Best month by balance: ${overview.bestMonth === undefined ? '—' : period(overview.bestMonth.period)}. ` +
        `Worst: ${overview.worstMonth === undefined ? '—' : period(overview.worstMonth.period)}. ` +
        'Both are among complete months only.',
    section(
      'Month by month',
      table(
        ['Month', 'Income', 'Expenses', 'Balance', 'Saved', 'Rows'],
        overview.months.map((one, index) => {
          const label = `${year}-${String(index + 1).padStart(2, '0')}`
          // An absent month is drawn as nothing, never as twelve zeroes — the
          // same rule the yearly overview screen follows (D-089).
          if (one === undefined) return [label, '—', '—', '—', '—', '—']
          return [
            label + (one.isComplete ? '' : ' (partial)'),
            money(one.income),
            money(one.expenses),
            money(one.balance),
            money(one.saved),
            count(one.transactionCount),
          ]
        }),
      ),
    ),
    section(
      'What the paychecks say',
      payroll.slips === 0
        ? `No paychecks were entered for ${year}, so there is no gross, tax or payroll figure. ` +
          'That is an absence, not a zero — the spending totals above are unaffected.'
        : [
            `Gross ${money(payroll.gross)}, net ${money(payroll.net)}, tax ${money(payroll.tax)} ` +
              `(${percent(payroll.taxRateBasisPoints)}), saved through payroll ${money(payroll.saved)}.`,
            `${count(payroll.slips)} paychecks. A year with fewer than twelve is why a gross may ` +
              'look low.',
          ].join('\n'),
    ),
  )
}

export const yearSummaryTool: PluginTool = {
  definition: {
    name: 'year_summary',
    title: 'Year summary',
    description:
      'One year already added up: income, expenses, balance and savings rate; averages over the ' +
      'complete months only; the best and worst month by balance; a month-by-month table where a ' +
      'month with no data reads as nothing rather than as zero; and what the paychecks say about ' +
      'gross, tax and payroll savings. Defaults to the current year.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        year: numberProp('Four-digit year. Defaults to the current year.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderYear(document, args)),
}
