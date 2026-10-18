/**
 * `set_goal_deposit_categories` and `set_cushion` — the two writes the Goals
 * drawer and Overview make (M28 U8, D-324), each with its dry run.
 *
 * **A goal finds its deposits through one feed** (D-324, D-357): a Money moved
 * category, where filing a transaction under it is the deposit, or the rows that
 * name its default holding — so this is the whole of "connect a goal to its money". **The cushion is what is left in
 * the bank** once the goals saved there take their parts (D-360): `set_cushion` unticks or ticks the accounts,
 * sets the months and counts the Plan buckets, and answers with the split.
 * Neither is a general write: each names one thing and refuses what the app's
 * own form refuses.
 *
 * **A goal's default holding is set here too** (M28 F23): reading the bank needs
 * one, and the Goals editor's "Where its deposits usually go" had no conversation
 * half, so a goal created without one could never be pointed at its deposits.
 */

import { formatMoney, money } from '@/core/money.ts'
import {
  cushionReading,
  setCushionAccounts,
  setCushionBuckets,
  setCushionMonths,
  type CushionReading,
} from '@/data/repositories/cushionRepository.ts'
import {
  depositCategoryProblem,
  goalDepositCategories,
  goalHoldingFeeds,
  goalTransferFeeds,
  holdingFeedProblem,
  setGoalFeed,
  transferFeedProblem,
  type GoalFeedChoice,
} from '@/data/repositories/goalDepositRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { findAccountById } from '@/data/repositories/accountRepository.ts'
import { listSplitBuckets } from '@/data/repositories/splitPlanRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import {
  listGoals,
  listHoldingPlaces,
  listHoldings,
  updateGoal,
} from '@/data/repositories/savingsRepository.ts'
import { isCushionMonths, MAX_CUSHION_MONTHS } from '@/domain/goalDeposits.ts'
import { type Holding, type HoldingPlace } from '@/domain/model/savings.ts'

import { type OpenDocument } from '../document.ts'
import { paragraphs, plural, table } from '../format.ts'
import { today } from '../today.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 60

// --- set_goal_deposit_categories --------------------------------------------

interface Requested {
  readonly goal: string
  /** A category id or path; `null` stops any feed; absent leaves it alone. */
  readonly category: string | null | undefined
  /** True: fed by the rows that name its default holding (M30 U4). */
  readonly fromHolding: boolean
  /** True: fed by the confirmed transfers into the account whose own Cash it is (M30 F4). */
  readonly fromTransfers: boolean
  /** A holding id, name or "Place · name"; `null` clears it; absent leaves it alone. */
  readonly holding: string | null | undefined
}

/** A goal's default holding as this call would leave it. */
type HoldingChange =
  | { readonly kind: 'LEAVE' }
  | { readonly kind: 'SET'; readonly id: string | undefined; readonly label: string }

interface Entry {
  readonly requested: Requested
  readonly goalId: string | undefined
  readonly goalName: string
  /** What feeds the goal after this call; undefined is nothing. */
  readonly feed: GoalFeedChoice
  /** The feed in words: a category's path, or the rows of a holding. */
  readonly feedName: string
  readonly holding: HoldingChange
  readonly note: string | undefined
}

