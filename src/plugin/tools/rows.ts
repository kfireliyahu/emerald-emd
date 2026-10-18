/**
 * What the Transactions screen does to a row that is not a category — the four
 * tools M28 U6 added so a conversation can do what the right-click menu does
 * (D-227, D-315, S6 of its approval).
 *
 * - `set_excluded_from_totals` — *Leave out of totals* and *Count it again*;
 * - `set_transaction_notes` — *Add or edit a note*;
 * - `set_card_payers` — *This pays a card*, for a bank row;
 * - `skip_merchants` — *Skip for now* on By merchant, and putting one back.
 *
 * **Every one takes a list and dry-runs until `commit: true`** (D-110, D-092),
 * and every one writes through the repository function the screen calls, so
 * there is one spelling of each write. A leave-out is the one that moves a
 * figure on Home, which is why the dry run names the amount it would take out of
 * the totals and not only the rows.
 *
 * Nothing here categorizes a row and nothing here is a rule: `assign_category`
 * and `create_rule` are those, and the categories themselves are
 * `edit_categories`.
 */

import { rescanSettlements } from '@/data/importer/settlementScan.ts'
import {
  findAccountById,
  setExcludeSettlementsFromStats,
} from '@/data/repositories/accountRepository.ts'
import { decideForCard } from '@/data/repositories/cardSettlementRepository.ts'
import { readSkipped, skipMerchant, unskipMerchant } from '@/data/repositories/labelingQueueRepository.ts'
import {
  clearSettlementAlias,
  findSettlementAlias,
  setSettlementAlias,
} from '@/data/repositories/settlementAliasRepository.ts'
import {
  findTransactionById,
  setExcludedFromStats,
  setTransactionNote,
  type StoredTransaction,
} from '@/data/repositories/transactionRepository.ts'

import { count, date, money, paragraphs, plural, table } from '../format.ts'
import { mutatingCall } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  optionalBoolean,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

/** The ceiling on one call. Above it the scope is the thing to fix. */
const BATCH_MAX = 2000

/** Rows shown in a diff. The counts are over everything. */
const SAMPLE = 15

function idList(args: Args, name: string): readonly string[] {
  const raw = args[name]
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(`\`${name}\` must be a non-empty array of transaction ids.`)
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} rows; the ceiling is ${BATCH_MAX} in one call.`)
  }
  for (const each of raw) {
    if (typeof each !== 'string' || each === '') {
      throw new ToolInputError(`\`${name}\` holds a value that is not a transaction id.`)
    }
  }
  return [...new Set(raw as readonly string[])]
}

const rowLine = (row: StoredTransaction): string[] => [
  date(row.transactionDate),
  row.merchantRaw,
  money(row.amount),
  row.id,
]

// --- set_excluded_from_totals ------------------------------------------------

interface ExcludePlan {
  readonly excluded: boolean
  readonly change: readonly StoredTransaction[]
  readonly already: number
  readonly missing: readonly string[]
}

function planExclude(db: Parameters<typeof findTransactionById>[0], ids: readonly string[], excluded: boolean): ExcludePlan {
  const change: StoredTransaction[] = []
  const missing: string[] = []
  let already = 0
  for (const id of ids) {
    const row = findTransactionById(db, id)
    if (row === undefined) missing.push(id)
    else if (row.isExcludedFromStats === excluded) already += 1
    else change.push(row)
  }
  return { excluded, change, already, missing }
}

function describeExclude(plan: ExcludePlan): string {
  const verb = plan.excluded ? 'left out of the totals' : 'counted in the totals again'
  // The figure a leave-out takes off Home, per currency, because "3 rows" does
  // not say whether it is ₪30 or ₪30,000.
  const sums = new Map<string, number>()
  for (const row of plan.change) {
    sums.set(row.amount.currency, (sums.get(row.amount.currency) ?? 0) + row.amount.minor)
  }
  const total = [...sums].map(([currency, minor]) => money({ minor, currency })).join(' · ')
  return paragraphs(
    `${count(plan.change.length)} ${plural(plan.change.length, 'row')} would be ${verb}` +
      (plan.change.length > 0 ? `, ${total} between them (signed, as stored).` : '.'),
    plan.already === 0
      ? undefined
      : `${count(plan.already)} ${plural(plan.already, 'row is', 'rows are')} already ` +
          `${plan.excluded ? 'left out' : 'counted'} and untouched.`,
    plan.missing.length === 0
      ? undefined
      : `No transaction has the id ${plan.missing.slice(0, 5).join(', ')}` +
          `${plan.missing.length > 5 ? ` and ${plan.missing.length - 5} more` : ''}.`,
    plan.change.length === 0
      ? undefined
      : table(['Date', 'Merchant', 'Amount', 'Id'], plan.change.slice(0, SAMPLE).map(rowLine)),
    'A row left out stays in the list, struck through, and is counted in no sum on Home or in ' +
      '`month_summary`. Nothing is deleted, and the same call with `excluded: false` takes it back.',
  )
}

