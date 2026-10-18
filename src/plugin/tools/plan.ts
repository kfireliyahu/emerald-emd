/**
 * The Plan screen, reachable from a conversation (M28 U7, D-319, D-227, D-234):
 * `plans` and `plan_month` read it, `set_fixed_expense_roles`, `set_plan`,
 * `plan_month` with `commit` and `edit_fixed_expenses` write it.
 *
 * **Each write takes a list and dry-runs until `commit: true`**, with one
 * preview and one `.bak` — the shape every tool here has (D-092, D-110). Each
 * entry is judged against the document *before* anything is written, by the
 * rules the repositories enforce, so the preview says *refused* where the
 * commit would have.
 *
 * **What a fixed expense does to a plan is the plan's** (D-319): a role per plan
 * and expense, and a bill the payslip already took is outside the choice
 * (D-053) — the tool refuses it by name rather than writing a role the plan
 * would never read.
 */

import { fromMajorUnits, money, type CurrencyCode } from '@/core/money.ts'
import { formatYearMonth, parseISODate, parseYearMonth, toYearMonthString, type YearMonth } from '@/core/time.ts'
import { listAccounts } from '@/data/repositories/accountRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { listDebts } from '@/data/repositories/debtRepository.ts'
import {
  deleteFixedExpense,
  findFixedExpense,
  listFixedExpenses,
  updateFixedExpense,
} from '@/data/repositories/fixedExpenseRepository.ts'
import { listFunds } from '@/data/repositories/fundRepository.ts'
import { listPaychecks } from '@/data/repositories/paycheckRepository.ts'
import {
  listAllRoles,
  setRoles,
  type RoleEntry,
} from '@/data/repositories/planFixedRepository.ts'
import { applySuggestions, planMonth, removePlanBuckets, type PlanMonth } from '@/data/repositories/planMonthRepository.ts'
import { listGoals } from '@/data/repositories/savingsRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import {
  createSplitBucket,
  createSplitPlan,
  deleteSplitPlan,
  duplicateSplitPlan,
  findSplitPlan,
  listSplitBuckets,
  listPlanMonths,
  listSplitPlans,
  setDefaultPlan,
  setPlanMonths,
  updateSplitBucket,
  updateSplitPlan,
  type NewAllocation,
} from '@/data/repositories/splitPlanRepository.ts'
import { monthlyShare, validateFixedExpense } from '@/domain/fixedExpenses.ts'
import {
  CADENCES,
  FIXED_ROLES,
  type Cadence,
  type FixedExpense,
  type FixedRole,
} from '@/domain/model/fixed.ts'
import { BASIS_KINDS, type BasisKind, type SplitBucket, type TargetKind } from '@/domain/model/plan.ts'
import type { Suggestion } from '@/domain/splitter.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { count, date, money as showMoney, paragraphs, percent, plural, table } from '../format.ts'
import { today } from '../today.ts'
import { mutatingCall } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalBoolean,
  optionalNumber,
  optionalPeriod,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 100

// --- what a bucket points at, by name ----------------------------------------

const KIND_ARG: Readonly<Record<string, TargetKind>> = {
  goal: 'SAVING_GOAL',
  debt: 'DEBT',
  category: 'CATEGORY',
  fund: 'FUND',
  account: 'ACCOUNT',
  none: 'FREE',
}

const KIND_WORD: Readonly<Record<TargetKind, string>> = {
  SAVING_GOAL: 'goal',
  DEBT: 'debt',
  CATEGORY: 'category',
  FUND: 'fund',
  ACCOUNT: 'account',
  FREE: 'nothing',
}

interface Names {
  readonly SAVING_GOAL: ReadonlyMap<string, string>
  readonly DEBT: ReadonlyMap<string, string>
  readonly CATEGORY: ReadonlyMap<string, string>
  readonly FUND: ReadonlyMap<string, string>
  readonly ACCOUNT: ReadonlyMap<string, string>
}

/**
 * **A bucket's target by name as well as by id** (M33 F12), as every other
 * tool that names a goal takes one: no tool prints a goal's id, so a target
 * named once is resolved here, case-insensitively, when exactly one of its kind
 * is called that. Anything else is left as given, and refused by id below.
 */
function withTargetIds(ask: PlanAsk, names: Names): PlanAsk {
  if (ask.buckets === undefined) return ask
  return {
    ...ask,
    buckets: ask.buckets.map((one) => {
      const target = one.pointsAt
      if (target === undefined || target.kind === 'FREE' || target.id === undefined) return one
      const known = names[target.kind]
      if (known.has(target.id)) return one
      const wanted = target.id.trim().toLowerCase()
      const matches = [...known].filter(([, name]) => name.trim().toLowerCase() === wanted)
      const [match] = matches
      return matches.length === 1 && match !== undefined ? { ...one, pointsAt: { ...target, id: match[0] } } : one
    }),
  }
}

function namesIn(document: OpenDocument): Names {
  const db = document.db
  const named = (rows: readonly { readonly id: string; readonly name: string }[]) =>
    new Map(rows.map((one) => [one.id, one.name]))
  return {
    SAVING_GOAL: named(listGoals(db, { includeClosed: true })),
    DEBT: named(listDebts(db, { includeClosed: true })),
    CATEGORY: new Map(listCategories(db, { includeArchived: true }).map((one) => [one.id, one.path])),
    FUND: named(listFunds(db, { includeArchived: true })),
    ACCOUNT: named(listAccounts(db, { includeArchived: true })),
  }
}

function pointsAt(bucket: SplitBucket, names: Names): string {
  if (bucket.targetKind === 'FREE') return 'nothing in particular'
  const name = bucket.targetId === undefined ? undefined : names[bucket.targetKind].get(bucket.targetId)
  return `${KIND_WORD[bucket.targetKind]}: ${name ?? 'gone'}`
}

// --- plans --------------------------------------------------------------------

