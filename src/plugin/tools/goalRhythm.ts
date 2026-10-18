/**
 * `pause_goals`, `settle_set_aside` and `suggest_goal_amounts` — the three writes
 * Goals makes beyond a typed amount (M28 U8, S7, S5, S3), each with its dry run.
 *
 * Each names one thing and refuses what the screen refuses: a goal is paused for
 * a number of months and never deleted, a set-aside amount is said to be still
 * there or gone, and a split is goals by nearest
 * date, inside what Plan has for goals. The amounts are written through Plan's
 * own rule, so a suggestion and a typed figure cannot disagree about what they
 * do to the rest of the split.
 */

import { toISODate } from '@/core/time.ts'
import {
  applyGoalSplit,
  setBucketMonthly,
  setGoalMonthly,
  suggestGoalSplit,
} from '@/data/repositories/goalPlanRepository.ts'
import { listDebts } from '@/data/repositories/debtRepository.ts'
import { fromMajorUnits } from '@/core/money.ts'
import {
  MAX_PAUSE_MONTHS,
  pauseGoal,
  settleSetAside,
  staleSetAside,
} from '@/data/repositories/goalRhythmRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { listGoals } from '@/data/repositories/savingsRepository.ts'
import { SUGGESTION_WORDS, type Suggestion } from '@/domain/goalRhythm.ts'

import { type OpenDocument } from '../document.ts'
import { money, paragraphs, plural, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { today } from '../today.ts'
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

function findGoal(document: OpenDocument, text: string) {
  const wanted = text.trim().toLowerCase()
  return listGoals(document.db, { includeClosed: true }).find(
    (one) => one.id === text || one.name.trim().toLowerCase() === wanted,
  )
}

function readList(args: Args, key: string): readonly Record<string, unknown>[] {
  const raw = args[key]
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(`\`${key}\` must be a non-empty array, one entry per goal.`)
  }
  if (raw.length > BATCH_MAX) throw new ToolInputError(`That is ${raw.length} entries; the ceiling is ${BATCH_MAX}.`)
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`\`${key}[${index}]\` must be an object.`)
    return entry as Record<string, unknown>
  })
}

// --- pause_goals (S7) --------------------------------------------------------

interface PausePlan {
  readonly goalId: string | undefined
  readonly goalName: string
  readonly months: number
  readonly note: string | undefined
}