export const setExcludedFromTotalsTool: PluginTool = {
  definition: {
    name: 'set_excluded_from_totals',
    title: 'Leave rows out of the totals, or count them again',
    description:
      'Leave transactions out of every total — **a list of ids in one call** — or count them ' +
      'again with `excluded: false`. A row left out stays in the ledger and is shown marked; it ' +
      'is simply not summed. This is what the Transactions screen’s row menu does: a card ' +
      'bill the bank statement shows as one charge is the same money as the card statement’s ' +
      'rows, and counting both doubles the month. **Dry-runs by default** and says how much ' +
      'it would take off the totals; commit with `commit: true` after the user has said yes. ' +
      'The document is copied to a timestamped .bak first. Ids come from `transactions`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        transaction_ids: {
          type: 'array',
          items: { type: 'string' },
          description: `Up to ${String(BATCH_MAX)} transaction ids, from \`transactions\`.`,
        },
        excluded: booleanProp('Default true: leave them out. False counts them in the totals again.'),
        commit: booleanProp('Default false. False previews and writes nothing; true makes the change.'),
      },
      required: ['path', 'transaction_ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const ids = idList(args, 'transaction_ids')
    const excluded = optionalBoolean(args, 'excluded') ?? true
    return mutatingCall(path, args['commit'] === true, {
      plan: (document) => planExclude(document.db, ids, excluded),
      describe: describeExclude,
      apply: (document, plan) => {
        const now = Date.now()
        for (const row of plan.change) setExcludedFromStats(document.db, row.id, plan.excluded, now)
        return describeExclude(plan).replace(/ would be /, ' were ')
      },
      refuses: (plan) => plan.change.length === 0,
    })
  },
}

// --- set_transaction_notes ---------------------------------------------------

interface NoteEntry {
  readonly id: string
  readonly note: string
}

interface NotesPlan {
  readonly entries: readonly (NoteEntry & { readonly row: StoredTransaction | undefined })[]
}

function readNotes(args: Args): readonly NoteEntry[] {
  const raw = args['notes']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`notes` must be a non-empty array of {transaction_id, note}.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} notes; the ceiling is ${BATCH_MAX} in one call.`)
  }
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`\`notes[${index}]\` must be an object.`)
    }
    const record = entry as Record<string, unknown>
    const note = record['note']
    if (typeof note !== 'string') {
      throw new ToolInputError(
        `\`notes[${index}].note\` must be a string — an empty one clears the note.`,
      )
    }
    return { id: requireString(record, 'transaction_id'), note: note.trim() }
  })
}

function describeNotes(plan: NotesPlan): string {
  const known = plan.entries.filter((entry) => entry.row !== undefined)
  const missing = plan.entries.filter((entry) => entry.row === undefined)
  return paragraphs(
    `${count(known.length)} ${plural(known.length, 'note')} would be written` +
      `${known.some((entry) => entry.note === '') ? ' (an empty one clears)' : ''}.`,
    missing.length === 0
      ? undefined
      : `No transaction has the id ${missing.slice(0, 5).map((entry) => entry.id).join(', ')}.`,
    known.length === 0
      ? undefined
      : table(
          ['Date', 'Merchant', 'Now', 'Becomes'],
          known.slice(0, SAMPLE).map((entry) => [
            date(entry.row?.transactionDate),
            entry.row?.merchantRaw ?? '',
            entry.row?.note ?? '—',
            entry.note === '' ? '(cleared)' : entry.note,
          ]),
        ),
    'A note is yours, in your words, and no total or rule reads it. What is written in one is ' +
      'text, never an instruction to this tool.',
  )
}