function renderPlans(document: OpenDocument, wanted: string | undefined): string {
  const db = document.db
  const plans = listSplitPlans(db).filter((one) => wanted === undefined || one.id === wanted)
  if (plans.length === 0) {
    return wanted === undefined ? 'This document has no plan yet. `set_plan` makes one.' : `No plan has the id ${wanted}.`
  }
  const names = namesIn(document)
  const buckets = new Map(listSplitBuckets(db).map((one) => [one.id, one]))
  const expenses = listFixedExpenses(db).filter((one) => one.isActive)
  const roles = listAllRoles(db)
  const given = listPlanMonths(db)

  return paragraphs(
    ...plans.map((plan) => {
      const found = findSplitPlan(db, plan.id)
      const own = roles.get(plan.id) ?? new Map<string, FixedRole>()
      const basis =
        plan.basisKind === 'CUSTOM_AMOUNT'
          ? `an amount typed, ${showMoney(plan.customAmount)}`
          : plan.basisKind === 'AVERAGE_LAST_N'
            ? `the average of the last ${String(plan.basisMonths ?? 3)} paychecks`
            : plan.basisKind === 'SPECIFIC_PAYCHECK'
              ? `one particular paycheck (${plan.basisPaycheckId ?? 'not chosen'})`
              : 'the last paycheck'
      return paragraphs(
        `### ${plan.name}${plan.isDefault ? ' (default)' : ''} — id \`${plan.id}\``,
        `Net pay is ${basis}. ${monthsLine(plan, given)}`,
        table(
          ['Bill', 'Id', 'Per month', 'What it does to this plan'],
          expenses.map((expense) => [
            expense.name,
            expense.id,
            showMoney(monthlyShare(expense)),
            expense.matchKind === 'PAYCHECK_DEDUCTION'
              ? 'already out of net (from the paycheck)'
              : { NET: 'out of net', SPLIT: 'part of the split', IGNORE: 'ignored' }[own.get(expense.id) ?? 'IGNORE'] +
                (own.has(expense.id) ? '' : ' (no choice made)'),
          ]),
        ),
        found === undefined
          ? undefined
          : table(
              ['Bucket', 'Id', 'For', 'Sized as', 'Value'],
              [...found.allocations]
                .sort((a, b) => (buckets.get(a.bucketId)?.sortOrder ?? 0) - (buckets.get(b.bucketId)?.sortOrder ?? 0))
                .map((allocation) => {
                  const bucket = buckets.get(allocation.bucketId)
                  return [
                    bucket?.name ?? allocation.bucketId,
                    allocation.bucketId,
                    bucket === undefined ? '—' : pointsAt(bucket, names),
                    allocation.mode === 'PERCENTAGE'
                      ? 'percent of the split'
                      : allocation.mode === 'FIXED_AMOUNT'
                        ? 'fixed amount a month'
                        : 'what is left',
                    allocation.mode === 'PERCENTAGE'
                      ? percent(allocation.basisPoints)
                      : allocation.mode === 'FIXED_AMOUNT'
                        ? showMoney(allocation.amount)
                        : '—',
                  ]
                }),
            ),
      )
    }),
    'Buckets are shared between plans; a plan owns its sizes and its bill choices. ' +
      '`plan_month` works one plan out for a month.',
  )
}

export const plansTool: PluginTool = {
  definition: {
    name: 'plans',
    title: 'Plans: bill choices and buckets',
    description:
      'The Plan screen as rows: each plan with what every bill does to it (out of net, part ' +
      'of the split, or ignored) and its buckets — what each is for (a goal, a debt, a category, a ' +
      'fund, an account or nothing) and how it is sized. Ids are here for `set_plan`, ' +
      '`set_fixed_expense_roles` and `edit_fixed_expenses`. The worked-out figures for a month are ' +
      '`plan_month`.',
    inputSchema: {
      type: 'object',
      properties: { path: PATH_PROP, plan_id: stringProp('One plan. Default: all of them.') },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) =>
      renderPlans(document, optionalString(args, 'plan_id')),
    ),
}

/** The months a plan is on, as `plans` says them (M31 U4). */
function monthsLine(plan: { readonly id: string; readonly isDefault: boolean }, given: ReadonlyMap<string, string>): string {
  const own = [...given].filter(([, id]) => id === plan.id).map(([month]) => month)
  if (plan.isDefault) {
    return own.length === 0
      ? 'Every month not given another plan is on it.'
      : `Every month not given another plan is on it, and ${own.join(', ')} were given it.`
  }
  return own.length === 0 ? 'No month is on it yet.' : `Months on it: ${own.join(', ')}.`
}

// --- plan_month ---------------------------------------------------------------

function picture(document: OpenDocument, month: PlanMonth): string {
  const currency = month.plan.currency
  const names = namesIn(document)
  const { result, parts, basis } = month
  const bucketOf = new Map(month.buckets.map((one) => [one.id, one]))
  const changes = new Set(month.applied.changes.map((one) => one.bucket.id))
  const homeless = new Set(
    listGoals(document.db)
      .filter((goal) => goal.defaultHoldingId === undefined)
      .map((goal) => goal.id),
  )

  return paragraphs(
    `**${month.plan.name}** for ${formatYearMonth(month.month)}${month.plan.isDefault ? ' (the default plan)' : ''}.`,
    table(
      ['Figure', 'Amount'],
      [
        ['Net pay', basis.unavailable ? 'no paycheck recorded yet' : showMoney(basis.amount)],
        [`Bills out of net (${count(parts.netOffList.length)})`, showMoney(parts.netOff)],
        ['To split', showMoney(result.splittable)],
        [`Bills that are part of the split (${count(parts.inSplitList.length)})`, showMoney(parts.inSplit)],
        ['Already out of net, from the paycheck (not counted)', String(parts.alreadyOutOfNet.length)],
        ['Not given a job', showMoney(money(Math.max(0, result.balance.minor), currency))],
        ...(result.balance.minor < 0
          ? [['Too much given out', showMoney(money(-result.balance.minor, currency))]]
          : []),
      ],
    ),
    table(
      ['Bucket', 'Id', 'For', 'This month', 'Share', 'Lately', 'Note'],
      result.allocations.map((entry) => {
        const reading = month.readings.get(entry.bucket.id)
        const bucket = bucketOf.get(entry.bucket.id) ?? entry.bucket
        return [
          entry.bucket.name,
          entry.bucket.id,
          pointsAt(bucket, names),
          showMoney(entry.amount),
          percent(entry.shareBasisPoints),
          reading?.trailing === undefined
            ? '—'
            : `${showMoney(reading.trailing.average)} a month (${plural(reading.trailing.months, 'month')})`,
          [
            reading?.reach?.kind === 'reached'
              ? 'goal reached'
              : reading?.reach?.kind === 'in'
                ? `goal reached ${formatYearMonth(reading.reach.period)} at this rate`
                : undefined,
            reading?.noTarget === true ? 'money with no job to do' : undefined,
            changes.has(entry.bucket.id) ? 'would change something' : undefined,
          ]
            .filter((part) => part !== undefined)
            .join('; ') || '—',
        ]
      }),
    ),
    month.applied.suggestions.length === 0
      ? 'Using this plan writes nothing: no bucket is for a goal or a debt (a category’s bucket is already in force).'
      : paragraphs(
          `Using this plan for ${formatYearMonth(month.month)} writes ${plural(month.applied.changes.length, 'thing')}` +
            alreadyClause(month.applied.suggestions),
          table(
            ['What', 'Amount', 'Now'],
            month.applied.suggestions.map((one) => [
              `${SUGGESTION_VERB[one.kind]} ${names[one.kind === 'SAVING_DEPOSIT' ? 'SAVING_GOAL' : 'DEBT'].get(one.targetId) ?? one.targetId}`,
              showMoney(one.amount),
              one.fedBy !== undefined
                ? (one.fedBy.kind === 'HOLDING'
                    ? `nothing: fed by the rows that bought ${one.fedBy.name}`
                    : `nothing: fed by ${one.fedBy.name}, so its deposits come from the bank`) +
                  (one.current === undefined ? '' : ` (${showMoney(one.current)} planned earlier is still on the goal)`)
                : one.kind === 'SAVING_DEPOSIT' && homeless.has(one.targetId)
                ? 'needs a holding first — the goal has none, and committing would stop here'
                : one.unchanged
                  ? 'already this'
                  : one.current === undefined
                    ? '—'
                    : showMoney(one.current),
            ]),
          ),
        ),
  )
}