function readRequests(args: Args): readonly Requested[] {
  const raw = args['goals']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`goals` must be a non-empty array, one entry per goal.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} goals; the ceiling is ${BATCH_MAX}.`)
  }
  return raw.map((entry, index) => {
    const where = `\`goals[${index}]\``
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`${where} must be an object.`)
    const record = entry as Record<string, unknown>
    const goal = optionalString(record, 'goal')
    if (goal === undefined) throw new ToolInputError(`${where} needs a \`goal\`: an id or a name from \`savings\`.`)
    const category = record['category'] === null ? null : optionalString(record, 'category')
    const holding = record['default_holding'] === null ? null : optionalString(record, 'default_holding')
    const fromHolding = record['from_holding'] === true
    const fromTransfers = record['from_transfers'] === true
    if ([category !== undefined, fromHolding, fromTransfers].filter(Boolean).length > 1) {
      throw new ToolInputError(
        `${where} names more than one of \`category\`, \`from_holding\` and \`from_transfers\`. A goal is fed by ` +
          'one of them, never two, so nothing counts twice.',
      )
    }
    if (category === undefined && holding === undefined && !fromHolding && !fromTransfers) {
      throw new ToolInputError(
        `${where} needs a \`category\` (an id or path from \`category_tree\`, or null to stop reading one), ` +
          '`from_holding: true`, `from_transfers: true`, a `default_holding`, or a feed and a holding together.',
      )
    }
    return { goal, category, fromHolding, fromTransfers, holding }
  })
}

/**
 * The holding a goal's deposits usually go to, named the way the Goals editor's
 * picker shows it. An existing, unarchived holding only: the editor offers no
 * other, and `create_goals` or `record_deposits` is where one is made.
 */
function resolveDefaultHolding(
  text: string,
  holdings: readonly Holding[],
  places: readonly HoldingPlace[],
): { readonly id: string; readonly label: string } | string {
  const wanted = text.trim().toLowerCase()
  const byId = holdings.find((one) => one.id === text)
  const found =
    byId !== undefined
      ? [byId]
      : holdings.filter(
          (one) => holdingLabel(one, places).toLowerCase() === wanted || one.name.trim().toLowerCase() === wanted,
        )
  const [only, second] = found
  if (only === undefined) return `no holding called "${text}". \`savings\` lists them`
  if (second !== undefined) {
    return `${String(found.length)} holdings are called "${text}"; name one as "place · holding" or by id`
  }
  return { id: only.id, label: holdingLabel(only, places) }
}

function holdingLabel(holding: Holding, places: readonly HoldingPlace[]): string {
  const place = places.find((one) => one.id === holding.holdingPlaceId)
  return place === undefined ? holding.name : `${place.name} · ${holding.name}`
}