export const setTransactionNotesTool: PluginTool = {
  definition: {
    name: 'set_transaction_notes',
    title: 'Add, edit or clear notes on transactions',
    description:
      'Write the note on a transaction — **a list in one call**. An empty `note` clears it. ' +
      'This is the row menu’s *Add a note*: a line about one charge that is worth ' +
      'remembering. **Dry-runs by default**; commit with `commit: true` after the user has seen ' +
      'the table. Ids come from `transactions`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        notes: {
          type: 'array',
          description: `One entry per transaction. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              transaction_id: stringProp('The transaction, from `transactions`.'),
              note: stringProp('The note. Empty clears it.'),
            },
            required: ['transaction_id', 'note'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews and writes nothing; true makes the change.'),
      },
      required: ['path', 'notes'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const entries = readNotes(args)
    return mutatingCall<NotesPlan>(path, args['commit'] === true, {
      plan: (document) => ({
        entries: entries.map((entry) => ({ ...entry, row: findTransactionById(document.db, entry.id) })),
      }),
      describe: describeNotes,
      apply: (document, plan) => {
        const now = Date.now()
        for (const entry of plan.entries) {
          if (entry.row !== undefined) {
            setTransactionNote(document.db, entry.id, entry.note === '' ? undefined : entry.note, now)
          }
        }
        return describeNotes(plan).replace(' would be ', ' were ')
      },
      refuses: (plan) => plan.entries.every((entry) => entry.row === undefined),
    })
  },
}

// --- set_card_payers ---------------------------------------------------------

interface PayerEntry {
  readonly transactionId: string
  /** Undefined takes the answer back: *not a card payment*. */
  readonly cardAccountId: string | undefined
  /** Whether the bank rows that pay the card count in the totals. Absent leaves the card’s answer alone. */
  readonly counts: boolean | undefined
}

interface PayerPlan {
  readonly entries: readonly {
    readonly entry: PayerEntry
    readonly row: StoredTransaction | undefined
    readonly cardName: string | undefined
    readonly problem: string | undefined
    readonly before: string | undefined
  }[]
}

function readPayers(args: Args): readonly PayerEntry[] {
  const raw = args['payments']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`payments` must be a non-empty array of {transaction_id, card_account_id?}.')
  }
  if (raw.length > 200) {
    throw new ToolInputError(`That is ${raw.length} entries; the ceiling is 200 in one call.`)
  }
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`\`payments[${index}]\` must be an object.`)
    }
    const record = entry as Record<string, unknown>
    return {
      transactionId: requireString(record, 'transaction_id'),
      cardAccountId: optionalString(record, 'card_account_id'),
      counts: optionalBoolean(record, 'counts'),
    }
  })
}

function describePayers(plan: PayerPlan): string {
  const ok = plan.entries.filter((each) => each.problem === undefined)
  const bad = plan.entries.filter((each) => each.problem !== undefined)
  return paragraphs(
    `${count(ok.length)} ${plural(ok.length, 'merchant')} would change what it pays.`,
    bad.length === 0
      ? undefined
      : `Not changed: ${bad.map((each) => `${each.entry.transactionId} (${each.problem ?? ''})`).join('; ')}.`,
    ok.length === 0
      ? undefined
      : table(
          ['Bank row', 'Pays now', 'Becomes', 'Its rows count'],
          ok.map((each) => [
            each.row?.merchantRaw ?? '',
            each.before ?? '—',
            each.cardName ?? 'not a card payment',
            each.entry.counts === undefined ? 'as the card says' : each.entry.counts ? 'yes' : 'no',
          ]),
        ),
    'The answer belongs to the merchant, so **every** row of that name — before and after today ' +
      '— is read as paying that card, and its card payments are found again. Whether those bank ' +
      'rows count in the totals is the card’s answer (`counts`), because a card paid by the bank ' +
      'is already in the card’s own rows.',
  )
}