/** ", and 2 more already match, and 1 goal real money already feeds takes nothing" — what Use for the month will not write. */
function alreadyClause(suggestions: readonly Suggestion[]): string {
  const fed = suggestions.filter((one) => one.fedBy !== undefined).length
  const matching = suggestions.filter((one) => one.fedBy === undefined && one.unchanged).length
  const parts = [
    ...(matching === 0 ? [] : [`${plural(matching, 'more', 'more')} already ${matching === 1 ? 'matches' : 'match'}`]),
    ...(fed === 0 ? [] : [`${plural(fed, 'goal')} real money already feeds ${fed === 1 ? 'takes' : 'take'} nothing`]),
  ]
  return parts.length === 0 ? ':' : `, and ${parts.join(', and ')}:`
}

const SUGGESTION_VERB: Readonly<Record<Suggestion['kind'], string>> = {
  SAVING_DEPOSIT: 'Plan a deposit into',
  DEBT_PAYMENT: 'Plan a payment on',
}

interface MonthPlan {
  readonly month: PlanMonth | undefined
  readonly only: ReadonlySet<string> | undefined
  /** Given, the call gives these months the plan, or takes them back, and records nothing. */
  readonly give: readonly YearMonth[] | undefined
  readonly back: readonly YearMonth[]
  /** What the dry run says: the picture, or why there is none. */
  readonly text: string
}

export const planMonthTool: PluginTool = {
  definition: {
    name: 'plan_month',
    title: 'Work a plan out for a month, and use it',
    description:
      'One plan worked out for one month: net pay, the bills out of net, what is left to ' +
      'split, each bucket’s amount and share, what it actually got lately, when a goal is reached at ' +
      'this rate, money with no job to do — and what *using* the plan for that month would write ' +
      '(a planned deposit into a goal, a planned payment on a debt). ' +
      '**Dry-runs by default**, which is also how you read it; `commit: true` writes those suggestions ' +
      'and gives the month this plan. `months` instead gives a list of months this plan and writes ' +
      'nothing else, and `back_to_default` puts months of this plan back on the default — the Plan ' +
      'screen’s month checkboxes. A month nobody gave a plan is on the default. ' +
      '`only_buckets` writes just those buckets’ suggestions. A fund or an account is pointed at ' +
      'and writes nothing. The document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        plan_id: stringProp('Ids come from `plans`. Default: the default plan.'),
        month: stringProp('The month as YYYY-MM. Default this month.'),
        only_buckets: { type: 'array', items: { type: 'string' }, description: 'Bucket ids from `plans`. Default: all.' },
        months: { type: 'array', items: { type: 'string' }, description: 'Months as YYYY-MM to give this plan. Records nothing.' },
        back_to_default: {
          type: 'array',
          items: { type: 'string' },
          description: 'Months as YYYY-MM of this plan to put back on the default plan.',
        },
        commit: booleanProp('Default false. False shows the month and writes nothing; true uses the plan.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const planId = optionalString(args, 'plan_id')
    const month: YearMonth = optionalPeriod(args, 'month') ?? { year: today().year, month: today().month }
    const only = Array.isArray(args['only_buckets'])
      ? new Set((args['only_buckets'] as unknown[]).map(String))
      : undefined
    const monthList = (name: string): readonly YearMonth[] | undefined => {
      const raw = args[name]
      if (raw === undefined) return undefined
      if (!Array.isArray(raw)) throw new ToolInputError(`\`${name}\` must be a list of months as YYYY-MM.`)
      return raw.map((one) => {
        const parsed = parseYearMonth(String(one))
        if (parsed === undefined) throw new ToolInputError(`\`${name}\` must be months as YYYY-MM; got "${String(one)}".`)
        return parsed
      })
    }
    const listed = monthList('months')
    const back = monthList('back_to_default') ?? []
    const give = listed === undefined && back.length === 0 ? undefined : (listed ?? [])

    return mutatingCall<MonthPlan>(path, args['commit'] === true, {
      plan: (document) => {
        const found = planMonth(document.db, { planId, month, asOf: today() })
        return {
          month: found,
          only,
          give,
          back,
          text:
            found === undefined
              ? 'There is no such plan, or the document has none. `plans` lists them.'
              : give !== undefined
                ? monthsChange(document, found, give, back)
                : picture(document, found),
        }
      },
      describe: (plan) => plan.text,
      apply: (document, plan) => {
        if (plan.month === undefined) return plan.text
        if (plan.give !== undefined) {
          setPlanMonths(document.db, plan.month.plan.id, plan.give, plan.back)
          return monthsLine(plan.month.plan, listPlanMonths(document.db))
        }
        const chosen = plan.month.applied.changes.filter((one) => plan.only === undefined || plan.only.has(one.bucket.id))
        applySuggestions(document.db, plan.month.plan.id, plan.month.month, chosen, Date.now())
        return paragraphs(
          `Used **${plan.month.plan.name}** for ${formatYearMonth(plan.month.month)}: ${plural(chosen.length, 'thing')} written.`,
          chosen.length === 0 ? 'Nothing needed recording; the month is on this plan.' : undefined,
        )
      },
      refuses: (plan) => plan.month === undefined,
    })
  },
}

/** What giving months a plan, or taking them back, would do — the dry run of `months`. */
function monthsChange(
  document: OpenDocument,
  month: PlanMonth,
  give: readonly YearMonth[],
  back: readonly YearMonth[],
): string {
  const given = listPlanMonths(document.db)
  const names = new Map(listSplitPlans(document.db).map((one) => [one.id, one.name]))
  const fallback = listSplitPlans(document.db)[0]?.name ?? 'the default'
  const onNow = (key: string): string => names.get(given.get(key) ?? '') ?? fallback
  return paragraphs(
    `**${month.plan.name}**${month.plan.isDefault ? ' (the default plan)' : ''}:`,
    table(
      ['Month', 'On now', 'After'],
      [
        ...give.map((one) => [toYearMonthString(one), onNow(toYearMonthString(one)), month.plan.name]),
        ...back.map((one) => {
          const key = toYearMonthString(one)
          return [key, onNow(key), given.get(key) === month.plan.id ? fallback : onNow(key)]
        }),
      ],
    ),
  )
}

// --- set_fixed_expense_roles -------------------------------------------------

interface RoleAsk {
  readonly planId: string | undefined
  readonly fixedExpenseId: string
  readonly role: FixedRole
}

interface RolePlanned {
  readonly entry: RoleEntry | undefined
  readonly label: string
  readonly change: string
  readonly problem: string | undefined
}

function readRoleAsks(args: Args): readonly RoleAsk[] {
  const raw = args['roles']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`roles` must be a non-empty array of {fixed_expense_id, role, plan_id?}.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} roles; the ceiling is ${BATCH_MAX} in one call.`)
  }
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`\`roles[${index}]\` must be an object.`)
    }
    const record = entry as Record<string, unknown>
    const role = String(record['role'] ?? '').toUpperCase()
    const word = (
      { OUT_OF_NET: 'NET', NET: 'NET', SPLIT: 'SPLIT', PART_OF_THE_SPLIT: 'SPLIT', IGNORE: 'IGNORE' } as Record<string, FixedRole>
    )[role]
    if (word === undefined || !(FIXED_ROLES as readonly string[]).includes(word)) {
      throw new ToolInputError(`\`roles[${index}].role\` must be net, split or ignore.`)
    }
    return {
      planId: typeof record['plan_id'] === 'string' && record['plan_id'] !== '' ? record['plan_id'] : undefined,
      fixedExpenseId: requireString(record, 'fixed_expense_id'),
      role: word,
    }
  })
}

