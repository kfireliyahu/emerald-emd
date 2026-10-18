/**
 * `transfers` and `answer_transfers` — the conversation half of a transfer
 * between two of the person's own accounts (M30 U3, D-356).
 *
 * Every import suggests the pairs it can see: a row leaving one account and the
 * same amount arriving in another within a few days. The person answers each
 * once — one transfer, or two rows that only looked like one. The accounts
 * screen's queue and a row's detail panel are the screen half, and both write
 * through `setTransferDecisions`.
 */

import {
  findTransferPair,
  listTransferPairs,
  setTransferDecisions,
  TRANSFER_DECISIONS,
  type TransferDecision,
  type TransferPair,
} from '@/data/repositories/transferPairRepository.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { money, paragraphs, plural, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 500

/** The words a conversation uses, and the answer each one stores. */
const ANSWERS: Readonly<Record<string, TransferDecision>> = {
  transfer: 'PAIRED',
  not_a_transfer: 'NOT_PAIRED',
  undecided: 'PENDING',
}

/** The conversation's word for each stored answer. */
const WORD_KEY: Readonly<Record<TransferDecision, string>> = {
  PAIRED: 'transfer',
  NOT_PAIRED: 'not_a_transfer',
  PENDING: 'undecided',
}

const WORD: Readonly<Record<TransferDecision, string>> = {
  PAIRED: 'transfer',
  NOT_PAIRED: 'not a transfer',
  PENDING: 'undecided',
}

function pairsTable(pairs: readonly TransferPair[]): string {
  return table(
    ['Pair', 'Left', 'On', 'Arrived in', 'On', 'Amount', 'Answer'],
    pairs.map((pair) => [
      pair.id,
      pair.out.accountName,
      pair.out.date,
      pair.in.accountName,
      pair.in.date,
      money(pair.in.amount),
      WORD[pair.decision],
    ]),
  )
}

export const transfersTool: PluginTool = {
  definition: {
    name: 'transfers',
    title: 'Transfers between the person’s own accounts',
    description:
      'Lists the transfers between two of the person’s own accounts that imports have found: a ' +
      'row leaving one account and the same amount arriving in another within a few days. ' +
      'Undecided ones by default; `answer` reads the transfers or the rows that are not one. An ' +
      'answered transfer is neither income nor spending. `answer_transfers` answers them.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        answer: {
          type: 'string',
          enum: ['undecided', 'transfer', 'not_a_transfer', 'all'],
          description: 'Which to list. Default undecided.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const wanted = optionalString(args, 'answer') ?? 'undecided'
    if (wanted !== 'all' && ANSWERS[wanted] === undefined) {
      throw new ToolInputError('`answer` is undecided, transfer, not_a_transfer or all.')
    }
    return readDocument(path, (document) => {
      const decision = wanted === 'all' ? undefined : ANSWERS[wanted]
      const pairs = listTransferPairs(document.db, decision === undefined ? {} : { decision })
      if (pairs.length === 0) {
        return wanted === 'undecided'
          ? 'No transfer is waiting on an answer.'
          : 'No transfer has that answer.'
      }
      return paragraphs(
        `${plural(pairs.length, 'pair')}.`,
        pairsTable(pairs),
        wanted === 'undecided'
          ? 'Until each is answered, a row that left an ordinary account counts as spending and a row ' +
            'that arrived in one as income; a row on an account with holdings is in no total either way.'
          : undefined,
      )
    })
  },
}

interface Requested {
  readonly pairId: string
  readonly answer: string
}

interface AnswerPlan {
  readonly pairId: string
  readonly pair: TransferPair | undefined
  readonly decision: TransferDecision | undefined
  readonly note: string | undefined
}