function plan(document: OpenDocument, batch: readonly Requested[]): readonly Entry[] {
  const goals = listGoals(document.db, { includeClosed: true })
  const categories = listCategories(document.db, { includeArchived: true })
  const holdings = listHoldings(document.db).filter((one) => !one.isArchived)
  const allHoldings = listHoldings(document.db)
  const places = listHoldingPlaces(document.db, { includeArchived: true })
  const nameOf = (categoryId: string | undefined): string =>
    categories.find((one) => one.id === categoryId)?.path ?? 'none'
  const rowsOf = (holdingId: string | undefined): string => {
    const holding = allHoldings.find((one) => one.id === holdingId)
    return `the rows that name ${holding === undefined ? 'its holding' : holdingLabel(holding, places)}`
  }
  // What the batch itself would leave pointing where, so two goals in one call
  // cannot both claim a category, or both a holding's rows.
  const claimed = new Map(goalDepositCategories(document.db))
  const claimedHoldings = new Map(goalHoldingFeeds(document.db))
  const claimedAccounts = new Map(goalTransferFeeds(document.db))
  const accountOf = (holdingId: string | undefined): string | undefined =>
    allHoldings.find((one) => one.id === holdingId)?.accountId
  const accountName = (holdingId: string | undefined): string => {
    const accountId = accountOf(holdingId)
    return accountId === undefined ? 'its account' : (findAccountById(document.db, accountId)?.name ?? 'its account')
  }

  return batch.map((requested): Entry => {
    const goal = goals.find(
      (one) =>
        one.id === requested.goal || one.name.trim().toLowerCase() === requested.goal.trim().toLowerCase(),
    )
    const refuse = (why: string): Entry => ({
      requested,
      goalId: goal?.id,
      goalName: goal?.name ?? requested.goal,
      feed: undefined,
      feedName: requested.fromHolding
        ? 'its holding’s rows'
        : requested.fromTransfers
          ? 'the transfers into its account'
          : requested.category === undefined
          ? '—'
          : (requested.category ?? 'none'),
      holding: { kind: 'LEAVE' },
      note: why,
    })
    if (goal === undefined) return refuse(`no goal called "${requested.goal}". \`savings\` lists them`)

    let holding: HoldingChange = { kind: 'LEAVE' }
    if (requested.holding === null) {
      holding = { kind: 'SET', id: undefined, label: 'ask each time' }
    } else if (requested.holding !== undefined) {
      const found = resolveDefaultHolding(requested.holding, holdings, places)
      if (typeof found === 'string') return refuse(found)
      holding = { kind: 'SET', ...found }
    }
    // The goal as this entry would leave it, which is what a feed is judged against.
    const judged = holding.kind === 'SET' ? { ...goal, defaultHoldingId: holding.id } : goal
    const kept = (feed: GoalFeedChoice, feedName: string): Entry => ({
      requested,
      goalId: goal.id,
      goalName: goal.name,
      feed,
      feedName,
      holding,
      note: undefined,
    })
    const byHolding = (): Entry => {
      const problem = holdingFeedProblem(document.db, judged)
      if (problem !== undefined) {
        return refuse(
          judged.defaultHoldingId === undefined
            ? `${goal.name} has no default holding whose rows could feed it; name one in \`default_holding\``
            : problem.message,
        )
      }
      const holder = [...claimedHoldings.entries()].find(
        ([goalId, holdingId]) => holdingId === judged.defaultHoldingId && goalId !== goal.id,
      )
      if (holder !== undefined) {
        const other = goals.find((one) => one.id === holder[0])
        return refuse(`${rowsOf(judged.defaultHoldingId)} are already covered by ${other?.name ?? 'another goal'} in this call`)
      }
      claimed.delete(goal.id)
      if (judged.defaultHoldingId !== undefined) claimedHoldings.set(goal.id, judged.defaultHoldingId)
      return kept({ kind: 'HOLDING' }, rowsOf(judged.defaultHoldingId))
    }

    const byTransfers = (): Entry => {
      const problem = transferFeedProblem(document.db, judged)
      if (problem !== undefined) {
        return refuse(
          judged.defaultHoldingId === undefined
            ? `${goal.name} has no default holding; name a bank account's in \`default_holding\``
            : problem.message,
        )
      }
      const accountId = accountOf(judged.defaultHoldingId)
      const holder = [...claimedAccounts.entries()].find(([goalId, id]) => id === accountId && goalId !== goal.id)
      if (holder !== undefined) {
        const other = goals.find((one) => one.id === holder[0])
        return refuse(`the transfers into ${accountName(judged.defaultHoldingId)} are already covered by ${other?.name ?? 'another goal'} in this call`)
      }
      claimed.delete(goal.id)
      claimedHoldings.delete(goal.id)
      if (accountId !== undefined) claimedAccounts.set(goal.id, accountId)
      return kept({ kind: 'TRANSFERS' }, `the transfers into ${accountName(judged.defaultHoldingId)}`)
    }

    if (requested.fromHolding) return byHolding()
    if (requested.fromTransfers) return byTransfers()
    if (requested.category === undefined) {
      // A goal fed by its holding follows the holding it is left with, judged again.
      if (claimedHoldings.has(goal.id)) return byHolding()
      if (claimedAccounts.has(goal.id)) return byTransfers()
      const reads = claimed.get(goal.id)
      // Clearing the holding of a goal that reads the bank would drop every deposit
      // it derived, on the next sync and without a word. Say so, and ask for both.
      if (holding.kind === 'SET' && holding.id === undefined && reads !== undefined) {
        return refuse(
          `it reads its bank deposits from "${nameOf(reads)}", and with no default holding they would ` +
            'be removed. Stop reading it as well (`category: null`), or name another holding',
        )
      }
      return kept(reads === undefined ? undefined : { kind: 'CATEGORY', categoryId: reads }, nameOf(reads))
    }
    if (requested.category === null) {
      claimed.delete(goal.id)
      claimedHoldings.delete(goal.id)
      claimedAccounts.delete(goal.id)
      return kept(undefined, 'none')
    }
    const wanted = requested.category.trim().toLowerCase()
    const category = categories.find((one) => one.id === requested.category || one.path.toLowerCase() === wanted)
    if (category === undefined) return refuse(`no category "${requested.category}". \`category_tree\` lists them`)

    const problem = depositCategoryProblem(document.db, judged, category.id)
    if (problem !== undefined) {
      return refuse(
        judged.defaultHoldingId === undefined
          ? `${goal.name} has no default holding for its deposits to sit in; name one in \`default_holding\``
          : problem.message,
      )
    }
    const holder = [...claimed.entries()].find(([goalId, categoryId]) => categoryId === category.id && goalId !== goal.id)
    if (holder !== undefined) {
      const other = goals.find((one) => one.id === holder[0])
      return refuse(`"${category.path}" is already covered by ${other?.name ?? 'another goal'} in this call`)
    }
    claimed.set(goal.id, category.id)
    claimedHoldings.delete(goal.id)
    claimedAccounts.delete(goal.id)
    return kept({ kind: 'CATEGORY', categoryId: category.id }, category.path)
  })
}