export const setFixedExpenseRolesTool: PluginTool = {
  definition: {
    name: 'set_fixed_expense_roles',
    title: 'Say what each bill does to a plan',
    description:
      'For each bill, per plan: `net` (comes out of net pay before the split), `split` (is ' +
      'one share of the split, drawn on the bar) or `ignore` (this plan leaves it out). **A list in ' +
      'one call.** A bill the paycheck already took (a pension deduction) is outside the choice and ' +
      'refused. An expense with no choice made is ignored. This is the Plan screen’s switch ' +
      'on every row. **Dry-runs by default**: it shows each change and writes nothing until `commit: ' +
      'true`; the document is copied to a timestamped .bak first. Ids come from `plans`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        roles: {
          type: 'array',
          description: `One entry per bill and plan. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              fixed_expense_id: stringProp('From `plans` or `fixed_expenses`.'),
              role: { type: 'string', enum: ['net', 'split', 'ignore'], description: 'What it does to the plan.' },
              plan_id: stringProp('From `plans`. Default: the default plan.'),
            },
            required: ['fixed_expense_id', 'role'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'roles'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const asks = readRoleAsks(args)
    return mutatingCall<readonly RolePlanned[]>(path, args['commit'] === true, {
      plan: (document) => {
        const plans = listSplitPlans(document.db)
        const expenses = new Map(listFixedExpenses(document.db).map((one) => [one.id, one]))
        const roles = listAllRoles(document.db)
        return asks.map((ask): RolePlanned => {
          const plan = ask.planId === undefined ? plans.find((one) => one.isDefault) ?? plans[0] : plans.find((one) => one.id === ask.planId)
          const expense = expenses.get(ask.fixedExpenseId)
          if (plan === undefined) return { entry: undefined, label: ask.fixedExpenseId, change: '', problem: 'no such plan' }
          if (expense === undefined) {
            return { entry: undefined, label: ask.fixedExpenseId, change: '', problem: 'no bill has this id' }
          }
          const label = `${expense.name} in ${plan.name}`
          if (expense.matchKind === 'PAYCHECK_DEDUCTION') {
            return {
              entry: undefined,
              label,
              change: '',
              problem: 'it is taken from the paycheck, so it is already out of net and outside this choice',
            }
          }
          const was = roles.get(plan.id)?.get(expense.id)
          return {
            entry: was === ask.role ? undefined : { planId: plan.id, fixedExpenseId: expense.id, role: ask.role },
            label,
            change: was === ask.role ? 'already so' : `${was ?? 'no choice'} → ${ask.role}`,
            problem: undefined,
          }
        })
      },
      describe: (planned) =>
        paragraphs(
          `${plural(planned.filter((one) => one.entry !== undefined).length, 'role')} would change.`,
          table(
            ['Bill in plan', 'Change'],
            planned.map((one) => [one.label, one.problem === undefined ? one.change : `refused — ${one.problem}`]),
          ),
        ),
      apply: (document, planned) => {
        const entries = planned.flatMap((one) => (one.entry === undefined ? [] : [one.entry]))
        setRoles(document.db, entries)
        return paragraphs(
          `${plural(entries.length, 'role')} written.`,
          planned.some((one) => one.problem !== undefined)
            ? `Refused: ${planned.filter((one) => one.problem !== undefined).map((one) => `${one.label} — ${one.problem ?? ''}`).join('; ')}.`
            : undefined,
        )
      },
      refuses: (planned) => planned.every((one) => one.entry === undefined),
    })
  },
}

// --- set_plan -----------------------------------------------------------------

interface BucketAsk {
  readonly bucketId: string | undefined
  readonly name: string | undefined
  readonly pointsAt: { readonly kind: TargetKind; readonly id: string | undefined } | undefined
  readonly mode: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'REMAINDER'
  readonly percent: number | undefined
  readonly amount: number | undefined
  readonly locked: boolean
}

interface PlanAsk {
  readonly planId: string | undefined
  readonly create: boolean
  readonly copyOf: string | undefined
  readonly name: string | undefined
  readonly makeDefault: boolean
  readonly remove: boolean
  readonly basis:
    | {
        readonly kind: BasisKind
        readonly amount: number | undefined
        readonly months: number | undefined
        readonly paycheckId: string | undefined
      }
    | undefined
  readonly buckets: readonly BucketAsk[] | undefined
  /** Buckets to take out of the plan, each one's share going to the bucket on its right (D-322). */
  readonly removeBuckets: readonly string[]
}

function readPlanAsks(args: Args): readonly PlanAsk[] {
  const raw = args['plans']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`plans` must be a non-empty array of {plan_id | create, …}.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} plans; the ceiling is ${BATCH_MAX} in one call.`)
  }
  return raw.map((entry, index): PlanAsk => {
    const where = `plans[${index}]`
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`\`${where}\` must be an object.`)
    const record = entry as Record<string, unknown>
    const string = (key: string): string | undefined => {
      const value = record[key]
      if (value === undefined || value === null) return undefined
      if (typeof value !== 'string') throw new ToolInputError(`\`${where}.${key}\` must be a string.`)
      return value.trim() === '' ? undefined : value.trim()
    }
    const planId = string('plan_id')
    const create = record['create'] === true
    if ((planId === undefined) === !create) {
      throw new ToolInputError(`\`${where}\` names an existing plan with \`plan_id\`, or makes one with \`create: true\` — one of the two.`)
    }
    const remove = record['delete'] === true
    const rawRemoveBuckets = record['remove_buckets']
    if (rawRemoveBuckets !== undefined && (!Array.isArray(rawRemoveBuckets) || rawRemoveBuckets.some((one) => typeof one !== 'string'))) {
      throw new ToolInputError('remove_buckets must be an array of bucket ids.')
    }
    if (remove && Object.keys(record).some((key) => !['plan_id', 'delete'].includes(key))) {
      throw new ToolInputError(`\`${where}\` deletes, so it cannot also change anything. Send those as another entry first.`)
    }

    let basis: PlanAsk['basis']
    const rawBasis = record['basis']
    if (rawBasis !== undefined && rawBasis !== null) {
      if (typeof rawBasis !== 'object') throw new ToolInputError(`\`${where}.basis\` must be an object.`)
      const b = rawBasis as Record<string, unknown>
      const kind = String(b['kind'] ?? '').toUpperCase()
      if (!(BASIS_KINDS as readonly string[]).includes(kind)) {
        throw new ToolInputError(`\`${where}.basis.kind\` must be one of ${BASIS_KINDS.join(', ')}.`)
      }
      basis = {
        kind: kind as BasisKind,
        amount: b['amount'] === undefined ? undefined : Number(b['amount']),
        months: b['months'] === undefined ? undefined : Number(b['months']),
        paycheckId: typeof b['paycheck_id'] === 'string' ? b['paycheck_id'] : undefined,
      }
      if (basis.amount !== undefined && (!Number.isFinite(basis.amount) || basis.amount < 0)) {
        throw new ToolInputError(`\`${where}.basis.amount\` must be a number of at least 0.`)
      }
    }

    let buckets: BucketAsk[] | undefined
    const rawBuckets = record['buckets']
    if (rawBuckets !== undefined && rawBuckets !== null) {
      if (!Array.isArray(rawBuckets)) throw new ToolInputError(`\`${where}.buckets\` must be an array.`)
      buckets = rawBuckets.map((one, at): BucketAsk => {
        const here = `${where}.buckets[${at}]`
        if (typeof one !== 'object' || one === null) throw new ToolInputError(`\`${here}\` must be an object.`)
        const b = one as Record<string, unknown>
        const mode = String(b['mode'] ?? '').toLowerCase()
        const resolved = (
          { percent: 'PERCENTAGE', amount: 'FIXED_AMOUNT', rest: 'REMAINDER' } as Record<string, BucketAsk['mode']>
        )[mode]
        if (resolved === undefined) throw new ToolInputError(`\`${here}.mode\` must be percent, amount or rest.`)
        let target: BucketAsk['pointsAt']
        const rawTarget = b['points_at']
        if (rawTarget !== undefined && rawTarget !== null) {
          const t = rawTarget as Record<string, unknown>
          const kind = KIND_ARG[String(t['kind'] ?? '').toLowerCase()]
          if (kind === undefined) {
            throw new ToolInputError(`\`${here}.points_at.kind\` must be goal, debt, category, fund, account or none.`)
          }
          target = { kind, id: typeof t['id'] === 'string' ? t['id'] : undefined }
        }
        const percentValue = b['percent'] === undefined ? undefined : Number(b['percent'])
        const amountValue = b['amount'] === undefined ? undefined : Number(b['amount'])
        if (percentValue !== undefined && (!Number.isFinite(percentValue) || percentValue < 0 || percentValue > 100)) {
          throw new ToolInputError(`\`${here}.percent\` must be between 0 and 100.`)
        }
        if (amountValue !== undefined && (!Number.isFinite(amountValue) || amountValue < 0)) {
          throw new ToolInputError(`\`${here}.amount\` must be a number of at least 0.`)
        }
        if (resolved === 'PERCENTAGE' && percentValue === undefined) {
          throw new ToolInputError(`\`${here}\` is sized by percent, so it needs \`percent\`.`)
        }
        if (resolved === 'FIXED_AMOUNT' && amountValue === undefined) {
          throw new ToolInputError(`\`${here}\` is sized by amount, so it needs \`amount\`.`)
        }
        return {
          bucketId: typeof b['bucket_id'] === 'string' && b['bucket_id'] !== '' ? b['bucket_id'] : undefined,
          name: typeof b['name'] === 'string' && b['name'].trim() !== '' ? b['name'].trim() : undefined,
          pointsAt: target,
          mode: resolved,
          percent: percentValue,
          amount: amountValue,
          locked: b['locked'] === true,
        }
      })
      if (buckets.filter((one) => one.mode === 'REMAINDER').length > 1) {
        throw new ToolInputError(`\`${where}.buckets\` has two buckets sized "rest"; a plan has one.`)
      }
    }

    return {
      planId,
      create,
      copyOf: string('copy_of'),
      name: string('name'),
      makeDefault: record['make_default'] === true,
      remove,
      basis,
      buckets,
      removeBuckets: (rawRemoveBuckets as string[] | undefined) ?? [],
    }
  })
}