function readAnswers(args: Args): readonly Requested[] {
  const raw = args['pairs']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`pairs` must be a non-empty array, one entry per pair.')
  }
  if (raw.length > BATCH_MAX) throw new ToolInputError(`That is ${raw.length} entries; the ceiling is ${BATCH_MAX}.`)
  return raw.map((entry, index): Requested => {
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`\`pairs[${index}]\` must be an object.`)
    const record = entry as Record<string, unknown>
    const id = record['pair_id']
    const answer = record['answer']
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ToolInputError(`\`pairs[${index}]\` needs a \`pair_id\`, from \`transfers\`.`)
    }
    if (typeof answer !== 'string') {
      throw new ToolInputError(`\`pairs[${index}].answer\` is transfer, not_a_transfer or undecided.`)
    }
    return { pairId: id.trim(), answer }
  })
}

function planAnswers(document: OpenDocument, batch: readonly Requested[]): readonly AnswerPlan[] {
  return batch.map((one) => {
    const pair = findTransferPair(document.db, one.pairId)
    const decision = ANSWERS[one.answer]
    const note =
      pair === undefined
        ? 'no such pair; `transfers` lists them'
        : decision === undefined
          ? 'the answer is transfer, not_a_transfer or undecided'
          : undefined
    return { pairId: one.pairId, pair, decision, note }
  })
}

function describeAnswers(entries: readonly AnswerPlan[]): string {
  return table(
    ['Pair', 'Left', 'Arrived in', 'Amount', 'Answer now', 'Will be', 'Note'],
    entries.map((entry) => [
      entry.pairId,
      entry.pair === undefined ? '—' : `${entry.pair.out.accountName}, ${entry.pair.out.date}`,
      entry.pair === undefined ? '—' : `${entry.pair.in.accountName}, ${entry.pair.in.date}`,
      entry.pair === undefined ? '—' : money(entry.pair.in.amount),
      entry.pair === undefined ? '—' : WORD[entry.pair.decision],
      entry.decision === undefined ? '—' : WORD[entry.decision],
      entry.note ?? '',
    ]),
  )
}

export const answerTransfersTool: PluginTool = {
  definition: {
    name: 'answer_transfers',
    title: 'Answer transfers between the person’s own accounts',
    description:
      'Answers the pairs `transfers` lists — **a list in one call**. `transfer`: one transfer ' +
      'between two of the person’s accounts, so neither row is income or spending (the end on an ' +
      'ordinary account counts as money moved, the end on an account with holdings is in no ' +
      'total). `not_a_transfer`: two rows that only looked like one; both stay what they were and ' +
      'are never suggested again. `undecided` takes an answer back. **Dry-runs by default**; the ' +
      'document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        pairs: {
          type: 'array',
          description: `One entry per pair. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              pair_id: stringProp('The pair, from `transfers`.'),
              answer: { type: 'string', enum: TRANSFER_DECISIONS.map((each) => WORD_KEY[each]) },
            },
            required: ['pair_id', 'answer'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'pairs'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readAnswers(args)

    const mutation: Mutation<readonly AnswerPlan[]> = {
      plan: (document) => planAnswers(document, batch),
      refuses: (entries) => entries.some((entry) => entry.note !== undefined),
      describe: (entries) =>
        paragraphs(
          describeAnswers(entries),
          entries.some((entry) => entry.note !== undefined)
            ? 'Nothing will be written while any entry has a note: the batch applies whole or not at all.'
            : undefined,
        ),
      apply: (document, entries) => {
        if (entries.some((entry) => entry.note !== undefined)) {
          return paragraphs(describeAnswers(entries), '**Nothing was written**: the batch applies whole or not at all.')
        }
        const written = setTransferDecisions(
          document.db,
          entries.flatMap((entry) => (entry.decision === undefined ? [] : [{ pairId: entry.pairId, decision: entry.decision }])),
        )
        const waiting = listTransferPairs(document.db, { decision: 'PENDING' }).length
        return paragraphs(
          `Answered ${plural(written, 'pair')}.`,
          waiting === 0 ? 'No transfer is waiting on an answer.' : `${plural(waiting, 'pair')} still waiting.`,
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