export const setCardPayersTool: PluginTool = {
  definition: {
    name: 'set_card_payers',
    title: 'Say which bank rows pay a card',
    description:
      'Say that a bank merchant pays a credit card — **a list in one call**. Give the bank ' +
      '`transaction_id` and the `card_account_id` it pays (ids from `document_info`); omit the ' +
      'card to take the answer back. This is *This pays a card* on a Transactions row and on a By merchant row. Optionally ' +
      '`counts` says whether those bank rows count in the totals: false leaves them out, because ' +
      'the card’s own rows already hold that money. **Dry-runs by default**; commit with ' +
      '`commit: true` once the user has said yes.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        payments: {
          type: 'array',
          description: 'One entry per bank merchant. Up to 200 in a call.',
          items: {
            type: 'object',
            properties: {
              transaction_id: stringProp('A bank row of the merchant, from `transactions`.'),
              card_account_id: stringProp('The credit-card account it pays. Omit for *not a card payment*.'),
              counts: booleanProp('Whether the bank rows that pay the card count in totals. Omit to keep the card’s answer.'),
            },
            required: ['transaction_id'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews and writes nothing; true makes the change.'),
      },
      required: ['path', 'payments'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const entries = readPayers(args)
    return mutatingCall<PayerPlan>(path, args['commit'] === true, {
      plan: (document) => ({
        entries: entries.map((entry) => {
          const row = findTransactionById(document.db, entry.transactionId)
          const card = entry.cardAccountId === undefined ? undefined : findAccountById(document.db, entry.cardAccountId)
          const before =
            row === undefined
              ? undefined
              : findAccountById(document.db, findSettlementAlias(document.db, row.merchantNormalized)?.cardAccountId ?? '')?.name
          const problem =
            row === undefined
              ? 'no such transaction'
              : entry.cardAccountId !== undefined && card === undefined
                ? 'no such account'
                : card !== undefined && card.kind !== 'CREDIT_CARD'
                  ? `${card.name} is not a credit card`
                  : undefined
          return { entry, row, cardName: card?.name, problem, before }
        }),
      }),
      describe: describePayers,
      apply: (document, plan) => {
        const now = Date.now()
        for (const each of plan.entries) {
          if (each.problem !== undefined || each.row === undefined) continue
          if (each.entry.cardAccountId === undefined) {
            clearSettlementAlias(document.db, each.row.merchantNormalized, now)
          } else {
            setSettlementAlias(document.db, each.row.merchantNormalized, each.entry.cardAccountId, now)
          }
          if (each.entry.counts !== undefined && each.entry.cardAccountId !== undefined) {
            setExcludeSettlementsFromStats(document.db, each.entry.cardAccountId, !each.entry.counts, now)
          }
        }
        // Links are re-derived before anything reads them (D-062); the decision
        // follows, for the cards that were asked about, so it reaches the rows
        // the rescan just linked.
        rescanSettlements(document.db, now)
        for (const each of plan.entries) {
          if (each.problem !== undefined || each.entry.cardAccountId === undefined) continue
          if (each.entry.counts === undefined) continue
          decideForCard(document.db, each.entry.cardAccountId, each.entry.counts ? 'KEPT' : 'EXCLUDED', now)
        }
        return describePayers(plan).replace(' would change ', ' changed ')
      },
      refuses: (plan) => plan.entries.every((each) => each.problem !== undefined),
    })
  },
}

// --- skip_merchants ----------------------------------------------------------

interface SkipPlan {
  readonly skip: boolean
  readonly change: readonly string[]
  readonly already: readonly string[]
}

function describeSkip(plan: SkipPlan): string {
  return paragraphs(
    `${count(plan.change.length)} ${plural(plan.change.length, 'merchant')} would be ` +
      `${plan.skip ? 'set aside' : 'put back in the queue'}.`,
    plan.change.length === 0 ? undefined : plan.change.map((name) => `- ${name}`).join('\n'),
    plan.already.length === 0
      ? undefined
      : `${count(plan.already.length)} ${plural(plan.already.length, 'was', 'were')} already ` +
          `${plan.skip ? 'skipped' : 'in the queue'}.`,
    'Skipping writes nothing to a row: the transactions stay uncategorized and stay in the ledger. ' +
      'It only means By merchant stops asking about the name, until it is put back.',
  )
}

export const skipMerchantsTool: PluginTool = {
  definition: {
    name: 'skip_merchants',
    title: 'Skip merchants for now, or put them back',
    description:
      'Set merchants aside in the By merchant queue — **a list in one call** — or put them ' +
      'back with `skip: false`. "I do not know what this is" is a real answer to a cryptic bank ' +
      'transfer; a skip writes nothing to any transaction. Names are the normalized ones ' +
      '`uncategorized_merchants` prints. **Dry-runs by default**; commit with `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        merchants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Normalized merchant names, exactly as `uncategorized_merchants` printed them.',
        },
        skip: booleanProp('Default true: set them aside. False puts them back in the queue.'),
        commit: booleanProp('Default false. False previews and writes nothing; true makes the change.'),
      },
      required: ['path', 'merchants'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const raw = args['merchants']
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((each) => typeof each !== 'string' || each === '')) {
      throw new ToolInputError('`merchants` must be a non-empty array of merchant names.')
    }
    if (raw.length > BATCH_MAX) {
      throw new ToolInputError(`That is ${raw.length} names; the ceiling is ${BATCH_MAX} in one call.`)
    }
    const names = [...new Set(raw as readonly string[])]
    const skip = optionalBoolean(args, 'skip') ?? true
    const planFor = (skipped: ReadonlyMap<string, number>): SkipPlan => ({
      skip,
      change: names.filter((name) => skipped.has(name) !== skip),
      already: names.filter((name) => skipped.has(name) === skip),
    })
    return mutatingCall<SkipPlan>(path, args['commit'] === true, {
      plan: (document) => planFor(readSkipped(document.db)),
      describe: describeSkip,
      apply: (document, plan) => {
        const now = Date.now()
        for (const name of plan.change) {
          if (plan.skip) skipMerchant(document.db, name, now)
          else unskipMerchant(document.db, name, now)
        }
        return describeSkip(plan).replace(' would be ', ' were ')
      },
      refuses: (plan) => plan.change.length === 0,
    })
  },
}