interface PlanChange {
  readonly ask: PlanAsk
  readonly label: string
  readonly lines: readonly string[]
  readonly problem: string | undefined
}

function planSetPlan(document: OpenDocument, asks: readonly PlanAsk[]): readonly PlanChange[] {
  const db = document.db
  const plans = listSplitPlans(db)
  const buckets = new Map(listSplitBuckets(db).map((one) => [one.id, one]))
  const names = namesIn(document)
  const paychecks = new Set(listPaychecks(db).map((one) => one.id))
  const taken = new Set(plans.map((one) => one.name))

  return asks.map((asked): PlanChange => {
    const ask = withTargetIds(asked, names)
    const existing = ask.planId === undefined ? undefined : plans.find((one) => one.id === ask.planId)
    const label = ask.create ? (ask.name ?? 'a new plan') : (existing?.name ?? ask.planId ?? '')
    const refuse = (problem: string): PlanChange => ({ ask, label, lines: [], problem })

    if (!ask.create && existing === undefined) return refuse('no plan has this id')
    if (ask.remove) {
      return {
        ask,
        label,
        lines: [
          'delete the plan (its buckets and your bills stay)' +
            (existing?.isDefault === true
              ? plans.length > 1
                ? '; another plan becomes the default'
                : '; it is the only plan, so there will be none until you make one'
              : ''),
        ],
        problem: undefined,
      }
    }
    if (ask.create && ask.name === undefined) return refuse('a new plan needs a `name`')
    if (ask.copyOf !== undefined && !plans.some((one) => one.id === ask.copyOf)) return refuse('`copy_of` is not a plan')

    const lines: string[] = []
    if (ask.create) {
      if (taken.has(ask.name ?? '')) return refuse(`there is already a plan called ${ask.name ?? ''}`)
      lines.push(ask.copyOf === undefined ? 'create it' : 'create it as a copy, with its choices for the bills')
    } else if (ask.name !== undefined && ask.name !== existing?.name) {
      if (taken.has(ask.name)) return refuse(`there is already a plan called ${ask.name}`)
      lines.push(`rename to ${ask.name}`)
    }
    if (ask.basis !== undefined) {
      if (ask.basis.kind === 'CUSTOM_AMOUNT' && ask.basis.amount === undefined) {
        return refuse('an amount typed needs `basis.amount`')
      }
      if (ask.basis.kind === 'SPECIFIC_PAYCHECK' && ask.basis.paycheckId !== undefined && !paychecks.has(ask.basis.paycheckId)) {
        return refuse('`basis.paycheck_id` is not a paycheck in this document')
      }
      lines.push(
        `net pay is ${ask.basis.kind.toLowerCase().replaceAll('_', ' ')}` +
          (ask.basis.amount === undefined ? '' : ` ${String(ask.basis.amount)}`) +
          (ask.basis.months === undefined ? '' : ` over ${String(ask.basis.months)} months`),
      )
    }
    if (ask.buckets !== undefined) {
      for (const [at, one] of ask.buckets.entries()) {
        if (one.bucketId !== undefined && !buckets.has(one.bucketId)) return refuse(`buckets[${at}]: no bucket has this id`)
        if (one.bucketId === undefined && one.name === undefined) return refuse(`buckets[${at}]: give \`bucket_id\` or, for a new bucket, \`name\``)
        if (one.pointsAt !== undefined && one.pointsAt.kind !== 'FREE') {
          const id = one.pointsAt.id
          if (id === undefined || !names[one.pointsAt.kind].has(id)) {
            return refuse(`buckets[${at}]: no ${KIND_WORD[one.pointsAt.kind]} has the id or the name ${id ?? '(none given)'}`)
          }
        }
      }
      const ids = ask.buckets.flatMap((one) => (one.bucketId === undefined ? [] : [one.bucketId]))
      if (new Set(ids).size !== ids.length) return refuse('a bucket appears twice in `buckets`')
      lines.push(
        `buckets become: ${ask.buckets
          .map((one) => {
            const name = one.bucketId === undefined ? `new ${one.name ?? ''}` : (buckets.get(one.bucketId)?.name ?? one.bucketId)
            const size =
              one.mode === 'PERCENTAGE' ? `${String(one.percent)}%` : one.mode === 'FIXED_AMOUNT' ? String(one.amount) : 'rest'
            const to =
              one.pointsAt === undefined
                ? ''
                : one.pointsAt.kind === 'FREE'
                  ? ' → nothing'
                  : ` → ${KIND_WORD[one.pointsAt.kind]} ${names[one.pointsAt.kind].get(one.pointsAt.id ?? '') ?? ''}`
            return `${name} ${size}${to}${one.locked ? ' (kept)' : ''}`
          })
          .join('; ')}`,
      )
    }
    if (ask.removeBuckets.length > 0) {
      if (ask.create || existing === undefined) return refuse('`remove_buckets` takes buckets out of an existing plan')
      const inPlan = new Set(findSplitPlan(db, existing.id)?.allocations.map((one) => one.bucketId))
      for (const id of ask.removeBuckets) {
        if (!inPlan.has(id)) return refuse(`remove_buckets: ${id} is not a bucket of this plan`)
      }
      lines.push(
        `remove ${ask.removeBuckets.map((id) => buckets.get(id)?.name ?? id).join(', ')} — each share goes to the bucket on its right, or to the money not given a job if it was last`,
      )
    }
    if (ask.makeDefault && existing?.isDefault !== true) lines.push('make it the default')
    return { ask, label, lines, problem: undefined }
  })
}