export const setGoalDepositCategoriesTool: PluginTool = {
  definition: {
    name: 'set_goal_deposit_categories',
    title: 'Point goals at their deposits',
    description:
      'Say what feeds each goal, **several in one call**. **One feed per goal, never both**, so ' +
      'nothing counts twice: either a **Money moved category** — a transaction categorized under it is a ' +
      'deposit into the goal, read from the bank — or, with `from_holding: true`, **the rows that ' +
      'name its default holding**: every buy or sale of that holding inside an account that holds ' +
      'things (`set_transaction_holdings`) is a deposit, and the bank transfer that brought the cash ' +
      'there feeds nothing — or, with `from_transfers: true`, **the confirmed transfers into the bank ' +
      'or cash account whose own Cash is its default holding**: each transfer pair (`answer_transfers`) ' +
      'arriving there is a deposit and one leaving it a withdrawal, after its Was already there; off ' +
      'unless asked, since a main account takes transfers that are not for a goal. A broker’s cash is ' +
      'no such feed. Categorizing is the only step, and a row re-categorized elsewhere takes its deposit ' +
      'with it. One goal per category, per holding and per account; the category must be a Money moved one (a ' +
      'transfer or a saving, not a spending category), and the goal needs a default holding for the ' +
      'money to sit in: `default_holding` sets it, in the same entry or on its own, as the Goals ' +
      'form’s "Where is the money?" does. `category: null` stops either feed, and removes ' +
      'the deposits it had derived. Money you set aside by hand (`record_deposits`) and what was ' +
      'already there are never touched. `savings` shows what a holding’s rows put in, against the ' +
      'cost basis a reading printed. **Dry-runs by default**; the document is copied to a ' +
      'timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        goals: {
          type: 'array',
          description: `One entry per goal. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              goal: stringProp('The goal, by id or by name.'),
              category: {
                type: ['string', 'null'],
                description:
                  'A Money moved category, by id or by path from `category_tree`; null to stop any feed. ' +
                  'Leave it out to change only the default holding, or with `from_holding`.',
              },
              from_holding: booleanProp(
                'True: fed by the rows that name its default holding, instead of a category. Not with `category`.',
              ),
              from_transfers: booleanProp(
                'True: fed by the confirmed transfers into the bank or cash account whose own Cash is its default ' +
                  'holding, a transfer out a withdrawal. Not with `category` or `from_holding`.',
              ),
              default_holding: {
                type: ['string', 'null'],
                description:
                  'Where is the money: an existing holding from `savings`, by id, by name, or as ' +
                  '"place · holding" when two share a name; null for "not said yet". Leave it out to keep ' +
                  'the one it has. `create_goals` and `record_deposits` make new holdings.',
              },
            },
            required: ['goal'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'goals'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readRequests(args)

    const mutation: Mutation<readonly Entry[]> = {
      plan: (document) => plan(document, batch),
      refuses: (entries) => entries.every((entry) => entry.note !== undefined),
      describe: (entries) => {
        const doing = entries.filter((entry) => entry.note === undefined)
        return paragraphs(
          doing.length === 0
            ? '**Nothing to change.** The reasons are in the table.'
            : `**${plural(doing.length, 'goal')}** would change.`,
          table(
            ['Goal', 'Reads deposits from', 'Where the money is', 'What happens'],
            entries.map((entry) => [
              entry.goalName,
              entry.feedName,
              entry.holding.kind === 'SET' ? entry.holding.label : 'unchanged',
              entry.note ?? 'set',
            ]),
          ),
        )
      },
      apply: (document, entries) => {
        const now = Date.now()
        const done: string[][] = []
        for (const entry of entries) {
          if (entry.note !== undefined || entry.goalId === undefined) continue
          // The holding first: the feed is judged against the goal as it is left.
          if (entry.holding.kind === 'SET') {
            updateGoal(document.db, entry.goalId, { defaultHoldingId: entry.holding.id }, now)
          }
          const read = setGoalFeed(document.db, entry.goalId, entry.feed, now)
          done.push([
            entry.goalName,
            entry.feedName,
            entry.holding.kind === 'SET' ? entry.holding.label : 'unchanged',
            `${plural(read, 'deposit')} read`,
          ])
        }
        const refused = entries.filter((entry) => entry.note !== undefined)
        return paragraphs(
          `Changed ${plural(done.length, 'goal')}.`,
          done.length === 0 ? undefined : table(['Goal', 'Reads deposits from', 'Usually goes to', 'Deposits'], done),
          refused.length === 0
            ? undefined
            : `Refused: ${refused.map((entry) => `${entry.goalName} (${entry.note ?? ''})`).join('; ')}.`,
          '`savings` shows the balances.',
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

// --- set_cushion ------------------------------------------------------------

interface CushionPlan {
  readonly months: number | undefined
  readonly was: number | undefined
  readonly buckets: readonly { readonly id: string; readonly name: string; readonly counted: boolean }[]
  readonly accounts: readonly { readonly id: string; readonly name: string; readonly counts: boolean }[]
  readonly problem: string | undefined
}

export const setCushionTool: PluginTool = {
  definition: {
    name: 'set_cushion',
    title: 'Set the cushion',
    description:
      'Set the cushion. **What is in the bank** is the latest statement balance of the bank accounts ' +
      'that count — **every bank account and cash, until `accounts` unticks it**; **each goal saved in one of them holds its part** (its ' +
      'deposits into that account’s own cash holding), and **the cushion is what is left**, against a ' +
      'target of `months` of bills plus the Plan `buckets` (Groceries, say) counted beside ' +
      'the bills. No goal is the cushion and setting it makes none. Goals holding more than an ' +
      'account, or than the whole, is a failed check, never shrunk to fit. Every answer ends with ' +
      'the split as it stands. Wealth › Net worth and Plan both show it. **Dry-runs by default**; the document ' +
      'is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        months: numberProp(
          `How many months of bills, above 0 and at most ${String(MAX_CUSHION_MONTHS)}, to two places. e.g. 3.`,
        ),
        buckets: {
          type: 'array',
          description: 'Plan buckets to count in the cushion, or to stop counting. Ids or names from `plans`.',
          items: {
            type: 'object',
            properties: {
              bucket: stringProp('The bucket, by id or by name.'),
              counted: booleanProp('True counts it among the months; false stops counting it.'),
            },
            required: ['bucket', 'counted'],
            additionalProperties: false,
          },
        },
        accounts: {
          type: 'array',
          description:
            'Bank accounts whose balance counts toward what is in the bank, or stops counting. A card or an account with holdings never counts.',
          items: {
            type: 'object',
            properties: {
              account: stringProp('The account, by id, name or last four digits.'),
              counts: booleanProp('True counts its balance; false stops counting it.'),
            },
            required: ['account', 'counts'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const months = args['months']
    if (months !== undefined && typeof months !== 'number') throw new ToolInputError('`months` must be a number.')
    const asked = args['buckets'] ?? []
    if (!Array.isArray(asked)) throw new ToolInputError('`buckets` must be a list.')
    const askedAccounts = args['accounts'] ?? []
    if (!Array.isArray(askedAccounts)) throw new ToolInputError('`accounts` must be a list.')
    if (months === undefined && asked.length === 0 && askedAccounts.length === 0) {
      throw new ToolInputError('Say `months`, `buckets`, `accounts`, or any of them.')
    }

    const mutation: Mutation<CushionPlan> = {
      plan: (document): CushionPlan => {
        const reading = cushionReading(document.db, today(), documentCurrency(document.db))
        const all = listSplitBuckets(document.db)
        const unknown: string[] = []
        const buckets = (asked as Args[]).flatMap((entry) => {
          const key = String(entry['bucket'] ?? '').trim()
          const found =
            all.find((one) => one.id === key) ?? all.find((one) => one.name.toLowerCase() === key.toLowerCase())
          if (found === undefined) {
            unknown.push(`no bucket called "${key}" (\`plans\` lists them)`)
            return []
          }
          return [{ id: found.id, name: found.name, counted: entry['counted'] === true }]
        })
        const accounts = (askedAccounts as Args[]).flatMap((entry) => {
          const key = String(entry['account'] ?? '').trim()
          const found =
            reading.accounts.find((one) => one.accountId === key) ??
            reading.accounts.find((one) => one.name.toLowerCase() === key.toLowerCase()) ??
            reading.accounts.find((one) => one.last4 !== undefined && one.last4 === key)
          if (found === undefined) {
            unknown.push(`no bank account "${key}" can count (a card or an account with holdings never does)`)
            return []
          }
          return [{ id: found.accountId, name: accountLabel(found), counts: entry['counts'] === true }]
        })
        const problem =
          months !== undefined && !isCushionMonths(months)
            ? `the cushion is a number of months above 0 and at most ${String(MAX_CUSHION_MONTHS)}`
            : unknown.length > 0
              ? unknown.join('; ')
              : undefined
        return { months, was: reading.months, buckets, accounts, problem }
      },
      refuses: (one) => one.problem !== undefined,
      describe: (one) => {
        if (one.problem !== undefined) return `**Nothing to change:** ${one.problem}.`
        const lines: string[] = []
        if (one.months !== undefined) {
          lines.push(
            `The cushion's target would go from ${one.was === undefined ? 'no months' : `${String(one.was)} months`} to ` +
              `${String(one.months)} months of bills.`,
          )
        }
        for (const bucket of one.buckets) {
          lines.push(`**${bucket.name}** would ${bucket.counted ? 'count' : 'stop counting'} in the cushion.`)
        }
        for (const account of one.accounts) {
          lines.push(`**${account.name}** would ${account.counts ? 'count' : 'stop counting'} as the bank.`)
        }
        return lines.join('\n')
      },
      apply: (document, one) => {
        if (one.problem !== undefined) return one.problem
        const lines: string[] = []
        const now = Date.now()
        if (one.months !== undefined) {
          setCushionMonths(document.db, one.months, now)
          lines.push(`The cushion's target is ${String(one.months)} months of bills.`)
        }
        if (one.buckets.length > 0) {
          setCushionBuckets(
            document.db,
            one.buckets.map((bucket) => ({ bucketId: bucket.id, included: bucket.counted })),
            now,
          )
          for (const bucket of one.buckets) {
            lines.push(`**${bucket.name}** ${bucket.counted ? 'counts' : 'no longer counts'} in the cushion.`)
          }
        }
        if (one.accounts.length > 0) {
          setCushionAccounts(
            document.db,
            one.accounts.map((account) => ({ accountId: account.id, counts: account.counts })),
            now,
          )
          for (const account of one.accounts) {
            lines.push(`**${account.name}** ${account.counts ? 'counts' : 'no longer counts'} as the bank.`)
          }
        }
        return paragraphs(
          lines.join('\n'),
          cushionSplitText(cushionReading(document.db, today(), documentCurrency(document.db))),
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

function accountLabel(account: { readonly name: string; readonly last4: string | undefined }): string {
  return account.last4 === undefined ? account.name : `${account.name} ···${account.last4}`
}

/** The split as the card says it: the bank, each goal's part, the cushion, and every check. */
function cushionSplitText(reading: CushionReading): string {
  const { split } = reading
  const lines: string[] = []
  const names = new Map(reading.accounts.map((one) => [one.accountId, accountLabel(one)]))
  if (split.check.kind === 'NO_ACCOUNTS') {
    lines.push('**No bank account counts toward the cushion.** `accounts` ticks one back.')
  } else if (split.check.kind === 'UNCHECKED') {
    const without = split.check.withoutBalance
    lines.push(
      `**Unchecked:** ${without.join(', ')} ${without.length === 1 ? 'has' : 'have'} no statement balance, ` +
        'so what is in the bank cannot be said.',
    )
  } else if (split.balance !== undefined) {
    const counted = reading.accounts.filter((one) => one.counts).map(accountLabel)
    lines.push(`**In the bank:** ${formatMoney(split.balance)}, from ${counted.join(', ')}.`)
  }
  for (const part of split.parts) {
    lines.push(`- **${part.goalName}**, saved in ${names.get(part.accountId) ?? 'an account'}: ${formatMoney(part.amount)}`)
  }
  if (split.check.kind === 'OVER' && split.balance !== undefined) {
    lines.push(
      `**Off by ${formatMoney(split.check.by)}:** the goals saved here hold ${formatMoney(split.partsTotal)}, and the ` +
        `accounts end at ${formatMoney(split.balance)}. There is no cushion to measure.`,
    )
  }
  for (const short of split.short) {
    lines.push(
      `**${accountLabel(short)} is off by ${formatMoney(short.by)}:** the goals saved there hold ` +
        `${formatMoney(short.parts)}, and it ends at ${formatMoney(short.balance)}.`,
    )
  }
  if (split.left !== undefined) lines.push(`**The cushion, what is left:** ${formatMoney(split.left)}.`)
  lines.push(
    reading.months === undefined
      ? 'No target yet: `months` sets it.'
      : reading.target === undefined
        ? `Its target is ${String(reading.months)} months of bills; the amount follows once bills are tracked (\`fixed_expense_candidates\` finds them, \`track_fixed_expenses\` records them).`
        : `Its target is ${String(reading.months)} months of bills${countedBuckets(reading)}: ${formatMoney(reading.target)}.`,
  )
  if (reading.above !== undefined) {
    lines.push(
      reading.above.minor >= 0
        ? `${formatMoney(reading.above)} above it.`
        : `${formatMoney(money(-reading.above.minor, reading.above.currency))} short of it.`,
    )
  }
  return lines.join('\n')
}

function countedBuckets(reading: CushionReading): string {
  const counted = reading.buckets.filter((one) => one.included).map((one) => one.name)
  return counted.length === 0 ? '' : ` and ${counted.join(', ')}`
}