export const pauseGoalsTool: PluginTool = {
  definition: {
    name: 'pause_goals',
    title: 'Pause goals',
    description:
      'Pause goals for a number of months, or start them again, **several in one call**. A ' +
      'paused goal is skipped by the projection and gives its monthly amount back to what is left ' +
      'in Plan for those months; it is not deleted and keeps its history. `months` counts this ' +
      'month: 1 skips this month only. 0 starts the goal again. Plan\'s own bucket is left ' +
      'alone. **Dry-runs by default**; the document is copied to a timestamped .bak first.',
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
              months: numberProp(`Months to pause, 1 to ${String(MAX_PAUSE_MONTHS)}, counting this one; 0 to start it again.`),
            },
            required: ['goal', 'months'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'goals'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readList(args, 'goals').map((record, index) => {
      const goal = optionalString(record, 'goal')
      const months = record['months']
      if (goal === undefined) throw new ToolInputError(`\`goals[${index}]\` needs a \`goal\`.`)
      if (typeof months !== 'number') throw new ToolInputError(`\`goals[${index}]\` needs \`months\`, a number.`)
      return { goal, months }
    })

    const mutation: Mutation<readonly PausePlan[]> = {
      plan: (document) =>
        batch.map((one): PausePlan => {
          const goal = findGoal(document, one.goal)
          if (goal === undefined) {
            return { goalId: undefined, goalName: one.goal, months: one.months, note: 'no such goal; `savings` lists them' }
          }
          if (!Number.isInteger(one.months) || one.months < 0 || one.months > MAX_PAUSE_MONTHS) {
            return {
              goalId: goal.id,
              goalName: goal.name,
              months: one.months,
              note: `months is 1 to ${String(MAX_PAUSE_MONTHS)}, or 0 to start it again`,
            }
          }
          if (goal.isClosed) return { goalId: goal.id, goalName: goal.name, months: one.months, note: 'it is closed' }
          return { goalId: goal.id, goalName: goal.name, months: one.months, note: undefined }
        }),
      refuses: (entries) => entries.every((entry) => entry.note !== undefined),
      describe: (entries) =>
        paragraphs(
          table(
            ['Goal', 'Change', 'Note'],
            entries.map((entry) => [
              entry.goalName,
              entry.note !== undefined ? '—' : entry.months === 0 ? 'starts again' : `paused ${plural(entry.months, 'month')}`,
              entry.note ?? '',
            ]),
          ),
        ),
      apply: (document, entries) => {
        let done = 0
        for (const entry of entries) {
          if (entry.note !== undefined || entry.goalId === undefined) continue
          pauseGoal(document.db, entry.goalId, entry.months, today())
          done += 1
        }
        return `Changed ${plural(done, 'goal')}. \`goal_projection\` shows the effect.`
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

// --- settle_set_aside (S5) ---------------------------------------------------

interface SettlePlan {
  readonly goalId: string | undefined
  readonly goalName: string
  readonly answer: 'STILL_THERE' | 'GONE'
  readonly stale: string
  readonly note: string | undefined
}

export const settleSetAsideTool: PluginTool = {
  definition: {
    name: 'settle_set_aside',
    title: 'Is it still set aside?',
    description:
      'Answer, for a goal, whether money **set aside** (promised to it but still inside the bank) is ' +
      'still there. A set-aside amount nobody has confirmed for more than 90 days is the one that ' +
      'is asked about; `goal_projection` lists them. `still_there: true` records today against ' +
      'them so they are not asked about again for 90 days. `false` withdraws them from the goal, ' +
      'with the reason written, so the balance stops counting money that is gone. Several goals in ' +
      'one call. **Dry-runs by default**; the document is copied to a timestamped .bak first.',
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
              still_there: booleanProp('True if the money is still set aside, false if it is gone.'),
            },
            required: ['goal', 'still_there'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'goals'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readList(args, 'goals').map((record, index) => {
      const goal = optionalString(record, 'goal')
      const still = record['still_there']
      if (goal === undefined) throw new ToolInputError(`\`goals[${index}]\` needs a \`goal\`.`)
      if (typeof still !== 'boolean') throw new ToolInputError(`\`goals[${index}]\` needs \`still_there\`, true or false.`)
      return { goal, answer: (still ? 'STILL_THERE' : 'GONE') as 'STILL_THERE' | 'GONE' }
    })

    const mutation: Mutation<readonly SettlePlan[]> = {
      plan: (document) => {
        const stale = staleSetAside(document.db, today())
        return batch.map((one): SettlePlan => {
          const goal = findGoal(document, one.goal)
          if (goal === undefined) {
            return { goalId: undefined, goalName: one.goal, answer: one.answer, stale: '—', note: 'no such goal; `savings` lists them' }
          }
          const held = stale.get(goal.id) ?? []
          if (held.length === 0) {
            return { goalId: goal.id, goalName: goal.name, answer: one.answer, stale: '—', note: 'nothing set aside is older than 90 days' }
          }
          const total = held.reduce((running, one2) => running + one2.amount.minor, 0)
          return {
            goalId: goal.id,
            goalName: goal.name,
            answer: one.answer,
            stale: `${money(held[0] === undefined ? undefined : { ...held[0].amount, minor: total })} in ${plural(held.length, 'amount')}, oldest ${toISODate(held[0]?.date ?? today())}`,
            note: undefined,
          }
        })
      },
      refuses: (entries) => entries.every((entry) => entry.note !== undefined),
      describe: (entries) =>
        table(
          ['Goal', 'Set aside, not confirmed for 90 days', 'Answer', 'Note'],
          entries.map((entry) => [
            entry.goalName,
            entry.stale,
            entry.answer === 'STILL_THERE' ? 'still there' : 'gone: withdraw it',
            entry.note ?? '',
          ]),
        ),
      apply: (document, entries) => {
        let done = 0
        for (const entry of entries) {
          if (entry.note !== undefined || entry.goalId === undefined) continue
          settleSetAside(document.db, entry.goalId, entry.answer, today(), Date.now())
          done += 1
        }
        return `Settled ${plural(done, 'goal')}.`
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

// --- suggest_goal_amounts (S3) -------------------------------------------------

export const suggestGoalAmountsTool: PluginTool = {
  definition: {
    name: 'suggest_goal_amounts',
    title: 'Suggest a split',
    description:
      'Suggest each goal\'s monthly amount: goals ' +
      'by nearest date (no kind of goal goes first), each taking what gets it there on its date until what Plan has for goals ' +
      'runs out (what they take now plus what is left after every bucket). A goal with no date is ' +
      'sized as a year of what is missing; a reached, target-less or paused goal gets nothing. The ' +
      'preview is the suggestion; `commit: true` writes it through the same rule a typed amount on ' +
      'Goals uses, so the rest of the split moves with it. **Dry-runs by default**; the document is ' +
      'copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        commit: booleanProp('Default false. False shows the suggestion; true writes it.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')

    const mutation: Mutation<Suggestion | undefined> = {
      plan: (document) => suggestGoalSplit(document.db, today(), documentCurrency(document.db)),
      refuses: (suggestion) => suggestion === undefined,
      describe: (suggestion) =>
        suggestion === undefined
          ? '**Nothing to suggest.** The document needs a plan and at least one open goal.'
          : paragraphs(
              table(
                ['Goal', 'Each month', 'It would take', 'Why'],
                suggestion.amounts.map((one) => [
                  one.name,
                  money(one.amount),
                  one.wanted.minor === one.amount.minor ? '—' : money(one.wanted),
                  SUGGESTION_WORDS[one.reason],
                ]),
              ),
              `Plan has ${money(suggestion.pool)} for goals; this leaves ${money(suggestion.left)} of it for everything else.`,
            ),
      apply: (document, suggestion) => {
        if (suggestion === undefined) return 'Nothing to suggest.'
        const done = applyGoalSplit(document.db, today(), documentCurrency(document.db), suggestion, Date.now())
        return paragraphs(
          `Set ${plural(done.set, 'amount')} on Plan.`,
          done.problems.length === 0 ? undefined : `Not set: ${done.problems.join(' ')}`,
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

// --- set_goal_amounts ---------------------------------------------------------

interface AmountPlan {
  readonly kind: 'SAVING_GOAL' | 'DEBT'
  readonly id: string | undefined
  readonly name: string
  readonly minor: number
  readonly problem: string | undefined
}

/**
 * What Goals' and Debts' amount field does (M28 F10): set the Plan bucket that points at a goal,
 * or a debt's extra, taking the difference from Plan's *Everything else*. A thing with no bucket
 * gets one ahead of *What's left*. The screen and this tool write through `setBucketMonthly`.
 */
export const setGoalAmountsTool: PluginTool = {
  definition: {
    name: 'set_goal_amounts',
    title: 'Set what goes toward goals and debts each month',
    description:
      'Set the monthly amount toward a goal, or the extra on a debt: the Plan bucket for it, ' +
      'in the default plan. The difference comes from (or goes back to) Plan\'s Everything else, as on ' +
      'the Goals and Debts screens; a goal or debt with no bucket gets one. **Dry-runs by default**; the ' +
      'document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        amounts: {
          type: 'array',
          description: 'One entry per goal or debt. Up to 60 in a call.',
          items: {
            type: 'object',
            properties: {
              goal: stringProp('A goal, by id or by name. Give this or `debt`.'),
              debt: stringProp('A debt, by id or by name.'),
              amount: numberProp('Major units a month, 0 or more.'),
            },
            required: ['amount'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'amounts'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const asked = args['amounts']
    if (!Array.isArray(asked) || asked.length === 0) throw new ToolInputError('`amounts` must be a non-empty list.')
    if (asked.length > 60) throw new ToolInputError('At most 60 amounts in a call.')

    const mutation: Mutation<readonly AmountPlan[]> = {
      plan: (document) => {
        const goals = listGoals(document.db)
        const debts = listDebts(document.db)
        const currency = documentCurrency(document.db)
        return (asked as Args[]).map((entry): AmountPlan => {
          const amount = entry['amount']
          const minor = typeof amount === 'number' && amount >= 0 ? fromMajorUnits(amount, currency).minor : -1
          const goalKey = typeof entry['goal'] === 'string' ? entry['goal'].trim() : undefined
          const debtKey = typeof entry['debt'] === 'string' ? entry['debt'].trim() : undefined
          const kind = goalKey !== undefined ? 'SAVING_GOAL' : 'DEBT'
          const key = goalKey ?? debtKey ?? ''
          const found =
            kind === 'SAVING_GOAL'
              ? goals.find((one) => one.id === key || one.name.toLowerCase() === key.toLowerCase())
              : debts.find((one) => one.id === key || one.name.toLowerCase() === key.toLowerCase())
          const problem =
            goalKey === undefined && debtKey === undefined
              ? 'name a `goal` or a `debt`'
              : found === undefined
                ? `no ${kind === 'SAVING_GOAL' ? 'goal' : 'debt'} called "${key}"`
                : minor < 0
                  ? '`amount` must be 0 or more'
                  : undefined
          return { kind, id: found?.id, name: found?.name ?? key, minor, problem }
        })
      },
      refuses: (all) => all.some((one) => one.problem !== undefined),
      describe: (all) =>
        all
          .map((one) =>
            one.problem !== undefined
              ? `**${one.name}:** refused, ${one.problem}.`
              : `**${one.name}** would get ${String(one.minor / 100)} a month${one.kind === 'DEBT' ? ' extra' : ''}, from Everything else.`,
          )
          .join('\n'),
      apply: (document, all) => {
        const currency = documentCurrency(document.db)
        const lines = all.map((one) => {
          if (one.id === undefined) return `**${one.name}:** not set.`
          const result =
            one.kind === 'SAVING_GOAL'
              ? setGoalMonthly(document.db, today(), currency, one.id, one.minor, Date.now())
              : setBucketMonthly(document.db, today(), currency, 'DEBT', one.id, `Extra on ${one.name}`, one.minor, Date.now())
          return result === 'SET'
            ? `**${one.name}**: set.`
            : result === 'UNCHANGED'
              ? `**${one.name}**: already that.`
              : result === 'NO_PLAN'
                ? 'The document has no plan; `set_plan` makes one.'
                : `**${one.name}**: several buckets are for it; change them with \`set_plan\`.`
        })
        return lines.join('\n')
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