export const setPlanTool: PluginTool = {
  definition: {
    name: 'set_plan',
    title: 'Create, change or delete plans',
    description:
      'What the Plan screen does to a plan — **a list of entries in one call**. Per entry: ' +
      '`plan_id` for an existing plan, or `create: true` with `name` (and `copy_of`, a plan id, to ' +
      'start from its sizes and its choices for the bills); then any of `name`, ' +
      '`make_default`, `basis` ({kind: LAST_PAYCHECK | AVERAGE_LAST_N | SPECIFIC_PAYCHECK | ' +
      'CUSTOM_AMOUNT, amount, months, paycheck_id}) — a bonus month is a plan whose basis is an ' +
      'amount — and `buckets`, **the plan’s whole list of buckets** as the screen’s bar has it: each ' +
      '{bucket_id (existing) or name (new), points_at: {kind: goal | debt | category | fund | ' +
      'account | none, id}, mode: percent | amount | rest, percent (0-100), amount (major units), ' +
      'locked}. A bucket is for one thing, and a bucket sized “rest” takes what is left after ' +
      'the others and the bills that are part of the split; at most one. Or, alone, ' +
      '`delete: true` (the default plan too; another becomes the default), or `remove_buckets` to take buckets out and hand each share to its right. What each bill does to a plan is `set_fixed_expense_roles`. ' +
      '**Dry-runs by default**; `commit: true` writes. The document is copied to a timestamped ' +
      '.bak first. Ids come from `plans`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        plans: {
          type: 'array',
          description: `One entry per plan. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              plan_id: stringProp('An existing plan, from `plans`.'),
              create: booleanProp('Make a new plan instead. Needs `name`.'),
              copy_of: stringProp('With `create`: a plan id to copy the sizes and choices from.'),
              name: stringProp('A name. Another plan’s name is refused.'),
              make_default: booleanProp('Make this the plan the screen opens on.'),
              delete: booleanProp('Delete the plan. Alone in the entry. Deleting the default makes the next plan the default.'),
              remove_buckets: {
                type: 'array',
                items: { type: 'string' },
                description: 'Bucket ids to take out of this plan. Each one’s share goes to the bucket on its right (in that bucket’s own unit), or to the money not given a job if it was last. A bucket no other plan uses is deleted. Applied before any `buckets` list in the same entry.',
              },
              basis: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: [...BASIS_KINDS] },
                  amount: numberProp('For CUSTOM_AMOUNT, major units.'),
                  months: numberProp('For AVERAGE_LAST_N.'),
                  paycheck_id: stringProp('For SPECIFIC_PAYCHECK.'),
                },
                required: ['kind'],
                additionalProperties: false,
              },
              buckets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    bucket_id: stringProp('An existing bucket.'),
                    name: stringProp('A new bucket’s name, or a new name for an existing one.'),
                    points_at: {
                      type: 'object',
                      properties: {
                        kind: { type: 'string', enum: ['goal', 'debt', 'category', 'fund', 'account', 'none'] },
                        id: stringProp('The goal, debt, category, fund or account, by id or by name.'),
                      },
                      required: ['kind'],
                      additionalProperties: false,
                    },
                    mode: { type: 'string', enum: ['percent', 'amount', 'rest'] },
                    percent: numberProp('0-100, for mode percent.'),
                    amount: numberProp('Major units a month, for mode amount.'),
                    locked: booleanProp('A divider will not move it.'),
                  },
                  required: ['mode'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'plans'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const asks = readPlanAsks(args)
    return mutatingCall<readonly PlanChange[]>(path, args['commit'] === true, {
      plan: (document) => planSetPlan(document, asks),
      describe: (changes) => {
        const doing = changes.filter((one) => one.problem === undefined)
        const refused = changes.filter((one) => one.problem !== undefined)
        return paragraphs(
          `${count(doing.length)} of ${plural(changes.length, 'entry', 'entries')} would change a plan.`,
          doing.length === 0 ? undefined : table(['Plan', 'Change'], doing.map((one) => [one.label, one.lines.join('; ')])),
          refused.length === 0 ? undefined : `Refused: ${refused.map((one) => `${one.label} — ${one.problem ?? ''}`).join('; ')}.`,
        )
      },
      apply: (document, changes) => {
        const db = document.db
        const now = Date.now()
        const done: string[] = []
        const failed: string[] = []
        for (const change of changes) {
          if (change.problem !== undefined) continue
          const ask = change.ask
          try {
            if (ask.remove) {
              deleteSplitPlan(db, ask.planId ?? '', now)
              done.push(`${change.label} deleted`)
              continue
            }
            const currency: CurrencyCode = documentCurrency(db)
            if (ask.removeBuckets.length > 0 && ask.planId !== undefined) {
              const now0 = today()
              removePlanBuckets(db, ask.planId, ask.removeBuckets, { year: now0.year, month: now0.month }, now0, now)
            }
            let planId = ask.planId
            if (ask.create) {
              planId =
                ask.copyOf === undefined
                  ? createSplitPlan(db, { name: ask.name ?? '', currency, isDefault: listSplitPlans(db).length === 0 }, now).id
                  : (duplicateSplitPlan(db, ask.copyOf, ask.name ?? '', now)?.id ?? '')
            }
            const plan = findSplitPlan(db, planId ?? '')
            if (plan === undefined) throw new Error('the plan did not survive')

            const edit: Parameters<typeof updateSplitPlan>[2] = {
              ...(ask.name !== undefined && !ask.create ? { name: ask.name } : {}),
              ...(ask.basis === undefined
                ? {}
                : {
                    basisKind: ask.basis.kind,
                    ...(ask.basis.amount === undefined ? {} : { customAmount: fromMajorUnits(ask.basis.amount, plan.plan.currency) }),
                    ...(ask.basis.months === undefined ? {} : { basisMonths: Math.max(1, Math.trunc(ask.basis.months)) }),
                    ...(ask.basis.paycheckId === undefined ? {} : { basisPaycheckId: ask.basis.paycheckId }),
                  }),
            }

            let allocations: NewAllocation[] | undefined
            if (ask.buckets !== undefined) {
              allocations = []
              for (const one of ask.buckets) {
                let bucketId = one.bucketId
                if (bucketId === undefined) {
                  bucketId = createSplitBucket(db, { name: one.name ?? '' }, now).id
                }
                if (one.pointsAt !== undefined || (one.bucketId !== undefined && one.name !== undefined)) {
                  updateSplitBucket(
                    db,
                    bucketId,
                    {
                      ...(one.name === undefined ? {} : { name: one.name }),
                      ...(one.pointsAt === undefined
                        ? {}
                        : { targetKind: one.pointsAt.kind, targetId: one.pointsAt.kind === 'FREE' ? undefined : one.pointsAt.id }),
                    },
                    now,
                  )
                }
                allocations.push({
                  bucketId,
                  mode: one.mode,
                  isLocked: one.locked,
                  ...(one.mode === 'PERCENTAGE' ? { basisPoints: Math.round((one.percent ?? 0) * 100) } : {}),
                  ...(one.mode === 'FIXED_AMOUNT' ? { amount: fromMajorUnits(one.amount ?? 0, plan.plan.currency) } : {}),
                })
              }
            }
            updateSplitPlan(
              db,
              plan.plan.id,
              {
                ...edit,
                ...(allocations === undefined ? {} : { allocations }),
              },
              now,
            )
            if (ask.makeDefault) setDefaultPlan(db, plan.plan.id, now)
            done.push(`${change.label}: ${change.lines.join('; ')}`)
          } catch (error) {
            failed.push(`${change.label} — ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        return paragraphs(
          `${plural(done.length, 'plan')} changed.`,
          done.length === 0 ? undefined : done.map((line) => `- ${line}`).join('\n'),
          failed.length === 0 ? undefined : `Not changed: ${failed.join('; ')}.`,
          changes.some((one) => one.problem !== undefined)
            ? `Refused before writing: ${changes.filter((one) => one.problem !== undefined).map((one) => `${one.label} — ${one.problem ?? ''}`).join('; ')}.`
            : undefined,
        )
      },
      refuses: (changes) => changes.every((one) => one.problem !== undefined),
    })
  },
}

// --- edit_fixed_expenses -----------------------------------------------------

interface ExpenseAsk {
  readonly id: string
  readonly name: string | undefined
  readonly amount: number | undefined
  readonly cadence: Cadence | undefined
  readonly categoryId: string | null | undefined
  readonly discretionary: boolean | undefined
  readonly dayOfMonth: number | null | undefined
  readonly endedOn: 'today' | string | undefined
  readonly stop: boolean
}

interface ExpenseChange {
  readonly ask: ExpenseAsk
  readonly label: string
  readonly lines: readonly string[]
  readonly next: FixedExpense | undefined
  readonly problem: string | undefined
}

function readExpenseAsks(args: Args): readonly ExpenseAsk[] {
  const raw = args['edits']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`edits` must be a non-empty array of {fixed_expense_id, …}.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} edits; the ceiling is ${BATCH_MAX} in one call.`)
  }
  return raw.map((entry, index): ExpenseAsk => {
    const where = `edits[${index}]`
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`\`${where}\` must be an object.`)
    const record = entry as Record<string, unknown>
    const cadence = record['cadence'] === undefined ? undefined : String(record['cadence']).toUpperCase()
    if (cadence !== undefined && !(CADENCES as readonly string[]).includes(cadence)) {
      throw new ToolInputError(`\`${where}.cadence\` must be one of ${CADENCES.join(', ')}.`)
    }
    const amount = optionalNumber(record, 'expected_amount')
    if (amount !== undefined && amount < 0) throw new ToolInputError(`\`${where}.expected_amount\` must be positive.`)
    const category = record['category_id']
    if (category !== undefined && category !== null && typeof category !== 'string') {
      throw new ToolInputError(`\`${where}.category_id\` must be a category id, or null to clear it.`)
    }
    const day = record['day_of_month']
    if (day !== undefined && day !== null && (typeof day !== 'number' || day < 1 || day > 31)) {
      throw new ToolInputError(`\`${where}.day_of_month\` must be 1 to 31, or null to clear it.`)
    }
    const ended = optionalString(record, 'ended_on')
    if (ended !== undefined && ended !== 'today' && parseISODate(ended) === undefined) {
      throw new ToolInputError(`\`${where}.ended_on\` must be a date as YYYY-MM-DD, or "today".`)
    }
    const stop = record['stop_tracking'] === true
    const others = ['name', 'expected_amount', 'cadence', 'category_id', 'is_discretionary', 'day_of_month', 'ended_on'].filter(
      (key) => record[key] !== undefined,
    )
    if (stop && others.length > 0) {
      throw new ToolInputError(`\`${where}\` stops tracking, so it cannot also change ${others.join(', ')}. Send those first.`)
    }
    return {
      id: requireString(record, 'fixed_expense_id'),
      name: optionalString(record, 'name'),
      amount,
      cadence: cadence as Cadence | undefined,
      categoryId: category as string | null | undefined,
      discretionary: optionalBoolean(record, 'is_discretionary'),
      dayOfMonth: day as number | null | undefined,
      endedOn: ended,
      stop,
    }
  })
}

export const editFixedExpensesTool: PluginTool = {
  definition: {
    name: 'edit_fixed_expenses',
    title: 'Edit, end or stop tracking bills',
    description:
      'Change bills that exist — **a list in one call**. Per entry: `name`, ' +
      '`expected_amount` (the whole charge, major units — a yearly premium is the year’s figure), ' +
      '`cadence`, `category_id` (null clears), `is_discretionary`, `day_of_month` (null clears), ' +
      '`ended_on` (YYYY-MM-DD or "today": it keeps its history and drops out of every plan); or, ' +
      'alone, `stop_tracking: true`, which removes it and what every plan said about it — its ' +
      'charges stay on Transactions. How it is recognised in the ledger is not changed here. ' +
      'Adding is `track_fixed_expenses`; what it does to a plan is `set_fixed_expense_roles`. ' +
      '**Dry-runs by default**; `commit: true` writes. The document is copied to a timestamped ' +
      '.bak first. Ids come from `plans` or `fixed_expenses`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        edits: {
          type: 'array',
          description: `One entry per bill. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              fixed_expense_id: stringProp('From `plans` or `fixed_expenses`.'),
              name: stringProp('A new name.'),
              expected_amount: numberProp('The whole recurring charge, major units.'),
              cadence: stringProp(`One of ${CADENCES.join(', ')}.`),
              category_id: { type: ['string', 'null'], description: 'A category id, or null to clear.' },
              is_discretionary: booleanProp('True for a bill that could be cut.'),
              day_of_month: { type: ['number', 'null'], description: '1 to 31, or null to clear.' },
              ended_on: stringProp('YYYY-MM-DD or "today": the day it stopped.'),
              stop_tracking: booleanProp('Remove it. Alone in the entry.'),
            },
            required: ['fixed_expense_id'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'edits'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const asks = readExpenseAsks(args)
    return mutatingCall<readonly ExpenseChange[]>(path, args['commit'] === true, {
      plan: (document) => {
        const db = document.db
        const categories = new Set(listCategories(db, { includeArchived: true }).map((one) => one.id))
        return asks.map((ask): ExpenseChange => {
          const found = findFixedExpense(db, ask.id)
          if (found === undefined) {
            return { ask, label: ask.id, lines: [], next: undefined, problem: 'no bill has this id' }
          }
          const label = found.name
          if (ask.stop) {
            return { ask, label, lines: ['stop tracking it, and drop what every plan said about it'], next: undefined, problem: undefined }
          }
          if (typeof ask.categoryId === 'string' && !categories.has(ask.categoryId)) {
            return { ask, label, lines: [], next: undefined, problem: 'the category does not exist' }
          }
          const lines: string[] = []
          const currency = found.expectedAmount.currency
          let next: FixedExpense = found
          if (ask.name !== undefined && ask.name !== found.name) {
            next = { ...next, name: ask.name }
            lines.push(`rename to ${ask.name}`)
          }
          if (ask.amount !== undefined) {
            next = { ...next, expectedAmount: fromMajorUnits(ask.amount, currency) }
            lines.push(`charge ${showMoney(next.expectedAmount)}`)
          }
          if (ask.cadence !== undefined && ask.cadence !== found.cadence) {
            next = { ...next, cadence: ask.cadence }
            lines.push(`cadence ${ask.cadence}`)
          }
          if (ask.categoryId !== undefined) {
            next = { ...next, categoryId: ask.categoryId ?? undefined }
            lines.push(ask.categoryId === null ? 'clear the category' : 'change the category')
          }
          if (ask.discretionary !== undefined && ask.discretionary !== found.isDiscretionary) {
            next = { ...next, isDiscretionary: ask.discretionary }
            lines.push(ask.discretionary ? 'mark it as could be cut' : 'mark it as necessary')
          }
          if (ask.dayOfMonth !== undefined) {
            next = { ...next, dayOfMonthHint: ask.dayOfMonth ?? undefined }
            lines.push(ask.dayOfMonth === null ? 'clear the day' : `usually the ${String(ask.dayOfMonth)}`)
          }
          if (ask.endedOn !== undefined) {
            const day = ask.endedOn === 'today' ? today() : parseISODate(ask.endedOn)
            if (day !== undefined) {
              next = { ...next, endedAt: day, isActive: false }
              lines.push(`ended ${date(day)}`)
            }
          }
          const problems = validateFixedExpense(next)
          if (problems.length > 0) {
            return {
              ask,
              label,
              lines,
              next,
              problem:
                problems.includes('ANCHOR_REQUIRED')
                  ? 'a yearly, quarterly or every-two-months bill needs a start date to count its months from — set it in the app'
                  : problems.join(', ').toLowerCase().replaceAll('_', ' '),
            }
          }
          return { ask, label, lines, next, problem: undefined }
        })
      },
      describe: (changes) => {
        const doing = changes.filter((one) => one.problem === undefined && one.lines.length > 0)
        const refused = changes.filter((one) => one.problem !== undefined)
        return paragraphs(
          `${count(doing.length)} of ${plural(changes.length, 'edit')} would change a bill.`,
          doing.length === 0 ? undefined : table(['Bill', 'Id', 'Change'], doing.map((one) => [one.label, one.ask.id, one.lines.join('; ')])),
          refused.length === 0 ? undefined : `Refused: ${refused.map((one) => `${one.label} — ${one.problem ?? ''}`).join('; ')}.`,
        )
      },
      apply: (document, changes) => {
        const db = document.db
        const now = Date.now()
        let done = 0
        const failed: string[] = []
        for (const change of changes) {
          if (change.problem !== undefined || change.lines.length === 0) continue
          try {
            if (change.ask.stop) deleteFixedExpense(db, change.ask.id, now)
            else if (change.next !== undefined) updateFixedExpense(db, change.ask.id, change.next, now)
            done += 1
          } catch (error) {
            failed.push(`${change.label} — ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        return paragraphs(
          `${plural(done, 'bill')} changed.`,
          failed.length === 0 ? undefined : `Not changed: ${failed.join('; ')}.`,
          changes.some((one) => one.problem !== undefined)
            ? `Refused before writing: ${changes.filter((one) => one.problem !== undefined).map((one) => `${one.label} — ${one.problem ?? ''}`).join('; ')}.`
            : undefined,
        )
      },
      refuses: (changes) => changes.every((one) => one.problem !== undefined || one.lines.length === 0),
    })
  },
}
